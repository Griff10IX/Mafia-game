# FORUM_FAQ.md — source of truth (maintainers)

Use this when updating [FORUM_FAQ.md](FORUM_FAQ.md) so numbers stay aligned with the codebase.

| Topic | Source file / symbol |
|--------|----------------------|
| Rank names & RP thresholds | `backend/server.py` → `RANKS` |
| Prestige titles & multipliers | `backend/server.py` → `PRESTIGE_CONFIGS`, `get_prestige_bonus` |
| Interest bank terms & % | `backend/server.py` → `BANK_INTEREST_OPTIONS` |
| Kill cash % | `backend/server.py` → `KILL_CASH_PERCENT` (events: `kill_cash` in `GAME_EVENTS`) |
| Armour tier scaling (bullets formula) | `backend/server.py` → `ARMOUR_BASE_BULLETS`; `backend/routers/kill/attack.py` → `_bullets_to_kill` |
| Molotov bullet equivalent | `backend/routers/kill/attack.py` → `MOLOTOV_BULLET_EQUIV` |
| Health restore cost | `backend/routers/game/store.py` → `buy_health` |
| Silencer cost | `backend/routers/game/store.py` → `SILENCER_COST_POINTS` |
| Auto Rank purchase | `backend/routers/game/store.py` → `AUTO_RANK_COST_POINTS` |
| OC / Crew OC timer store prices | `backend/routers/game/store.py` → `OC_TIMER_COST_POINTS`, `CREW_OC_TIMER_COST_POINTS` |
| Property catalog ($/hr, max level) | Database `properties` collection; API via `backend/routers/money/properties.py` |
| Weapon list & damage | Database `weapons` collection; `backend/routers/kill/armoury.py` |
| BBCode & smileys | `src/utils/forumContent.js` → `parseForumContent` |
| DM wink behaviour | `src/pages/Social/InboxChat.js` → `dmUnicodeSmileys` |
