# Admin Revenue: real-money income (Stripe payments) and in-game economy flows (faucets / sinks).
import logging
import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from fastapi import Depends, Query

logger = logging.getLogger(__name__)

PAID_STATUSES = ("completed", "preorder_pending", "manual_credit_pending", "fulfillment_blocked")

POINT_PACK_IDS = ("mini", "starter", "bronze", "silver", "gold", "platinum", "diamond", "elite", "legend", "custom")
PRODUCT_LABELS = {
    "mini": "Points: Mini",
    "starter": "Points: Starter",
    "bronze": "Points: Bronze",
    "silver": "Points: Silver",
    "gold": "Points: Gold",
    "platinum": "Points: Platinum",
    "diamond": "Points: Diamond",
    "elite": "Points: Elite",
    "legend": "Points: Legend",
    "custom": "Points: Custom amount",
    "rank_xp_pass_499": "Game Pass (VIP)",
    "game_pass_prestige_10": "Game Pass prestige",
    "auto_rank_permanent_2000": "Auto Rank (permanent)",
    "dead_alive_revive_10": "Dead > Alive revive",
}
CATEGORY_LABELS = {
    "points": "Points packs",
    "game_pass": "Game Pass",
    "auto_rank": "Auto Rank",
    "revive": "Revives",
    "loot": "Loot packs",
    "ai_credits": "AI image credits",
    "other": "Other",
}

_CACHE: Dict[str, Tuple[float, Any]] = {}
_CACHE_TTL_SEC = 60.0


def _cache_get(key: str):
    hit = _CACHE.get(key)
    if hit and time.monotonic() - hit[0] < _CACHE_TTL_SEC:
        return hit[1]
    return None


def _cache_set(key: str, value: Any) -> Any:
    _CACHE[key] = (time.monotonic(), value)
    return value


def _parse_dt(v: Any) -> Optional[datetime]:
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=timezone.utc)
    if isinstance(v, str) and v:
        try:
            dt = datetime.fromisoformat(v.replace("Z", "+00:00"))
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except ValueError:
            return None
    return None


def _window(days: int) -> Tuple[Optional[datetime], datetime]:
    now = datetime.now(timezone.utc)
    return (None if days <= 0 else now - timedelta(days=days)), now


def _bucket_key(dt: datetime, bucket: str) -> str:
    if bucket == "month":
        return dt.strftime("%Y-%m")
    if bucket == "week":
        monday = (dt - timedelta(days=dt.weekday())).date()
        return monday.isoformat()
    return dt.date().isoformat()


def _bucket_for_days(days: int) -> str:
    if days <= 0 or days > 180:
        return "month"
    if days > 60:
        return "week"
    return "day"


def _product_category(package_id: str, payment_kind: Optional[str]) -> str:
    pid = (package_id or "").strip()
    if payment_kind == "ai_image_credits" or pid.startswith("ai_credit"):
        return "ai_credits"
    if pid in POINT_PACK_IDS:
        return "points"
    if pid in ("rank_xp_pass_499", "game_pass_prestige_10"):
        return "game_pass"
    if pid == "auto_rank_permanent_2000":
        return "auto_rank"
    if pid == "dead_alive_revive_10":
        return "revive"
    if pid.startswith("loot_pieces_"):
        return "loot"
    return "other"


def _product_label(package_id: str, payment_kind: Optional[str], ai_packs: dict) -> str:
    pid = (package_id or "").strip()
    if pid in PRODUCT_LABELS:
        return PRODUCT_LABELS[pid]
    if pid.startswith("loot_pieces_"):
        return f"Loot pack: {pid.split('_')[-1]} pieces"
    if payment_kind == "ai_image_credits" or pid.startswith("ai_credit"):
        pack = ai_packs.get(pid) or {}
        return f"AI credits: {pack.get('name') or pid}"
    return pid or "Unknown"


def register(router):
    import server as srv
    from utils.ai_image_credits import PACKS as AI_PACKS

    db = srv.db
    require_admin = srv.require_admin
    point_packages = srv.POINT_PACKAGES

    def _amount_minor(txn: dict) -> Tuple[int, bool]:
        """(amount in pence, is_estimate). Stripe total if stored, else expected custom pence, else catalogue price."""
        raw = txn.get("stripe_amount_total_minor")
        if raw:
            try:
                return int(raw), False
            except (TypeError, ValueError):
                pass
        exp = txn.get("expected_amount_minor")
        if exp:
            try:
                return int(exp), False
            except (TypeError, ValueError):
                pass
        pid = (txn.get("package_id") or "").strip()
        ai = AI_PACKS.get(pid)
        if ai and ai.get("amount_minor"):
            return int(ai["amount_minor"]), True
        price = (point_packages.get(pid) or {}).get("price_gbp")
        if price is not None:
            return int(round(float(price) * 100)), True
        return 0, True

    async def _usernames(user_ids: List[str]) -> Dict[str, str]:
        if not user_ids:
            return {}
        rows = await db.users.find({"id": {"$in": list(user_ids)}}, {"_id": 0, "id": 1, "username": 1}).to_list(len(user_ids))
        return {r["id"]: r.get("username") or "?" for r in rows}

    @router.get("/admin/revenue/summary")
    async def admin_revenue_summary(days: int = Query(30, ge=0, le=3650), current_user: dict = Depends(require_admin)):
        """Real-money revenue from payment_transactions (GBP). days=0 means all time."""
        cached = _cache_get(f"summary:{days}")
        if cached is not None:
            return cached
        since, now = _window(days)
        prev_since = since - (now - since) if since else None
        txns = await db.payment_transactions.find(
            {},
            {
                "_id": 0, "session_id": 1, "user_id": 1, "package_id": 1, "payment_kind": 1, "payment_status": 1,
                "created_at": 1, "points": 1, "stripe_amount_total_minor": 1, "expected_amount_minor": 1,
                "refunded_amount_minor": 1, "refunded_at": 1, "dispute_status": 1, "dispute_amount_minor": 1,
            },
        ).to_list(None)

        bucket = _bucket_for_days(days)
        estimate_count = 0
        totals = {"gross_minor": 0, "payments": 0, "refunded_minor": 0, "disputed_minor": 0, "disputes": 0, "pending": 0, "abandoned": 0}
        prev = {"gross_minor": 0, "payments": 0}
        all_time = {"gross_minor": 0, "payments": 0}
        payers_range: set = set()
        payers_prev: set = set()
        payers_all: set = set()
        first_paid_at: Dict[str, datetime] = {}
        by_product: Dict[str, Dict[str, Any]] = {}
        by_category: Dict[str, Dict[str, Any]] = defaultdict(lambda: {"gross_minor": 0, "payments": 0})
        series: Dict[str, Dict[str, int]] = defaultdict(lambda: {"gross_minor": 0, "payments": 0})
        spend_by_user: Dict[str, Dict[str, Any]] = defaultdict(lambda: {"gross_minor": 0, "payments": 0, "last_at": None})
        recent: List[dict] = []

        for t in txns:
            dt = _parse_dt(t.get("created_at"))
            status = t.get("payment_status")
            in_range = dt is not None and (since is None or dt >= since)
            if status not in PAID_STATUSES:
                if in_range and status in ("pending", "abandoned"):
                    totals[status] += 1
                continue
            uid = t.get("user_id")
            amount, est = _amount_minor(t)
            all_time["gross_minor"] += amount
            all_time["payments"] += 1
            if uid:
                payers_all.add(uid)
                if dt and (uid not in first_paid_at or dt < first_paid_at[uid]):
                    first_paid_at[uid] = dt
            if prev_since and dt and prev_since <= dt < since:
                prev["gross_minor"] += amount
                prev["payments"] += 1
                if uid:
                    payers_prev.add(uid)
            if not in_range:
                continue
            estimate_count += 1 if est else 0
            totals["gross_minor"] += amount
            totals["payments"] += 1
            refunded = int(t.get("refunded_amount_minor") or 0)
            totals["refunded_minor"] += refunded
            if t.get("dispute_status"):
                totals["disputes"] += 1
                totals["disputed_minor"] += int(t.get("dispute_amount_minor") or amount)
            if uid:
                payers_range.add(uid)
                su = spend_by_user[uid]
                su["gross_minor"] += amount
                su["payments"] += 1
                if su["last_at"] is None or dt > su["last_at"]:
                    su["last_at"] = dt
            pid = (t.get("package_id") or "").strip()
            kind = t.get("payment_kind")
            cat = _product_category(pid, kind)
            prod = by_product.setdefault(pid or "unknown", {
                "product_id": pid or "unknown", "label": _product_label(pid, kind, AI_PACKS), "category": cat,
                "gross_minor": 0, "payments": 0, "payers": set(),
            })
            prod["gross_minor"] += amount
            prod["payments"] += 1
            if uid:
                prod["payers"].add(uid)
            by_category[cat]["gross_minor"] += amount
            by_category[cat]["payments"] += 1
            series[_bucket_key(dt, bucket)]["gross_minor"] += amount
            series[_bucket_key(dt, bucket)]["payments"] += 1
            recent.append({"created_at": dt.isoformat(), "user_id": uid, "product": prod["label"], "amount_minor": amount,
                           "status": status, "refunded_minor": refunded, "dispute_status": t.get("dispute_status")})

        new_payers = sum(1 for u in payers_range if since is None or (first_paid_at.get(u) and first_paid_at[u] >= since))
        top = sorted(spend_by_user.items(), key=lambda kv: -kv[1]["gross_minor"])[:15]
        recent.sort(key=lambda r: r["created_at"], reverse=True)
        recent = recent[:25]
        names = await _usernames(list({u for u, _ in top} | {r["user_id"] for r in recent if r.get("user_id")}))

        signup_q: Dict[str, Any] = {"is_npc": {"$ne": True}}
        if since:
            signup_q["created_at"] = {"$gte": since.isoformat()}
        signups = await db.users.count_documents(signup_q)

        net = totals["gross_minor"] - totals["refunded_minor"]
        payers_n = len(payers_range)
        out = {
            "generated_at": now.isoformat(),
            "currency": "GBP",
            "days": days,
            "since": since.isoformat() if since else None,
            "bucket": bucket,
            "totals": {
                **totals,
                "net_minor": net,
                "payers": payers_n,
                "new_payers": new_payers,
                "returning_payers": payers_n - new_payers,
                "avg_order_minor": (totals["gross_minor"] // totals["payments"]) if totals["payments"] else 0,
                "arppu_minor": (totals["gross_minor"] // payers_n) if payers_n else 0,
                "signups": signups,
                "payer_conversion_pct": round(100.0 * new_payers / signups, 2) if signups else None,
            },
            "previous": {**prev, "payers": len(payers_prev)} if prev_since else None,
            "all_time": {**all_time, "payers": len(payers_all),
                         "first_payment_at": min(first_paid_at.values()).isoformat() if first_paid_at else None},
            "by_category": sorted(
                [{"category": c, "label": CATEGORY_LABELS.get(c, c), **v} for c, v in by_category.items()],
                key=lambda r: -r["gross_minor"],
            ),
            "by_product": sorted(
                [{**{k: v for k, v in p.items() if k != "payers"}, "payers": len(p["payers"])} for p in by_product.values()],
                key=lambda r: -r["gross_minor"],
            ),
            "series": [{"period": k, **v} for k, v in sorted(series.items())],
            "top_spenders": [
                {"user_id": u, "username": names.get(u, "?"), "gross_minor": v["gross_minor"], "payments": v["payments"],
                 "last_at": v["last_at"].isoformat() if v["last_at"] else None}
                for u, v in top
            ],
            "recent": [{**r, "username": names.get(r.get("user_id"), "?")} for r in recent],
            "estimated_payments": estimate_count,
            "notes": "Amounts come from the Stripe total when stored, otherwise the custom-pack price or the current catalogue price.",
        }
        return _cache_set(f"summary:{days}", out)

    @router.get("/admin/revenue/economy")
    async def admin_revenue_economy(days: int = Query(30, ge=0, le=3650), current_user: dict = Depends(require_admin)):
        """In-game economy: supply now, points created vs removed, casino house edge, lottery tax, bank interest, store spend."""
        cached = _cache_get(f"economy:{days}")
        if cached is not None:
            return cached
        from routers.game.stats import _gambling_analytics_bucket, _gambling_profit_from_details

        since, now = _window(days)
        since_iso = since.isoformat() if since else None

        supply_rows = await db.users.aggregate([
            {"$match": srv.alive_real_player_wallet_match()},
            {"$group": {
                "_id": None,
                "cash": {"$sum": {"$ifNull": ["$money", 0]}},
                "bank": {"$sum": {"$ifNull": ["$bank_balance", 0]}},
                "swiss": {"$sum": {"$ifNull": ["$swiss_balance", 0]}},
                "points": {"$sum": {"$ifNull": ["$points", 0]}},
                "players": {"$sum": 1},
            }},
        ]).to_list(1)
        supply = supply_rows[0] if supply_rows else {}
        supply.pop("_id", None)

        pae_match: Dict[str, Any] = {"created_at": {"$type": "date"}}
        if since:
            pae_match["created_at"] = {"$gte": since}
        flows = await db.point_audit_events.aggregate([
            {"$match": pae_match},
            {"$group": {
                "_id": "$source",
                "created": {"$sum": {"$cond": [{"$gt": ["$delta", 0]}, "$delta", 0]}},
                "removed": {"$sum": {"$cond": [{"$lt": ["$delta", 0]}, "$delta", 0]}},
                "events": {"$sum": 1},
            }},
        ]).to_list(200)
        points_flows = sorted(
            [{"source": f["_id"] or "unknown", "created": int(f["created"]), "removed": int(-f["removed"]),
              "net": int(f["created"] + f["removed"]), "events": f["events"]} for f in flows],
            key=lambda r: -(r["created"] + r["removed"]),
        )
        # These move points between players; only their net (fees, house cut) creates or removes points.
        transfer_sources = {"p2p", "quicktrade", "casino_mdg"}
        points_created = 0
        points_removed = 0
        for r in points_flows:
            if r["source"] in transfer_sources:
                points_created += max(r["net"], 0)
                points_removed += max(-r["net"], 0)
            else:
                points_created += r["created"]
                points_removed += r["removed"]

        gl_match: Dict[str, Any] = {}
        if since:
            gl_match["created_at"] = {"$gte": since}
        casino: Dict[str, Dict[str, int]] = defaultdict(lambda: {"plays": 0, "house_profit": 0})
        async for row in db.gambling_log.find(gl_match, {"_id": 0, "game_type": 1, "details": 1}):
            gt = row.get("game_type") or "unknown"
            details = row.get("details") or {}
            bucket = _gambling_analytics_bucket(gt, details)
            casino[bucket]["plays"] += 1
            casino[bucket]["house_profit"] -= _gambling_profit_from_details(gt, details)
        casino_rows = sorted(
            [{"game": k, **v} for k, v in casino.items() if v["plays"]],
            key=lambda r: -r["house_profit"],
        )

        lot_match: Dict[str, Any] = {"status": "closed"}
        if since_iso:
            lot_match["drawn_at"] = {"$gte": since_iso}
        lottery = {"rounds": 0, "tax_cash": 0, "tax_points": 0, "paid_cash": 0, "paid_points": 0}
        async for rd in db.lottery_rounds.find(lot_match, {"_id": 0, "sink_amount": 1, "points_sink_amount": 1, "payout": 1,
                                                           "points_payout": 1, "rollover_to_next": 1, "points_rollover_to_next": 1}):
            lottery["rounds"] += 1
            lottery["tax_cash"] += int(rd.get("sink_amount") or 0)
            lottery["tax_points"] += int(rd.get("points_sink_amount") or 0)
            if not int(rd.get("rollover_to_next") or 0):
                lottery["paid_cash"] += int(rd.get("payout") or 0)
            if not int(rd.get("points_rollover_to_next") or 0):
                lottery["paid_points"] += int(rd.get("points_payout") or 0)

        bank_match: Dict[str, Any] = {"claimed_at": {"$ne": None}}
        if since_iso:
            bank_match["claimed_at"] = {"$gte": since_iso}
        bank_rows = await db.bank_deposits.aggregate([
            {"$match": bank_match},
            {"$group": {"_id": None, "interest": {"$sum": {"$ifNull": ["$interest_amount", 0]}}, "claims": {"$sum": 1}}},
        ]).to_list(1)
        bank = {"interest_paid": int((bank_rows[0] if bank_rows else {}).get("interest", 0)),
                "claims": int((bank_rows[0] if bank_rows else {}).get("claims", 0))}

        store_match: Dict[str, Any] = {}
        if since_iso:
            store_match["created_at"] = {"$gte": since_iso}
        store_pts = await db.store_points_purchase_logs.aggregate([
            {"$match": store_match},
            {"$group": {"_id": "$item_label", "points": {"$sum": {"$ifNull": ["$points_spent", "$cost_points"]}}, "n": {"$sum": 1}}},
            {"$sort": {"points": -1}},
            {"$limit": 15},
        ]).to_list(15)
        store_cash = await db.store_cash_purchase_logs.aggregate([
            {"$match": store_match},
            {"$group": {"_id": "$purchase_kind", "cash": {"$sum": {"$ifNull": ["$cash_cost", 0]}}, "n": {"$sum": 1}}},
            {"$sort": {"cash": -1}},
        ]).to_list(20)

        out = {
            "generated_at": now.isoformat(),
            "days": days,
            "since": since_iso,
            "supply": supply,
            "points": {
                "created": points_created,
                "removed": points_removed,
                "net": points_created - points_removed,
                "by_source": points_flows,
                "transfer_sources": sorted(transfer_sources),
            },
            "casino": {
                "house_profit_cash": sum(r["house_profit"] for r in casino_rows),
                "plays": sum(r["plays"] for r in casino_rows),
                "by_game": casino_rows,
            },
            "lottery": lottery,
            "bank": bank,
            "store": {
                "points_spent": sum(int(r.get("points") or 0) for r in store_pts),
                "points_by_item": [{"item": r["_id"] or "?", "points": int(r.get("points") or 0), "purchases": r["n"]} for r in store_pts],
                "cash_spent": sum(int(r.get("cash") or 0) for r in store_cash),
                "cash_by_kind": [{"kind": r["_id"] or "?", "cash": int(r.get("cash") or 0), "purchases": r["n"]} for r in store_cash],
            },
            "notes": "Points flows come from the points audit (since 29 Aug 2026). Transfers between players (P2P, Quick Trade, MDG pots) only count their net.",
        }
        return _cache_set(f"economy:{days}", out)
