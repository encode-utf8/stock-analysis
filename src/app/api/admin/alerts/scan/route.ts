import { apiOk, apiUnexpected } from "@/lib/api-response";
import { runAlertScanJob, startScheduler } from "@/lib/scheduler";

// POST /api/admin/alerts/scan：手动评估一次预警并记录任务。
export async function POST(): Promise<Response> {
  startScheduler();
  try {
    const run = await runAlertScanJob({ source: "manual" });
    return apiOk(run, { status: 202 });
  } catch (error) {
    return apiUnexpected(error);
  }
}