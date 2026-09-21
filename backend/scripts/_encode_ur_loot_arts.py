"""Encode uploaded theme/card-back arts into public/."""
from __future__ import annotations

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
ASSETS = Path(r"C:\Users\jakeg\.cursor\projects\c-Users-jakeg-Desktop-Game-files-mafia\assets")
ALL = list(ASSETS.glob("c__Users*"))


def find(frag: str) -> Path:
    for f in ALL:
        if frag in f.name:
            return f
    raise FileNotFoundError(frag)


def cover_resize(im: Image.Image, tw: int, th: int) -> Image.Image:
    im = im.convert("RGB")
    sw, sh = im.size
    scale = max(tw / sw, th / sh)
    nw = max(tw, int(round(sw * scale)))
    nh = max(th, int(round(sh * scale)))
    im = im.resize((nw, nh), Image.Resampling.LANCZOS)
    left = max(0, (nw - tw) // 2)
    top = max(0, (nh - th) // 2)
    return im.crop((left, top, left + tw, top + th))


THEMES = {
    "ur-samurai-fuji.jpg": "image-fc212a2c-b39e-43d9-bc44-003104e98ce5",
    "ur-orbit-overlook.jpg": "image-f8380332-d3a9-4cb5-a146-e1787327d338",
    "ur-noir-balcony.jpg": "image-0dab19bb-e490-46da-b4b7-481ec9ade538",
    "ur-jungle-explorer.jpg": "image-655cc065-a964-48b5-9489-3f9dfe71f478",
    "ur-cyber-oni.jpg": "image-a8468eb9-529b-4900-bf2c-544c2bbd16e2",
    "ur-blood-moon.jpg": "image-d188f32c-e126-4629-aebe-b050dbaafd99",
    "ur-space-hangar.jpg": "image-44b3f9e7-c535-4382-aa6a-d248c8b187a1",
    "ur-colony-ring.jpg": "image-57be0c75-a05d-470f-bd39-ba940372e0c0",
    "ur-mob-office-dog.jpg": "image-3220c6e5-2bfc-4909-8fb2-fb6d383d5f87",
    "ur-inner-circle.jpg": "image-30e03c0c-733d-4e4e-b0f5-83510d285ec2",
    "ur-vittoria-club.jpg": "image-7032d22d-0145-42dc-a609-5a233e34ba78",
    "ur-empire-lounge.jpg": "image-5e04b928-3a08-4327-a91d-cbe5a1868dfa",
}
BACKS = {
    "spade-black-gold.jpg": "image-b6fd116b-e17e-4554-9454-8c88390055d1",
    "spade-red-gold.jpg": "image-5835d23c-f629-44a5-9716-990b6de05143",
    "celestial-compass.jpg": "image-2bf2a8ba-3916-41f0-8db6-387725c330c4",
    "galaxy-frame.jpg": "image-a63142fe-baae-4842-b829-e94c04e07ef0",
    "hasbulla-boss.jpg": "image-9ce13cb0-bc68-453c-abe3-d19e903a5ac5",
    "doge-boss.jpg": "image-77375eb3-d923-4a57-8855-990f736fb188",
    "cosmic-portal.jpg": "image-32b7e655-ba37-4fc9-8eec-b8cdb2fc96bc",
    "neon-nebula.jpg": "image-2178d557-39fb-457a-a8cd-996958066d47",
}


def main() -> None:
    theme_dir = ROOT / "public" / "images" / "profile-themes"
    back_dir = ROOT / "public" / "images" / "blackjack" / "card-backs"
    theme_dir.mkdir(parents=True, exist_ok=True)
    back_dir.mkdir(parents=True, exist_ok=True)
    for out_name, frag in THEMES.items():
        src = find(frag)
        im = cover_resize(Image.open(src), 1024, 931)
        im.save(theme_dir / out_name, format="JPEG", quality=92, optimize=True)
        print("theme", out_name, im.size)
    for out_name, frag in BACKS.items():
        src = find(frag)
        im = cover_resize(Image.open(src), 256, 366)
        im.save(back_dir / out_name, format="JPEG", quality=92, optimize=True)
        print("back", out_name, im.size)
    print("done")


if __name__ == "__main__":
    main()
