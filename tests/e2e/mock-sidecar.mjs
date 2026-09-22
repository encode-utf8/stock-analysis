// 端到端专用行情侧车替身。
// 目的：让 Playwright 用例在没有真实 AkShare/腾讯环境的机器上仍能验证「官方来源」链路，
// 并通过 /__control 开关模拟上游故障，构造数据源不可用（503）场景。
// 约定：所有数据都是固定值 + 确定性推导，source 一律为官方标识 akshare。
import { createServer } from "node:http";

const PORT = Number(process.env.E2E_SIDECAR_PORT ?? 3199);
/** 代码校验返回的名称：使用真实名称，未收录的返回不含代码的占位名。 */
const VERIFY_NAMES = {
  "600519": "贵州茅台",
  "600000": "浦发银行",
  "300750": "宁德时代",
  "510300": "沪深300ETF",
  "110022": "易方达消费行业",
};
const HOST = "127.0.0.1";
/** 上游是否可用；关闭后所有数据接口返回 503，用于数据源故障用例。 */
let online = true;

/** 生成北京时间日期字符串（YYYY-MM-DD）。 */
function beijingDate(offsetDays = 0) {
  const now = new Date(Date.now() + offsetDays * 86_400_000);
  return now.toISOString().slice(0, 10);
}

/** 由代码推导一个稳定的基准价，避免每次请求结果抖动。 */
function basePrice(code) {
  let hash = 0;
  for (const char of code) {
    hash = (hash * 31 + char.charCodeAt(0)) % 100000;
  }
  return 10 + (hash % 900) / 10;
}

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function quote(code) {
  const price = Number(basePrice(code).toFixed(2));
  const fetchedAt = new Date().toISOString();
  return {
    code,
    ts: fetchedAt,
    price,
    change_pct: 1.23,
    open: Number((price - 0.5).toFixed(2)),
    high: Number((price + 1.2).toFixed(2)),
    low: Number((price - 1.1).toFixed(2)),
    prev_close: Number((price - 0.2).toFixed(2)),
    volume: 1_234_567,
    amount: 123_456_789,
    turnover_rate: 0.88,
    pe: 15.2,
    pb: 2.4,
    market_cap: null,
    float_cap: null,
    source: "akshare",
    fetched_at: fetchedAt,
  };
}

function klines(code, period, adjust, limit) {
  const count = Math.min(Math.max(limit, 1), 250);
  const fetchedAt = new Date().toISOString();
  const base = basePrice(code);
  return Array.from({ length: count }, (_, index) => {
    const close = Number((base + Math.sin(index / 6) * 1.5).toFixed(2));
    return {
      code,
      period,
      ts: beijingDate(-(count - index)),
      open: Number((close - 0.3).toFixed(2)),
      high: Number((close + 0.6).toFixed(2)),
      low: Number((close - 0.7).toFixed(2)),
      close,
      volume: 100_000 + index * 1000,
      amount: 1_000_000 + index * 10_000,
      adj_type: adjust,
      source: "akshare",
      fetched_at: fetchedAt,
    };
  });
}

function fundProfile(code) {
  return {
    code,
    name: `测试基金${code}`,
    type: "index",
    trading_mode: "exchange",
    manager: "测试经理",
    company: "测试基金公司",
    benchmark: "沪深300指数",
    establish_date: "2012-05-28",
    scale: 1288.5,
    risk_level: "中高风险",
    source: "akshare",
    fetched_at: new Date().toISOString(),
  };
}

function fundNav(code, start, end) {
  const startTime = new Date(`${start}T00:00:00Z`).getTime();
  const endTime = new Date(`${end}T00:00:00Z`).getTime();
  const safeEnd = Number.isFinite(endTime) ? endTime : Date.now();
  const safeStart = Number.isFinite(startTime) ? startTime : safeEnd - 365 * 86_400_000;
  const fetchedAt = new Date().toISOString();
  const points = [];
  let unit = 3.18;
  for (let time = safeStart; time <= safeEnd; time += 86_400_000) {
    const day = new Date(time);
    const weekday = day.getUTCDay();
    if (weekday === 0 || weekday === 6) {
      continue;
    }
    unit = Number((unit * (1 + Math.sin(unit) / 500)).toFixed(4));
    points.push({
      code,
      nav_date: day.toISOString().slice(0, 10),
      unit_nav: unit,
      cumulative_nav: Number((unit + 0.85).toFixed(4)),
      daily_change_pct: Number((Math.sin(unit) * 0.8).toFixed(2)),
      source: "akshare",
      fetched_at: fetchedAt,
    });
  }
  return points;
}

function fundHoldings(code) {
  return {
    code,
    report_date: beijingDate(-30),
    published_at: beijingDate(-25),
    top_holdings: [
      { code: "600519", name: "贵州茅台", weight_pct: 9.12, change_pct: 0.42, industry: "食品饮料" },
      { code: "300750", name: "宁德时代", weight_pct: 7.35, change_pct: -0.31, industry: "电力设备" },
      { code: "601318", name: "中国平安", weight_pct: 5.28, change_pct: 0.15, industry: "非银金融" },
    ],
    asset_allocation: { 股票: 92.35, 债券: 0, 现金: 7.65 },
    industry_allocation: { 食品饮料: 18.4, 电力设备: 15.2, 非银金融: 11.6 },
    top10_weight_pct: 58.42,
    top1_weight_pct: 9.12,
    source: "akshare",
    fetched_at: new Date().toISOString(),
  };
}

function fundIntraday(code) {
  const price = Number((3.18 + basePrice(code) / 100).toFixed(4));
  return {
    code,
    mode: "realtime",
    ts: new Date().toISOString(),
    price,
    estimated_nav: null,
    change_pct: 0.86,
    open: Number((price - 0.02).toFixed(4)),
    high: Number((price + 0.03).toFixed(4)),
    low: Number((price - 0.04).toFixed(4)),
    volume: 2_345_600,
    amount: 45_678_900,
    iopv: Number((price - 0.005).toFixed(4)),
    premium_rate: 0.12,
    official_nav: Number((price - 0.01).toFixed(4)),
    official_nav_date: beijingDate(-1),
    source: "akshare",
    fetched_at: new Date().toISOString(),
  };
}

function tradingCalendar(start, end) {
  const startTime = new Date(`${start}T00:00:00Z`).getTime();
  const endTime = new Date(`${end}T00:00:00Z`).getTime();
  const days = [];
  for (let time = startTime; Number.isFinite(time) && time <= endTime; time += 86_400_000) {
    const day = new Date(time);
    const weekday = day.getUTCDay();
    if (weekday === 0 || weekday === 6) {
      continue;
    }
    days.push(day.toISOString().slice(0, 10));
  }
  return { source: "akshare", fetched_at: new Date().toISOString(), days };
}

function handle(pathname, params, res) {
  if (pathname === "/health") {
    return send(res, 200, { status: "ok" });
  }
  if (pathname === "/__control") {
    online = params.get("online") !== "0";
    return send(res, 200, { online });
  }
  if (!online) {
    // 上游不可用：与真实侧车一致返回非 2xx，调用方据此进入降级 / 故障分支。
    return send(res, 503, { error: "upstream unavailable" });
  }

  const code = params.get("code") ?? "";
  if (pathname === "/quote") {
    return send(res, 200, quote(code));
  }
  if (pathname === "/kline") {
    return send(
      res,
      200,
      klines(
        code,
        params.get("period") ?? "day",
        params.get("adjust") ?? "qfq",
        Number(params.get("limit") ?? 120),
      ),
    );
  }
  if (pathname === "/quotes") {
    const codes = (params.get("codes") ?? "").split(",").filter(Boolean);
    return send(res, 200, {
      quotes: codes.map((item) => ({
        code: item,
        price: Number(basePrice(item).toFixed(2)),
        change_pct: 1.23,
        prev_close: Number((basePrice(item) - 0.2).toFixed(2)),
        source: "akshare",
        fetched_at: new Date().toISOString(),
      })),
      missing: [],
      source: "akshare",
      fetched_at: new Date().toISOString(),
    });
  }
  if (pathname === "/quote/verify" || pathname === "/fund/verify") {
    // 名称里不要带代码：自选列表会同时展示名称与代码，避免用例断言代码时命中两处。
    return send(res, 200, { code, status: "ok", name: VERIFY_NAMES[code] ?? "测试标的" });
  }
  if (pathname === "/fund/profile") {
    return send(res, 200, fundProfile(code));
  }
  if (pathname === "/fund/nav") {
    return send(res, 200, fundNav(code, params.get("start") ?? "", params.get("end") ?? ""));
  }
  if (pathname === "/fund/holdings") {
    return send(res, 200, fundHoldings(code));
  }
  if (pathname === "/fund/intraday") {
    return send(res, 200, fundIntraday(code));
  }
  if (pathname === "/trading-calendar") {
    return send(res, 200, tradingCalendar(params.get("start") ?? "", params.get("end") ?? ""));
  }
  if (pathname === "/index/quote") {
    return send(res, 200, { quotes: [], source: "akshare", fetched_at: new Date().toISOString() });
  }
  if (pathname === "/index/kline") {
    return send(res, 200, []);
  }
  return send(res, 404, { error: `unsupported path: ${pathname}` });
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);
  try {
    handle(url.pathname, url.searchParams, res);
  } catch (error) {
    send(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[mock-sidecar] listening on http://${HOST}:${PORT}`);
});