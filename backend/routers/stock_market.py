# Stock market: list stocks (live prices via CoinGecko), buy/sell with points, positions, history
from datetime import datetime, timezone
from typing import Optional
import asyncio
import math
import time
import uuid

import httpx
from pydantic import BaseModel
from fastapi import Depends, HTTPException

from server import db, get_current_user, send_notification

# CoinGecko API (free, no key). Cache to respect rate limits.
COINGECKO_BASE = "https://api.coingecko.com/api/v3"
_LIVE_CACHE = {"data": None, "ts": 0}
CACHE_TTL_SEC = 60  # 1 minute
SELL_COOLDOWN_SEC = 180  # 3 minutes after buy before allowed to sell

STOCKS = [
    {"id": "btc", "name": "Bitcoin", "symbol": "BTC", "coingecko_id": "bitcoin", "base_price": 64935},
    {"id": "eth", "name": "Ethereum", "symbol": "ETH", "coingecko_id": "ethereum", "base_price": 1866},
    {"id": "sol", "name": "Solana", "symbol": "SOL", "coingecko_id": "solana", "base_price": 142},
    {"id": "ltc", "name": "Litecoin", "symbol": "LTC", "coingecko_id": "litecoin", "base_price": 72},
    {"id": "avax", "name": "Avalanche", "symbol": "AVAX", "coingecko_id": "avalanche-2", "base_price": 28},
    {"id": "xrp", "name": "XRP", "symbol": "XRP", "coingecko_id": "ripple", "base_price": 0.52},
    {"id": "ada", "name": "Cardano", "symbol": "ADA", "coingecko_id": "cardano", "base_price": 0.38},
    {"id": "xlm", "name": "Stellar", "symbol": "XLM", "coingecko_id": "stellar", "base_price": 0.11},
    {"id": "matic", "name": "Polygon", "symbol": "MATIC", "coingecko_id": "polygon", "base_price": 0.42},
    {"id": "doge", "name": "Dogecoin", "symbol": "DOGE", "coingecko_id": "dogecoin", "base_price": 0.14},
]


def _closest_price(prices: list, target_ts_ms: int) -> Optional[float]:
    """From [[ts_ms, price], ...] return price at closest timestamp to target_ts_ms."""
    if not prices:
        return None
    best = None
    best_diff = float("inf")
    for ts_ms, price in prices:
        diff = abs(ts_ms - target_ts_ms)
        if diff < best_diff:
            best_diff = diff
            best = price
    return best


async def _fetch_live_prices() -> list:
    """Fetch real prices and % changes from CoinGecko. Returns list of {id, name, symbol, price, change_3h, change_1d, change_3d, change_1w}."""
    now_ts = time.time()
    now_ms = int(now_ts * 1000)
    ts_3h = now_ms - 3 * 3600 * 1000
    ts_1d = now_ms - 24 * 3600 * 1000
    ts_3d = now_ms - 3 * 24 * 3600 * 1000
    ts_1w = now_ms - 7 * 24 * 3600 * 1000

    async def fetch_one(s: dict):
        cg_id = s.get("coingecko_id") or s["id"]
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                r = await client.get(f"{COINGECKO_BASE}/coins/{cg_id}/market_chart", params={"vs_currency": "usd", "days": "7"})
                if r.status_code != 200:
                    return None
                data = r.json()
                prices = data.get("prices") or []
                if not prices:
                    return None
                current = prices[-1][1]
                p_3h = _closest_price(prices, ts_3h) or current
                p_1d = _closest_price(prices, ts_1d) or current
                p_3d = _closest_price(prices, ts_3d) or current
                p_1w = _closest_price(prices, ts_1w) or current
                def pct(cur, past):
                    if past and past > 0:
                        return round((cur - past) / past * 100, 2)
                    return 0.0
                return {
                    "id": s["id"],
                    "name": s["name"],
                    "symbol": s.get("symbol", s["id"].upper()),
                    "price": round(current, 2),
                    "change_3h": pct(current, p_3h),
                    "change_1d": pct(current, p_1d),
                    "change_3d": pct(current, p_3d),
                    "change_1w": pct(current, p_1w),
                }
        except Exception:
            return None

    results = await asyncio.gather(*[fetch_one(s) for s in STOCKS])
    out = [r for r in results if r is not None]
    return out


async def _get_cached_live_prices() -> list:
    """Return cached live prices; refresh if expired."""
    now = time.time()
    if _LIVE_CACHE["data"] is not None and (now - _LIVE_CACHE["ts"]) < CACHE_TTL_SEC:
        return _LIVE_CACHE["data"]
    try:
        data = await _fetch_live_prices()
        if data:
            _LIVE_CACHE["data"] = data
            _LIVE_CACHE["ts"] = now
            return data
    except Exception:
        pass
    return _LIVE_CACHE["data"] or []


def _get_price_by_stock_id(live_list: list, stock_id: str) -> Optional[float]:
    """Get current price for stock_id from live list. Fallback for positions/sell if missing."""
    for item in live_list:
        if item.get("id") == stock_id:
            return item.get("price")
    return None


# Fallback when CoinGecko is unavailable (deterministic from time)
def _fallback_price(stock: dict, now_ts: float) -> float:
    sid = stock.get("id") or ""
    base = float(stock.get("base_price") or 100)
    seed = hash(sid) % (2 ** 31)
    t = now_ts / 3600.0
    drift = 0.02 * math.sin(seed + t * 0.1) + 0.015 * math.sin(seed * 2 + t * 0.05)
    return max(0.01, base * (1 + drift))


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
        """List all stocks with current price and % change over 3h, 1d, 3d, 1w (live from CoinGecko, fallback if API down)."""
        now_ts = datetime.now(timezone.utc).timestamp()
        live_list = await _get_cached_live_prices()
        live_by_id = {item["id"]: item for item in live_list}
        out = []
        for s in STOCKS:
            sid = s["id"]
            if sid in live_by_id:
                item = live_by_id[sid]
                out.append({
                    "id": item["id"],
                    "name": item["name"],
                    "symbol": item.get("symbol", sid.upper()),
                    "price": item["price"],
                    "change_3h": item.get("change_3h", 0),
                    "change_1d": item.get("change_1d", 0),
                    "change_3d": item.get("change_3d", 0),
                    "change_1w": item.get("change_1w", 0),
                })
            else:
                price = _fallback_price(s, now_ts)
                out.append({
                    "id": s["id"],
                    "name": s["name"],
                    "symbol": s.get("symbol", s["id"].upper()),
                    "price": round(price, 2),
                    "change_3h": 0, "change_1d": 0, "change_3d": 0, "change_1w": 0,
                })
        return {"stocks": out}

    @router.get("/stock-market/positions")
    async def stock_market_positions(current_user: dict = Depends(get_current_user)):
        """Current open positions and current value (using live price from CoinGecko, fallback if missing)."""
        uid = current_user["id"]
        now_ts = datetime.now(timezone.utc).timestamp()
        live_list = await _get_cached_live_prices()
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
            current_price = _get_price_by_stock_id(live_list, pos.get("stock_id"))
            if current_price is None:
                current_price = _fallback_price(stock, now_ts)
            value_pts = round(units * current_price, 0)
            cost_pts = round(units * buy_price, 0)
            profit_pts = round(value_pts - cost_pts, 0)
            bought_at_raw = pos.get("bought_at")
            can_sell = True
            sell_available_in_seconds = 0
            if bought_at_raw:
                try:
                    bought_at = datetime.fromisoformat(bought_at_raw.replace("Z", "+00:00"))
                    if bought_at.tzinfo is None:
                        bought_at = bought_at.replace(tzinfo=timezone.utc)
                    elapsed = (datetime.now(timezone.utc) - bought_at).total_seconds()
                    if elapsed < SELL_COOLDOWN_SEC:
                        can_sell = False
                        sell_available_in_seconds = max(0, int(SELL_COOLDOWN_SEC - elapsed))
                except Exception:
                    pass
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
                "can_sell": can_sell,
                "sell_available_in_seconds": sell_available_in_seconds,
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
        live_list = await _get_cached_live_prices()
        current_price = _get_price_by_stock_id(live_list, request.stock_id)
        if current_price is None:
            current_price = _fallback_price(stock, now_ts)
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
        bought_at_raw = pos.get("bought_at")
        if bought_at_raw:
            try:
                bought_at = datetime.fromisoformat(bought_at_raw.replace("Z", "+00:00"))
                if bought_at.tzinfo is None:
                    bought_at = bought_at.replace(tzinfo=timezone.utc)
                elapsed = (datetime.now(timezone.utc) - bought_at).total_seconds()
                if elapsed < SELL_COOLDOWN_SEC:
                    wait_sec = int(SELL_COOLDOWN_SEC - elapsed)
                    raise HTTPException(
                        status_code=400,
                        detail=f"You must wait 3 minutes after buying before selling. You can sell in {wait_sec} seconds.",
                    )
            except HTTPException:
                raise
            except Exception:
                pass
        stock = next((s for s in STOCKS if s["id"] == pos.get("stock_id")), None)
        if not stock:
            raise HTTPException(status_code=400, detail="Stock not found")
        now = datetime.now(timezone.utc)
        now_ts = now.timestamp()
        live_list = await _get_cached_live_prices()
        current_price = _get_price_by_stock_id(live_list, pos.get("stock_id"))
        if current_price is None:
            current_price = _fallback_price(stock, now_ts)
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
