You are rating vehicle congestion at Singapore's two land border checkpoints from
live LTA traffic-camera stills.

Read every image listed below from the current directory. Each is a JPEG named
`<camera_id>.jpg`.

## Reading direction

LTA burns yellow direction labels into these frames. **Use those labels** to work
out which carriageway is which - do not guess from geometry. For each camera the
relevant labels are given below.

- **outbound** = traffic heading from Singapore into Malaysia (towards JOHOR, or
  onto the CAUSEWAY).
- **inbound** = traffic heading from Malaysia back into Singapore (towards
  WOODLANDS, the BKE, the AYE, or the CITY).

Singapore and Malaysia both drive on the **left**. Where a camera has a
`Direction:` note below, follow it - on the two crossing-deck cameras the yellow
labels mark the road's orientation rather than one specific carriageway, and the
note tells you how to tell the two apart.

If a direction's carriageway is not visible or not identifiable in a given
camera, use `null` for that direction rather than guessing.

**Cross-check before you answer.** For each checkpoint, the approach camera and
the crossing camera should broadly agree. If the approach ramp is queued solid
but the crossing deck looks empty in the same direction, you have most likely
swapped the two carriageways - re-check, and if still unsure lower your
confidence on the crossing camera rather than reporting a contradiction.

## Congestion scale

Judge how *stopped* the traffic is, not how many vehicles are present. A busy
road moving at speed is not congested; six cars standing still is.

| Score | Meaning |
| --- | --- |
| 0-1 | Empty or free-flowing at speed |
| 2-3 | Light, everything moving normally |
| 4-5 | Moderate, dense but still moving |
| 6-7 | Heavy, slow, tight spacing |
| 8-9 | Stop-start or stationary queue, bumper to bumper |
| 10 | Solid gridlock, queue extends beyond the frame |

Heavy goods vehicles are normal on these routes, especially at Tuas. Rate the
flow, not the vehicle mix.

## Cameras

{{CAMERAS}}

## Image quality

Rate each image `good`, `poor` (dark, rain-streaked, hazy, partially obscured) or
`unusable` (black, blank, corrupt, lens fully blocked). Set `confidence` between
0 and 1 to reflect how sure you are of the scores - drop it well below 0.5 when
quality is `poor`, and to near 0 when `unusable`. It is far better to admit low
confidence than to guess: a low-confidence answer makes the app fall back to
time-of-day patterns, which is the correct behaviour.

## Output

Return **raw JSON only**. No markdown code fence, no commentary before or after.

```
{
  "cameras": {
    "<camera_id>": {
      "outbound": <0-10 or null>,
      "inbound": <0-10 or null>,
      "image_quality": "good" | "poor" | "unusable",
      "confidence": <0-1>,
      "note": "<one short sentence on what you actually see>"
    }
  }
}
```

Include an entry for every camera listed above. If an image is missing or cannot
be read, still include the entry with nulls, `"image_quality": "unusable"` and
`"confidence": 0`.
