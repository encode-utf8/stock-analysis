// Drizzle 数据库客户端：仅在需要真实持久化时初始化。
// 当前阶段统一使用 lib/store 的内存 stub，避免未配置数据库时启动失败。
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

let dbInstance: ReturnType<typeof createDb> | null = null;

/** 判断当前环境是否配置了可用的真实 PostgreSQL 数据库。 */
export function hasRealDatabaseUrl(): boolean {
  const url = process.env.DATABASE_URL;
  if (!url || /replace-me/i.test(url)) {
    return false;
  }

  try {
    const parsed = new URL(url);
    return Boolean(parsed.hostname && parsed.username);
  } catch {
    return false;
  }
}

function createDb() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("缺少 DATABASE_URL，请复制 .env.example 为 .env 并填写配置。");
  }
  const normalizedUrl = normalizePostgresUrl(url);
  const client = postgres(normalizedUrl, {
    max: 1,
    connect_timeout: 5,
    idle_timeout: 10,
  });
  return drizzle(client, { schema });
}

/** 为未携带端口的 PostgreSQL 地址补默认 5432，兼容 Neon/Supabase 连接串。 */
function normalizePostgresUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (!parsed.port) {
      parsed.port = "5432";
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

/** 获取数据库客户端；未配置时会抛出明确错误。 */
export function getDb(): ReturnType<typeof createDb> {
  dbInstance ??= createDb();
  return dbInstance;
}

export * as schema from "./schema";
