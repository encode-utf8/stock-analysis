// 预警邮件通道：SMTP 参数只从本地 .env 读取，未配置时静默跳过，不影响事件入库。
import nodemailer from "nodemailer";

import { formatAlertCondition } from "@/lib/shared/types";
import type { AlertEmailStatus, AlertEvent } from "@/lib/shared/types";

/** 邮件发送结果。 */
export interface AlertEmailResult {
  status: AlertEmailStatus;
  reason: string | null;
}

interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  secure: boolean;
}

/** 读取 SMTP 配置；缺少任一必需项时返回 null。 */
function readSmtpConfig(): SmtpConfig | null {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  const from = process.env.SMTP_FROM?.trim() || user;
  const port = Number(process.env.SMTP_PORT ?? 465);

  if (!host || !user || !pass || !from || !Number.isFinite(port) || port <= 0) {
    return null;
  }

  return { host, port, user, pass, from, secure: port === 465 };
}

/** 判断邮件通道是否已配置（供设置接口与面板展示）。 */
export function isEmailConfigured(): boolean {
  return readSmtpConfig() !== null;
}

/** 格式化时间为本地可读文案。 */
function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

/** 生成预警摘要邮件；纯函数，便于单测。 */
export function buildAlertDigest(
  events: AlertEvent[],
  now = new Date(),
): { subject: string; text: string } {
  const stamp = now.toLocaleString("zh-CN", { hour12: false });
  const subject = `【预警中心】${events.length} 条预警触发（${stamp}）`;
  const lines: string[] = [
    `共 ${events.length} 条预警触发，明细如下：`,
    "",
  ];

  for (const event of events) {
    const conditionText = event.hits
      .map((hit) => `${formatAlertCondition({ metric: hit.metric, operator: hit.operator, threshold: hit.threshold })}（当前 ${hit.value}）`)
      .join(event.logic === "and" ? " 且 " : " 或 ");
    lines.push(`- ${event.code} ${event.name}：${conditionText}`);
    lines.push(`  数据来源：${event.data_source}，观测时间：${formatTime(event.observed_at)}`);
  }

  lines.push("");
  lines.push("说明：本邮件基于最近一次数据快照生成，非实时行情；仅用于学习与观察，不构成投资建议。");

  return { subject, text: lines.join("\n") };
}

/** 发送预警摘要邮件。 */
export async function sendAlertDigest(
  events: AlertEvent[],
  to: string | null,
): Promise<AlertEmailResult> {
  const config = readSmtpConfig();
  if (!config) {
    return { status: "skipped", reason: "未配置 SMTP 环境变量，已跳过邮件推送。" };
  }
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return { status: "skipped", reason: "未设置有效的收件邮箱，已跳过邮件推送。" };
  }
  if (events.length === 0) {
    return { status: "skipped", reason: "本次没有需要发送的预警。" };
  }

  try {
    const { subject, text } = buildAlertDigest(events);
    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: { user: config.user, pass: config.pass },
    });
    await transporter.sendMail({ from: config.from, to, subject, text });
    return { status: "sent", reason: null };
  } catch (error) {
    return {
      status: "failed",
      reason: error instanceof Error ? error.message : "邮件发送失败",
    };
  }
}

/** 发送测试邮件，用于验证通道配置。 */
export async function sendTestEmail(to: string | null): Promise<AlertEmailResult> {
  const config = readSmtpConfig();
  if (!config) {
    return { status: "skipped", reason: "未配置 SMTP 环境变量，无法发送测试邮件。" };
  }
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return { status: "skipped", reason: "请先填写有效的收件邮箱。" };
  }

  try {
    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: { user: config.user, pass: config.pass },
    });
    await transporter.sendMail({
      from: config.from,
      to,
      subject: "【预警中心】邮件通道测试",
      text: [
        "这是一封测试邮件，用于验证预警中心的 SMTP 配置。",
        "",
        "收到此邮件说明配置正确；后续触发预警时将发送同类摘要邮件。",
        "说明：预警基于最近一次数据快照，非实时行情；仅用于学习与观察，不构成投资建议。",
      ].join("\n"),
    });
    return { status: "sent", reason: null };
  } catch (error) {
    return {
      status: "failed",
      reason: error instanceof Error ? error.message : "测试邮件发送失败",
    };
  }
}