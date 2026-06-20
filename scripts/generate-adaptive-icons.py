"""Generate Android adaptive-icon foregrounds from WalkChamp progress PNGs.

Android masks launcher icons to a squircle. Artwork must sit inside the
center ~66% safe zone or it gets clipped. This script scales each icon to
58% of a 1024x1024 canvas with transparent padding.

Usage (from frontend/):
  python scripts/generate-adaptive-icons.py
"""
from __future__ import annotations

import os
from pathlib import Path

from PIL import Image

ICONS = [
    "WalkChampProgress0",
    "WalkChampProgress25",
    "WalkChampProgress50",
    "WalkChampProgress75",
    "WalkChampProgress100",
]
CANVAS = 1024
SCALE = 0.58
BG = (10, 11, 20, 255)  # #0A0B14


def main() -> None:
    root = Path(__file__).resolve().parents[1] / "assets" / "icons"
    out = root / "adaptive"
    out.mkdir(parents=True, exist_ok=True)
    target = int(CANVAS * SCALE)

    for name in ICONS:
        src = root / f"{name}.png"
        if not src.exists():
            print(f"skip missing {src.name}")
            continue
        img = Image.open(src).convert("RGBA").resize((target, target), Image.LANCZOS)
        fg = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
        offset = (CANVAS - target) // 2
        fg.paste(img, (offset, offset), img)
        fg.save(out / f"{name}.png", optimize=True)

        composite = Image.new("RGBA", (CANVAS, CANVAS), BG)
        composite.paste(fg, (0, 0), fg)
        composite.save(out / f"{name}-launcher.png", optimize=True)
        print(f"wrote {name} ({target}px on {CANVAS})")

    print("done")


if __name__ == "__main__":
    main()
