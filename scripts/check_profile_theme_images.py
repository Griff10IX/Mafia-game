#!/usr/bin/env python3
"""Fail if any catalog profile-theme JPEG is not THEME_IMAGE_WIDTH x THEME_IMAGE_HEIGHT."""
from __future__ import annotations

import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from utils.profile_background_themes import (  # noqa: E402
    PROFILE_BACKGROUND_THEMES,
    THEME_IMAGE_HEIGHT,
    THEME_IMAGE_WIDTH,
)


def jpeg_size(path: Path) -> tuple[int, int]:
    data = path.read_bytes()
    i = 2
    while i < len(data) - 9:
        if data[i] != 0xFF:
            i += 1
            continue
        marker = data[i + 1]
        if marker in (0xC0, 0xC1, 0xC2):
            h = struct.unpack(">H", data[i + 5 : i + 7])[0]
            w = struct.unpack(">H", data[i + 7 : i + 9])[0]
            return w, h
        if marker == 0xD8 or marker == 0x01 or 0xD0 <= marker <= 0xD9:
            i += 2
            continue
        length = struct.unpack(">H", data[i + 2 : i + 4])[0]
        i += 2 + length
    raise ValueError(f"no SOF in {path}")


def main() -> int:
    public = ROOT / "public"
    errors: list[str] = []
    for tid, meta in PROFILE_BACKGROUND_THEMES.items():
        rel = (meta.get("image") or "").split("?", 1)[0].lstrip("/")
        path = public / rel
        if not path.is_file():
            errors.append(f"{tid}: missing {path}")
            continue
        try:
            w, h = jpeg_size(path)
        except Exception as exc:
            errors.append(f"{tid}: {exc}")
            continue
        if (w, h) != (THEME_IMAGE_WIDTH, THEME_IMAGE_HEIGHT):
            errors.append(
                f"{tid}: {path.name} is {w}x{h}, need {THEME_IMAGE_WIDTH}x{THEME_IMAGE_HEIGHT}"
            )
    if errors:
        print("Profile theme image size check FAILED:")
        for line in errors:
            print(f"  - {line}")
        return 1
    print(
        f"OK: {len(PROFILE_BACKGROUND_THEMES)} themes at "
        f"{THEME_IMAGE_WIDTH}x{THEME_IMAGE_HEIGHT}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
