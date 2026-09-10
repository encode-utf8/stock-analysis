// 预警规则、事件与设置的持久化：PostgreSQL（Drizzle）优先，不可用时回退本地文件。
// 未配置 DATABASE_URL 时写入 .data/alerts.json 与 .data/alert-settings.json，重启不丢失。
import { and, asc, desc, eq } from "drizzle-orm";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { isEmailConfigured } from "@/lib/alert-email";
import { getDb, hasRealDatabaseUrl, schema } from "@/lib/db";
import { ALERT_METRIC_LABELS } from "@/lib/shared/types";
import type {
  AlertConditionHit,
  AlertEvent,
  AlertEventStatus,
  AlertLogic,
  AlertMetric,
  AlertRule,
  AlertSettings,
  AlertTarget,
} from "@/lib/shared/types";

const STORE_FILE = path.join(process.cwd(), ".data", "alerts.json");
const SETTINGS_FILE = path.join(process.cwd(), ".data", "alert-settings.json");

/** 事件查询条件。 */
export interface AlertEventQuery {
  status?: AlertEventStatus;
  target?: AlertTarget;
  code?: string;
  limit?: number;
}

/** 预警仓储接口：规则、事件与设置统一收口。 */
export interface AlertRepository {
  listRules(): Promise<AlertRule[]>;
  getRule(id: string): Promise<AlertRule | null>;
  saveRule(rule: AlertRule): Promise<void>;
  removeRule(id: string): Promise<void>;
  markRuleTriggered(id: string, at: string): Promise<void>;
  disableRulesByCode(target: AlertTarget, code: string): Promise<void>;
  getEvent(id: string): Promise<AlertEvent | null>;
  listEvents(query?: AlertEventQuery): Promise<AlertEvent[]>;
  insertEvents(events: AlertEvent[]): Promise<void>;
  updateEventStatus(id: string, status: AlertEventStatus): Promise<void>;
  removeEvent(id: string): Promise<void>;
  getSettings(): Promise<AlertSettings>;
  updateSettings(patch: { email_to?: string | null; email_enabled?: boolean }): Promise<AlertSettings>;
}

interface AlertFileShape {
  rules: AlertRule[];
  events: AlertEvent[];
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** 读取环境变量中的标的数量上限，默认 3。 */
function envMaxTargets(): number {
  const parsed = Number(process.env.ALERT_MAX_TARGETS ?? 3);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 3;
}

/** 默认设置：收件邮箱取自本地环境变量，可被本地文件覆盖。 */
function defaultSettings(): AlertSettings {
  return {
    email_to: process.env.ALERT_EMAIL_TO?.trim() || null,
    email_enabled: true,
    email_configured: isEmailConfigured(),
    max_targets: envMaxTargets(),
    updated_at: new Date().toISOString(),
  };
}

async function loadStoreFile(): Promise<AlertFileShape> {
  try {
    const content = await readFile(STORE_FILE, "utf8");
    const parsed = JSON.parse(content) as Partial<AlertFileShape>;
    return {
      rules: Array.isArray(parsed.rules) ? parsed.rules : [],
      events: Array.isArray(parsed.events) ? parsed.events : [],
    };
  } catch {
    return { rules: [], events: [] };
  }
}

async function saveStoreFile(shape: AlertFileShape): Promise<void> {
  await mkdir(path.dirname(STORE_FILE), { recursive: true });
  await writeFile(STORE_FILE, JSON.stringify(shape, null, 2), "utf8");
}

async function loadSettingsFile(): Promise<Partial<AlertSettings>> {
  try {
    const content = await readFile(SETTINGS_FILE, "utf8");
    return JSON.parse(content) as Partial<AlertSettings>;
  } catch {
    return {};
  }
}

async function saveSettingsFile(settings: AlertSettings): Promise<void> {
  await mkdir(path.dirname(SETTINGS_FILE), { recursive: true });
  await writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf8");
}

function mapRuleRow(row: typeof schema.alertRules.$inferSelect): AlertRule {
  return {
    id: row.id,
    target: row.target as AlertTarget,
    code: row.code,
    name: row.name,
    logic: row.logic as AlertLogic,
    conditions: row.conditions,
    enabled: row.enabled,
    cooldown_hours: row.cooldownHours,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    last_triggered_at: row.lastTriggeredAt ? row.lastTriggeredAt.toISOString() : null,
  };
}

function mapEventRow(row: typeof schema.alertEvents.$inferSelect): AlertEvent {
  return {
    id: row.id,
    rule_id: row.ruleId,
    rule_label: buildRowLabel(row.metrics, row.logic as AlertLogic),
    target: row.target as AlertTarget,
    code: row.code,
    name: row.name,
    logic: row.logic as AlertLogic,
    metrics: row.metrics,
    hits: row.hits,
    data_source: row.dataSource,
    observed_at: row.observedAt.toISOString(),
    level: row.level as AlertEvent["level"],
    message: row.message,
    email_status: row.emailStatus as AlertEvent["email_status"],
    email_reason: row.emailReason,
    status: row.status as AlertEventStatus,
    created_at: row.createdAt.toISOString(),
  };
}

/** 事件表不存展示文案，读取时用指标中文名与组合方式回填。 */
function buildRowLabel(metrics: AlertMetric[], logic: AlertLogic): string {
  if (metrics.length === 0) {
    return "预警条件";
  }
  return metrics.map((metric) => ALERT_METRIC_LABELS[metric]).join(logic === "and" ? " 且 " : " 或 ");
}

/** 本地文件实现：内存缓存 + JSON 落盘。 */
function createFileRepository(): AlertRepository {
  let shape: AlertFileShape | null = null;

  const ensureLoaded = async (): Promise<AlertFileShape> => {
    shape ??= await loadStoreFile();
    return shape;
  };

  const persist = async (): Promise<void> => {
    await saveStoreFile(shape ?? { rules: [], events: [] });
  };

  const sortRules = (rules: AlertRule[]): AlertRule[] =>
    rules
      .slice()
      .sort((left, right) => left.created_at.localeCompare(right.created_at) || left.code.localeCompare(right.code));

  return {
    async listRules() {
      const current = await ensureLoaded();
      return sortRules(current.rules).map(clone);
    },
    async getRule(id) {
      const current = await ensureLoaded();
      const rule = current.rules.find((item) => item.id === id);
      return rule ? clone(rule) : null;
    },
    async saveRule(rule) {
      const current = await ensureLoaded();
      const index = current.rules.findIndex((item) => item.id === rule.id);
      if (index >= 0) {
        current.rules[index] = clone(rule);
      } else {
        current.rules.push(clone(rule));
      }
      await persist();
    },
    async removeRule(id) {
      const current = await ensureLoaded();
      current.rules = current.rules.filter((item) => item.id !== id);
      await persist();
    },
    async markRuleTriggered(id, at) {
      const current = await ensureLoaded();
      const rule = current.rules.find((item) => item.id === id);
      if (rule) {
        rule.last_triggered_at = at;
        rule.updated_at = at;
        await persist();
      }
    },
    async disableRulesByCode(target, code) {
      const current = await ensureLoaded();
      let changed = false;
      for (const rule of current.rules) {
        if (rule.target === target && rule.code === code && rule.enabled) {
          rule.enabled = false;
          changed = true;
        }
      }
      if (changed) {
        await persist();
      }
    },
    async getEvent(id) {
      const current = await ensureLoaded();
      const event = current.events.find((item) => item.id === id);
      return event ? clone(event) : null;
    },
    async listEvents(query = {}) {
      const current = await ensureLoaded();
      const limit = query.limit && query.limit > 0 ? Math.min(query.limit, 500) : 100;
      return current.events
        .filter((event) => (query.status ? event.status === query.status : true))
        .filter((event) => (query.target ? event.target === query.target : true))
        .filter((event) => (query.code ? event.code === query.code : true))
        .slice()
        .sort((left, right) => right.created_at.localeCompare(left.created_at))
        .slice(0, limit)
        .map(clone);
    },
    async insertEvents(events) {
      const current = await ensureLoaded();
      current.events.push(...events.map(clone));
      await persist();
    },
    async updateEventStatus(id, status) {
      const current = await ensureLoaded();
      const event = current.events.find((item) => item.id === id);
      if (event) {
        event.status = status;
        await persist();
      }
    },
    async removeEvent(id) {
      const current = await ensureLoaded();
      current.events = current.events.filter((item) => item.id !== id);
      await persist();
    },
    async getSettings() {
      const stored = await loadSettingsFile();
      return { ...defaultSettings(), ...stored, email_configured: isEmailConfigured(), max_targets: envMaxTargets() };
    },
    async updateSettings(patch) {
      const current = await this.getSettings();
      const next: AlertSettings = {
        ...current,
        ...(patch.email_to === undefined ? {} : { email_to: patch.email_to }),
        ...(patch.email_enabled === undefined ? {} : { email_enabled: patch.email_enabled }),
        updated_at: new Date().toISOString(),
      };
      await saveSettingsFile(next);
      return next;
    },
  };
}

/** PostgreSQL 实现。 */
function createDrizzleRepository(): AlertRepository {
  const db = getDb();

  return {
    async listRules() {
      const rows = await db.select().from(schema.alertRules).orderBy(asc(schema.alertRules.createdAt));
      return rows.map(mapRuleRow);
    },
    async getRule(id) {
      const rows = await db.select().from(schema.alertRules).where(eq(schema.alertRules.id, id)).limit(1);
      const row = rows[0];
      return row ? mapRuleRow(row) : null;
    },
    async saveRule(rule) {
      await db
        .insert(schema.alertRules)
        .values({
          id: rule.id,
          target: rule.target,
          code: rule.code,
          name: rule.name,
          logic: rule.logic,
          conditions: rule.conditions,
          enabled: rule.enabled,
          cooldownHours: rule.cooldown_hours,
          createdAt: new Date(rule.created_at),
          updatedAt: new Date(rule.updated_at),
          lastTriggeredAt: rule.last_triggered_at ? new Date(rule.last_triggered_at) : null,
        })
        .onConflictDoUpdate({
          target: schema.alertRules.id,
          set: {
            target: rule.target,
            code: rule.code,
            name: rule.name,
            logic: rule.logic,
            conditions: rule.conditions,
            enabled: rule.enabled,
            cooldownHours: rule.cooldown_hours,
            updatedAt: new Date(rule.updated_at),
            lastTriggeredAt: rule.last_triggered_at ? new Date(rule.last_triggered_at) : null,
          },
        });
    },
    async removeRule(id) {
      await db.delete(schema.alertRules).where(eq(schema.alertRules.id, id));
    },
    async markRuleTriggered(id, at) {
      await db
        .update(schema.alertRules)
        .set({ lastTriggeredAt: new Date(at), updatedAt: new Date(at) })
        .where(eq(schema.alertRules.id, id));
    },
    async disableRulesByCode(target, code) {
      await db
        .update(schema.alertRules)
        .set({ enabled: false, updatedAt: new Date() })
        .where(and(eq(schema.alertRules.target, target), eq(schema.alertRules.code, code)));
    },
    async getEvent(id) {
      const rows = await db
        .select()
        .from(schema.alertEvents)
        .where(eq(schema.alertEvents.id, id))
        .limit(1);
      const row = rows[0];
      return row ? mapEventRow(row) : null;
    },
    async listEvents(query = {}) {
      const limit = query.limit && query.limit > 0 ? Math.min(query.limit, 500) : 100;
      const rows = await db
        .select()
        .from(schema.alertEvents)
        .orderBy(desc(schema.alertEvents.createdAt))
        .limit(limit);
      return rows
        .map(mapEventRow)
        .filter((event) => (query.status ? event.status === query.status : true))
        .filter((event) => (query.target ? event.target === query.target : true))
        .filter((event) => (query.code ? event.code === query.code : true));
    },
    async insertEvents(events) {
      if (events.length === 0) {
        return;
      }
      await db.insert(schema.alertEvents).values(
        events.map((event) => ({
          id: event.id,
          ruleId: event.rule_id,
          target: event.target,
          code: event.code,
          name: event.name,
          logic: event.logic,
          metrics: event.metrics,
          hits: event.hits as AlertConditionHit[],
          dataSource: event.data_source,
          observedAt: new Date(event.observed_at),
          level: event.level,
          message: event.message,
          emailStatus: event.email_status,
          emailReason: event.email_reason,
          status: event.status,
          createdAt: new Date(event.created_at),
        })),
      );
    },
    async updateEventStatus(id, status) {
      await db.update(schema.alertEvents).set({ status }).where(eq(schema.alertEvents.id, id));
    },
    async removeEvent(id) {
      await db.delete(schema.alertEvents).where(eq(schema.alertEvents.id, id));
    },
    async getSettings() {
      const stored = await loadSettingsFile();
      return { ...defaultSettings(), ...stored, email_configured: isEmailConfigured(), max_targets: envMaxTargets() };
    },
    async updateSettings(patch) {
      const current = await this.getSettings();
      const next: AlertSettings = {
        ...current,
        ...(patch.email_to === undefined ? {} : { email_to: patch.email_to }),
        ...(patch.email_enabled === undefined ? {} : { email_enabled: patch.email_enabled }),
        updated_at: new Date().toISOString(),
      };
      await saveSettingsFile(next);
      return next;
    },
  };
}

/** 数据库访问失败时自动切换到本地文件实现，避免预警功能整体不可用。 */
function createResilientRepository(): AlertRepository {
  const fallback = createFileRepository();
  let drizzleRepository: AlertRepository | null = null;
  let useFallback = false;

  const run = async <T>(method: keyof AlertRepository, args: unknown[]): Promise<T> => {
    if (useFallback) {
      return (fallback[method] as (...methodArgs: unknown[]) => Promise<T>)(...args);
    }
    try {
      drizzleRepository ??= createDrizzleRepository();
      return await (drizzleRepository[method] as (...methodArgs: unknown[]) => Promise<T>)(...args);
    } catch (error) {
      useFallback = true;
      console.warn("[alerts] PostgreSQL 访问失败，本次运行已切换为本地文件存储：", error);
      return (fallback[method] as (...methodArgs: unknown[]) => Promise<T>)(...args);
    }
  };

  return {
    listRules: () => run("listRules", []),
    getRule: (id) => run("getRule", [id]),
    saveRule: (rule) => run("saveRule", [rule]),
    removeRule: (id) => run("removeRule", [id]),
    markRuleTriggered: (id, at) => run("markRuleTriggered", [id, at]),
    disableRulesByCode: (target, code) => run("disableRulesByCode", [target, code]),
    getEvent: (id) => run("getEvent", [id]),
    listEvents: (query) => run("listEvents", [query ?? {}]),
    insertEvents: (events) => run("insertEvents", [events]),
    updateEventStatus: (id, status) => run("updateEventStatus", [id, status]),
    removeEvent: (id) => run("removeEvent", [id]),
    getSettings: () => run("getSettings", []),
    updateSettings: (patch) => run("updateSettings", [patch]),
  };
}

/** 默认预警仓储单例，供 API 路由与扫描任务统一使用。 */
export const alertRepository: AlertRepository = hasRealDatabaseUrl()
  ? createResilientRepository()
  : createFileRepository();