"""Generate Betway-style Chicken Cross sprites (transparent PNG)."""
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
    """Top-down / 3/4 facing viewer — big eyes, red comb (Betway vibe)."""
    w, h = 256, 256
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    outline = (28, 24, 22, 255)
    body = (250, 248, 245, 255)
    cream = (255, 236, 210, 255)
    comb = (220, 40, 48, 255)
    beak = (255, 170, 40, 255)
    eye_w = (255, 255, 255, 255)
    pupil = (20, 20, 22, 255)

    if pose == "hit":
        # Flattened chicken
        d.ellipse((40, 110, 216, 170), fill=body, outline=outline, width=4)
        d.ellipse((70, 95, 130, 140), fill=eye_w, outline=outline, width=3)
        d.ellipse((126, 95, 186, 140), fill=eye_w, outline=outline, width=3)
        d.line((88, 110, 112, 128), fill=(180, 40, 40, 255), width=4)
        d.line((112, 110, 88, 128), fill=(180, 40, 40, 255), width=4)
        d.line((144, 110, 168, 128), fill=(180, 40, 40, 255), width=4)
        d.line((168, 110, 144, 128), fill=(180, 40, 40, 255), width=4)
        d.polygon([(186, 120), (230, 128), (186, 142)], fill=beak, outline=outline)
        d.ellipse((100, 78, 150, 108), fill=comb)
        d.ellipse((120, 68, 160, 100), fill=comb)
        return img

    # Body
    d.ellipse((58, 70, 198, 210), fill=body, outline=outline, width=5)
    # Chest fluff
    d.ellipse((88, 120, 168, 190), fill=cream, outline=outline, width=2)
    # Wings
    if pose == "hop":
        d.ellipse((28, 100, 78, 160), fill=body, outline=outline, width=4)
        d.ellipse((178, 100, 228, 160), fill=body, outline=outline, width=4)
        y_shift = -12
    else:
        d.ellipse((36, 120, 82, 175), fill=body, outline=outline, width=4)
        d.ellipse((174, 120, 220, 175), fill=body, outline=outline, width=4)
        y_shift = 0

    # Comb
    d.ellipse((108, 42 + y_shift, 148, 82 + y_shift), fill=comb)
    d.ellipse((128, 34 + y_shift, 168, 74 + y_shift), fill=comb)
    d.ellipse((90, 50 + y_shift, 124, 84 + y_shift), fill=comb)
    # Eyes (big googly)
    d.ellipse((86, 88 + y_shift, 136, 140 + y_shift), fill=eye_w, outline=outline, width=4)
    d.ellipse((128, 88 + y_shift, 178, 140 + y_shift), fill=eye_w, outline=outline, width=4)
    d.ellipse((104, 108 + y_shift, 124, 128 + y_shift), fill=pupil)
    d.ellipse((146, 108 + y_shift, 166, 128 + y_shift), fill=pupil)
    d.ellipse((108, 110 + y_shift, 116, 118 + y_shift), fill=(255, 255, 255, 220))
    d.ellipse((150, 110 + y_shift, 158, 118 + y_shift), fill=(255, 255, 255, 220))
    # Beak
    d.polygon(
        [(118, 138 + y_shift), (138, 158 + y_shift), (158, 138 + y_shift)],
        fill=beak,
        outline=outline,
    )
    # Feet
    feet = (255, 150, 40, 255)
    d.ellipse((90, 198, 120, 220), fill=feet, outline=outline, width=2)
    d.ellipse((136, 198, 166, 220), fill=feet, outline=outline, width=2)
    return img


def make_car(kind: str) -> Image.Image:
    """Top-down car pointing down the lane."""
    w, h = 160, 280
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if kind == "sedan":
        body, accent = (220, 55, 55, 255), (160, 30, 30, 255)
    elif kind == "taxi":
        body, accent = (250, 200, 40, 255), (210, 160, 20, 255)
    elif kind == "truck":
        body, accent = (70, 120, 210, 255), (40, 80, 160, 255)
    else:
        body, accent = (40, 190, 120, 255), (20, 140, 90, 255)
    outline = (18, 18, 22, 255)
    # Wheels
    for xy in ((18, 48, 42, 88), (118, 48, 142, 88), (18, 190, 42, 230), (118, 190, 142, 230)):
        d.rounded_rectangle(xy, radius=6, fill=(30, 30, 34, 255))
    # Body
    d.rounded_rectangle((34, 28, 126, 252), radius=28, fill=body, outline=outline, width=4)
    # Windows
    d.rounded_rectangle((48, 55, 112, 105), radius=10, fill=(180, 210, 230, 255), outline=outline, width=2)
    d.rounded_rectangle((48, 165, 112, 210), radius=10, fill=accent, outline=outline, width=2)
    # Headlights
    d.ellipse((48, 236, 72, 252), fill=(255, 240, 160, 255))
    d.ellipse((88, 236, 112, 252), fill=(255, 240, 160, 255))
    if kind == "taxi":
        d.rectangle((68, 18, 92, 32), fill=(35, 35, 40, 255))
    return img


def make_barrier() -> Image.Image:
    """Yellow jersey barrier / roadblock."""
    w, h = 200, 120
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    yellow = (255, 210, 40, 255)
    dark = (210, 160, 20, 255)
    outline = (40, 30, 10, 255)
    # Main body
    d.polygon(
        [(20, 30), (180, 30), (192, 100), (8, 100)],
        fill=yellow,
        outline=outline,
    )
    d.line([(20, 30), (180, 30)], fill=outline, width=3)
    # Slots / ridges
    for x in (55, 100, 145):
        d.rectangle((x - 8, 42, x + 8, 88), fill=dark, outline=outline, width=2)
    # Top lip
    d.rounded_rectangle((28, 18, 172, 38), radius=6, fill=yellow, outline=outline, width=3)
    return img


def make_coin() -> Image.Image:
    w, h = 160, 160
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse((8, 8, 152, 152), fill=(230, 175, 35, 255), outline=(120, 80, 10, 255), width=6)
    d.ellipse((24, 24, 136, 136), fill=(255, 215, 70, 255), outline=(190, 140, 25, 255), width=4)
    d.ellipse((36, 30, 70, 62), fill=(255, 245, 180, 160))
    # Simple star / chip mark
    d.ellipse((58, 58, 102, 102), outline=(150, 100, 20, 255), width=4)
    return img


def make_bush() -> Image.Image:
    w, h = 140, 120
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    greens = [(46, 140, 70, 255), (56, 165, 82, 255), (38, 120, 60, 255)]
    outline = (20, 60, 30, 255)
    for i, (cx, cy, r) in enumerate(((40, 70, 38), (70, 50, 42), (105, 68, 40), (72, 78, 36))):
        d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=greens[i % 3], outline=outline, width=3)
    return img


def main() -> None:
    save(make_chicken("idle"), "chicken-idle.png")
    save(make_chicken("hop"), "chicken-hop.png")
    save(make_chicken("hit"), "chicken-hit.png")
    for name in ("sedan", "taxi", "truck", "sport"):
        save(make_car(name), f"car-{name}.png")
    save(make_barrier(), "barrier.png")
    save(make_coin(), "coin.png")
    save(make_bush(), "bush.png")
    print("done")


if __name__ == "__main__":
    main()
