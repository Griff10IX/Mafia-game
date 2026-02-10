# Frontend pages ↔ backend routers

Map of which JS pages call which backend routes. Backend routers live in `backend/routers/`.

## Ranking (crimes, gta, jail)

| Backend router | Frontend page(s) | API paths used |
|----------------|------------------|----------------|
| **ranking/crimes.py** | `Crimes.js` | `GET /crimes`, `POST /crimes/{id}/commit` |
| **ranking/gta.py** + server.py (options) | `GTA.js`, `Garage.js` | `GET /gta/options`, `GET /gta/garage`, `POST /gta/attempt`, `POST /gta/melt` |
| **ranking/jail.py** | `Jail.js` | `GET /jail/status`, `GET /jail/players`, `POST /jail/bust` |

**Also:** `Ranking.js` is the hub that links to Crimes, GTA, and Jail (no API calls of its own).

---

## Casino (stub backend – routes not restored yet)

| Backend router | Frontend page(s) | API paths used |
|----------------|------------------|----------------|
| **casino/casino.py** (stub) | `Casino.js`, `Casinos/Dice.js`, `Casinos/Rlt.js`, `Casinos/BlackjackPage.js`, `Casinos/HorseRacingPage.js` | `/casino/dice/*`, `/casino/roulette/*`, `/casino/blackjack/*`, `/casino/horseracing/*` |

- **Casino.js** – landing with links to Dice, Rlt, Blackjack, Horse Racing.
- **Casinos/Dice.js** – dice config, ownership, play, claim, buy-back.
- **Casinos/Rlt.js** – roulette config, spin.
- **Casinos/BlackjackPage.js** – blackjack config, history, start, hit, stand.
- **Casinos/HorseRacingPage.js** – horseracing config, history, race.

---

## Families (stub backend – routes not restored yet)

| Backend router | Frontend page(s) | API paths used |
|----------------|------------------|----------------|
| **families/families.py** (stub) | `FamilyPage.js`, `FamilyProfilePage.js` | `/families`, `/families/my`, `/families/config`, `/families/lookup`, `/families/join`, `/families/leave`, `/families/kick`, `/families/assign-role`, `/families/deposit`, `/families/withdraw`, `/families/rackets/{id}/collect`, `/families/rackets/{id}/upgrade`, `/families/racket-attack-targets`, `/families/attack-racket`, `/families/war`, `/families/war/stats`, `/families/war/truce/offer`, `/families/war/truce/accept`, `/families/wars/history` |

- **FamilyPage.js** – list families, my family, create/join/leave, rackets, war, truce.
- **FamilyProfilePage.js** – view one family by tag (`/families/:familyId`).

---

## Family war (stub backend – routes not restored yet)

| Backend router | Frontend page(s) | API paths used |
|----------------|------------------|----------------|
| **familywar/familywar.py** (stub) | Same as Families – **FamilyPage.js** | `/families/war`, `/families/war/stats`, `/families/war/truce/offer`, `/families/war/truce/accept`, `/families/wars/history` |

War endpoints are under `/families/...`; the frontend uses them from FamilyPage.

---

## Routes in App.js

- `/crimes` → **Crimes.js**
- `/gta` → **GTA.js**
- `/jail` → **Jail.js**
- `/casino` → **Casino.js** (then sub-routes to Dice, Rlt, Blackjack, HorseRacing)
- `/families` → **FamilyPage.js**
- `/families/:familyId` → **FamilyProfilePage.js**
- **Garage.js** is at `/garage` (uses GTA garage/melt APIs).

---

## Summary

| You care about… | Open / use these JS files |
|------------------|---------------------------|
| Crimes | `pages/Crimes.js` |
| GTA + Garage | `pages/GTA.js`, `pages/Garage.js` |
| Jail | `pages/Jail.js` |
| Ranking hub | `pages/Ranking.js` |
| Casino (all games) | `pages/Casino.js`, `pages/Casinos/Dice.js`, `Rlt.js`, `BlackjackPage.js`, `HorseRacingPage.js` |
| Families + war | `pages/FamilyPage.js`, `pages/FamilyProfilePage.js` |

**Layout.js** also calls `GET /crimes`, `GET /gta/options`, `GET /jail/players`, `GET /families/war` for the sidebar / nav state.
