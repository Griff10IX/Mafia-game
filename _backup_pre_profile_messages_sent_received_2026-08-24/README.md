# Profile Messages sent / received — backup (2026-08-24)

Removed from live UI/API because inbox retention/delete-all made the counts show 0/0, and Jake asked to drop the stat entirely.

## Restore

Copy these files back over the live tree, then re-wire if the live files have moved on:

- `backend/utils/profile_dm_counts.py` — lifetime counters
- `backend/tests/test_profile_dm_counts.py`
- `backend/routers/account/profile.py` — hover + full profile `messages_sent` / `messages_received`
- `backend/routers/game/notifications.py` — `$inc` on send
- `src/pages/Account/Profile.js` — dossier Messages row
- `src/components/ProfileHoverPreview.js` — hover `sent / received`
- `src/pages/Social/Inbox.js` — retention copy mentioning lifetime totals
- `docs/FORUM_FAQ.md` — FAQ lines

Inbox Sent folder, Delete All (inbox only), and 5-day prune skipping Sent copies were separate fixes — do not revert those unless you intend to.
