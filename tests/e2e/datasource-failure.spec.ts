// 数据源故障（R2/R5）：无官方快照时统一提示「当前数据源故障，请稍后再试。」，
// 触发按钮禁用 10 秒并展示倒计时，冷却结束后自动恢复；数据源恢复后提示自动清除。
// 侧车替身（tests/e2e/mock-sidecar.mjs）提供 /__control 开关模拟上游故障。
import { expect, test, type Page } from "@playwright/test";

const SIDECAR_URL = `http://127.0.0.1:${Number(process.env.E2E_SIDECAR_PORT ?? 3199)}`;
/** 故障用例专用标的：其它用例不会加载它，确保库里没有官方快照可降级。 */
const CODE = "300750";
/** 悬浮层级用例使用的默认标的：加载它不会影响故障用例专用标的的快照状态。 */
const DEFAULT_CODE = "600519";

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

/** 读取提示条与模块菜单栏的层级 / 位置，用于验证提示条是唯一的悬浮层。 */
async function readNoticeLayers(page: Page) {
  return page.evaluate(() => {
    const banner = document.querySelector<HTMLElement>(
      '[data-testid="datasource-unavailable-banner"]',
    );
    const menu = document.querySelector<HTMLElement>('[data-testid="module-menu-bar"]');
    if (!banner || !menu) {
      return null;
    }
    /** 取元素中心点处最上层的元素，用于判断是否被其它元素遮挡。 */
    const topElementAt = (node: HTMLElement): Element | null => {
      const rect = node.getBoundingClientRect();
      return document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    };
    const bannerHit = topElementAt(banner);
    const menuHit = topElementAt(menu);
    const bannerRect = banner.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    return {
      bannerPosition: window.getComputedStyle(banner).position,
      bannerZIndex: Number(window.getComputedStyle(banner).zIndex),
      menuZIndex: Number(window.getComputedStyle(menu).zIndex),
      bannerOnTop: Boolean(bannerHit && banner.contains(bannerHit)),
      menuOnTop: Boolean(menuHit && menu.contains(menuHit)),
      bannerBottom: bannerRect.bottom,
      menuTop: menuRect.top,
    };
  });
}

/** 悬浮提示条出现后，页内内容的下移占位块。 */
function failureSpacer(page: Page) {
  return page.getByTestId("datasource-banner-spacer");
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

  test("故障提示固定悬浮在两栏内容之上且滚动时不互相遮挡", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 640 });
    await setSidecarOnline(true);
    await page.goto("/");
    await enableModule(page, "行情概览");
    await enableModule(page, "资讯搜索");

    // 先以默认标的（600519）加载行情把页内内容撑高，便于验证滚动时的悬浮层级；
    // 这里刻意不用故障用例专用标的 CODE，避免提前写入官方快照影响「无快照」用例。
    // 随后触发确定性故障：端到端环境未配置 Tavily 且无官方资讯快照，
    // 资讯检索必然按「数据源故障」处理。
    await page.getByLabel("股票代码").fill(DEFAULT_CODE);
    await page.getByRole("button", { name: "查询", exact: true }).click();
    await expect(page.getByText(/数据时间：/).first()).toBeVisible();

    await page.getByRole("button", { name: "搜索资讯" }).click();
    const notice = failureNotice(page);
    await expect(notice).toBeVisible();

    const layers = await readNoticeLayers(page);
    expect(layers).not.toBeNull();
    // 固定悬浮层：position: fixed，且层级高于模块菜单栏等页内吸顶元素。
    expect(layers!.bannerPosition).toBe("fixed");
    expect(layers!.bannerZIndex).toBeGreaterThan(layers!.menuZIndex);

    // 占位高度与提示条实际高度一致：内容整体让位，提示条不压住正文。
    const spacerHeight = await failureSpacer(page).evaluate(
      (node) => node.getBoundingClientRect().height,
    );
    const bannerHeight = await notice.evaluate((node) => node.getBoundingClientRect().height);
    expect(bannerHeight).toBeGreaterThan(0);
    expect(Math.abs(spacerHeight - bannerHeight)).toBeLessThanOrEqual(1);

    // 页内正文高于视口，保证下面的滚动断言有实际滚动发生。
    const maxScroll = await page.evaluate(
      () => document.documentElement.scrollHeight - window.innerHeight,
    );
    expect(maxScroll).toBeGreaterThan(100);

    // 多个滚动位置下：提示条与模块菜单栏各自命中自身，两者不重叠、不交替遮挡。
    for (const offset of [0, Math.round(maxScroll / 2), maxScroll]) {
      await page.evaluate((top) => window.scrollTo({ top, behavior: "instant" }), offset);
      await page.waitForTimeout(150);
      const state = await readNoticeLayers(page);
      expect(state).not.toBeNull();
      await expect(notice).toBeVisible();
      expect(state!.bannerOnTop, `滚动到 ${offset}px 时提示条应位于最上层`).toBe(true);
      expect(state!.menuOnTop, `滚动到 ${offset}px 时模块菜单栏应可见且未被遮挡`).toBe(true);
      expect(state!.menuTop, `滚动到 ${offset}px 时模块菜单栏应位于提示条下方`).toBeGreaterThan(
        state!.bannerBottom - 2,
      );
    }
  });
});