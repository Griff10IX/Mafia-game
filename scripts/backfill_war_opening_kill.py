#!/usr/bin/env python3
"""
Backfill family_war_stats + war_kill_feed for a player kill that started a vendetta
but was missed (war was created after stats were checked).

Requires: pymongo, python-dotenv (same as backend).

Run from project root:
  python scripts/backfill_war_opening_kill.py --war-id <uuid> --killer HishKillerName --victim Hish

Or find the active war by family tags:
  python scripts/backfill_war_opening_kill.py --family-tag-a MDS --family-tag-b MOEY --killer ... --victim ...

Env (backend/.env): MONGO_URL, DB_NAME

Options:
  --dry-run          Print actions only
  --repair-stats     If a matching feed row already exists, still $inc stats (use when feed was added
                     manually but family_war_stats is empty; can double-count if stats were already OK)
"""
from __future__ import annotations

import argparse
import os
import re
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

_backend = Path(__file__).resolve().parent.parent / "backend"
if str(_backend) not in sys.path:
    sys.path.insert(0, str(_backend))

try:
    from dotenv import load_dotenv
    from pymongo import MongoClient
except ModuleNotFoundError as e:
    print("Install: pip install pymongo python-dotenv", file=sys.stderr)
    raise SystemExit(1) from e

load_dotenv(_backend / ".env")


def _norm(s) -> str | None:
    if s is None:
        return None
    t = str(s).strip()
    return t or None


def _resolve_user(db, label: str) -> dict:
    uid = _norm(label)
    if not uid:
        raise SystemExit(f"Empty user identifier: {label}")
    u = db.users.find_one({"id": uid}, {"_id": 0, "id": 1, "username": 1, "family_id": 1})
    if u:
        return u
    pat = re.compile("^" + re.escape(uid) + "$", re.IGNORECASE)
    u = db.users.find_one({"username": pat}, {"_id": 0, "id": 1, "username": 1, "family_id": 1})
    if not u:
        raise SystemExit(f"User not found: {label}")
    return u


def _resolve_family_by_tag(db, tag: str) -> dict:
    t = _norm(tag)
    if not t:
        raise SystemExit("Empty family tag")
    pat = re.compile("^" + re.escape(t) + "$", re.IGNORECASE)
    f = db.families.find_one({"tag": pat}, {"_id": 0, "id": 1, "name": 1, "tag": 1})
    if not f:
        raise SystemExit(f"Family tag not found: {tag}")
    return f


def _find_active_war(db, fa_id: str, fb_id: str) -> dict | None:
    return db.family_wars.find_one(
        {
            "$or": [
                {"family_a_id": fa_id, "family_b_id": fb_id},
                {"family_a_id": fb_id, "family_b_id": fa_id},
            ],
            "status": {"$in": ["active", "truce_offered"]},
        },
        {"_id": 0},
    )


def main() -> None:
    p = argparse.ArgumentParser(description="Backfill missed opening-kill war stats / feed row.")
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--war-id", help="family_wars.id")
    g.add_argument("--family-tag-a", help="First family tag (with --family-tag-b)")
    p.add_argument("--family-tag-b", help="Second family tag (with --family-tag-a)")
    p.add_argument("--killer", required=True, help="Killer user id or username")
    p.add_argument("--victim", required=True, help="Victim user id or username")
    p.add_argument(
        "--created-at",
        help="ISO timestamp for war_kill_feed.created_at (default: war created_at or now UTC)",
    )
    p.add_argument("--dry-run", action="store_true")
    p.add_argument(
        "--repair-stats",
        action="store_true",
        help="Apply $inc stats even when matching feed entry exists (see docstring)",
    )
    args = p.parse_args()

    if args.family_tag_a and not args.family_tag_b:
        p.error("--family-tag-b required with --family-tag-a")
    if args.family_tag_b and not args.family_tag_a:
        p.error("--family-tag-a required with --family-tag-b")

    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME")
    if not mongo_url or not db_name:
        raise SystemExit("Set MONGO_URL and DB_NAME in backend/.env")

    client = MongoClient(mongo_url)
    db = client[db_name]

    if args.war_id:
        war = db.family_wars.find_one({"id": _norm(args.war_id)}, {"_id": 0})
    else:
        fa = _resolve_family_by_tag(db, args.family_tag_a)
        fb = _resolve_family_by_tag(db, args.family_tag_b)
        war = _find_active_war(db, fa["id"], fb["id"])

    if not war:
        raise SystemExit("War not found (check id or tags / active status).")
    war_id = war["id"]
    wfa, wfb = _norm(war.get("family_a_id")), _norm(war.get("family_b_id"))
    if not wfa or not wfb:
        raise SystemExit("War document missing family_a_id / family_b_id")

    killer = _resolve_user(db, args.killer)
    victim = _resolve_user(db, args.victim)
    killer_id, victim_id = killer["id"], victim["id"]
    killer_fid = _norm(killer.get("family_id"))
    victim_fid = _norm(victim.get("family_id"))

    if not killer_fid or not victim_fid:
        raise SystemExit("Killer or victim has no family_id on user doc; fix data or use a different account.")
    if killer_fid == victim_fid:
        raise SystemExit("Killer and victim same family; not a cross-family kill.")
    if {killer_fid, victim_fid} != {wfa, wfb}:
        raise SystemExit(
            f"Families mismatch: war is {wfa} vs {wfb}, killer family {killer_fid}, victim family {victim_fid}"
        )

    dup = db.war_kill_feed.find_one(
        {
            "war_id": war_id,
            "kill_type": "player",
            "killer_id": killer_id,
            "victim_id": victim_id,
        },
        {"_id": 1},
    )
    if dup and not args.repair_stats:
        print("Matching war_kill_feed row already exists; nothing to do. Use --repair-stats if stats are still 0.")
        return

    if args.created_at:
        try:
            created_at = datetime.fromisoformat(args.created_at.replace("Z", "+00:00"))
        except Exception as e:
            raise SystemExit(f"Bad --created-at: {e}") from e
        if created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)
    else:
        raw = war.get("created_at")
        if raw:
            try:
                created_at = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
                if created_at.tzinfo is None:
                    created_at = created_at.replace(tzinfo=timezone.utc)
            except Exception:
                created_at = datetime.now(timezone.utc)
        else:
            created_at = datetime.now(timezone.utc)

    feed_doc = {
        "id": str(uuid.uuid4()),
        "war_id": war_id,
        "kill_type": "player",
        "killer_id": killer_id,
        "killer_username": killer.get("username") or "?",
        "killer_family_id": killer_fid,
        "victim_id": victim_id,
        "victim_username": victim.get("username") or "?",
        "victim_family_id": victim_fid,
        "bg_username": None,
        "bg_owner_username": None,
        "bullets_used": 0,
        "bg_hire_cost": 0,
        "cash_taken": 0,
        "props_taken": 0,
        "cars_taken": 0,
        "created_at": created_at,
    }

    print("War:", war_id, "status:", war.get("status"))
    print("Killer:", killer.get("username"), killer_id, "family", killer_fid)
    print("Victim:", victim.get("username"), victim_id, "family", victim_fid)
    print("Feed created_at:", created_at.isoformat())

    if args.dry_run:
        print("Dry run: no DB writes.")
        return

    db.family_war_stats.update_one(
        {"war_id": war_id, "user_id": killer_id},
        {
            "$inc": {"kills": 1},
            "$set": {"family_id": killer_fid},
            "$setOnInsert": {
                "war_id": war_id,
                "user_id": killer_id,
                "bodyguard_kills": 0,
                "deaths": 0,
                "bodyguards_lost": 0,
            },
        },
        upsert=True,
    )
    db.family_war_stats.update_one(
        {"war_id": war_id, "user_id": victim_id},
        {
            "$inc": {"deaths": 1},
            "$set": {"family_id": victim_fid},
            "$setOnInsert": {
                "war_id": war_id,
                "user_id": victim_id,
                "bodyguard_kills": 0,
                "kills": 0,
                "bodyguards_lost": 0,
            },
        },
        upsert=True,
    )
    print("Updated family_war_stats (kills/deaths).")

    if not dup:
        db.war_kill_feed.insert_one(feed_doc)
        print("Inserted war_kill_feed id:", feed_doc["id"])
    elif args.repair_stats:
        print("Feed row was already present; stats incremented only.")


if __name__ == "__main__":
    main()
