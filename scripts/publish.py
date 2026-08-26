#!/usr/bin/env python3
"""Turn the model's per-camera scores into data/analysis.json.

Aggregates cameras up to checkpoint level using the weights in the config,
carries a rolling history for the trend arrow, and degrades to a zero-confidence
record rather than failing when the model output is unusable - a zero-confidence
record is what makes the client fall back to time-of-day patterns.
"""
import argparse
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone

SGT = timezone(timedelta(hours=8))
HISTORY_MAX = 12  # one hour at 5-minute intervals
QUALITY = ("good", "poor", "unusable")


def label_for(score):
    if score is None:
        return "unknown"
    if score < 2:
        return "clear"
    if score < 4:
        return "light"
    if score < 6:
        return "moderate"
    if score < 8:
        return "heavy"
    return "severe"


def extract_json(raw):
    """Pull the model's JSON out of the CLI envelope, tolerating a code fence."""
    text = raw
    try:
        env = json.loads(raw)
        if isinstance(env, dict):
            if "cameras" in env:          # already the payload
                return env
            if "result" in env:           # claude -p --output-format json
                text = env["result"]
    except json.JSONDecodeError:
        pass
    if not isinstance(text, str):
        raise ValueError("no parsable text in model output")
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if fence:
        text = fence.group(1)
    brace = text.find("{")
    if brace == -1:
        raise ValueError("no JSON object in model output")
    return json.loads(text[brace:text.rfind("}") + 1])


def clean_score(v):
    if v is None:
        return None
    try:
        return max(0.0, min(10.0, float(v)))
    except (TypeError, ValueError):
        return None


def validate(payload, wanted):
    """Coerce the model payload into a trusted shape. Never raises on content."""
    cams = payload.get("cameras") or {}
    out = {}
    for cid in wanted:
        e = cams.get(cid) or {}
        q = e.get("image_quality")
        try:
            conf = max(0.0, min(1.0, float(e.get("confidence"))))
        except (TypeError, ValueError):
            conf = 0.0
        out[cid] = {
            "outbound": clean_score(e.get("outbound")),
            "inbound": clean_score(e.get("inbound")),
            "image_quality": q if q in QUALITY else "unusable",
            "confidence": conf,
            "note": str(e.get("note") or "")[:200],
        }
        if out[cid]["image_quality"] == "unusable":
            out[cid]["confidence"] = 0.0
    return out


def aggregate(cfg, cams, cp_key, direction):
    """Weighted mean across a checkpoint's cameras for one direction."""
    num = den = cnum = cden = 0.0
    for cid in cfg["checkpoints"][cp_key]["cameras"]:
        e = cams.get(cid)
        if not e:
            continue
        w = cfg["cameras"][cid]["weight"]
        cnum += w * e["confidence"]
        cden += w
        score = e[direction]
        if score is None or e["image_quality"] == "unusable":
            continue
        ew = w * max(e["confidence"], 0.05)  # keep a sliver of weight for low confidence
        num += ew * score
        den += ew
    score = round(num / den, 1) if den else None
    conf = round(cnum / cden, 2) if cden else 0.0
    return {"congestion": score, "label": label_for(score), "confidence": conf}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="config/cameras.json")
    ap.add_argument("--workdir", default="work")
    ap.add_argument("--out", default="data/analysis.json")
    ap.add_argument("--session-ends", default=None, help="ISO8601 end of this session")
    ap.add_argument("--interval", type=int, default=5)
    args = ap.parse_args()

    cfg = json.load(open(args.config))
    meta = json.load(open(os.path.join(args.workdir, "meta.json")))
    wanted = list(cfg["cameras"])

    raw_path = os.path.join(args.workdir, "claude.json")
    degraded = None
    try:
        cams = validate(extract_json(open(raw_path).read()), wanted)
    except Exception as exc:                     # noqa: BLE001 - any failure degrades
        degraded = f"{type(exc).__name__}: {exc}"
        print(f"  model output unusable ({degraded}) - emitting zero-confidence record",
              file=sys.stderr)
        cams = validate({}, wanted)

    for cid, e in cams.items():
        e["note"] = e["note"] or ""
        m = meta["cameras"].get(cid)
        e["image"] = m["image"] if m else None
        e["timestamp"] = m["timestamp"] if m else None
        e["role"] = cfg["cameras"][cid]["role"]

    now = datetime.now(SGT)
    doc = {
        "generated_at": now.isoformat(timespec="seconds"),
        "source_timestamp": meta["feed_timestamp"],
        "degraded": degraded,
        "session": {"ends_at": args.session_ends, "interval_minutes": args.interval},
        "checkpoints": {},
        "history": [],
    }

    for key, cp in cfg["checkpoints"].items():
        doc["checkpoints"][key] = {
            "name": cp["name"],
            "short": cp["short"],
            "crossing": cp["crossing"],
            "coords": cp["coords"],
            "outbound": aggregate(cfg, cams, key, "outbound"),
            "inbound": aggregate(cfg, cams, key, "inbound"),
            "cameras": [
                dict(cams[cid], id=cid) for cid in cp["cameras"] if cid in cams
            ],
        }

    # Carry history forward for the trend arrow.
    prior = []
    if os.path.exists(args.out):
        try:
            prior = json.load(open(args.out)).get("history", [])
        except (json.JSONDecodeError, OSError):
            prior = []
    entry = {"t": doc["generated_at"]}
    for key in cfg["checkpoints"]:
        for d in ("outbound", "inbound"):
            entry[f"{key}_{d}"] = doc["checkpoints"][key][d]["congestion"]
    doc["history"] = (prior + [entry])[-HISTORY_MAX:]

    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w") as f:
        json.dump(doc, f, indent=2)

    for key, cp in doc["checkpoints"].items():
        o, i = cp["outbound"], cp["inbound"]
        print(f"  {cp['short']:<10} out={o['congestion']} ({o['label']}, conf {o['confidence']})"
              f"  in={i['congestion']} ({i['label']}, conf {i['confidence']})")


if __name__ == "__main__":
    main()
