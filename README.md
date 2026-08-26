# checkpoint_traffic

Tells you whether to cross into Malaysia via **Woodlands** or **Tuas**, from live
Singapore traffic cameras.

**Live at <https://vcherchu.github.io/checkpoint_traffic/>**

## Starting a session

Analysis only runs while a session is running. A session polls for a fixed
duration and then stops.

```bash
gh workflow run analyse.yml --repo VCHERCHU/checkpoint_traffic \
  -f duration_minutes=120 -f interval_minutes=5
```

Or press **Run workflow** on *Analyse checkpoints* in the Actions tab. Dispatching
a new session cancels any session still running.

Between sessions the page keeps showing the last verdict, labelled with its true
age and a note that nothing is updating.

## How it works

```
DISPATCH
   |
   +-- analyse.yml, one job, loops until the duration elapses
         every 5 min, aligned to the camera publish boundary:
           snapshot.py     fetch the 6 stills, downscale
           claude -p       rate congestion per camera, per direction
           publish.py      aggregate, carry history, write analysis.json
           push_data.sh    force-push a single commit to the `data` branch
         then exits

PHONE -> vcherchu.github.io/checkpoint_traffic/   (static, from site/)
           reads analysis.json + stills from the `data` branch
           geocodes origin/destination via Nominatim
           haversine distances -> verdict
```

There is deliberately **no `schedule:` cron**. GitHub's scheduled workflows are
routinely delayed under load and can be dropped entirely, which would silently
undermine an app whose whole value is freshness. A self-timed loop inside one
dispatched job keeps the interval honest.

The `data` branch is a force-pushed orphan holding a single commit. That keeps ~24
commits per session out of `main`, avoids triggering a Pages rebuild on every
update, and stops the repo growing without bound.

## What it cannot tell you

**A waiting time.** A still photograph shows how heavy a queue looks, not how
fast it is clearing, so there is no honest way to turn it into minutes. The app
reports a relative comparison and a confidence level. Every minute figure in the
UI is estimated *driving* time, never queue time.

Other known limits:

- Driving estimates are straight-line distance at an assumed 60 km/h, not a
  routed journey.
- The fallback pattern table in `site/patterns.js` is hand-written judgement, not
  measurement. **Public holidays are not modelled** and are among the worst times
  to cross — adding a holiday list would be a real improvement.
- Camera roles were verified in daylight only. Night behaviour relies on the
  model reporting low confidence, which then triggers the pattern fallback.

## Things learned the hard way

- The image host (`images.data.gov.sg`) rejects urllib's default User-Agent with
  a **403**. Send an explicit one.
- It also serves stills as `application/octet-stream` with
  `X-Content-Type-Options: nosniff`, so a browser **refuses to render those URLs
  in an `<img>`**. That is why the session republishes its own copies to the
  `data` branch, which serves a correct `image/jpeg`.
- The feed timestamps itself **2-5 minutes ahead of the frames it actually
  serves**. `frame_timestamp` in `analysis.json` is the honest age.
- Camera images refresh on a strict **5-minute cadence**, so polling faster is
  wasted.
- On the crossing-deck cameras the yellow `JOHOR` / `WOODLANDS` labels mark the
  road's orientation, not one carriageway — without a left-hand-drive hint the
  two directions get reported backwards.
- A free-flowing far-approach camera must never be averaged into a checkpoint's
  score. Free flow 2 km back is normal even during gridlock; it only carries
  information when it is *high*.

## Layout

| Path | Role |
| --- | --- |
| `config/cameras.json` | Camera roles, weights, direction hints |
| `prompts/analyse.md` | Vision prompt template |
| `scripts/snapshot.py` | Fetch and downscale the stills |
| `scripts/build_prompt.py` | Render the prompt for the cameras on hand |
| `scripts/publish.py` | Aggregate to `analysis.json` |
| `scripts/push_data.sh` | Publish to the `data` branch |
| `site/` | The page (plain HTML/CSS/JS, no build step) |

## Workflows

| Workflow | Trigger | What it does |
| --- | --- | --- |
| `analyse.yml` | Manual dispatch | Runs an analysis session |
| `deploy-pages.yml` | Push to `main` touching `site/**` | Publishes `site/` to Pages |
| `claude.yml` | `@claude` in an issue, PR comment or review | Runs Claude Code on the request |
| `claude-code-review.yml` | PR opened / updated / reopened | Posts an inline code review |

All three Claude workflows use the repository secret `CLAUDE_CODE_OAUTH_TOKEN`,
created by `/install-github-app`. No Anthropic API key or billing is involved.
