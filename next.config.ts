import type { NextConfig } from "next";

import { loadEnvExport } from "./src/lib/env-export";

// 迁移导出配置：配置求值阶段先补全缺失的键，保证构建期与运行期读到同一套环境变量。
loadEnvExport();

// 关闭 Next.js 16 自动生成 AGENTS.md/CLAUDE.md 的行为，保持仓库清洁。
const nextConfig: NextConfig = {
  agentRules: false,
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  // Docker 构建（NEXT_OUTPUT=standalone）时生成精简运行产物；
  // 默认不设置，保证本地 next build / next start、CI 与端到端测试行为不变。
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
};

export default nextConfig;
