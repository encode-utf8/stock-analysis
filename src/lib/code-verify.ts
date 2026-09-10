// 自选代码存在性校验：把侧车的三态结论转换为接口与界面可用的判定结果。
// 关键约定：只有上游明确「查不到该代码」才拦截；上游不可用时放行，避免误伤正常标的。

/** 侧车对代码存在性的三态结论。 */
export type CodeVerifyStatus = "ok" | "not_found" | "upstream_unavailable";

/** 侧车校验响应结构（`/quote/verify`、`/fund/verify` 共用）。 */
export interface CodeVerifyResult {
  code: string;
  status: CodeVerifyStatus;
  name: string | null;
}

/** 自选标的类型，用于生成中文提示文案。 */
export type VerifyTargetKind = "stock" | "fund";

/** 代码在权威上游查不到数据时抛出的专用错误，由界面弹窗提示。 */
export class CodeNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodeNotFoundError";
  }
}

/** 校验判定结果：拦截时给出提示文案，放行时可能带回上游真实名称。 */
export type CodeVerifyVerdict =
  | { blocked: true; message: string; name: null }
  | { blocked: false; message: null; name: string | null };

/** 生成「当前无数据」提示文案。 */
export function buildCodeNotFoundMessage(
  kind: VerifyTargetKind,
  code: string,
): string {
  const label = kind === "stock" ? "股票" : "基金";
  return `未查询到${label} ${code} 的行情数据，当前无数据，请检查输入代码是否正确。`;
}

/** 把侧车结论转换为判定结果；侧车不可达（null）与上游不可用均放行。 */
export function resolveVerifyVerdict(
  result: CodeVerifyResult | null,
  kind: VerifyTargetKind,
  code: string,
): CodeVerifyVerdict {
  if (result?.status === "not_found") {
    return { blocked: true, message: buildCodeNotFoundMessage(kind, code), name: null };
  }

  const name = typeof result?.name === "string" ? result.name.trim() : "";
  return { blocked: false, message: null, name: name || null };
}