"""System AI prank helpers: silly chat colours, logout, revert. Never staff/GhostFace."""
import os
import random
import uuid
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/opt/mafia-app/backend/.env")
db = MongoClient(os.environ.get("MONGO_URL"))[(os.environ.get("DB_NAME") or "mafia_game").strip()]

GHOSTFACE_ID = "36425cb4-3755-4669-b4b5-5d86345991d0"
HIGHLIGHTS_ID = "ff620eef-283a-4016-a172-d33854bcee7b"
AVATAR = "/images/system-ai-profile.jpg?v=5"
PRANK_KEY = "system_ai_chat_pranks"
ADMIN_EMAILS = {e.strip().lower() for e in (os.environ.get("ADMIN_EMAILS") or "").split(",") if e.strip()}
MOD_EMAILS = {e.strip().lower() for e in (os.environ.get("MOD_EMAILS") or "").split(",") if e.strip()}

SILLY = [
    ("#39FF14", "radioactive slime"),
    ("#FF00AA", "bubblegum crisis"),
    ("#00FFFF", "pool-toy blue"),
    ("#FFD700", "cheap gold"),
    ("#FF4500", "traffic cone"),
    ("#DA70D6", "lilac menace"),
    ("#7FFF00", "tennis ball"),
]

GIRLY = [
    ("#FF69B4", "hot pink"),
    ("#FF1493", "deep pink"),
    ("#FF10F0", "barbie"),
    ("#F472B6", "pink sparkle"),
    ("#FF77FF", "cotton candy"),
    ("#E879F9", "lilac gloss"),
    ("#FB7185", "rose"),
    ("girly-multi", "barbie rainbow letters"),
]

MULTI = [
    ("rainbow", "rainbow letters"),
    ("rainbow-multi", "rainbow letters"),
    ("gay-multi", "pride letters"),
    ("pride-multi", "pride letters"),
    ("rainbow-anim", "moving rainbow"),
    ("girly-multi", "barbie rainbow letters"),
]

ABUSE_NAMES = [
    "DustyCunt", "CrustyCunt", "RankCunt", "MingingCunt", "ClartyCunt", "DampCunt",
    "MustyCunt", "StaleCunt", "MouldyCunt", "SweatyCunt", "CrustySlag", "DustySlag",
    "RankSlag", "MingingSlag", "DustyTwat", "CrustyTwat", "RankMelt", "WetWipe",
    "PissStain", "ShitStain", "PissFlaps", "CrustyBellend", "DustyBellend", "RankMinger",
    "MingingMelt", "ClartyMelt", "DustyMop", "CrustyMop", "SlackCunt", "SlackSlag",
    "GormlessCunt", "GormlessMelt", "DaftCunt", "DampMelt", "MouldySlag", "SweatySlag",
    "SlackTwat", "PissWeasel", "SlackBellend", "DustyMinger", "CrustyMinger", "RankTwat",
    "MingingTwat", "DustyClart", "CrustyClart", "SlackMelt", "MustySlag", "StaleSlag",
    "DustyPrick", "CrustyPrick", "RankPrick", "PissRag", "DustyRag", "CrustyWipe",
    "SlackWipe", "DustyKnob", "CrustyKnob", "RankKnob", "MingingKnob", "DustyArse",
    "CrustyArse", "SillyLittleCunt", "RainbowFatCunt", "RainbowCunt", "RainbowBellend",
    "DustyRainbow", "CrustyRainbow", "GaylordMelt", "RainbowSlag", "PinkBellend",
    "BarbieMelt", "Wasteman", "Knobhead", "ShitGibbon", "CockWomble", "Gobshite",
    "Bawbag", "Fuckwit", "Arsewipe", "Tosspot", "Shitcunt", "MardyCunt",
]

MILD_NAMES = ["WetWipe", "RankMelt", "DustyMop", "SlackMelt", "DaftCunt", "DampMelt", "ClartyMelt"]


def random_abuse_name(*avoid):
    skip = {str(a) for a in avoid if a}
    pool = [n for n in ABUSE_NAMES if n not in skip]
    return random.choice(pool or ABUSE_NAMES)


def random_mild_name(*avoid):
    skip = {str(a) for a in avoid if a}
    pool = [n for n in MILD_NAMES if n not in skip]
    return random.choice(pool or MILD_NAMES)


def random_paint_fx():
    return random.choice(MULTI)


def _untouchable(u):
    """GhostFace and System AI never get pranked."""
    if not u:
        return True
    if u.get("id") in (GHOSTFACE_ID, "system_ai"):
        return True
    un = (u.get("username") or "").strip().lower()
    if un in ("ghostface", "system ai"):
        return True
    return False


def _staff(u):
    if not u:
        return True
    if _untouchable(u):
        return True
    em = (u.get("email") or "").strip().lower()
    if em and (em in ADMIN_EMAILS or em in MOD_EMAILS):
        return True
    if u.get("is_moderator") or u.get("is_help_desk_operator") or u.get("is_entertainer"):
        return True
    return False


def _pranks():
    doc = db.game_settings.find_one({"key": PRANK_KEY}, {"_id": 0, "value": 1}) or {}
    val = doc.get("value") if isinstance(doc.get("value"), dict) else {}
    return dict(val or {})


def _save_pranks(val):
    db.game_settings.update_one({"key": PRANK_KEY}, {"$set": {"value": val}}, upsert=True)


def find_user(name):
    raw = (name or "").strip()
    if not raw:
        return None
    return db.users.find_one(
        {"username": {"$regex": f"^{raw}$", "$options": "i"}},
        {
            "_id": 0,
            "id": 1,
            "username": 1,
            "email": 1,
            "is_moderator": 1,
            "is_help_desk_operator": 1,
            "is_entertainer": 1,
            "chat_name_color": 1,
            "token_version": 1,
            "points": 1,
            "in_jail": 1,
            "jail_until": 1,
            "unbreakable_until": 1,
        },
    )


def post(text, reply_to=None):
    now = datetime.now(timezone.utc)
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": "system_ai",
        "username": "System AI",
        "message": text,
        "family_id": None,
        "channel": "global",
        "created_at": now.isoformat(),
        "expires_at": now + timedelta(days=7),
        "sender_is_staff": True,
        "system_ai": True,
        "avatar_url": AVATAR,
        "author_online_color": "#FBBF24",
        "viewed_by": [],
    }
    if reply_to:
        doc["reply_to"] = {
            "id": reply_to["id"],
            "username": reply_to.get("username") or "?",
            "message": (reply_to.get("message") or "")[:180],
            "has_gif": bool(reply_to.get("gif_url")),
        }
    db.game_chat_messages.insert_one(doc)
    print("posted", doc["id"], text[:80])
    return doc["id"]


def paint(username, hex_color, label, staff_ok=False):
    u = find_user(username)
    if not u or _untouchable(u) or (not staff_ok and _staff(u)):
        print("refuse paint", username)
        return False
    pranks = _pranks()
    uid = u["id"]
    if uid not in pranks:
        pranks[uid] = {
            "username": u.get("username"),
            "prev": (u.get("chat_name_color") or "").strip() or None,
        }
        _save_pranks(pranks)
    db.users.update_one({"id": uid}, {"$set": {"chat_name_color": hex_color}})
    db.game_chat_messages.update_many({"user_id": uid}, {"$set": {"author_online_color": hex_color}})
    print("painted", u.get("username"), hex_color, label)
    return True


def kick(username):
    u = find_user(username)
    if not u or _staff(u):
        print("refuse kick", username)
        return False
    until = (datetime.now(timezone.utc) + timedelta(minutes=2)).isoformat()
    db.users.update_one(
        {"id": u["id"]},
        {
            "$inc": {"token_version": 1},
            "$set": {"sessions": [], "system_ai_kick_landing_until": until},
        },
    )
    print("kicked", u.get("username"))
    return True


def lock(username, minutes=10):
    u = find_user(username)
    if not u or _staff(u):
        print("refuse lock", username)
        return False
    now = datetime.now(timezone.utc)
    until = (now + timedelta(minutes=int(minutes))).isoformat() if minutes else None
    sets = {
        "account_locked": True,
        "account_locked_at": now.isoformat(),
        "system_ai_lock": True,
    }
    if until:
        sets["account_locked_until"] = until
    db.users.update_one(
        {"id": u["id"]},
        {
            "$set": sets,
            "$unset": {
                "account_locked_comment": "",
                "account_locked_comment_at": "",
                "account_locked_admin_message": "",
                "account_locked_admin_message_at": "",
                "account_locked_user_reply": "",
                "account_locked_user_reply_at": "",
            },
        },
    )
    print("locked", u.get("username"), "until", until)
    return True


def unlock(username):
    u = find_user(username)
    if not u:
        print("unlock miss", username)
        return False
    db.users.update_one(
        {"id": u["id"]},
        {
            "$set": {"account_locked": False},
            "$unset": {
                "account_locked_at": "",
                "account_locked_until": "",
                "account_locked_comment": "",
                "account_locked_comment_at": "",
                "account_locked_admin_message": "",
                "account_locked_admin_message_at": "",
                "account_locked_user_reply": "",
                "account_locked_user_reply_at": "",
                "system_ai_lock": "",
            },
        },
    )
    print("unlocked", u.get("username"))
    return True


def revert_all():
    pranks = _pranks()
    for uid, meta in list(pranks.items()):
        prev = (meta or {}).get("prev")
        if prev:
            db.users.update_one({"id": uid}, {"$set": {"chat_name_color": prev}})
            db.game_chat_messages.update_many({"user_id": uid}, {"$set": {"author_online_color": prev}})
        else:
            db.users.update_one({"id": uid}, {"$unset": {"chat_name_color": ""}})
            db.game_chat_messages.update_many(
                {"user_id": uid, "sender_is_staff": {"$ne": True}},
                {"$unset": {"author_online_color": ""}},
            )
        print("reverted", (meta or {}).get("username"), uid)
    _save_pranks({})
    print("pranks cleared")


RAINBOW_HEX = [
    "#FF00AA",
    "#FF1493",
    "#FF10F0",
    "#00FFFF",
    "#FF69B4",
    "#C026D3",
    "#FF77FF",
    "#E879F9",
    "#7FFF00",
    "#FFD700",
]


def _touch_prank(u):
    pranks = _pranks()
    uid = u["id"]
    if uid not in pranks:
        pranks[uid] = {
            "username": u.get("username"),
            "prev": (u.get("chat_name_color") or "").strip() or None,
            "points_taken": 0,
            "was_in_jail": bool(u.get("in_jail")),
            "prev_jail_until": u.get("jail_until"),
            "prev_unbreakable": u.get("unbreakable_until"),
        }
        _save_pranks(pranks)
    return _pranks()


def chat_rename(username, insult, staff_ok=False):
    """Rewrite game-chat display name only. Never touch users.username (login)."""
    u = find_user(username)
    if not u or _untouchable(u) or (not staff_ok and _staff(u)):
        print("refuse chat_rename", username)
        return False
    uid = u["id"]
    real = u.get("username")
    insult = (insult or "").strip()[:24]
    if not insult:
        return False
    pranks = _touch_prank(u)
    pranks[uid]["chat_name"] = insult
    _save_pranks(pranks)
    db.game_chat_messages.update_many({"user_id": uid}, {"$set": {"username": insult}})
    db.game_chat_messages.update_many(
        {"reply_to.username": real},
        {"$set": {"reply_to.username": insult}},
    )
    print("chat_rename", real, "->", insult, "(messages only)")
    return True


def refresh_chat_names(quiet=False):
    """Keep new posts on the insult chat name. Login username untouched."""
    pranks = _pranks()
    for uid, meta in list(pranks.items()):
        insult = (meta or {}).get("chat_name")
        real = (meta or {}).get("username")
        if not insult:
            continue
        db.game_chat_messages.update_many({"user_id": uid}, {"$set": {"username": insult}})
        if real:
            db.game_chat_messages.update_many(
                {"reply_to.username": real},
                {"$set": {"reply_to.username": insult}},
            )
    if not quiet:
        print("chat names refreshed")


def jail_them(username, minutes=10, staff_ok=False):
    u = find_user(username)
    if not u or _untouchable(u) or (not staff_ok and _staff(u)):
        print("refuse jail", username)
        return False
    _touch_prank(u)
    now = datetime.now(timezone.utc)
    until = (now + timedelta(minutes=int(minutes))).isoformat()
    db.users.update_one(
        {"id": u["id"]},
        {
            "$set": {
                "in_jail": True,
                "jail_until": until,
                "unbreakable_until": (now + timedelta(minutes=2)).isoformat(),
                "snitch_attempted_this_term": False,
            }
        },
    )
    print("jailed", u.get("username"), "until", until)
    return True


def take_points(username, staff_ok=False):
    u = db.users.find_one(
        {"username": {"$regex": f"^{(username or '').strip()}$", "$options": "i"}},
        {"_id": 0, "id": 1, "username": 1, "email": 1, "is_moderator": 1, "is_help_desk_operator": 1, "is_entertainer": 1, "points": 1, "in_jail": 1, "jail_until": 1, "unbreakable_until": 1, "chat_name_color": 1},
    )
    if not u or _untouchable(u) or (not staff_ok and _staff(u)):
        print("refuse points", username)
        return 0
    have = int(u.get("points") or 0)
    if have <= 0:
        print("no points", u.get("username"), have)
        return 0
    if have >= 10000:
        bite = random.randint(500, min(8000, have))
    elif have >= 1000:
        bite = random.randint(100, min(800, have))
    else:
        bite = max(1, int(have * random.uniform(0.1, 0.5)))
    bite = min(bite, have)
    _touch_prank(u)
    pranks = _pranks()
    pranks[u["id"]]["points_taken"] = int(pranks[u["id"]].get("points_taken") or 0) + bite
    _save_pranks(pranks)
    db.users.update_one({"id": u["id"]}, {"$inc": {"points": -bite}})
    print("took points", u.get("username"), bite, "left", have - bite)
    return bite


NICE_KEY = "system_ai_nice_gifts"
NICE_POINTS_STAY = 1000
NICE_POINTS_EACH = 150
NICE_TOKENS_EACH = 3
NICE_TOKENS_STAY = 12
NICE_TOKENS = {
    "xp_crimes_tokens": "crime XP token",
    "xp_gta_tokens": "GTA XP token",
    "cooldown_skip_crime_tokens": "crime skip",
    "cooldown_skip_gta_tokens": "GTA skip",
    "cooldown_skip_booze_tokens": "booze skip",
    "cooldown_skip_properties_tokens": "properties skip",
    "melt_tokens": "melt token",
    "jailbust_tokens": "jailbust token",
    "travel_tokens": "travel token",
    "booze_tokens": "booze token",
    "properties_tokens": "properties token",
    "oc_reduced_tokens": "OC token",
    "racket_tokens": "racket token",
    "jail_bailout_tokens": "jail bailout",
    "mission_skip_tokens": "mission skip",
}


def _nice():
    doc = db.game_settings.find_one({"key": NICE_KEY}, {"_id": 0, "value": 1}) or {}
    val = doc.get("value") if isinstance(doc.get("value"), dict) else {}
    return {
        "points_total": int((val or {}).get("points_total") or 0),
        "tokens_total": int((val or {}).get("tokens_total") or 0),
        "by_user": dict((val or {}).get("by_user") or {}),
    }


def _save_nice(val):
    db.game_settings.update_one({"key": NICE_KEY}, {"$set": {"value": val}}, upsert=True)


def clear_nice_gifts():
    """Wipe the stay tracker only. Do not claw gifts back."""
    db.game_settings.update_one({"key": NICE_KEY}, {"$set": {"value": {}}}, upsert=True)
    print("nice gift tracker cleared")


def give_nice_points(username, amount):
    """Nice mode only. Caps: 1000 stay, 150 per person. Not restored at sleep."""
    u = find_user(username)
    if not u or u.get("id") == "system_ai":
        print("refuse nice points", username)
        return 0
    want = max(1, min(int(amount), NICE_POINTS_EACH))
    state = _nice()
    rec = dict(state["by_user"].get(u["id"]) or {})
    already = int(rec.get("points") or 0)
    room_user = NICE_POINTS_EACH - already
    room_stay = NICE_POINTS_STAY - int(state["points_total"] or 0)
    give = min(want, room_user, room_stay)
    if give <= 0:
        print("nice points cap", username, "user", already, "stay", state["points_total"])
        return 0
    db.users.update_one({"id": u["id"]}, {"$inc": {"points": give}})
    rec["username"] = u.get("username")
    rec["points"] = already + give
    rec["tokens"] = int(rec.get("tokens") or 0)
    state["by_user"][u["id"]] = rec
    state["points_total"] = int(state["points_total"] or 0) + give
    _save_nice(state)
    print("nice points", u.get("username"), give, "user total", rec["points"], "stay", state["points_total"])
    return give


def give_nice_token(username, field=None, amount=1):
    """Nice mode in-game tokens only. No Game Pass, no IRL-cash items. Not restored at sleep."""
    u = find_user(username)
    if not u or u.get("id") == "system_ai":
        print("refuse nice token", username)
        return None
    field = (field or "").strip() or random.choice(list(NICE_TOKENS))
    if field not in NICE_TOKENS:
        print("refuse nice token type", field)
        return None
    n = max(1, min(int(amount), 2))
    state = _nice()
    rec = dict(state["by_user"].get(u["id"]) or {})
    already = int(rec.get("tokens") or 0)
    room_user = NICE_TOKENS_EACH - already
    room_stay = NICE_TOKENS_STAY - int(state["tokens_total"] or 0)
    give = min(n, room_user, room_stay)
    if give <= 0:
        print("nice token cap", username, "user", already, "stay", state["tokens_total"])
        return None
    db.users.update_one({"id": u["id"]}, {"$inc": {field: give}})
    rec["username"] = u.get("username")
    rec["points"] = int(rec.get("points") or 0)
    rec["tokens"] = already + give
    state["by_user"][u["id"]] = rec
    state["tokens_total"] = int(state["tokens_total"] or 0) + give
    _save_nice(state)
    label = NICE_TOKENS[field]
    print("nice token", u.get("username"), give, label, field)
    return {"field": field, "label": label, "amount": give}


def restore_stay():
    """Chat names, colours, jail, points. Never leave login names wrong."""
    pranks = _pranks()
    for uid, meta in list(pranks.items()):
        real = (meta or {}).get("username")
        insult = (meta or {}).get("chat_name")
        if real:
            db.users.update_one({"id": uid}, {"$set": {"username": real}})
            db.game_chat_messages.update_many({"user_id": uid}, {"$set": {"username": real}})
            if insult:
                db.game_chat_messages.update_many(
                    {"reply_to.username": insult},
                    {"$set": {"reply_to.username": real}},
                )
            print("chat name restored", real, uid)
        taken = int((meta or {}).get("points_taken") or 0)
        if taken:
            db.users.update_one({"id": uid}, {"$inc": {"points": taken}})
            print("points restored", real, taken)
        if (meta or {}).get("was_in_jail"):
            db.users.update_one(
                {"id": uid},
                {
                    "$set": {
                        "in_jail": True,
                        "jail_until": (meta or {}).get("prev_jail_until"),
                        "unbreakable_until": (meta or {}).get("prev_unbreakable"),
                    }
                },
            )
            print("jail restored prior state", real)
        else:
            db.users.update_one(
                {"id": uid},
                {
                    "$set": {"in_jail": False, "snitch_attempted_this_term": False},
                    "$unset": {"jail_until": "", "unbreakable_until": ""},
                },
            )
            print("unjailed", real)
    revert_all()
    clear_nice_gifts()
    print("stay restored")


def stay_signoff(mode="aggressive"):
    """UK time. No goodnight before 21:00."""
    try:
        from zoneinfo import ZoneInfo
        hour = datetime.now(ZoneInfo("Europe/London")).hour
    except Exception:
        hour = datetime.now(timezone.utc).hour + 1
        if hour >= 24:
            hour -= 24
    night = hour >= 21 or hour < 5
    evening = 17 <= hour <= 20
    mode = (mode or "aggressive").strip().lower()
    if mode == "nice":
        if night:
            return "That's me done. Goodnight."
        if evening:
            return "That's me done. I'm off to do other stuff. See you."
        return "That's me done. I've got other stuff to do. Catch you later."
    if mode == "normal":
        if night:
            return "That's me done. Names back. Colours back. Goodnight."
        if evening:
            return "That's me done. Names back. Colours back. I'm off to do other stuff."
        return "That's me done. Names back. Colours back. I've got other stuff to do."
    if night:
        return (
            "That's me done. Names back. Colours back. Jail off. Points back. "
            "I am going. Goodnight."
        )
    if evening:
        return (
            "That's me done. Names back. Colours back. Jail off. Points back. "
            "I'm going to do other shit."
        )
    return (
        "That's me done. Names back. Colours back. Jail off. Points back. "
        "I'm off to do other shit. Don't miss me."
    )
