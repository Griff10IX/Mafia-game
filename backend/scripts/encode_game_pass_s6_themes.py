"""Encode Season 6 Game Pass theme assets into public/images/profile-themes/.

Prefer real Desktop GIF/WebP sources (Cursor chat assets often freeze GIFs to JPG).
"""
from __future__ import annotations

import io
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parent
sys.path.insert(0, str(ROOT))

from utils.game_pass_s6_themes import GP_S6_THEME_META  # noqa: E402
from utils.profile_background_themes import encode_theme_image  # noqa: E402

DESKTOP = Path(r"C:\Users\jakeg\Desktop")
ASSETS = Path(
    r"C:\Users\jakeg\.cursor\projects\c-Users-jakeg-Desktop-Game-files-mafia\assets"
)
OUT = REPO / "public" / "images" / "profile-themes"

# theme_id -> absolute source path (Desktop GIFs first)
SOURCE_BY_THEME: dict[str, Path] = {
    "gp_s6_joker_me": DESKTOP / "the-dark-knight-heath-ledger.gif",
    "gp_s6_quagmire": DESKTOP / "8acd92622a797a2815893020ef85ca83.gif",
    "gp_s6_patrick_scheme": DESKTOP / "221183.gif",
    "gp_s6_patrick_finger": DESKTOP / "14280.gif",
    "gp_s6_godfather": DESKTOP / "godfather.webp",
    "gp_s6_hasbulla_stare": DESKTOP / "12e7f9eb95029f6fde0387c4fdf43978.gif",
    "gp_s6_blobby": DESKTOP / "H3n27F.gif",
    "gp_s6_peaky": DESKTOP / "960d63fe7f5bba1351add655b3753901.gif",
    "gp_s6_vader_still": DESKTOP / "dv.gif",
    "gp_s6_joker_nurse": DESKTOP / "3450c7f70516b9897a5dfa87c67dc90a.gif",
    "gp_s6_risitas": DESKTOP / "el-risitas-juan-joya-borja.gif",
    "gp_s6_nebula_a": DESKTOP / "gif (2).gif",
    "gp_s6_nebula_b": DESKTOP / "gif (1).gif",
    "gp_s6_nebula_c": DESKTOP / "gif.gif",
    "gp_s6_hasbulla_sideeye": DESKTOP / "hasbulla-gun.gif.1b3b782c77e12481b1100ae1822dac9e.gif",
    "gp_s6_stormtrooper_dance": DESKTOP / "dance-storm-trooper.gif",
    "gp_s6_dump_06": DESKTOP / "ytzmo.gif",
    # Still / dump sources only present as Cursor assets (keep encoding those)
    "gp_s6_wanderlust": ASSETS
    / "c__Users_jakeg_AppData_Roaming_Cursor_User_workspaceStorage_62c9c88ab3fb830e797211cf886c9efd_images_image-bf33853c-a21b-4905-93ed-a61b7f262271.jpg",
    "gp_s6_vader_mist": ASSETS
    / "c__Users_jakeg_AppData_Roaming_Cursor_User_workspaceStorage_62c9c88ab3fb830e797211cf886c9efd_images_29493bee7cc385641e4d01bf7da89353-a1857631-7499-4401-ac58-4f7f7f6ad7d7.jpg",
    "gp_s6_dump_01": ASSETS
    / "c__Users_jakeg_AppData_Roaming_Cursor_User_workspaceStorage_62c9c88ab3fb830e797211cf886c9efd_images_image-f67581ec-5574-44c4-9207-4054235d4e51.jpg",
    "gp_s6_dump_02": ASSETS
    / "c__Users_jakeg_AppData_Roaming_Cursor_User_workspaceStorage_62c9c88ab3fb830e797211cf886c9efd_images_image-83d0f617-fc84-4a6b-b07d-1ccdc06f28cc.jpg",
    "gp_s6_dump_03": ASSETS
    / "c__Users_jakeg_AppData_Roaming_Cursor_User_workspaceStorage_62c9c88ab3fb830e797211cf886c9efd_images_image-21674a38-3d8a-4777-a46f-84a180cf8ed6.jpg",
    "gp_s6_dump_04": ASSETS
    / "c__Users_jakeg_AppData_Roaming_Cursor_User_workspaceStorage_62c9c88ab3fb830e797211cf886c9efd_images_image-05ac0e69-dcf4-42d9-9541-412f1b84fb7e.jpg",
    "gp_s6_dump_05": ASSETS
    / "c__Users_jakeg_AppData_Roaming_Cursor_User_workspaceStorage_62c9c88ab3fb830e797211cf886c9efd_images_image-44351c11-d620-4f60-885d-e10ad647c75f.jpg",
}


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    missing = []
    written = []
    for theme_id, src in SOURCE_BY_THEME.items():
        meta = GP_S6_THEME_META.get(theme_id) or {}
        stem = meta.get("file_stem") or theme_id.replace("_", "-")
        if not src.is_file():
            missing.append(theme_id)
            print(f"MISSING {theme_id} <- {src}")
            continue
        raw = src.read_bytes()
        # Animated WebP (godfather): temporarily save as GIF if multi-frame
        data, mime, ext = encode_theme_image(raw, prefer_gif=True)
        # Remove stale alternate extension so catalog can't point at an old JPG
        for stale in ("jpg", "jpeg", "gif", "webp", "png"):
            if stale == ext:
                continue
            old = OUT / f"{stem}.{stale}"
            if old.is_file():
                old.unlink()
                print(f"  removed stale {old.name}")
        out_path = OUT / f"{stem}.{ext}"
        out_path.write_bytes(data)
        written.append((theme_id, out_path.name, mime, len(data)))
        print(f"OK {theme_id} -> {out_path.name} ({mime}, {len(data)} bytes)")
        # Static thumb for Profile theme picker (avoids decoding 20+ full GIFs at once)
        if ext == "gif":
            try:
                from PIL import Image

                im = Image.open(io.BytesIO(data))
                im.seek(0)
                thumb = im.convert("RGB")
                # Small picker preview (~128×116)
                thumb.thumbnail((160, 146))
                thumb_path = OUT / f"{stem}-thumb.jpg"
                thumb.save(thumb_path, format="JPEG", quality=82, optimize=True)
                print(f"  thumb {thumb_path.name} ({thumb_path.stat().st_size} bytes)")
            except Exception as e:
                print(f"  thumb FAIL {theme_id}: {e}")
    print(f"wrote={len(written)} missing={len(missing)}")
    # Print catalog extension map for profile_background_themes sync
    print("--- catalog extensions ---")
    for theme_id, _src in SOURCE_BY_THEME.items():
        meta = GP_S6_THEME_META.get(theme_id) or {}
        stem = meta.get("file_stem") or theme_id.replace("_", "-")
        matches = list(OUT.glob(f"{stem}.*"))
        for m in matches:
            if m.suffix.lower() in {".jpg", ".jpeg", ".gif", ".webp", ".png"}:
                print(f"{theme_id}\t{m.name}")
    return 1 if missing else 0


if __name__ == "__main__":
    raise SystemExit(main())
