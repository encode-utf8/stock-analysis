// 持仓 / 持有列表点击切换：从「我的持仓组合」「我的持有基金」直接切换当前查询标的，
// 验证侧栏代码输入框与面板「当前」反馈同步更新。样本名称由侧车替身提供，断言稳定。
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
  test("个股：点击持仓名称直接切换当前查询股票", async ({ page }) => {
    await ensureStockHolding(page, STOCK_CODE);

    await page.goto("/");
    await enableModule(page, "我的持仓组合");

    const switchButton = page.getByRole("button", {
      name: `切换到 ${STOCK_NAME}（${STOCK_CODE}）`,
    });
    await expect(switchButton).toBeVisible();
    await switchButton.click();

    // 侧栏代码与面板「当前」反馈同步为新标的（按 id 定位侧栏输入，避开面板录入表单的同名标签）。
    await expect(page.locator("#stock-code-input")).toHaveValue(STOCK_CODE);
    await expect(page.getByText(`当前：${STOCK_NAME}（${STOCK_CODE}）`)).toBeVisible();
  });

  test("基金：点击持有基金名称直接切换当前查询基金", async ({ page }) => {
    await ensureFundPosition(page, FUND_CODE);

    await page.goto("/");
    await page.getByRole("tab", { name: "基金工作台" }).click();
    await enableModule(page, "持有基金");

    const switchButton = page.getByRole("button", {
      name: `切换到 ${FUND_NAME}（${FUND_CODE}）`,
    });
    await expect(switchButton).toBeVisible();
    await switchButton.click();

    await expect(page.locator("#fund-code-input")).toHaveValue(FUND_CODE);
    await expect(page.getByText(`当前：${FUND_NAME}（${FUND_CODE}）`)).toBeVisible();
  });
});
