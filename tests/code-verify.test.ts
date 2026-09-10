// 自选代码存在性校验判定回归测试。
import { describe, expect, it } from "vitest";

import {
  CodeNotFoundError,
  buildCodeNotFoundMessage,
  resolveVerifyVerdict,
  type CodeVerifyResult,
} from "@/lib/code-verify";

/** 构造侧车校验结果，减少用例噪音。 */
function verifyResult(
  status: CodeVerifyResult["status"],
  name: string | null = null,
  code = "560713",
): CodeVerifyResult {
  return { code, status, name };
}

describe("buildCodeNotFoundMessage", () => {
  it("区分股票与基金并带上代码", () => {
    expect(buildCodeNotFoundMessage("stock", "600001")).toContain("股票 600001");
    expect(buildCodeNotFoundMessage("fund", "560713")).toContain("基金 560713");
  });

  it("统一包含「当前无数据，请检查输入代码是否正确」", () => {
    expect(buildCodeNotFoundMessage("fund", "560713")).toBe(
      "未查询到基金 560713 的行情数据，当前无数据，请检查输入代码是否正确。",
    );
  });
});

describe("resolveVerifyVerdict", () => {
  it("上游查不到代码时拦截并给出提示", () => {
    const verdict = resolveVerifyVerdict(verifyResult("not_found"), "fund", "560713");
    expect(verdict.blocked).toBe(true);
    expect(verdict.message).toBe(buildCodeNotFoundMessage("fund", "560713"));
  });

  it("上游存在时放行并回填真实名称", () => {
    const verdict = resolveVerifyVerdict(
      verifyResult("ok", "船舶ETF富国", "560710"),
      "fund",
      "560710",
    );
    expect(verdict.blocked).toBe(false);
    expect(verdict.name).toBe("船舶ETF富国");
  });

  it("上游不可用时放行且不回填名称", () => {
    const verdict = resolveVerifyVerdict(
      verifyResult("upstream_unavailable"),
      "stock",
      "600519",
    );
    expect(verdict.blocked).toBe(false);
    expect(verdict.name).toBeNull();
  });

  it("侧车不可达（null）时放行，避免误拦正常标的", () => {
    const verdict = resolveVerifyVerdict(null, "stock", "600519");
    expect(verdict.blocked).toBe(false);
    expect(verdict.message).toBeNull();
  });

  it("名称为空白时不回填", () => {
    const verdict = resolveVerifyVerdict(verifyResult("ok", "   "), "fund", "510300");
    expect(verdict.name).toBeNull();
  });
});

describe("CodeNotFoundError", () => {
  it("保留错误名与文案，便于界面识别并弹窗", () => {
    const error = new CodeNotFoundError("当前无数据");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("CodeNotFoundError");
    expect(error.message).toBe("当前无数据");
  });
});