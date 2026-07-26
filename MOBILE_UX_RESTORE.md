# Mobile UX restore point

Created before the player-facing mobile UX pass (2026-07-26).

## Restore to pre-change UI

```bash
git checkout pre-mobile-ux-2026-07-26
```

Or use the branch:

```bash
git checkout backup/pre-mobile-ux-2026-07-26
```

Tag / branch point at commit: `f9a646a12d02e186fdbbd8e6b7eed1210952ae3f`

## Files changed in this pass

- `src/App.js` — Layout stays mounted via `AuthenticatedShell` + `Outlet`; Suspense around page content only
- `src/components/Layout.js` — bottom-nav tap feedback; snappier page enter (160ms)
- `src/index.css` — tap-highlight reset + `.tap-feedback` / `.tap-target`
- `src/utils/routePreload.js` — `/money/weed-empire`, admin shell preload
- `src/components/ThemedToaster.js` — toast offset above bottom nav on mobile
- `src/utils/toastPageMutes.js` + `backend/routers/game/notifications.py` — loot_box / weed_empire / distillery mutes
- Pages: WeedEmpire, Distillery, Properties, Crimes, GTA, LootBox, Landing, Weapons, HelpDeskHub, EntertainerHub, Dice, Rlt
