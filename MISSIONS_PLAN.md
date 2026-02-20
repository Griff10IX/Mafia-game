# Missions System – Plan (missions.py + 2D Map)

## Overview

A **2D interactive map** of the game’s **4 cities** (Chicago, New York, Las Vegas, Atlantic City). Each city is a “map section” with its own missions. Players must **finish the current city’s missions** before the next city’s map unlocks. Missions include generic goals (e.g. “commit X crimes”) and **special missions** with mission characters and story beats.

---

## 1. High-level flow

- **One map at a time**: Player sees a 2D map for **one city** (e.g. Chicago).
- **Sections / districts**: The city map can be divided into **districts or areas** (e.g. Downtown, Docks, etc.). Each area can have 1+ missions or mission givers.
- **Progression**: Complete **all required missions** (and optionally special missions) in City 1 → **unlock** City 2 map. Same for 2→3 and 3→4.
- **Travel**: Missions are tied to the **current city** (existing `current_state` / travel). The Missions map view shows the city the player is in (or a chosen “mission city” if we allow viewing ahead).

---

## 2. Cities (map order)

| Order | City           | Notes                    |
|-------|----------------|--------------------------|
| 1     | Chicago        | First map (tutorial tier) |
| 2     | New York       | Unlock after Chicago     |
| 3     | Las Vegas      | Unlock after New York    |
| 4     | Atlantic City  | Unlock after Las Vegas   |

Use existing `STATES` from `backend/config.py`: `["Chicago", "New York", "Las Vegas", "Atlantic City"]`.

---

## 3. Mission types

### 3.1 Generic / stat-based missions

- **Crime count**: “Commit X crimes” (use existing crimes system).
- **GTA**: “Steal X cars” or “Complete X GTA thefts.”
- **Earnings**: “Earn $X from crimes” or “Earn $X total.”
- **Rank**: “Reach rank Y” (e.g. Hustler).
- **Other**: “Win X attacks,” “Bust X players from jail,” “Travel to Y,” etc.

**Backend**: Check existing user stats (crimes committed, GTA count, money, rank, attacks, etc.) and compare to mission requirements.

### 3.2 Special missions (mission characters)

- **NPC / character givers**: e.g. “Meet the Fixer in the Docks,” “Talk to the Boss in Downtown.”
- **Steps**: Multi-step objectives (talk → do action → report back).
- **Rewards**: Cash, points, items, or “unlock next area/city.”
- **State**: Stored per user (e.g. `user_mission_progress` or `mission_completions`).

We can introduce **mission characters** as a new entity (e.g. `mission_characters` collection or embedded in mission definitions) with:
- `id`, `name`, `city`, `area`, `mission_id`, dialogue or script reference.

---

## 4. Data model (backend)

### 4.1 Collections / concepts

- **Missions (config)**
  - `missions` (or seed JSON): list of mission definitions.
  - Fields per mission: `id`, `city`, `area` (optional), `order` (for unlock order), `type` (e.g. `crime_count`, `gta_count`, `special`), `requirements` (e.g. `{ "crimes": 10 }`), `title`, `description`, `reward_money`, `reward_points`, `unlocks_city` (next city id or null), `character_id` (for special missions).

- **Mission characters (optional)**
  - `mission_characters`: `id`, `name`, `city`, `area`, `mission_id`, `dialogue_intro`, `dialogue_complete`, etc.

- **User progress**
  - `user_missions` or fields on `users`: which missions are completed, which city map is unlocked, current step for special missions.
  - Example: `user_mission_completions: [{ mission_id, completed_at }]`, `unlocked_cities: ["Chicago","New York"]` (or derive from highest completed city).

### 4.2 Unlock rule

- **City N+1** unlocks when **all required missions** for **City N** are completed (and optionally “main story” specials).
- Stored as: `unlocked_maps_up_to: "New York"` or `completed_missions: ["m1","m2",...]` and derive unlock from mission definitions.

---

## 5. Backend: missions router (missions.py)

- **GET /missions**  
  - Returns: list of missions for the user (filtered by unlocked cities), with completion status and requirements progress.  
  - Input: optional `city` to restrict.

- **GET /missions/map**  
  - Returns: current map state for the user: which city they’re on, which areas/missions are available, which are done, and what’s locked (next city locked until current city is complete).

- **POST /missions/{mission_id}/complete** (or **POST /missions/check**)  
  - For stat-based missions: check if user now meets requirements; if yes, mark complete and grant rewards, possibly unlock next city.  
  - For special missions: advance step or mark complete when condition met.

- **GET /missions/characters** (if we use characters)  
  - Return mission characters for a city/area for the map UI (dialogue, position hint, etc.).

- **Shared helpers**
  - `_user_unlocked_cities(user_id)`  
  - `_mission_progress(user, mission)` (e.g. crimes so far vs required)  
  - `_check_mission_complete(user, mission)`  
  - Grant rewards and update `unlocked_cities` / `user_mission_completions`.

Use existing systems: **crimes** (count, type), **GTA** (thefts), **attack**, **rank**, **travel** (current_state), **bank/earnings** so missions don’t duplicate logic.

---

## 6. Frontend: 2D interactive map

- **One page/route**: e.g. `/missions` or `/map`.
- **Map per city**: Asset or procedural 2D map per city (Chicago, NY, LV, Atlantic City). Can start with a simple grid or image map with clickable **areas/districts**.
- **Areas**: Each area can show:
  - Name, list of missions (locked / in progress / complete).
  - For special missions: “Talk to [Character]” and a marker or button that opens dialogue/objective.
- **Progression**: 
  - Only the **current unlocked city** map is playable (or show next city greyed out with “Complete Chicago to unlock”).
  - When all required missions in a city are done, show “New York unlocked” and allow switching to that map (or auto-advance).

- **UI elements**
  - City selector (only unlocked cities).
  - 2D map with area markers; click area → mission list + “Talk to” for character missions.
  - Mission list: requirement text, progress (e.g. “7/10 crimes”), “Complete” or “In progress,” rewards.
  - Optional: character portrait + dialogue modal for special missions.

- **Tech**: Canvas, SVG, or div-based grid with absolute positioning. Assets: one background map image per city + markers; or CSS/Canvas drawn districts.

---

## 7. Implementation order (suggested)

1. **Backend**
   - Add `missions` config (in code or JSON seed) for City 1 (Chicago) only: a few stat missions (e.g. “Commit 5 crimes,” “Earn $1000”).
   - Add `user_mission_completions` (and optionally `unlocked_cities`) on user or in `user_missions` collection.
   - Implement `missions.py`: GET /missions, GET /missions/map, POST /missions/{id}/complete (or check endpoint).
   - Implement unlock rule: complete all Chicago missions → unlock New York map.

2. **Frontend**
   - Add `/missions` route and a simple **single-city map** (e.g. Chicago only): one image or grid, 1–2 areas.
   - List missions per area with progress and “Complete” when eligible.
   - Wire “Complete” to backend and refresh; show “New York unlocked” when Chicago is done.

3. **Expand**
   - Add New York, Las Vegas, Atlantic City missions and map assets.
   - Add **mission characters** and special missions (dialogue, steps).
   - Add more mission types (GTA, attacks, busts, travel, rank).

4. **Polish**
   - 2D art per city, better area markers, dialogue UI, rewards popups.

---

## 8. Open decisions

- **Districts per city**: How many areas per city (e.g. 3–5)? Flat list or hierarchical (district → sub-areas)?
- **Main story vs side**: One “main” mission chain per city that unlocks the next, plus optional side missions for rewards only?
- **Character art**: Placeholder avatars vs final art for mission characters?
- **Map style**: Realistic 2D, top-down, stylized icons, or minimal (buttons per area)?
- **Resetting missions**: One-time only, or repeatable for extra rewards?

---

## 9. File / structure summary

| Layer   | Item |
|--------|------|
| Backend | `backend/routers/missions.py` (new), `backend/data/missions.json` (optional seed) |
| Config  | Use `STATES` from `config.py`; mission definitions reference `city` = one of STATES |
| DB      | User progress: `user_mission_completions`, `unlocked_cities` (or equivalent on `users`) |
| Frontend | `src/pages/Missions.js` (or Map.js), map assets in `public/` or `src/assets/` |
| Routes  | `/missions` (map + missions), optional `/missions/characters` for dialogue |

This plan keeps missions tied to the existing 4 cities and current_state/travel, reuses crimes/GTA/attack/rank, and adds a clear path from a simple first city (Chicago) to a full 2D map with special missions and characters.
