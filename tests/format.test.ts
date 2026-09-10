// 展示格式化与乱码文本处理回归测试。
import { describe, expect, it } from "vitest";

import {
  formatDateTime,
  freshnessText,
  isUnusableConversationTitle,
  looksGarbledText,
  presentableConversationTitle,
  sanitizeChatText,
  sourceLabel,
} from "@/lib/format";

describe("formatDateTime", () => {
  it("格式化合法时间，非法时间返回占位文案", () => {
    const text = formatDateTime("2024-01-02T03:04:05.000Z");
    expect(text).not.toBe("时间未知");
    expect(text).toContain("2024");
    expect(formatDateTime("not-a-date")).toBe("时间未知");
  });
});

describe("freshnessText", () => {
  it("按时间间隔给出中文新鲜度", () => {
    expect(freshnessText(new Date().toISOString())).toBe("刚刚");
    expect(freshnessText(new Date(Date.now() - 5 * 60_000).toISOString())).toBe("5 分钟前");
    expect(freshnessText(new Date(Date.now() - 2 * 60 * 60_000).toISOString())).toBe("2 小时前");
  });

  it("未来时间或非法时间返回占位文案", () => {
    expect(freshnessText(new Date(Date.now() + 60_000).toISOString())).toBe("时间未知");
    expect(freshnessText("not-a-date")).toBe("时间未知");
  });
});

describe("sourceLabel", () => {
  it("已知来源转换为中文文案", () => {
    expect(sourceLabel("akshare")).toBe("AkShare 实时行情");
    expect(sourceLabel("tencent")).toBe("腾讯实时行情");
    expect(sourceLabel("deterministic-fallback")).toBe("确定性降级数据");
  });

  it("未知来源原样返回", () => {
    expect(sourceLabel("local")).toBe("local");
  });
});

describe("乱码处理", () => {
  it("识别典型乱码文本", () => {
    expect(looksGarbledText("")).toBe(false);
    expect(looksGarbledText("贵州茅台")).toBe(false);
    expect(looksGarbledText("å›½å†…æ–°é—»")).toBe(true);
    expect(looksGarbledText("??")).toBe(false);
    expect(looksGarbledText("???")).toBe(true);
  });

  it("乱码消息统一替换为占位文案", () => {
    expect(sanitizeChatText("正常内容")).toBe("正常内容");
    expect(sanitizeChatText("å›½å†…æ–°é—»")).toBe("本条消息内容存在乱码，已隐藏。");
  });

  it("判断会话标题是否可展示", () => {
    expect(isUnusableConversationTitle("")).toBe(false);
    expect(isUnusableConversationTitle("   ")).toBe(false);
    expect(isUnusableConversationTitle("test 一下")).toBe(true);
    expect(isUnusableConversationTitle("测试")).toBe(true);
    expect(isUnusableConversationTitle("demo")).toBe(true);
    expect(isUnusableConversationTitle("贵州茅台 · 7 天分析")).toBe(false);
  });

  it("不可用标题替换为历史会话", () => {
    expect(presentableConversationTitle("调试")).toBe("历史会话");
    expect(presentableConversationTitle("贵州茅台分析")).toBe("贵州茅台分析");
  });
});