"""Sample date formats + estimate reclaimable log waste."""
from collections import Counter
from _system_ai_prank_helpers import db

for name, field in [
    ("activity_log", "created_at"),
    ("analytics_events", "created_at"),
    ("attack_attempts", "created_at"),
    ("toast_events", "created_at"),
    ("bot_client_block_events", "created_at"),
]:
    samples = list(db[name].find({}, {field: 1, "expires_at": 1}).sort([(field, 1)]).limit(3))
    samples += list(db[name].find({}, {field: 1, "expires_at": 1}).sort([(field, -1)]).limit(3))
    types = Counter()
    for d in db[name].aggregate([{"$sample": {"size": 50}}, {"$project": {field: 1}}]):
        v = d.get(field)
        types[type(v).__name__] += 1
        if isinstance(v, str):
            types["str_has_T" if "T" in v else "str_has_space" if " " in v[:20] else "str_other"] += 1
    print(name, "types", dict(types))
    for s in samples[:2] + samples[-2:]:
        print(" ", s.get(field), type(s.get(field)).__name__, "exp", s.get("expires_at"))
