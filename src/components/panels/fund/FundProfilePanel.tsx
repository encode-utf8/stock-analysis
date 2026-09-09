"use client";

import {
  FUND_TRADING_MODE_LABELS,
  FUND_TYPE_LABELS,
} from "@/lib/fund-market";
import { formatDateTime } from "@/lib/format";
import type { FundProfile } from "@/lib/shared/types";

interface FundProfilePanelProps {
  profile: FundProfile;
  loading: boolean;
}

function fundSourceLabel(source: string): string {
  if (source === "akshare") {
    return "AkShare 基金数据";
  }
  if (source === "deterministic-fallback") {
    return "确定性降级数据";
  }
  return source;
}

/** 基金档案面板。 */
export function FundProfilePanel({ profile, loading }: FundProfilePanelProps) {
  if (loading) {
    return (
      <section className="rounded-xl border bg-white p-4 shadow-sm">
        <div className="py-12 text-center text-sm text-muted-foreground">
          基金档案加载中...
        </div>
      </section>
    );
  }

  const items = [
    {
      label: "基金类型",
      value: FUND_TYPE_LABELS[profile.type] ?? profile.type,
      note: FUND_TRADING_MODE_LABELS[profile.trading_mode] ?? profile.trading_mode,
    },
    {
      label: "基金经理",
      value: profile.manager ?? "暂无",
      note: "以基金公司披露为准",
    },
    {
      label: "基金公司",
      value: profile.company ?? "暂无",
      note: profile.benchmark ? `基准：${profile.benchmark}` : "暂无基准信息",
    },
    {
      label: "成立日期",
      value: profile.establish_date ?? "暂无",
      note: "基金成立日期",
    },
  ];

  return (
    <section className="space-y-3">
      <div className="rounded-xl border bg-white px-4 py-3 text-xs text-muted-foreground">
        数据时间：{formatDateTime(profile.fetched_at)}，
        来源：{fundSourceLabel(profile.source)}
      </div>
      <div className="rounded-xl border bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">
              {profile.name}（{profile.code}）
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              基金档案与类型识别结果，具体信息以基金公司定期披露为准。
            </p>
          </div>
          {profile.scale !== null ? (
            <div className="text-sm text-muted-foreground">
              最新规模：{profile.scale.toLocaleString("zh-CN")} 亿份/元
            </div>
          ) : null}
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {items.map((item) => (
            <div key={item.label} className="rounded-lg border bg-muted/20 p-3">
              <div className="text-xs text-muted-foreground">{item.label}</div>
              <div className="mt-2 text-lg font-semibold">{item.value}</div>
              <div className="mt-1 text-xs text-muted-foreground">{item.note}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
