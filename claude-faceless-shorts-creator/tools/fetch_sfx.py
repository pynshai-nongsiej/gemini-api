#!/usr/bin/env python3
"""
fetch_sfx.py — EXPAND the shared SFX library with free, keyless downloads.

Sources: Wikimedia Commons audio search (ogg/flac/wav → mp3 via ffmpeg).
Every clip lands in media/library/sfx/clips/ and is appended to catalog.json
with tags + license + credit, and the full attribution list is written to
media/library/sfx/CREDITS.json. Only permissively-licensed files are kept
(CC0 / public domain / CC-BY / CC-BY-SA).

The pack below fills the gaps the two new pipelines need:

  transitions  whip swish, deep drop, cinematic boom, cassette/rewind
  finance      cash register, coins, card swipe, receipt printer, calculator keys
  history      typewriter, film projector, camera shutter, film crackle, alarm bell

Usage:
  python3 tools/fetch_sfx.py                 # fetch everything missing
  python3 tools/fetch_sfx.py --only finance  # one group
  python3 tools/fetch_sfx.py --list          # show catalog after fetch
"""
import argparse
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SFX_DIR = os.path.join(ROOT, "media", "library", "sfx")
CLIPS_DIR = os.path.join(SFX_DIR, "clips")
CATALOG = os.path.join(SFX_DIR, "catalog.json")
CREDITS = os.path.join(SFX_DIR, "CREDITS.json")
UA = "local-shorts-factory/1.0 (local media pipeline; contact: operator@localhost) python-urllib"

# id -> (commons search queries tried in order, tags) — skipped if exists
PACK = {
    # --- transitions (cut punctuation for every pipeline) ---
    "transition-whip":     (["whip swish sound effect", "swish sound", "whoosh swish"],
                            ["transition", "whip", "swish", "fast", "cut"]),
    "transition-drop":     (["bass drop sound effect", "sub drop sound", "bass boom"],
                            ["transition", "drop", "bass", "impact", "cut"]),
    "transition-boom":     (["cinematic boom sound effect", "distant thunder rumble", "thunder sound effect"],
                            ["transition", "boom", "cinematic", "hit"]),
    "transition-rewind":   (["tape rewind sound effect", "cassette rewind", "reel rewind sound", "reverse cymbal"],
                            ["transition", "rewind", "tape", "reverse"]),
    "riser-cinematic":     (["cinematic riser sound effect", "whoosh rise sound", "drum roll snare", "drum roll"],
                            ["riser", "build", "tension", "cinematic"]),
    # --- finance (Wealth Engine data-graphic punctuation) ---
    "cash-register":       (["cash register sound effect", "cash register bell", "kaching sound"],
                            ["money", "cash", "register", "kaching", "reveal"]),
    "coins-drop":          (["coins jingle sound effect", "coin drop sound", "coins clinking"],
                            ["money", "coins", "jingle", "counting"]),
    "card-swipe":          (["credit card swipe sound", "card reader beep", "swipe sound"],
                            ["finance", "card", "swipe", "ui"]),
    "receipt-print":       (["receipt printer sound effect", "dot matrix printer sound", "printer sound"],
                            ["finance", "printer", "receipt", "numbers"]),
    "calculator-keys":     (["calculator button press sound", "beep short sound", "click short sound"],
                            ["finance", "calculator", "keys", "click"]),
    # --- history (The Footnote Files evidence punctuation) ---
    "typewriter-keys":     (["typewriter typing sound", "typewriter sound", "manual typewriter", "typing keyboard slow"],
                            ["history", "typewriter", "keys", "document"]),
    "typewriter-ding":     (["typewriter carriage return ding", "typewriter bell", "bell ding short"],
                            ["history", "typewriter", "ding", "bell"]),
    "projector-run":       (["film projector sound effect", "projector whir sound", "projector clicking", "film reel sound"],
                            ["history", "projector", "film", "newsreel", "loop"]),
    "camera-shutter":      (["camera shutter click sound", "shutter click", "camera click sound"],
                            ["history", "camera", "shutter", "photo"]),
    "film-crinkle":        (["old film crackle sound", "record crackle", "vinyl crackle short", "static crackle"],
                            ["history", "film", "crackle", "grain", "texture"]),
    "bell-desk":           (["service desk bell sound", "hotel bell ding", "counter bell", "handbell ding"],
                            ["history", "bell", "ding", "front desk"]),
    # --- generic punch-ups ---
    "heartbeat-soft":      (["heartbeat sound effect slow", "heart beat sound", "heartbeat ogg"],
                            ["tension", "heartbeat", "body", "drama"]),
    "paper-slide":         (["paper slide rustle sound", "paper rustle", "paper handling sound"],
                            ["paper", "slide", "foley", "document"]),
}

OK_LICENSE = re.compile(r"cc0|public domain|pd|cc by-sa|cc by|attribution", re.I)
# speech/podcast/music junk that plagues Commons audio search
BAD_TITLE = re.compile(
    r"speech|interview|episode|podcast|lecture|speaking|oral history|reading|"
    r"song|sung|music|album|choir|symphony|overture|concert|radio broadcast|"
    r"announcement|news report|audiobook|poem|discourse|scream|wilhelm", re.I)
MAX_BYTES = 3 * 1024 * 1024  # a real one-shot SFX is small; podcasts are not


def _http_json(url, timeout=15, attempts=5):
    """GET JSON with aggressive 429/5xx backoff (Commons rate-limits hard)."""
    last = None
    for attempt in range(1, attempts + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            last = e
            if e.code in (429, 502, 503) and attempt < attempts:
                wait = 20 * attempt
                print(f"    HTTP {e.code} — waiting {wait}s…")
                time.sleep(wait)
            else:
                raise
        except Exception as e:
            last = e
            if attempt < attempts:
                time.sleep(5 * attempt)
            else:
                raise
    raise last


def _polite_pause():
    time.sleep(4.0)  # stay well under the Commons API rate limit


def _download(url, timeout=120):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def search_commons_audio(queries):
    """Best SFX candidate across a list of queries: free license, small file,
    no speech/podcast junk, ranked by query-keyword overlap with the title."""
    best = None
    for query in queries:
        params = {
            "action": "query", "format": "json", "generator": "search",
            "gsrsearch": f"{query} filetype:audio", "gsrnamespace": "6", "gsrlimit": "10",
            "prop": "imageinfo", "iiprop": "url|extmetadata|size",
        }
        try:
            res = _http_json("https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode(params))
        except Exception as e:
            print(f"    search failed ({query}): {e}")
            _polite_pause()
            continue
        qwords = {w for w in re.sub(r"[^\w\s]", " ", query.lower()).split() if len(w) > 2}
        pages = (res.get("query") or {}).get("pages") or {}
        for page in pages.values():
            info = (page.get("imageinfo") or [{}])[0]
            url = info.get("url") or ""
            title = re.sub(r"^File:", "", page.get("title", ""), flags=re.I)
            stem = re.sub(r"\.\w+$", "", title).lower()
            if not url or not re.search(r"\.(ogg|oga|flac|wav|mp3)(\?|$)", url.lower()):
                continue
            if BAD_TITLE.search(stem):
                continue
            if int(info.get("size") or 0) > MAX_BYTES:
                continue
            meta = info.get("extmetadata") or {}
            license_name = ((meta.get("LicenseShortName") or {}).get("value", "") or "")
            if license_name and not OK_LICENSE.search(license_name):
                continue
            relevance = len(qwords & {w for w in stem.split() if len(w) > 2})
            cand = {
                "url": url,
                "title": title,
                "license": license_name or "see Commons page",
                "artist": re.sub(r"<[^>]+>", "", ((meta.get("Artist") or {}).get("value", "") or ""))[:120],
                "bytes": int(info.get("size") or 0),
                "relevance": relevance,
            }
            if best is None or cand["relevance"] > best["relevance"]:
                best = cand
        _polite_pause()
        # a title naming the actual sound beats moving to the next query
        if best and best["relevance"] >= 2:
            break
    if best:
        best.pop("relevance", None)
    return best


def to_mp3(src_bytes, out_path):
    """bytes (ogg/flac/wav) -> normalized mono-ish mp3 via ffmpeg."""
    import tempfile
    with tempfile.NamedTemporaryFile(suffix=os.path.splitext(out_path)[1], delete=False) as tf:
        tf.write(src_bytes)
        tmp_in = tf.name
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-v", "error", "-i", tmp_in, "-ac", "2", "-ar", "44100",
             "-codec:a", "libmp3lame", "-q:a", "4", out_path],
            check=True, timeout=120)
    finally:
        os.unlink(tmp_in)
    return os.path.getsize(out_path)


def probe_duration(path):
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", path],
            capture_output=True, text=True, timeout=30).stdout
        return float(json.loads(out).get("format", {}).get("duration") or 0)
    except Exception:
        return 0.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default=None, help="fetch one group id (e.g. finance)")
    ap.add_argument("--list", action="store_true")
    args = ap.parse_args()

    os.makedirs(CLIPS_DIR, exist_ok=True)
    catalog = json.load(open(CATALOG)) if os.path.exists(CATALOG) else {"clips": []}
    known = {c["id"]: c for c in catalog.get("clips", [])}
    credits = []
    if os.path.exists(CREDITS):
        try:
            credits = json.load(open(CREDITS))
        except ValueError:
            credits = []

    wanted = PACK if not args.only else {k: v for k, v in PACK.items() if args.only in k}
    added = 0
    for sid, (queries, tags) in wanted.items():
        out = os.path.join(CLIPS_DIR, f"{sid}.mp3")
        if os.path.exists(out) or sid in known:
            continue
        print(f"[{sid}] searching: {queries[0]}")
        hit = search_commons_audio(queries)
        if not hit:
            print("    no free candidate — skipped")
            continue
        try:
            data = _download(hit["url"])
            size = to_mp3(data, out)
        except Exception as e:
            print(f"    download/convert failed: {e}")
            continue
        # duration guard: a 9-minute "rewind" is a podcast, not an SFX
        dur = probe_duration(out)
        if dur > 25.0:
            os.remove(out)
            print(f"    rejected ({dur:.0f}s — too long to be a one-shot)")
            continue
        known[sid] = {
            "id": sid, "file": f"clips/{sid}.mp3", "tags": tags,
            "license": hit["license"], "credit": hit["artist"] or hit["title"],
            "source_url": f"https://commons.wikimedia.org/wiki/File:{urllib.parse.quote(hit['title'])}",
            "fetched": "wikimedia-commons",
        }
        credits.append({"id": sid, **{k: known[sid][k] for k in ("license", "credit", "source_url")}})
        added += 1
        print(f"    ✓ {hit['title'][:60]} ({size // 1024}KB, {hit['license']})")

    catalog["clips"] = list(known.values())
    with open(CATALOG, "w") as f:
        json.dump(catalog, f, indent=2)
        f.write("\n")
    with open(CREDITS, "w") as f:
        json.dump(credits, f, indent=2)
        f.write("\n")
    print(f"\nadded {added} clip(s) — catalog now has {len(catalog['clips'])}")
    print(f"attribution -> {os.path.relpath(CREDITS, ROOT)}")

    if args.list:
        for c in sorted(catalog["clips"], key=lambda x: x["id"]):
            print(f"  {c['id']:24s} {','.join((c.get('tags') or [])[:4])}")


if __name__ == "__main__":
    main()
