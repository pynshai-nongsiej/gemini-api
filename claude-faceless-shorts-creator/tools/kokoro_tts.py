#!/usr/bin/env python3
"""
kokoro_tts.py — local Kokoro ONNX TTS bridge (batch mode).

Self-contained, env-driven replacement for cloud TTS in this repo:
  KOKORO_MODEL_PATH   path to kokoro-v1.0.onnx
  KOKORO_VOICES_PATH  path to voices-v1.0.bin
  KOKORO_VOICE        default voice id (e.g. bm_george)
  KOKORO_SPEED        default speed multiplier (default 1.0)

Modes:
  --batch_file batch.json   ONE model load, N clips. batch.json is a list of
                            {"id", "text", "out", "voice"?, "speed"?} objects.
                            Writes each WAV and prints a JSON result envelope:
                            {"status": "ready", "clips": [{"id","path","duration","voice"}]}
  --list_voices             list available voice ids as JSON

Requires: kokoro_onnx, numpy, soundfile (pip install kokoro_onnx soundfile).
ffmpeg is NOT needed here (WAV output; callers re-encode).
"""
import argparse
import json
import os
import sys

import numpy as np
import soundfile as sf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Model discovery: env first, then well-known local locations.
_WELL_KNOWN = [
    os.path.expanduser("~/Mark-XXX/models/kokoro"),
    os.path.expanduser("~/models/kokoro"),
    os.path.join(ROOT, "models", "kokoro"),
]


def _resolve(default_name, env_key, must_exist):
    p = os.environ.get(env_key, "").strip()
    if p and os.path.exists(p):
        return p
    if p:
        print(json.dumps({"status": "error",
                          "error": f"{env_key}={p} not found"}), file=sys.stderr)
        sys.exit(1)
    for d in _WELL_KNOWN:
        c = os.path.join(d, default_name)
        if os.path.exists(c):
            return c
    if must_exist:
        print(json.dumps({"status": "error",
                          "error": f"Kokoro model file not found; set {env_key}"}), file=sys.stderr)
        sys.exit(1)
    return None


def main():
    ap = argparse.ArgumentParser(description="Local Kokoro TTS bridge (batch mode)")
    ap.add_argument("--batch_file", help="JSON list of {id,text,out,voice,speed}")
    ap.add_argument("--list_voices", action="store_true")
    ap.add_argument("--model", default=None, help="override model path")
    ap.add_argument("--voices_bin", default=None, help="override voices.bin path")
    args = ap.parse_args()

    model = args.model or _resolve("kokoro-v1.0.onnx", "KOKORO_MODEL_PATH", True)
    voices_bin = args.voices_bin or _resolve("voices-v1.0.bin", "KOKORO_VOICES_PATH", True)

    from kokoro_onnx import Kokoro  # deferred: heavy import
    kokoro = Kokoro(model, voices_bin)
    available = kokoro.get_voices()

    if args.list_voices:
        print(json.dumps({"status": "ready", "voices": available, "count": len(available)}))
        return

    if not args.batch_file:
        print(json.dumps({"status": "error", "error": "--batch_file or --list_voices required"}),
              file=sys.stderr)
        sys.exit(1)

    with open(args.batch_file, encoding="utf-8") as f:
        batch = json.load(f)
    if not isinstance(batch, list) or not batch:
        print(json.dumps({"status": "error", "error": "batch file must be a non-empty list"}),
              file=sys.stderr)
        sys.exit(1)

    default_voice = os.environ.get("KOKORO_VOICE", "bm_george")
    default_speed = float(os.environ.get("KOKORO_SPEED", "1.0"))

    clips, errors = [], []
    for item in batch:
        cid = item.get("id") or f"clip{len(clips)}"
        text = (item.get("text") or "").strip()
        out = item.get("out")
        if not text or not out:
            errors.append({"id": cid, "error": "missing text or out"})
            continue
        voice = item.get("voice") or default_voice
        if voice not in available:
            fallback = "bm_george" if "bm_george" in available else available[0]
            print(f"warning: voice '{voice}' unavailable; using '{fallback}'", file=sys.stderr)
            voice = fallback
        speed = float(item.get("speed", default_speed))
        # British voices need the en-gb phoneme pack
        lang = "en-gb" if voice.startswith("b") else "en-us"
        try:
            samples, sr = kokoro.create(text, voice=voice, speed=speed, lang=lang)
            os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
            sf.write(out, samples, sr)
            clips.append({
                "id": cid,
                "path": os.path.abspath(out),
                "duration": round(len(samples) / float(sr), 3),
                "voice": voice,
                "sample_rate": sr,
            })
        except Exception as e:  # noqa: BLE001 — report per-clip, keep the batch going
            errors.append({"id": cid, "error": str(e)})

    status = "ready" if clips and not errors else ("partial" if clips else "error")
    print(json.dumps({"status": status, "clips": clips, "errors": errors}))
    if not clips:
        sys.exit(1)


if __name__ == "__main__":
    main()
