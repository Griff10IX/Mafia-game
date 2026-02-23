# Stock market: list stocks (simulated prices), buy/sell with points, positions, history
from datetime import datetime, timezone
from typing import Optional
import math
import uuid

from pydantic import BaseModel
from fastapi import Depends, HTTPException

from server import db, get_current_user, send_notification

# Deterministic price simulation: same timestamp => same price for a stock
def _price_at(stock_id: str, base_price: float, at_ts: float) -> float:
    seed = hash(stock_id) % (2 ** 31)
    t = at_ts / 3600.0  # hours
    drift = 0.02 * math.sin(seed + t * 0.1) + 0.015 * math.sin(seed * 2 + t * 0.05)
    return max(0.01, base_price * (1 + drift))

def _get_prices(stock: dict, now_ts: float):
    sid = stock.get("id") or ""
    base = float(stock.get("base_price") or 100)
    now_price = _price_at(sid, base, now_ts)
    ts_3h = now_ts - 3 * 3600
    ts_1d = now_ts - 24 * 3600
    ts_3d = now_ts - 3 * 24 * 3600
    ts_1w = now_ts - 7 * 24 * 3600
    return {
        "price": round(now_price, 2),
        "price_3h": round(_price_at(sid, base, ts_3h), 2),
        "price_1d": round(_price_at(sid, base, ts_1d), 2),
        "price_3d": round(_price_at(sid, base, ts_3d), 2),
        "price_1w": round(_price_at(sid, base, ts_1w), 2),
    }

STOCKS = [
    {"id": "btc", "name": "Bitcoin", "symbol": "BTC", "base_price": 64935},
    {"id": "eth", "name": "Ethereum", "symbol": "ETH", "base_price": 1866},
    {"id": "sol", "name": "Solana", "symbol": "SOL", "base_price": 142},
    {"id": "ltc", "name": "Litecoin", "symbol": "LTC", "base_price": 72},
    {"id": "avax", "name": "Avalanche", "symbol": "AVAX", "base_price": 28},
    {"id": "xrp", "name": "XRP", "symbol": "XRP", "base_price": 0.52},
    {"id": "ada", "name": "Cardano", "symbol": "ADA", "base_price": 0.38},
    {"id": "xlm", "name": "Stellar", "symbol": "XLM", "base_price": 0.11},
    {"id": "matic", "name": "Polygon", "symbol": "MATIC", "base_price": 0.42},
    {"id": "doge", "name": "Dogecoin", "symbol": "DOGE", "base_price": 0.14},
]


class StockBuyRequest(BaseModel):
    stock_id: str
    points: int
    stop_loss_pct: Optional[float] = None
    take_profit_pct: Optional[float] = None


class StockSellRequest(BaseModel):
    position_id: str


def register(router):
    @router.get("/stock-market/list")
    async def stock_market_list(current_user: dict = Depends(get_current_user)):
        """List all stocks with current price and % change over 3h, 1d, 3d, 1w."""
        now = datetime.now(timezone.utc)
        now_ts = now.timestamp()
        out = []
        for s in STOCKS:
            p = _get_prices(s, now_ts)
            def pct(cur, past):
                if past <= 0:
                    return 0.0
                return round((cur - past) / past * 100, 2)
            out.append({
                "id": s["id"],
                "name": s["name"],
                "symbol": s.get("symbol", s["id"].upper()),
                "price": p["price"],
                "change_3h": pct(p["price"], p["price_3h"]),
                "change_1d": pct(p["price"], p["price_1d"]),
                "change_3d": pct(p["price"], p["price_3d"]),
                "change_1w": pct(p["price"], p["price_1w"]),
            })
        return {"stocks": out}

    @router.get("/stock-market/positions")
    async def stock_market_positions(current_user: dict = Depends(get_current_user)):
        """Current open positions and current value (using live price)."""
        uid = current_user["id"]
        now_ts = datetime.now(timezone.utc).timestamp()
        catalog = {s["id"]: s for s in STOCKS}
        cursor = db.stock_positions.find({"user_id": uid}, {"_id": 0})
        positions = await cursor.to_list(100)
        out = []
        for pos in positions:
            stock = catalog.get(pos.get("stock_id"))
            if not stock:
                continue
            buy_price = float(pos.get("buy_price") or 0)
            units = float(pos.get("units") or 0)
            current_price = _get_prices(stock, now_ts)["price"]
            value_pts = round(units * current_price, 0)
            cost_pts = round(units * buy_price, 0)
            profit_pts = round(value_pts - cost_pts, 0)
            out.append({
                "id": pos.get("id"),
                "stock_id": pos.get("stock_id"),
                "stock_name": stock.get("name"),
                "symbol": stock.get("symbol"),
                "units": round(units, 6),
                "buy_price": buy_price,
                "current_price": current_price,
                "value_points": int(value_pts),
                "cost_points": int(cost_pts),
                "profit_points": int(profit_pts),
                "bought_at": pos.get("bought_at"),
            })
        return {"positions": out}

    @router.get("/stock-market/history")
    async def stock_market_history(current_user: dict = Depends(get_current_user)):
        """Transaction history (buys and sells)."""
        uid = current_user["id"]
        cursor = db.stock_transactions.find({"user_id": uid}, {"_id": 0}).sort("created_at", -1)
        items = await cursor.to_list(100)
        return {"history": items}

    @router.get("/stock-market/summary")
    async def stock_market_summary(current_user: dict = Depends(get_current_user)):
        """Total trades count and total profit (from closed positions)."""
        uid = current_user["id"]
        cursor = db.stock_transactions.find({"user_id": uid}, {"_id": 0, "type": 1, "profit_points": 1})
        items = await cursor.to_list(1000)
        total_trades = len(items)
        total_profit = sum(int(t.get("profit_points") or 0) for t in items)
        return {"total_trades": total_trades, "total_profit": total_profit}

    @router.post("/stock-market/buy")
    async def stock_market_buy(request: StockBuyRequest, current_user: dict = Depends(get_current_user)):
        """Spend points to buy stock at current price. Optional stop_loss_pct and take_profit_pct (0-100)."""
        uid = current_user["id"]
        username = current_user.get("username") or "?"
        stock = next((s for s in STOCKS if s["id"] == request.stock_id), None)
        if not stock:
            raise HTTPException(status_code=404, detail="Stock not found")
        points = max(1, int(request.points or 0))
        now = datetime.now(timezone.utc)
        now_ts = now.timestamp()
        current_price = _get_prices(stock, now_ts)["price"]
        if current_price <= 0:
            raise HTTPException(status_code=400, detail="Invalid price")
        units = points / current_price

        user = await db.users.find_one({"id": uid}, {"_id": 0, "points": 1})
        if not user:
            raise HTTPException(status_code=400, detail="User not found")
        if points > int(user.get("points") or 0):
            raise HTTPException(status_code=400, detail="Insufficient points")

        position_id = str(uuid.uuid4())
        now_iso = now.isoformat()
        await db.users.update_one({"id": uid}, {"$inc": {"points": -points}})
        await db.stock_positions.insert_one({
            "id": position_id,
            "user_id": uid,
            "stock_id": request.stock_id,
            "units": units,
            "buy_price": current_price,
            "bought_at": now_iso,
            "stop_loss_pct": request.stop_loss_pct,
            "take_profit_pct": request.take_profit_pct,
        })
        await db.stock_transactions.insert_one({
            "id": str(uuid.uuid4()),
            "user_id": uid,
            "stock_id": request.stock_id,
            "stock_name": stock.get("name"),
            "type": "buy",
            "units": units,
            "price": current_price,
            "points_spent": points,
            "profit_points": 0,
            "created_at": now_iso,
        })
        return {"message": f"Bought {stock.get('name')} for {points} points", "position_id": position_id, "units": round(units, 6), "price": current_price}

    @router.post("/stock-market/sell")
    async def stock_market_sell(request: StockSellRequest, current_user: dict = Depends(get_current_user)):
        """Sell a position. Receive value at current price; profit/loss added to points."""
        uid = current_user["id"]
        pos = await db.stock_positions.find_one({"id": request.position_id, "user_id": uid}, {"_id": 0})
        if not pos:
            raise HTTPException(status_code=404, detail="Position not found")
        stock = next((s for s in STOCKS if s["id"] == pos.get("stock_id")), None)
        if not stock:
            raise HTTPException(status_code=400, detail="Stock not found")
        now = datetime.now(timezone.utc)
        now_ts = now.timestamp()
        current_price = _get_prices(stock, now_ts)["price"]
        units = float(pos.get("units") or 0)
        buy_price = float(pos.get("buy_price") or 0)
        value_points = round(units * current_price, 0)
        cost_points = round(units * buy_price, 0)
        profit_points = value_points - cost_points

        await db.stock_positions.delete_one({"id": request.position_id, "user_id": uid})
        await db.users.update_one({"id": uid}, {"$inc": {"points": value_points}})
        now_iso = now.isoformat()
        await db.stock_transactions.insert_one({
            "id": str(uuid.uuid4()),
            "user_id": uid,
            "stock_id": pos.get("stock_id"),
            "stock_name": stock.get("name"),
            "type": "sell",
            "units": units,
            "price": current_price,
            "points_spent": 0,
            "points_received": value_points,
            "profit_points": profit_points,
            "created_at": now_iso,
        })
        if profit_points > 0:
            await send_notification(uid, "📈 Stock sold", f"You sold {stock.get('name')} for a profit of {profit_points} points!", "reward")
        return {"message": f"Sold {stock.get('name')} for {value_points} points", "value_points": value_points, "profit_points": profit_points}
