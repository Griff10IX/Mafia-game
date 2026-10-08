# Kill bot plan (build later)

Server-side only. Do not install MafiaKillBot on the server. That Windows app stays a local reference for the order of steps.

Testing is closed. An admin can use it, and an admin can grant it to other accounts. Everyone else sees nothing.

Live cities are Chicago, New York, and Las Vegas. Atlantic City is off.

## Access

- New flag on the user: `kill_bot_access`.
- Admins count as granted without the flag.
- Admin tool: type a username, grant or revoke. Revoke stops their bot on the next tick and removes them from any state-beam group.
- Account page and API routes return 404 unless the caller is granted.
- No store purchase, no public menu entry, no forum release in this phase.

## How it runs

One worker, same idea as Auto Rank. It loads granted users who have the bot switched on and calls the existing attack functions in-process. It does not log in, and it does not call the public attack URLs.

A beam is one execute. That call can spend the full bullets needed for the kill. The next beam for that same account starts no earlier than 100ms after the previous one started. If the write takes longer than 100ms, the next beam waits until the write is done. Never faster than 100ms.

Search time, travel time, bullets on hand, and bodyguard rules stay as they are. The 100ms gap is only between shots after the target is already found in your city.

You can only shoot when you are in the target's city (`can_attack` requires `current_state == location_state`). A normal search can find them in another city and then ask you to travel. State beam does not use that travel step.

## Solo kill bot

Settings, only for granted accounts:

- Master on/off.
- Target list (usernames). Skip staff, skip yourself, skip the dead.
- Hitlist NPCs on/off (the server already shoots these for Auto Rank missions; this is the same call, under the kill-bot switch).
- Bullet floor. When bullets are below the number they set, buy a points-store pack (`BULLET_PACKS` in `backend/routers/game/store.py`) until they are back at or above the floor, or points run out. One buy attempt per tick so a dry points balance cannot loop.
- Telegram on/off. Uses the Telegram chat and bot token already saved on the account (same send path as Auto Rank). Messages: shot, kill, bodyguard blocked the shot, bullets bought, bullets buy failed, location track.
- Track location on/off. See below. Default off.

Solo behaviour:

- Start a search if that target has no active row.
- When the find is in another city, travel once, then shoot.
- When a player bodyguard blocks the shot, search that bodyguard and shoot them, then return to the original target.
- 100ms between this account's beams.

## State beam

A group parked on the map so nobody travels to shoot.

- A granted user creates a group and is the head.
- The head invites by username. The invitee must already be granted. They accept or decline. They can leave. The head can kick.
- There is one head. The head can pass the head role to another member.
- The head assigns each member one live city. Empty cities are allowed. Two members may not share a city.
- On assign, or when the head changes someone's city, that member travels once to the assigned city, then stays. The bot does not travel them again unless the head moves them.
- The head sets one target username for the group.
- Track location on/off, set by the head. Default off. See below.

While the group is on:

- Only the member whose city is the target's current city shoots.
- The others sit. They do not travel and they do not shoot.
- If the target moves, the member in the new city takes the next beam. The previous shooter stops.
- That shooter still uses the 100ms floor, their own bullet floor, and their own Telegram switch.
- The worker must give that seated member a found attack in their own city. Do not run a normal search and then travel. Today execute only accepts an attack row owned by the shooter, so this "already here, already found" row is new and only for a granted state-beam member.

Head controls:

- Change a member's city (causes one travel, then they sit).
- Change the target.
- Pause the group without deleting it.

Telegram for the group, to each member who has Telegram on: invited, city assigned, you are the one shooting, location track, kill, out of bullets.

## Track location

Same feature for a solo target list and for a state-beam group. Each one has its own on/off switch. Solo: the account owner. State beam: the head, for the whole group.

While it is on, the worker reads the target's city every 10–30 seconds (a fresh gap in that range each time) and repeats.

- First check reports where they are now: `Username is in > Chicago`.
- If they are mid-travel, report once: `Username travelling to > New York`.
- When their city changes, report once: `Username travelled to > Las Vegas`.
- The same city is not sent again on the next check.

Solo sends that to the owner's kill-bot log, and to Telegram if their Telegram switch is on. State beam sends it to each member's log, and to Telegram for each member whose Telegram switch is on.

Tracking does not move anyone. State beam still only shoots from the city the target is already in. Solo still travels only when a shot needs another city, under the solo rules above.

## Bodyguards (after the kill bot works)

Separate switch on the same page, still granted-only.

- Fill empty robot bodyguard slots with the existing hire call. This spends points, same as hiring on the site.
- Optional: keep a search on bodyguards you already own. That renewal already exists as the paid robot auto-search. For granted testers, the kill-bot switch can call the same renew function without the 10,000 point / 30 day purchase. Do not remove the paid store item for everyone else.

## Build order

1. Grant flag, admin grant/revoke, hidden page.
2. Solo loop: search, travel, shoot, bodyguard in the way, 100ms floor.
3. Bullet floor, Telegram, and track location (solo).
4. State-beam group, invite, head assigns cities, shoot only from the city the target is in, track location for the group.
5. Robot bodyguard hire.

## Out of this plan

- Public free access. That waits until testing is done.
- Running MafiaKillBot.exe on the server.
- Crimes, GTA, booze, and the rest of the desktop app. Auto Rank already does those.
- Shooting faster than 100ms.
- Letting a member shoot from a city they are not standing in.
