"""Unit tests for minigame run session scoring bounds."""
from datetime import datetime, timezone, timedelta

from utils.minigame_run_session import max_numeric_score_for_session


def test_max_numeric_score_elapsed_cap():
    started = datetime(2025, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
    sess = {"started_at": started}
    now = started + timedelta(seconds=500)
    uncapped = max_numeric_score_for_session(
        sess,
        now_dt=now,
        max_score_cap=1_000_000,
        rate_per_second=10.0,
        buffer=0,
    )
    assert uncapped == 500 * 10

    capped = max_numeric_score_for_session(
        sess,
        now_dt=now,
        max_score_cap=1_000_000,
        rate_per_second=10.0,
        buffer=0,
        max_elapsed_seconds=120.0,
    )
    assert capped == 120 * 10


def test_max_numeric_score_buffer_respects_cap():
    started = datetime(2025, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
    sess = {"started_at": started}
    now = started + timedelta(hours=2)
    v = max_numeric_score_for_session(
        sess,
        now_dt=now,
        max_score_cap=999_999,
        rate_per_second=1.0,
        buffer=5,
        max_elapsed_seconds=10.0,
    )
    assert v == 15


def test_max_numeric_score_respects_max_score_cap():
    started = datetime(2025, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
    sess = {"started_at": started}
    now = started + timedelta(seconds=100)
    v = max_numeric_score_for_session(
        sess,
        now_dt=now,
        max_score_cap=50,
        rate_per_second=100.0,
        buffer=0,
    )
    assert v == 50
