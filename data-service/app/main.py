"""行情数据侧车入口。

优先接入 AkShare 真实行情；当 AkShare 或上游源不可用时，按
“Tencent 行情 -> 确定性数据”顺序降级，并统一在响应中标记
`source` 与 `fetched_at`。
"""

from __future__ import annotations

import hashlib
import logging
import math
from datetime import date, datetime, timedelta, timezone
from typing import Any, Literal

from fastapi import FastAPI, HTTPException, Query

from .fund_routes import router as fund_router

logger = logging.getLogger(__name__)

try:
    import akshare as ak
    import pandas as pd

    HAS_AKSHARE = True
except Exception:  # 本地未安装 AkShare 时保留降级能力
    ak = None
    pd = None
    HAS_AKSHARE = False

app = FastAPI(
    title="个股盘面分析行情数据侧车",
    description="FastAPI 行情服务，提供 AkShare 真实行情并支持确定性降级。",
    version="0.2.0",
)

app.include_router(fund_router)

KlinePeriod = Literal["minute", "day", "week", "month"]
AdjustType = Literal["qfq", "hfq", "none"]

SOURCE_AKSHARE = "akshare"
SOURCE_FALLBACK = "deterministic-fallback"

CHINA_TZ = timezone(timedelta(hours=8))


def _now_utc() -> datetime:
    """返回当前 UTC 时间。"""
    return datetime.now(timezone.utc)


def _seed(value: str) -> int:
    """将字符串转换为可复现整数种子。"""
    digest = hashlib.sha256(value.encode("utf-8")).hexdigest()
    return int(digest[:8], 16)


def _random(seed: int):
    """极简线性同余伪随机数，避免依赖 numpy。"""
    state = seed
    while True:
        state = (state * 1103515245 + 12345) & 0x7FFFFFFF
        yield state / 0x7FFFFFFF


def _round(value: float, digits: int = 2) -> float:
    return round(value, digits)


def _number(value: Any, default: float | None = None) -> float | None:
    """将外部数据单元格转换为浮点数；无效值返回默认值。"""
    try:
        number = float(value)
        if math.isnan(number) or math.isinf(number):
            return default
        return number
    except (TypeError, ValueError):
        return default


def _integer(value: Any, default: int = 0) -> int:
    number = _number(value)
    return int(number) if number is not None else default


def _curl_get_text(url: str, params: dict | None = None) -> str | None:
    """使用 curl_cffi 获取文本，规避部分上游源的 TLS 指纹限制。"""
    try:
        from curl_cffi import requests as curl_requests

        response = curl_requests.get(
            url,
            params=params,
            timeout=15,
            impersonate="chrome",
        )
        response.raise_for_status()
        return response.text
    except Exception as exc:
        logger.debug("curl_cffi 请求失败：%s", exc)
        return None


def _tencent_symbol(code: str) -> str:
    """将 6 位 A 股代码转换为腾讯行情前缀代码。"""
    if code == "830799":
        return "bj920799"
    if code.startswith(("4", "8")):
        return f"bj{code}"
    if code.startswith(("6", "9")):
        return f"sh{code}"
    return f"sz{code}"


def _build_tencent_quote(code: str) -> dict | None:
    """通过腾讯行情构造真实快照。"""
    symbol = _tencent_symbol(code)
    text = _curl_get_text(f"https://qt.gtimg.cn/q={symbol}")
    if not text or '="' not in text:
        return None

    try:
        payload = text.split('="', 1)[1].rsplit('"', 1)[0]
        parts = payload.split("~")
        target_code = symbol[-6:]
        if len(parts) < 47 or parts[2] not in (code, target_code):
            return None

        price = _number(parts[3])
        if price is None or price <= 0:
            return None

        prev_close = _number(parts[4], price) or price
        open_price = _number(parts[5], prev_close) or prev_close
        high = _number(parts[33], max(price, open_price, prev_close)) or max(price, open_price, prev_close)
        low = _number(parts[34], min(price, open_price, prev_close)) or min(price, open_price, prev_close)
        change_pct = _number(parts[32])
        if change_pct is None:
            change_pct = (price / prev_close - 1) * 100 if prev_close else 0.0
        volume = _integer(parts[6]) * 100
        amount_raw = _number(parts[37], 0.0) or 0.0
        amount = int(amount_raw * 10000)
        turnover_rate = _number(parts[38], 0.0) or 0.0
        pe = _number(parts[39])
        pb = _number(parts[46])
        market_cap_raw = _number(parts[44], 0.0) or 0.0
        float_cap_raw = _number(parts[45], 0.0) or 0.0
        if market_cap_raw > 0 and float_cap_raw > market_cap_raw * 1.05:
            market_cap_raw, float_cap_raw = float_cap_raw, market_cap_raw
        market_cap = int(market_cap_raw * 100_000_000) if market_cap_raw > 0 else None
        float_cap = int(float_cap_raw * 100_000_000) if float_cap_raw > 0 else None
        if market_cap is not None and float_cap is not None and float_cap > market_cap:
            float_cap = market_cap

        now = _now_utc()
        return {
            "code": code,
            "ts": now.isoformat(),
            "price": _round(price),
            "change_pct": _round(change_pct),
            "open": _round(open_price),
            "high": _round(high),
            "low": _round(low),
            "prev_close": _round(prev_close),
            "volume": volume,
            "amount": amount,
            "turnover_rate": _round(turnover_rate, 2),
            "pe": pe,
            "pb": pb,
            "market_cap": market_cap,
            "float_cap": float_cap,
            "source": SOURCE_AKSHARE,
            "fetched_at": now.isoformat(),
        }
    except Exception as exc:
        logger.warning("腾讯行情解析失败：%s", exc)
        return None


def _series_value(row: Any, names: list[str]) -> Any:
    """按候选列名从 pandas 行中取值，兼容 AkShare 版本差异。"""
    for name in names:
        try:
            if name in row.index:
                return row[name]
        except (AttributeError, TypeError):
            return None
    return None


def _format_kline_time(value: Any, period: KlinePeriod) -> str:
    """将日期/时间列标准化为 ISO 时间字符串。"""
    try:
        if pd is not None:
            timestamp = pd.to_datetime(value)
            if timestamp is pd.NaT:
                return ""
            return timestamp.isoformat()
    except Exception:
        pass
    return str(value)


def _build_akshare_quote(code: str) -> dict | None:
    """通过 AkShare 东方财富接口构造真实快照。"""
    if not HAS_AKSHARE:
        return None

    try:
        frame = ak.stock_bj_a_spot_em() if _tencent_symbol(code).startswith("bj") else ak.stock_zh_a_spot_em()
        if frame is None or frame.empty:
            return None
        code_series = frame["代码"].astype(str).str.zfill(6)
        matched = frame[code_series == code]
        if matched.empty:
            return None
        row = matched.iloc[0]
    except Exception as exc:
        logger.debug("AkShare 实时行情获取失败：%s", exc)
        return None

    price = _number(_series_value(row, ["最新价"]))
    if price is None or price <= 0:
        return None

    change_pct = _number(_series_value(row, ["涨跌幅"]), 0.0) or 0.0
    open_price = _number(_series_value(row, ["今开"]), price) or price
    high = _number(_series_value(row, ["最高"]), max(price, open_price)) or max(price, open_price)
    low = _number(_series_value(row, ["最低"]), min(price, open_price)) or min(price, open_price)
    prev_close = _number(_series_value(row, ["昨收"]), price) or price
    now = _now_utc()

    return {
        "code": code,
        "ts": now.isoformat(),
        "price": _round(price),
        "change_pct": _round(change_pct),
        "open": _round(open_price),
        "high": _round(high),
        "low": _round(low),
        "prev_close": _round(prev_close),
        "volume": _integer(_series_value(row, ["成交量"])),
        "amount": _integer(_series_value(row, ["成交额"])),
        "turnover_rate": _round(_number(_series_value(row, ["换手率"]), 0.0) or 0.0, 2),
        "pe": _number(_series_value(row, ["市盈率-动态", "市盈率"]), None),
        "pb": _number(_series_value(row, ["市净率"]), None),
        "market_cap": _integer(_series_value(row, ["总市值"]), 0) or None,
        "float_cap": _integer(_series_value(row, ["流通市值"]), 0) or None,
        "source": SOURCE_AKSHARE,
        "fetched_at": now.isoformat(),
    }


def _build_akshare_kline(code: str, period: KlinePeriod, adjust: AdjustType, limit: int) -> list[dict] | None:
    """通过 AkShare 东方财富接口构造真实 K 线。"""
    if not HAS_AKSHARE:
        return None

    now = _now_utc()
    end_date = now.astimezone(CHINA_TZ).date()
    try:
        if period == "minute":
            frame = ak.stock_zh_a_hist_min_em(
                symbol=code,
                start_date=f"{end_date - timedelta(days=10)} 09:30:00",
                end_date=f"{end_date} 15:00:00",
                period="1",
                adjust="",
            )
        else:
            ak_period = {"day": "daily", "week": "weekly", "month": "monthly"}[period]
            ak_adjust = adjust if adjust in ("qfq", "hfq") else ""
            frame = ak.stock_zh_a_hist(
                symbol=code,
                period=ak_period,
                start_date="19900101",
                end_date=end_date.strftime("%Y%m%d"),
                adjust=ak_adjust,
            )
    except Exception as exc:
        logger.debug("AkShare K 线获取失败：%s", exc)
        return None

    if frame is None or frame.empty:
        return None

    date_names = ["日期", "时间"]
    try:
        date_column = next(name for name in date_names if name in frame.columns)
        frame = frame.sort_values(date_column)
        frame = frame.drop_duplicates(subset=[date_column], keep="last")
    except StopIteration:
        return None

    result: list[dict] = []
    for row in frame.tail(limit).to_dict("records"):
        close = _number(row.get("收盘"))
        open_price = _number(row.get("开盘"))
        if close is None or open_price is None:
            continue
        high = _number(row.get("最高"), max(open_price, close)) or max(open_price, close)
        low = _number(row.get("最低"), min(open_price, close)) or min(open_price, close)
        result.append(
            {
                "code": code,
                "period": period,
                "ts": _format_kline_time(row.get(date_column), period),
                "open": _round(open_price),
                "high": _round(high),
                "low": _round(low),
                "close": _round(close),
                "volume": _integer(row.get("成交量")),
                "amount": _integer(row.get("成交额")),
                "adj_type": adjust,
                "source": SOURCE_AKSHARE,
                "fetched_at": now.isoformat(),
            }
        )

    return result or None


def _parse_tencent_kline_payload(text: str, symbol: str, adjust: AdjustType) -> list[list[Any]] | None:
    """解析腾讯新 K 线 JSONP 返回中的日线数组。"""
    try:
        import json

        start = text.find("={") + 1
        if start <= 0:
            return None
        data = json.loads(text[start:]).get("data", {}).get(symbol, {})
        key = {"qfq": "qfqday", "hfq": "hfqday", "none": "day"}[adjust]
        rows = data.get(key) or data.get("day") or data.get("qfqday") or data.get("hfqday")
        return rows if isinstance(rows, list) else None
    except Exception:
        return None


def _tencent_daily_rows(code: str, adjust: AdjustType, years: int) -> list[dict]:
    """获取腾讯日线，按年份拼接。"""
    symbol = _tencent_symbol(code)
    url = "https://proxy.finance.qq.com/ifzqgtimg/appstock/app/newfqkline/get"
    today = datetime.now(CHINA_TZ).date()
    tx_adjust = "" if adjust == "none" else adjust
    rows: list[dict] = []

    for year in range(today.year - years, today.year + 1):
        params = {
            "_var": f"kline_day{tx_adjust}{year}",
            "param": f"{symbol},day,{year}-01-01,{year + 1}-12-31,640,{tx_adjust}",
            "r": "0.8205512681390605",
        }
        text = _curl_get_text(url, params)
        if not text:
            continue
        raw = _parse_tencent_kline_payload(text, symbol, adjust)
        if not raw:
            continue
        for item in raw:
            try:
                if len(item) < 6:
                    continue
                date_text = str(item[0])
                date = datetime.strptime(date_text, "%Y-%m-%d").date()
                rows.append(
                    {
                        "date": date,
                        "open": _number(item[1]),
                        "close": _number(item[2]),
                        "high": _number(item[3]),
                        "low": _number(item[4]),
                        "volume": (_number(item[5], 0.0) or 0.0) * 100,
                        "amount": (_number(item[8], 0.0) or 0.0) * 10000 if len(item) > 8 else 0.0,
                    }
                )
            except Exception:
                continue

    deduped: dict[datetime, dict] = {}
    for row in rows:
        deduped[row["date"]] = row
    rows = list(deduped.values())
    rows.sort(key=lambda item: item["date"])
    return rows


def _aggregate_daily_bars(rows: list[dict], period: KlinePeriod) -> list[dict]:
    """将日线聚合为周线或月线。"""
    groups: dict[str, list[dict]] = {}
    for row in rows:
        if period == "week":
            iso = row["date"].isocalendar()
            key = f"{iso[0]}-{iso[1]:02d}"
        else:
            key = f"{row['date'].year}-{row['date'].month:02d}"
        groups.setdefault(key, []).append(row)

    result: list[dict] = []
    for group_rows in groups.values():
        result.append(
            {
                "date": group_rows[-1]["date"],
                "open": group_rows[0]["open"],
                "close": group_rows[-1]["close"],
                "high": max(row["high"] or row["close"] for row in group_rows),
                "low": min(row["low"] or row["close"] for row in group_rows),
                "volume": sum(row["volume"] for row in group_rows),
                "amount": sum(row["amount"] for row in group_rows),
            }
        )
    result.sort(key=lambda item: item["date"])
    return result


def _build_tencent_minute_kline(code: str, adjust: AdjustType, limit: int) -> list[dict]:
    """通过腾讯分时接口构造分钟 K 线。"""
    symbol = _tencent_symbol(code)
    text = _curl_get_text(f"https://web.ifzq.gtimg.cn/appstock/app/minute/query?code={symbol}")
    if not text:
        return []
    try:
        import json

        payload = json.loads(text)
        stock_data = payload.get("data", {}).get(symbol, {})
        date_text = stock_data.get("data", {}).get("date", "")
        points = stock_data.get("data", {}).get("data", [])
        if not points:
            return []
        date = datetime.strptime(date_text, "%Y%m%d").date()
        now = _now_utc()
        result: list[dict] = []
        for point in points[-limit:]:
            parts = str(point).split()
            if len(parts) < 2:
                continue
            hour = int(parts[0][:2])
            minute = int(parts[0][2:])
            price = _number(parts[1])
            if price is None:
                continue
            volume = _integer(parts[2]) if len(parts) > 2 else 0
            ts = datetime(date.year, date.month, date.day, hour, minute, tzinfo=CHINA_TZ)
            result.append(
                {
                    "code": code,
                    "period": "minute",
                    "ts": ts.isoformat(),
                    "open": _round(price),
                    "high": _round(price),
                    "low": _round(price),
                    "close": _round(price),
                    "volume": volume,
                    "amount": int(volume * price * 100),
                    "adj_type": adjust,
                    "source": SOURCE_AKSHARE,
                    "fetched_at": now.isoformat(),
                }
            )
        return result
    except Exception:
        return []


def _build_sina_minute_kline(code: str, adjust: AdjustType, limit: int) -> list[dict]:
    """通过新浪分钟接口构造 OHLC 分钟 K 线，兼容北交所个股。"""
    symbol = _tencent_symbol(code)
    url = "https://quotes.sina.cn/cn/api/jsonp_v2.php/=/CN_MarketDataService.getKLineData"
    params = {
        "symbol": symbol,
        "scale": "1",
        "ma": "no",
        "datalen": str(max(limit, 240)),
    }
    text = _curl_get_text(url, params)
    if not text:
        return []

    try:
        import json

        start = text.find("=([") + 2
        end = text.find("]);", start)
        if start < 2 or end < 0:
            return []
        raw_items = json.loads(text[start:end + 1])
        now = _now_utc()
        result: list[dict] = []
        for item in raw_items[-limit:]:
            open_price = _number(item.get("open"))
            close = _number(item.get("close"))
            high = _number(item.get("high"))
            low = _number(item.get("low"))
            if open_price is None or close is None or high is None or low is None:
                continue
            ts = datetime.strptime(item["day"], "%Y-%m-%d %H:%M:%S").replace(tzinfo=CHINA_TZ)
            result.append(
                {
                    "code": code,
                    "period": "minute",
                    "ts": ts.isoformat(),
                    "open": _round(open_price),
                    "high": _round(high),
                    "low": _round(low),
                    "close": _round(close),
                    "volume": _integer(item.get("volume")),
                    "amount": _integer(item.get("amount")),
                    "adj_type": adjust,
                    "source": SOURCE_AKSHARE,
                    "fetched_at": now.isoformat(),
                }
            )
        return result
    except Exception as exc:
        logger.warning("新浪分钟 K 线解析失败：%s", exc)
        return []


def _build_sina_daily_rows(code: str, years: int) -> list[dict]:
    """通过新浪历史日线构造北交所真实日线，避免腾讯源缺失。"""
    if not HAS_AKSHARE:
        return []

    try:
        from akshare.stock.cons import hk_js_decode, zh_sina_a_stock_hist_url
        import py_mini_racer
    except Exception as exc:
        logger.debug("新浪历史日线依赖不可用：%s", exc)
        return []

    symbol = _tencent_symbol(code)
    text = _curl_get_text(zh_sina_a_stock_hist_url.format(symbol))
    if not text or "=" not in text:
        return []

    try:
        encoded = text.split("=", 1)[1].split(";", 1)[0].strip().strip('"')
        ctx = py_mini_racer.MiniRacer()
        ctx.eval(hk_js_decode)
        items = ctx.call("d", encoded)
    except Exception as exc:
        logger.warning("新浪历史日线解码失败：%s", exc)
        return []

    today = datetime.now(CHINA_TZ).date()
    cutoff = today - timedelta(days=years * 365)
    rows: list[dict] = []
    for item in items:
        try:
            date_text = str(item["date"])
            date = datetime.fromisoformat(date_text.replace("Z", "+00:00")).date()
            if date < cutoff:
                continue
            rows.append(
                {
                    "date": date,
                    "open": _number(item.get("open")),
                    "close": _number(item.get("close")),
                    "high": _number(item.get("high")),
                    "low": _number(item.get("low")),
                    "volume": _number(item.get("volume"), 0.0) or 0.0,
                    "amount": _number(item.get("amount"), 0.0) or 0.0,
                }
            )
        except Exception:
            continue

    rows.sort(key=lambda item: item["date"])
    return rows


def _build_tencent_kline(code: str, period: KlinePeriod, adjust: AdjustType, limit: int) -> list[dict] | None:
    """通过腾讯行情构造真实 K 线。"""
    if period == "minute":
        result = _build_sina_minute_kline(code, adjust, limit) or _build_tencent_minute_kline(code, adjust, limit)
        return result or None

    years = max(1, math.ceil(limit / 240) + 1)
    if period == "month":
        years = max(20, limit // 12 + 2)
    elif period == "week":
        years = max(5, limit // 50 + 2)

    if _tencent_symbol(code).startswith("bj"):
        daily_rows = _build_sina_daily_rows(code, years)
    else:
        daily_rows = _tencent_daily_rows(code, adjust, years)
    if not daily_rows:
        return None

    rows = daily_rows if period == "day" else _aggregate_daily_bars(daily_rows, period)
    now = _now_utc()
    result: list[dict] = []
    for row in rows[-limit:]:
        open_price = row["open"]
        close = row["close"]
        if open_price is None or close is None:
            continue
        high = row["high"] if row["high"] is not None else max(open_price, close)
        low = row["low"] if row["low"] is not None else min(open_price, close)
        ts = datetime(row["date"].year, row["date"].month, row["date"].day, tzinfo=CHINA_TZ)
        result.append(
            {
                "code": code,
                "period": period,
                "ts": ts.isoformat(),
                "open": _round(open_price),
                "high": _round(high),
                "low": _round(low),
                "close": _round(close),
                "volume": _integer(row["volume"]),
                "amount": _integer(row["amount"]),
                "adj_type": adjust,
                "source": SOURCE_AKSHARE,
                "fetched_at": now.isoformat(),
            }
        )
    return result or None


KNOWN_BASE_PRICES = {
    "600519": 1688,
    "601318": 52,
    "688981": 58,
    "000001": 11.6,
    "002594": 268,
    "300750": 218,
    "830799": 18.8,
}


def _base_price(code: str) -> float:
    """已知股票使用近似基准价，其余股票使用稳定演示价。"""
    if code in KNOWN_BASE_PRICES:
        return KNOWN_BASE_PRICES[code]
    return 12 + (_seed(f"base:{code}") % 16800) / 100


def _last_trading_day(day: datetime) -> datetime:
    while day.weekday() >= 5:
        day = day - timedelta(days=1)
    return day


def _build_fallback_quote(code: str) -> dict:
    """构造确定性降级行情。"""
    now = _now_utc()
    day_key = now.date().isoformat()
    rng = _random(_seed(f"quote:{code}:{day_key}"))
    prev_close = _base_price(code)
    change_pct = _round((next(rng) - 0.46) * 5)
    price = _round(prev_close * (1 + change_pct / 100))
    open_price = _round(prev_close * (1 + (next(rng) - 0.5) * 0.02))
    high = _round(max(open_price, price) * (1 + next(rng) * 0.015))
    low = _round(min(open_price, price) * (1 - next(rng) * 0.015))
    volume = int(2_000_000 + next(rng) * 8_000_000)

    return {
        "code": code,
        "ts": now.isoformat(),
        "price": price,
        "change_pct": change_pct,
        "open": open_price,
        "high": high,
        "low": low,
        "prev_close": prev_close,
        "volume": volume,
        "amount": int(volume * price * 10),
        "turnover_rate": _round(0.08 + next(rng) * 2.2),
        "pe": _round(8 + next(rng) * 30, 1),
        "pb": _round(0.8 + next(rng) * 8, 1),
        "market_cap": int(price * (2_000_000_000 + next(rng) * 8_000_000_000)),
        "float_cap": int(price * (1_500_000_000 + next(rng) * 5_000_000_000)),
        "source": SOURCE_FALLBACK,
        "fetched_at": now.isoformat(),
    }


def _build_fallback_kline(code: str, period: KlinePeriod, adjust: AdjustType, limit: int) -> list[dict]:
    """构造确定性降级 K 线。"""
    today = _last_trading_day(_now_utc().replace(hour=0, minute=0, second=0, microsecond=0))
    dates: list[datetime] = []

    if period == "minute":
        sessions = [(9 * 60 + 30, 11 * 60 + 30), (13 * 60, 15 * 60)]
        current = 0
        for start, end in sessions:
            minute = start
            while minute <= end:
                if current >= limit:
                    break
                dates.append(datetime(2026, 9, 1, minute // 60, minute % 60, tzinfo=timezone.utc))
                minute += 2
                current += 1
            if current >= limit:
                break
    elif period == "day":
        cursor = today
        while len(dates) < limit:
            if cursor.weekday() < 5:
                dates.insert(0, cursor)
            cursor = cursor - timedelta(days=1)
    elif period == "week":
        dates = [today - timedelta(days=7 * index) for index in range(limit - 1, -1, -1)]
    else:
        for offset in range(limit - 1, -1, -1):
            year = today.year + (today.month - 1 - offset) // 12
            month_number = (today.month - 1 - offset) % 12 + 1
            dates.append(datetime(year, month_number, 1, tzinfo=timezone.utc))

    latest_price = _base_price(code)
    rng = _random(_seed(f"kline:{code}:{period}:{adjust}"))
    previous_close = latest_price * 0.9
    now = _now_utc()
    result: list[dict] = []

    for index, date in enumerate(dates):
        progress = index / max(len(dates) - 1, 1)
        trend = (progress - 0.5) * 0.08
        wave = (next(rng) - 0.5) * 0.03
        open_price = previous_close
        close = latest_price if index == len(dates) - 1 else _round(latest_price * (1 + trend + wave))
        high = _round(max(open_price, close) * (1 + next(rng) * 0.018))
        low = _round(min(open_price, close) * (1 - next(rng) * 0.018))
        volume = int(1_500_000 + next(rng) * 7_500_000)
        previous_close = close
        result.append(
            {
                "code": code,
                "period": period,
                "ts": date.isoformat(),
                "open": _round(open_price),
                "high": high,
                "low": low,
                "close": _round(close),
                "volume": volume,
                "amount": int(volume * close),
                "adj_type": adjust,
                "source": SOURCE_FALLBACK,
                "fetched_at": now.isoformat(),
            }
        )

    return result


_TRADING_DAYS: set[str] | None = None
_TRADING_DAYS_LOADED_AT: datetime | None = None


def _trading_days() -> set[str] | None:
    """获取全量交易日列表（AkShare），缓存 12 小时；不可用时返回 None。"""
    global _TRADING_DAYS, _TRADING_DAYS_LOADED_AT

    now = _now_utc()
    if (
        _TRADING_DAYS is not None
        and _TRADING_DAYS_LOADED_AT is not None
        and now - _TRADING_DAYS_LOADED_AT < timedelta(hours=12)
    ):
        return _TRADING_DAYS

    if not HAS_AKSHARE:
        return None

    try:
        frame = ak.tool_trade_date_hist_sina()
        if frame is None or frame.empty:
            return None
        days = {str(value)[:10] for value in frame["trade_date"].tolist()}
        days = {day for day in days if len(day) == 10 and day[4] == "-"}
        if not days:
            return None
        _TRADING_DAYS = days
        _TRADING_DAYS_LOADED_AT = now
        return days
    except Exception as exc:  # 上游不可用时退回工作日近似
        logger.warning("获取交易日历失败：%s", exc)
        return None


def _weekday_days(start_date: date, end_date: date) -> list[str]:
    """按工作日近似生成交易日列表，用于交易日历降级。"""
    days: list[str] = []
    cursor = start_date
    while cursor <= end_date:
        if cursor.weekday() < 5:
            days.append(cursor.isoformat())
        cursor = cursor + timedelta(days=1)
    return days


@app.get("/trading-calendar")
def trading_calendar(
    start: str = Query(..., min_length=10, max_length=10),
    end: str = Query(..., min_length=10, max_length=10),
) -> dict:
    """返回 [start, end] 区间内的交易日；AkShare 不可用时退回工作日近似。"""
    try:
        start_date = date.fromisoformat(start)
        end_date = date.fromisoformat(end)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="start/end 必须是 YYYY-MM-DD 格式。") from exc
    if end_date < start_date:
        raise HTTPException(status_code=400, detail="end 不能早于 start。")
    if (end_date - start_date).days > 1500:
        raise HTTPException(status_code=400, detail="查询区间不能超过 1500 天。")

    now = _now_utc()
    calendar = _trading_days()
    if calendar is None:
        return {
            "source": SOURCE_FALLBACK,
            "start": start_date.isoformat(),
            "end": end_date.isoformat(),
            "days": _weekday_days(start_date, end_date),
            "fetched_at": now.isoformat(),
        }

    selected = sorted(day for day in calendar if start_date.isoformat() <= day <= end_date.isoformat())
    return {
        "source": SOURCE_AKSHARE,
        "start": start_date.isoformat(),
        "end": end_date.isoformat(),
        "days": selected,
        "fetched_at": now.isoformat(),
    }

@app.get("/health")
def health() -> dict[str, str]:
    """健康检查：返回服务状态与 AkShare 可用性。"""
    return {
        "status": "ok",
        "service": "data-service",
        "version": "0.2.0",
        "akshare": "available" if HAS_AKSHARE else "unavailable",
    }


@app.get("/quote")
def quote(code: str = Query(..., min_length=6, max_length=6)) -> dict:
    """返回当前行情快照。"""
    return _build_tencent_quote(code) or _build_akshare_quote(code) or _build_fallback_quote(code)


@app.get("/kline")
def kline(
    code: str = Query(..., min_length=6, max_length=6),
    period: KlinePeriod = Query("day"),
    adjust: AdjustType = Query("qfq"),
    limit: int = Query(30, ge=10, le=240),
) -> list[dict]:
    """返回标准化 K 线数据。"""
    return _build_tencent_kline(code, period, adjust, limit) or _build_akshare_kline(code, period, adjust, limit) or _build_fallback_kline(code, period, adjust, limit)
