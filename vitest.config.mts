import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * 单元测试配置：只覆盖无外部依赖的纯计算模块。
 * 默认使用 node 环境且不加载 .env，因此数据层自动回退到内存实现，
 * 测试过程不会连接数据库、行情侧车或 AI 服务。
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reportsDirectory: "coverage",
      include: ["src/lib/**/*.ts"],
    },
  },
});
