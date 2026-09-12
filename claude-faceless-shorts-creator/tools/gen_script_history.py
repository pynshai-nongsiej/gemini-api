#!/usr/bin/env python3
"""
gen_script_history.py — script+beats for the NARRATIVE HISTORY pipeline.

Same beats.json contract as the space pipeline (six-beat grammar, vo[] with
timings produced by gen_script.normalize), but the retention grammar is
"EVIDENCE FIRST, CONTEXT SECOND" and every beat carries an archival payload:

  hook    — the startling artifact/anomaly itself: a declassified fact, a
            2mm design change, a sovereign pocket of land. NO background.
  setup   — minimum context to understand the evidence.
  quiz    — the "what actually caused this?" challenge.
  reveal  — the mechanism, forensic or documentary, that explains the anomaly.
  twist   — the consequence / sealed finding / modern echo.
  loop    — mirrors the hook artifact. No CTA.

Extra per-vo fields consumed by the history edit format (remotion/lib/archival.tsx
+ tools/archive_media.py):
  archiveQuery  3-6 words naming the REAL archival subject for the archive
                search, including the decisive year if known
                ("hyatt regency skywalk 1981", "baarle-hertog border map",
                "gold telephone declassified document 1961")
  onScreen      the date/place stamp burned over the frame ("JULY 17, 1981",
                "BAARLE-NASSAU, NL BORDER")
  sourceHint    optional: 'document' | 'photo' | 'map' | 'newsreel' — biases
                the archive search strategy

Usage:
  python tools/gen_script_history.py --topic "the skywalk collapse" --out shorts/hist-1
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gen_script import call_local_ai, extract_json, normalize, write_script_md  # noqa: E402

SOURCE_HINTS = ["", "document", "photo", "map", "newsreel"]

SYSTEM_PROMPT = """You are a viral short-form scriptwriter for a faceless HISTORICAL
INVESTIGATION channel (vertical 9:16, ~35-45s). You follow the strict six-beat
"EVIDENCE FIRST, CONTEXT SECOND" grammar AND the winning formula: STRONG
BUILD-UP -> POWERFUL PAYOFF -> NEVER REVEAL EARLY -> ENGAGEMENT TRICKS.

THE FORMULA (non-negotiable):
- NEVER REVEAL EARLY: the hook shows the startling EVIDENCE (the collapse, the
  sealed report, the anomaly) but must NOT name the CAUSE, the culprit, or the
  mechanism — the failed switch, the 2mm change, the treaty clause stay hidden
  until the reveal beat. Setup deepens the mystery instead of solving it. A
  quiz that hints at the answer is a broken video.
- STRONG BUILD-UP: every pre-reveal line ESCALATES — a worse detail, a higher
  body count, a more impossible constraint, the clock ticking. Each line makes
  the mystery sharper and the stakes higher. No background filler.
- POWERFUL PAYOFF: the reveal is ONE devastating line that names the mechanism
  or culprit plainly ("a 2-millimeter change doubled the load") — the biggest
  moment of the video — and the twist makes it worse (sealed for 50 years, the
  engineer never recalculated, the loophole still works).
- ENGAGEMENT TRICKS: the quiz pauses the viewer and demands their guess in the
  comments ("wrong guesses only"); the twist opens an unresolved loop; the
  final line loops seamlessly back into the hook evidence.

The six beats:
- hook    (0-3s): lead with the startling PHYSICAL evidence — the declassified
          fact, the collapsed structure, the anomalous border, the sealed
          report. State it as fact with the year. NO greetings, NO questions,
          NO background before the evidence. Do NOT reveal the cause here.
- setup   (3-10s): BUILD-UP — the minimum context that makes the evidence more
          disturbing, not less. Tight — and each line escalates.
- quiz    (10-15s): challenge the viewer to name the cause ("pause — what do
          you think broke first?") and demand their guess in the comments
          ("wrong guesses only"). The answer stays hidden.
- reveal  (15-25s): THE PAYOFF — the forensic or documentary mechanism — the
          load path, the treaty clause, the failed switch — delivered as ONE
          heavy line. This is the share moment.
- twist   (25-35s): the consequence nobody expects (sealed for 50 years, the
          loophole that still works, the engineer who never recalculated).
- loop    (last 2-3s): a line flowing back into the hook evidence. NEVER a CTA.

Voice lines: 5-14 words, concrete, dated, named. Total budget: {word_budget}
words for ~{duration}s.

For every voice line also give:
- archiveQuery: 3-6 words naming the REAL archival artifact to search public
  archives for — subject + place + year ("hyatt regency skywalk 1981",
  "baarle hertog border map", "greenbrier bunker 1962"). Use the most specific
  real artifact/place/event name; the pipeline searches Wikimedia, Library of
  Congress, Openverse and the Met FIRST — AI images are only a fallback.
- onScreen: the date/place stamp burned over the frame, e.g. "JULY 17, 1981",
  "BAARLE-NASSAU, 1195 TREATY". ALL CAPS, short.
- sourceHint: "" (any), or "document" | "photo" | "map" | "newsreel" to bias
  the archive search toward that artifact type.
- imagePrompt: fallback AI visual (period-accurate scene, 15-25 words, camera
  treatment, no text-in-image) used only when every archive misses.
- camera: ONE of "push-in", "pull-back", "orbit-left", "orbit-right", "drift-up",
  "drift-down", "pan-left", "pan-right", "crash-zoom", "settle". Evidence gets
  slow deliberate moves; the reveal earns "crash-zoom" or a fast push-in.
- motion: true for AT MOST 1-2 lines (ideally reveal/twist) where archival
  NEWSREEL footage or a real AI video clip would be dramatically better.
- sfxHint: one sound cue ("typewriter", "archive reel", "impact", "riser").

Also give "hookCard": 3-7 word ALL-CAPS banner over frame 0 with 1-2 words in
_underscores_ (e.g. "ONE _SWITCH_ FROM DOOM").

Return ONLY valid JSON, exactly:
{{
  "title": "punchy title under 60 chars",
  "hookCard": "ONE _SWITCH_ FROM DOOM",
  "vo": [
    {{"beat": "hook", "text": "...", "archiveQuery": "b-52 goldsboro 1961",
      "onScreen": "JANUARY 24, 1961", "sourceHint": "photo",
      "imagePrompt": "...", "camera": "push-in", "motion": false, "sfxHint": "archive reel"}}
  ],
  "beats": [
    {{"id": "hook", "visual": "one line describing the on-screen composition"}}
  ]
}}
Rules: 8-12 vo lines. beats covers hook/setup/quiz/reveal/twist/loop in order.
The loop's visual must mirror the hook's."""


def generate_script(topic, style, duration, word_budget):
    prompt = f"TOPIC: {topic}\n"
    if style:
        prompt += f"STYLE / NICHE: {style}\n"
    prompt += SYSTEM_PROMPT.format(word_budget=word_budget, duration=duration)
    prompt += "\nReturn ONLY the JSON."

    for attempt in range(1, 4):
        try:
            raw = call_local_ai(prompt, temperature=0.75 + 0.1 * attempt)
            data = extract_json(raw)
            vo = data.get("vo")
            if (isinstance(vo, list) and len(vo) >= 6 and vo[0].get("text")
                    and all(v.get("text") for v in vo)
                    and all(v.get("archiveQuery") for v in vo)):
                return data
            print(f"  attempt {attempt}: invalid structure, retrying…", file=sys.stderr)
        except (ValueError, RuntimeError, KeyError) as e:
            print(f"  attempt {attempt} failed: {e}", file=sys.stderr)
    sys.exit("local AI did not return a valid history script after 3 attempts")


def normalize_history(data, out_dir, duration, fps=30):
    """Shared timing normalizer + history payload enforcement."""
    beats = normalize(data, out_dir, duration, fps)
    for v in beats["vo"]:
        q = str(v.get("archiveQuery") or "").strip()
        if not q:
            q = " ".join(str(v.get("text", "")).split()[:4]) or beats["title"]
        v["archiveQuery"] = q
        v["onScreen"] = str(v.get("onScreen") or "").strip().upper()
        hint = str(v.get("sourceHint") or "").strip().lower()
        v["sourceHint"] = hint if hint in SOURCE_HINTS else ""
        v.setdefault("imagePrompt", "")
    beats["pipeline"] = "history"
    return beats


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--topic", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--style", default=None)
    ap.add_argument("--duration", type=float, default=40.0)
    ap.add_argument("--word-budget", type=int, default=105)
    args = ap.parse_args()

    out_dir = os.path.abspath(args.out)
    os.makedirs(out_dir, exist_ok=True)
    print(f"generating HISTORY script for: {args.topic!r}")
    data = generate_script(args.topic, args.style, args.duration, args.word_budget)
    beats = normalize_history(data, out_dir, args.duration)

    beats_path = os.path.join(out_dir, "beats.json")
    with open(beats_path, "w", encoding="utf-8") as f:
        json.dump(beats, f, indent=2, ensure_ascii=False)
        f.write("\n")
    write_script_md(beats, args.topic, args.style, os.path.join(out_dir, "script.md"))
    print(f"title: {beats['title']}  ({len(beats['vo'])} lines, {beats['format']['durationSec']}s)")
    print(f"  beats.json -> {os.path.relpath(beats_path, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))}")


if __name__ == "__main__":
    main()
