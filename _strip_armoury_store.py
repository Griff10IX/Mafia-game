"""Strip shooting-range from armoury.py and store bonus route; stub admin imports that break."""
from pathlib import Path
import re

# --- armoury.py ---
arm = Path("backend/routers/kill/armoury.py")
t = arm.read_text(encoding="utf-8")
# Remove minigame imports
t = re.sub(
    r"\nfrom routers\.minigames\.minigame_leaderboard import log_minigame_play\nfrom utils\.minigame_run_session import \([^)]+\)\n",
    "\n",
    t,
    count=1,
    flags=re.S,
)
t = re.sub(r"\nfrom utils\.minigame_security import skip_minigame_session\n", "\n", t)
# If log_minigame_payout import from server - keep if still used elsewhere in file; shooting range used it
# Remove shooting-range route registrations
t = re.sub(
    r"\n\s*router\.add_api_route\(\"/shooting-range/mastery\".*?\n",
    "\n",
    t,
    count=1,
    flags=re.S,
)
# More precise multi-line route removals
lines = t.splitlines(True)
out = []
i = 0
while i < len(lines):
    line = lines[i]
    if 'add_api_route("/shooting-range/' in line or "add_api_route('/shooting-range/" in line:
        # skip until closing paren of this call
        buf = line
        while buf.count("(") > buf.count(")") and i + 1 < len(lines):
            i += 1
            buf += lines[i]
        i += 1
        continue
    out.append(line)
    i += 1
t = "".join(out)

# Remove shooting range handler functions (from async def get_shooting_range_mastery through end of get_shooting_range_leaderboard)
t = re.sub(
    r"\nasync def get_shooting_range_mastery\(.*?(?=\nasync def |\nclass |\ndef register\(|\n    router\.add_api_route)",
    "\n",
    t,
    count=1,
    flags=re.S,
)
# Also remove remaining shooting range defs if any
for name in (
    "get_shooting_range_mastery",
    "train_shooting_range",
    "submit_shooting_range_score",
    "get_shooting_range_leaderboard",
):
    t = re.sub(
        rf"\nasync def {name}\(.*?(?=\nasync def |\nclass |\ndef register\(|\n    @|\n    router\.add_api_route|\Z)",
        "\n",
        t,
        count=1,
        flags=re.S,
    )

# Remove ShootingRangeScoreRequest model if present
t = re.sub(
    r"\nclass ShootingRangeScoreRequest\(.*?(?=\nclass |\nasync def |\ndef )",
    "\n",
    t,
    count=1,
    flags=re.S,
)

arm.write_text(t, encoding="utf-8")
print("armoury: shooting-range stripped; leftover shooting-range refs:", t.count("shooting-range"), "minigames refs:", t.count("minigames"))

# --- store.py ---
st = Path("backend/routers/game/store.py")
s = st.read_text(encoding="utf-8")
s2 = re.sub(
    r"\nasync def buy_shooting_range_bonus\(.*?(?=\nasync def |\ndef register\(|\n    router\.add_api_route)",
    "\n",
    s,
    count=1,
    flags=re.S,
)
lines = s2.splitlines(True)
out = []
i = 0
while i < len(lines):
    if 'buy-shooting-range-bonus' in lines[i]:
        buf = lines[i]
        while buf.count("(") > buf.count(")") and i + 1 < len(lines):
            i += 1
            buf += lines[i]
        i += 1
        continue
    out.append(lines[i])
    i += 1
s2 = "".join(out)
st.write_text(s2, encoding="utf-8")
print("store: bonus route removed; leftover:", s2.count("shooting-range"))
