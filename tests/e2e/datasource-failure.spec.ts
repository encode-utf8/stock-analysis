// 数据源故障（R2/R5）：无官方快照时统一提示「当前数据源故障，请稍后再试。」，
// 触发按钮禁用 10 秒并展示倒计时，冷却结束后自动恢复；数据源恢复后提示自动清除。
// 侧车替身（tests/e2e/mock-sidecar.mjs）提供 /__control 开关模拟上游故障。
import { expect, test, type Page } from "@playwright/test";

const SIDECAR_URL = `http://127.0.0.1:${Number(process.env.E2E_SIDECAR_PORT ?? 3199)}`;
/** 故障用例专用标的：其它用例不会加载它，确保库里没有官方快照可降级。 */
const CODE = "300750";

/** 切换侧车替身的上游可用状态。 */
async function setSidecarOnline(online: boolean): Promise<void> {
  const response = await fetch(`${SIDECAR_URL}/__control?online=${online ? 1 : 0}`);
  expect(response.ok).toBe(true);
}

/** 打开指定功能模块：模块栏按钮带 aria-pressed，可据此判断是否已启用。 */
async function enableModule(page: Page, label: string): Promise<void> {
  const button = page.getByRole("button", { name: label, exact: true });
  await expect(button).toBeVisible();
  if ((await button.getAttribute("aria-pressed")) !== "true") {
    await button.click();
  }
  await expect(button).toHaveAttribute("aria-pressed", "true");
}

/** 全站数据源故障提示条。 */
function failureNotice(page: Page) {
  return page.getByTestId("datasource-unavailable-banner");
}

test.describe("数据源故障处理", () => {
  test.afterEach(async () => {
    // 用例之间共用同一个侧车替身进程：结束后必须恢复在线，避免影响后续用例。
    await setSidecarOnline(true);
  });

  test("无官方快照时提示故障并禁用触发按钮 10 秒", async ({ page }) => {
    await setSidecarOnline(true);
    await page.goto("/");
    await enableModule(page, "行情概览");
    await enableModule(page, "资讯搜索");

    const searchButton = page.getByRole("button", { name: "查询", exact: true });
    const newsButton = page.getByRole("button", { name: "搜索资讯" });
    await expect(searchButton).toBeEnabled();

    // 上游故障后查询未加载过的标的：没有官方快照可降级，按数据源故障处理。
    await setSidecarOnline(false);
    await page.getByLabel("股票代码").fill(CODE);
    await searchButton.click();

    const notice = failureNotice(page);
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("当前数据源故障，请稍后再试");
    await expect(notice).toContainText(/秒后可重试/);

    // 全站冷却：查询与资讯搜索按钮同时禁用，避免连续点击。
    await expect(searchButton).toBeDisabled();
    await expect(newsButton).toBeDisabled();
    await page.waitForTimeout(2_000);
    await expect(searchButton).toBeDisabled();

    // 10 秒冷却结束后自动恢复可点。
    await expect(searchButton).toBeEnabled({ timeout: 20_000 });

    // 数据源恢复后查询成功，故障提示自动清除。
    await setSidecarOnline(true);
    await searchButton.click();
    await expect(notice).toBeHidden();
    await expect(page.getByText(/数据时间：/).first()).toBeVisible();
  });

  test("资讯检索不可用时提示故障并禁用搜索按钮", async ({ page }) => {
    await setSidecarOnline(true);
    await page.goto("/");
    await enableModule(page, "资讯搜索");

    const newsButton = page.getByRole("button", { name: "搜索资讯" });
    await expect(newsButton).toBeEnabled();

    // 端到端环境未配置 Tavily，也没有该标的的官方资讯快照：检索按数据源故障处理。
    await newsButton.click();

    const notice = failureNotice(page);
    await expect(notice).toBeVisible();
    await expect(newsButton).toBeDisabled();
  });
});