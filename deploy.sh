#!/bin/bash
# Deploys the Chronos website: pull, build with Jekyll, copy to the web root,
# then rebuild the gallery index and thumbnails.  Run with:  bash deploy.sh
set -eo pipefail
cd "$(dirname "$(readlink -f "$0")")"

WEB=/var/www/html

git pull --ff-only
eval "$(rbenv init -)"
bundle install --quiet
bundle exec jekyll build
cp -r _site/. "$WEB"/

# gallery: index.json (alphabetical image paths) and 400px thumbnails
mkdir -p "$WEB/gallery/thumbs"
python3 - <<'PY'
import glob, json, os
web = "/var/www/html"
exts = ("jpg", "jpeg", "png", "gif", "webp")
files = sorted("/gallery/" + os.path.basename(p) for e in exts for p in glob.glob(f"{web}/gallery/*.{e}"))
with open(f"{web}/gallery/index.json", "w") as f:
    json.dump(files, f)
PY

shopt -s nullglob
for f in "$WEB"/gallery/*.{jpg,jpeg,png,gif,webp}; do
  thumb="$WEB/gallery/thumbs/$(basename "$f")"
  [ -f "$thumb" ] || convert "${f}[0]" -resize 400x -quality 60 "$thumb"
done

echo "Deployed."
