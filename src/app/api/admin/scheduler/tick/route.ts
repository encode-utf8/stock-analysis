import type { NextRequest } from "next/server";

import { apiFail, apiOk, apiUnexpected } from "@/lib/api-response";
import { SCHEDULER_RUNNERS } from "@/lib/scheduler";
import { authorizeSchedulerRequest, runSchedulerTick } from "@/lib/scheduler-guard";
import { getTradingCalendar } from "@/lib/trading-calendar";

// POST /api/admin/scheduler/tick：只补跑被判为过期的定时任务，单项失败不影响其它任务。
// 鉴权：配置 SCHEDULER_TOKEN 时校验请求头 x-scheduler-token；未配置时只允许本机来源。
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<Response> {
  const access = authorizeSchedulerRequest(request);
  if (!access.ok) {
    return apiFail("FORBIDDEN", access.reason ?? "无权触发调度补跑。", 403);
  }

  try {
    const calendar = await getTradingCalendar();
    const result = await runSchedulerTick({
      runners: SCHEDULER_RUNNERS,
      isTradingDay: (dateKey) => calendar.isTradingDay(dateKey),
    });
    return apiOk(result);
  } catch (error) {
    return apiUnexpected(error);
  }
}
