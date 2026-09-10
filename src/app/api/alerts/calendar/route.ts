import { apiOk, apiUnexpected } from "@/lib/api-response";
import { beijingDateKey, getTradingCalendar } from "@/lib/trading-calendar";

// GET /api/alerts/calendar：返回今日交易日状态与日历来源，供预警中心展示。
export async function GET(): Promise<Response> {
  try {
    const calendar = await getTradingCalendar();
    const today = beijingDateKey(new Date());
    return apiOk({
      source: calendar.source,
      today,
      is_trading_day: calendar.isTradingDay(today),
      first_day: calendar.first_day,
      last_day: calendar.last_day,
      fetched_at: calendar.fetched_at,
    });
  } catch (error) {
    return apiUnexpected(error);
  }
}