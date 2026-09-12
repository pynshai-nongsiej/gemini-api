#!/usr/bin/env python3
"""
qc_check.py — the final quality gate (structural checks only, no AI vision).

Verifies the finished short is actually publishable:
  - final mp4 exists and is a playable video (ffprobe)
  - duration inside the 15-60s Shorts window
  - voice track was generated
  - every beat has its image asset on disk

Writes shorts/<id>/qc-report.json and prints a QC:REPORT line for the operator.
Exit codes: 0 = pass, 3 = flagged (video is kept, but publisher.js blocks it).

Usage:
  python tools/qc_check.py --short-dir shorts/auto-7-foo
  python tools/qc_check.py --short-dir ... --video path.mp4   # override final
"""
import argparse
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def probe_duration(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", path],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    try:
        return float(out.stdout.strip())
    except ValueError:
        return None


def run_qc(short_dir, video=None):
    short_dir = os.path.abspath(short_dir)
    proj_id = os.path.basename(short_dir.rstrip("/"))
    beats_path = os.path.join(short_dir, "beats.json")
    beats = json.load(open(beats_path, encoding="utf-8"))
    total = float(beats["format"]["durationSec"])

    final = video or os.path.join(short_dir, "output", f"{proj_id}-final.mp4")
    report = {"proj_id": proj_id, "video": final, "duration": total,
              "checks": {}, "issues": [], "verdict": "pass"}

    # final mp4 exists and is a playable video
    dur = probe_duration(final) if os.path.exists(final) else None
    if dur is None:
        report["verdict"] = "flag"
        report["issues"].append("final video missing or not a playable mp4")
    else:
        # LONG-FORM (16:9 landscape): 1-30min window; shorts (9:16): 15-60s
        is_long = beats.get("format", {}).get("width", 1080) > beats.get("format", {}).get("height", 1920)
        in_window = (60 <= dur <= 1800) if is_long else (14.5 <= dur <= 61)
        if not in_window:
            report["verdict"] = "flag"
            window = "1-30min long-form" if is_long else "15-60s Shorts"
            report["issues"].append(f"duration {dur:.1f}s outside the {window} window")
    report["checks"]["duration"] = round(dur, 2) if dur else None

    # TEMPLATE-FINGERPRINT guard (inauthentic-content policy): compare this
    # project's shape against the channel's recent siblings. Similarity here
    # is a WARNING (never a publish block) — it surfaces in the operator log
    # so humans can rotate angles before the channel starts looking templated.
    try:
        import glob as _glob
        siblings = []
        base = os.path.dirname(proj_dir)
        for other in sorted(_glob.glob(os.path.join(base, "*", "beats.json")), reverse=True)[:12]:
            op = os.path.dirname(other)
            if op == proj_dir:
                continue
            try:
                ob = json.load(open(other, encoding="utf-8"))
                siblings.append({
                    "id": os.path.basename(op),
                    "lines": len(ob.get("vo", [])),
                    "hook3": " ".join(ob["vo"][0]["text"].lower().split()[:3]),
                    "accent": ob.get("accent") or (json.load(open(os.path.join(op, "qc-report.json"))) or {}).get("accent"),
                })
            except Exception:
                continue
        if siblings:
            same_lines = sum(1 for s in siblings if s["lines"] == len(beats.get("vo", [])))
            same_hook = sum(1 for s in siblings if s["hook3"] == " ".join(beats["vo"][0]["text"].lower().split()[:3]))
            report["warnings"] = []
            if same_lines >= 4:
                report["warnings"].append(f"line count matches {same_lines}/{len(siblings)} recent siblings — vary script length")
            if same_hook >= 2:
                report["warnings"].append(f"{same_hook} recent siblings open with the same three words — rotate the hook angle")
            if report["warnings"]:
                print(f"    repetitive-content warnings: {' | '.join(report['warnings'])}")
    except Exception:
        pass

    # voice track
    if beats.get("voiceStatus", "").startswith("pending"):
        report["verdict"] = "flag"
        report["issues"].append("voice track was never generated")

    # beat assets
    media_dir = os.path.join(ROOT, "media", "projects", proj_id)
    n_imgs = len([f for f in os.listdir(media_dir)
                  if not f.endswith(".json") and not f.endswith(".mp4")]) \
        if os.path.isdir(media_dir) else 0
    if n_imgs < max(2, len(beats.get("vo", []))):
        report["verdict"] = "flag"
        report["issues"].append(
            f"only {n_imgs} beat assets on disk for {len(beats.get('vo', []))} lines")

    out_path = os.path.join(short_dir, "qc-report.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
        f.write("\n")

    print(json.dumps({"QC:REPORT": report}, ensure_ascii=False))
    print(f"QC verdict: {report['verdict'].upper()}  "
          f"({len(report['issues'])} issue(s)) -> {os.path.relpath(out_path, ROOT)}")
    return 0 if report["verdict"] == "pass" else 3


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--short-dir", required=True)
    ap.add_argument("--video", default=None, help="override final video path")
    ap.add_argument("--no-vision", action="store_true",
                    help="accepted for compatibility; vision QC was removed")
    args = ap.parse_args()
    sys.exit(run_qc(args.short_dir, args.video))


if __name__ == "__main__":
    main()
