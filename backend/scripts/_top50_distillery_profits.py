"""Top 50 distillery projected weekly profits — no FastAPI boot."""
from __future__ import annotations

import os
import sys
import types
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from pymongo import MongoClient

BACKEND = Path("/opt/mafia-app/backend")
load_dotenv(BACKEND / ".env")
os.chdir(BACKEND)
sys.path.insert(0, str(BACKEND))

# Stub server before illegal_business import (avoids circular boot).
server = types.ModuleType("server")
server.db = None
server.get_current_user = lambda: {}
server.get_rank_info = lambda *a, **k: {}


async def _gev():
    return {}


server.get_effective_event = _gev
server.get_prestige_bonus = lambda u: {"mission_reward_mult": 1.0, "cash_mult": 1.0}
server.log_activity = lambda *a, **k: None
server.log_respect_earned = lambda *a, **k: None
server.send_notification = lambda *a, **k: None
server.STATES = []
server.RANKS = []
server.CAPO_RANK_ID = 5
server.GODFATHER_RANK_ID = 10
sys.modules["server"] = server

# Stub armoury — illegal_business only needs token constants at import time.
arm = types.ModuleType("routers.kill.armoury")
arm.TOKEN_CONFIG = {}
arm.TOKEN_TYPES = []
arm.TOKEN_TYPES_GLOBAL_RANDOM_DROP = []
arm.TOKEN_GLOBAL_DROP_AMOUNT_MAX = 1
arm.TOKEN_GLOBAL_DROP_AMOUNT_MIN = 1
arm.TOKEN_GLOBAL_DROP_CHANCE = 0.0
sys.modules["routers.kill.armoury"] = arm

import routers.money.illegal_business as ib  # noqa: E402

db = MongoClient(os.environ["MONGO_URL"])[(os.environ.get("DB_NAME") or "mafia_game").strip()]
ib.db = db
server.db = db


def main():
    businesses = list(
        db.illegal_businesses.find(
            {"booze_per_hour": {"$gt": 0}, "distillery": {"$exists": True}},
            {"_id": 0},
        )
    )
    user_ids = [b["user_id"] for b in businesses if b.get("user_id")]
    users = {
        u["id"]: u
        for u in db.users.find(
            {"id": {"$in": user_ids}},
            {
                "_id": 0,
                "id": 1,
                "username": 1,
                "racket_until": 1,
                "booze_until": 1,
                "is_alive": 1,
                "alive": 1,
            },
        )
    }
    now = datetime.now(timezone.utc)
    rows = []
    for biz in businesses:
        uid = biz.get("user_id")
        user = users.get(uid) or {"id": uid}
        dist, _ = ib._distillery_ensure_state(biz, now)
        view = ib._distillery_decay_view(dist, now)
        roi = ib._distillery_roi_snapshot(view, biz, user, now)
        dead = user.get("is_alive") is False or user.get("alive") is False
        rows.append(
            {
                "username": user.get("username") or uid,
                "dead": dead,
                "type_id": biz.get("type_id"),
                "weekly": float(roi.get("weekly_cash_estimate") or 0),
                "cash_h": float(roi.get("cash_per_hour_estimate") or 0),
                "till_h": float(roi.get("till_cash_per_hour_estimate") or 0),
                "booze_h": float(roi.get("booze_cash_per_hour_estimate") or 0),
                "booze_units_h": float(roi.get("booze_per_hour_estimate") or 0),
                "auto_sell": bool(roi.get("auto_sell_active")),
                "maint": float(view.get("maintenance") or 0),
                "stills": int((view.get("equipment") or {}).get("stills") or 0),
                "band_pct": float(roi.get("hard_cap_progress") or 0) * 100.0,
            }
        )
    rows.sort(key=lambda r: r["weekly"], reverse=True)
    top = rows[:50]
    hdr = (
        f"{'#':>3} {'User':<24} {'Weekly $':>16} {'$/h':>12} {'Till/h':>12} {'Booze$/h':>12} "
        f"{'Booze/h':>8} {'Sell':>4} {'Maint':>6} {'Stills':>6} {'Band%':>7} Type"
    )
    print(hdr)
    print("-" * 142)
    for i, r in enumerate(top, 1):
        name = r["username"] + (" [dead]" if r["dead"] else "")
        sell = "Y" if r["auto_sell"] else "N"
        print(
            f"{i:>3} {name[:24]:<24} {r['weekly']:>16,.0f} {r['cash_h']:>12,.0f} {r['till_h']:>12,.0f} "
            f"{r['booze_h']:>12,.0f} {r['booze_units_h']:>8.1f} {sell:>4} "
            f"{r['maint']:>5.0f}% {r['stills']:>6} {r['band_pct']:>6.0f}% {r['type_id']}"
        )
    print("-" * 142)
    print(
        f"Scanned {len(rows)} distilleries | band $200-400M/week | "
        "sorted by projected weekly vault income (till + active auto-sell)"
    )


if __name__ == "__main__":
    main()
