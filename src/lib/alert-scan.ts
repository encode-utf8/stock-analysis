// 预警扫描：采集观测值 → 判定 → 写入事件 → 发送摘要邮件。
// 定时任务与手动"立即评估"共用本模块，保证两条路径口径一致。
import { sendAlertDigest } from "@/lib/alert-email";
import { alertRepository } from "@/lib/alert-store";
import { buildAlertEvent, evaluateAlertRule, isCooldownPassed, isTradingSession } from "@/lib/alerts";
import { getFundNav } from "@/lib/fund-data";
import { getFundIntraday } from "@/lib/fund-intraday";
import { getFundMetrics } from "@/lib/fund-metrics";
import { getMarketQuote } from "@/lib/market-data";
import { getTradingCalendar } from "@/lib/trading-calendar";
import type {
  AlertEmailStatus,
  AlertEvent,
  AlertMetric,
  AlertObservation,
  AlertRule,
  AlertScanResult,
} from "@/lib/shared/types";

/**
 * 采集单个标的的观测值。
 * 只采集规则真正引用的指标，避免为了一个条件去拉整段净值历史。
 */
export async function collectAlertObservations(
  rule: AlertRule,
  now: Date = new Date(),
): Promise<AlertObservation[]> {
  const needed = new Set<AlertMetric>(rule.conditions.map((condition) => condition.metric));

  if (rule.target === "stock") {
    const quote = await getMarketQuote(rule.code, false);
    const observedAt = quote.fetched_at || quote.ts || now.toISOString();
    const observations: AlertObservation[] = [];
    if (needed.has("change_pct")) {
      observations.push({
        metric: "change_pct",
        value: quote.change_pct,
        source: quote.source,
        observed_at: observedAt,
      });
    }
    if (needed.has("price")) {
      observations.push({
        metric: "price",
        value: quote.price,
        source: quote.source,
        observed_at: observedAt,
      });
    }
    return observations;
  }

  const observations: AlertObservation[] = [];

  // 盘中估算：场内取实时价与 IOPV，场外取盘中估算净值，这是盘中监控的主要口径。
  if (needed.has("estimate_nav") || needed.has("estimate_change_pct")) {
    const intraday = await getFundIntraday(rule.code, false);
    const observedAt = intraday.fetched_at || intraday.ts || now.toISOString();
    if (needed.has("estimate_nav") && typeof intraday.estimated_nav === "number") {
      observations.push({
        metric: "estimate_nav",
        value: intraday.estimated_nav,
        source: intraday.source,
        observed_at: observedAt,
      });
    }
    if (needed.has("estimate_change_pct") && typeof intraday.change_pct === "number") {
      observations.push({
        metric: "estimate_change_pct",
        value: intraday.change_pct,
        source: intraday.source,
        observed_at: observedAt,
      });
    }
  }

  // 公布净值：既服务于净值类条件，也用于判断回撤数据的来源健康度。
  const needsNav =
    needed.has("unit_nav") ||
    needed.has("nav_change_pct") ||
    needed.has("drawdown_pct") ||
    needed.has("current_drawdown_pct");
  let navSource: string | null = null;
  if (needsNav) {
    const nav = await getFundNav(rule.code, "1m", "unit");
    const latest = nav.at(-1);
    if (latest) {
      navSource = latest.source;
      const observedAt = latest.fetched_at || now.toISOString();
      if (needed.has("unit_nav")) {
        observations.push({
          metric: "unit_nav",
          value: latest.unit_nav,
          source: latest.source,
          observed_at: observedAt,
        });
      }
      if (needed.has("nav_change_pct") && typeof latest.daily_change_pct === "number") {
        observations.push({
          metric: "nav_change_pct",
          value: latest.daily_change_pct,
          source: latest.source,
          observed_at: observedAt,
        });
      }
    }
  }

  if (needed.has("drawdown_pct") || needed.has("current_drawdown_pct")) {
    const metrics = await getFundMetrics(rule.code, "1y");
    if (metrics) {
      // 回撤由本地净值历史算出，来源沿用净值来源，降级数据会被判定引擎过滤。
      const source = navSource ?? "本地计算";
      if (needed.has("drawdown_pct")) {
        observations.push({
          metric: "drawdown_pct",
          value: metrics.max_drawdown_pct,
          source,
          observed_at: metrics.updated_at,
        });
      }
      if (needed.has("current_drawdown_pct")) {
        observations.push({
          metric: "current_drawdown_pct",
          value: metrics.current_drawdown_pct,
          source,
          observed_at: metrics.updated_at,
        });
      }
    }
  }

  return observations;
}

export interface AlertScanOptions {
  dryRun?: boolean;
  now?: Date;
}

function pushReason(reasons: string[], reason: string): void {
  if (reason && !reasons.includes(reason)) {
    reasons.push(reason);
  }
}

/** 执行一次预警扫描；dryRun 时只计算不入库、不发邮件。 */
export async function runAlertScan(options: AlertScanOptions = {}): Promise<AlertScanResult> {
  const now = options.now ?? new Date();
  const startedAt = Date.now();
  const skippedReasons: string[] = [];
  const events: AlertEvent[] = [];
  const triggeredRuleIds: string[] = [];
  const targets = new Set<string>();
  let scannedRules = 0;

  // 交易日历只取一次，本次扫描内所有规则共用同一份判断依据。
  const calendar = await getTradingCalendar();

  const rules = await alertRepository.listRules();
  for (const rule of rules) {
    if (!rule.enabled) {
      continue;
    }
    scannedRules += 1;

    // 先做交易日/时段与冷却的轻量判断，避免无谓的外部数据请求。
    const session = isTradingSession(rule.target, now, calendar);
    if (!session.active) {
      pushReason(skippedReasons, session.reason);
      continue;
    }
    if (!isCooldownPassed(rule, now)) {
      pushReason(skippedReasons, `处于 ${rule.cooldown_hours} 小时冷却期内`);
      continue;
    }

    targets.add(`${rule.target}:${rule.code}`);

    try {
      const observations = await collectAlertObservations(rule, now);
      const decision = evaluateAlertRule(rule, observations, now, calendar);
      if (decision.triggered) {
        events.push(buildAlertEvent(rule, decision, observations, now));
        triggeredRuleIds.push(rule.id);
      } else {
        pushReason(skippedReasons, decision.reason);
      }
    } catch (error) {
      pushReason(skippedReasons, error instanceof Error ? error.message : "采集观测值失败");
    }
  }

  let emailStatus: AlertEmailStatus = "skipped";
  let emailReason: string | null = "本次没有触发预警";
  if (events.length > 0 && options.dryRun) {
    emailReason = "演练模式未发送邮件";
  } else if (events.length > 0) {
    const settings = await alertRepository.getSettings();
    if (!settings.email_enabled) {
      emailReason = "邮件推送已关闭";
    } else {
      const result = await sendAlertDigest(events, settings.email_to);
      emailStatus = result.status;
      emailReason = result.reason;
    }
  }
  for (const event of events) {
    event.email_status = emailStatus;
    event.email_reason = emailReason;
  }

  if (!options.dryRun && events.length > 0) {
    await alertRepository.insertEvents(events);
    for (const id of triggeredRuleIds) {
      await alertRepository.markRuleTriggered(id, now.toISOString());
    }
  }

  return {
    scanned_targets: targets.size,
    scanned_rules: scannedRules,
    triggered_count: events.length,
    skipped_count: skippedReasons.length,
    skipped_reasons: skippedReasons.slice(0, 5),
    email_status: emailStatus,
    email_reason: emailReason,
    trading_day_source: calendar.source,
    duration_ms: Date.now() - startedAt,
  };
}