# FAQ route coverage (maintainers)

Crosswalk of major authenticated areas ([src/App.js](../src/App.js) routes and sidebar) against [FORUM_FAQ.md](FORUM_FAQ.md) sections. Update this table when adding navigation-visible features.

| Area / route | FAQ section (anchor topic) |
|--------------|----------------------------|
| `/crime/crimes`, `/crime/gta`, `/crime/jail` | CRIMES, JAIL SYSTEM |
| `/kill/attack`, `/kill/bodyguards`, `/kill/hitlist`, `/kill/hitman`, `/kill/armour-weapons`, `/kill/attempts` | COMBAT (incl. Hitman for Hire, new-account protection) |
| `/money/bank`, `/money/stocks`, `/money/property`, `/my-properties`, `/money/booze-run`, `/money/racket`, `/money/crack-safe`, `/money/quick-trade` | MONEY MAKING (incl. **Wealth ranks** — cash on hand) |
| `/cars/*` (garage, buy, sell, view) | GARAGE & VEHICLES |
| `/organised-crime` | CRIMES → Organised Crime |
| `/game/travel`, `/game/states` | TRAVEL (+ States overview) |
| `/game/family/*` | FAMILIES |
| `/casino`, `/casino/dice`, `/rlt`, `/blackjack`, `/slots`, `/horseracing`, `/videopoker`, `/mdg`, `/mp-*` | CASINOS |
| `/sports-betting` | CASINOS (+ [FORUM_HOW_TO.md](FORUM_HOW_TO.md) Sports betting) |
| `/casino/mini-games/*` | MINI-GAMES (+ Famiglia) |
| `/game/leaderboard` | PROGRESSION → Game Leaderboard |
| `/casino/mini-games/leaderboard` | MINI-GAMES → Mini-Games Leaderboard |
| `/game/ranking`, `/game/ranking/badges` | PROGRESSION |
| `/account/missions`, `/account/objectives`, `/account/prestige`, `/account/inventory` | PROGRESSION |
| `/game/daily-rewards` | FAQ Q&A Daily Rewards |
| `/game/store` | POINT STORE |
| `/game-pass` | GAME PASS |
| `/account/autorank` | AUTO RANK |
| `/social/inbox`, `/social/forum`, `/social/image-host`, `/game/help-desk`, `/game/game-ideas` | SOCIAL FEATURES |
| `/game/users-online` | SOCIAL FEATURES → Users online |
| `/account/profile`, `/account/stats`, `/account/referral` | SOCIAL / PROGRESSION; wealth tier also under **MONEY MAKING → Wealth ranks** |
| `/game/dead-alive` | COMBAT → Dead > Alive; MONEY (banks) cross-links |

Routes without a dedicated FAQ paragraph are usually covered by a parent section (e.g. all casinos under CASINOS). If you add a **new** top-level game mode, add a short FAQ subsection and a row here.

**How To guide:** Step-by-step player copy for the same areas (no backend detail) lives in [FORUM_HOW_TO.md](FORUM_HOW_TO.md) → forum topic **How To**. Update that file when you add major menu-visible flows; keep [FORUM_FAQ.md](FORUM_FAQ.md) as the rules source of truth.
