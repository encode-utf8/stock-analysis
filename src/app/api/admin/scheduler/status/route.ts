import { apiOk, apiUnexpected } from "@/lib/api-response";
import { isSchedulerStarted } from "@/lib/scheduler";
import { collectTaskStates, summarizeSchedulerStatus } from "@/lib/scheduler-guard";
import { getTradingCalendar } from "@/lib/trading-calendar";

// GET /api/admin/scheduler/status：只读接口，返回各定时任务最近运行时间、过期状态与跳过原因。
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const now = new Date();
    const calendar = await getTradingCalendar();
    const states = await collectTaskStates(now);
    const summary = summarizeSchedulerStatus({
      now,
      states,
      isTradingDay: (dateKey) => calendar.isTradingDay(dateKey),
      schedulerRegistered: isSchedulerStarted(),
    });
    return apiOk(summary);
  } catch (error) {
    return apiUnexpected(error);
  }
}
