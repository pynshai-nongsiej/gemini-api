#!/usr/bin/env python3
"""
gen_sfx.py — grow the shared SFX library (media/library/sfx/) from a palette spec.

Step-4 (SFX) library builder for the AI Video Editor. Reads media/library/sfx/palette.json
(generic, reusable sound recipes), and for every sound that is NOT already on disk it
generates the clip via the ElevenLabs Sound Effects API (text -> sfx), peak-normalizes
it for consistent mixing headroom, measures duration + loudness, and (re)writes
media/library/sfx/catalog.json — the library manifest that /suggest-sfx and tools/mix_sfx.py read.

LIBRARY-FIRST: existing clips are skipped (never re-billed) unless --force. The library
is the durable, cross-project asset; each video is one draw from it.

Usage:
  python tools/gen_sfx.py                 # generate any missing palette sounds
  python tools/gen_sfx.py --force         # regenerate all (re-bills ElevenLabs)
  python tools/gen_sfx.py --only id1,id2  # just these ids
  python tools/gen_sfx.py --dry-run       # show what WOULD be generated, no API calls

Needs ELEVENLABS_API_KEY in .env (see .env.example). ffmpeg/ffprobe on PATH.
"""
import json
import os
import re
import subprocess
import sys
import urllib.request
import urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SFX_DIR = os.path.join(ROOT, "media", "library", "sfx")
PALETTE = os.path.join(SFX_DIR, "palette.json")
CATALOG = os.path.join(SFX_DIR, "catalog.json")
API_URL = "https://api.elevenlabs.io/v1/sound-generation"

LICENSE = ("ElevenLabs generated (text-to-sfx); owner: the generating account, commercial use per "
           "the account's ElevenLabs plan")
SOURCE = "elevenlabs:sound-generation"


def load_env():
    """Minimal .env reader so we don't depend on python-dotenv."""
    env = {}
    p = os.path.join(ROOT, ".env")
    if os.path.exists(p):
        for line in open(p, encoding="utf-8"):
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return {**env, **os.environ}


def run_capture(cmd):
    return subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True).stdout


def probe_duration(path):
    out = run_capture(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                       "-of", "default=nw=1:nk=1", path]).strip()
    try:
        return round(float(out), 3)
    except ValueError:
        return None


def measure_peak_db(path):
    out = run_capture(["ffmpeg", "-hide_banner", "-i", path, "-af", "volumedetect",
                       "-f", "null", os.devnull])
    m = re.search(r"max_volume:\s*(-?[\d.]+) dB", out)
    return float(m.group(1)) if m else None


def measure_lufs(path):
    """Best-effort integrated loudness (ebur128). Unreliable for <1s transients; informational."""
    out = run_capture(["ffmpeg", "-hide_banner", "-i", path, "-af", "ebur128", "-f", "null", os.devnull])
    ms = re.findall(r"I:\s*(-?[\d.]+)\s*LUFS", out)
    try:
        return float(ms[-1]) if ms else None
    except ValueError:
        return None


def apply_gain(path, gain_db):
    if abs(gain_db) < 0.1:
        return True
    tmp = path + ".norm.mp3"
    run_capture(["ffmpeg", "-y", "-hide_banner", "-i", path, "-af", f"volume={gain_db:.2f}dB",
                 "-c:a", "libmp3lame", "-q:a", "2", tmp])
    if os.path.exists(tmp) and os.path.getsize(tmp) > 0:
        os.replace(tmp, path)
        return True
    if os.path.exists(tmp):
        os.remove(tmp)
    return False


def normalize_clip(path, target_lufs, ceiling_db):
    """Loudness-normalize to target_lufs so gain_db in a plan is perceptually meaningful,
    but never let the peak exceed ceiling_db (single re-encode). Falls back to a plain
    peak-to-ceiling normalize for transients too short for a reliable ebur128 reading."""
    lufs = measure_lufs(path)
    peak = measure_peak_db(path)
    if peak is None:
        return None, None
    if lufs is None or lufs < -50:  # ebur128 gated the clip — peak-normalize instead
        apply_gain(path, ceiling_db - peak)
    else:
        gain = target_lufs - lufs
        if peak + gain > ceiling_db:      # would clip -> clamp to the ceiling
            gain = ceiling_db - peak
        apply_gain(path, gain)
    return measure_lufs(path), measure_peak_db(path)


def generate(api_key, prompt, duration_s, prompt_influence, model):
    body = {
        "text": prompt,
        "duration_seconds": float(duration_s),
        "prompt_influence": float(prompt_influence),
        "model_id": model,
    }
    req = urllib.request.Request(
        API_URL, data=json.dumps(body).encode("utf-8"),
        headers={"xi-api-key": api_key, "Content-Type": "application/json", "Accept": "audio/mpeg"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        return resp.read()


# ---------------------------------------------------------------------------
# LOCAL SYNTHESIS FALLBACK — no ElevenLabs key required.
# Category-keyed ffmpeg lavfi recipes (the same approach as a cinematic
# sound-design synth): motion->whoosh, tension->riser, emphasis->impact,
# snap->click, plus a few id-specific recipes. Rougher than a neural sfx
# model but fully offline, deterministic and free.
# ---------------------------------------------------------------------------
SYNTH_LICENSE = "Local ffmpeg synthesis (lavfi); no external service, free to use"
SYNTH_SOURCE = "local:ffmpeg-synth"


def _synth_args(sid, category, dur):
    d = max(0.25, min(8.0, float(dur)))
    ds = f"{d:.2f}"
    c = (category or "").lower()
    # id-specific recipes first
    if sid.startswith("piano"):
        notes = {"c-maj": "261.63 329.63 392.00", "g-maj": "196.00 246.94 392.00",
                 "a-min": "220.00 261.63 329.63", "f-maj": "174.61 220.00 261.63"}.get(
            sid.split("-")[-1] if "-" in sid else "", "261.63 329.63 392.00")
        freqs = "}".join("+".join(f"0.22*sin(2*PI*{f}*t)" for f in notes.split()))
        return ["-f", "lavfi", "-i",
                f"aevalsrc={freqs}:d={ds}:s=44100",
                "-af", f"afade=t=in:ss=0:d=0.02,afade=t=out:st={max(0, d - 0.9):.2f}:d=0.9,aecho=0.7:0.6:120|240:0.3|0.15,volume=1.6"]
    if sid.startswith("chime"):
        return ["-f", "lavfi", "-i",
                f"aevalsrc=0.25*sin(2*PI*880*t)+0.18*sin(2*PI*1318*t)+0.12*sin(2*PI*1760*t):d={ds}:s=44100",
                "-af", f"afade=t=out:st={max(0, d - 0.6):.2f}:d=0.6,aecho=0.8:0.7:90|180:0.35|0.2,volume=1.5"]
    if "whoosh" in sid:
        return ["-f", "lavfi", "-i", f"anoisesrc=d={ds}:c=brown:a=0.4",
                "-af", f"bandpass=f=600:w=900,afade=t=in:ss=0:d={max(0.05, d * 0.45):.2f},"
                       f"afade=t=out:st={max(0, d * 0.55):.2f}:d={d * 0.45:.2f},volume=1.7"]
    if "riser" in sid:
        return ["-f", "lavfi", "-i",
                f"aevalsrc=0.3*sin(2*PI*(120+420*t/max(0.01\\,t*0.999))*t)+0.08*random(0):d={ds}:s=44100",
                "-af", f"lowpass=f=3000,afade=t=in:ss=0:d={max(0.05, d - 0.15):.2f},volume=1.4"]
    if "impact" in sid or "thump" in sid or "launch" in sid:
        return ["-f", "lavfi", "-i",
                f"aevalsrc=0.5*sin(2*PI*90*t)*exp(-3*t)+0.2*sin(2*PI*55*t)*exp(-2*t):d={ds}:s=44100",
                "-af", f"afade=t=out:st={max(0, d - 0.8):.2f}:d=0.8,volume=1.9"]
    if "tick" in sid or "click" in sid or "toggle" in sid or "send" in sid or "typing" in sid or "snap" in sid:
        return ["-f", "lavfi", "-i", f"anoisesrc=d={ds}:c=white:a=0.5",
                "-af", f"highpass=f=2000,afade=t=out:st=0.02:d={max(0.05, d - 0.02):.2f},volume=1.2"]
    if "knock" in sid or "thock" in sid:
        return ["-f", "lavfi", "-i",
                f"aevalsrc=0.4*sin(2*PI*180*t)*exp(-14*t)+0.15*sin(2*PI*90*t)*exp(-10*t):d={ds}:s=44100",
                "-af", "volume=1.8"]
    if "glitch" in sid or "zap" in sid:
        return ["-f", "lavfi", "-i",
                f"aevalsrc=0.3*sin(2*PI*(2400-1800*t/max(0.01\\,t*0.999))*t)*exp(-8*t):d={ds}:s=44100",
                "-af", "volume=1.4"]
    if "hum" in sid or "scan" in sid:
        return ["-f", "lavfi", "-i",
                f"aevalsrc=0.2*sin(2*PI*110*t)+0.1*sin(2*PI*220*t)+0.05*random(0):d={ds}:s=44100",
                "-af", "tremolo=f=6:d=0.4,lowpass=f=800,volume=1.4"]
    if "wind" in sid or "stream" in sid:
        return ["-f", "lavfi", "-i", f"anoisesrc=d={ds}:c=pink:a=0.25",
                "-af", "lowpass=f=700,tremolo=f=0.4:d=0.35,volume=1.3"]
    if "sparkle" in sid or "shimmer" in sid:
        return ["-f", "lavfi", "-i",
                f"aevalsrc=0.12*sin(2*PI*1568*t)+0.1*sin(2*PI*2093*t)+0.08*sin(2*PI*2637*t):d={ds}:s=44100",
                "-af", "tremolo=f=7:d=0.5,aecho=0.8:0.7:80|160:0.4|0.25,volume=1.3"]
    if "hoot" in sid:
        return ["-f", "lavfi", "-i",
                f"aevalsrc=0.3*sin(2*PI*420*t)*exp(-2*t)+0.3*sin(2*PI*380*t)*exp(-2*max(0\\,t-0.4)):d={ds}:s=44100",
                "-af", "lowpass=f=900,volume=1.5"]
    if "scribble" in sid or "pencil" in sid:
        return ["-f", "lavfi", "-i", f"anoisesrc=d={ds}:c=white:a=0.3",
                "-af", "bandpass=f=2400:w=1200,tremolo=f=14:d=0.8,volume=1.1"]
    if "flip" in sid or "page" in sid:
        return ["-f", "lavfi", "-i", f"anoisesrc=d={ds}:c=pink:a=0.4",
                "-af", "bandpass=f=1500:w=1000,flanger=delay=6:depth=3:regen=40,volume=1.4"]
    if "pop" in sid or "reveal" in sid or "stamp" in sid:
        return ["-f", "lavfi", "-i",
                f"aevalsrc=0.35*sin(2*PI*(500+900*t)*t)*exp(-5*t):d={ds}:s=44100",
                "-af", "volume=1.6"]
    # generic per-category fallback
    if c == "motion":
        return ["-f", "lavfi", "-i", f"anoisesrc=d={ds}:c=brown:a=0.4",
                "-af", f"bandpass=f=600:w=900,afade=t=in:ss=0:d={d / 2:.2f},afade=t=out:st={d / 2:.2f}:d={d / 2:.2f},volume=1.6"]
    if c == "tension":
        return ["-f", "lavfi", "-i", f"aevalsrc=0.25*sin(2*PI*(150+380*t)*t):d={ds}:s=44100",
                "-af", f"afade=t=in:ss=0:d={max(0.05, d - 0.2):.2f},volume=1.3"]
    if c == "snap":
        return ["-f", "lavfi", "-i", f"anoisesrc=d={ds}:c=white:a=0.5",
                "-af", "highpass=f=1800,afade=t=out:st=0.02:d=0.1,volume=1.2"]
    # absolute fallback: soft emphasis impact
    return ["-f", "lavfi", "-i",
            f"aevalsrc=0.4*sin(2*PI*90*t)*exp(-4*t):d={ds}:s=44100",
            "-af", "volume=1.7"]


def generate_local(sid, category, duration_s):
    """Synthesize a palette sound locally. Returns raw mp3 bytes."""
    import tempfile
    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp:
        tmp_path = tmp.name
    try:
        args = _synth_args(sid, category, duration_s)
        r = subprocess.run(["ffmpeg", "-y", "-hide_banner", "-v", "error", *args, tmp_path],
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        if r.returncode != 0 or not os.path.exists(tmp_path) or os.path.getsize(tmp_path) == 0:
            raise RuntimeError(f"ffmpeg synth failed for {sid}: {r.stdout[-300:]}")
        with open(tmp_path, "rb") as f:
            return f.read()
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


def main():
    args = sys.argv[1:]
    force = "--force" in args
    dry = "--dry-run" in args
    renorm = "--renorm" in args  # re-balance existing clips only, no API calls
    only = None
    if "--only" in args:
        only = set(args[args.index("--only") + 1].split(","))

    with open(PALETTE, encoding="utf-8") as f:
        palette = json.load(f)
    d = palette.get("defaults", {})
    pinf = d.get("prompt_influence", 0.45)
    target_lufs = d.get("target_lufs", -20.0)
    ceiling_db = d.get("ceiling_dbfs", -1.5)
    model = d.get("model", "eleven_text_to_sound_v2")

    catalog = {"note": "", "clips": []}
    if os.path.exists(CATALOG):
        with open(CATALOG, encoding="utf-8") as f:
            catalog = json.load(f)
    catalog["note"] = ("Shared SFX library manifest for the AI Video Editor. Generated by "
                       "tools/gen_sfx.py from palette.json. Clips are loudness-normalized mp3 in "
                       "media/library/sfx/clips/. Read by tools/mix_sfx.py and /suggest-sfx. Grows every "
                       "video (library-first). Note: SFX that must live INSIDE a Remotion TSX shot "
                       "go in remotion/public/media/library/sfx/ via staticFile(); this library is for the "
                       f"post-mix (tools/mix_sfx.py). Loudness-normalized to ~{target_lufs} LUFS with a "
                       f"{ceiling_db} dBFS peak ceiling, so a plan's per-cue gain_db is perceptually "
                       "meaningful (see each video's sfx-plan.json).")
    by_id = {c["id"]: c for c in catalog.get("clips", [])}

    clips_dir = os.path.join(SFX_DIR, "clips")
    os.makedirs(clips_dir, exist_ok=True)

    env = load_env()
    api_key = env.get("ELEVENLABS_API_KEY", "").strip()

    def entry(s, rel, path, source=SOURCE, model_used=model, license_=LICENSE):
        lufs, peak = normalize_clip(path, target_lufs, ceiling_db)
        dur = probe_duration(path)
        print(f"   {s['id']}: dur={dur}s  peak={peak}dBFS  lufs={lufs}")
        return {
            "id": s["id"], "file": rel, "category": s.get("category", ""),
            "tags": s.get("tags", []), "duration_s": dur, "peak_dbfs": peak,
            "loudness_lufs": lufs, "source": source, "model": model_used, "license": license_,
            "prompt": s["prompt"], "used_in": by_id.get(s["id"], {}).get("used_in", []),
        }

    def write_catalog():
        order = [s["id"] for s in palette["sounds"]]
        catalog["clips"] = ([by_id[i] for i in order if i in by_id]
                            + [c for i, c in by_id.items() if i not in order])
        with open(CATALOG, "w", encoding="utf-8") as f:
            json.dump(catalog, f, indent=2, ensure_ascii=False)
            f.write("\n")
        print(f"\ncatalog -> {os.path.relpath(CATALOG, ROOT)}  ({len(catalog['clips'])} clips)")

    if renorm:  # re-balance existing clips to the current loudness target, no API
        n = 0
        for s in palette["sounds"]:
            if only and s["id"] not in only:
                continue
            rel = f"clips/{s['id']}.mp3"
            path = os.path.join(SFX_DIR, rel)
            if not os.path.exists(path):
                continue
            by_id[s["id"]] = entry(s, rel, path)
            n += 1
        print(f"re-normalized {n} clips to ~{target_lufs} LUFS (ceiling {ceiling_db} dBFS)")
        write_catalog()
        return

    todo, skip = [], []
    for s in palette["sounds"]:
        if only and s["id"] not in only:
            continue
        rel = f"clips/{s['id']}.mp3"
        path = os.path.join(SFX_DIR, rel)
        if os.path.exists(path) and not force:
            skip.append(s["id"])
            continue
        todo.append((s, rel, path))

    print(f"palette: {len(palette['sounds'])} sounds | to generate: {len(todo)} | skip (exist): {len(skip)}")
    if skip:
        print("  skipping (library-first):", ", ".join(skip))
    if dry:
        for s, rel, _ in todo:
            print(f"  WOULD generate {s['id']} -> {rel}  ({s['duration_s']}s)  \"{s['prompt'][:60]}...\"")
        return
    if todo and not api_key:
        print("ELEVENLABS_API_KEY not set — falling back to LOCAL ffmpeg synthesis "
              "(offline, free; neural quality needs the key).")

    for s, rel, path in todo:
        print(f"\n-> {s['id']}  ({s['duration_s']}s)")
        if api_key:
            try:
                audio = generate(api_key, s["prompt"], s["duration_s"], pinf, model)
            except urllib.error.HTTPError as e:
                sys.exit(f"ElevenLabs HTTP {e.code}: {e.read().decode('utf-8', 'ignore')[:400]}")
            with open(path, "wb") as f:
                f.write(audio)
            by_id[s["id"]] = entry(s, rel, path)
        else:
            audio = generate_local(s["id"], s.get("category", ""), s["duration_s"])
            with open(path, "wb") as f:
                f.write(audio)
            by_id[s["id"]] = entry(s, rel, path, source=SYNTH_SOURCE,
                                   model_used="ffmpeg-lavfi", license_=SYNTH_LICENSE)

    write_catalog()


if __name__ == "__main__":
    main()
