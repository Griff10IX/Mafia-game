"""One-off: write Rainbet-style Chicken Cross sprites into public/images/chicken-cross/."""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "public" / "images" / "chicken-cross"


def save(img: Image.Image, name: str) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / name
    img.save(path, "PNG")
    print("wrote", path.name, img.size)


def make_chicken(pose: str = "idle") -> Image.Image:
    w, h = 128, 128
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    body = (248, 248, 250, 255)
    outline = (40, 44, 52, 255)
    comb = (220, 48, 48, 255)
    beak = (255, 170, 40, 255)
    feet = (255, 150, 40, 255)
    eye = (30, 30, 30, 255)
    if pose == "hit":
        d.ellipse((38, 98, 58, 112), fill=feet, outline=outline)
        d.ellipse((70, 100, 90, 114), fill=feet, outline=outline)
        d.ellipse((28, 42, 100, 100), fill=body, outline=outline, width=2)
        d.ellipse((70, 28, 112, 68), fill=body, outline=outline, width=2)
        d.polygon([(108, 42), (126, 50), (108, 58)], fill=beak, outline=outline)
        d.ellipse((92, 40, 100, 48), fill=eye)
        d.ellipse((82, 18, 100, 36), fill=comb)
        d.ellipse((94, 14, 110, 30), fill=comb)
        d.line((90, 38, 102, 50), fill=(180, 40, 40, 255), width=2)
        d.line((102, 38, 90, 50), fill=(180, 40, 40, 255), width=2)
    elif pose == "hop":
        d.ellipse((48, 92, 68, 104), fill=feet, outline=outline)
        d.ellipse((72, 90, 92, 102), fill=feet, outline=outline)
        d.ellipse((34, 34, 102, 92), fill=body, outline=outline, width=2)
        d.ellipse((78, 18, 116, 54), fill=body, outline=outline, width=2)
        d.polygon([(112, 30), (128, 36), (112, 44)], fill=beak, outline=outline)
        d.ellipse((96, 28, 104, 36), fill=eye)
        d.ellipse((86, 8, 104, 26), fill=comb)
        d.ellipse((98, 4, 114, 20), fill=comb)
        d.ellipse((40, 40, 72, 68), fill=(240, 240, 244, 255), outline=outline, width=2)
    else:
        d.ellipse((44, 100, 64, 114), fill=feet, outline=outline)
        d.ellipse((68, 100, 88, 114), fill=feet, outline=outline)
        d.ellipse((32, 44, 100, 102), fill=body, outline=outline, width=2)
        d.ellipse((76, 26, 114, 62), fill=body, outline=outline, width=2)
        d.polygon([(110, 38), (126, 44), (110, 52)], fill=beak, outline=outline)
        d.ellipse((94, 36, 102, 44), fill=eye)
        d.ellipse((84, 14, 102, 32), fill=comb)
        d.ellipse((96, 10, 112, 26), fill=comb)
        d.ellipse((38, 52, 70, 78), fill=(240, 240, 244, 255), outline=outline, width=2)
    return img


def make_car(kind: str) -> Image.Image:
    w, h = 96, 160
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if kind == "sedan":
        body, cabin = (70, 120, 210, 255), (50, 90, 160, 255)
    elif kind == "taxi":
        body, cabin = (250, 200, 40, 255), (220, 170, 20, 255)
    elif kind == "truck":
        body, cabin = (210, 70, 60, 255), (160, 50, 45, 255)
    else:
        body, cabin = (40, 180, 120, 255), (25, 130, 90, 255)
    outline = (20, 22, 28, 255)
    d.rounded_rectangle((14, 28, 30, 52), radius=4, fill=(30, 30, 34, 255))
    d.rounded_rectangle((66, 28, 82, 52), radius=4, fill=(30, 30, 34, 255))
    d.rounded_rectangle((14, 108, 30, 132), radius=4, fill=(30, 30, 34, 255))
    d.rounded_rectangle((66, 108, 82, 132), radius=4, fill=(30, 30, 34, 255))
    top = 24 if kind != "truck" else 18
    bottom = 140 if kind != "truck" else 148
    d.rounded_rectangle(
        (18, top, 78, bottom),
        radius=18 if kind == "sport" else 12,
        fill=body,
        outline=outline,
        width=2,
    )
    d.rounded_rectangle((28, 48, 68, 78), radius=8, fill=(180, 210, 230, 255), outline=outline, width=1)
    d.rounded_rectangle((28, 88, 68, 112), radius=6, fill=cabin, outline=outline, width=1)
    d.ellipse((26, top + 4, 40, top + 16), fill=(255, 240, 160, 255))
    d.ellipse((56, top + 4, 70, top + 16), fill=(255, 240, 160, 255))
    if kind == "taxi":
        d.rectangle((40, top - 8, 56, top + 2), fill=(40, 40, 40, 255))
    return img


def main() -> None:
    save(make_chicken("idle"), "chicken-idle.png")
    save(make_chicken("hop"), "chicken-hop.png")
    save(make_chicken("hit"), "chicken-hit.png")
    for name in ("sedan", "taxi", "truck", "sport"):
        save(make_car(name), f"car-{name}.png")

    lane = Image.new("RGBA", (96, 160), (0, 0, 0, 0))
    d = ImageDraw.Draw(lane)
    d.rectangle((0, 0, 95, 159), fill=(42, 48, 62, 255))
    for y in range(8, 160, 28):
        d.rectangle((44, y, 52, y + 14), fill=(220, 220, 230, 220))
    d.rectangle((2, 0, 5, 159), fill=(200, 200, 210, 180))
    d.rectangle((90, 0, 93, 159), fill=(200, 200, 210, 180))
    save(lane, "lane.png")

    walk = Image.new("RGBA", (96, 160), (0, 0, 0, 0))
    d = ImageDraw.Draw(walk)
    d.rectangle((0, 0, 95, 159), fill=(88, 92, 104, 255))
    for y in range(0, 160, 40):
        d.line((0, y, 95, y), fill=(70, 74, 86, 255), width=2)
    for x in range(0, 96, 32):
        d.line((x, 0, x, 159), fill=(70, 74, 86, 200), width=1)
    d.rectangle((88, 0, 95, 159), fill=(160, 164, 176, 255))
    save(walk, "sidewalk.png")

    coin = Image.new("RGBA", (96, 96), (0, 0, 0, 0))
    d = ImageDraw.Draw(coin)
    d.ellipse((4, 4, 92, 92), fill=(230, 180, 40, 255), outline=(120, 80, 10, 255), width=3)
    d.ellipse((14, 14, 82, 82), fill=(250, 210, 70, 255), outline=(180, 130, 20, 255), width=2)
    d.ellipse((22, 18, 40, 36), fill=(255, 240, 160, 180))
    save(coin, "coin.png")
    print("done")


if __name__ == "__main__":
    main()
