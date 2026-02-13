# Mafia Game – Project Context for AI / New Developers

Use this file when working with AI or onboarding: it explains the **theme**, **UI conventions**, and **game mechanics** so changes stay consistent.

---

## 1. Theme & Visual Style

### Overall
- **Era / vibe:** 1920s–30s noir, prohibition-era mafia. Layered blacks, reflective gold, no brown.
- **Tone:** Dark, premium, “gangster” – gold accents for importance, not playful.

### Colour palette (see `src/styles/noir.module.css`)
- **Backgrounds:** Sidebar = true black (`#000000`). Main content = charcoal (`#1a1a1a`). Cards/panels = dark grey (`#282828`). Raised/hover = `#333333`.
- **Primary (gold):** `#d4af37` (main), `#e6c229` (bright), `#b8860b` (dark). Used for: headings, active nav, primary buttons, key labels, borders on important elements.
- **Foreground:** Light grey/white (`#f5f5f5`) for main text. Muted grey (`#a1a1aa`) for secondary text.
- **Profit/success:** Green (`#5cb85c`) for gains, positive stats.
- **Danger:** Red for Sell, Dead, destructive actions, Jailed badge.
- **Scrollbars:** Thumb `#303030`, hover `#404040` – dark grey, **not** gold (see `src/index.css` and `noir.module.css`).

### UI conventions
- **Panels:** Dark grey surface, thin gold-tinted border (`border-primary/20`–`/30`). Rounded corners minimal (`rounded-sm`).
- **Section headers:** Often gold bar under title, or gradient strip `from-primary/20 via-primary/10 to-primary/20` with gold text.
- **Radio buttons / accents:** Use `#303030` (dark grey) for `accent` so they match the dark theme, not gold.
- **Primary buttons:** Gradient gold with white text (`from-primary to-yellow-700`, `text-primaryForeground`). Secondary = dark surface + border, text `text-foreground` (not always gold).
- **Don’t overuse gold in rows:** Reserve gold for section titles and main CTAs (e.g. Equip, points Buy). Row content (costs, Unequip, cash Buy) is usually `text-foreground` or muted.
- **Layout:** Prefer compact spacing where it doesn’t hurt readability. Centred content only where the design explicitly centres (e.g. Profile honours); many lists (e.g. Users Online) are left-aligned.

### Key frontend paths
- **Styles:** `src/styles/noir.module.css` (theme), `src/index.css` (globals, scrollbar).
- **Pages:** `src/pages/` (Dashboard, Profile, Attack, Hitlist, Bank, Store, ArmourWeapons, OrganisedCrime, Inbox, etc.).
- **API:** `src/utils/api.js` (axios base). Auth token in headers.

---

## 2. Tech Stack

- **Backend:** Python, FastAPI, MongoDB. Single app in `backend/server.py` (large file).
- **Frontend:** React, React Router. Tailwind for layout/utilities; theme variables and components use `noir.module.css`.
- **Auth:** JWT. `get_current_user` loads full user from DB (so user doc fields like `hitlist_npc_add_timestamps` are available).

---

## 3. Core Game Mechanics (high level)

### Progression
- **Ranks:** Street Thug → … → Don → Godfather → The Commission (11 ranks). Unlock by **rank points** (and sometimes money). Rank points from crimes, GTA, jail busts, kills, etc.
- **Wealth tier:** Based on cash on hand (Broke → … → Billionaire → Trillionaire). Display only / flavour.
- **Location:** User has `current_state` (e.g. Chicago, New York, Las Vegas, Atlantic City; travel may use different list e.g. Miami, LA). Used for crimes, casinos, travel.

### Combat & attacks
- **Attack flow:** User searches for a target (username) → “attack” record created → user executes attack (uses bullets, weapon). Outcome: kill or miss. Bullets needed depend on target armour and weapon.
- **Weapons:** Bought with cash or points. One equipped; better weapons = fewer witnesses. **Silencer** (store, points): reduces witness statements when you kill.
- **Armour (vest):** 5 levels (Lv.1–5). First 3 cash, top 2 points. Higher armour = more bullets to kill you.
- **Witness statements:** On kill, a number of “witness” notifications are sent to **random** users (not specifically victim or bodyguard owner). Silencer reduces how many go out.
- **Bodyguards:** Up to 4 slots (points). Human or robot. Protect from attacks; can be attacked first (hitlist “bodyguards” target).

### Hitlist
- **User bounties:** Place cash/points bounty on a username. Anyone can attack that target for the reward. List is public (or hidden if option set).
- **Hitlist NPCs:** **Per-user.** User adds random NPC targets (max 3 per 3 hours, **per account**; timers stored on user doc `hitlist_npc_add_timestamps`). Only the placer can attack their own NPCs. NPCs have ranks and rewards (cash, points, booze, bullets, cars, rank points). Admin can reset everyone’s NPC timers via Admin Tools.

### Jail
- Users can be in jail. Other players can “bust out” for reward (set by jailed user). Jailed users appear on Users Online with a “Jailed” badge (small pill, not a big red block).

### Money & economy
- **Cash:** From crimes, attacks, booze run, casinos, transfers, etc.
- **Points:** Premium currency; store, bodyguards, some weapons/armour, OC timer reduction, etc.
- **Bank:** Interest deposits (fixed terms, e.g. 3h–72h; **no early withdrawal** – maturity enforced server-side). Swiss bank (hidden stash, limit). Transfers to other users.
- **Bank interest:** Maturity is per-deposit; claim only when `now >= matures_at`. Overview returns `matured` for UI.

### Crimes & activities
- **Crimes:** Cooldown-based; reward cash/rank points. Types (e.g. minor/major) and event multipliers can affect rewards.
- **GTA:** Grand Theft Auto style jobs; rewards.
- **Booze run:** Prohibition-era runs; 6 booze types, rotation, capacity, sell at locations.
- **Organised Crime (OC):** Team heists. Invites, accept/decline, execute when all accepted. Cooldown (e.g. 6h; store purchase reduces to 4h). OC theme: dark grey like scrollbar, not gold overload; radio buttons grey (`#303030`).

### Casinos
- **Dice:** 2–5000 sides, house edge 5%. Max bet, buyback (points) for owner. Cities: e.g. New York, Chicago (owned per city).
- **Roulette, Blackjack, Horse Racing:** Per-city or global; max bets and rules in `server.py`.
- **Profile “Properties”:** Shows owned casinos (dice cities) with max bet and buyback.

### Families & rackets
- Families (crews) with roles. Rackets; attack other families’ rackets. Family bank (deposit/withdraw).

### Other
- **Travel:** Between states (cost, cooldown or method e.g. car/airport).
- **Store:** Points shop – silencer, OC timer reduction, etc.
- **Inbox:** Notifications. Types: system, attack, rank_up, reward, bodyguard, user_message (direct message with optional GIF URL), OC invite, etc. **Send message:** To username, message (emojis allowed), optional GIF URL; recipients get it in inbox.
- **Profile:** Username, crew, rank, wealth tier, status (Alive/Dead, Online), honours (leaderboard rankings), properties (owned casinos), profile picture (upload), account created. Honours shown as badge-style rows (gold #rank + label); layout centred.
- **Leaderboard:** Rankings (e.g. rank points, kills, crimes, GTAs, jail busts). Profile “Honours” = which leaderboards you’re in and your rank.

### Events
- **Daily events:** Multipliers (e.g. crime pay, armour/weapon cost). Can be toggled by admin; “all events for testing” mode.
- **Sports betting:** Events from external API; place/cancel/settle (admin).

---

## 4. Backend Conventions

- **Admin:** Check `current_user["email"] in ADMIN_EMAILS` for admin-only endpoints. Admin tools in `src/pages/Admin.js`.
- **Notifications:** `send_notification(user_id, title, message, notification_type, **extra)`; `extra` (e.g. `gif_url`, `sender_username`) stored on the notification doc.
- **Hitlist NPC timers:** Per-user; stored on user as `hitlist_npc_add_timestamps`; no global cooldown.
- **Bank interest:** Use `_parse_matures_at()` for maturity; claim only if `now >= mat`. No early withdrawal.
- **Witness statements:** Recipients are **random** users; do not send specifically to victim or bodyguard owner.

---

## 5. Frontend Conventions

- **Forms:** Use `styles.input`, `styles.surface` from `noir.module.css` for consistency.
- **Data loading:** Many pages fetch in `useEffect`, store in `useState`, show loading state then content.
- **Toasts:** `sonner` for success/error (`toast.success`, `toast.error`).
- **Links:** React Router `Link` to internal routes; `to={`/path/${id}`}`.
- **Icons:** Lucide React (e.g. Shield, Sword, DollarSign, Gem, Trophy, User, ChevronRight).

---

## 6. Git & Deploy

- **Branch:** `MAfiaGame2` is the main working branch.
- **Remotes:** `origin` (Mafia-game), `mafia2` (Mafia-Game-2). Push to both when releasing.
- **Deploy:** Scripts `push-live.bat` / `push-live.ps1` can do commit, push, and SSH deploy (build, restart backend, nginx). See `PUSH-LIVE-README.md` if present.

---

## 7. What to Preserve

- **Theme:** Noir palette, gold for emphasis only, dark grey for neutrals, red for danger.
- **No duplicate logic:** Prefer single source of truth (e.g. maturity check in one place, shared `_parse_matures_at`).
- **User-based limits:** Hitlist NPC windows, bank maturity, etc. are per-user unless the design explicitly says “global”.
- **Accessibility:** Keep `data-testid` where used; avoid removing semantic structure when compacting UI.

When in doubt, match existing pages (Profile, Dashboard, ArmourWeapons, Attack, Hitlist) for spacing, button style, and use of gold vs foreground/muted.
