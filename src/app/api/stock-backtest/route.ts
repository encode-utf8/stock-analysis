import { apiFail, apiOk, apiUnexpected } from "@/lib/api-response";
import { getKlines } from "@/lib/market-data";
import { MIN_BARS, normalizeBacktestRequest } from "@/lib/stock-backtest-request";
import {
  isUsableBacktestKlines,
  runPortfolioRebalanceBacktest,
  runSingleAssetBacktest,
  toBacktestBars,
  type BacktestBar,
} from "@/lib/stock-backtest";
import { BACKTEST_STRATEGY_LABELS } from "@/lib/shared/types";
import type { BacktestResult } from "@/lib/shared/types";

import type { NextRequest } from "next/server";

/** POST /api/stock-backtest：按请求里的策略与参数回测。 */
export async function POST(request: NextRequest): Promise<Response> {
  try {
    const body = await request.json().catch(() => null);
    if (!body) {
      return apiFail("BAD_REQUEST", "请求体不是合法 JSON。", 400);
    }

    const parsed = normalizeBacktestRequest(body);
    if ("error" in parsed) {
      return apiFail("VALIDATION_ERROR", parsed.error, 400);
    }
    const spec = parsed.value;

    // 回测必须基于真实历史 K 线：样本不足或只有确定性降级数据时直接拒绝，
    // 避免用演示数据跑出看似可信的结论。
    const barsByCode: Record<string, BacktestBar[]> = {};
    const warnings: string[] = [];
    for (const code of spec.codes) {
      const klines = await getKlines(code, spec.period, "qfq", spec.limit);
      if (!isUsableBacktestKlines(klines)) {
        return apiFail(
          "UPSTREAM_ERROR",
          `未取到 ${code} 的真实历史 K 线（行情侧车不可用或上游限流），回测需要真实历史数据，请稍后重试。`,
          503,
        );
      }
      if (klines.length < spec.limit) {
        warnings.push(
          `${code} 上游仅返回 ${klines.length} 根 K 线（请求 ${spec.limit} 根），实际回测区间可能短于所选区间。`,
        );
      }

      const bars = toBacktestBars(klines).filter(
        (bar) =>
          (!spec.start || bar.date >= spec.start) && (!spec.end || bar.date <= spec.end),
      );
      if (bars.length < MIN_BARS) {
        const unit = spec.period === "day" ? "个交易日" : "个交易周";
        return apiFail(
          "VALIDATION_ERROR",
          `${code} 在所选区间内只有 ${bars.length} ${unit}，至少需要 ${MIN_BARS} 个才能回测。`,
          400,
        );
      }
      barsByCode[code] = bars;
    }

    const output =
      spec.strategy === "portfolio-rebalance"
        ? runPortfolioRebalanceBacktest({
            items: spec.items,
            barsByCode,
            rebalance: spec.rebalance ?? "quarterly",
            initialCapital: spec.initialCapital,
            feeRate: spec.feeRate,
            stampDutyRate: spec.stampDutyRate,
            slippageRate: spec.slippageRate,
          })
        : runSingleAssetBacktest({
            code: spec.codes[0],
            bars: barsByCode[spec.codes[0]],
            signals: spec.buildSignals(barsByCode[spec.codes[0]].map((bar) => bar.close)),
            initialCapital: spec.initialCapital,
            feeRate: spec.feeRate,
            stampDutyRate: spec.stampDutyRate,
            slippageRate: spec.slippageRate,
          });

    warnings.push(...output.warnings);
    if (spec.strategy === "portfolio-rebalance") {
      const totalWeight = spec.items.reduce((sum, item) => sum + item.weight, 0);
      if (Math.abs(totalWeight - 100) > 0.01) {
        warnings.push(`权重合计为 ${totalWeight}%，已按合计值等比归一后计算。`);
      }
    }

    const result: BacktestResult = {
      strategy: spec.strategy,
      strategy_label: BACKTEST_STRATEGY_LABELS[spec.strategy],
      period: spec.period,
      code: spec.code,
      codes: spec.codes,
      params_label: spec.paramsLabel,
      adjust: "qfq",
      initial_capital: spec.initialCapital,
      fee_rate: spec.feeRate,
      stamp_duty_rate: spec.stampDutyRate,
      slippage_rate: spec.slippageRate,
      metrics: output.metrics,
      equity_curve: output.equityCurve,
      trades: output.trades,
      warnings,
      generated_at: new Date().toISOString(),
    };

    return apiOk(result);
  } catch (error) {
    return apiUnexpected(error);
  }
}