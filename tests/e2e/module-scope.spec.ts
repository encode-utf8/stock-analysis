// 模块分组布局：顶部模块菜单按「是否随当前标的切换」分为两组，
// 两组在菜单与内容区彻底分离，勾选状态互不影响，空态可一键启用该组默认模块。
import { expect, test, type Page } from "@playwright/test";

/** 侧车替身端口：用例开始前恢复在线，避免受其它用例的故障开关影响。 */
const SIDECAR_URL = `http://127.0.0.1:${Number(process.env.E2E_SIDECAR_PORT ?? 3199)}`;

/** 模块栏的分组 tab（名称带分组计数，用包含匹配）。 */
function scopeTab(page: Page, label: string) {
  return page.getByRole("tab", { name: label });
}

/** 分组内的模块 chip：模块栏按钮带 aria-pressed，可据此判断是否已启用。 */
function moduleChip(page: Page, label: string) {
  return page.getByRole("button", { name: label, exact: true });
}

test.beforeEach(async () => {
  const response = await fetch(`${SIDECAR_URL}/__control?online=1`);
  expect(response.ok).toBe(true);
});

test.describe("工作台模块分组", () => {
  test("两组模块分离，勾选互不影响", async ({ page }) => {
    await page.goto("/");

    // 默认进入「当前标的」：只有随标的切换的模块，全局工具不出现在菜单里。
    const targetTab = scopeTab(page, "当前标的");
    const globalTab = scopeTab(page, "持仓与全局工具");
    await expect(targetTab).toHaveAttribute("aria-selected", "true");
    await expect(targetTab).toContainText("0/8");
    await expect(moduleChip(page, "行情概览")).toBeVisible();
    await expect(moduleChip(page, "历史复盘")).toBeVisible();
    await expect(moduleChip(page, "我的持仓组合")).toHaveCount(0);
    await expect(moduleChip(page, "AI 股市日报")).toHaveCount(0);

    // 切到「持仓与全局工具」：chips 换成账户级 / 独立工具，内容区给出分组空态。
    await globalTab.click();
    await expect(globalTab).toHaveAttribute("aria-selected", "true");
    await expect(globalTab).toContainText("0/5");
    await expect(moduleChip(page, "我的持仓组合")).toBeVisible();
    await expect(moduleChip(page, "AI 股市日报")).toBeVisible();
    await expect(moduleChip(page, "行情概览")).toHaveCount(0);
    // 用 role 查询：非当前工作台被 hidden 隐藏，不参与无障碍树匹配。
    await expect(
      page.getByRole("heading", { name: "「持仓与全局工具」分组还没有勾选模块" }),
    ).toBeVisible();

    // 空态一键启用默认模块：持仓组合面板出现，分组计数更新。
    await page.getByRole("button", { name: "启用「我的持仓组合」" }).click();
    await expect(globalTab).toContainText("1/5");
    await expect(page.getByRole("heading", { name: "我的持仓组合" })).toBeVisible();

    // 切回「当前标的」：本组仍是空的，另一组的勾选不受影响。
    await targetTab.click();
    await expect(targetTab).toContainText("0/8");
    await expect(
      page.getByRole("heading", { name: "「当前标的」分组还没有勾选模块" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "我的持仓组合" })).toHaveCount(0);
    await expect(globalTab).toContainText("1/5");

    // 勾选本组模块后只影响本组计数，盘面模块正常渲染。
    await moduleChip(page, "行情概览").click();
    await expect(targetTab).toContainText("1/8");
    await expect(globalTab).toContainText("1/5");
    await expect(page.getByText(/数据时间：/).filter({ visible: true }).first()).toBeVisible();
  });

  test("清空本组只清当前分组", async ({ page }) => {
    await page.goto("/");

    // 两组各启用一个模块。
    await moduleChip(page, "行情概览").click();
    await page.getByRole("tab", { name: "持仓与全局工具" }).click();
    await moduleChip(page, "AI 股市日报").click();
    await expect(page.getByRole("tab", { name: "持仓与全局工具" })).toContainText("1/5");

    // 清空本组：只清空全局工具分组。
    await page.getByRole("button", { name: "清空本组" }).click();
    await expect(page.getByRole("tab", { name: "持仓与全局工具" })).toContainText("0/5");
    await expect(page.getByRole("tab", { name: "当前标的" })).toContainText("1/8");
  });
});
