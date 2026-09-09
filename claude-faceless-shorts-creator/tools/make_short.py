#!/usr/bin/env python3
"""
make_short.py — END-TO-END local shorts factory (the "youtube agent" pipeline).

One command, fully local, zero paid APIs:
  topic -> script+beats (local AI via web2api proxy) -> beat images (free
  Pollinations FLUX) -> voice (local Kokoro TTS, word-synced) -> auto-generated
  Remotion composition (Ken Burns + word-pop captions) -> render -> mux voice
  -> SFX mix from the shared library -> optional music bed -> final mp4.

Usage:
  python tools/make_short.py --topic "why neutron stars spin 700 times a second"
  python tools/make_short.py --topic "..." --style "space documentary" --voice bm_george
  python tools/make_short.py --topic "..." --music ambient-pad --accent "#7dd3fc"
  python tools/make_short.py --resume shorts/auto-1-neutron-stars   # skip done steps

Artifacts (same layout as the hand-made shorts):
  shorts/<id>/            script.md, beats.json, sfx-plan.json, voice/, output/
  media/projects/<id>/    beat images
  remotion/src/shots/auto-N/  AutoN.tsx + vo.gen.ts (generated)
  remotion/out/AutoN*.mp4 renders; final -> shorts/<id>/output/<id>-final.mp4
"""
import argparse
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))

from gen_script import slugify  # noqa: E402

FPS = 30
ACCENTS = ["#f5d76e", "#7dd3fc", "#a78bfa", "#fda4af", "#86efac"]

# sfxHint keyword -> library clip id (fallback: whoosh-soft)
SFX_MAP = [
    (r"whoosh|swish|sweep", "whoosh-soft"),
    (r"riser|build|tension|rise", "riser-soft"),
    (r"impact|boom|deep|thump|slam|hit", "impact-deep-soft"),
    (r"tick|clock|countdown", "clock-tick-soft"),
    (r"sparkle|shimmer|magic", "sparkle-soft"),
    (r"pop|reveal|appear", "pop-reveal"),
    (r"click|tap|ui", "ui-click-soft"),
    (r"chime|bell|reward", "chime-reward"),
    (r"wind|air|breeze", "wind-soft"),
    (r"snap|click", "trap-snap"),
    (r"zap|glitch|electric", "glitch-zap"),
    (r"knock|thock|wood", "knock-solid"),
    (r"chime|tone|note", "chime-magic"),
]


def sh(cmd, cwd=ROOT, check=True):
    print(f"  $ {' '.join(str(c) for c in cmd)}" if isinstance(cmd, list) else f"  $ {cmd}")
    r = subprocess.run(cmd if isinstance(cmd, list) else cmd, shell=isinstance(cmd, str),
                       cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    if r.stdout.strip():
        tail = "\n".join(r.stdout.strip().splitlines()[-12:])
        print("    " + tail.replace("\n", "\n    "))
    if check and r.returncode != 0:
        sys.exit(f"step failed ({r.returncode}): {cmd}\n{r.stdout[-3000:]}")
    return r


def next_index():
    n = 0
    shorts_dir = os.path.join(ROOT, "shorts")
    if os.path.isdir(shorts_dir):
        for d in os.listdir(shorts_dir):
            m = re.match(r"auto-(\d+)", d)
            if m:
                n = max(n, int(m.group(1)))
    return n + 1


def gen_images(beats, proj_dir, media_dir, size):
    """One image per vo line (cached on disk). Returns staticFile-relative paths."""
    os.makedirs(media_dir, exist_ok=True)
    srcs = []
    for i, v in enumerate(beats["vo"]):
        stem = f"b{i:02d}-{slugify(v.get('beat', 'beat'), 18)}"
        # cached? accept any extension gen_image may have picked
        cached = next((f for f in os.listdir(media_dir)
                       if f.startswith(stem + ".") and not f.endswith(".json")), None)
        if cached:
            srcs.append(f"projects/{os.path.basename(media_dir)}/{cached}")
            print(f"    image {i}: cached ({cached})")
            continue
        prompt = v.get("imagePrompt") or f"{beats['title']}, cinematic scene, dramatic lighting"
        out = os.path.join(media_dir, stem + ".png")
        print(f"    image {i}: {prompt[:70]}…")
        sh([sys.executable, "tools/gen_image.py", "--prompt", prompt,
            "--aspect", "9:16", "--size", size, "--out", out])
        # gen_image may have re-extensioned the file
        actual = next((f for f in os.listdir(media_dir)
                       if f.startswith(stem + ".") and not f.endswith(".json")), None)
        if not actual:
            sys.exit(f"image {i} did not land in {media_dir}")
        srcs.append(f"projects/{os.path.basename(media_dir)}/{actual}")
    return srcs


def gen_composition(beats, srcs, comp_id, shot_dir, accent):
    """Write the AutoN.tsx Remotion composition from ACTUAL voice timings."""
    os.makedirs(shot_dir, exist_ok=True)
    fps = beats["format"].get("fps", FPS)
    total = beats["format"]["durationSec"]
    total_frames = round(total * fps)

    # frame ranges: each image spans its vo line start -> next line start (last -> end)
    spans = []
    vo = beats["vo"]
    for i, v in enumerate(vo):
        start_f = max(0, round(float(v["start"]) * fps) - 2)
        end_f = (round(float(vo[i + 1]["start"]) * fps) - 2) if i + 1 < len(vo) else total_frames
        end_f = min(end_f, total_frames)
        spans.append({"src": srcs[min(i, len(srcs) - 1)],
                      "start": start_f, "end": max(end_f, start_f + 12),
                      "variant": i % 6, "fadeIn": 0 if i == 0 else 14})

    beats_lit = "\n".join(
        f"  {{ src: '{s['src']}', start: {s['start']}, end: {s['end']}, "
        f"variant: {s['variant']}, fadeIn: {s['fadeIn']} }}," for s in spans)

    tsx = f"""import React from 'react';
import {{ AbsoluteFill, Sequence }} from 'remotion';
import {{ Captions, ProgressBar }} from '../../lib/shorts';
import {{ KenBurnsImage, StoryVignette }} from '../../lib/story';
import {{ VO }} from './vo.gen';

// =============================================================================
// AUTO-GENERATED by tools/make_short.py — "{beats['title']}"
// Ken Burns beat images + word-pop captions + progress bar. Local pipeline:
// local-AI script -> Pollinations images -> Kokoro voice -> this render.
// =============================================================================
export const compositionConfig = {{
  id: '{comp_id}',
  durationInSeconds: {round(total, 2)},
  fps: {fps},
  width: 1080,
  height: 1920,
}};

const ACCENT = '{accent}';
const TAIL = 20; // frames each beat under-laps the next so the crossfade never gaps

const BEATS = [
{beats_lit}
] as const;

const {comp_id}: React.FC = () => {{
  return (
    <AbsoluteFill style={{{{ background: '#0b0d12' }}}}>
      {{BEATS.map((b, i) => {{
        const isLast = i === BEATS.length - 1;
        const dur = b.end - b.start + (isLast ? 0 : TAIL);
        return (
          <Sequence key={{i}} from={{b.start}} durationInFrames={{dur}}>
            <KenBurnsImage src={{b.src}} dur={{dur}} variant={{b.variant}} fadeIn={{b.fadeIn}} />
          </Sequence>
        );
      }})}}
      <StoryVignette strength={{0.34}} />
      <Captions lines={{VO}} y={{1330}} size={{54}} accent={{ACCENT}} maxWords={{4}} plate />
      <ProgressBar color={{ACCENT}} />
    </AbsoluteFill>
  );
}};

export default {comp_id};
"""
    path = os.path.join(shot_dir, f"{comp_id}.tsx")
    with open(path, "w", encoding="utf-8") as f:
        f.write(tsx)
    print(f"    composition -> {os.path.relpath(path, ROOT)}")
    return path


def build_sfx_plan(beats, proj_id, voiced_rel, end_s):
    """Map vo sfxHints + beat boundaries onto library clips."""
    catalog = json.load(open(os.path.join(ROOT, "media", "library", "sfx", "catalog.json")))
    lib = {c["id"] for c in catalog.get("clips", [])}

    def map_hint(hint):
        h = (hint or "").lower()
        for pattern, sid in SFX_MAP:
            if re.search(pattern, h):
                return sid if sid in lib else None
        return None

    events, seen_at = [], set()

    def add(at, sid, gain, cue, optional=False):
        if sid is None or sid not in lib:
            return
        key = (round(at, 2), sid)
        if key in seen_at:
            return
        seen_at.add(key)
        events.append({"at_s": round(at, 2), "sfx_id": sid, "gain_db": gain,
                       "shot": "MainScene", "cue": cue, **({"optional": True} if optional else {})})

    for i, v in enumerate(beats["vo"]):
        at = float(v["start"])
        if i > 0:  # every line change gets a soft whoosh (felt, not heard)
            add(at, "whoosh-soft", -11, f"beat change: {v['beat']}", optional=True)
        hint_sid = map_hint(v.get("sfxHint"))
        add(at + 0.05, hint_sid, -8, f"sfxHint '{v.get('sfxHint', '')}'")
        if v.get("beat") == "reveal" and i > 0:
            add(at, "impact-deep-soft", -7, "the reveal lands")
        if v.get("beat") == "loop" and i > 0:
            add(at, "whoosh-soft", -10, "loop back to hook", optional=True)

    plan = {
        "master": voiced_rel,
        "master_fps": beats["format"].get("fps", FPS),
        "catalog": "media/library/sfx/catalog.json",
        "render": {
            "preview": voiced_rel,
            "out": f"shorts/{proj_id}/output/{proj_id}-sfx.mp4",
            "end_s": end_s,
            "duck": True,
        },
        "events": events,
    }
    if not events:
        return None
    path = os.path.join(ROOT, "shorts", proj_id, "sfx-plan.json")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(plan, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print(f"    sfx plan: {len(events)} cues -> {os.path.relpath(path, ROOT)}")
    return path


def main():
    ap = argparse.ArgumentParser(description="End-to-end local short factory")
    ap.add_argument("--topic", help="video topic (starts a new short)")
    ap.add_argument("--resume", help="existing shorts/<id> dir to resume")
    ap.add_argument("--style", default=None, help='niche hint, e.g. "space documentary"')
    ap.add_argument("--voice", default=os.environ.get("KOKORO_VOICE", "bm_george"))
    ap.add_argument("--duration", type=float, default=40.0)
    ap.add_argument("--image-size", default="1K", choices=["1K", "2K", "4K"])
    ap.add_argument("--accent", default=None, help="caption accent color (default rotates)")
    ap.add_argument("--music", default=None, help="music bed id to mix (e.g. ambient-pad)")
    ap.add_argument("--skip-render", action="store_true")
    args = ap.parse_args()

    if not args.topic and not args.resume:
        sys.exit("need --topic (new short) or --resume shorts/<id>")

    # 0. resolve project
    if args.resume:
        proj_dir = os.path.abspath(args.resume)
        proj_id = os.path.basename(proj_dir.rstrip("/"))
    else:
        n = next_index()
        proj_id = f"auto-{n}-{slugify(args.topic, 32)}"
        proj_dir = os.path.join(ROOT, "shorts", proj_id)
        os.makedirs(proj_dir, exist_ok=True)

    beats_path = os.path.join(proj_dir, "beats.json")
    media_dir = os.path.join(ROOT, "media", "projects", proj_id)

    # 1. script + beats (local AI)
    if not os.path.exists(beats_path):
        print(f"\n[1/6] script (local AI) for: {args.topic!r}")
        sh([sys.executable, "tools/gen_script.py", "--topic", args.topic,
            "--out", proj_dir, "--duration", str(args.duration)]
           + (["--style", args.style] if args.style else []))
    beats = json.load(open(beats_path, encoding="utf-8"))
    comp_id = beats.get("composition") or ("Auto" + proj_id.split("-")[1])
    total = float(beats["format"]["durationSec"])
    print(f"      '{beats['title']}'  ({len(beats['vo'])} lines, {total:.0f}s)")

    # 2. beat images (free Pollinations FLUX)
    print("\n[2/6] beat images (Pollinations FLUX, cached)")
    srcs = gen_images(beats, proj_dir, media_dir, args.image_size)

    # 3. voice (local Kokoro) + word timings + vo.gen.ts
    shot_dir = os.path.join(ROOT, "remotion", "src", "shots", comp_id.lower())
    vo_ts = os.path.join(shot_dir, "vo.gen.ts")
    print("\n[3/6] voice (local Kokoro TTS)")
    sh([sys.executable, "tools/gen_voice.py", "--beats", beats_path,
        "--voice", args.voice, "--emit-ts", vo_ts])
    beats = json.load(open(beats_path, encoding="utf-8"))  # re-read actual timings
    total = float(beats["format"]["durationSec"])

    # 4. composition + render
    accent = args.accent or ACCENTS[(next_index() - 1) % len(ACCENTS)]
    print(f"\n[4/6] composition + render (accent {accent})")
    gen_composition(beats, srcs, comp_id, shot_dir, accent)
    if args.skip_render:
        print("      --skip-render: stopping before render")
        return
    sh(["npm", "run", "gen"], cwd=os.path.join(ROOT, "remotion"))
    sh(["node", "scripts/render-all.mjs", comp_id, "--scale=1"],
       cwd=os.path.join(ROOT, "remotion"))
    rendered = os.path.join(ROOT, "remotion", "out", f"{comp_id}.mp4")
    if not os.path.exists(rendered):
        sys.exit(f"render did not produce {rendered}")

    # 5. mux the voice
    print("\n[5/6] voice mux")
    voice_wav = os.path.join(proj_dir, "voice", "voice.wav")
    voiced = os.path.join(ROOT, "remotion", "out", f"{comp_id}-voiced.mp4")
    sh(["ffmpeg", "-y", "-v", "error", "-i", rendered, "-i", voice_wav,
        "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
        "-t", str(total), voiced])

    # 6. SFX (library) + optional music
    print("\n[6/6] SFX mix (shared library)")
    voiced_rel = os.path.relpath(voiced, ROOT)
    plan = build_sfx_plan(beats, proj_id, voiced_rel, total)
    final = voiced
    if plan:
        sh([sys.executable, "tools/mix_sfx.py", f"shorts/{proj_id}/sfx-plan.json"])
        sfx_out = os.path.join(ROOT, "shorts", proj_id, "output", f"{proj_id}-sfx.mp4")
        if os.path.exists(sfx_out):
            final = sfx_out

    if args.music:
        print(f"      music bed: {args.music}")
        music_out = os.path.join(ROOT, "shorts", proj_id, "output", f"{proj_id}-music.mp4")
        sh([sys.executable, "tools/mix_music.py", "--bed", args.music,
            "--base", os.path.relpath(final, ROOT), "--out", os.path.relpath(music_out, ROOT),
            "--end", str(total)])
        if os.path.exists(music_out):
            final = music_out

    # final copy
    out_dir = os.path.join(proj_dir, "output")
    os.makedirs(out_dir, exist_ok=True)
    final_copy = os.path.join(out_dir, f"{proj_id}-final.mp4")
    import shutil
    shutil.copy2(final, final_copy)

    print("\n" + "=" * 60)
    print(f"DONE  {beats['title']}")
    print(f"      {final_copy}")
    print(f"      {total:.1f}s  voice={beats.get('voiceStatus')}  "
          f"images={len(srcs)}  accent={accent}")
    print("=" * 60)


if __name__ == "__main__":
    main()
