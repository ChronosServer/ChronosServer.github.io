#!/usr/bin/env python3
"""Make responsive webp backgrounds.  usage: python3 tools/make-bg.py <image> <name>
Writes assets/bg/<name>-640.webp, -1280.webp, -1920.webp, then add <name> to _data/backgrounds.yml."""
import sys, pathlib
from PIL import Image
src, name = sys.argv[1], sys.argv[2]
out = pathlib.Path(__file__).resolve().parent.parent / "assets" / "bg"
out.mkdir(parents=True, exist_ok=True)
im = Image.open(src).convert("RGB")
for target in (640, 1280, 1920):
    w = min(target, im.width)
    im.resize((w, round(im.height * w / im.width)), Image.LANCZOS).save(out / f"{name}-{target}.webp", quality=80, method=6)
    print("wrote", out / f"{name}-{target}.webp")
