#!/usr/bin/env python3
"""Build a single self-contained HTML file for design review.

The published site pulls its data and its camera stills over the network. A
shareable preview cannot, so this inlines both: the current analysis.json and
every still as a data: URI, plus the CSS and JS.

`site/app.js` is embedded byte-for-byte - the preview stubs `fetch` ahead of it
rather than editing it, so what a reviewer clicks through is the real code, not
a mock-up of it.

    python scripts/build_preview.py -o preview.html
"""
import argparse
import base64
import json
import os
import urllib.request

BRANCH = "https://raw.githubusercontent.com/VCHERCHU/checkpoint_traffic/data"
UA = "checkpoint-traffic/0.1 (+https://github.com/VCHERCHU/checkpoint_traffic)"

# Pre-resolved so the preview shows the travel rows; the artifact sandbox
# blocks the geocoder, so a reviewer cannot look these up themselves.
TRIP = {
    "originQ": "Woodlands Drive 50",
    "destQ": "Legoland Malaysia",
    "origin": {"coords": [1.4356464, 103.7910710], "label": "Woodlands Drive 50, Singapore"},
    "dest": {"coords": [1.4277678, 103.6294754], "label": "Legoland Malaysia, Johor"},
}


def get(url):
    return urllib.request.urlopen(
        urllib.request.Request(url, headers={"User-Agent": UA}), timeout=30
    ).read()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("-o", "--out", default="preview.html")
    ap.add_argument("--site", default="site")
    ap.add_argument("--artifact", action="store_true",
                    help="strip the document scaffolding; Artifacts supply their own")
    args = ap.parse_args()

    data = json.loads(get(BRANCH + "/analysis.json"))

    # Swap every still for an inline data: URI.
    inlined = 0
    for cp in data["checkpoints"].values():
        for cam in cp.get("cameras", []):
            if not cam.get("image"):
                continue
            raw = get(cam["image"])
            cam["image"] = "data:image/jpeg;base64," + base64.b64encode(raw).decode()
            inlined += 1

    read = lambda n: open(os.path.join(args.site, n), encoding="utf-8").read()
    html = read("index.html")
    css = read("styles.css")
    patterns = read("patterns.js")
    app = read("app.js")

    shim = (
        "<script>\n"
        "window.__PREVIEW__ = " + json.dumps(data) + ";\n"
        "try { localStorage.setItem('trip', JSON.stringify("
        + json.dumps(TRIP) + ")); } catch (e) {}\n"
        "window.fetch = function (u) {\n"
        "  if (String(u).indexOf('analysis.json') !== -1) {\n"
        "    return Promise.resolve({ ok: true, json: function () {\n"
        "      return Promise.resolve(window.__PREVIEW__); } });\n"
        "  }\n"
        "  return Promise.reject(new Error('lookups are disabled in this preview'));\n"
        "};\n"
        "</script>\n"
    )

    banner = (
        '<p class="preview-note">Design preview &mdash; frozen snapshot from '
        + data["generated_at"][:16].replace("T", " ")
        + " SGT. Place lookups are switched off here; everything else is the real page.</p>\n"
    )

    # Fold the external stylesheet and scripts inline.
    html = html.replace('<link rel="stylesheet" href="styles.css">',
                        "<style>\n" + css + "\n.preview-note {\n"
                        "  margin: 0;\n  padding: 9px 12px;\n"
                        '  font-family: "Martian Mono", ui-monospace, monospace;\n'
                        "  font-size: .6rem;\n  line-height: 1.6;\n"
                        "  letter-spacing: .05em;\n  text-transform: uppercase;\n"
                        "  color: var(--plate-ink);\n  background: var(--plate);\n"
                        "  border: 2px solid var(--plate-edge);\n  border-radius: 4px;\n"
                        "}\n</style>")
    html = html.replace('<script src="patterns.js"></script>',
                        shim + "<script>\n" + patterns + "\n</script>")
    html = html.replace('<script src="app.js"></script>',
                        "<script>\n" + app + "\n</script>")
    html = html.replace('<header class="masthead">', banner + '  <header class="masthead">')

    if args.artifact:
        # Artifacts wrap the file in their own doctype/head/body at publish time.
        for tag in ("<!doctype html>", '<html lang="en">', "<head>", "</head>",
                    "<body>", "</body>", "</html>"):
            html = html.replace(tag, "")
        nl = chr(10)
        html = nl.join(l for l in html.split(nl) if l.strip())

    with open(args.out, "w", encoding="utf-8") as f:
        f.write(html)

    kb = os.path.getsize(args.out) / 1024
    print(f"wrote {args.out}  ({kb:.0f} KB, {inlined} stills inlined)")
    print(f"snapshot: {data['generated_at']}")


if __name__ == "__main__":
    main()
