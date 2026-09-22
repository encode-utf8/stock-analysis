// 浏览器端到端测试配置（Playwright）。
// 约定：先执行 `pnpm build`，再由本配置拉起 `next start`（生产构建）跑用例。
// 服务端进程的 DATA_ROOT 指向临时目录，数据库、邮件与外部密钥一律置空，
// 因此用例写入的自选池、持仓、预警与背景设置不会碰到本机真实数据。
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

/** 端到端专用端口，避开本地开发常用的 3000。 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://127.0.0.1:${PORT}`;

/** 每次运行使用独立的数据根目录：用例之间与真实环境互不影响。 */
const dataRoot =
  process.env.E2E_DATA_ROOT?.trim() ||
  mkdtempSync(path.join(os.tmpdir(), "stock-analysis-e2e-"));

/** 端到端专用行情侧车替身端口：提供官方来源数据，并支持模拟上游故障。 */
const SIDECAR_PORT = Number(process.env.E2E_SIDECAR_PORT ?? 3199);
const SIDECAR_URL = `http://127.0.0.1:${SIDECAR_PORT}`;

/** 继承父进程环境，并把数据库、邮件与外部密钥置空（空串等价于未配置）。 */
const serverEnv: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env)) {
  if (value !== undefined) {
    serverEnv[key] = value;
  }
}
Object.assign(serverEnv, {
  DATA_ROOT: dataRoot,
  // 指向端到端侧车替身：既有用例仍验证官方来源链路，故障用例通过开关构造 503。
  DATA_SERVICE_URL: SIDECAR_URL,
  // 关闭迁移配置加载：即使本机存在 .env.export，也不能把真实数据库地址补回来。
  SKIP_ENV_EXPORT: "1",
  DATABASE_URL: "",
  SMTP_HOST: "",
  SMTP_USER: "",
  SMTP_PASS: "",
  DEEPSEEK_API_KEY: "",
  TAVILY_API_KEY: "",
  R2_ACCOUNT_ID: "",
  R2_ACCESS_KEY_ID: "",
  R2_SECRET_ACCESS_KEY: "",
  R2_BUCKET_NAME: "",
});

export default defineConfig({
  testDir: "tests/e2e",
  // 产物放 .logs（已被 .gitignore 忽略），不污染仓库根目录。
  outputDir: path.join(".logs", "e2e"),
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // 所有用例共用同一个服务端与同一份数据目录，串行执行更稳定。
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL,
    locale: "zh-CN",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      // 行情侧车替身：先用 `node tests/e2e/mock-sidecar.mjs` 起在固定端口上。
      command: `node ./tests/e2e/mock-sidecar.mjs`,
      url: `${SIDECAR_URL}/health`,
      timeout: 30_000,
      reuseExistingServer: !process.env.CI,
      env: { E2E_SIDECAR_PORT: String(SIDECAR_PORT) },
    },
    {
      // 生产构建启动；未先执行 `pnpm build` 时会直接报错，提示明确。
      // 直接调用仓库内的 next CLI，避免依赖 pnpm/npx 是否在 PATH 上。
      command: `node ./node_modules/next/dist/bin/next start --port ${PORT}`,
      url: `${baseURL}/api/health`,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      env: serverEnv,
    },
  ],
});
