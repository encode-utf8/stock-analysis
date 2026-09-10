// 基金代码校验与类型识别回归测试。
import { describe, expect, it } from "vitest";

import {
  DEFAULT_FUND_CODE,
  classifyFundTradingMode,
  classifyFundType,
  normalizeFundCode,
  resolveFundProfile,
} from "@/lib/fund-market";

describe("normalizeFundCode", () => {
  it("接受 6 位数字代码并去除空格", () => {
    expect(normalizeFundCode("510300")).toBe("510300");
    expect(normalizeFundCode(" 110022 ")).toBe("110022");
  });

  it("拒绝非 6 位数字代码", () => {
    expect(normalizeFundCode("51030")).toBeNull();
    expect(normalizeFundCode("5103000")).toBeNull();
    expect(normalizeFundCode("51030a")).toBeNull();
    expect(normalizeFundCode("")).toBeNull();
  });
});

describe("classifyFundType", () => {
  it("已知基金按本地档案识别", () => {
    expect(classifyFundType("510300")).toBe("index");
    expect(classifyFundType("161725")).toBe("index");
    expect(classifyFundType("003376")).toBe("bond");
    expect(classifyFundType("110022")).toBe("stock");
  });

  it("未知基金按类型文案识别", () => {
    expect(classifyFundType("999999", "债券型")).toBe("bond");
    expect(classifyFundType("999999", "指数型")).toBe("index");
    expect(classifyFundType("999999", "混合型")).toBe("hybrid");
    expect(classifyFundType("999999", "股票型")).toBe("stock");
    expect(classifyFundType("999999", "QDII")).toBe("qdii");
    expect(classifyFundType("999999", "FOF")).toBe("fof");
    expect(classifyFundType("999999", "REITs")).toBe("reits");
  });

  it("无文案时按代码前缀或兜底为其他", () => {
    expect(classifyFundType("159915")).toBe("index");
    expect(classifyFundType("512880")).toBe("index");
    expect(classifyFundType("123456")).toBe("other");
  });
});

describe("classifyFundTradingMode", () => {
  it("已知基金与场内代码前缀识别为场内交易", () => {
    expect(classifyFundTradingMode("510300")).toBe("exchange");
    expect(classifyFundTradingMode("160123")).toBe("exchange");
  });

  it("其余代码按场外申赎处理", () => {
    expect(classifyFundTradingMode("110022")).toBe("otc");
    expect(classifyFundTradingMode("040001")).toBe("otc");
    expect(classifyFundTradingMode("040001", "reits")).toBe("exchange");
  });
});

describe("resolveFundProfile", () => {
  it("已知基金返回本地可读档案", () => {
    const profile = resolveFundProfile("510300");
    expect(profile.code).toBe("510300");
    expect(profile.name).toBe("沪深300ETF");
    expect(profile.type).toBe("index");
    expect(profile.trading_mode).toBe("exchange");
    expect(profile.source).toBe("本地识别");
  });

  it("未知基金返回兜底档案并保留指定来源", () => {
    const profile = resolveFundProfile("123456", "AkShare");
    expect(profile.name).toBe("基金 123456");
    expect(profile.type).toBe("other");
    expect(profile.source).toBe("AkShare");
  });

  it("默认基金代码为 510300", () => {
    expect(DEFAULT_FUND_CODE).toBe("510300");
  });
});