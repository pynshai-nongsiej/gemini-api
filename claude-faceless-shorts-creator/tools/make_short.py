#!/usr/bin/env python3
"""
make_short.py — END-TO-END local shorts factory (the "youtube agent" pipeline).

One command, fully local, zero paid APIs:
  topic -> script+beats (local AI via web2api proxy) -> beat imagery (pipeline
  strategy: real archives first, AI fallback) -> voice (local Kokoro TTS,
  word-synced) -> auto-generated Remotion composition (pipeline edit format)
  -> render -> mux voice -> SFX mix from the shared library -> optional music
  bed -> final mp4.

PIPELINES (--pipeline):
  space    original six-beat grammar; NASA Image Library FIRST, AI fallback;
           Ken Burns + word-pop captions
  finance  diagnostic numeric grammar (gen_script_finance.py); AI background
           plates + kinetic data-graphics layer (counter/bars/percent/rule)
  history  evidence-first grammar (gen_script_history.py); ARCHIVE-FIRST
           imagery (Wikimedia Commons, Library of Congress, Openverse, Met)
           + archive.org public-domain footage for motion beats, film grade +
           on-screen date/source tags; AI era-consistent fallback

Usage:
  python tools/make_short.py --topic "why neutron stars spin 700 times a second"
  python tools/make_short.py --topic "..." --pipeline finance --style "..."
  python tools/make_short.py --topic "..." --pipeline history --voice am_onyx
  python tools/make_short.py --resume shorts/auto-1-neutron-stars   # skip done steps

Artifacts (same layout as the hand-made shorts):
  shorts/<id>/            script.md, beats.json, sfx-plan.json, voice/, output/
  media/projects/<id>/    beat images (+ images.json provenance manifest)
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

from gen_script import CAMERA_MOVES, slugify  # noqa: E402

def transition_for(next_beat, i, pipeline):
    """Mirror of remotion/lib/transitions.tsx `transitionFor` (kept in sync).
    Returns None where the pipeline stays soft (space setup/quiz crossfades)."""
    if pipeline == "space":
        if next_beat == "reveal":
            return "flare"
        if next_beat == "twist":
            return "whip-pan"
        return None
    if next_beat == "reveal":
        return "rewind" if pipeline == "history" else "flash"
    if next_beat == "twist":
        return "wipe" if pipeline == "history" else "glitch"
    return ["whip-pan", "wipe", "whip-pan", "glitch"][i % 4]

FPS = 30
ACCENTS = ["#f5d76e", "#7dd3fc", "#a78bfa", "#fda4af", "#86efac"]
PIPELINES = ["space", "finance", "history"]
PROJ_PREFIX = {"space": "auto", "finance": "fin", "history": "hist"}

# progressive camera-intensity curve: calm approach -> building -> payoff
CAMERA_INTENSITY = {"hook": 0.5, "quiz": 0.75, "reveal": 1.2, "twist": 1.15, "loop": 0.7}
CAMERA_FALLBACK = ["push-in", "orbit-right", "drift-up", "pan-left", "orbit-left", "pull-back"]


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


def camera_for(v, i, n):
    """Per-beat (move, intensity): the model's camera token, else a deterministic
    fallback; intensity ramps with the beat grammar (hook calm -> reveal peaks)."""
    move = v.get("camera") if isinstance(v.get("camera"), str) else ""
    if move not in CAMERA_MOVES:
        move = CAMERA_FALLBACK[i % len(CAMERA_FALLBACK)]
    beat = v.get("beat", "")
    if beat in CAMERA_INTENSITY:
        inten = CAMERA_INTENSITY[beat]
    else:
        inten = 0.6 + 0.4 * (i / max(1, n - 1))
    return move, round(inten, 2)

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
    # finance pack (fetched by tools/fetch_sfx.py; used when present)
    (r"cash|register|kaching|ka-ching|money", "cash-register"),
    (r"coin|jingle|change", "coins-drop"),
    (r"card|swipe|payment", "card-swipe"),
    (r"receipt|printer|print", "receipt-print"),
    (r"calculator|calc|keys", "calculator-keys"),
    # history pack
    (r"typewriter|type|document", "typewriter-keys"),
    (r"ding|carriage|return", "typewriter-ding"),
    (r"projector|newsreel|reel|film", "projector-run"),
    (r"shutter|camera|photograph", "camera-shutter"),
    (r"crackle|grain|old", "film-crinkle"),
    (r"desk bell|counter|hotel", "bell-desk"),
    # transition pack
    (r"whip|fast cut|hard cut", "transition-whip"),
    (r"drop|sub|bass", "transition-drop"),
    (r"boom|cinematic", "transition-boom"),
    (r"rewind|reverse", "transition-rewind"),
    (r"riser|cinematic rise", "riser-cinematic"),
    (r"heartbeat|pulse", "heartbeat-soft"),
    (r"paper|slide|rustle", "paper-slide"),
    # space-flavored hints (Cosmic Archive)
    (r"flare|light leak|sun|burst|glare|shockwave", "warm-shimmer"),
    (r"sonar|scan|radar|ping|hum|signal|radio", "scan-hum"),
    (r"void|drone|eerie|ominous|haunting", "scan-hum"),
    (r"thruster|engine|launch|rocket", "launch-thump"),
    (r"sub bass|sub drop|deep drop", "transition-drop"),
]

# sounds the AUTOMATED pipeline must never use (transition-whip removed by
# user request — it cuts over the voice). Manual/hand-built plans may differ.
EXCLUDED_SFX = {"transition-whip"}

# transition kind -> cut-cue fallback chain (first one present in the library
# wins); second element is the pipeline default beat-change cue
TRANSITION_SFX = {
    "whip-pan": (("transition-whip", "whoosh-soft"), "whoosh-soft"),
    "flash": (("transition-boom", "impact-deep-soft", "pop-reveal"), "pop-reveal"),
    "glitch": (("glitch-zap",), "ui-click-soft"),
    "wipe": (("paper-slide", "whoosh-soft"), "whoosh-soft"),
    "rewind": (("transition-rewind", "whoosh-reverse", "whoosh-soft"), "whoosh-reverse"),
    "flare": (("transition-boom", "impact-deep-soft", "warm-shimmer"), "warm-shimmer"),
}
PIPELINE_CUT_SFX = {"space": "whoosh-soft", "finance": "ui-click-soft", "history": "paper-slide"}
# per-pipeline punctuation that has no visual-transition twin
PIPELINE_ACCENT_SFX = {
    "space": {"loop": ("sparkle-soft", -14, "loop shimmer back to hook")},
    "finance": {"loop": ("coins-drop", -14, "loop coin back to hook")},
    "history": {"loop": ("page-flip", -14, "loop page back to hook")},
}


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


def next_index(prefix="auto"):
    n = 0
    shorts_dir = os.path.join(ROOT, "shorts")
    if os.path.isdir(shorts_dir):
        for d in os.listdir(shorts_dir):
            m = re.match(r"(?:auto|fin|hist)-(\d+)", d)
            if m and d.startswith(prefix):
                n = max(n, int(m.group(1)))
    return n + 1


def gen_images(pipeline, beats, proj_dir, media_dir, size):
    """Pipeline dispatch: real-archive-first for space & history, AI plates for
    finance. Writes media/projects/<id>/images.json — the provenance manifest
    the operator UI reads to badge each beat."""
    if pipeline == "finance":
        return gen_images_finance(beats, proj_dir, media_dir, size)
    if pipeline == "history":
        return gen_images_history(beats, proj_dir, media_dir, size)
    return gen_images_space(beats, proj_dir, media_dir, size)


def _manifest_init(media_dir):
    manifest_path = os.path.join(media_dir, "images.json")
    manifest = []
    if os.path.exists(manifest_path):
        try:
            manifest = json.load(open(manifest_path, encoding="utf-8"))
        except ValueError:
            manifest = []
    return manifest_path, manifest


def _manifest_finish(manifest_path, manifest, beats, srcs):
    while len(manifest) < len(beats["vo"]):
        manifest.append({"beat": "?", "source": "unknown"})
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest[:len(beats["vo"])], f, indent=2, ensure_ascii=False)
        f.write("\n")
    counts = {}
    for m in manifest:
        s = m.get("source") or "unknown"
        counts[s] = counts.get(s, 0) + 1
    real = sum(v for k, v in counts.items() if k != "ai")
    print(f"    assets: {real}/{len(manifest)} real archives ({counts}), "
          f"{counts.get('ai', 0)} AI")
    return counts, real


def _fetch_second_image(pipeline, v, media_dir, stem, entry, exclude_urls, beats, size):
    """Second image for a micro-cut beat (the composition hard-cuts to it
    mid-line). Real archive second hit first (exclude_urls forces a DIFFERENT
    asset); AI 'alternate angle' as fallback. Writes entry['src_b'] and returns
    the staticFile-relative path or None."""
    import json as _json
    b_stem = stem + "-b"
    cached = next((f for f in os.listdir(media_dir)
                   if f.startswith(b_stem + ".") and not f.endswith(".json")), None)
    if cached:
        entry["src_b"] = cached
        return f"projects/{os.path.basename(media_dir)}/{cached}"

    out = os.path.join(media_dir, b_stem + ".jpg")
    hit = None
    try:
        if pipeline == "history":
            from archive_media import fetch_archival_image
            hit = fetch_archival_image((v.get("archiveQuery") or "") + " archive photo",
                                       out, exclude_urls=exclude_urls,
                                       fallback_title=beats["title"])
        elif pipeline == "space":
            from nasa_media import fetch_nasa_image
            hit = fetch_nasa_image(v.get("nasaQuery") or v.get("imagePrompt") or beats["title"],
                                   out, exclude_urls=exclude_urls,
                                   fallback_title=beats["title"])
    except Exception as e:  # noqa: BLE001 — second hit is best-effort
        print(f"    b-image: archive error ({e})")
        hit = None

    if hit and os.path.exists(out):
        try:
            from enhance_image import enhance_for_cover
            enhance_for_cover(out, target_w=1080, target_h=1920)
        except Exception:
            pass
        entry["src_b"] = os.path.basename(out)
        entry.setdefault("src_b_info", {"source": hit.get("source"), "title": (hit.get("title") or "")[:80]})
        print(f"    b-image ✓ [{hit.get('source', hit.get('nasa_id') and 'nasa')}] {(hit.get('title') or '')[:50]}")
        return f"projects/{os.path.basename(media_dir)}/{entry['src_b']}"

    # AI alternate-angle fallback
    prompt = (v.get("imagePrompt") or beats["title"]) + ", alternate angle, different framing"
    ai_out = os.path.join(media_dir, b_stem + ".png")
    try:
        sh([sys.executable, "tools/gen_image.py", "--prompt", prompt,
            "--aspect", "9:16", "--size", size, "--out", ai_out])
    except SystemExit:
        return None
    actual = next((f for f in os.listdir(media_dir)
                   if f.startswith(b_stem + ".") and not f.endswith(".json")), None)
    if not actual:
        return None
    entry["src_b"] = actual
    entry["src_b_ai"] = True
    print(f"    b-image: AI alternate angle")
    return f"projects/{os.path.basename(media_dir)}/{actual}"


def gen_images_history(beats, proj_dir, media_dir, size):
    """ARCHIVE-FIRST: Wikimedia Commons / Library of Congress / Openverse / Met
    per beat, with license + creator + year metadata for the on-screen source
    tag. AI fallback is era-consistent (period photograph styling)."""
    os.makedirs(media_dir, exist_ok=True)
    sys.path.insert(0, os.path.join(ROOT, "tools"))
    from archive_media import fetch_archival_image  # local import: heavy only when used
    from enhance_image import enhance_for_cover

    manifest_path, manifest = _manifest_init(media_dir)
    srcs, exclude_urls = [], set()

    for i, v in enumerate(beats["vo"]):
        stem = f"b{i:02d}-{slugify(v.get('beat', 'beat'), 18)}"
        cached = next((f for f in os.listdir(media_dir)
                       if f.startswith(stem + ".") and not f.endswith(".json")
                       and not f.endswith("-clip.mp4")), None)
        needs_b = (float(v.get("end", 0)) - float(v.get("start", 0))) > MICRO_CUT_SECS
        if cached:
            srcs.append(f"projects/{os.path.basename(media_dir)}/{cached}")
            if i < len(manifest):
                manifest[i]["src"] = cached
            # b-image backfill on resume: fetch if this is a micro-cut beat
            # whose second image is missing (archives may have been down before)
            if needs_b and not (i < len(manifest) and manifest[i].get("src_b")):
                entry = manifest[i] if i < len(manifest) else {"stem": stem}
                _fetch_second_image("history", v, media_dir, stem, entry,
                                    exclude_urls, beats, size)
            print(f"    image {i}: cached ({cached})")
            continue

        entry = {"beat": v.get("beat", ""), "stem": stem, "src": None,
                 "source": None, "title": None, "url": None}

        # lines longer than ~2.6s become micro-cut beats: the composition
        # splits them into two shots, so they need a SECOND image (true
        # b-roll variety instead of a camera trick on the same photo)

        # --- 1. real archives first ---
        query = v.get("archiveQuery") or v.get("imagePrompt") or beats["title"]
        out = os.path.join(media_dir, stem + ".arch.jpg")
        try:
            hit = fetch_archival_image(query, out, exclude_urls=exclude_urls,
                                       fallback_title=beats["title"])
        except Exception as e:  # noqa: BLE001 — archives down -> AI fallback
            print(f"    image {i}: archive fetch error ({e}); falling back to AI")
            hit = None
        if hit and os.path.exists(out):
            entry.update(source=hit["source"], src=os.path.basename(out),
                         title=hit.get("title"), url=hit.get("url"),
                         details_url=hit.get("details_url"), query=hit.get("query"),
                         creator=hit.get("creator"), year=hit.get("year"),
                         license=hit.get("license"))
            enh = enhance_for_cover(out, target_w=1080, target_h=1920)
            if enh.get("enhanced"):
                entry["enhanced"] = {"from": enh.get("original"), "factor": enh.get("factor"),
                                     "final": enh.get("final")}
                print(f"    image {i}: enhanced {enh['original']} -> {enh['final']} (x{enh.get('factor')})")
            manifest.append(entry)
            srcs.append(f"projects/{os.path.basename(media_dir)}/{os.path.basename(out)}")
            print(f"    image {i}: ARCHIVE ✓ [{hit['source']}] {hit.get('title', '')[:60]}")
            if needs_b:
                _fetch_second_image("history", v, media_dir, stem, entry, exclude_urls, beats, size)
            continue

        # --- 2. era-consistent AI fallback (all archives missed) ---
        year = v.get("onScreen") or ""
        era = year if re.search(r"\d{4}", year) else ""
        prompt = (v.get("imagePrompt") or query)
        if era:
            prompt += f", period-accurate {era} scene"
        prompt += ", archival documentary photograph, dramatic lighting"
        ai_out = os.path.join(media_dir, stem + ".png")
        print(f"    image {i}: archives ✗ — AI era-fallback: {prompt[:60]}…")
        sh([sys.executable, "tools/gen_image.py", "--prompt", prompt,
            "--aspect", "9:16", "--size", size, "--out", ai_out])
        actual = next((f for f in os.listdir(media_dir)
                       if f.startswith(stem + ".") and not f.endswith(".json")
                       and not f.endswith("-clip.mp4")), None)
        if not actual:
            sys.exit(f"image {i} did not land in {media_dir}")
        entry.update(source="ai", src=actual, title=f"AI period visualization — {prompt[:80]}")
        manifest.append(entry)
        srcs.append(f"projects/{os.path.basename(media_dir)}/{actual}")
        if needs_b:
            _fetch_second_image("history", v, media_dir, stem, entry, exclude_urls, beats, size)

    counts, real = _manifest_finish(manifest_path, manifest, beats, srcs)
    return srcs


def gen_images_finance(beats, proj_dir, media_dir, size):
    """FINANCE edit format: the numbers are rendered by the Remotion data-graphic
    layer (counters/bars/percent dials) — each beat only needs an AI background
    plate behind the graphics (dark, atmospheric, text-free)."""
    os.makedirs(media_dir, exist_ok=True)

    manifest_path, manifest = _manifest_init(media_dir)
    srcs = []

    for i, v in enumerate(beats["vo"]):
        stem = f"b{i:02d}-{slugify(v.get('beat', 'beat'), 18)}"
        cached = next((f for f in os.listdir(media_dir)
                       if f.startswith(stem + ".") and not f.endswith(".json")
                       and not f.endswith("-clip.mp4")), None)
        if cached:
            srcs.append(f"projects/{os.path.basename(media_dir)}/{cached}")
            if i < len(manifest):
                manifest[i]["src"] = cached
            print(f"    plate {i}: cached ({cached})")
            continue

        entry = {"beat": v.get("beat", ""), "stem": stem, "src": None,
                 "source": "ai", "title": None, "url": None}
        # the graphic itself carries the message; the plate sets the mood
        prompt = (v.get("bgPrompt") or v.get("imagePrompt") or
                  f"{beats['title']}, dark atmospheric scene")
        prompt += ", dark moody cinematic lighting, no text, no numbers"
        ai_out = os.path.join(media_dir, stem + ".png")
        print(f"    plate {i}: AI background — {prompt[:60]}…")
        sh([sys.executable, "tools/gen_image.py", "--prompt", prompt,
            "--aspect", "9:16", "--size", size, "--out", ai_out])
        actual = next((f for f in os.listdir(media_dir)
                       if f.startswith(stem + ".") and not f.endswith(".json")
                       and not f.endswith("-clip.mp4")), None)
        if not actual:
            sys.exit(f"plate {i} did not land in {media_dir}")
        entry.update(src=actual, title=f"AI background plate — {prompt[:80]}")
        manifest.append(entry)
        srcs.append(f"projects/{os.path.basename(media_dir)}/{actual}")

    counts, real = _manifest_finish(manifest_path, manifest, beats, srcs)
    return srcs


def gen_images_space(beats, proj_dir, media_dir, size):
    """One image per vo line, NASA-FIRST (real imagery), AI fallback.

    Resolution order per beat:
      1. cached file (any prior run)
      2. NASA Image Library via tools/nasa_media.py (nasaQuery / imagePrompt
         keywords) — real telescope & mission photography
      3. Pollinations FLUX (tools/gen_image.py) — only when NASA has no
         authentic match
    Writes media/projects/<id>/images.json — the asset manifest the operator
    UI reads to badge each beat as NASA or AI.
    """
    os.makedirs(media_dir, exist_ok=True)
    sys.path.insert(0, os.path.join(ROOT, "tools"))
    from nasa_media import fetch_nasa_image  # local import: heavy only when used
    from enhance_image import enhance_for_cover  # rescue low-res sources, never discard

    manifest_path, manifest = _manifest_init(media_dir)

    srcs, exclude_urls = [], set()
    for i, v in enumerate(beats["vo"]):
        stem = f"b{i:02d}-{slugify(v.get('beat', 'beat'), 18)}"
        cached = next((f for f in os.listdir(media_dir)
                       if f.startswith(stem + ".") and not f.endswith(".json")), None)
        needs_b = (float(v.get("end", 0)) - float(v.get("start", 0))) > MICRO_CUT_SECS
        if cached:
            srcs.append(f"projects/{os.path.basename(media_dir)}/{cached}")
            if i < len(manifest):
                manifest[i]["src"] = cached
                exclude_urls.add(manifest[i].get("url", ""))
            if needs_b and not (i < len(manifest) and manifest[i].get("src_b")):
                entry = manifest[i] if i < len(manifest) else {"stem": stem}
                _fetch_second_image("space", v, media_dir, stem, entry,
                                    exclude_urls, beats, size)
            print(f"    image {i}: cached ({cached})")
            continue

        entry = {"beat": v.get("beat", ""), "stem": stem, "src": None,
                 "source": None, "nasa_id": None, "title": None, "url": None}

        # --- 1. NASA first: real imagery when the archive has a match ---
        nasa_query = v.get("nasaQuery") or v.get("imagePrompt") or beats["title"]
        out = os.path.join(media_dir, stem + ".nasa.jpg")
        try:
            hit = fetch_nasa_image(nasa_query, out, exclude_urls=exclude_urls,
                                   fallback_title=beats["title"])
        except Exception as e:  # noqa: BLE001 — NASA down -> AI fallback
            print(f"    image {i}: NASA fetch error ({e}); falling back to AI")
            hit = None
        if hit and os.path.exists(out):
            entry.update(source="nasa", nasa_id=hit.get("nasa_id"),
                         title=hit.get("title"), url=hit.get("url"),
                         details_url=hit.get("details_url"), query=hit.get("query"),
                         src=os.path.basename(out))
            # NASA assets arrive at any size (some 637x361) — bring them up to
            # the composition target instead of letting the render upscale
            enh = enhance_for_cover(out, target_w=1080, target_h=1920)
            if enh.get("enhanced"):
                entry["enhanced"] = {"from": enh.get("original"),
                                     "factor": enh.get("factor"),
                                     "final": enh.get("final")}
                print(f"    image {i}: enhanced {enh['original']} -> {enh['final']} "
                      f"(x{enh.get('factor')})")
            manifest.append(entry)
            srcs.append(f"projects/{os.path.basename(media_dir)}/{os.path.basename(out)}")
            print(f"    image {i}: NASA ✓ {hit.get('title', '')[:60]} ({hit['bytes'] // 1024}KB)")
            if needs_b:
                _fetch_second_image("space", v, media_dir, stem, entry, exclude_urls, beats, size)
            continue

        # --- 2. AI fallback: NASA had no authentic match ---
        prompt = v.get("imagePrompt") or f"{beats['title']}, cinematic scene, dramatic lighting"
        ai_out = os.path.join(media_dir, stem + ".png")
        print(f"    image {i}: NASA ✗ — AI fallback: {prompt[:60]}…")
        sh([sys.executable, "tools/gen_image.py", "--prompt", prompt,
            "--aspect", "9:16", "--size", size, "--out", ai_out])
        actual = next((f for f in os.listdir(media_dir)
                       if f.startswith(stem + ".") and not f.endswith(".json")), None)
        if not actual:
            sys.exit(f"image {i} did not land in {media_dir}")
        entry.update(source="ai", src=actual, title=f"AI visualization — {prompt[:80]}")
        manifest.append(entry)
        srcs.append(f"projects/{os.path.basename(media_dir)}/{actual}")

    counts, real = _manifest_finish(manifest_path, manifest, beats, srcs)
    return srcs


def gen_clips(beats, media_dir, pipeline="space"):
    """Real video clips for the payoff beats flagged motion:true (max 2).
    HISTORY pipeline: archive.org public-domain FOOTAGE first (Prelinger &
    friends, trimmed to 6s), FAL AI clip only when no footage matches.
    Any failure degrades to the Ken Burns still — the pipeline never blocks
    on clips."""
    clips = {}
    archive_ids = set()
    if pipeline == "history":
        sys.path.insert(0, os.path.join(ROOT, "tools"))
        from archive_media import fetch_archival_clip
        for i, v in enumerate(beats["vo"]):
            if not v.get("motion"):
                continue
            stem = f"b{i:02d}-{slugify(v.get('beat', 'beat'), 18)}"
            out = os.path.join(media_dir, stem + "-clip.mp4")
            rel_out = f"projects/{os.path.basename(media_dir)}/{os.path.basename(out)}"
            if os.path.exists(out):
                clips[i] = rel_out
                print(f"    clip {i}: cached")
                continue
            print(f"    clip {i} ({v.get('beat')}): archive.org footage: "
                  f"{v.get('archiveQuery', '')[:60]}…")
            try:
                hit = fetch_archival_clip(v.get("archiveQuery") or v.get("imagePrompt") or
                                          beats["title"], out, max_seconds=6.0,
                                          exclude_ids=archive_ids)
                if hit:
                    archive_ids.add(hit["identifier"])
                    clips[i] = rel_out
                    print(f"    clip {i}: FOOTAGE ✓ [{hit.get('title', '')[:50]}]")
                    continue
            except Exception as e:  # noqa: BLE001 — footage is best-effort
                print(f"    clip {i}: archive footage failed ({str(e)[:100]})")

    if not load_env().get("FAL_KEY", "").strip():
        missing = [i for i, v in enumerate(beats["vo"]) if v.get("motion") and i not in clips]
        if missing:
            print("    FAL_KEY not set — remaining motion beats stay as Ken Burns stills")
        return clips
    for i, v in enumerate(beats["vo"]):
        if not v.get("motion") or i in clips:
            continue
        stem = f"b{i:02d}-{slugify(v.get('beat', 'beat'), 18)}"
        out = os.path.join(media_dir, stem + "-clip.mp4")
        rel_out = f"projects/{os.path.basename(media_dir)}/{os.path.basename(out)}"
        prompt = (f"{v.get('imagePrompt', beats['title'])}. Single continuous "
                  f"documentary shot, camera {v.get('camera', 'push-in')}, "
                  f"cinematic lighting, photoreal, no text, no watermark")
        print(f"    clip {i} ({v.get('beat')}): {prompt[:64]}…")
        try:
            sh([sys.executable, "tools/gen_clip.py", "--prompt", prompt,
                "--aspect", "9:16", "--out", out])
            if os.path.exists(out):
                clips[i] = rel_out
        except SystemExit as e:
            print(f"    clip {i} failed — keeping the still ({str(e)[:120]})")
    return clips


# counter-move for micro-cuts: the second sub-shot inside one voice line gets
# a DIFFERENT camera move (a visible change every ~2-3s — the retention-edit
# standard) instead of one long Ken Burns drift
COUNTER_MOVE = {
    "push-in": "pan-right", "pull-back": "pan-left",
    "orbit-left": "drift-up", "orbit-right": "drift-down",
    "drift-up": "pan-right", "drift-down": "pan-left",
    "pan-left": "push-in", "pan-right": "pull-back",
    "crash-zoom": "settle", "settle": "pan-right",
}
MICRO_CUT_SECS = 2.6  # voice lines longer than this get split into two shots


def _vo_frames(beats, fps):
    """Frame ranges per VO LINE (the narrative grid): each line spans its start
    -> next line start; line 0 owns frame 0 (the hook rule). Overlays (stats,
    date tags, transitions) and SFX cues all key off this grid."""
    total_frames = round(beats["format"]["durationSec"] * fps)
    vo = beats["vo"]
    frames = []
    for i, v in enumerate(vo):
        start_f = 0 if i == 0 else max(0, round(float(v["start"]) * fps) - 2)
        end_f = (round(float(vo[i + 1]["start"]) * fps) - 2) if i + 1 < len(vo) else total_frames
        frames.append({"vo": v, "start": start_f, "end": max(min(end_f, total_frames), start_f + 12)})
    return frames


def _spans(beats, srcs, clips, fps=None, srcs_b=None):
    """VISUAL grid: one or two shots per voice line. Lines longer than
    MICRO_CUT_SECS split at ~45% into a second image (a real second archive
    hit / AI alternate angle when one was fetched, else the same image under a
    counter-move camera) with a hard cut so the eye re-engages mid-line."""
    fps = fps or beats["format"].get("fps", FPS)
    n_vo = max(1, len(beats["vo"]))
    spans = []
    for i, f in enumerate(_vo_frames(beats, fps)):
        v = f["vo"]
        move, inten = camera_for(v, i, n_vo)
        dur_f = f["end"] - f["start"]
        # escalating build-up: cuts ACCELERATE toward the payoff (2.6s early
        # -> 1.9s near the reveal), then the payoff beat breathes whole
        thr = MICRO_CUT_SECS - (0.7 * i / n_vo)
        if v.get("beat") == "reveal":
            thr += 1.2   # the payoff plays whole — no cut inside the drop
        if dur_f > thr * fps:
            mid = f["start"] + round(dur_f * 0.45)
            spans.append({"src": srcs[min(i, len(srcs) - 1)],
                          "start": f["start"], "end": mid,
                          "move": move, "intensity": inten,
                          "clip": clips.get(i), "fadeIn": 0 if i == 0 else 14,
                          "voi": i})
            b = (srcs_b or {}).get(i)
            spans.append({"src": b or srcs[min(i, len(srcs) - 1)],
                          "start": mid, "end": f["end"],
                          "move": COUNTER_MOVE.get(move, "pan-right"),
                          "intensity": round(inten * 0.85, 2),
                          "clip": None, "fadeIn": 0,   # hard cut, no fade
                          "voi": i})
        else:
            spans.append({"src": srcs[min(i, len(srcs) - 1)],
                          "start": f["start"], "end": f["end"],
                          "move": move, "intensity": inten,
                          "clip": clips.get(i), "fadeIn": 0 if i == 0 else 14,
                          "voi": i})
    return spans


def _srcs_b(beats, media_dir):
    """{line_index: staticFile path} for second micro-cut images, from the
    images.json manifest's src_b fields."""
    try:
        manifest = json.load(open(os.path.join(media_dir, "images.json"), encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    out = {}
    for i, m in enumerate(manifest[:len(beats["vo"])]):
        if m.get("src_b"):
            out[i] = f"projects/{os.path.basename(media_dir)}/{m['src_b']}"
    return out


def gen_composition(beats, srcs, clips, comp_id, shot_dir, accent, pipeline="space"):
    """Write the AutoN.tsx Remotion composition from ACTUAL voice timings —
    in the pipeline's edit format. Visual grid may hold micro-cuts (2 shots
    per long line); overlays key off the VO line grid."""
    os.makedirs(shot_dir, exist_ok=True)
    fps = beats["format"].get("fps", FPS)
    total = beats["format"]["durationSec"]
    media_dir = os.path.join(ROOT, "media", "projects", beats["id"])
    spans = _spans(beats, srcs, clips, fps, _srcs_b(beats, media_dir))
    vo_frames = _vo_frames(beats, fps)

    if pipeline == "finance":
        return gen_composition_finance(beats, spans, vo_frames, comp_id, shot_dir, accent, fps, total)
    if pipeline == "history":
        return gen_composition_history(beats, spans, vo_frames, comp_id, shot_dir, accent, fps, total)
    return gen_composition_space(beats, spans, vo_frames, comp_id, shot_dir, accent, fps, total)


def _spans_lit(spans):
    return "\n".join(
        f"  {{ src: '{s['src']}', start: {s['start']}, end: {s['end']}, "
        f"move: '{s['move']}', intensity: {s['intensity']}, "
        f"clip: {("'" + s['clip'] + "'") if s['clip'] else 'null'}, "
        f"fadeIn: {s['fadeIn']} }}," for s in spans)


def gen_composition_space(beats, spans, vo_frames, comp_id, shot_dir, accent, fps, total):
    """SPACE edit format: Ken Burns photos + word-pop captions + a light-leak
    flare on the reveal, whip-pan on the twist; calm beats keep crossfades."""
    beats_lit = _spans_lit(spans)
    trans_lit = _transitions_lit(vo_frames, "space")
    bait = _quiz_bait(vo_frames, "space", fps)
    hook_end = vo_frames[0]["end"] if vo_frames else round(3 * fps)

    tsx = f"""import React from 'react';
import {{ AbsoluteFill, OffthreadVideo, Sequence, staticFile }} from 'remotion';
import {{ Captions, CommentBait, ProgressBar }} from '../../lib/shorts';
import {{ KenBurnsImage, StoryVignette }} from '../../lib/story';
import {{ Transition }} from '../../lib/transitions';
import {{ VO }} from './vo.gen';

// =============================================================================
// AUTO-GENERATED by tools/make_short.py — "{beats['title']}"
// Camera moves + intensity follow the beat grammar (calm -> building -> payoff).
// motion:true beats use archival/AI video when available, Ken Burns otherwise.
// The reveal gets a lens-flare bloom, the twist a whip-pan; numbers/dates
// highlighted in captions.
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

const TRANSITIONS = [
{trans_lit}
] as const;

const BAIT = {json.dumps(bait) if bait else 'null'};

const {comp_id}: React.FC = () => {{
  return (
    <AbsoluteFill style={{{{ background: '#0b0d12' }}}}>
      {{BEATS.map((b, i) => {{
        const isLast = i === BEATS.length - 1;
        const dur = b.end - b.start + (isLast ? 0 : TAIL);
        return (
          <Sequence key={{i}} from={{b.start}} durationInFrames={{dur}}>
            {{b.clip ? (
              <OffthreadVideo src={{staticFile(b.clip)}} muted
                style={{{{ width: '100%', height: '100%', objectFit: 'cover' }}}} />
            ) : (
              <KenBurnsImage src={{b.src}} dur={{dur}} move={{b.move}}
                intensity={{b.intensity}} fadeIn={{b.fadeIn}} />
            )}}
          </Sequence>
        );
      }})}}
      <StoryVignette strength={{0.34}} />
      {{TRANSITIONS.map((t, i) => (
        <Sequence key={{'t' + i}} from={{Math.max(0, t.at - 4)}} durationInFrames={{t.dur}}>
          <Transition kind={{t.kind}} dur={{t.dur}} accent={{ACCENT}} />
        </Sequence>
      ))}}
      {{BAIT && (
        <Sequence from={{BAIT.from}} durationInFrames={{BAIT.end - BAIT.from}}>
          <CommentBait text={{BAIT.text}} accent={{ACCENT}} />
        </Sequence>
      )}}
      <Captions lines={{VO}} y={{1330}} size={{54}} accent={{ACCENT}} maxWords={{5}} plate highlight />
      <ProgressBar color={{ACCENT}} />
    </AbsoluteFill>
  );
}};

export default {comp_id};
"""
    return _write_comp(shot_dir, comp_id, tsx)


BAIT_TEXT = {
    "space": "WHAT IS IT? COMMENT IT",
    "finance": "YOUR NUMBER — COMMENT IT",
    "history": "WHAT BROKE FIRST? COMMENT IT",
}


def _quiz_bait(vo_frames, pipeline, fps):
    """Comment-bait overlay data for the quiz beat: {text, from, end} or None.
    Shows the pill shortly after the quiz line starts, hides before it ends."""
    quiz = next((f for f in vo_frames if f["vo"].get("beat") == "quiz"), None)
    if not quiz:
        return None
    return {
        "text": BAIT_TEXT.get(pipeline, "COMMENT YOUR ANSWER"),
        "from": quiz["start"] + round(0.6 * fps),
        "end": max(quiz["start"] + round(0.6 * fps) + 8, quiz["end"] - round(0.3 * fps)),
    }


def _transitions_lit(vo_frames, pipeline):
    """One overlay per beat change (i>0), kind picked from the incoming beat.
    Space returns None on calm beats — those keep their gentle crossfades."""
    lines = []
    for i, f in enumerate(vo_frames):
        if i == 0:
            continue
        kind = transition_for(f["vo"].get("beat", ""), i, pipeline)
        if kind is None:
            continue
        lines.append(f"  {{ kind: '{kind}', at: {f['start']}, dur: 8 }},")
    return "\n".join(lines)


def gen_composition_finance(beats, spans, vo_frames, comp_id, shot_dir, accent, fps, total):
    """FINANCE edit format: dark AI background plates + a kinetic data-graphic
    layer (counter / comparison bars / percent dial / rule card) + hook card +
    hard transitions + number-highlighted captions."""
    beats_lit = _spans_lit(spans)
    stats_lit = "\n".join(
        f"  {{ graphic: '{f['vo'].get('graphic', 'counter')}', "
        f"value: {json.dumps(str(f['vo'].get('statValue', '')))}, "
        f"label: {json.dumps(str(f['vo'].get('statLabel', '')))}, "
        f"bars: {json.dumps(f['vo'].get('statBars'))}, "
        f"onScreen: {json.dumps(str(f['vo'].get('onScreen', '')))}, "
        f"from: {f['start']}, end: {f['end']} }},"
        for f in vo_frames)
    trans_lit = _transitions_lit(vo_frames, "finance")
    bait = _quiz_bait(vo_frames, "finance", fps)
    hook_card = json.dumps(str(beats.get("hookCard") or beats.get("title") or ""))
    hook_end = vo_frames[0]["end"] if vo_frames else round(3 * fps)

    tsx = f"""import React from 'react';
import {{ AbsoluteFill, OffthreadVideo, Sequence, staticFile }} from 'remotion';
import {{ Captions, ProgressBar }} from '../../lib/shorts';
import {{ KenBurnsImage }} from '../../lib/story';
import {{ StatLayer, HookCard }} from '../../lib/finance';
import {{ CommentBait }} from '../../lib/shorts';
import {{ Transition }} from '../../lib/transitions';
import {{ VO }} from './vo.gen';

// =============================================================================
// AUTO-GENERATED by tools/make_short.py (FINANCE edit format) — "{beats['title']}"
// Dark background plates + kinetic data-graphics (counter/bars/percent/rule),
// hard transitions on every beat change, numbers highlighted in captions.
// =============================================================================
export const compositionConfig = {{
  id: '{comp_id}',
  durationInSeconds: {round(total, 2)},
  fps: {fps},
  width: 1080,
  height: 1920,
}};

const ACCENT = '{accent}';
const TAIL = 20;

const BEATS = [
{beats_lit}
] as const;

const STATS = [
{stats_lit}
] as const;

const TRANSITIONS = [
{trans_lit}
] as const;

const HOOK_CARD = {hook_card};
const HOOK_END = {hook_end};
const BAIT = {json.dumps(bait) if bait else 'null'};
const BAIT = {json.dumps(bait) if bait else 'null'};

const {comp_id}: React.FC = () => {{
  return (
    <AbsoluteFill style={{{{ background: '#0a0c10' }}}}>
      {{BEATS.map((b, i) => {{
        const isLast = i === BEATS.length - 1;
        const dur = b.end - b.start + (isLast ? 0 : TAIL);
        return (
          <Sequence key={{i}} from={{b.start}} durationInFrames={{dur}}>
            {{b.clip ? (
              <OffthreadVideo src={{staticFile(b.clip)}} muted
                style={{{{ width: '100%', height: '100%', objectFit: 'cover', filter: 'brightness(0.55)' }}}} />
            ) : (
              <KenBurnsImage src={{b.src}} dur={{dur}} move={{b.move}}
                intensity={{b.intensity}} fadeIn={{b.fadeIn}} />
            )}}
          </Sequence>
        );
      }})}}
      <AbsoluteFill style={{{{ background: 'rgba(8, 10, 14, 0.5)' }}}} />
      <Sequence from={{0}} durationInFrames={{HOOK_END + 20}}>
        <HookCard text={{HOOK_CARD}} accent={{ACCENT}} />
      </Sequence>
      {{STATS.map((s, i) => (
        <Sequence key={{'s' + i}} from={{s.from + 6}} durationInFrames={{s.end - s.from - 6}}>
          <StatLayer graphic={{s.graphic}} value={{s.value}} label={{s.label}}
            bars={{s.bars}} onScreen={{s.onScreen}} accent={{ACCENT}} />
        </Sequence>
      ))}}
      {{TRANSITIONS.map((t, i) => (
        <Sequence key={{'t' + i}} from={{Math.max(0, t.at - 4)}} durationInFrames={{t.dur}}>
          <Transition kind={{t.kind}} dur={{t.dur}} accent={{ACCENT}} />
        </Sequence>
      ))}}
      {{BAIT && (
        <Sequence from={{BAIT.from}} durationInFrames={{BAIT.end - BAIT.from}}>
          <CommentBait text={{BAIT.text}} accent={{ACCENT}} />
        </Sequence>
      )}}
      <Captions lines={{VO}} y={{1330}} size={{54}} accent={{ACCENT}} maxWords={{5}} plate highlight />
      <ProgressBar color={{ACCENT}} />
    </AbsoluteFill>
  );
}};

export default {comp_id};
"""
    return _write_comp(shot_dir, comp_id, tsx)


def gen_composition_history(beats, spans, vo_frames, comp_id, shot_dir, accent, fps, total):
    """HISTORY edit format: archival imagery with film grade + grain, on-screen
    date/place stamps, per-beat source tag (archive + creator + year), wipe/
    rewind transitions carrying the next stamp, highlighted captions."""
    beats_lit = _spans_lit(spans)
    # TAGS indexes BY SPAN (micro-cuts mean 2 spans can share one voice line —
    # each span carries its line's stamp/source over its own frame range)
    tags_lit = "\n".join(
        f"  {{ tag: {json.dumps(str(vo_frames[s['voi']]['vo'].get('onScreen', '')))}, "
        f"source: {json.dumps(str(vo_frames[s['voi']]['vo'].get('_src_label', '')))}, "
        f"from: {s['start']}, end: {s['end']} }},"
        for s in spans)
    # wipes carry the NEXT beat's stamp as the panel crosses
    wipe_labels = []
    for i, f in enumerate(vo_frames):
        if i == 0:
            continue
        kind = transition_for(f["vo"].get("beat", ""), i, "history")
        if kind is None:
            continue
        label = str(f["vo"].get("onScreen", "")) if kind == "wipe" else ""
        wipe_labels.append(f"  {{ kind: '{kind}', at: {f['start']}, dur: 8, label: {json.dumps(label)} }},")
    trans_lit = "\n".join(wipe_labels)
    hook_card = json.dumps(str(beats.get("hookCard") or beats.get("title") or ""))
    hook_end = vo_frames[0]["end"] if vo_frames else round(3 * fps)
    bait = _quiz_bait(vo_frames, "history", fps)

    tsx = f"""import React from 'react';
import {{ AbsoluteFill, OffthreadVideo, Sequence, staticFile }} from 'remotion';
import {{ Captions, ProgressBar }} from '../../lib/shorts';
import {{ ArchivalImage, HookCard }} from '../../lib/archival';
import {{ CommentBait }} from '../../lib/shorts';
import {{ Transition }} from '../../lib/transitions';
import {{ VO }} from './vo.gen';

// =============================================================================
// AUTO-GENERATED by tools/make_short.py (HISTORY edit format) — "{beats['title']}"
// EVIDENCE FIRST: archival imagery, film grade + grain, date/source stamps,
// editorial wipes between scenes, numbers/dates highlighted in captions.
// Real archive hits carry their own credit; AI fallbacks are labeled as such.
// =============================================================================
export const compositionConfig = {{
  id: '{comp_id}',
  durationInSeconds: {round(total, 2)},
  fps: {fps},
  width: 1080,
  height: 1920,
}};

const ACCENT = '{accent}';
const TAIL = 20;

const BEATS = [
{beats_lit}
] as const;

const TAGS = [
{tags_lit}
] as const;

const TRANSITIONS = [
{trans_lit}
] as const;

const HOOK_CARD = {hook_card};
const HOOK_END = {hook_end};

const {comp_id}: React.FC = () => {{
  return (
    <AbsoluteFill style={{{{ background: '#0b0a08' }}}}>
      {{BEATS.map((b, i) => {{
        const isLast = i === BEATS.length - 1;
        const dur = b.end - b.start + (isLast ? 0 : TAIL);
        const tag = TAGS[i] || {{}};
        return (
          <Sequence key={{i}} from={{b.start}} durationInFrames={{dur}}>
            {{b.clip ? (
              <OffthreadVideo src={{staticFile(b.clip)}} muted
                style={{{{ width: '100%', height: '100%', objectFit: 'cover',
                  filter: 'sepia(0.28) contrast(1.06) brightness(0.94)' }}}} />
            ) : (
              <ArchivalImage src={{b.src}} dur={{dur}} move={{b.move}}
                intensity={{b.intensity}} fadeIn={{b.fadeIn}}
                tag={{tag.tag}} source={{tag.source}} />
            )}}
          </Sequence>
        );
      }})}}
      <Sequence from={{0}} durationInFrames={{HOOK_END + 20}}>
        <HookCard text={{HOOK_CARD}} accent={{ACCENT}} />
      </Sequence>
      {{TRANSITIONS.map((t, i) => (
        <Sequence key={{'t' + i}} from={{Math.max(0, t.at - 4)}} durationInFrames={{t.dur}}>
          <Transition kind={{t.kind}} dur={{t.dur}} accent={{ACCENT}} label={{t.label}} />
        </Sequence>
      ))}}
      {{BAIT && (
        <Sequence from={{BAIT.from}} durationInFrames={{BAIT.end - BAIT.from}}>
          <CommentBait text={{BAIT.text}} accent={{ACCENT}} />
        </Sequence>
      )}}
      <Captions lines={{VO}} y={{1330}} size={{54}} accent={{ACCENT}} maxWords={{5}} plate highlight />
      <ProgressBar color={{ACCENT}} />
    </AbsoluteFill>
  );
}};

export default {comp_id};
"""
    return _write_comp(shot_dir, comp_id, tsx)


def _write_comp(shot_dir, comp_id, tsx):
    path = os.path.join(shot_dir, f"{comp_id}.tsx")
    with open(path, "w", encoding="utf-8") as f:
        f.write(tsx)
    print(f"    composition -> {os.path.relpath(path, ROOT)}")
    return path


def build_sfx_plan(beats, proj_id, voiced_rel, end_s, pipeline="space"):
    """Map vo sfxHints + beat boundaries onto library clips. The cut cue on each
    beat change matches the visual transition (whip -> whip SFX, flash -> boom,
    rewind -> reverse whoosh), so picture and sound cut together."""
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
        if sid in EXCLUDED_SFX:  # e.g. transition-whip — never in automated plans
            return
        key = (round(at, 2), sid)
        if key in seen_at:
            return
        seen_at.add(key)
        events.append({"at_s": round(at, 2), "sfx_id": sid, "gain_db": gain,
                       "shot": "MainScene", "cue": cue, **({"optional": True} if optional else {})})

    # MINIMAL sound design — the narration IS the audio; effects only mark the
    # one moment that earns a punctuation (the reveal). No music, no per-line
    # whooshes/hints, and NO transition sounds (transition-whip & friends are
    # hard-excluded below — user request).
    for i, v in enumerate(beats["vo"]):
        if v.get("beat") == "reveal" and i > 0:
            add(float(v["start"]), "impact-deep-soft", -13, "the reveal lands")

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
    ap.add_argument("--pipeline", default="space", choices=PIPELINES,
                    help="script grammar + imagery strategy + edit format")
    ap.add_argument("--style", default=None, help='niche hint, e.g. "space documentary"')
    ap.add_argument("--voice", default=os.environ.get("KOKORO_VOICE", "dynamic"))
    ap.add_argument("--duration", type=float, default=40.0)
    ap.add_argument("--image-size", default="1K", choices=["1K", "2K", "4K"])
    ap.add_argument("--accent", default=None, help="caption accent color (default rotates)")
    ap.add_argument("--music", default=None, help="music bed id to mix (e.g. ambient-pad)")
    ap.add_argument("--skip-render", action="store_true")
    ap.add_argument("--no-clips", action="store_true",
                    help="skip video clips (degraded auto-retry mode)")
    ap.add_argument("--keep-intermediates", action="store_true",
                    help="keep raw render/voiced/sfx intermediates (debugging)")
    args = ap.parse_args()

    pipeline = args.pipeline
    if not args.topic and not args.resume:
        sys.exit("need --topic (new short) or --resume shorts/<id>")

    # 0. resolve project
    if args.resume:
        proj_dir = os.path.abspath(args.resume)
        proj_id = os.path.basename(proj_dir.rstrip("/"))
    else:
        prefix = PROJ_PREFIX.get(pipeline, "auto")
        n = next_index(prefix)
        proj_id = f"{prefix}-{n}-{slugify(args.topic, 32)}"
        proj_dir = os.path.join(ROOT, "shorts", proj_id)
        os.makedirs(proj_dir, exist_ok=True)

    beats_path = os.path.join(proj_dir, "beats.json")
    media_dir = os.path.join(ROOT, "media", "projects", proj_id)

    # 1. script + beats (local AI) — pipeline grammar
    if not os.path.exists(beats_path):
        script_tool = {
            "space": "tools/gen_script.py",
            "finance": "tools/gen_script_finance.py",
            "history": "tools/gen_script_history.py",
        }[pipeline]
        print(f"\n[1/8] {pipeline} script (local AI) for: {args.topic!r}")
        sh([sys.executable, script_tool, "--topic", args.topic,
            "--out", proj_dir, "--duration", str(args.duration)]
           + (["--style", args.style] if args.style else []))
    beats = json.load(open(beats_path, encoding="utf-8"))
    pipeline = beats.get("pipeline", pipeline)  # beats.json knows best on resume
    comp_id = beats.get("composition") or ("Auto" + proj_id.split("-")[1])
    total = float(beats["format"]["durationSec"])
    print(f"      '{beats['title']}'  ({len(beats['vo'])} lines, {total:.0f}s, pipeline={pipeline})")

    # 2. beat imagery (pipeline strategy: real archives first, AI fallback)
    print(f"\n[2/8] beat imagery ({pipeline}: real archives first, AI fallback)")
    srcs = gen_images(pipeline, beats, proj_dir, media_dir, args.image_size)

    # 3. real video clips for motion:true beats (history: archive.org footage
    #    first; everything: FAL AI clip when configured; stills as last resort)
    print("\n[3/8] video clips (payoff beats; history tries archive.org footage first)")
    clips = {} if args.no_clips else gen_clips(beats, media_dir, pipeline)
    if clips:
        print(f"      {len(clips)} clip(s): {sorted(clips)}")

    # 4. voice (local Kokoro) + word timings + vo.gen.ts
    shot_dir = os.path.join(ROOT, "remotion", "src", "shots", comp_id.lower())
    vo_ts = os.path.join(shot_dir, "vo.gen.ts")
    print("\n[4/8] voice (local Kokoro TTS)")
    sh([sys.executable, "tools/gen_voice.py", "--beats", beats_path,
        "--voice", args.voice, "--emit-ts", vo_ts])
    beats = json.load(open(beats_path, encoding="utf-8"))  # re-read actual timings
    total = float(beats["format"]["durationSec"])

    # per-beat source label for the history date/source tag (Wikimedia · 1911 …)
    try:
        manifest = json.load(open(os.path.join(media_dir, "images.json"), encoding="utf-8"))
        for v, m in zip(beats["vo"], manifest):
            src = m.get("source") or "unknown"
            pretty = {"nasa": "NASA", "wikimedia": "Wikimedia Commons", "loc": "Library of Congress",
                      "openverse": "Openverse", "met": "Met Museum", "ai": "AI reconstruction"}.get(src, src)
            label = pretty
            if m.get("year"):
                label += f" · {m['year']}"
            elif m.get("creator") and src not in ("ai",):
                label += f" · {str(m['creator'])[:28]}"
            v["_src_label"] = label
    except (OSError, ValueError):
        pass

    # 5. composition + render
    accent = args.accent or ACCENTS[(next_index() - 1) % len(ACCENTS)]
    print(f"\n[5/8] composition + render (accent {accent})")
    gen_composition(beats, srcs, clips, comp_id, shot_dir, accent, pipeline)
    if args.skip_render:
        print("      --skip-render: stopping before render")
        return
    sh(["npm", "run", "gen"], cwd=os.path.join(ROOT, "remotion"))
    sh(["node", "scripts/render-all.mjs", comp_id, "--scale=1"],
       cwd=os.path.join(ROOT, "remotion"))
    rendered = os.path.join(ROOT, "remotion", "out", f"{comp_id}.mp4")
    if not os.path.exists(rendered):
        sys.exit(f"render did not produce {rendered}")

    # 6. mux the voice
    print("\n[6/8] voice mux")
    voice_wav = os.path.join(proj_dir, "voice", "voice.wav")
    voiced = os.path.join(ROOT, "remotion", "out", f"{comp_id}-voiced.mp4")
    sh(["ffmpeg", "-y", "-v", "error", "-i", rendered, "-i", voice_wav,
        "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
        "-t", str(total), voiced])

    # 7. MINIMAL SFX — one ducked impact on the reveal, nothing else.
    # Transition/whip sounds are hard-excluded from the automated pipeline
    # (EXCLUDED_SFX below); music stays an explicit opt-in.
    print("\n[7/8] SFX mix (minimal: reveal impact only — no transition sounds)")
    voiced_rel = os.path.relpath(voiced, ROOT)
    plan = build_sfx_plan(beats, proj_id, voiced_rel, total, pipeline)
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

    # final copy — then remove every intermediate so the ONLY artifact is
    # <proj_id>-final.mp4 (render + voiced mux + any sfx/music variants go)
    out_dir = os.path.join(proj_dir, "output")
    os.makedirs(out_dir, exist_ok=True)
    final_copy = os.path.join(out_dir, f"{proj_id}-final.mp4")
    import shutil
    shutil.copy2(final, final_copy)

    if not args.keep_intermediates:
        import glob as _glob
        stale = [rendered, voiced,
                 os.path.join(out_dir, f"{proj_id}-sfx.mp4"),
                 os.path.join(out_dir, f"{proj_id}-music.mp4")]
        stale += [p for p in _glob.glob(os.path.join(out_dir, "*.mp4")) if p != final_copy]
        for p in stale:
            if os.path.exists(p):
                try:
                    os.remove(p)
                    print(f"      cleaned intermediate: {os.path.relpath(p, ROOT)}")
                except OSError:
                    pass

    # 8. quality gate: structural checks. A flag never deletes the
    #    render — it records reasons and publisher.js refuses to publish it.
    print("\n[8/8] quality control (structural)")
    qc = None
    try:
        sh([sys.executable, "tools/qc_check.py", "--short-dir", proj_dir], check=False)
        qc_path = os.path.join(proj_dir, "qc-report.json")
        if os.path.exists(qc_path):
            qc = json.load(open(qc_path, encoding="utf-8"))
    except Exception as e:  # noqa: BLE001 — QC must never kill a finished short
        print(f"      QC step error (non-fatal): {e}")

    print("\n" + "=" * 60)
    print(f"DONE  {beats['title']}")
    print(f"      {final_copy}")
    print(f"      {total:.1f}s  voice={beats.get('voiceStatus')}  "
          f"images={len(srcs)}  clips={len(clips)}  accent={accent}  "
          f"qc={qc['verdict'] if qc else 'skipped'}")
    print("=" * 60)
    # machine-readable result for the operator worker (operator/worker.js)
    manifest_path = os.path.join(media_dir, "images.json")
    nasa_count = 0
    source_counts = {}
    real_count = 0
    try:
        manifest = json.load(open(manifest_path, encoding="utf-8"))
        for m in manifest:
            s = m.get("source") or "unknown"
            source_counts[s] = source_counts.get(s, 0) + 1
            if s != "ai":
                real_count += 1
        nasa_count = source_counts.get("nasa", 0)
    except (OSError, ValueError):
        pass
    print("FINAL:" + json.dumps({
        "proj_id": proj_id,
        "title": beats["title"],
        "final": final_copy,
        "beats": beats_path,
        "duration": round(total, 2),
        "composition": comp_id,
        "voice": beats.get("voiceStatus"),
        "pipeline": pipeline,
        "images": len(srcs),
        "real_images": real_count,
        "nasa_images": nasa_count,
        "image_sources": source_counts,
        "clips": len(clips),
        "images_manifest": manifest_path,
        "accent": accent,
        "qc": ({"verdict": qc.get("verdict"), "issues": qc.get("issues", [])[:6]}
               if qc else None),
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
