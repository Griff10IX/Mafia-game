"""Encode Season 6 Game Pass theme assets into public/images/profile-themes/."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parent
sys.path.insert(0, str(ROOT))

from utils.game_pass_s6_themes import GP_S6_THEME_META  # noqa: E402
from utils.profile_background_themes import encode_theme_image  # noqa: E402

ASSETS = Path(
    r"C:\Users\jakeg\.cursor\projects\c-Users-jakeg-Desktop-Game-files-mafia\assets"
)
OUT = REPO / "public" / "images" / "profile-themes"

# theme_id -> source filename in assets/
SOURCE_BY_THEME: dict[str, str] = {
    "gp_s6_joker_me": "c__Users_jakeg_AppData_Roaming_Cursor_User_workspaceStorage_62c9c88ab3fb830e797211cf886c9efd_images_the-dark-knight-heath-ledger-57c71c56-863d-4597-95f9-3c18380640fc.gif",
    "gp_s6_quagmire": "c__Users_jakeg_AppData_Roaming_Cursor_User_workspaceStorage_62c9c88ab3fb830e797211cf886c9efd_images_8acd92622a797a2815893020ef85ca83-b8d5f05b-8282-432d-9464-d9cd93219479.gif",
    "gp_s6_patrick_scheme": "c__Users_jakeg_AppData_Roaming_Cursor_User_workspaceStorage_62c9c88ab3fb830e797211cf886c9efd_images_221183-cb1fe50a-c712-4474-8512-b8c7c825d392.gif",
    "gp_s6_patrick_finger": "c__Users_jakeg_AppData_Roaming_Cursor_User_workspaceStorage_62c9c88ab3fb830e797211cf886c9efd_images_14280-514c4a10-b494-411b-9122-8c6d20c0fca3.gif",
    "gp_s6_godfather": "c__Users_jakeg_AppData_Roaming_Cursor_User_workspaceStorage_62c9c88ab3fb830e797211cf886c9efd_images_godfather-b71b7966-046d-400c-9b08-be1808e61e92.webp",
    "gp_s6_hasbulla_stare": "c__Users_jakeg_AppData_Roaming_Cursor_User_workspaceStorage_62c9c88ab3fb830e797211cf886c9efd_images_12e7f9eb95029f6fde0387c4fdf43978-a959c0ca-2dd6-4e4a-8cbf-23d36740181c.jpg",
    "gp_s6_blobby": "c__Users_jakeg_AppData_Roaming_Cursor_User_workspaceStorage_62c9c88ab3fb830e797211cf886c9efd_images_H3n27F-8556a840-b896-46ef-9448-65c31579b950.jpg",
    "gp_s6_peaky": "c__Users_jakeg_AppData_Roaming_Cursor_User_workspaceStorage_62c9c88ab3fb830e797211cf886c9efd_images_960d63fe7f5bba1351add655b3753901-f9bbfeb5-a6d0-4e3f-8d7e-c6cdfbae6c11.jpg",
    "gp_s6_vader_still": "c__Users_jakeg_AppData_Roaming_Cursor_User_workspaceStorage_62c9c88ab3fb830e797211cf886c9efd_images_dv-fd090830-70f5-4116-897d-21f998b7c124.jpg",
    "gp_s6_joker_nurse": "c__Users_jakeg_AppData_Roaming_Cursor_User_workspaceStorage_62c9c88ab3fb830e797211cf886c9efd_images_3450c7f70516b9897a5dfa87c67dc90a-58f905e8-ae3e-4c5d-a196-f71d21376472.jpg",
    "gp_s6_risitas": "c__Users_jakeg_AppData_Roaming_Cursor_User_workspaceStorage_62c9c88ab3fb830e797211cf886c9efd_images_el-risitas-juan-joya-borja-d1a2296d-dad0-4c48-911c-6a3df2182377.jpg",
    "gp_s6_nebula_a": "c__Users_jakeg_AppData_Roaming_Cursor_User_workspaceStorage_62c9c88ab3fb830e797211cf886c9efd_images_gif__2_-a985eabc-9be4-4dd8-a6fe-b163b0b60d17.jpg",
    "gp_s6_nebula_b": "c__Users_jakeg_AppData_Roaming_Cursor_User_workspaceStorage_62c9c88ab3fb830e797211cf886c9efd_images_gif__1_-aeec65d7-49bd-4d02-ad3c-d906d9514988.jpg",
    "gp_s6_nebula_c": "c__Users_jakeg_AppData_Roaming_Cursor_User_workspaceStorage_62c9c88ab3fb830e797211cf886c9efd_images_gif-c4c8a8a8-4198-46c0-afda-015fc9b91e0a.jpg",
    "gp_s6_hasbulla_sideeye": "c__Users_jakeg_AppData_Roaming_Cursor_User_workspaceStorage_62c9c88ab3fb830e797211cf886c9efd_images_hasbulla-gun.gif.1b3b782c77e12481b1100ae1822dac9e-cc3df7cd-384c-4184-b187-c2389fe013dc.jpg",
    "gp_s6_wanderlust": "c__Users_jakeg_AppData_Roaming_Cursor_User_workspaceStorage_62c9c88ab3fb830e797211cf886c9efd_images_image-bf33853c-a21b-4905-93ed-a61b7f262271.jpg",
    "gp_s6_vader_mist": "c__Users_jakeg_AppData_Roaming_Cursor_User_workspaceStorage_62c9c88ab3fb830e797211cf886c9efd_images_29493bee7cc385641e4d01bf7da89353-a1857631-7499-4401-ac58-4f7f7f6ad7d7.jpg",
    "gp_s6_stormtrooper_dance": "c__Users_jakeg_AppData_Roaming_Cursor_User_workspaceStorage_62c9c88ab3fb830e797211cf886c9efd_images_dance-storm-trooper-6418615b-3427-4a2a-9c82-b66928c4c150.gif",
    "gp_s6_dump_01": "c__Users_jakeg_AppData_Roaming_Cursor_User_workspaceStorage_62c9c88ab3fb830e797211cf886c9efd_images_image-f67581ec-5574-44c4-9207-4054235d4e51.jpg",
    "gp_s6_dump_02": "c__Users_jakeg_AppData_Roaming_Cursor_User_workspaceStorage_62c9c88ab3fb830e797211cf886c9efd_images_image-83d0f617-fc84-4a6b-b07d-1ccdc06f28cc.jpg",
    "gp_s6_dump_03": "c__Users_jakeg_AppData_Roaming_Cursor_User_workspaceStorage_62c9c88ab3fb830e797211cf886c9efd_images_image-21674a38-3d8a-4777-a46f-84a180cf8ed6.jpg",
    "gp_s6_dump_04": "c__Users_jakeg_AppData_Roaming_Cursor_User_workspaceStorage_62c9c88ab3fb830e797211cf886c9efd_images_image-05ac0e69-dcf4-42d9-9541-412f1b84fb7e.jpg",
    "gp_s6_dump_05": "c__Users_jakeg_AppData_Roaming_Cursor_User_workspaceStorage_62c9c88ab3fb830e797211cf886c9efd_images_image-44351c11-d620-4f60-885d-e10ad647c75f.jpg",
    "gp_s6_dump_06": "c__Users_jakeg_AppData_Roaming_Cursor_User_workspaceStorage_62c9c88ab3fb830e797211cf886c9efd_images_ytzmo-7da50758-bb2b-446d-9db4-0049e12a030e.gif",
}


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    missing = []
    written = []
    for theme_id, src_name in SOURCE_BY_THEME.items():
        meta = GP_S6_THEME_META.get(theme_id) or {}
        stem = meta.get("file_stem") or theme_id.replace("_", "-")
        src = ASSETS / src_name
        if not src.is_file():
            missing.append(theme_id)
            print(f"MISSING {theme_id} <- {src_name}")
            continue
        raw = src.read_bytes()
        data, mime, ext = encode_theme_image(raw, prefer_gif=True)
        out_path = OUT / f"{stem}.{ext}"
        out_path.write_bytes(data)
        written.append((theme_id, out_path.name, mime, len(data)))
        print(f"OK {theme_id} -> {out_path.name} ({mime}, {len(data)} bytes)")
    print(f"wrote={len(written)} missing={len(missing)}")
    return 1 if missing else 0


if __name__ == "__main__":
    raise SystemExit(main())
