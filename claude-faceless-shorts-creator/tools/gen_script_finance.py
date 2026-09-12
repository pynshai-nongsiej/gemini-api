#!/usr/bin/env python3
"""
gen_script_finance.py — script+beats for the PERSONAL FINANCE pipeline.

Same beats.json contract as the space pipeline (six-beat grammar, vo[] with
timings produced by gen_script.normalize), but the retention grammar and the
per-beat payload are finance-specific:

  hook    — a DIAGNOSTIC claim about the viewer's own numbers ("your car
            payment is above X% of your paycheck…"). Frame 0 = a huge kinetic
            number that confronts the viewer.
  setup   — the mechanism behind the number (amortization math, sweep rates,
            cohort medians).
  quiz    — "pause: do you know your number?" self-audit challenge.
  reveal  — the threshold/framework (20/4/10, 25x, HYSA spread) with a data
            graphic (counter / comparison bars / percent dial).
  twist   — the hidden cost or systemic reason it stays hidden.
  loop    — mirrors the hook number so the video loops. No CTA.

Extra per-vo fields consumed by the finance edit format (remotion/lib/finance.tsx):
  graphic   counter | bars | percent | rule | null   — the data-graphic layer
  statValue number-ish string shown huge ("$612", "0.01%", "84 mo")
  statLabel caption under the number ("monthly payment", "your bank's rate")
  statBars  optional JSON string '["label=value", ...]' for comparison bars
  onScreen  3-6 word ALL-CAPS kinetic text (key words in _underscores_)
  bgPrompt  imagePrompt for the AI background plate (no text in image)

Usage:
  python tools/gen_script_finance.py --topic "the 20/4/10 car rule" --out shorts/fin-1
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gen_script import call_local_ai, extract_json, normalize, write_script_md  # noqa: E402

GRAPHICS = ["counter", "bars", "percent", "rule"]

SYSTEM_PROMPT = """You are a viral short-form scriptwriter for a faceless PERSONAL
FINANCE channel (vertical 9:16, ~35-45s). You follow a strict six-beat DIAGNOSTIC
grammar AND the winning formula: STRONG BUILD-UP -> POWERFUL PAYOFF -> NEVER
REVEAL EARLY -> ENGAGEMENT TRICKS.

THE FORMULA (non-negotiable):
- NEVER REVEAL EARLY: the hook confronts the viewer with a SYMPTOM number, but
  the threshold/framework/fix (the 20/4/10, the safe %, the exact switch) may
  NOT appear in the hook, setup, or quiz. The viewer must feel the problem
  without being told the cure until the reveal beat. A quiz that accidentally
  states the safe number is a broken video.
- STRONG BUILD-UP: every pre-reveal line ESCALATES the damage — a worse number,
  a longer timeline, a bigger quiet loss. The viewer should feel their net worth
  draining with each line. No flat exposition.
- POWERFUL PAYOFF: the reveal is ONE devastating line that names the threshold
  or fix plainly (this is the biggest moment of the video), and the twist makes
  it worse (why the industry hides it).
- ENGAGEMENT TRICKS: the quiz pauses the viewer and demands their number in the
  comments ("comment your % if you dare"); the twist opens an unresolved loop;
  the final line loops back into the hook number so the rewatch is invisible.

The six beats:
- hook    (0-3s): confront the viewer with ONE specific number that indicts them
          ("your car payment eats 19% of your paycheck"). NO greetings, NO
          questions, NO "in this video". The hook graphic is a huge kinetic
          number or comparison bar. Do NOT reveal the safe threshold here.
- setup   (3-10s): BUILD-UP — the mechanism behind that number in plain
          arithmetic (amortization, percent-of-income, yield spread), each line
          making the damage worse. The fix stays hidden.
- quiz    (10-15s): pause the viewer: "divide your payment by your paycheck —
          pause and comment your % if you dare." The answer stays hidden.
- reveal  (15-25s): THE PAYOFF — the threshold or framework that fixes it
          (20/4/10, 25x rule, HYSA vs checking spread), shown as a data graphic:
          counter, bars, percent dial, or rule card. One clean, heavy line.
- twist   (25-35s): the hidden cost or the reason the industry buries it
          (dealer fee structuring, 0.01% sweep rates, tax reporting traps).
- loop    (last 2-3s): one line that flows back into the hook number. NEVER a
          CTA, never "like and subscribe".

Voice lines: 5-14 words, concrete, numeric. Specifics beat adjectives. Total
budget: {word_budget} words for ~{duration}s.

For every voice line also give:
- graphic: "counter" | "bars" | "percent" | "rule" — the data-graphic layer.
  Use "counter" for hook/setup, "bars" or "percent" for reveal, "rule" for the
  framework, "counter" again on the loop. Every line MUST have one.
- statValue: the number the graphic displays, as text ("$612", "0.01%", "84 mo").
- statLabel: 2-5 word caption under the number ("of your paycheck", "bank sweep rate").
- statBars: ONLY when graphic is "bars" — 2-4 comparisons as "Label=Value"
  strings, e.g. ["High-yield account=4.4", "Checking=0.01"].
- onScreen: 3-6 word ALL-CAPS kinetic text punching the line. Wrap the 1-2 key
  words in _underscores_ (they render in the accent color).
- bgPrompt: visual for the AI background plate behind the graphics (dark
  atmospheric money/office/city imagery, one subject, 15-25 words, no
  text-in-image). Camera treatment included.
- camera: ONE of "push-in", "pull-back", "orbit-left", "orbit-right", "drift-up",
  "drift-down", "pan-left", "pan-right", "crash-zoom", "settle". Calm beats get
  gentle moves; the reveal earns "crash-zoom" or a fast push-in.
- motion: true for AT MOST 1 line (the reveal) where a real video clip would be
  dramatically better; false otherwise.
- sfxHint: one sound cue ("tick", "riser", "cash register", "impact", "whoosh").

Also give "hookCard": 3-7 word ALL-CAPS banner over frame 0 with 1-2 words in
_underscores_ (e.g. "THE _19%_ PROBLEM").

Return ONLY valid JSON, exactly:
{{
  "title": "punchy title under 60 chars",
  "hookCard": "THE _19%_ PROBLEM",
  "vo": [
    {{"beat": "hook", "text": "...", "graphic": "counter", "statValue": "19%",
      "statLabel": "of your paycheck", "onScreen": "YOUR _PAYCHECK_ IS LEAKING",
      "bgPrompt": "...", "camera": "push-in", "motion": false, "sfxHint": "tick"}}
  ],
  "beats": [
    {{"id": "hook", "visual": "one line describing the on-screen composition"}}
  ]
}}
Rules: 8-12 vo lines. beats covers hook/setup/quiz/reveal/twist/loop in order.
The loop's visual and statValue must mirror the hook's."""


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
                    and all(v.get("statValue") for v in vo)):
                return data
            print(f"  attempt {attempt}: invalid structure, retrying…", file=sys.stderr)
        except (ValueError, RuntimeError, KeyError) as e:
            print(f"  attempt {attempt} failed: {e}", file=sys.stderr)
    sys.exit("local AI did not return a valid finance script after 3 attempts")


def normalize_finance(data, out_dir, duration, fps=30):
    """Reuses the shared timing normalizer, then enforces the finance payload:
    valid graphic tokens, always-present statValue/Label, bars parsed to a list.
    statValue MUST carry a digit — a word like "CALC" renders as a dead card,
    so non-numeric values fall back to the first number in the voice line."""
    beats = normalize(data, out_dir, duration, fps)
    import re
    for v in beats["vo"]:
        g = str(v.get("graphic") or "").strip().lower()
        if g not in GRAPHICS:
            g = "counter"
        v["graphic"] = g
        value = str(v.get("statValue") or "").strip()
        if not re.search(r"\d", value):
            m = re.search(r"\$?\d[\d,.]*%?", v.get("text", ""))
            value = m.group(0).replace(",", "") if m else (str(v.get("onScreen") or "").replace("_", "") or value)
        v["statValue"] = value or "?"
        v["statLabel"] = str(v.get("statLabel") or "").strip()
        bars = v.get("statBars")
        if g == "bars":
            if isinstance(bars, str):
                try:
                    bars = json.loads(bars)
                except ValueError:
                    bars = [s.strip() for s in bars.split(",") if s.strip()]
            v["statBars"] = [str(b) for b in (bars or [])][:4] or ["Option A=1", "Option B=2"]
        else:
            v.pop("statBars", None)
        v.setdefault("onScreen", "")
    beats["pipeline"] = "finance"
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
    print(f"generating FINANCE script for: {args.topic!r}")
    data = generate_script(args.topic, args.style, args.duration, args.word_budget)
    beats = normalize_finance(data, out_dir, args.duration)

    beats_path = os.path.join(out_dir, "beats.json")
    with open(beats_path, "w", encoding="utf-8") as f:
        json.dump(beats, f, indent=2, ensure_ascii=False)
        f.write("\n")
    write_script_md(beats, args.topic, args.style, os.path.join(out_dir, "script.md"))
    print(f"title: {beats['title']}  ({len(beats['vo'])} lines, {beats['format']['durationSec']}s)")
    print(f"  beats.json -> {os.path.relpath(beats_path, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))}")


if __name__ == "__main__":
    main()
