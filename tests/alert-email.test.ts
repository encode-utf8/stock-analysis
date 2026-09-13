// 邮件通道测试：摘要文案、SMTP 配置判定与「未配置/非法收件人」跳过分支。
// 只覆盖不真正发信的分支，避免单测依赖外部 SMTP。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildAlertDigest,
  isEmailConfigured,
  sendAlertDigest,
  sendPlainMail,
  sendTestEmail,
} from "@/lib/alert-email";
import type { AlertEvent } from "@/lib/shared/types";

const SMTP_KEYS = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"] as const;

/** 构造一条触发事件：单条件「当日涨跌幅 ≤ -3%」。 */
function alertEvent(overrides: Partial<AlertEvent> = {}): AlertEvent {
  return {
    id: "event-1",
    rule_id: "rule-1",
    rule_label: "茅台大跌",
    target: "stock",
    code: "600519",
    name: "贵州茅台",
    logic: "and",
    metrics: ["change_pct"],
    hits: [{ metric: "change_pct", operator: "lte", threshold: -3, value: -4.2, matched: true }],
    data_source: "tencent",
    observed_at: "2026-09-11T07:00:00.000Z",
    level: "warn",
    message: "贵州茅台当日涨跌幅 -4.2%",
    email_status: "skipped",
    email_reason: null,
    status: "unread",
    created_at: "2026-09-11T07:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  for (const key of SMTP_KEYS) {
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of SMTP_KEYS) {
    delete process.env[key];
  }
  vi.restoreAllMocks();
});

describe("预警摘要文案", () => {
  it("主题包含条数，正文包含条件、数据来源与免责声明", () => {
    const { subject, text } = buildAlertDigest(
      [alertEvent(), alertEvent({ id: "event-2", code: "510300", name: "沪深300ETF", logic: "or" })],
      new Date("2026-09-11T08:00:00.000Z"),
    );

    expect(subject).toContain("【预警中心】2 条预警触发");
    expect(text).toContain("共 2 条预警触发");
    expect(text).toContain("600519 贵州茅台");
    expect(text).toContain("当前 -4.2");
    expect(text).toContain("数据来源：tencent");
    expect(text).toContain("不构成投资建议");
  });

  it("多条件按 logic 连接", () => {
    const event = alertEvent({
      logic: "and",
      hits: [
        { metric: "change_pct", operator: "lte", threshold: -3, value: -4.2, matched: true },
        { metric: "price", operator: "gte", threshold: 1500, value: 1500, matched: true },
      ],
    });
    const { text } = buildAlertDigest([event]);
    expect(text).toContain(" 且 ");
  });
});

describe("SMTP 配置判定", () => {
  it("缺少任一必需项都视为未配置", () => {
    expect(isEmailConfigured()).toBe(false);
    process.env.SMTP_HOST = "smtp.qq.com";
    process.env.SMTP_USER = "user@qq.com";
    expect(isEmailConfigured()).toBe(false);
  });

  it("端口非法同样视为未配置", () => {
    process.env.SMTP_HOST = "smtp.qq.com";
    process.env.SMTP_USER = "user@qq.com";
    process.env.SMTP_PASS = "auth-code";
    process.env.SMTP_PORT = "abc";
    expect(isEmailConfigured()).toBe(false);
  });

  it("必需项齐全时视为已配置，缺省 from 用账号兜底", () => {
    process.env.SMTP_HOST = "smtp.qq.com";
    process.env.SMTP_USER = "user@qq.com";
    process.env.SMTP_PASS = "auth-code";
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_FROM;
    expect(isEmailConfigured()).toBe(true);
  });
});

describe("跳过分支", () => {
  it("未配置 SMTP 时发送返回 skipped", async () => {
    const result = await sendPlainMail({
      to: "someone@example.com",
      subject: "主题",
      text: "正文",
    });
    expect(result).toMatchObject({ status: "skipped" });
    expect(result.reason).toContain("未配置 SMTP");
  });

  it("SMTP 已配置但收件人非法时返回 skipped", async () => {
    process.env.SMTP_HOST = "smtp.qq.com";
    process.env.SMTP_USER = "user@qq.com";
    process.env.SMTP_PASS = "auth-code";

    const result = await sendPlainMail({ to: "not-an-email", subject: "主题", text: "正文" });
    expect(result).toMatchObject({ status: "skipped" });
    expect(result.reason).toContain("收件邮箱");
  });

  it("空事件列表不发信", async () => {
    const result = await sendAlertDigest([], "someone@example.com");
    expect(result).toMatchObject({ status: "skipped", reason: "本次没有需要发送的预警。" });
  });

  it("测试邮件在未配置通道时返回 skipped", async () => {
    await expect(sendTestEmail("someone@example.com")).resolves.toMatchObject({
      status: "skipped",
    });
  });
});
