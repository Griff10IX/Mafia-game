"""Default kill search length when no per-user override or game_config default applies.

Used by `routers.kill.attack.search_target` for every target looked up there: real players,
human bodyguards, and robot bodyguards (all share the same `/attack/search` path). Hitlist
NPC auto-searches use the same constants from `routers.kill.hitlist`.
"""

# Random uniform range (inclusive): 2h 15m .. 2h 45m
KILL_SEARCH_RANDOM_MIN_MINUTES = 135
KILL_SEARCH_RANDOM_MAX_MINUTES = 165
