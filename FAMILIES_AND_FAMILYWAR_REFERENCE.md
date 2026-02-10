# Families & Family War — Frontend and Backend Reference

## Frontend (already in project)

| File | Description |
|------|-------------|
| `frontend/src/pages/FamilyPage.js` | Main families page: list families, create/join, my family (treasury, rackets, roster, raid enemy rackets, war modal, war history) |
| `frontend/src/pages/FamilyProfilePage.js` | View one family by tag: name, tag, treasury, rackets, members |

**FamilyPage.js** calls:
- `GET /families` — list all families  
- `GET /families/my` — my family, members, rackets, my_role  
- `GET /families/config` — max_families, roles, racket_max_level  
- `GET /families/wars/history` — last wars  
- `GET /families/war/stats` — active wars + stats  
- `GET /families/racket-attack-targets` — raid targets  
- `POST /families` — create family  
- `POST /families/join` — join  
- `POST /families/leave` — leave  
- `POST /families/kick` — kick member  
- `POST /families/assign-role` — assign role  
- `POST /families/deposit` — deposit to treasury  
- `POST /families/withdraw` — withdraw  
- `POST /families/rackets/:id/collect` — collect racket  
- `POST /families/rackets/:id/upgrade` — upgrade racket  
- `POST /families/attack-racket` — raid enemy racket  
- `POST /families/war/truce/offer` — offer truce  
- `POST /families/war/truce/accept` — accept truce  

**FamilyProfilePage.js** calls:
- `GET /families/lookup?tag=...` — one family by tag  

---

## Backend (in server.py)

All families and family-war API routes are in **`backend/server.py`**.

### Constants and models (server.py)
- **Lines ~518–540:** `MAX_FAMILIES`, `FAMILY_ROLES`, `FAMILY_ROLE_LIMITS`, `FAMILY_ROLE_ORDER`, `FAMILY_RACKETS`, `RACKET_UPGRADE_COST`, `RACKET_MAX_LEVEL`, `FAMILY_RACKET_ATTACK_*`
- **Lines ~543–566:** `FamilyCreateRequest`, `FamilyJoinRequest`, `FamilyKickRequest`, `FamilyRoleRequest`, `FamilyDepositRequest`, `FamilyWithdrawRequest`, `FamilyAttackRacketRequest`, `WarTruceRequest`

### Internal helpers (server.py)
- **Lines ~727–731:** `send_notification_to_family`
- **Lines ~734–765:** `_family_war_start`
- **Lines ~770–831:** `_family_war_check_wipe_and_award`
- **Lines ~840–914:** `_family_in_active_war`, `_get_active_war_between`, `_get_active_war_for_family`, `_record_war_stats_bodyguard_kill`, `_record_war_stats_player_kill`

### API routes (server.py)
- **After admin_seed_families** (search for `# ============ Families & Family War API`):
  - `GET /families` — list
  - `GET /families/config` — config
  - `GET /families/my` — my family + members + rackets
  - `GET /families/lookup` — one family by tag
  - `POST /families` — create
  - `POST /families/join` — join
  - `POST /families/leave` — leave
  - `POST /families/kick` — kick
  - `POST /families/assign-role` — assign role
  - `POST /families/deposit` — deposit
  - `POST /families/withdraw` — withdraw
  - `POST /families/rackets/{racket_id}/collect` — collect
  - `POST /families/rackets/{racket_id}/upgrade` — upgrade
  - `GET /families/racket-attack-targets` — raid targets (optional `?debug=true`)
  - `POST /families/attack-racket` — raid enemy racket
  - `GET /families/war/stats` — active wars + stats
  - `POST /families/war/truce/offer` — offer truce
  - `POST /families/war/truce/accept` — accept truce
  - `GET /families/wars/history` — last 10 wars

### Admin
- **`POST /admin/seed-families`** — seed 3 families with members (admin only)

### War trigger (attack flow)
- When a player kills another in attack, if both have families, **`_family_war_start(killer_family_id, victim_family_id)`** is called (in the attack/execute flow).
- When a family has no living members, **`_family_war_check_wipe_and_award(victim_family_id)`** is called to end the war and award the winner (rackets + exclusive cars).

### Collections used
- `families` — id, name, tag, boss_id, treasury, rackets, created_at  
- `family_members` — id, family_id, user_id, role, joined_at  
- `family_wars` — id, family_a_id, family_b_id, status, created_at, ended_at, winner_family_id, loser_family_id, prize_rackets, prize_exclusive_cars, truce_offered_by_family_id  
- `family_war_stats` — war_id, user_id, family_id, bodyguard_kills, bodyguards_lost, kills, deaths  
- `family_racket_attacks` — attacker_family_id, target_family_id, target_racket_id, last_at (for 2h cooldown per racket raid)  
- `users` — family_id, family_role  

---

## Summary

- **Frontend:** `FamilyPage.js` and `FamilyProfilePage.js` in `frontend/src/pages/`.  
- **Backend:** All families and family-war logic and routes are in **`backend/server.py`** (constants, models, helpers, and the routes listed above). No separate router files for families or familywar; everything is in the main server file so the frontend works as-is.
