#!/usr/bin/env python3
"""Fetch the current checkpoint camera stills and downscale them for analysis.

Writes <workdir>/<camera_id>.jpg for each configured camera plus a meta.json
describing the feed. The image host rejects urllib's default User-Agent with a
403, so every request sends an explicit one.
"""
import argparse
import json
import os
import sys
import urllib.request

FEED = "https://api.data.gov.sg/v1/transport/traffic-images"
UA = "checkpoint-traffic/0.1 (+https://github.com/VCHERCHU/checkpoint_traffic)"
MAX_WIDTH = 900  # ~600 vision tokens per image at 16:9


def get(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    return urllib.request.urlopen(req, timeout=timeout)


def downscale(path):
    """Shrink in place. Skips silently if Pillow is unavailable."""
    try:
        from PIL import Image
    except ImportError:
        print("  (Pillow missing - keeping full resolution)", file=sys.stderr)
        return
    with Image.open(path) as im:
        if im.width <= MAX_WIDTH:
            return
        h = round(im.height * MAX_WIDTH / im.width)
        im.resize((MAX_WIDTH, h), Image.LANCZOS).save(path, "JPEG", quality=85)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="config/cameras.json")
    ap.add_argument("--workdir", default="work")
    args = ap.parse_args()

    cfg = json.load(open(args.config))
    wanted = set(cfg["cameras"])
    os.makedirs(args.workdir, exist_ok=True)

    item = json.load(get(FEED))["items"][0]
    meta = {"feed_timestamp": item["timestamp"], "cameras": {}}

    for cam in item["cameras"]:
        cid = cam["camera_id"]
        if cid not in wanted:
            continue
        path = os.path.join(args.workdir, cid + ".jpg")
        with open(path, "wb") as f:
            f.write(get(cam["image"]).read())
        downscale(path)
        meta["cameras"][cid] = {
            "image": cam["image"],
            "timestamp": cam["timestamp"],
            "lat": cam["location"]["latitude"],
            "lon": cam["location"]["longitude"],
            "bytes": os.path.getsize(path),
        }
        print(f"  {cid}  {meta['cameras'][cid]['bytes']:>7} B  {cam['timestamp'][11:19]}")

    missing = wanted - set(meta["cameras"])
    if missing:
        print(f"  WARNING: feed omitted {sorted(missing)}", file=sys.stderr)
    meta["missing"] = sorted(missing)

    with open(os.path.join(args.workdir, "meta.json"), "w") as f:
        json.dump(meta, f, indent=2)

    if not meta["cameras"]:
        sys.exit("no cameras retrieved")


if __name__ == "__main__":
    main()
