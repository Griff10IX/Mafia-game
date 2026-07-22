from pathlib import Path

t = Path("backend/routers/account/auto_rank.py").read_text(encoding="utf-8")
marker = '@router.get("/auto-rank/stats")'
idx = t.find(marker)
find_idx = t.find("await db.users.find_one", idx)
# second find_one might be it - print a few
pos = idx
for n in range(3):
    pos = t.find("await db.users.find_one", pos + 1)
    if pos < 0 or pos > idx + 5000:
        break
    print("find at", pos - idx, "relative")
    snippet = t[pos : pos + 120]
    print(snippet.replace("\n", " ")[:120])

# Get the projection of the first find_one after stats
p = t.find("await db.users.find_one", idx)
p0 = t.find("{", p)
depth = 0
for k, ch in enumerate(t[p0:], p0):
    if ch == "{":
        depth += 1
    elif ch == "}":
        depth -= 1
        if depth == 0:
            proj = t[p0 : k + 1]
            for key in [
                "cooldown_skip_crime_tokens",
                "cooldown_skip_gta_tokens",
                "cooldown_skip_booze_tokens",
                "jail_bailout_tokens",
                "token_perk_stats",
                "cooldown_skip_day",
            ]:
                print(f"{key}: {key in proj}")
            # show if projection is too short (maybe wrong brace)
            print("proj length", len(proj))
            break
