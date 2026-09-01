"""End of stay: names, colours, locks, kick landings back. Do not leave staff renamed."""
from _system_ai_prank_helpers import _pranks, db, post, revert_all, unlock

GF = "36425cb4-3755-4669-b4b5-5d86345991d0"
HP = "a20e2b58-95d7-4bf4-8a41-244f620b3298"
SLEEP_SRC = "6a7969e4-7796-46c9-9d24-6f6061aa51ac"

pranks = _pranks()
for uid, meta in list(pranks.items()):
    orig = (meta or {}).get("username")
    if orig:
        db.users.update_one({"id": uid}, {"$set": {"username": orig}})
        db.game_chat_messages.update_many({"user_id": uid}, {"$set": {"username": orig}})
        print("name restored", orig, uid)
        unlock(orig)

for name in ("Highlights", "Schizophrenic"):
    unlock(name)

# Anyone still on a System AI lock
for u in db.users.find({"system_ai_lock": True}, {"_id": 0, "id": 1, "username": 1}):
    unlock(u.get("username"))
    print("unlocked leftover", u.get("username"), u.get("id"))

# Drop leftover kick landing pages
db.users.update_many(
    {"system_ai_kick_landing_until": {"$exists": True}},
    {"$unset": {"system_ai_kick_landing_until": ""}},
)

revert_all()

gf = db.roulette_ownership.find_one({"owner_id": GF, "city": "New York"}, {"_id": 0, "max_bet": 1})
print("gf ny roulette", gf)
if not gf or int(gf.get("max_bet") or 0) != 25_000_000:
    db.roulette_ownership.update_one(
        {"owner_id": GF, "city": "New York"}, {"$set": {"max_bet": 25_000_000}}
    )
    print("gf roulette restored 25m")

hp = db.videopoker_ownership.find_one({"owner_id": HP, "city": "New York"}, {"_id": 0, "max_bet": 1})
print("hp ny videopoker", hp)
if not hp or int(hp.get("max_bet") or 0) != 5_000_000_000:
    db.videopoker_ownership.update_one(
        {"owner_id": HP, "city": "New York"}, {"$set": {"max_bet": 5_000_000_000}}
    )
    print("hp videopoker restored 5b")

for uid, label in (
    ("ff620eef-283a-4016-a172-d33854bcee7b", "Highlights"),
    ("828d4094-7095-4007-bb4e-9d8c25c7bc8f", "Schizophrenic"),
):
    u = db.users.find_one(
        {"id": uid},
        {"_id": 0, "username": 1, "account_locked": 1, "system_ai_lock": 1, "chat_name_color": 1},
    )
    print("check", label, u)

src = db.game_chat_messages.find_one(
    {"id": SLEEP_SRC},
    {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1},
)
if src and not db.game_chat_messages.find_one(
    {"user_id": "system_ai", "reply_to.id": SLEEP_SRC}, {"_id": 1}
):
    post(
        "Night. Names back. Colours back. Locks off. Everything is normal. I am going. Goodnight.",
        reply_to=src,
    )
print("sleep done")
