// 首页外壳冒烟：默认工作台、工作台切换、免责声明与运行时异常。
import { expect, test } from "@playwright/test";

test.describe("首页外壳", () => {
  test("默认渲染个股工作台与免责声明", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/个股盘面分析/);

    const tabs = page.getByRole("tablist", { name: "工作台切换" });
    await expect(tabs.getByRole("tab", { name: "个股工作台" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(tabs.getByRole("tab", { name: "基金工作台" })).toHaveAttribute(
      "aria-selected",
      "false",
    );

    await expect(page.getByTestId("watchlist-sidebar")).toBeVisible();
    await expect(page.getByText("本工具仅供学习参考，不构成投资建议")).toBeVisible();
  });

  test("可以在个股台与基金台之间切换", async ({ page }) => {
    await page.goto("/");
    const tabs = page.getByRole("tablist", { name: "工作台切换" });

    await tabs.getByRole("tab", { name: "基金工作台" }).click();
    await expect(tabs.getByRole("tab", { name: "基金工作台" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByTestId("fund-watchlist-panel")).toBeVisible();
    await expect(page.getByTestId("watchlist-sidebar")).toBeHidden();

    await tabs.getByRole("tab", { name: "个股工作台" }).click();
    await expect(page.getByTestId("watchlist-sidebar")).toBeVisible();
  });

  test("首屏加载后没有未捕获异常", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto("/");
    await expect(page.getByRole("tablist", { name: "工作台切换" })).toBeVisible();
    // 等首屏各面板的取数收敛：侧车与数据库未启动时应走降级分支，而不是抛异常。
    await page.waitForTimeout(1500);

    expect(errors).toEqual([]);
  });
});
