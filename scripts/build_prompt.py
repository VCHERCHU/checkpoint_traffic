#!/usr/bin/env python3
"""Render prompts/analyse.md into a concrete prompt for the cameras on hand."""
import argparse
import json
import os

ap = argparse.ArgumentParser()
ap.add_argument("--config", default="config/cameras.json")
ap.add_argument("--template", default="prompts/analyse.md")
ap.add_argument("--workdir", default="work")
args = ap.parse_args()

cfg = json.load(open(args.config))
meta = json.load(open(os.path.join(args.workdir, "meta.json")))

lines = []
for key, cp in cfg["checkpoints"].items():
    lines.append(f"\n### {cp['name']} ({cp['crossing']})\n")
    for cid in cp["cameras"]:
        if cid not in meta["cameras"]:
            continue
        cam = cfg["cameras"][cid]
        out_l = cam["outbound_label"]
        in_l = cam["inbound_label"]
        labels = f"outbound is labelled `{out_l}`"
        labels += f", inbound is labelled `{in_l}`" if in_l else ", inbound is not separately labelled"
        lines.append(f"- **`{cid}.jpg`** ({cam['role']}) - {cam['shows']} In this frame, {labels}.")

prompt = open(args.template).read().replace("{{CAMERAS}}", "\n".join(lines))
out = os.path.join(args.workdir, "prompt.txt")
with open(out, "w") as f:
    f.write(prompt)
print(f"wrote {out} ({len(prompt)} chars, {len(meta['cameras'])} cameras)")
