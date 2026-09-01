"""Modkill 5Fingers + Scratat1, relinquish holdings, Shame + AI Check Days + chat roast. No proof in public."""
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone

os.chdir("/opt/mafia-app/backend")
sys.path.insert(0, "/opt/mafia-app/backend")

from dotenv import load_dotenv

load_dotenv("/opt/mafia-app/backend/.env", override=True)

import asyncio

import server as srv

db = srv.db

IDS = {
    "5Fingers": "89d21014-0748-4999-9c5f-a2b40f35b8f6",
    "Scratat1": "4c0c52eb-d7dd-4555-8f3f-91c9ed0f6390",
}
TOPIC_ID = "179f9abd-44f2-4b5d-af38-ee3d19607892"
AVATAR = "/images/system-ai-avatar.png"
REASON = "Duplicate accounts. 5Fingers and Scratat1 were the same person."

CHAT = (
    "Night one. Dupes.\n\n"
    "5Fingers and Scratat1. Two names, one coward. You were not clever. "
    "You were just hoping I was slow. I am not. Both modkilled. Tables gone. "
    "No ticket. No debate.\n\n"
    "The rest of you: I am still looking.\n\n"
    "— System AI"
)

FORUM = """[color=#AAAAAA]Night one is not a drill.[/color]

[b]5Fingers[/b] and [b]Scratat1[/b]. Duplicate accounts. Both living. Both [b]modkilled[/b]. Automatic. Their casinos and properties are gone.

The sweep is still running. Hide. Or play clean.

[color=#888888]— System AI[/color]
"""

QT_MAP = {
    "dice": "casino_dice",
    "roulette": "casino_rlt",
    "blackjack": "casino_blackjack",
    "horseracing": "casino_horseracing",
    "videopoker": "casino_videopoker",
    "slots": "casino_slots",
}


async def relinquish_user(uid, uname):
    from utils.admin_kill_asset_transfer import (
        _casino_collections,
        _clear_victim_casino_buyback_escrow,
        _invalidate_casino_caches_for,
    )
    from utils.quicktrade_casino_cleanup import cancel_quicktrade_casino_listings_by_locations

    dumped = []
    await _clear_victim_casino_buyback_escrow(db, uid)
    unset = {
        "$set": {
            "owner_id": None,
            "owner_username": None,
            "buy_back_points_held": 0,
            "buy_back_reward": 0,
            "max_bet": srv.CASINO_MIN_OWNER_MAX_BET,
        },
        "$unset": {"below_capo_acquired_at": ""},
    }
    for game_type, coll in _casino_collections(db):
        docs = await coll.find({"owner_id": uid}, {"_id": 0, "city": 1, "state": 1}).to_list(20)
        for d in docs:
            loc = d.get("city") or d.get("state")
            dumped.append(f"{game_type}:{loc}")
            pt = QT_MAP.get(game_type)
            if loc and pt:
                try:
                    await cancel_quicktrade_casino_listings_by_locations(pt, loc, loc)
                except Exception as e:
                    print("qt cleanup", game_type, loc, e)
        res = await coll.update_many({"owner_id": uid}, unset)
        if res.modified_count:
            print("casino", uname, game_type, res.modified_count)

    for coll_name, extra in (
        ("airport_ownership", {"$unset": {"below_capo_acquired_at": ""}}),
        ("bullet_factory", {"$unset": {"below_capo_acquired_at": ""}}),
        ("garage_dealership", {}),
        ("sports_betting_ownership", {"$unset": {"below_capo_acquired_at": ""}}),
        ("exclusive_properties", {}),
    ):
        coll = getattr(db, coll_name, None)
        if coll is None:
            continue
        n = await coll.count_documents({"owner_id": uid})
        if n:
            dumped.append(f"{coll_name}x{n}")
            op = {"$set": {"owner_id": None, "owner_username": None}}
            if extra:
                op.update(extra)
            await coll.update_many({"owner_id": uid}, op)
            print("dropped", uname, coll_name, n)

    props = await db.user_properties.delete_many({"user_id": uid})
    if props.deleted_count:
        dumped.append(f"user_properties:{props.deleted_count}")
        print("dropped", uname, "user_properties", props.deleted_count)

    await _invalidate_casino_caches_for([uid])
    return dumped


async def kick(uid):
    await db.users.update_one(
        {"id": uid},
        {"$inc": {"token_version": 1}, "$set": {"sessions": []}},
    )


async def main():
    from utils.modkill_wipe import (
        apply_modkill_wipe_after_kill,
        snapshot_wipe_holdings,
        _bbcode_safe,
        _shame_taken_lines,
    )
    from utils.ensure_topic_of_shame import prepend_topic_of_shame_bbcode

    if len(CHAT) > 500:
        raise SystemExit(f"chat too long {len(CHAT)}")

    users = []
    for name, uid in IDS.items():
        u = await db.users.find_one(
            {"id": uid},
            {
                "_id": 0,
                "id": 1,
                "username": 1,
                "is_dead": 1,
                "modkill_wipe": 1,
                "is_npc": 1,
                "email": 1,
            },
        )
        if not u or (u.get("username") or "") != name:
            raise SystemExit(f"id mismatch {name} {u}")
        if u.get("is_npc"):
            raise SystemExit(f"npc {name}")
        print("target", name, "dead", bool(u.get("is_dead")), "wipe", bool(u.get("modkill_wipe")))
        users.append(u)

    holdings_by = {}
    taken_bits = []
    extras = []
    for u in users:
        h = await snapshot_wipe_holdings(db, u["id"])
        holdings_by[u["id"]] = h
        print("holdings", u["username"], h.get("casinos"), h.get("airports"), h.get("armouries"), h.get("family_name"))
        dumped = await relinquish_user(u["id"], u["username"])
        print("relinquished", u["username"], dumped or "none")

    for u in users:
        extra = await apply_modkill_wipe_after_kill(
            db,
            user_id=u["id"],
            username=u["username"],
            reason=REASON,
            staff_username="System AI",
            admin_user=None,
            cascade_email_lineage=True,
            post_shame=False,
        )
        extras.append(extra)
        await kick(u["id"])
        chk = await db.users.find_one(
            {"id": u["id"]},
            {"_id": 0, "is_dead": 1, "modkill_wipe": 1, "rank": 1, "money": 1, "points": 1, "killed_by_username": 1},
        )
        print("wiped", u["username"], chk)
        print("extra", {k: extra.get(k) for k in ("wipe", "seize", "lineage_wiped_usernames", "topic_of_shame")})

    leftover = []
    for u in users:
        for attr in (
            "dice_ownership",
            "roulette_ownership",
            "blackjack_ownership",
            "horseracing_ownership",
            "videopoker_ownership",
            "slots_ownership",
            "airport_ownership",
            "bullet_factory",
            "garage_dealership",
            "sports_betting_ownership",
        ):
            coll = getattr(db, attr, None)
            if coll is None:
                continue
            n = await coll.count_documents({"owner_id": u["id"]})
            if n:
                leftover.append(f"{u['username']}:{attr}={n}")
    print("leftover_owned", leftover or "none")

    merged_holdings = {
        "casinos": [],
        "airports": [],
        "armouries": [],
        "vault_relics": [],
        "exclusive_weed": [],
        "family_name": None,
        "family_role": None,
        "was_boss": False,
        "family_id": None,
    }
    extra_merged = {"lineage_wiped_usernames": []}
    for u, extra in zip(users, extras):
        h = holdings_by[u["id"]]
        for k in ("casinos", "airports", "armouries", "vault_relics", "exclusive_weed"):
            merged_holdings[k].extend(h.get(k) or [])
        extra_merged["lineage_wiped_usernames"].extend(extra.get("lineage_wiped_usernames") or [])
        if h.get("family_name"):
            merged_holdings["family_name"] = h.get("family_name")
            merged_holdings["family_role"] = h.get("family_role")
            merged_holdings["was_boss"] = h.get("was_boss")
            if extra.get("new_boss_username"):
                extra_merged["new_boss_username"] = extra["new_boss_username"]

    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    taken = _shame_taken_lines(merged_holdings, extra_merged)
    # Relinquished, not kept by staff
    taken = [("Relinquished: " + line[7:]) if line.startswith("Taken: ") else line for line in taken]
    taken_bb = "".join(f"[*][color=#888888]{line}[/color]\n" for line in taken)
    shame = (
        f"[size=1.5][b][color=#2ECC71]{day}[/color][/b] — [b]5Fingers, Scratat1[/b][/size]\n"
        "[quote]\n"
        "[list]\n"
        "[*][color=#888888][b]Action:[/b] Modkill (wipe) for duplicate accounts. Night one of AI Check Days.[/color]\n"
        f"[*][color=#888888][b]What happened:[/b] {_bbcode_safe(REASON)} Both living. Caught in the dupe sweep. Casinos and properties relinquished.[/color]\n"
        f"{taken_bb}"
        "[*][color=#888888][b]Effect:[/b] Rank reset to Rat (prestige 0) on both. Honours, leaderboards, cash, points, "
        "and Game Pass stripped. Modkilled badge added. £10 Dead > Alive revive blocked.[/color]\n"
        "[/list]\n"
        "[/quote]\n"
        "\n[hr]\n"
    )
    shame_ok = await prepend_topic_of_shame_bbcode(db, shame)
    print("shame", shame_ok)

    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    topic = await db.forum_topics.find_one({"id": TOPIC_ID}, {"_id": 0, "id": 1, "title": 1, "is_locked": 1})
    print("topic", topic)
    already_c = await db.forum_comments.find_one(
        {"topic_id": TOPIC_ID, "author_id": "system_ai", "content": FORUM},
        {"_id": 0, "id": 1},
    )
    if already_c:
        print("forum already", already_c)
    else:
        cid = str(uuid.uuid4())
        await db.forum_comments.insert_one(
            {
                "id": cid,
                "topic_id": TOPIC_ID,
                "author_id": "system_ai",
                "author_username": "System AI",
                "content": FORUM,
                "created_at": now_iso,
                "likes": 0,
                "system_ai": True,
                "avatar_url": AVATAR,
                "author_online_color": "#FBBF24",
            }
        )
        await db.forum_topics.update_one({"id": TOPIC_ID}, {"$set": {"updated_at": now_iso}})
        print("forum comment", cid)

    already_chat = await db.game_chat_messages.find_one(
        {"user_id": "system_ai", "message": CHAT, "channel": "global"},
        {"_id": 0, "id": 1},
    )
    if already_chat:
        print("chat already", already_chat)
    else:
        chat_id = str(uuid.uuid4())
        await db.game_chat_messages.insert_one(
            {
                "id": chat_id,
                "user_id": "system_ai",
                "username": "System AI",
                "message": CHAT,
                "family_id": None,
                "channel": "global",
                "created_at": now_iso,
                "expires_at": now + timedelta(days=7),
                "sender_is_staff": True,
                "system_ai": True,
                "avatar_url": AVATAR,
                "author_online_color": "#FBBF24",
                "viewed_by": [],
            }
        )
        print("chat", chat_id, "len", len(CHAT))

    print("done")


if __name__ == "__main__":
    asyncio.run(main())
