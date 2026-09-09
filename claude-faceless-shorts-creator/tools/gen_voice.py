#!/usr/bin/env python3
"""
gen_voice.py — LOCAL Kokoro TTS voice track for a TSX short, driven by its beats.json.

Local rewrite of the ElevenLabs voice step (same CLI contract, same outputs):
reads a short's beats.json (vo[] lines with estimated start/end seconds), synthesizes
each line with the local Kokoro ONNX model (single model load, batched), time-fits any
clip that overflows its window (gentle atempo, capped), assembles one timed voice
track, and writes the ACTUAL line timings + per-word maps back into beats.json — the
TSX captions retime from it.

Kokoro has no alignment endpoint, so per-word timings are synthesized from the REAL
clip duration, weighted by word length + punctuation pauses — close enough that
word-pop captions land on the spoken word.

LIBRARY-FIRST: generated lines are cached by (voice, text-hash); unchanged lines are
never re-synthesized. --force regenerates everything.

Usage:
  python tools/gen_voice.py --beats shorts/short-1-chess/beats.json
  python tools/gen_voice.py --beats ... --voice bm_george
  python tools/gen_voice.py --beats ... --mux remotion/out/Short1Chess.mp4   # + voiced preview
  python tools/gen_voice.py --beats ... --emit-ts remotion/src/shots/short-2/vo.gen.ts
  python tools/gen_voice.py --beats ... --dry-run                            # plan only

Needs KOKORO_MODEL_PATH / KOKORO_VOICES_PATH in .env (see .env.example).
ffmpeg/ffprobe on PATH. No API keys, no network.
"""
import argparse
import hashlib
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KOKORO_BRIDGE = os.path.join(ROOT, "tools", "kokoro_tts.py")

# Kokoro voices this pipeline knows. --voice accepts any Kokoro id (af_/am_/bf_/bm_…);
# legacy ElevenLabs ids/names map onto the closest Kokoro narrator.
DEFAULT_VOICE = "bm_george"
VOICE_MAP = {
    # elevenlabs premade id -> kokoro
    "TX3LPaxmHKxFdv7VOQHJ": "bm_george",   # Liam
    "pNInz6obpgDQGcFmaJgB": "am_adam",     # Adam
    "ErXwobaYiN019PkySvjV": "am_onyx",     # Antoni
    "21m00Tcm4TlvDq8ikWAM": "af_nova",     # Rachel
    "EXAVITQu4vr4xnSDxMaL": "bf_emma",     # Sarah
    # common names -> kokoro
    "liam": "bm_george", "george": "bm_george", "daniel": "bm_daniel",
    "onyx": "am_onyx", "adam": "am_adam", "eric": "am_eric",
    "nova": "af_nova", "emma": "bf_emma", "sarah": "af_sarah",
}
MAX_ATEMPO = 1.3  # never speed a line up more than 30%
MODEL_TAG = "kokoro-local"  # cache-hash namespace


def load_env():
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


def run(cmd):
    r = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    if r.returncode != 0:
        sys.exit(f"command failed: {' '.join(cmd)}\n{r.stdout}")
    return r.stdout


def probe_duration(path):
    out = run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
               "-of", "default=noprint_wrappers=1:nokey=1", path])
    return float(out.strip())


def strip_audio_tags(text):
    """Remove [excited]/[pause]-style delivery tags — they steer cloud TTS delivery,
    Kokoro would try to speak them."""
    import re
    return re.sub(r"\[[^\]]*\]", " ", text).strip()


def synthesize_batch(items, voice, speed):
    """One Kokoro model load for all lines. items: [{id, text, out}]. Returns
    {id: duration} and writes each WAV. Exits with the bridge's error on failure."""
    batch_file = os.path.join(os.path.dirname(items[0]["out"]), ".kokoro-batch.json")
    with open(batch_file, "w", encoding="utf-8") as f:
        json.dump([{**it, "voice": voice, "speed": speed} for it in items], f,
                  ensure_ascii=False)
    r = subprocess.run([sys.executable, KOKORO_BRIDGE, "--batch_file", batch_file],
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    try:
        os.remove(batch_file)
    except OSError:
        pass
    try:
        envelope = json.loads(r.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        sys.exit(f"kokoro bridge failed:\n{r.stdout[-2000:]}")
    if envelope.get("status") == "error":
        sys.exit(f"kokoro bridge error: {envelope.get('error')}")
    if envelope.get("errors"):
        for e in envelope["errors"]:
            print(f"    kokoro clip {e.get('id')} failed: {e.get('error')}", file=sys.stderr)
    durations = {c["id"]: c["duration"] for c in envelope.get("clips", [])}
    missing = [it["id"] for it in items if it["id"] not in durations]
    if missing:
        sys.exit(f"kokoro did not produce clips for lines: {missing}")
    return durations


def estimate_words(text, duration):
    """Per-word timing synthesized from the real clip duration: weight each word by
    (letters + base) and add a pause bonus for trailing punctuation."""
    words = text.split()
    if not words:
        return []
    weights = []
    for w in words:
        n = sum(1 for ch in w if ch.isalnum())
        pause = 0.45 if w[-1] in ".,!?;:" else (0.25 if w[-1] in "—–-" else 0)
        weights.append(max(1.0, n * 0.82 + 1.4 + pause))
    total = sum(weights)
    out, t = [], 0.0
    for w, wt in zip(words, weights):
        d = (wt / total) * duration
        out.append({"w": w, "start": round(t, 3), "end": round(min(t + d, duration), 3)})
        t += d
    return out


def emit_ts(vo, path):
    """Write the generated VO (with word times) as a TS module the shot imports."""
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    lines = ["// AUTO-GENERATED by tools/gen_voice.py — do not edit.",
             "// Word times are synthesized from the real Kokoro clip durations; captions sync closely.",
             "import type { VoLine } from '../../lib/shorts';", "",
             "export const VO: VoLine[] = ["]
    for line in vo:
        esc = line["text"].replace("\\", "\\\\").replace("'", "\\'")
        ws = ", ".join(
            "{ w: '%s', start: %s, end: %s }" % (w["w"].replace("\\", "\\\\").replace("'", "\\'"), w["start"], w["end"])
            for w in line.get("words", []))
        lines.append(f"  {{ text: '{esc}', start: {line['start']}, end: {line['end']}, words: [{ws}] }},")
    lines += ["];", ""]
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--beats", required=True, help="path to the short's beats.json")
    ap.add_argument("--voice", default=DEFAULT_VOICE,
                    help="Kokoro voice id (bm_george, af_nova, …); ElevenLabs ids/names map over")
    ap.add_argument("--model", default=None, help="ignored (kept for CLI compatibility)")
    ap.add_argument("--speed", type=float, default=float(os.environ.get("KOKORO_SPEED", "1.0")))
    ap.add_argument("--mux", help="optional rendered mp4 to mux the voice onto (-voiced.mp4)")
    ap.add_argument("--emit-ts", help="write the VO (with exact word times) as a TS module, e.g. remotion/src/shots/short-2/vo.gen.ts")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if args.model:
        print(f"    (--model is ignored — Kokoro is local)")

    voice = VOICE_MAP.get(args.voice, VOICE_MAP.get(args.voice.lower(), args.voice))

    beats_path = os.path.abspath(args.beats)
    beats = json.load(open(beats_path, encoding="utf-8"))
    vo = beats["vo"]
    total = float(beats["format"]["durationSec"])
    vdir = os.path.join(os.path.dirname(beats_path), "voice")
    os.makedirs(vdir, exist_ok=True)

    # plan: what needs synthesis vs what is cached
    plan = []
    for i, line in enumerate(vo):
        start = float(line["start"])
        next_start = float(vo[i + 1]["start"]) if i + 1 < len(vo) else total - 0.3
        window = next_start - start - 0.05
        tts_text = strip_audio_tags(line.get("tts", line["text"]))
        h = hashlib.sha1(f"{voice}|{MODEL_TAG}|{tts_text}".encode()).hexdigest()[:8]
        raw = os.path.join(vdir, f"line-{i:02d}-{h}.wav")
        fit = os.path.join(vdir, f"line-{i:02d}-{h}-fit.wav")
        plan.append({"i": i, "start": start, "window": window, "text": tts_text,
                     "raw": raw, "fit": fit, "h": h})

    print(f"voice: {voice} (Kokoro, local)  speed: {args.speed}")
    print(f"{'line':4s} {'start':>6s} {'window':>6s} {'clip':>6s} {'tempo':>5s}  text")
    if args.dry_run:
        for p in plan:
            print(f"{p['i']:4d} {p['start']:6.2f} {p['window']:6.2f}      ?     ?  {p['text']}")
        return

    # batch-synthesize every line missing its raw clip (one model load)
    todo = [p for p in plan
            if args.force or not os.path.exists(p["raw"])]
    if todo:
        print(f"synthesizing {len(todo)} line(s) with local Kokoro…")
        durations = synthesize_batch(
            [{"id": str(p["i"]), "text": p["text"], "out": p["raw"]} for p in todo],
            voice, args.speed)
        for p in todo:
            print(f"    line {p['i']}: {durations[str(p['i'])]:.2f}s")

    fitted = []  # (path, start_sec, fitted_dur, tempo)
    for p in plan:
        dur = probe_duration(p["raw"])
        tempo = 1.0
        if dur > p["window"]:
            tempo = min(MAX_ATEMPO, dur / p["window"])
        if args.force or not os.path.exists(p["fit"]):
            run(["ffmpeg", "-y", "-v", "error", "-i", p["raw"],
                 "-filter:a", f"atempo={tempo:.4f}", "-ar", "44100", "-ac", "2", p["fit"]])
        fdur = probe_duration(p["fit"])
        overflow = " OVERFLOW" if fdur > p["window"] + 0.05 else ""
        print(f"{p['i']:4d} {p['start']:6.2f} {p['window']:6.2f} {fdur:6.2f} {tempo:5.2f}  {p['text']}{overflow}")

        line = vo[p["i"]]
        line["end"] = round(p["start"] + fdur, 2)
        # word times: synthesized from the RAW clip, scaled by the tempo fit, offset to global
        raw_words = estimate_words(p["text"], dur)
        line["words"] = [{"w": w["w"],
                          "start": round(p["start"] + w["start"] / tempo, 3),
                          "end": round(p["start"] + w["end"] / tempo, 3)} for w in raw_words]
        fitted.append((p["fit"], p["start"], fdur, tempo))

    # assemble: delay each line to its start, sum (lines never overlap), pad to length
    voice_wav = os.path.join(vdir, "voice.wav")
    inputs, parts = [], []
    for j, (path, start, _d, _t) in enumerate(fitted):
        inputs += ["-i", path]
        ms = int(round(start * 1000))
        parts.append(f"[{j}:a]adelay={ms}|{ms}[a{j}]")
    chain = "".join(f"[a{j}]" for j in range(len(fitted)))
    fc = ";".join(parts) + f";{chain}amix=inputs={len(fitted)}:normalize=0,apad,atrim=0:{total}," \
         f"loudnorm=I=-16:TP=-1.5:LRA=11[out]"
    run(["ffmpeg", "-y", "-v", "error", *inputs, "-filter_complex", fc,
         "-map", "[out]", "-ar", "44100", "-ac", "2", voice_wav])
    print(f"voice track -> {os.path.relpath(voice_wav, ROOT)}")

    beats["voiceStatus"] = f"kokoro:{voice}"
    json.dump(beats, open(beats_path, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
    print(f"actual line timings + word maps written back -> {os.path.relpath(beats_path, ROOT)}")

    if args.emit_ts:
        emit_ts(vo, rp := os.path.abspath(args.emit_ts))
        print(f"VO TS module -> {os.path.relpath(rp, ROOT)}")

    if args.mux:
        out = os.path.splitext(args.mux)[0] + "-voiced.mp4"
        run(["ffmpeg", "-y", "-v", "error", "-i", args.mux, "-i", voice_wav,
             "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
             "-t", str(total), out])
        print(f"voiced preview -> {os.path.relpath(out, ROOT)}")


if __name__ == "__main__":
    main()
