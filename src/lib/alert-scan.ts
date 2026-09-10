// 预警扫描：采集观测值 → 判定 → 写入事件 → 发送摘要邮件。
// 定时任务与手动"立即评估"共用本模块，保证两条路径口径一致。
import { sendAlertDigest } from "@/lib/alert-email";
import { alertRepository } from "@/lib/alert-store";
import { buildAlertEvent, evaluateAlertRule, isCooldownPassed, isTradingSession } from "@/lib/alerts";
import { getFundNav } from "@/lib/fund-data";
import { getFundMetrics } from "@/lib/fund-metrics";
import { getMarketQuote } from "@/lib/market-data";
import type {
  AlertEmailStatus,
  AlertEvent,
  AlertObservation,
  AlertRule,
  AlertScanResult,
} from "@/lib/shared/types";

/** 采集单个标的的观测值：股票取行情快照，基金取净值与风险指标。 */
export async function collectAlertObservations(
  rule: AlertRule,
  now: Date = new Date(),
): Promise<AlertObservation[]> {
  if (rule.target === "stock") {
    const quote = await getMarketQuote(rule.code, false);
    const observedAt = quote.fetched_at || quote.ts || now.toISOString();
    return [
      { metric: "change_pct", value: quote.change_pct, source: quote.source, observed_at: observedAt },
      { metric: "price", value: quote.price, source: quote.source, observed_at: observedAt },
    ];
  }

  const observations: AlertObservation[] = [];
  const nav = await getFundNav(rule.code, "1y", "unit");
  const latest = nav.at(-1);
  if (latest) {
    observations.push({
      metric: "unit_nav",
      value: latest.unit_nav,
      source: latest.source,
      observed_at: latest.fetched_at || now.toISOString(),
    });
    if (typeof latest.daily_change_pct === "number") {
      observations.push({
        metric: "nav_change_pct",
        value: latest.daily_change_pct,
        source: latest.source,
        observed_at: latest.fetched_at || now.toISOString(),
      });
    }
  }

  const metrics = await getFundMetrics(rule.code, "1y");
  if (metrics) {
    const source = latest?.source ?? "本地计算";
    observations.push({
      metric: "drawdown_pct",
      value: metrics.max_drawdown_pct,
      source,
      observed_at: metrics.updated_at,
    });
    observations.push({
      metric: "current_drawdown_pct",
      value: metrics.current_drawdown_pct,
      source,
      observed_at: metrics.updated_at,
    });
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

  const rules = await alertRepository.listRules();
  for (const rule of rules) {
    if (!rule.enabled) {
      continue;
    }
    scannedRules += 1;

    // 先做时段与冷却的轻量判断，避免无谓的外部数据请求。
    const session = isTradingSession(rule.target, now);
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
      const decision = evaluateAlertRule(rule, observations, now);
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
    duration_ms: Date.now() - startedAt,
  };
}