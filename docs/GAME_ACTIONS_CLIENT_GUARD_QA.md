# Game actions client guard — QA before production

Use this checklist when enabling **`game_actions_client_strict`** (`game_settings` main document). Default is off.

## What strict mode does

For `POST` / `PUT` / `PATCH` / `DELETE` on gameplay routes (crimes, GTA, jail, OC, bodyguards, attack, booze-run, etc.), the server requires:

- `Sec-Fetch-Mode`: `cors` or `same-origin`
- `Sec-Fetch-Dest`: `empty`, or omitted only with allowed fallback combinations (see `game_action_strict_headers_blocked` in `backend/utils/login_user_agent.py`)
- `Sec-Fetch-Site`: must not be `cross-site`
- `Accept`: must include `application/json`

Legitimate browser `fetch`/XHR from the same app should satisfy these; naive scripts often do not.

## Devices to test (real hardware)

| Flow | Chrome Android | Safari iOS | Desktop Chrome |
|------|----------------|------------|----------------|
| Commit crime | | | |
| GTA attempt / garage | | | |
| GTA melt / scrap | | | |
| Booze buy / sell | | | |
| Jail bust / OC if used | | | |

Note any `403` with the generic “official game app or browser” message; capture `User-Agent` and whether the request was from the in-game WebView vs external browser if applicable.

## Turnstile on melt / booze sell

**`game_actions_turnstile_enabled`** uses the same public site key and secret as minigames. When on, users complete Turnstile before **GTA melt/scrap** and **booze sell** only (not crime commits). Verify the modal appears once per action and the POST succeeds with a valid token.
