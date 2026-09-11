#!/usr/bin/env python3
"""
enhance_image.py — rescue + restore beat images instead of discarding them.

POLICY: a low-resolution or soft image is never thrown away. Every image is
brought up to the composition target so the render never upscales on screen:

  1. LANCZOS upscale (capped) so the image COVERS 1080x1920 at scale 1.0
     (Ken Burns adds its own zoom margin on top)
  2. unsharp-mask detail restoration after the upscale
  3. tiny saturation/contrast lift to counter upscale flatness

Used by:
  - tools/gen_image.py   (Pollinations silently downscales to ~576x1024 —
                          validated + enhanced in place before writing)
  - tools/make_short.py  (NASA assets arrive at any size — enhanced to cover)

CLI (for debugging / one-off rescues):
  python tools/enhance_image.py --in img.jpg --target 1080x1920 [--out img.jpg]
"""
import argparse
import json
import os
import sys
import time

try:
    from PIL import Image, ImageEnhance, ImageFilter
except ImportError:  # pragma: no cover
    sys.exit("Pillow required: pip install Pillow")

# Never upscale more than this in one pass — beyond ~4x, detail is fiction and
# the unsharp pass starts inventing halos. (Generation retries handle true
# garbage; this module only handles "good image, wrong size".)
MAX_UPSCALE = 4.0

# comfortably above the 1080x1920 composition frame (Ken Burns base zoom >= 1.06
# crops into the image, so "just covers 1080x1920" would re-upscale on screen)
TARGET_LONG_EDGE = 2100


def image_size(path):
    """Actual pixel dimensions of an image file, or None if unreadable."""
    try:
        with Image.open(path) as im:
            return im.size  # (w, h)
    except Exception:  # noqa: BLE001 — unreadable files are handled by callers
        return None


def enhance_for_cover(path, target_w=1080, target_h=1920, in_place=True, out=None):
    """Bring an image up to the composition target. NEVER fails the pipeline:
    returns a report dict and always leaves a usable image at `path` (or `out`).

    The needed scale factor is max(target_w/w, target_h/h) — the 'cover' fit —
    times a small safety margin. Images already large enough are left as-is
    (format-normalized only).
    """
    path = os.path.abspath(path)
    size = image_size(path)
    if not size:
        return {"enhanced": False, "error": "unreadable image"}
    w, h = size
    need = max(target_w / max(1, w), target_h / max(1, h)) * 1.04
    need = min(need, MAX_UPSCALE)

    out_path = os.path.abspath(out) if out else path
    report = {"enhanced": False, "original": [w, h], "factor": round(need, 3)}

    if need <= 1.0 and w >= target_w and h >= target_h:
        # already big enough — normalize bytes in place only if out differs
        if out_path != path:
            os.makedirs(os.path.dirname(out_path), exist_ok=True)
            with Image.open(path) as im:
                im.convert("RGB").save(out_path, quality=92)
        report["final"] = [w, h]
        return report

    with Image.open(path) as im:
        im = im.convert("RGB")
        # big factors in one LANCZOS pass look plasticky; step in <=2x jumps
        cur_w, cur_h = im.size
        remaining = need
        while remaining > 1.001:
            step = min(2.0, remaining)
            im = im.resize((round(cur_w * step), round(cur_h * step)), Image.LANCZOS)
            cur_w, cur_h = im.size
            remaining /= step
            # mid-step detail restore keeps large upscales from going soft
            if remaining > 1.001:
                im = im.filter(ImageFilter.UnsharpMask(radius=1.4, percent=55, threshold=2))
        im = im.filter(ImageFilter.UnsharpMask(radius=2.0, percent=90, threshold=2))
        im = ImageEnhance.Color(im).enhance(1.05)
        im = ImageEnhance.Contrast(im).enhance(1.02)
        os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
        im.save(out_path, quality=92)

    report.update({
        "enhanced": True,
        "final": list(image_size(out_path) or (cur_w, cur_h)),
        "method": "lanczos-stepped+unsharp",
    })
    return report


def update_sidecar(image_path, report):
    """Record the enhancement honestly next to the image (gen_image sidecars)."""
    sidecar = os.path.splitext(image_path)[0] + ".json"
    data = {}
    if os.path.exists(sidecar):
        try:
            data = json.load(open(sidecar, encoding="utf-8"))
        except ValueError:
            data = {}
    if report.get("enhanced"):
        data["delivered_width"], data["delivered_height"] = report["final"]
        data["enhanced"] = {
            "from": report.get("original"), "factor": report.get("factor"),
            "method": report.get("method"),
            "at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        }
    with open(sidecar, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")


def main():
    ap = argparse.ArgumentParser(description="Enhance (never discard) a beat image")
    ap.add_argument("--in", dest="inp", required=True)
    ap.add_argument("--target", default="1080x1920")
    ap.add_argument("--out", default=None, help="default: enhance in place")
    args = ap.parse_args()

    tw, th = (int(x) for x in args.target.lower().split("x"))
    size = image_size(args.inp)
    print(f"in: {args.inp} {size[0]}x{size[1]}" if size else f"in: {args.inp} (unreadable)")
    report = enhance_for_cover(args.inp, tw, th, out=args.out)
    print(json.dumps(report, indent=2))
    if report.get("enhanced"):
        update_sidecar(args.out or args.inp, report)
    return 0


if __name__ == "__main__":
    sys.exit(main())
