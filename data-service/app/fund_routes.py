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


def _build_akshare_fund_profile(code: str) -> dict | None:
    """通过 AkShare 基金名称列表构造基金档案。"""
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
