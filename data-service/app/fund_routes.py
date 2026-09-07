"""基金数据侧车路由。

F0 阶段只预留基金端点骨架，统一返回 `source` 与 `fetched_at`。
后续 F1/F2 将在本模块接入 AkShare 与基金确定性回退逻辑。
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Query

router = APIRouter(prefix="/fund", tags=["fund"])

FUND_PLACEHOLDER_SOURCE = "fund-placeholder"


def _now_iso() -> str:
    """返回当前 UTC ISO 时间。"""
    return datetime.now(timezone.utc).isoformat()


def _placeholder(code: str, endpoint: str) -> dict:
    """构造 F0 空端点统一响应。"""
    return {
        "code": code,
        "endpoint": endpoint,
        "status": "not_implemented",
        "message": "基金端点已在 F0 预留，将在后续阶段接入。",
        "source": FUND_PLACEHOLDER_SOURCE,
        "fetched_at": _now_iso(),
    }


@router.get("/profile")
def fund_profile(code: str = Query(..., min_length=6, max_length=6)) -> dict:
    """基金档案端点（F0 空实现）。"""
    return _placeholder(code, "profile")


@router.get("/nav")
def fund_nav(code: str = Query(..., min_length=6, max_length=6)) -> dict:
    """基金历史净值端点（F0 空实现）。"""
    return _placeholder(code, "nav")


@router.get("/intraday")
def fund_intraday(code: str = Query(..., min_length=6, max_length=6)) -> dict:
    """基金实时/估算行情端点（F0 空实现）。"""
    return _placeholder(code, "intraday")


@router.get("/holdings")
def fund_holdings(code: str = Query(..., min_length=6, max_length=6)) -> dict:
    """基金季度持仓端点（F0 空实现）。"""
    return _placeholder(code, "holdings")
