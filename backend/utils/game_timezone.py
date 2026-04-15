"""Game calendar in Europe/London (BST/DST). Instants in DB stay UTC."""
from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

GAME_TZ = ZoneInfo("Europe/London")


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def game_local_now(utc_dt: datetime | None = None) -> datetime:
    if utc_dt is None:
        utc_dt = utc_now()
    return _as_utc(utc_dt).astimezone(GAME_TZ)


def game_today_date_str(utc_dt: datetime | None = None) -> str:
    """London calendar date YYYY-MM-DD for the given UTC instant (default: now)."""
    return game_local_now(utc_dt).date().isoformat()


def game_week_start_date_str(utc_dt: datetime | None = None) -> str:
    """Monday 00:00 London week: ISO date of that Monday (London calendar)."""
    loc = game_local_now(utc_dt)
    d = loc.date()
    monday = d - timedelta(days=d.weekday())
    return monday.isoformat()


def game_month_start_date_str(utc_dt: datetime | None = None) -> str:
    """First day of the London calendar month containing utc_dt."""
    loc = game_local_now(utc_dt)
    d = loc.date()
    return date(d.year, d.month, 1).isoformat()


def game_day_start_utc(utc_dt: datetime | None = None) -> datetime:
    """London midnight (start of London calendar day) as UTC-aware."""
    loc = game_local_now(utc_dt)
    d = loc.date()
    return datetime.combine(d, time.min, tzinfo=GAME_TZ).astimezone(timezone.utc)


def game_week_start_utc(utc_dt: datetime | None = None) -> datetime:
    """Monday 00:00 Europe/London as UTC-aware."""
    loc = game_local_now(utc_dt)
    d = loc.date()
    monday = d - timedelta(days=d.weekday())
    return datetime.combine(monday, time.min, tzinfo=GAME_TZ).astimezone(timezone.utc)


def game_week_range_utc(utc_dt: datetime | None = None) -> tuple[datetime, datetime]:
    """[start, end) for the London week containing utc_dt, as UTC instants."""
    start = game_week_start_utc(utc_dt)
    return start, start + timedelta(days=7)


def game_month_start_utc(utc_dt: datetime | None = None) -> datetime:
    """First of month 00:00 London as UTC-aware."""
    loc = game_local_now(utc_dt)
    d = loc.date()
    first = date(d.year, d.month, 1)
    return datetime.combine(first, time.min, tzinfo=GAME_TZ).astimezone(timezone.utc)
