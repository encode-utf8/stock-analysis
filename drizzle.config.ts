import "dotenv/config";
import { defineConfig } from "drizzle-kit";

import { loadEnvExport } from "./src/lib/env-export";

// 迁移导出配置：只补空缺，保证目标机器上只有 .env.export 时 db:migrate / db:studio 也能连库。
loadEnvExport();

// Drizzle 迁移配置：仅用于本地生成/检查迁移文件，不在此阶段执行线上迁移。
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
});
