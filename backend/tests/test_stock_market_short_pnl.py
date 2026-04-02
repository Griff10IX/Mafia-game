"""
Regression: short opens deduct margin; close credits margin + profit_points
so net round-trip equals profit_points (same as long-style stake).
"""
import unittest


def _short_close_settlement(margin_pts: int, open_price: float, close_price: float):
    units = margin_pts / open_price
    profit_points = round(units * (open_price - close_price), 0)
    points_delta = margin_pts + profit_points
    return profit_points, points_delta


class TestStockMarketShortPnl(unittest.TestCase):
    def test_short_margin_roundtrip_profit(self):
        margin = 1000
        profit_points, points_delta = _short_close_settlement(margin, 100.0, 90.0)
        self.assertEqual(profit_points, 100)
        self.assertEqual(points_delta, 1100)
        self.assertEqual(-margin + points_delta, profit_points)

    def test_short_margin_roundtrip_loss(self):
        margin = 1000
        profit_points, points_delta = _short_close_settlement(margin, 100.0, 110.0)
        self.assertEqual(profit_points, -100)
        self.assertEqual(points_delta, 900)
        self.assertEqual(-margin + points_delta, profit_points)


if __name__ == "__main__":
    unittest.main()
