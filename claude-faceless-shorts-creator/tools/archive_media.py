#!/usr/bin/env python3
"""
archive_media.py — authentic ARCHIVAL imagery & footage for non-space beats.

The history (and any future non-astronomy) pipeline resolves every beat image
REAL-FIRST from free, public-domain-friendly archives, in this order:

  1. Wikimedia Commons   — millions of historical photos, maps, documents
                           (API: commons.wikimedia.org/w/api.php, keyless)
  2. Library of Congress — photos, newsreels, WPA/posters, civil-war plates
                           (API: loc.gov/photos/?fo=json, keyless)
  3. Openverse           — meta-search of Flickr/etc. CC-licensed imagery
                           (API: api.openverse.org/v1/images, keyless)
  4. Met Museum          — public-domain art & artifact photography
                           (API: collectionapi.metmuseum.org, keyless)
  5. AI fallback         — tools/gen_image.py, era-consistent prompt
                           (caller's job; this module returns None)

FOOTAGE (motion beats): archive.org video search (Prelinger Archives and other
public-domain film collections) -> downloads + trims a short mp4 clip with
ffmpeg when available. Every image/clip hit carries license + creator + year
metadata so the render can burn an on-screen source tag and the operator
manifest records provenance per beat.

Usage:
  python tools/archive_media.py "mercury capsule 1961" --out /tmp/x.jpg
  python tools/archive_media.py "haymarket square 1886" --json
  python tools/archive_media.py "factory assembly line 1930" --clip --out /tmp/x.mp4
"""
import argparse
import json
import os
import re
import subprocess
import sys
import urllib.parse
import urllib.request

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 local-shorts-factory/1.0"

# generic prompt-noise removed before archive search (same idea as the NASA
# fetcher's astronomy stopwords, minus the space vocabulary)
STOPWORDS = {
    "cinematic", "render", "realistic", "8k", "hyper", "visual", "shot", "style",
    "4k", "extreme", "illustration", "animation", "cgi", "detailed", "photorealistic",
    "dramatic", "lighting", "moody", "atmospheric", "close-up", "closeup", "wide",
    "establishing", "low", "angle", "high", "aerial", "view", "frame", "footage",
    "sepia", "black", "white", "vintage", "grain", "film", "photo", "photograph",
    "approaching", "towering", "plunging", "vast", "movement", "scale", "mood",
    "what", "this", "about", "from", "with", "that", "have", "been", "would",
    "could", "their", "there", "where", "when", "into", "over", "than", "them",
    "these", "those", "also", "just", "more", "most", "very", "the", "and",
}

ERA_RE = re.compile(r"\b(1[0-9]{3}|20[0-4][0-9])s?\b")


def _clean(text):
    t = re.sub(r"[^\w\s-]", " ", str(text or "").lower())
    return " ".join(t.split())


def extract_keywords(text, fallback_title=""):
    """High-signal search keywords from a descriptive prompt (drops camera /
    lighting noise; keeps proper nouns, places, years)."""
    words = [w for w in _clean(text).split()
             if len(w) > 2 and w not in STOPWORDS and not re.fullmatch(r"\d+", w)]
    if words:
        return " ".join(words[:5])
    if fallback_title:
        fb = [w for w in _clean(fallback_title).split()
              if len(w) > 2 and w not in STOPWORDS]
        if fb:
            return " ".join(fb[:5])
    return "historical photograph archive"


def _year_of(text):
    m = ERA_RE.search(str(text or ""))
    return m.group(1) if m else None


def _http_json(url, timeout=15):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def download(url, out_path, timeout=90):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = r.read()
    if len(data) < 4096:
        raise RuntimeError(f"suspiciously small asset ({len(data)}B)")
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    with open(out_path, "wb") as f:
        f.write(data)
    return len(data)


# --------------------------------------------------------------------------- #
# sources — each returns a metadata dict or None. All keyless.
# --------------------------------------------------------------------------- #

def _wikimedia(query, exclude_urls):
    """Commons fulltext search in File namespace, scaled thumb download.
    Ranked by query-keyword overlap with the title first (a generic wide photo
    of the wrong subject must lose to a narrow photo of the right one)."""
    params = {
        "action": "query", "format": "json", "generator": "search",
        "gsrsearch": query, "gsrnamespace": "6", "gsrlimit": "16",
        "prop": "imageinfo", "iiprop": "url|extmetadata|size",
        "iiurlwidth": "1400",
    }
    try:
        res = _http_json("https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode(params))
    except Exception:
        return None
    pages = (res.get("query") or {}).get("pages") or {}
    items = list(pages.values())
    qwords = {w for w in _clean(query).split() if len(w) > 2}

    def relevance(page):
        title = _clean(re.sub(r"^File:", "", page.get("title", ""), flags=re.I))
        tw = {w for w in title.split() if len(w) > 2}
        return len(qwords & tw)

    items.sort(key=lambda p: (relevance(p),
                              (p.get("imageinfo") or [{}])[0].get("width", 0)), reverse=True)
    for page in items[:12]:
        info = (page.get("imageinfo") or [{}])[0]
        url = info.get("thumburl") or info.get("url")
        if not url or url in exclude_urls:
            continue
        meta = info.get("extmetadata") or {}
        license_name = (meta.get("LicenseShortName") or {}).get("value", "")
        # keep only free licenses (AI fallback is the safety net otherwise)
        if license_name and re.search(r"fair use|non-free|nondti", license_name, re.I):
            continue
        exclude_urls.add(url)
        title = re.sub(r"^File:", "", page.get("title", ""), flags=re.I)
        return {
            "source": "wikimedia",
            "title": title,
            "creator": re.sub(r"<[^>]+>", "", ((meta.get("Artist") or {}).get("value", "") or ""))[:120],
            "year": _year_of(title) or _year_of((meta.get("DateTimeOriginal") or {}).get("value", "")),
            "license": license_name or "see Commons page",
            "url": url,
            "details_url": info.get("descriptionurl"),
            "width": info.get("width"), "height": info.get("height"),
        }
    return None


def _loc(query, exclude_urls):
    """Library of Congress photo search (fo=json)."""
    try:
        res = _http_json(f"https://www.loc.gov/photos/?q={urllib.parse.quote(query)}&fo=json&c=10")
    except Exception:
        return None
    for item in (res.get("results") or [])[:10]:
        urls = item.get("image_url") or []
        if not urls:
            continue
        url = urls[-1]  # last = largest rendition
        if url in exclude_urls:
            continue
        exclude_urls.add(url)
        return {
            "source": "loc",
            "title": (item.get("title") or "")[:160],
            "creator": ", ".join((item.get("creator") or [])[:2])[:120],
            "year": _year_of(str(item.get("date", ""))),
            "license": "public domain / rights advisory at LoC",
            "url": url if url.startswith("http") else "https:" + url,
            "details_url": item.get("id"),
        }
    return None


def _openverse(query, exclude_urls):
    try:
        res = _http_json(
            "https://api.openverse.org/v1/images/?" + urllib.parse.urlencode(
                {"q": query, "license_type": "all-cc", "page_size": "10"}))
    except Exception:
        return None
    for item in (res.get("results") or [])[:10]:
        url = item.get("url")
        if not url or url in exclude_urls:
            continue
        exclude_urls.add(url)
        return {
            "source": "openverse",
            "title": (item.get("title") or "")[:160],
            "creator": (item.get("creator") or "")[:120],
            "year": _year_of(str(item.get("created_at", "")) + " " + (item.get("title") or "")),
            "license": f"{item.get('license', '')} {item.get('license_version', '')}".strip() or "cc",
            "url": url,
            "details_url": item.get("foreign_landing_url"),
        }
    return None


def _met(query, exclude_urls):
    """Met Museum public-domain images (openAccess only)."""
    try:
        res = _http_json("https://collectionapi.metmuseum.org/public/collection/v1/search?"
                         + urllib.parse.urlencode({"q": query, "hasImages": "true"}))
        ids = (res.get("objectIDs") or [])[:8]
        for oid in ids:
            obj = _http_json(f"https://collectionapi.metmuseum.org/public/collection/v1/objects/{oid}")
            if not obj.get("isPublicDomain") or not obj.get("primaryImage"):
                continue
            url = obj["primaryImageSmall"] or obj["primaryImage"]
            if url in exclude_urls:
                continue
            exclude_urls.add(url)
            return {
                "source": "met",
                "title": (obj.get("title") or "")[:160],
                "creator": (obj.get("artistDisplayName") or "Unknown")[:120],
                "year": _year_of(str(obj.get("objectDate", ""))),
                "license": "public domain (Met open access)",
                "url": url,
                "details_url": obj.get("objectURL"),
            }
    except Exception:
        return None
    return None


SOURCES = [("wikimedia", _wikimedia), ("loc", _loc), ("openverse", _openverse), ("met", _met)]


def search_archival(query, exclude_urls=None, sources=None):
    """Try each archive in order until one returns a usable hit.
    exclude_urls is mutated in place (dedup across a production)."""
    if exclude_urls is None:
        exclude_urls = set()
    clean = extract_keywords(query)
    for name, fn in (SOURCES if not sources else [s for s in SOURCES if s[0] in sources]):
        try:
            hit = fn(clean, exclude_urls)
        except Exception:
            hit = None
        if hit and hit.get("url"):
            hit["query"] = clean
            return hit
        # one simplified retry (first three keywords) for the picky sources
        words = clean.split()
        if len(words) > 3:
            try:
                hit = fn(" ".join(words[:3]), exclude_urls)
            except Exception:
                hit = None
            if hit and hit.get("url"):
                hit["query"] = " ".join(words[:3])
                return hit
    return None


def fetch_archival_image(query, out_path, exclude_urls=None, fallback_title=""):
    """Full real-first resolution for one beat image. Returns metadata dict on
    success (with path/bytes), None when every archive missed (caller falls
    back to era-consistent AI generation)."""
    hit = search_archival(query, exclude_urls=exclude_urls)
    if not hit:
        raw = _clean(query)[:70]
        if raw and raw != extract_keywords(query):
            hit = search_archival(raw, exclude_urls=exclude_urls)
    if not hit:
        return None
    ext = ".jpg"
    lower = hit["url"].lower()
    if ".png" in lower:
        ext = ".png"
    elif ".webp" in lower:
        ext = ".webp"
    out = os.path.splitext(out_path)[0] + ext
    try:
        size = download(hit["url"], out)
    except Exception:
        return None
    hit["path"] = os.path.abspath(out)
    hit["bytes"] = size
    hit["src"] = os.path.basename(out)
    return hit


# --------------------------------------------------------------------------- #
# footage — archive.org public-domain film (Prelinger etc.)
# --------------------------------------------------------------------------- #

def search_archive_video(query, exclude_ids=None):
    """archive.org advancedsearch for public-domain footage (Prelinger first).
    Returns {identifier, title, year, license_url, download_base} or None."""
    q = f'({extract_keywords(query)}) AND mediatype:(movies)'
    params = {
        "q": q,
        "fl[]": "identifier,title,year,licenseurl,collection,downloads",
        "rows": "12", "output": "json",
        "sort[]": "-downloads",
    }
    try:
        res = _http_json("https://archive.org/advancedsearch.php?" + urllib.parse.urlencode(params, doseq=True))
    except Exception:
        return None
    docs = ((res.get("response") or {}).get("docs")) or []
    docs.sort(key=lambda d: (0 if "prelinger" in (d.get("collection") or []) else 1,
                             -int(d.get("downloads") or 0)))
    for doc in docs:
        ident = doc.get("identifier")
        if not ident or (exclude_ids and ident in exclude_ids):
            continue
        return {
            "source": "archive.org",
            "identifier": ident,
            "title": (doc.get("title") or ident)[:160],
            "year": doc.get("year"),
            "license": doc.get("licenseurl") or "public domain (check item page)",
            "details_url": f"https://archive.org/details/{ident}",
            "download_base": f"https://archive.org/download/{urllib.parse.quote(ident)}",
        }
    return None


def fetch_archival_clip(query, out_path, max_seconds=6.0, exclude_ids=None):
    """Download a public-domain footage clip for a motion beat and trim it to
    max_seconds (ffmpeg, when present — otherwise the raw head of the file is
    kept and the render's OffthreadVideo just uses the first seconds).
    Returns metadata dict or None."""
    hit = search_archive_video(query, exclude_ids=exclude_ids)
    if not hit:
        return None
    try:
        meta = _http_json(f"{hit['download_base']}/{urllib.parse.quote(hit['identifier'])}_files.json")
    except Exception:
        meta = None
    files = (meta or {}).get("result") or []
    mp4s = [f for f in files
            if str(f.get("name", "")).lower().endswith(".mp4")
            and str(f.get("format", "")).lower() in ("h.264", "mpeg4", "512kb mpeg4", "h.264 hd")]
    if not mp4s:
        mp4s = [f for f in files if str(f.get("name", "")).lower().endswith(".mp4")]
    if not mp4s:
        return None
    mp4s.sort(key=lambda f: int(f.get("size") or 1 << 60))  # smallest usable = fastest
    name = mp4s[0].get("name")
    url = f"{hit['download_base']}/{urllib.parse.quote(name)}"
    tmp = os.path.splitext(out_path)[0] + ".src.mp4"
    try:
        download(url, tmp, timeout=180)
    except Exception:
        return None

    final = os.path.splitext(out_path)[0] + ".mp4"
    trimmed = False
    if max_seconds and shutil_which("ffmpeg"):
        try:
            subprocess.run(
                ["ffmpeg", "-y", "-v", "error", "-i", tmp, "-t", str(max_seconds),
                 "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
                 "-vf", "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920",
                 final],
                check=True, timeout=240)
            trimmed = True
        except Exception:
            trimmed = False
    if not trimmed:
        os.replace(tmp, final)
    elif os.path.exists(tmp):
        os.remove(tmp)
    hit.update({
        "path": os.path.abspath(final),
        "bytes": os.path.getsize(final),
        "clip_file": name,
        "trimmed": trimmed,
    })
    return hit


def shutil_which(cmd):
    from shutil import which
    return which(cmd)


def main():
    ap = argparse.ArgumentParser(description="archival imagery/footage fetcher")
    ap.add_argument("query")
    ap.add_argument("--out", default=None)
    ap.add_argument("--json", action="store_true", help="search only, print the hit as JSON")
    ap.add_argument("--clip", action="store_true", help="fetch archive.org FOOTAGE instead of an image")
    args = ap.parse_args()

    if args.json:
        print(json.dumps(search_archival(extract_keywords(args.query)), indent=2, ensure_ascii=False))
        return
    if not args.out:
        sys.exit("--out required (or --json)")
    if args.clip:
        hit = fetch_archival_clip(args.query, args.out)
    else:
        hit = fetch_archival_image(args.query, args.out)
    if hit:
        print(json.dumps({"status": "ready", **hit}, indent=2, ensure_ascii=False))
    else:
        print(json.dumps({"status": "no_match", "query": args.query}))
        sys.exit(2)


if __name__ == "__main__":
    main()
