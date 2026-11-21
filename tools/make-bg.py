#!/usr/bin/env python3
"""Make responsive webp backgrounds.   usage: python3 tools/make-bg.py <image> <name>
Writes assets/bg/<name>-<width>.webp for 640/1280/1920/2560/3840 (never larger than the source),
then prints the line to add to _data/backgrounds.yml if you use more than the default widths.
For a sharp background, give it the biggest screenshot you can (2560x1440 or 3840x2160)."""
import sys, pathlib
from PIL import Image
src, name = sys.argv[1], sys.argv[2]
out = pathlib.Path(__file__).resolve().parent.parent / "assets" / "bg"
out.mkdir(parents=True, exist_ok=True)
im = Image.open(src).convert("RGB")
made = []
for target in (640, 1280, 1920, 2560, 3840):
    if target > im.width and made:
        break
    w = min(target, im.width)
    im.resize((w, round(im.height * w / im.width)), Image.LANCZOS).save(out / f"{name}-{target}.webp", quality=92, method=6)
    made.append(target)
    print("wrote", f"{name}-{target}.webp")
print('add to _data/backgrounds.yml under', name + ':   widths: "' + ",".join(map(str, made)) + '"')
