#!/usr/bin/env python3
"""
image_registry.py — cross-project dedup for real archive imagery.

Every NASA / Wikimedia / LoC / Openverse / Met asset ever downloaded is
recorded here (media/library/image_registry.json) keyed by source URL.
The pipelines exclude everything in the registry when picking new beat
images, so no two shorts on a channel share the same photograph. If a
query exhausts every unused asset, callers may retry WITHOUT the
registry exclusion (a rare, honest repeat beats an irrelevant AI image)
and the reuse is recorded.
"""
import json
import os
import threading

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REGISTRY = os.path.join(ROOT, "media", "library", "image_registry.json")
_lock = threading.Lock()


def _load():
    if os.path.exists(REGISTRY):
        try:
            return json.load(open(REGISTRY, encoding="utf-8"))
        except (ValueError, OSError):
            return {}
    return {}


def _save(reg):
    os.makedirs(os.path.dirname(REGISTRY), exist_ok=True)
    tmp = REGISTRY + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(reg, f, indent=2, ensure_ascii=False)
        f.write("\n")
    os.replace(tmp, REGISTRY)


def used_urls():
    """Every source URL already used by any previous production."""
    return set(_load().keys())


def mark(url, project, title=""):
    """Record a source URL as used by a project."""
    if not url:
        return
    with _lock:
        reg = _load()
        reg[url.split("?")[0]] = {"project": project, "title": str(title)[:120],
                                  "used_at": __import__("time").strftime("%Y-%m-%d")}
        _save(reg)


def stats():
    reg = _load()
    return {"tracked": len(reg)}


def backfill(projects_root):
    """Seed the registry from every existing project's images.json manifest."""
    import glob
    n = 0
    for mf in glob.glob(os.path.join(projects_root, "*", "images.json")):
        proj = os.path.basename(os.path.dirname(mf))
        try:
            manifest = json.load(open(mf, encoding="utf-8"))
        except (ValueError, OSError):
            continue
        for e in manifest:
            if e.get("url") and e.get("source") not in (None, "ai"):
                was = len(_load())
                mark(e["url"], proj, e.get("title") or "")
                if len(_load()) > was:
                    n += 1
    return n


if __name__ == "__main__":
    import sys
    if "--reset" in sys.argv:
        _save({})
        print("registry cleared")
    s = stats()
    print(f"image registry: {s['tracked']} source URLs tracked")
    if "--backfill" in sys.argv:
        added = backfill(os.path.join(ROOT, "media", "projects"))
        print(f"backfilled {added} URLs from existing projects")
