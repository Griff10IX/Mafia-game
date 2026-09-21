"""Recompress oversized gp-s6 theme GIFs for deployable sizes."""
from __future__ import annotations

import io
import sys
from pathlib import Path

from PIL import Image, ImageSequence

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parent
sys.path.insert(0, str(ROOT))

from utils.profile_background_themes import (  # noqa: E402
    THEME_IMAGE_HEIGHT,
    THEME_IMAGE_WIDTH,
    _cover_crop_rgb,
)

OUT = REPO / "public" / "images" / "profile-themes"
MAX_FRAMES = 48
MAX_BYTES = 6_000_000


def recompress(path: Path) -> None:
    raw = path.read_bytes()
    if len(raw) <= MAX_BYTES:
        print(f"SKIP {path.name} ({len(raw)} bytes)")
        return
    im = Image.open(io.BytesIO(raw))
    n = int(getattr(im, "n_frames", 1) or 1)
    step = max(1, (n + MAX_FRAMES - 1) // MAX_FRAMES)
    tw, th = THEME_IMAGE_WIDTH, THEME_IMAGE_HEIGHT
    frames, durations = [], []
    for i, frame in enumerate(ImageSequence.Iterator(im)):
        if i % step != 0:
            continue
        fr = _cover_crop_rgb(frame.copy(), tw, th).convert("RGB")
        frames.append(fr.convert("P", palette=Image.Palette.ADAPTIVE, colors=128))
        durations.append(max(40, int(frame.info.get("duration") or 80) * step))
        if len(frames) >= MAX_FRAMES:
            break
    if not frames:
        print(f"FAIL empty {path.name}")
        return

    def _save(frs, durs):
        buf = io.BytesIO()
        frs[0].save(
            buf,
            format="GIF",
            save_all=True,
            append_images=frs[1:],
            duration=durs,
            loop=0,
            optimize=False,
            disposal=2,
        )
        return buf.getvalue()

    data = _save(frames, durations)
    if len(data) > MAX_BYTES * 1.5 and len(frames) > 24:
        data = _save(frames[::2], [d * 2 for d in durations[::2]])
    path.write_bytes(data)
    print(f"OK {path.name}: {n}f step={step} -> frames {len(raw)} -> {len(data)} bytes")


def main() -> int:
    for p in sorted(OUT.glob("gp-s6-*.gif")):
        recompress(p)
    total = sum(p.stat().st_size for p in OUT.glob("gp-s6-*.gif"))
    print(f"total_mb={total / (1024 * 1024):.1f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
