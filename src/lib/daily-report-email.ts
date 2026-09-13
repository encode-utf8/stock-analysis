// 日报摘要邮件：复用预警中心的 SMTP 通道，未配置或发送失败都不影响日报落库与列表展示。
import { sendPlainMail } from "@/lib/alert-email";
import type { AlertEmailResult } from "@/lib/alert-email";
import type { DailyReport } from "@/lib/shared/types";

/** 日报推送收件人：优先 DAILY_REPORT_EMAIL_TO，其次复用预警中心的 ALERT_EMAIL_TO。 */
export function dailyReportRecipient(): string | null {
  const raw = process.env.DAILY_REPORT_EMAIL_TO ?? process.env.ALERT_EMAIL_TO ?? "";
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** 带符号百分比，缺失时显示占位符；本地实现避免与 daily-report 模块循环依赖。 */
function formatPct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

/** 构造日报摘要邮件内容；纯函数，便于单测。 */
export function buildDailyReportDigest(report: DailyReport): { subject: string; text: string } {
  const label = report.kind === "stock" ? "股市日报" : "基金日报";
  const generatedText = report.source === "deepseek" ? "AI 生成" : "模板降级";
  // 标题过长会影响邮件客户端展示，这里截断到 80 字符。
  const brief = report.headline.length > 80 ? `${report.headline.slice(0, 80)}…` : report.headline;
  const subject = `【AI ${label}】${report.date} ${brief}`;

  const lines: string[] = [`${report.date} ${label}（${generatedText}）`, "", `摘要：${report.headline}`, ""];

  if (report.metrics.length > 0) {
    lines.push("关键指标：");
    for (const metric of report.metrics) {
      const changeText = metric.change_pct === null ? "" : `（${formatPct(metric.change_pct)}）`;
      lines.push(`- ${metric.label}：${metric.value}${changeText}`);
    }
    lines.push("");
  }

  if (report.data.missing.length > 0) {
    lines.push(`数据缺失：${report.data.missing.join("；")}`, "");
  }

  lines.push(report.markdown, "");
  lines.push("说明：本邮件由本地学习工具自动生成，仅用于学习参考，不构成任何投资建议。");

  return { subject, text: lines.join("\n") };
}

/** 发送日报摘要邮件；未配置收件人或 SMTP 时返回 skipped。 */
export async function sendDailyReportDigest(report: DailyReport): Promise<AlertEmailResult> {
  const to = dailyReportRecipient();
  if (!to) {
    return {
      status: "skipped",
      reason: "未配置 DAILY_REPORT_EMAIL_TO 或 ALERT_EMAIL_TO，已跳过日报邮件推送。",
    };
  }
  const { subject, text } = buildDailyReportDigest(report);
  return sendPlainMail({ to, subject, text });
}
