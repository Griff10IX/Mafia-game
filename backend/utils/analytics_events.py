from __future__ import annotations

from datetime import datetime, timedelta, timezone
from hashlib import sha1
from typing import Any, Dict, Optional

from utils.game_timezone import game_day_start_utc, game_month_start_utc, game_week_start_utc


VALID_BUCKETS = ("realtime_5m", "daily", "weekly", "monthly")


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def bucket_start(dt: datetime, bucket: str) -> datetime:
    """Calendar buckets (daily/weekly/monthly) use Europe/London; realtime_5m stays UTC wall clock."""
    d = dt.astimezone(timezone.utc)
    if bucket == "realtime_5m":
        floored_minute = (d.minute // 5) * 5
        return datetime(d.year, d.month, d.day, d.hour, floored_minute, tzinfo=timezone.utc)
    if bucket == "daily":
        return game_day_start_utc(d)
    if bucket == "weekly":
        return game_week_start_utc(d)
    if bucket == "monthly":
        return game_month_start_utc(d)
    raise ValueError(f"Unsupported bucket: {bucket}")


def bucket_iso(dt: datetime, bucket: str) -> str:
    return bucket_start(dt, bucket).isoformat().replace("+00:00", "Z")


def as_iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def make_event_idempotency_key(
    user_id: str,
    domain: str,
    metric: str,
    created_at_iso: str,
    value: float,
    tags: Optional[Dict[str, Any]] = None,
) -> str:
    payload = f"{user_id}|{domain}|{metric}|{created_at_iso}|{value}|{sorted((tags or {}).items())}"
    return sha1(payload.encode("utf-8")).hexdigest()[:32]


async def log_analytics_event(
    db,
    *,
    user_id: str,
    username: str,
    domain: str,
    metric: str,
    value: float = 1.0,
    state: Optional[str] = None,
    created_at: Optional[datetime] = None,
    tags: Optional[Dict[str, Any]] = None,
) -> None:
    now = created_at or utc_now()
    created_iso = as_iso(now)
    safe_tags = tags or {}
    doc = {
        "idempotency_key": make_event_idempotency_key(
            user_id=user_id,
            domain=domain,
            metric=metric,
            created_at_iso=created_iso,
            value=float(value or 0),
            tags=safe_tags,
        ),
        "user_id": user_id,
        "username": username or "?",
        "domain": domain,
        "metric": metric,
        "value": float(value or 0),
        "state": state,
        "tags": safe_tags,
        "created_at": created_iso,
        "buckets": {
            "realtime_5m": bucket_iso(now, "realtime_5m"),
            "daily": bucket_iso(now, "daily"),
            "weekly": bucket_iso(now, "weekly"),
            "monthly": bucket_iso(now, "monthly"),
        },
    }
    await db.analytics_events.update_one(
        {"idempotency_key": doc["idempotency_key"]},
        {"$setOnInsert": doc},
        upsert=True,
    )

