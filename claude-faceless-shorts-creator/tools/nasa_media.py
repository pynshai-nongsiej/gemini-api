#!/usr/bin/env python3
"""
nasa_media.py — authentic NASA imagery for short beats.

Searches the NASA Image and Video Library (images-api.nasa.gov — free, keyless)
and downloads real telescope/mission photography. The pipeline uses NASA FIRST
for every beat image; AI generation (tools/gen_image.py) only runs when NASA
has no authentic match for the query.

Ported from the previous youtube-automation-agent's space-media-fetcher:
  - keyword extraction from descriptive prompts (diacritics normalized,
    astronomy stopwords removed)
  - non-astronomy filtering (diagrams, posters, portraits, facilities…)
  - telescope-priority sorting (Hubble / Webb / Chandra / Spitzer)
  - ~large > ~medium > ~orig > ~small asset preference
  - simplified-query retry before giving up (returns None -> AI fallback)

Usage (CLI):
  python tools/nasa_media.py "neutron star" --out /tmp/test.jpg
  python tools/nasa_media.py "black hole" --json          # search only, no download
"""
import argparse
import json
import os
import re
import sys
import urllib.parse
import urllib.request

API = "https://images-api.nasa.gov/search"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 local-shorts-factory/1.0"

NON_ASTRONOMY_REGEX = re.compile(
    r"diagram|infographic|chart|graph|schematic|types of|poster|table|drawing|"
    r"label|text|slide|presentation|cross-section|comic|cartoon|illustration of|"
    r"artist's impression of|concept map|timeline|educational|bone loss|"
    r"microgravity associated|crew|portrait|ceremony|award|conference|"
    r"press briefing|patch|facility|building|medical|biology|signing|"
    r"administrator|astronaut portrait|ground test|wind tunnel|center director|"
    r"annual report|exhibit|headquarters", re.IGNORECASE)

ASTRONOMY_STOPWORDS = {
    "cinematic", "render", "realistic", "8k", "hyper", "visual", "shot", "style",
    "4k", "extreme", "illustration", "animation", "cgi", "detailed",
    "astronomical", "telescope", "view", "deep-sky", "infrared", "composite",
    "crisp", "stars", "photorealistic", "observation", "wide-angle", "vista",
    "reveal", "revealed", "reveals", "illustrates", "discovers", "discovered",
    "discover", "measuring", "across", "contains", "only", "continuously",
    "pull", "matter", "away", "scale", "grandest", "structures", "universe",
    "silent", "standing", "inside", "stretches", "endlessly", "direction",
    "showing", "shows", "macro", "zoom", "zooming", "flying", "camera",
    "orbiting", "surface", "artist", "concept", "space", "science",
    "detection", "mechanism", "forces", "succinct", "sentence", "explaining",
    "describing", "what", "this", "about", "from", "with", "that", "have",
    "been", "would", "could", "their", "there", "where", "when", "into",
    "over", "than", "them", "these", "those", "also", "just", "more", "most",
    "very", "much", "figure", "spinning", "fast", "dark", "ice", "arms",
    "pulled", "tightly", "chest", "rim", "lighting", "close", "glowing",
}


def _clean(text):
    """lowercase, strip diacritics + punctuation (Boötes -> bootes)."""
    import unicodedata
    t = unicodedata.normalize("NFD", str(text or ""))
    t = "".join(c for c in t if not unicodedata.combining(c))
    t = re.sub(r"[^\w\s-]", " ", t.lower())
    return " ".join(t.split())


def extract_astronomy_keywords(text, fallback_title=""):
    """High-signal celestial search keywords from a descriptive prompt."""
    words = [w for w in _clean(text).split()
             if len(w) > 2 and w not in ASTRONOMY_STOPWORDS and not w.isdigit()]
    if words:
        return " ".join(words[:3])
    if fallback_title:
        fb = [w for w in _clean(fallback_title).split()
              if len(w) > 2 and w not in ASTRONOMY_STOPWORDS and not w.isdigit()]
        if fb:
            return " ".join(fb[:3])
    return "deep space galaxies hubble"


def _http_json(url, timeout=12):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def _is_telescope_priority(item):
    data = item.get("data", [{}])[0]
    text = f"{data.get('title', '')} {data.get('description', '')}".lower()
    return any(k in text for k in ("hubble", "webb", "jwst", "chandra", "spitzer", "telescope"))


def _filter_items(items):
    out = []
    for item in items:
        data = item.get("data", [{}])[0]
        title = data.get("title", "")
        desc = data.get("description", "") or ""
        if NON_ASTRONOMY_REGEX.search(title) or NON_ASTRONOMY_REGEX.search(desc):
            continue
        out.append(item)
    return out


def search_nasa(query, exclude_urls=None, year_start=None, year_end=None):
    """Search + filter + rank. Returns the best candidate dict or None.
    NOTE: exclude_urls is mutated in place (dedup across a production)."""
    if exclude_urls is None:
        exclude_urls = set()
    clean = _clean(query)[:60].strip()
    if not clean:
        return None

    def do_search(q):
        params = {"q": q, "media_type": "image"}
        if year_start:
            params["year_start"] = year_start
        if year_end:
            params["year_end"] = year_end
        try:
            return _http_json(f"{API}?{urllib.parse.urlencode(params)}")
        except Exception:
            return None

    res = do_search(clean)
    items = _filter_items((res or {}).get("collection", {}).get("items", []))

    # simplified retry (first two significant words)
    if not items:
        words = [w for w in clean.split() if len(w) > 3]
        if len(words) > 1:
            res = do_search(" ".join(words[:2]))
            items = _filter_items((res or {}).get("collection", {}).get("items", []))

    if not items:
        return None

    # genuine telescope captures first
    items.sort(key=_is_telescope_priority, reverse=True)

    for item in items[:10]:
        data = item.get("data", [{}])[0]
        title = data.get("title") or clean
        nasa_id = data.get("nasa_id")
        collection_url = item.get("href")
        thumb = (item.get("links") or [{}])[0].get("href")
        if not collection_url:
            continue
        if NON_ASTRONOMY_REGEX.search(title):
            continue
        try:
            files = _http_json(collection_url, timeout=8)
        except Exception:
            continue
        if not isinstance(files, list):
            continue

        # full-resolution first: ~orig is the archive's master (large/medium
        # are downscaled renditions — using them is what made longs pixelated)
        best = (next((f for f in files if "~orig.jpg" in f and not f.endswith(".tif")), None)
                or next((f for f in files if "~large.jpg" in f), None)
                or next((f for f in files if "~medium.jpg" in f), None)
                or next((f for f in files if "~small.jpg" in f), None)
                or next((f for f in files if f.endswith(".jpg") or f.endswith(".png")), None)
                or thumb)
        if not best:
            continue
        secure = urllib.parse.quote(best.replace("http://", "https://"), safe=":/~._-")
        if secure in exclude_urls:
            continue
        exclude_urls.add(secure)
        return {
            "url": secure,
            "title": title,
            "nasa_id": nasa_id,
            "description": (data.get("description") or "")[:300],
            "date_created": data.get("date_created", ""),
            "center": data.get("center", ""),
            "details_url": (f"https://images.nasa.gov/details-{urllib.parse.quote(nasa_id)}.html"
                            if nasa_id else None),
            "preview_url": urllib.parse.quote(str(thumb).replace("http://", "https://"),
                                              safe=":/~._-") if thumb else secure,
        }
    return None


def download_nasa(url, out_path, timeout=60):
    """Download a NASA asset. Returns the bytes written or raises."""
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = r.read()
    if len(data) < 4096:
        raise RuntimeError(f"suspiciously small asset ({len(data)}B)")
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    with open(out_path, "wb") as f:
        f.write(data)
    return len(data)


def fetch_nasa_image(query, out_path, exclude_urls=None, fallback_title=""):
    """Full NASA-first resolution: keywords -> search -> download.
    Returns metadata dict on success, None when NASA has no authentic match
    (caller should fall back to AI generation)."""
    q = extract_astronomy_keywords(query, fallback_title)
    hit = search_nasa(q, exclude_urls=exclude_urls)
    if not hit:
        # one more try with the raw query if keyword extraction lost the object
        if q != _clean(query)[:60]:
            hit = search_nasa(_clean(query)[:60], exclude_urls=exclude_urls)
        if not hit:
            return None
    try:
        size = download_nasa(hit["url"], out_path)
    except Exception:
        return None
    return {**hit, "query": q, "path": os.path.abspath(out_path), "bytes": size}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("query")
    ap.add_argument("--out", default=None)
    ap.add_argument("--json", action="store_true", help="search only, print candidates as JSON")
    args = ap.parse_args()

    if args.json:
        hit = search_nasa(extract_astronomy_keywords(args.query))
        print(json.dumps(hit, indent=2, ensure_ascii=False))
        return

    if not args.out:
        sys.exit("--out required (or --json)")
    hit = fetch_nasa_image(args.query, args.out)
    if hit:
        print(json.dumps({"status": "ready", **hit}, indent=2, ensure_ascii=False))
    else:
        print(json.dumps({"status": "no_match", "query": args.query}))
        sys.exit(2)


if __name__ == "__main__":
    main()
