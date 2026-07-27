# Weed Empire restore point

Created before the Weed Empire expansion (progression, assistants, dealers, raids, heat bust, visuals) on **2026-07-27**.

## Restore

```bash
git checkout pre-weed-empire-expansion-2026-07-27
```

Or use the branch:

```bash
git checkout backup/pre-weed-empire-expansion-2026-07-27
```

Tag / branch point at commit: `ebdc5782c37c8ab43edac036332f1f4c78b4098e`

## Files expected to change in this pass

- `backend/utils/weed_empire_equipment.py`
- `backend/utils/weed_empire_catalog.py`
- `backend/utils/weed_empire_exclusive_strains.py` (only if buffs need alignment)
- `backend/routers/money/weed_empire.py`
- `backend/tests/test_weed_empire_economy.py`
- `src/pages/Money/WeedEmpire.js`
- `src/components/weed/WeedEmpire3D.js`, `weedRoomBuilders.js`, `weedPhenotypes.js`, `WeedShop.js`
- `WEED_EMPIRE_RESTORE.md` (this file)
