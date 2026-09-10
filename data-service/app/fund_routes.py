"""基金数据侧车路由。

优先接入 AkShare 基金档案与历史净值；当 AkShare 或上游源不可用时，
回退为确定性基金数据，并统一在响应中标记 `source` 与 `fetched_at`。
"""

from __future__ import annotations

import hashlib
import math
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from fastapi import APIRouter, Query

try:
    import akshare as ak
    import pandas as pd

    HAS_AKSHARE = True
except Exception:  # 本地未安装 AkShare 时保留降级能力
    ak = None
    pd = None
    HAS_AKSHARE = False

router = APIRouter(prefix="/fund", tags=["fund"])

FundNavType = Literal["unit", "cumulative"]

SOURCE_AKSHARE = "akshare"
SOURCE_FALLBACK = "deterministic-fallback"
CHINA_TZ = timezone(timedelta(hours=8))

KNOWN_FUNDS: dict[str, dict[str, str]] = {
    "510300": {"name": "沪深300ETF", "type": "index", "trading_mode": "exchange"},
    "000001": {"name": "华夏成长混合", "type": "hybrid", "trading_mode": "otc"},
    "110022": {"name": "易方达消费行业股票", "type": "stock", "trading_mode": "otc"},
    "161725": {"name": "招商中证白酒指数(LOF)", "type": "index", "trading_mode": "exchange"},
    "003376": {"name": "广发中债7-10年国开债指数A", "type": "bond", "trading_mode": "otc"},
    "000008": {"name": "嘉实中证500ETF联接A", "type": "index", "trading_mode": "otc"},
}


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


def _round(value: float, digits: int = 4) -> float:
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


def _as_date(value: Any) -> str:
    """将日期/时间值标准化为 YYYY-MM-DD 字符串。"""
    try:
        if pd is not None:
            timestamp = pd.to_datetime(value, errors="coerce")
            if timestamp is not pd.NaT:
                return timestamp.date().isoformat()
    except Exception:
        pass
    if isinstance(value, datetime):
        return value.date().isoformat()
    text = str(value)
    return text[:10]


def _series_value(row: Any, names: list[str]) -> Any:
    """按候选列名从 pandas 行或字典中取值，兼容 AkShare 版本差异。"""
    for name in names:
        try:
            if isinstance(row, dict):
                if name in row:
                    return row[name]
            elif name in row.index:
                return row[name]
        except (AttributeError, TypeError):
            return None
    return None


def _series_value_contains(row: Any, keyword: str) -> Any:
    """按列名关键字从 pandas 行或字典中取值，用于动态列名。"""
    try:
        if isinstance(row, dict):
            for key, value in row.items():
                if keyword in str(key):
                    return value
            return None
        for column in row.index:
            if keyword in str(column):
                return row[column]
        return None
    except (AttributeError, TypeError):
        return None


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
    except Exception:
        return None


def _tencent_fund_symbol(code: str) -> str:
    """将 6 位基金代码转换为腾讯行情前缀代码。"""
    if code.startswith(("5", "6", "9")):
        return f"sh{code}"
    return f"sz{code}"


def _build_exchange_realtime(code: str) -> dict | None:
    """通过腾讯行情构造场内基金实时快照。"""
    symbol = _tencent_fund_symbol(code)
    text = _curl_get_text(f"https://qt.gtimg.cn/q={symbol}")
    if not text or '="' not in text:
        return None

    try:
        payload = text.split('="', 1)[1].rsplit('"', 1)[0]
        parts = payload.split("~")
        if len(parts) < 47 or parts[2] not in (code, symbol[-6:]):
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
        volume = int(_number(parts[6], 0.0) or 0.0) * 100
        amount = int((_number(parts[37], 0.0) or 0.0) * 10000)
        iopv = _number(parts[39])
        premium_rate = _number(parts[43])
        now = _now_utc()
        return {
            "code": code,
            "mode": "realtime",
            "ts": now.isoformat(),
            "price": _round(price),
            "estimated_nav": iopv,
            "change_pct": _round(change_pct),
            "open": _round(open_price),
            "high": _round(high),
            "low": _round(low),
            "volume": volume,
            "amount": amount,
            "iopv": iopv,
            "premium_rate": _round(premium_rate, 2) if premium_rate is not None else None,
            "official_nav": None,
            "official_nav_date": None,
            "source": SOURCE_AKSHARE,
            "fetched_at": now.isoformat(),
        }
    except Exception:
        return None


_ESTIMATION_ROWS: list[dict] | None = None
_ESTIMATION_LOADED_AT: datetime | None = None


def _estimation_rows() -> list[dict]:
    """获取东方财富全市场盘中估算列表，并缓存 60 秒。"""
    global _ESTIMATION_ROWS, _ESTIMATION_LOADED_AT

    now = _now_utc()
    if (
        _ESTIMATION_ROWS is not None
        and _ESTIMATION_LOADED_AT is not None
        and now - _ESTIMATION_LOADED_AT < timedelta(seconds=60)
    ):
        return _ESTIMATION_ROWS

    if not HAS_AKSHARE:
        return []

    # 东财估值排行页偶发 SSL 中断，重试数次以提高命中率；仍失败则返回空列表走降级。
    for attempt in range(3):
        try:
            frame = ak.fund_value_estimation_em(symbol="全部")
            if frame is None or frame.empty:
                continue
            _ESTIMATION_ROWS = frame.to_dict("records")
            _ESTIMATION_LOADED_AT = now
            return _ESTIMATION_ROWS
        except Exception as exc:
            logger.debug("获取场外估值排行失败（第 %s 次）：%s", attempt + 1, exc)
    return []


def _build_akshare_estimate(code: str) -> dict | None:
    """通过 AkShare 构造场外基金盘中估算快照。"""
    rows = _estimation_rows()
    matched = next(
        (
            row
            for row in rows
            if str(_series_value(row, ["基金代码"])).zfill(6) == code
        ),
        None,
    )
    if matched is None:
        return None

    estimated_nav = _number(_series_value_contains(matched, "估算数据-估算值"))
    if estimated_nav is None:
        return None
    change_text = str(_series_value_contains(matched, "估算数据-估算增长率") or "0")
    change_pct = _number(change_text.replace("%", ""), 0.0) or 0.0
    official_nav = _number(_series_value_contains(matched, "公布数据-单位净值"))
    official_nav_date = None
    now = _now_utc()
    return {
        "code": code,
        "mode": "estimate",
        "ts": now.isoformat(),
        "price": None,
        "estimated_nav": _round(estimated_nav),
        "change_pct": _round(change_pct, 2),
        "open": None,
        "high": None,
        "low": None,
        "volume": None,
        "amount": None,
        "iopv": None,
        "premium_rate": None,
        "official_nav": official_nav,
        "official_nav_date": official_nav_date,
        "source": SOURCE_AKSHARE,
        "fetched_at": now.isoformat(),
    }


def _build_akshare_holdings(code: str) -> dict | None:
    """通过 AkShare 获取最新季度股票持仓并截取前十大。"""
    if not HAS_AKSHARE:
        return None

    current_year = datetime.now(CHINA_TZ).year
    frame = None
    for year in (current_year, current_year - 1):
        try:
            candidate = ak.fund_portfolio_hold_em(symbol=code, date=str(year))
            if candidate is not None and not candidate.empty:
                frame = candidate
                break
        except Exception:
            continue
    if frame is None or frame.empty:
        return None

    quarter_name = str(frame["季度"].max())
    latest = frame[frame["季度"] == quarter_name].copy()
    latest["_weight"] = latest["占净值比例"].apply(lambda value: _number(value, 0.0) or 0.0)
    latest = latest.sort_values("_weight", ascending=False)
    top = latest.head(10)

    top_holdings: list[dict] = []
    for row in top.to_dict("records"):
        top_holdings.append(
            {
                "code": str(_series_value(row, ["股票代码"]) or "") or None,
                "name": str(_series_value(row, ["股票名称"]) or ""),
                "weight_pct": _round(_number(row.get("_weight"), 0.0) or 0.0, 2),
                "change_pct": None,
                "industry": None,
            }
        )

    weights = [item["weight_pct"] for item in top_holdings]
    now = _now_utc()
    return {
        "code": code,
        "report_date": quarter_name,
        "published_at": None,
        "top_holdings": top_holdings,
        "asset_allocation": {},
        "industry_allocation": {},
        "top10_weight_pct": _round(sum(weights), 2) if weights else None,
        "top1_weight_pct": _round(max(weights), 2) if weights else None,
        "source": SOURCE_AKSHARE,
        "fetched_at": now.isoformat(),
    }


def _classify_fund_type(code: str, type_label: str | None = None) -> str:
    """根据基金代码与类型文案识别基金类型。"""
    known = KNOWN_FUNDS.get(code)
    if known:
        return known["type"]

    label = (type_label or "").upper()
    if "债券" in label:
        return "bond"
    if "指数" in label:
        return "index"
    if "混合" in label:
        return "hybrid"
    if "股票" in label or "股权" in label:
        return "stock"
    if "QDII" in label:
        return "qdii"
    if "FOF" in label:
        return "fof"
    if "REIT" in label:
        return "reits"
    if code.startswith(("50", "51", "56", "58", "159")):
        return "index"
    return "other"


def _classify_trading_mode(code: str, fund_type: str) -> str:
    """根据基金代码与类型识别交易模式。"""
    known = KNOWN_FUNDS.get(code)
    if known:
        return known["trading_mode"]
    if code.startswith(("50", "51", "52", "53", "54", "55", "56", "57", "58", "159", "16")):
        return "exchange"
    if fund_type == "reits":
        return "exchange"
    return "otc"


_FUND_NAME_ROWS: list[dict] | None = None
_FUND_NAME_LOADED_AT: datetime | None = None
_FUND_BASIC_INFO_CACHE: dict[str, dict | None] = {}
_FUND_BASIC_INFO_LOADED_AT: dict[str, datetime] = {}


def _fund_name_rows() -> list[dict]:
    """获取全市场基金名称列表，并在进程内缓存 24 小时。"""
    global _FUND_NAME_ROWS, _FUND_NAME_LOADED_AT

    now = _now_utc()
    if (
        _FUND_NAME_ROWS is not None
        and _FUND_NAME_LOADED_AT is not None
        and now - _FUND_NAME_LOADED_AT < timedelta(hours=24)
    ):
        return _FUND_NAME_ROWS

    if not HAS_AKSHARE:
        return []

    try:
        frame = ak.fund_name_em()
        if frame is None or frame.empty:
            return []
        _FUND_NAME_ROWS = frame.to_dict("records")
        _FUND_NAME_LOADED_AT = now
        return _FUND_NAME_ROWS
    except Exception:
        return []


def _parse_fund_scale(value: Any) -> float | None:
    """从类似“24.06亿份（2026-06-30）”的文本中解析规模。"""
    if value is None:
        return None
    text = str(value).strip()
    for unit in ("亿", "万"):
        if unit in text:
            number = _number(text.split(unit, 1)[0], None)
            if number is None:
                return None
            return number if unit == "亿" else number / 10_000
    return _number(text, None)


def _fund_basic_info(code: str) -> dict | None:
    """按基金代码从同花顺获取基金基本信息，缓存 24 小时。"""
    now = _now_utc()
    if (
        code in _FUND_BASIC_INFO_CACHE
        and code in _FUND_BASIC_INFO_LOADED_AT
        and now - _FUND_BASIC_INFO_LOADED_AT[code] < timedelta(hours=24)
    ):
        return _FUND_BASIC_INFO_CACHE[code]

    if not HAS_AKSHARE:
        _FUND_BASIC_INFO_CACHE[code] = None
        _FUND_BASIC_INFO_LOADED_AT[code] = now
        return None

    try:
        frame = ak.fund_info_ths(symbol=code)
        if frame is None or frame.empty:
            _FUND_BASIC_INFO_CACHE[code] = None
            _FUND_BASIC_INFO_LOADED_AT[code] = now
            return None

        info: dict[str, Any] = {}
        for row in frame.to_dict("records"):
            field = str(_series_value(row, ["字段", "item"]) or "").strip()
            value = _series_value(row, ["值", "value"])
            if field:
                info[field] = value

        _FUND_BASIC_INFO_CACHE[code] = info
        _FUND_BASIC_INFO_LOADED_AT[code] = now
        return info
    except Exception:
        _FUND_BASIC_INFO_CACHE[code] = None
        _FUND_BASIC_INFO_LOADED_AT[code] = now
        return None


def _build_akshare_fund_profile(code: str) -> dict | None:
    """通过 AkShare 基金名称列表构造基金档案。"""
    basic_info = _fund_basic_info(code)
    if basic_info:
        known = KNOWN_FUNDS.get(code, {})
        name = str(
            basic_info.get("基金简称")
            or basic_info.get("基金全称")
            or known.get("name")
            or f"基金 {code}"
        )
        type_label = str(basic_info.get("基金类型") or basic_info.get("投资类型") or "")
        fund_type = _classify_fund_type(code, type_label)
        trading_mode = _classify_trading_mode(code, fund_type)
        now = _now_utc()
        return {
            "code": code,
            "name": name,
            "type": fund_type,
            "trading_mode": trading_mode,
            "manager": str(basic_info["基金经理"]) if basic_info.get("基金经理") else None,
            "company": str(basic_info["基金管理人"]) if basic_info.get("基金管理人") else None,
            "benchmark": str(basic_info["业绩比较基准"]) if basic_info.get("业绩比较基准") else None,
            "establish_date": str(basic_info["成立日期"]) if basic_info.get("成立日期") else None,
            "scale": _parse_fund_scale(basic_info.get("份额规模") or basic_info.get("成立规模")),
            "risk_level": None,
            "source": SOURCE_AKSHARE,
            "fetched_at": now.isoformat(),
        }

    rows = _fund_name_rows()
    if not rows:
        return None

    matched = next(
        (
            row
            for row in rows
            if str(_series_value(row, ["基金代码"])).zfill(6) == code
        ),
        None,
    )
    if matched is None:
        return None

    name = str(_series_value(matched, ["基金简称"]) or KNOWN_FUNDS.get(code, {}).get("name", f"基金 {code}"))
    type_label = _series_value(matched, ["基金类型"])
    fund_type = _classify_fund_type(code, str(type_label) if type_label is not None else None)
    trading_mode = _classify_trading_mode(code, fund_type)
    now = _now_utc()

    return {
        "code": code,
        "name": name,
        "type": fund_type,
        "trading_mode": trading_mode,
        "manager": None,
        "company": None,
        "benchmark": None,
        "establish_date": None,
        "scale": None,
        "risk_level": None,
        "source": SOURCE_AKSHARE,
        "fetched_at": now.isoformat(),
    }


def _build_akshare_fund_nav(code: str, start_date: str, end_date: str) -> list[dict] | None:
    """通过 AkShare 获取单位净值与累计净值并合并。"""
    if not HAS_AKSHARE:
        return None

    try:
        unit_frame = ak.fund_open_fund_info_em(
            symbol=code,
            indicator="单位净值走势",
            period="成立以来",
        )
        cumulative_frame = ak.fund_open_fund_info_em(
            symbol=code,
            indicator="累计净值走势",
            period="成立以来",
        )
    except Exception:
        return None

    if unit_frame is None or unit_frame.empty:
        return None

    unit_by_date: dict[str, tuple[float, float | None]] = {}
    for row in unit_frame.to_dict("records"):
        date = _as_date(_series_value(row, ["净值日期"]))
        unit_nav = _number(_series_value(row, ["单位净值"]))
        if not date or unit_nav is None:
            continue
        change_pct = _number(_series_value(row, ["日增长率"]), None)
        unit_by_date[date] = (unit_nav, change_pct)

    cumulative_by_date: dict[str, float] = {}
    if cumulative_frame is not None and not cumulative_frame.empty:
        for row in cumulative_frame.to_dict("records"):
            date = _as_date(_series_value(row, ["净值日期"]))
            cumulative_nav = _number(_series_value(row, ["累计净值"]))
            if date and cumulative_nav is not None:
                cumulative_by_date[date] = cumulative_nav

    dates = sorted(set(unit_by_date) | set(cumulative_by_date))
    if start_date:
        dates = [date for date in dates if date >= start_date]
    if end_date:
        dates = [date for date in dates if date <= end_date]

    now = _now_utc()
    result: list[dict] = []
    for date in dates:
        unit_nav, change_pct = unit_by_date.get(date, (None, None))
        if unit_nav is None:
            continue
        cumulative_nav = cumulative_by_date.get(date, unit_nav)
        result.append(
            {
                "code": code,
                "nav_date": date,
                "unit_nav": _round(unit_nav),
                "cumulative_nav": _round(cumulative_nav),
                "daily_change_pct": _round(change_pct, 2) if change_pct is not None else None,
                "source": SOURCE_AKSHARE,
                "fetched_at": now.isoformat(),
            }
        )

    return result or None


def _build_fallback_fund_profile(code: str) -> dict:
    """构造确定性降级基金档案。"""
    known = KNOWN_FUNDS.get(code)
    fund_type = _classify_fund_type(code)
    trading_mode = _classify_trading_mode(code, fund_type)
    now = _now_utc()
    return {
        "code": code,
        "name": known["name"] if known else f"基金 {code}",
        "type": fund_type,
        "trading_mode": trading_mode,
        "manager": None,
        "company": None,
        "benchmark": None,
        "establish_date": None,
        "scale": None,
        "risk_level": None,
        "source": SOURCE_FALLBACK,
        "fetched_at": now.isoformat(),
    }


def _build_fallback_fund_nav(code: str, start_date: str, end_date: str) -> list[dict]:
    """构造确定性降级历史净值。"""
    today = _now_utc().astimezone(CHINA_TZ).date()
    end = datetime.fromisoformat(end_date).date() if end_date else today
    start = datetime.fromisoformat(start_date).date() if start_date else end - timedelta(days=365)
    start = max(start, end - timedelta(days=365 * 3))

    rng = _random(_seed(f"fund:nav:{code}"))
    base_nav = 1 + next(rng) * 4
    drift = (next(rng) - 0.42) * 0.0006
    unit_nav = round(base_nav * 0.88, 4)
    cumulative_nav = unit_nav
    previous_nav = unit_nav
    now = _now_utc()
    result: list[dict] = []
    cursor = start

    while cursor <= end:
        if cursor.weekday() < 5:
            wave = (next(rng) - 0.5) * 0.018
            daily_return = drift + wave
            previous_nav = unit_nav
            unit_nav = max(0.5, round(unit_nav * (1 + daily_return), 4))
            cumulative_nav = max(0.5, round(cumulative_nav * (1 + daily_return), 4))
            result.append(
                {
                    "code": code,
                    "nav_date": cursor.isoformat(),
                    "unit_nav": _round(unit_nav),
                    "cumulative_nav": _round(cumulative_nav),
                    "daily_change_pct": _round((unit_nav / previous_nav - 1) * 100, 2)
                    if previous_nav > 0
                    else None,
                    "source": SOURCE_FALLBACK,
                    "fetched_at": now.isoformat(),
                }
            )
        cursor += timedelta(days=1)

    return result


def _build_fallback_fund_intraday(code: str) -> dict:
    """构造确定性降级当日行情/估算数据。"""
    fund_type = _classify_fund_type(code)
    trading_mode = _classify_trading_mode(code, fund_type)
    rng = _random(_seed(f"fund:intraday:{code}"))
    now = _now_utc()

    if trading_mode == "exchange":
        price = round(0.8 + next(rng) * 4.5, 4)
        change_pct = round((next(rng) - 0.48) * 2.6, 2)
        previous_close = price / (1 + change_pct / 100)
        open_price = round(previous_close * (1 + (next(rng) - 0.5) * 0.012), 4)
        high = round(max(price, open_price, previous_close) * (1 + next(rng) * 0.008), 4)
        low = round(min(price, open_price, previous_close) * (1 - next(rng) * 0.008), 4)
        iopv = round(price * (1 + (next(rng) - 0.5) * 0.004), 4)
        premium_rate = round((price / iopv - 1) * 100, 2) if iopv else None
        return {
            "code": code,
            "mode": "realtime",
            "ts": now.isoformat(),
            "price": price,
            "estimated_nav": iopv,
            "change_pct": change_pct,
            "open": open_price,
            "high": high,
            "low": low,
            "volume": int(next(rng) * 8_000_000),
            "amount": int(next(rng) * 3_000_000_000),
            "iopv": iopv,
            "premium_rate": premium_rate,
            "official_nav": None,
            "official_nav_date": None,
            "source": SOURCE_FALLBACK,
            "fetched_at": now.isoformat(),
        }

    estimated_nav = round(1 + next(rng) * 3.2, 4)
    change_pct = round((next(rng) - 0.48) * 2.2, 2)
    official_nav = round(estimated_nav / (1 + change_pct / 100), 4)
    return {
        "code": code,
        "mode": "estimate",
        "ts": now.isoformat(),
        "price": None,
        "estimated_nav": estimated_nav,
        "change_pct": change_pct,
        "open": None,
        "high": None,
        "low": None,
        "volume": None,
        "amount": None,
        "iopv": None,
        "premium_rate": None,
        "official_nav": official_nav,
        "official_nav_date": None,
        "source": SOURCE_FALLBACK,
        "fetched_at": now.isoformat(),
    }


def _previous_quarter_end(value: Any) -> Any:
    """返回当前日期之前最近一个季度末日期。"""
    date_value = value
    if isinstance(date_value, datetime):
        date_value = date_value.date()
    quarter_start_month = ((date_value.month - 1) // 3) * 3 + 1
    return date_value.replace(year=date_value.year, month=quarter_start_month, day=1) - timedelta(days=1)


def _build_fallback_fund_holdings(code: str) -> dict:
    """构造确定性降级季度持仓数据。"""
    today = _now_utc().astimezone(CHINA_TZ).date()
    report_date = _previous_quarter_end(today).isoformat()
    rng = _random(_seed(f"fund:holdings:{code}"))
    names = [
        "示例重仓资产一",
        "示例重仓资产二",
        "示例重仓资产三",
        "示例重仓资产四",
        "示例重仓资产五",
        "示例重仓资产六",
        "示例重仓资产七",
        "示例重仓资产八",
        "示例重仓资产九",
        "示例重仓资产十",
    ]
    raw_weights = [1 + next(rng) * 5 for _ in names]
    total = sum(raw_weights) or 1
    weighted = sorted(
        [(names[index], round(value / total * 58, 2)) for index, value in enumerate(raw_weights)],
        key=lambda item: item[1],
        reverse=True,
    )
    weights = [item[1] for item in weighted]
    names = [item[0] for item in weighted]
    top_holdings = [
        {
            "code": None,
            "name": names[index],
            "weight_pct": weights[index],
            "change_pct": None,
            "industry": None,
        }
        for index in range(len(names))
    ]
    now = _now_utc()
    return {
        "code": code,
        "report_date": report_date,
        "published_at": None,
        "top_holdings": top_holdings,
        "asset_allocation": {},
        "industry_allocation": {},
        "top10_weight_pct": _round(sum(weights), 2),
        "top1_weight_pct": _round(max(weights), 2),
        "source": SOURCE_FALLBACK,
        "fetched_at": now.isoformat(),
    }


@router.get("/profile")
def fund_profile(code: str = Query(..., min_length=6, max_length=6)) -> dict:
    """基金档案与类型识别。"""
    return _build_akshare_fund_profile(code) or _build_fallback_fund_profile(code)


@router.get("/nav")
def fund_nav(
    code: str = Query(..., min_length=6, max_length=6),
    start: str = Query(""),
    end: str = Query(""),
    nav_type: FundNavType = Query("unit"),
) -> list[dict]:
    """基金历史净值，始终返回单位与累计净值。"""
    del nav_type  # 前端可自行切换口径，侧车统一返回双口径数据。
    return _build_akshare_fund_nav(code, start, end) or _build_fallback_fund_nav(code, start, end)


@router.get("/intraday")
def fund_intraday(code: str = Query(..., min_length=6, max_length=6)) -> dict:
    """基金当日行情：场内实时，场外盘中估算。"""
    fund_type = _classify_fund_type(code)
    trading_mode = _classify_trading_mode(code, fund_type)
    if trading_mode == "exchange":
        return _build_exchange_realtime(code) or _build_fallback_fund_intraday(code)
    return _build_akshare_estimate(code) or _build_fallback_fund_intraday(code)


@router.get("/holdings")
def fund_holdings(code: str = Query(..., min_length=6, max_length=6)) -> dict:
    """基金最新季度持仓与前十大重仓资产。"""
    return _build_akshare_holdings(code) or _build_fallback_fund_holdings(code)
