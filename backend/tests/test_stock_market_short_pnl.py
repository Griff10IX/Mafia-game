"""
Regression: short open credits full notional; close must only apply -cost_to_cover
so round-trip net equals profit_points (not double-counting profit on close).

Mirrors logic in routers/money/stock_market.py (open short + cover).
"""
import unittest


def _short_close_deltas(open_notional_pts: int, open_price: float, close_price: float):
    units = open_notional_pts / open_price
    cost_to_cover = round(units * close_price, 0)
    profit_points = round(units * (open_price - close_price), 0)
    return cost_to_cover, profit_points


class TestStockMarketShortPnl(unittest.TestCase):
    def test_short_roundtrip_profit_matches_notional_minus_cover(self):
        """Open at 100, notional 1000 → close at 90: net +100 (10 units × $10)."""
        notional = 1000
        cost_to_cover, profit_points = _short_close_deltas(notional, 100.0, 90.0)
        self.assertEqual(cost_to_cover, 900)
        self.assertEqual(profit_points, 100)
        self.assertEqual(notional - cost_to_cover, profit_points)

    def test_short_roundtrip_loss_matches_notional_minus_cover(self):
        """Price rises: net loss."""
        notional = 1000
        cost_to_cover, profit_points = _short_close_deltas(notional, 100.0, 110.0)
        self.assertEqual(cost_to_cover, 1100)
        self.assertEqual(profit_points, -100)
        self.assertEqual(notional - cost_to_cover, profit_points)


if __name__ == "__main__":
    unittest.main()
