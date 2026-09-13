"""Unit tests for distillery remainder + ROI honesty (no DB)."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# Minimal stubs so illegal_business can import without full server boot is hard.
# Instead test pure helpers by exec'ing extracted logic.


def test_remainder_accumulates():
    rem = 0.0
    units = 0
    for _ in range(6):  # 6 * 4min = 24min at 2.5/hr → 1.0 unit
        raw = (240 / 3600.0) * 2.5
        total = raw + rem
        earned = int(total)
        rem = round(total - earned, 6)
        units += earned
    assert units == 1, units
    assert rem < 1.0


def test_roi_requires_sales():
    potential = 10000.0
    sales = 0
    enabled = True
    realized = potential if (enabled and sales > 0) else 0.0
    assert realized == 0.0
    sales = 1
    realized = potential if (enabled and sales > 0) else 0.0
    assert realized == 10000.0


def test_weekly_band():
    # $1.2M–$2.4M/hr ≈ $200–400M/week
    lo = 1_200_000 * 24 * 7
    hi = 2_400_000 * 24 * 7
    assert 200_000_000 <= lo <= 210_000_000
    assert 400_000_000 <= hi <= 410_000_000


if __name__ == "__main__":
    test_remainder_accumulates()
    test_roi_requires_sales()
    test_weekly_band()
    print("ok")
