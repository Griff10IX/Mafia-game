# Profile dossier theme art

**Required size: 1024 × 931 px (JPEG)**

Aspect ≈ 1.10 (width / height). Same as Orbit Overlook — the size the dossier
banner uses with `background-size: 100% auto` (full width, natural height, panel
colour below).

## Rules

1. Export / crop every new theme to exactly **1024×931**.
2. Put the file in this folder, e.g. `my-theme.jpg`.
3. Register it in `backend/utils/profile_background_themes.py` (bump `_THEME_ASSET_V`).
4. Keep focal subjects in the **upper ~60%** — stats/badges sit over the middle;
   cars/weapons sit on the dark panel below the banner.
5. Do **not** use tall 9:16 portraits or wide 16:9 without cropping to 1024×931
   first — those look wrong next to Orbit.

## Check

From repo root:

```bash
python scripts/check_profile_theme_images.py
```

Fails if any catalog image is not 1024×931.
