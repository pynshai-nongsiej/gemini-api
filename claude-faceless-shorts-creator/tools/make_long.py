#!/usr/bin/env python3
"""
make_long.py — LONG-FORM pipeline (16:9, 3-6 min documentary-style video).

  topic -> chaptered script (gen_script_long.py, local AI) -> per-line imagery
  (the channel's pipeline strategy: NASA / archives / AI plates) -> voice
  (Kokoro) -> 16:9 chaptered Remotion composition -> render -> mux -> FINAL.

Reuses the shorts factory's proven pieces (make_short.gen_images, gen_voice,
mix pattern) with a landscape edit format: chapter title cards, film-grade
imagery, quiet captions. Single output guarantee: shorts/<id>/output/<id>-final.mp4.

Usage:
  python tools/make_long.py --topic "..." --pipeline history --duration 240
  python tools/make_long.py --resume longs/long-1-greenbrier-bunker
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))

from gen_script import slugify  # noqa: E402
from gen_script_long import normalize_long  # noqa: E402

ACCENTS = ["#f5d76e", "#7dd3fc", "#a78bfa", "#fda4af", "#86efac"]


def sh(cmd, cwd=ROOT, check=True):
    print(f"  $ {' '.join(str(c) for c in cmd)}" if isinstance(cmd, list) else f"  $ {cmd}")
    r = subprocess.run(cmd if isinstance(cmd, list) else cmd, shell=isinstance(cmd, str),
                       cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    if r.stdout.strip():
        tail = "\n".join(r.stdout.strip().splitlines()[-10:])
        print("    " + tail.replace("\n", "\n    "))
    if check and r.returncode != 0:
        sys.exit(f"step failed ({r.returncode}): {cmd}\n{r.stdout[-2000:]}")
    return r


def next_index():
    n = 0
    base = os.path.join(ROOT, "longs")
    if os.path.isdir(base):
        for d in os.listdir(base):
            m = re.match(r"long-(\d+)", d)
            if m:
                n = max(n, int(m.group(1)))
    return n + 1


def gen_composition_long(beats, srcs, comp_id, shot_dir, accent, seed=None, brand="COSMIC ARCHIVE"):
    """16:9 DOCUMENTARY edit (Astrum/SEA style): slow contemplative pace —
    one image holds ~9s across two narration lines, 1.5s dissolves, gentle
    Ken Burns, chapter cards with slow fades, telemetry chips for the
    striking numbers, persistent brand mark, quiet captions, vignette."""
    fps = beats["format"].get("fps", 30)
    total = beats["format"]["durationSec"]
    total_frames = round(total * fps)
    vo = beats["vo"]

    # slow b-roll: one image holds TWO narration lines (~9-11s)
    spans = []
    i = 0
    while i < len(vo):
        start_f = 0 if i == 0 else max(0, round(float(vo[i]["start"]) * fps) - 2)
        j = min(i + 1, len(vo) - 1)
        end_f = (round(float(vo[j + 1]["start"]) * fps) - 2) if j + 1 < len(vo) else total_frames
        end_f = max(min(end_f, total_frames), start_f + 24)
        spans.append({"src": srcs[min(i // 2, len(srcs) - 1)],
                      "start": start_f, "end": end_f,
                      "move": vo[i].get("camera", "push-in"), "intensity": 0.65,
                      "fadeIn": 0 if i == 0 else 45})  # 1.5s dissolves
        i += 2

    beats_lit = "\n".join(
        "  { src: '%s', start: %d, end: %d, move: '%s', intensity: %s, fadeIn: %d }," %
        (s["src"], s["start"], s["end"], s["move"], s["intensity"], s["fadeIn"])
        for s in spans)

    cards = []
    for c in beats.get("chapters", []):
        start_f = round(float(c.get("start", 0)) * fps)
        cards.append({"title": str(c.get("title", "")), "from": start_f,
                      "end": start_f + round(4.5 * fps)})
    cards_lit = "\n".join(
        "  { title: %s, from: %d, end: %d }," % (json.dumps(c["title"]), c["from"], c["end"])
        for c in cards)

    # telemetry chips: the leading figure of narration lines that carry numbers
    chips = []
    for v in vo:
        m = re.findall(r"(?:\$?[0-9][0-9,.]*|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)s?\b)\s*(?:billion|million|trillion|thousand|hundred)?\s*(?:MPH|mph|miles|mile|km|years|year|tons|ton|light-years|light years|%|percent)?", v.get("text", ""), re.IGNORECASE)
        m = [x.strip() for x in m if len(x.strip()) >= 2]
        if m:
            frm = round(float(v["start"]) * fps) + 12
            to = round(float(v["end"]) * fps) - 4
            if to > frm:
                chips.append((json.dumps(m[0].upper()), frm, to))
    chips = chips[:24]
    chips_lit = "\n".join("  { value: %s, from: %d, end: %d }," % c for c in chips)

    cold_open = json.dumps(str(beats.get("title") or ""))
    chapter_style = (seed or {}).get("chapter_style", "centered")

    tsx = TSX_TEMPLATE
    for token, value in {
        "__COMP__": comp_id,
        "__ACCENT__": accent,
        "__TITLE__": cold_open,
        "__CHAPTER_STYLE__": chapter_style,
        "__BRAND__": json.dumps(brand),
        "__BEATS__": beats_lit,
        "__CHAPTERS__": cards_lit,
        "__CHIPS__": chips_lit,
        "__FPS__": str(fps),
        "__TOTAL__": str(round(total, 2)),
    }.items():
        tsx = tsx.replace(token, value)

    path = os.path.join(shot_dir, f"{comp_id}.tsx")
    with open(path, "w", encoding="utf-8") as f:
        f.write(tsx)
    print(f"    composition -> {os.path.relpath(path, ROOT)}")
    return path


TSX_TEMPLATE = """import React from 'react';
import { AbsoluteFill, Sequence, staticFile, useCurrentFrame, interpolate, Easing } from 'remotion';
import { Captions, ProgressBar } from '../../lib/shorts';
import { KenBurnsImage } from '../../lib/story';
import { VO } from './vo.gen';

// AUTO-GENERATED by tools/make_long.py — documentary edit:
// slow holds, 1.5s dissolves, chapter cards, telemetry chips, vignette.

export const compositionConfig = {
  id: '__COMP__',
  durationInSeconds: __TOTAL__,
  fps: __FPS__,
  width: 1920,
  height: 1080,
};

const ACCENT = '__ACCENT__';
const TITLE = __TITLE__;
const BRAND = __BRAND__;
const CHAPTER_STYLE = '__CHAPTER_STYLE__';
const TAIL = 45; // 1.5s under-lap so dissolves never gap

const BEATS = [
__BEATS__
] as const;

const CHAPTERS: { title: string; from: number; end: number }[] = [
__CHAPTERS__
];

const DATA_CHIPS: { value: string; from: number; end: number }[] = [
__CHIPS__
];

const easeOut = Easing.out(Easing.cubic);

const BrandMark: React.FC = () => (
  <div style={{
    position: 'absolute', top: 54, left: 60,
    fontFamily: 'Inter, sans-serif', fontWeight: 700, fontSize: 17,
    letterSpacing: 5, color: 'rgba(244,242,238,0.5)', textTransform: 'uppercase',
  }}>{BRAND}</div>
);

const DataChip: React.FC<{ value: string; dur: number }> = ({ value, dur }) => {
  const f = useCurrentFrame();
  const fade = interpolate(f, [0, 14, dur - 14, dur], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOut });
  return (
    <div style={{
      position: 'absolute', top: 54, right: 60, opacity: fade,
      fontFamily: 'JetBrains Mono, monospace', fontSize: 22, fontWeight: 500,
      color: 'rgba(244,242,238,0.94)', background: 'rgba(8,10,14,0.55)',
      border: '1px solid rgba(255,255,255,0.14)', borderRight: '3px solid ' + ACCENT,
      padding: '10px 18px', borderRadius: 6, letterSpacing: 1,
    }}>{value}</div>
  );
};

const Vignette: React.FC = () => (
  <AbsoluteFill style={{
    background: 'radial-gradient(ellipse at center, transparent 55%, rgba(4,5,8,0.55) 100%)',
  }} />
);

const ChapterCard: React.FC<{ title: string; dur: number; index: number; cardStyle: string }> = ({ title, dur, index, cardStyle }) => {
  const f = useCurrentFrame();
  const fade = interpolate(f, [0, 20, dur - 20, dur], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOut });
  if (cardStyle === 'editorial') {
    return (
      <AbsoluteFill style={{ justifyContent: 'flex-end', opacity: Math.max(0, fade) }}>
        <AbsoluteFill style={{ background: 'linear-gradient(180deg, transparent 40%, rgba(6,8,12,0.88))' }} />
        <div style={{ padding: '0 0 110px 110px' }}>
          <div style={{ fontFamily: 'Inter, sans-serif', fontWeight: 800, fontSize: 26,
            color: ACCENT, marginBottom: 10 }}>{String(index + 1).padStart(2, '0')} — CHAPTER</div>
          <div style={{ fontFamily: 'Inter, sans-serif', fontWeight: 900, fontSize: 64,
            letterSpacing: 2, color: '#f4f2ee', textTransform: 'uppercase' }}>{title}</div>
        </div>
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', opacity: Math.max(0, fade) }}>
      <AbsoluteFill style={{ background: 'rgba(6,8,12,0.72)' }} />
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: 64, height: 4, background: ACCENT, margin: '0 auto 26px' }} />
        <div style={{ fontFamily: 'Inter, sans-serif', fontWeight: 900, fontSize: 76,
          letterSpacing: 3, color: '#f4f2ee', textTransform: 'uppercase' }}>{title}</div>
      </div>
    </AbsoluteFill>
  );
};

const TitleCard: React.FC = () => {
  const f = useCurrentFrame();
  const fade = interpolate(f, [0, 20, 130, 150], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: easeOut });
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', background: 'rgba(6,8,12,0.6)', opacity: fade }}>
      <div style={{ textAlign: 'center', padding: '0 120px' }}>
        <div style={{ fontFamily: 'Inter, sans-serif', fontWeight: 800, fontSize: 26,
          letterSpacing: 6, color: ACCENT, textTransform: 'uppercase', marginBottom: 20 }}>Documentary</div>
        <div style={{ fontFamily: 'Inter, sans-serif', fontWeight: 900, fontSize: 88,
          letterSpacing: 1, color: '#f4f2ee', lineHeight: 1.1 }}>{TITLE}</div>
      </div>
    </AbsoluteFill>
  );
};

const LongComp: React.FC = () => {
  return (
    <AbsoluteFill style={{ background: '#0b0d12' }}>
      {BEATS.map((b, i) => {
        const isLast = i === BEATS.length - 1;
        const dur = b.end - b.start + (isLast ? 0 : TAIL);
        return (
          <Sequence key={i} from={b.start} durationInFrames={dur}>
            <KenBurnsImage src={b.src} dur={dur} move={b.move} intensity={b.intensity} fadeIn={b.fadeIn} />
          </Sequence>
        );
      })}
      <Sequence from={0} durationInFrames={150}>
        <TitleCard />
      </Sequence>
      {CHAPTERS.map((c, i) => (
        <Sequence key={'c' + i} from={c.from} durationInFrames={c.end - c.from}>
          <ChapterCard title={c.title} dur={c.end - c.from} index={i} cardStyle={CHAPTER_STYLE} />
        </Sequence>
      ))}
      {DATA_CHIPS.map((c, i) => (
        <Sequence key={'d' + i} from={c.from} durationInFrames={c.end - c.from}>
          <DataChip value={c.value} dur={c.end - c.from} />
        </Sequence>
      ))}
      <BrandMark />
      <Vignette />
      <Captions lines={VO} y={958} size={34} accent={ACCENT} maxWords={8} plate />
      <ProgressBar color={ACCENT} />
    </AbsoluteFill>
  );
};

export default LongComp;
"""


def main():
    ap = argparse.ArgumentParser(description="Long-form (16:9) documentary factory")
    ap.add_argument("--topic")
    ap.add_argument("--resume")
    ap.add_argument("--pipeline", default="space", choices=["space", "finance", "history"])
    ap.add_argument("--style", default=None)
    ap.add_argument("--voice", default="dynamic")
    ap.add_argument("--duration", type=float, default=240.0)
    ap.add_argument("--keep-intermediates", action="store_true")
    args = ap.parse_args()

    if not args.topic and not args.resume:
        sys.exit("need --topic or --resume longs/<id>")

    if args.resume:
        proj_dir = os.path.abspath(args.resume)
        proj_id = os.path.basename(proj_dir.rstrip("/"))
    else:
        proj_id = f"long-{next_index()}-{slugify(args.topic, 36)}"
        proj_dir = os.path.join(ROOT, "longs", proj_id)
        os.makedirs(proj_dir, exist_ok=True)

    beats_path = os.path.join(proj_dir, "beats.json")
    media_dir = os.path.join(ROOT, "media", "projects", proj_id)

    # 1. script
    if not os.path.exists(beats_path):
        print(f"\n[1/6] long-form script for: {args.topic!r}")
        sh([sys.executable, "tools/gen_script_long.py", "--topic", args.topic,
            "--out", proj_dir, "--pipeline", args.pipeline,
            "--duration", str(args.duration)]
           + (["--style", args.style] if args.style else []))
    beats = json.load(open(beats_path, encoding="utf-8"))
    pipeline = beats.get("pipeline", args.pipeline)
    comp_id = beats.get("composition")
    total = float(beats["format"]["durationSec"])
    print(f"      '{beats['title']}'  ({len(beats['vo'])} lines, {total:.0f}s, {len(beats.get('chapters', []))} chapters)")

    # 2. imagery — reuse the shorts factory's pipeline strategy
    print(f"\n[2/6] chapter imagery ({pipeline})")
    os.makedirs(media_dir, exist_ok=True)
    import make_short
    srcs = make_short.gen_images(pipeline, beats, proj_dir, media_dir, "2K")

    # 3. voice
    shot_dir = os.path.join(ROOT, "remotion", "src", "shots", comp_id.lower())
    print("\n[3/6] voice (local Kokoro TTS)")
    sh([sys.executable, "tools/gen_voice.py", "--beats", beats_path,
        "--voice", args.voice, "--emit-ts", os.path.join(shot_dir, "vo.gen.ts")])
    beats = json.load(open(beats_path, encoding="utf-8"))
    total = float(beats["format"]["durationSec"])

    # 4. composition + render
    accent = ACCENTS[(next_index() - 1) % len(ACCENTS)]
    print(f"\n[4/6] composition + render (accent {accent})")
    gen_composition_long(beats, srcs, comp_id, shot_dir, accent, seed)
    sh(["npm", "run", "gen"], cwd=os.path.join(ROOT, "remotion"))
    sh(["node", "scripts/render-all.mjs", comp_id, "--scale=1"], cwd=os.path.join(ROOT, "remotion"))
    rendered = os.path.join(ROOT, "remotion", "out", f"{comp_id}.mp4")
    if not os.path.exists(rendered):
        sys.exit(f"render did not produce {rendered}")

    # 5. mux voice
    print("\n[5/6] voice mux")
    voiced = os.path.join(ROOT, "remotion", "out", f"{comp_id}-voiced.mp4")
    sh(["ffmpeg", "-y", "-v", "error", "-i", rendered, "-i", os.path.join(proj_dir, "voice", "voice.wav"),
        "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-t", str(total), voiced])

    # 6. final only
    print("\n[6/6] final")
    out_dir = os.path.join(proj_dir, "output")
    os.makedirs(out_dir, exist_ok=True)
    final_copy = os.path.join(out_dir, f"{proj_id}-final.mp4")
    shutil.copy2(voiced, final_copy)
    if not args.keep_intermediates:
        for p in (rendered, voiced):
            if os.path.exists(p):
                os.remove(p)

    qc = None
    try:
        sh([sys.executable, "tools/qc_check.py", "--short-dir", proj_dir], check=False)
        qc_path = os.path.join(proj_dir, "qc-report.json")
        qc = json.load(open(qc_path, encoding="utf-8")) if os.path.exists(qc_path) else None
    except Exception:
        pass

    print("\n" + "=" * 60)
    print(f"DONE  {beats['title']}")
    print(f"      {final_copy}")
    print(f"      {total:.0f}s  format=long  qc={qc['verdict'] if qc else 'skipped'}")
    print("=" * 60)
    print("FINAL:" + json.dumps({
        "proj_id": proj_id, "title": beats["title"], "final": final_copy,
        "beats": beats_path, "duration": round(total, 2), "composition": comp_id,
        "voice": beats.get("voiceStatus"), "pipeline": pipeline, "format": "long",
        "images": len(srcs), "accent": accent,
        "qc": ({"verdict": qc.get("verdict")} if qc else None),
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
