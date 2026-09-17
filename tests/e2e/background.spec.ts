// 背景与光效：验证预设切换即时作用于背景画布，并且可以恢复默认。
import { expect, test } from "@playwright/test";

test.describe("背景与光效", () => {
  test("可以切换背景预设并恢复默认", async ({ page }) => {
    await page.goto("/");

    const backdrop = page.locator(".app-backdrop");
    await expect(backdrop).toHaveAttribute("data-preset", "grid");
    await expect(page.locator(".app-backdrop__canvas")).toBeAttached();

    await page.getByRole("button", { name: "背景与光效" }).click();
    const dialog = page.getByRole("dialog", { name: "背景画布与交互光效" });
    await expect(dialog).toBeVisible();

    await dialog.getByRole("button", { name: /星域/ }).click();
    await expect(backdrop).toHaveAttribute("data-preset", "starfield");

    await dialog.getByRole("button", { name: /科技网格/ }).click();
    await expect(backdrop).toHaveAttribute("data-preset", "grid");

    await dialog.getByRole("button", { name: "关闭" }).click();
    await expect(dialog).toBeHidden();
  });
});
