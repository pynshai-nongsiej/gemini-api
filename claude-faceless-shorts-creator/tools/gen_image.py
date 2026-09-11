#!/usr/bin/env python3
"""
gen_image.py — in-video AI images via LOCAL/FREE generation (Pollinations FLUX).

Local rewrite of the Gemini image step (same CLI contract): generates an
illustration/atmosphere/still frame for a video beat, saves PNG/JPG + a sidecar
.json (prompt, engine, seed, size) so any render can be reproduced or re-rolled.

Engine: https://image.pollinations.ai — free, keyless FLUX generation.
  model presets:  pro -> flux (full quality)
                  fast -> flux
                  lite -> turbo (faster, cheaper draft look)

RELIABILITY (the "image not working" fix):
  - 3 attempts with exponential backoff (4s / 12s) on 429 / 5xx / timeouts
  - simplified-prompt retry after the full-prompt attempts fail
  - response validation: content-type is an image, magic bytes JPEG/PNG/WebP,
    minimum size 4KB — never writes a broken file
  - deterministic --seed support (same seed + prompt = same image)

Usage:
  python tools/gen_image.py --prompt "..." --out shorts/ch-1-rate-limiting/assets/night.png
  python tools/gen_image.py --prompt-file p.txt --model pro --aspect 9:16 --out x.png
  --aspect 9:16 (default, vertical shorts) | 16:9 | 1:1 ...   --size 1K|2K|4K (default 1K)
  --seed N   --dry-run   (--ref is accepted but unsupported by the free engine -> noted)

No API key needed. Set POLLINATIONS_MODEL in .env to override the default engine.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PRESETS = {"pro": "flux", "fast": "flux", "lite": "turbo"}
DEFAULT_MODEL = "fast"
BASE = "https://image.pollinations.ai/prompt"

# long edge (px) per --size tier; the short edge follows the aspect ratio
SIZE_EDGE = {"1K": 1920, "2K": 2560, "4K": 3840}
MAGIC = {b"\xff\xd8\xff": "jpeg", b"\x89PNG": "png", b"RIFF": "webp"}


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


def get_arg(args, name, default=None):
    return args[args.index(name) + 1] if name in args else default


def get_args_multi(args, name):
    return [args[i + 1] for i, a in enumerate(args) if a == name]


def rel(p):
    try:
        return os.path.relpath(p, ROOT)
    except ValueError:
        return p


def dims_for(aspect, size):
    """aspect 'W:H' + size tier -> pixel dims (even numbers)."""
    try:
        aw, ah = (float(x) for x in aspect.split(":"))
    except ValueError:
        aw, ah = 9.0, 16.0
    long_edge = SIZE_EDGE.get(size.upper(), 1920)
    if aw >= ah:
        w, h = long_edge, round(long_edge * ah / aw)
    else:
        h, w = long_edge, round(long_edge * aw / ah)
    return (w - w % 2, h - h % 2)


def sniff_format(data):
    for magic, fmt in MAGIC.items():
        if data[:len(magic)] == magic:
            return fmt
    return None


def fetch_image(url, timeout):
    req = urllib.request.Request(url, headers={"User-Agent": "faceless-shorts-creator/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        ctype = r.headers.get("Content-Type", "")
        data = r.read()
    return ctype, data


def try_generate(prompt, model, width, height, seed, attempts=3, timeout=90):
    """Fetch with retries + backoff. Returns (format, bytes) or raises the last error."""
    q = urllib.parse.quote(prompt, safe="")
    params = f"?width={width}&height={height}&model={model}&nologo=true"
    if seed is not None:
        params += f"&seed={seed}"
    url = f"{BASE}/{q}{params}"

    last = None
    for attempt in range(1, attempts + 1):
        try:
            ctype, data = fetch_image(url, timeout)
            fmt = sniff_format(data)
            if fmt is None:
                raise RuntimeError(f"response is not an image (content-type {ctype}, {len(data)}B)")
            if len(data) < 4096:
                raise RuntimeError(f"suspiciously small image ({len(data)}B)")
            return fmt, data
        except (urllib.error.HTTPError, urllib.error.URLError, RuntimeError, TimeoutError, OSError) as e:
            code = getattr(e, "code", None)
            last = e
            if attempt < attempts:
                wait = 4 * (3 ** (attempt - 1))  # 4s, 12s
                print(f"    attempt {attempt} failed ({code or type(e).__name__}: {e}); retrying in {wait}s…")
                time.sleep(wait)
    raise last


def main():
    args = sys.argv[1:]
    dry = "--dry-run" in args

    prompt = get_arg(args, "--prompt")
    pf = get_arg(args, "--prompt-file")
    if pf:
        prompt = open(pf, encoding="utf-8").read()
    out = get_arg(args, "--out")
    if not prompt or not out:
        sys.exit("need --prompt/--prompt-file and --out (see file header)")

    model = PRESETS.get(get_arg(args, "--model", DEFAULT_MODEL), get_arg(args, "--model", DEFAULT_MODEL))
    env_model = load_env().get("POLLINATIONS_MODEL", "").strip()
    if env_model:
        model = PRESETS.get(env_model, env_model)
    aspect = get_arg(args, "--aspect", "9:16")
    size = get_arg(args, "--size", "1K")
    seed = get_arg(args, "--seed")
    seed = int(seed) if seed is not None else None
    refs = [r for r in get_args_multi(args, "--ref") if os.path.exists(r)]
    width, height = dims_for(aspect, size)

    print(f"engine=pollinations  model={model}  aspect={aspect} ({width}x{height})  seed={seed}")
    if refs:
        print(f"refs ({len(refs)}): note — the free engine is text-only; reference style hints were NOT sent:")
        print("  ", ", ".join(rel(r) for r in refs))
    print(f"out -> {rel(out)}")
    if dry:
        print("[dry-run] validated; no network call.")
        return

    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)

    # 1) full prompt with retries + backoff
    try:
        fmt, data = try_generate(prompt, model, width, height, seed)
    except Exception as e:  # noqa: BLE001 — fall through to the simplified retry
        print(f"    full-prompt generation failed: {e}")
        # 2) simplified prompt, fresh seed, one more set of attempts
        simple = f"{prompt.split('.')[0]}. clean illustration, high detail, no text, no watermark"
        try:
            print("    retrying with simplified prompt…")
            fmt, data = try_generate(simple, model, width, height,
                                     seed + 1 if seed is not None else None, attempts=2)
        except Exception as e2:  # noqa: BLE001
            sys.exit(f"image generation failed after all retries: {e2}")

    # keep the extension honest with what came back
    want_ext = ".png" if fmt == "png" else (".webp" if fmt == "webp" else ".jpg")
    if os.path.splitext(out)[1].lower() != want_ext:
        out = os.path.splitext(out)[0] + want_ext
    with open(out, "wb") as f:
        f.write(data)
    print(f"  {fmt}  -> {rel(out)}  ({len(data) // 1024}KB)")

    # the free engine often ignores the requested size (e.g. returns 576x1024 for
    # a 1080x1920 request) — verify ACTUAL pixels and enhance, never discard
    from enhance_image import enhance_for_cover, image_size, update_sidecar

    actual = image_size(out)
    delivered_w, delivered_h = actual or (width, height)
    if actual and (actual[0] < width or actual[1] < height):
        print(f"  engine delivered {actual[0]}x{actual[1]} (requested {width}x{height}) — enhancing")
        report = enhance_for_cover(out, target_w=width, target_h=height)
        delivered_w, delivered_h = report.get("final") or (actual[0], actual[1])
        if report.get("enhanced"):
            print(f"  enhanced {report['original']} -> {report['final']} "
                  f"(x{report.get('factor')}, {report.get('method')})")

    sidecar = os.path.splitext(out)[0] + ".json"
    with open(sidecar, "w", encoding="utf-8") as f:
        json.dump({"prompt": prompt, "engine": "pollinations", "model": model,
                   "aspect_ratio": aspect, "image_size": size, "width": width,
                   "height": height, "seed": seed,
                   "delivered_width": delivered_w, "delivered_height": delivered_h,
                   "created": time.strftime("%Y-%m-%dT%H:%M:%S")}, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print(f"  meta -> {rel(sidecar)}")


if __name__ == "__main__":
    main()
