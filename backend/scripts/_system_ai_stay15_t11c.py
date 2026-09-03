from _system_ai_prank_helpers import _nice, _save_nice, db, post

THOR = "37137408-371d-41d2-ae26-2dfc83a72c8b"
u = db.users.find_one({"id": THOR}, {"_id": 0, "username": 1, "mission_skip_tokens": 1})
have = int((u or {}).get("mission_skip_tokens") or 0)
print("before", have)
take = min(1, have)
if take:
    db.users.update_one({"id": THOR}, {"$inc": {"mission_skip_tokens": -take}})
    state = _nice()
    rec = dict(state["by_user"].get(THOR) or {})
    rec["username"] = (u or {}).get("username") or "Thor"
    rec["points"] = int(rec.get("points") or 0)
    rec["tokens"] = max(0, int(rec.get("tokens") or 0) - take)
    state["by_user"][THOR] = rec
    state["tokens_total"] = max(0, int(state["tokens_total"] or 0) - take)
    _save_nice(state)
after = db.users.find_one({"id": THOR}, {"_id": 0, "mission_skip_tokens": 1})
print("after", (after or {}).get("mission_skip_tokens"))
if take:
    src = db.game_chat_messages.find_one(
        {"id": "3fe1c8d9-8b42-4ab6-aa66-7ace8e927861"},
        {"_id": 0, "id": 1, "username": 1, "message": 1, "gif_url": 1},
    )
    post("Had to actually pull it. Skip is gone off Thor now.", reply_to=src)
else:
    print("still none")
