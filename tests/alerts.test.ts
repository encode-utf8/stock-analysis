// 预警判定引擎回归测试：有效时段、条件组合、冷却期、降级数据与邮件文案。
import { describe, expect, it } from "vitest";

import { alertObservation, alertRule } from "./helpers/fixtures";

import { buildAlertDigest } from "@/lib/alert-email";
import {
  parseAlertConditions,
  parseAlertLogic,
  parseAlertTarget,
  parseCooldownHours,
} from "@/lib/alert-input";
import {
  FALLBACK_SOURCE,
  buildAlertEvent,
  buildAlertMessage,
  compareAlertCondition,
  evaluateAlertRule,
  isCooldownPassed,
  isTradingSession,
  validateAlertRuleInput,
} from "@/lib/alerts";
import { ALERT_DEFAULT_COOLDOWN_HOURS, formatAlertCondition } from "@/lib/shared/types";

const TRADING_DAY = "2024-03-05"; // 周二
const WEEKEND = "2024-03-09"; // 周六

/** 按北京时间构造时刻，避免测试依赖运行环境时区。 */
function beijingTime(date: string, hour: number, minute = 0): Date {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, hour - 8, minute));
}

describe("isTradingSession", () => {
  it("股票仅在盘中时段生效", () => {
    expect(isTradingSession("stock", beijingTime(TRADING_DAY, 10)).active).toBe(true);
    expect(isTradingSession("stock", beijingTime(TRADING_DAY, 9, 30)).active).toBe(true);
    expect(isTradingSession("stock", beijingTime(TRADING_DAY, 15)).active).toBe(true);
    expect(isTradingSession("stock", beijingTime(TRADING_DAY, 12)).active).toBe(false);
    expect(isTradingSession("stock", beijingTime(TRADING_DAY, 15, 1)).active).toBe(false);
    expect(isTradingSession("stock", beijingTime(TRADING_DAY, 9)).active).toBe(false);
  });

  it("周末不触发任何标的", () => {
    expect(isTradingSession("stock", beijingTime(WEEKEND, 10)).active).toBe(false);
    expect(isTradingSession("fund", beijingTime(WEEKEND, 20)).active).toBe(false);
  });

  it("基金在盘中与工作日收盘后均可评估", () => {
    expect(isTradingSession("fund", beijingTime(TRADING_DAY, 10)).active).toBe(true);
    expect(isTradingSession("fund", beijingTime(TRADING_DAY, 16)).active).toBe(true);
    expect(isTradingSession("fund", beijingTime(TRADING_DAY, 23, 59)).active).toBe(true);
    expect(isTradingSession("fund", beijingTime(TRADING_DAY, 12)).active).toBe(false);
    expect(isTradingSession("fund", beijingTime(TRADING_DAY, 9)).active).toBe(false);
  });
});

describe("isCooldownPassed", () => {
  const now = beijingTime(TRADING_DAY, 10);

  it("从未触发过时视为已过冷却", () => {
    expect(isCooldownPassed(alertRule({ last_triggered_at: null }), now)).toBe(true);
  });

  it("冷却期边界为 12 小时，等于 12 小时视为已过", () => {
    const exact = new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString();
    const justInside = new Date(now.getTime() - 12 * 60 * 60 * 1000 + 60 * 1000).toISOString();
    expect(isCooldownPassed(alertRule({ last_triggered_at: exact }), now)).toBe(true);
    expect(isCooldownPassed(alertRule({ last_triggered_at: justInside }), now)).toBe(false);
  });

  it("非法冷却配置回落默认 12 小时", () => {
    const last = new Date(now.getTime() - 11 * 60 * 60 * 1000).toISOString();
    expect(isCooldownPassed(alertRule({ last_triggered_at: last, cooldown_hours: 0 }), now)).toBe(false);
    expect(ALERT_DEFAULT_COOLDOWN_HOURS).toBe(12);
  });
});

describe("compareAlertCondition", () => {
  it("大于等于与小于等于都包含阈值边界", () => {
    expect(compareAlertCondition({ metric: "change_pct", operator: "gte", threshold: 3 }, 3)).toBe(true);
    expect(compareAlertCondition({ metric: "change_pct", operator: "lte", threshold: -3 }, -3)).toBe(true);
    expect(compareAlertCondition({ metric: "change_pct", operator: "gte", threshold: 3 }, 2.99)).toBe(false);
    expect(compareAlertCondition({ metric: "change_pct", operator: "lte", threshold: -3 }, -2.99)).toBe(false);
  });
});

describe("validateAlertRuleInput", () => {
  const conditions = [{ metric: "change_pct" as const, operator: "lte" as const, threshold: -3 }];

  it("条件数量必须在 1-4 之间", () => {
    expect(validateAlertRuleInput({ target: "stock", logic: "and", conditions: [] }).ok).toBe(false);
    expect(
      validateAlertRuleInput({
        target: "stock",
        logic: "and",
        conditions: [1, 2, 3, 4, 5].map(() => conditions[0]),
      }).ok,
    ).toBe(false);
    expect(validateAlertRuleInput({ target: "stock", logic: "and", conditions }).ok).toBe(true);
  });

  it("指标必须与标的类型匹配", () => {
    expect(
      validateAlertRuleInput({
        target: "stock",
        logic: "and",
        conditions: [{ metric: "unit_nav", operator: "lte", threshold: 1 }],
      }).ok,
    ).toBe(false);
  });

  it("阈值必须是有效数字", () => {
    expect(
      validateAlertRuleInput({
        target: "stock",
        logic: "and",
        conditions: [{ metric: "change_pct", operator: "lte", threshold: Number.NaN }],
      }).ok,
    ).toBe(false);
  });
});

describe("evaluateAlertRule", () => {
  const morning = beijingTime(TRADING_DAY, 10);
  const stockObservations = [alertObservation("change_pct", -4), alertObservation("price", 1680)];

  it("停用规则直接跳过", () => {
    const decision = evaluateAlertRule(alertRule({ enabled: false }), stockObservations, morning);
    expect(decision.triggered).toBe(false);
    expect(decision.reason).toBe("规则已停用");
  });

  it("非交易时段不触发", () => {
    const decision = evaluateAlertRule(alertRule(), stockObservations, beijingTime(TRADING_DAY, 12));
    expect(decision.triggered).toBe(false);
    expect(decision.reason).toContain("非股票交易时段");
  });

  it("缺少指标观测值时给出明确原因", () => {
    const decision = evaluateAlertRule(alertRule(), [alertObservation("price", 1680)], morning);
    expect(decision.triggered).toBe(false);
    expect(decision.reason).toContain("当日涨跌幅");
  });

  it("降级数据一律跳过", () => {
    const decision = evaluateAlertRule(
      alertRule(),
      stockObservations.map((item) => ({ ...item, source: FALLBACK_SOURCE })),
      morning,
    );
    expect(decision.triggered).toBe(false);
    expect(decision.reason).toContain("降级");
  });

  it("冷却期内不重复触发", () => {
    const decision = evaluateAlertRule(
      alertRule({ last_triggered_at: new Date(morning.getTime() - 60 * 60 * 1000).toISOString() }),
      stockObservations,
      morning,
    );
    expect(decision.triggered).toBe(false);
    expect(decision.reason).toContain("12 小时冷却期");
  });

  it("AND 组合需要全部条件命中", () => {
    const both = [alertObservation("change_pct", -4), alertObservation("price", 10)];
    expect(
      evaluateAlertRule(
        alertRule({ conditions: [{ metric: "change_pct", operator: "lte", threshold: -3 }, { metric: "price", operator: "lte", threshold: 20 }] }),
        both,
        morning,
      ).matched,
    ).toBe("all");

    const onlyOne = [alertObservation("change_pct", -4), alertObservation("price", 30)];
    const decision = evaluateAlertRule(
      alertRule({ conditions: [{ metric: "change_pct", operator: "lte", threshold: -3 }, { metric: "price", operator: "lte", threshold: 20 }] }),
      onlyOne,
      morning,
    );
    expect(decision.triggered).toBe(false);
    expect(decision.reason).toBe("未达到触发条件");
  });

  it("OR 组合任一命中即触发", () => {
    const decision = evaluateAlertRule(
      alertRule({
        logic: "or",
        conditions: [{ metric: "change_pct", operator: "lte", threshold: -9 }, { metric: "price", operator: "lte", threshold: 1700 }],
      }),
      stockObservations,
      morning,
    );
    expect(decision.triggered).toBe(true);
    expect(decision.matched).toBe("any");
  });

  it("等于阈值按命中处理", () => {
    const decision = evaluateAlertRule(
      alertRule({
        conditions: [{ metric: "price", operator: "lte", threshold: 1680 }],
      }),
      stockObservations,
      morning,
    );
    expect(decision.triggered).toBe(true);
    expect(decision.hits[0].matched).toBe(true);
  });
});

describe("事件与邮件文案", () => {
  const morning = beijingTime(TRADING_DAY, 10);
  const observations = [alertObservation("change_pct", -4.2), alertObservation("price", 1680)];
  const decision = evaluateAlertRule(alertRule(), observations, morning);

  it("格式化条件与触发文案", () => {
    expect(formatAlertCondition({ metric: "change_pct", operator: "lte", threshold: -3 })).toBe("当日涨跌幅 ≤ -3%");
    expect(buildAlertMessage(alertRule(), decision)).toContain("600519 贵州茅台 触发预警");
    expect(buildAlertMessage(alertRule(), decision)).toContain("当日涨跌幅 -4.2");
  });

  it("事件固化观测值、来源与初始邮件状态", () => {
    const event = buildAlertEvent(alertRule(), decision, observations, morning);
    expect(event.id.startsWith("alert-")).toBe(true);
    expect(event.rule_label).toBe("当日涨跌幅 ≤ -3%");
    expect(event.metrics).toEqual(["change_pct"]);
    expect(event.data_source).toBe("akshare");
    expect(event.observed_at).toBe(observations[0].observed_at);
    expect(event.email_status).toBe("skipped");
    expect(event.status).toBe("unread");
  });

  it("摘要邮件包含条数、明细与免责声明", () => {
    const event = buildAlertEvent(alertRule(), decision, observations, morning);
    const { subject, text } = buildAlertDigest([event], morning);
    expect(subject).toContain("1 条预警触发");
    expect(text).toContain("600519 贵州茅台");
    expect(text).toContain("当日涨跌幅 ≤ -3%（当前 -4.2）");
    expect(text).toContain("数据来源：akshare");
    expect(text).toContain("不构成投资建议");
  });
});

describe("请求解析", () => {
  it("只接受合法的标的与组合方式", () => {
    expect(parseAlertTarget("stock")).toBe("stock");
    expect(parseAlertTarget("fund")).toBe("fund");
    expect(parseAlertTarget("bond")).toBeNull();
    expect(parseAlertLogic("and")).toBe("and");
    expect(parseAlertLogic("or")).toBe("or");
    expect(parseAlertLogic("xor")).toBeNull();
  });

  it("条件解析校验数量、指标与阈值", () => {
    expect(parseAlertConditions([]).ok).toBe(false);
    expect(parseAlertConditions([{ metric: "unknown", operator: "lte", threshold: 1 }]).ok).toBe(false);
    expect(parseAlertConditions([{ metric: "change_pct", operator: "eq", threshold: 1 }]).ok).toBe(false);
    expect(parseAlertConditions([{ metric: "change_pct", operator: "lte", threshold: "abc" }]).ok).toBe(false);

    const parsed = parseAlertConditions([{ metric: "price", operator: "lte", threshold: "1680" }]);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.conditions[0].threshold).toBe(1680);
    }
  });

  it("冷却小时数非法时回落默认值", () => {
    expect(parseCooldownHours(undefined)).toBe(12);
    expect(parseCooldownHours("abc")).toBe(12);
    expect(parseCooldownHours(-1)).toBe(12);
    expect(parseCooldownHours("6")).toBe(6);
  });
});