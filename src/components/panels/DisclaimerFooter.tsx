"use client";

import { formatDateTime } from "@/lib/format";
import type { MarketQuote } from "@/lib/shared/types";

const DISCLAIMER =
  "本工具仅供学习参考，不构成投资建议。所有行情、资讯与 AI 输出均可能存在延迟或误差，请独立判断并自行承担盈亏。";

interface DisclaimerFooterProps {
  quote: MarketQuote | null;
}

/** 免责声明与数据更新时间脚注。 */
export function DisclaimerFooter({ quote }: DisclaimerFooterProps) {
  return (
    <footer className="rounded-xl border bg-amber-500/10 px-4 py-3 text-xs leading-5 text-amber-300">
      {DISCLAIMER}
      <span className="ml-2 text-amber-300">
        数据更新：{quote ? formatDateTime(quote.fetched_at) : "尚未查询"}
      </span>
    </footer>
  );
}
