// 自选股增删：验证「新增校验 → 落盘（DATA_ROOT 临时目录）→ 列表刷新 → 二次确认删除」全链路。
import { expect, test } from "@playwright/test";

/** 用贵州茅台做样本：真实存在的 A 股代码，侧车在线或离线都能通过校验。 */
const CODE = "600519";

test.describe("自选股", () => {
  test("可以添加并删除一只自选股", async ({ page }) => {
    await page.goto("/");

    const sidebar = page.getByTestId("watchlist-sidebar");
    await expect(sidebar).toBeVisible();
    const count = sidebar.locator("span").filter({ hasText: /共 \d+ 只/ });
    // 端到端跑在独立的数据根目录里，初始应为空。
    await expect(count).toHaveText(/共 0 只/);

    // 自选为空时添加表单常开；已有数据时才需要先展开。
    const codeInput = page.getByLabel("自选股代码");
    if (!(await codeInput.isVisible())) {
      await sidebar.getByRole("button", { name: /添加/ }).click();
    }

    await codeInput.fill(CODE);
    await page.getByRole("button", { name: "添加自选股" }).click();

    await expect(count).toHaveText(/共 1 只/);
    await expect(sidebar.getByText(CODE)).toBeVisible();

    // 删除需要二次确认。
    await sidebar.getByRole("button", { name: "删除", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "确认删除自选股" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "确认删除" }).click();

    await expect(count).toHaveText(/共 0 只/);
    await expect(sidebar.getByText(CODE)).toHaveCount(0);
  });
});
