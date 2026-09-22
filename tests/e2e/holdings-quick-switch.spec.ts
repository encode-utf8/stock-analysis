// 持仓 / 持有列表点击切换：从「我的持仓组合」「我的持有基金」直接切换当前查询标的，
// 验证侧栏代码同步更新、并自动回到「当前标的」分组展示盘面对应的模块。
import { expect, test, type Page } from "@playwright/test";

/** 侧车替身端口：用例开始前恢复在线，避免受其它用例的故障开关影响。 */
const SIDECAR_URL = `http://127.0.0.1:${Number(process.env.E2E_SIDECAR_PORT ?? 3199)}`;
/** 个股样本：刻意避开默认标的 600519，切换后才能观察到代码变化。 */
const STOCK_CODE = "600000";
const STOCK_NAME = "浦发银行";
/** 基金样本：刻意避开默认基金 510300。 */
const FUND_CODE = "110022";
const FUND_NAME = "易方达消费行业";

/** 打开指定功能模块：模块栏按钮带 aria-pressed，可据此判断是否已启用。 */
async function enableModule(page: Page, label: string): Promise<void> {
  const button = page.getByRole("button", { name: label, exact: true });
  await expect(button).toBeVisible();
  if ((await button.getAttribute("aria-pressed")) !== "true") {
    await button.click();
  }
  await expect(button).toHaveAttribute("aria-pressed", "true");
}

/** 分组内的模块 chip（按钮，带 aria-pressed）。 */
function moduleChip(page: Page, label: string) {
  return page.getByRole("button", { name: label, exact: true });
}

/** 持仓 / 持有模块属于「持仓与全局工具」分组：先切分组再勾选。 */
async function openGlobalScope(page: Page): Promise<void> {
  await page.getByRole("tab", { name: "持仓与全局工具" }).click();
  await expect(page.getByRole("tab", { name: "持仓与全局工具" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
}

/** 确保持仓列表里存在该股票：端到端数据目录每次独立，同时兼容复用已有服务的情况。 */
async function ensureStockHolding(page: Page, code: string): Promise<void> {
  const snapshot = await page.request.get("/api/stock-portfolio");
  const payload = (await snapshot.json()) as {
    data?: { holdings?: Array<{ holding?: { code?: string } }> };
  };
  if (payload.data?.holdings?.some((item) => item.holding?.code === code)) {
    return;
  }
  const created = await page.request.post("/api/stock-portfolio", {
    data: { code, amount: 100000, profit: 5000, note: "端到端样本" },
  });
  expect(created.ok()).toBeTruthy();
}

/** 确保持有列表里存在该基金：同一基金代码重复提交会合并，因此仅在缺失时新增。 */
async function ensureFundPosition(page: Page, code: string): Promise<void> {
  const snapshot = await page.request.get("/api/fund-positions");
  const payload = (await snapshot.json()) as {
    data?: { holdings?: Array<{ position?: { code?: string } }> };
  };
  if (payload.data?.holdings?.some((item) => item.position?.code === code)) {
    return;
  }
  const created = await page.request.post("/api/fund-positions", {
    data: { code, amount: 50000, profit: 1200, profit_caliber: "include_today", note: "端到端样本" },
  });
  expect(created.ok()).toBeTruthy();
}

test.beforeEach(async () => {
  const response = await fetch(`${SIDECAR_URL}/__control?online=1`);
  expect(response.ok).toBe(true);
});

test.describe("持仓列表点击切换", () => {
  test("个股：点击持仓名称切换当前查询股票并回到标的视图", async ({ page }) => {
    await ensureStockHolding(page, STOCK_CODE);

    await page.goto("/");
    await openGlobalScope(page);
    await enableModule(page, "我的持仓组合");

    // 未切换前提示行给出的是当前查询标的（默认 600519，不在持仓里时只显示代码）。
    await expect(page.getByText("当前：600519")).toBeVisible();

    const switchButton = page.getByRole("button", {
      name: `切换到 ${STOCK_NAME}（${STOCK_CODE}）`,
    });
    await expect(switchButton).toBeVisible();
    await switchButton.click();

    // 切换后自动回到「当前标的」分组，并启用默认模块，盘面同步为新代码。
    await expect(page.getByRole("tab", { name: "当前标的" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.locator("#stock-code-input")).toHaveValue(STOCK_CODE);
    await expect(moduleChip(page, "行情概览")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText(/数据时间：/).filter({ visible: true }).first()).toBeVisible();
  });

  test("基金：点击持有基金名称切换当前查询基金并回到标的视图", async ({ page }) => {
    await ensureFundPosition(page, FUND_CODE);

    await page.goto("/");
    await page.getByRole("tab", { name: "基金工作台" }).click();
    await openGlobalScope(page);
    await enableModule(page, "持有基金");

    const switchButton = page.getByRole("button", {
      name: `切换到 ${FUND_NAME}（${FUND_CODE}）`,
    });
    await expect(switchButton).toBeVisible();
    await switchButton.click();

    // 切换后回到「当前标的」分组，默认模块「基金档案」自动启用。
    await expect(page.getByRole("tab", { name: "当前标的" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.locator("#fund-code-input")).toHaveValue(FUND_CODE);
    await expect(moduleChip(page, "基金档案")).toHaveAttribute("aria-pressed", "true");
    // 档案面板已按新代码取数：标题带基金代码。
    await expect(page.getByRole("heading", { name: /110022/ })).toBeVisible();

    // 行业资讯属于「当前标的」类模块：在本组启用后面板跟随当前基金代码，不再是独立代码输入。
    await enableModule(page, "行业资讯");
    const newsPanel = page.getByTestId("fund-news-panel");
    await expect(newsPanel).toBeVisible();
    await expect(newsPanel).toContainText(`当前基金 ${FUND_CODE}`);
  });
});
