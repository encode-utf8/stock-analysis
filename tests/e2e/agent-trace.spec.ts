// Agent 执行轨迹：验证运行期可视化（步骤 / 耗时 / 首字时延）、按策略自动清除，
// 以及清除后仅保留未开发本功能时的最终结果。服务端在 e2e 中不配置 AI 密钥，
// 走本地兜底链路，轨迹与耗时依旧完整且结果可稳定断言。
import { expect, test, type Page } from "@playwright/test";

/** 打开指定功能模块：模块栏按钮带 aria-pressed，可据此判断是否已启用。 */
async function enableModule(page: Page, label: string): Promise<void> {
  const button = page.getByRole("button", { name: label, exact: true });
  await expect(button).toBeVisible();
  if ((await button.getAttribute("aria-pressed")) !== "true") {
    await button.click();
  }
  await expect(button).toHaveAttribute("aria-pressed", "true");
}

/** 执行轨迹面板（section + aria-label）。 */
function tracePanel(page: Page) {
  return page.getByRole("region", { name: "执行轨迹" });
}

test.describe("Agent 执行轨迹", () => {
  test("对话助手运行期展示步骤与耗时，结束后自动清除并保留最终结果", async ({ page }) => {
    await page.goto("/");
    await enableModule(page, "对话助手");

    const trace = tracePanel(page);
    await expect(trace).toHaveCount(0);

    await page.getByPlaceholder("围绕当前股票继续追问...").fill("现在行情怎么样？");
    await page.getByRole("button", { name: "发送" }).click();

    // 运行期：面板出现，展示步骤计数、思考步骤、工具步骤与耗时。
    await expect(trace).toBeVisible();
    await expect(trace.getByRole("button", { name: /执行轨迹/ })).toContainText(/\d+ 步/);
    await expect(trace.getByText("Thinking")).toBeVisible();
    await expect(trace.getByText("读取行情快照")).toBeVisible();
    await expect(trace.getByText("读取 K 线数据")).toBeVisible();
    await expect(trace.getByText("计算技术指标")).toBeVisible();
    await expect(trace.getByText(/\d+(ms|\.\ds)/).first()).toBeVisible();

    // 结束后按默认「结束后自动清除」策略移除轨迹。
    await expect(trace).toHaveCount(0);

    // 最终结果保持未开发本功能时的呈现：正文与来源列表仍在。
    await expect(page.getByText("数据概览")).toBeVisible();
    await expect(page.getByText(/^来源：/)).toBeVisible();
  });

  test("切换为折叠保留后，轨迹在结束后仍可展开回看", async ({ page }) => {
    await page.goto("/");

    // 顶部设置项切换留存策略，刷新后依然生效（localStorage 持久化）。
    await page.getByRole("button", { name: "轨迹显示" }).click();
    await page.getByRole("button", { name: /结束后折叠保留/ }).click();
    await page.keyboard.press("Escape");
    await page.reload();

    await enableModule(page, "对话助手");
    await page.getByPlaceholder("围绕当前股票继续追问...").fill("现在行情怎么样？");
    await page.getByRole("button", { name: "发送" }).click();

    // 兜底链路很快，先等待本轮结束再断言折叠态，避免与运行期竞争。
    await expect(page.getByRole("button", { name: "停止回复" })).toHaveCount(0);

    const trace = tracePanel(page);
    const header = trace.getByRole("button", { name: /执行轨迹/ });
    await expect(header).toContainText(/\d+ 步/);
    await expect(header).toContainText("展开");
    await expect(trace.getByText("读取行情快照")).toHaveCount(0);

    // 手动展开可以回看每一步与其耗时。
    await header.click();
    await expect(trace.getByText("读取行情快照")).toBeVisible();
    await expect(trace.getByText(/\d+(ms|\.\ds)/).first()).toBeVisible();
  });

  test("中断执行后不残留轨迹", async ({ page }) => {
    await page.goto("/");
    await enableModule(page, "对话助手");

    // 延迟放行请求，制造「请求进行中」的可中断窗口。
    await page.route("**/api/chat", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.continue().catch(() => undefined);
    });

    await page.getByPlaceholder("围绕当前股票继续追问...").fill("现在行情怎么样？");
    await page.getByRole("button", { name: "发送" }).click();
    await page.getByRole("button", { name: "停止回复" }).click();

    await expect(page.getByRole("button", { name: "停止回复" })).toHaveCount(0);
    await page.waitForTimeout(1800);
    await expect(tracePanel(page)).toHaveCount(0);
  });

  test("个股 AI 分析链路同样展示轨迹并在结束后清除", async ({ page }) => {
    await page.goto("/");
    await enableModule(page, "资讯搜索");
    await enableModule(page, "周期内 AI 分析");

    await page.getByRole("button", { name: "生成 AI 分析" }).click();

    const trace = tracePanel(page);
    await expect(trace).toBeVisible();
    await expect(trace.getByText("装配行情与指标")).toBeVisible();
    await expect(trace.getByText("合规与事实性校验")).toBeVisible();

    // 结束后自动清除，报告正文仍是最终结果。
    await expect(trace).toHaveCount(0);
    await expect(page.getByText("数据面")).toBeVisible();
    await expect(page.getByText("风险提示")).toBeVisible();
  });
});