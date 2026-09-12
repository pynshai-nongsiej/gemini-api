#!/usr/bin/env python3
"""
variation.py — the ANTI-TEMPLATE engine.

YouTube's inauthentic-content policy (July 2025) targets mass-produced,
templated output. This module gives every production a deterministic but
VARIED creative fingerprint derived from its project id, so no two shorts
(or longs) on a channel share the same "template look":

  accent             12-color palette (was 5, sequential — consecutive
                     shorts always looked like siblings)
  caption_style      plate | bare | bar     (captions treatment)
  hook_placement     top | center            (hook card position)
  transition_density subtle | standard | bold (how many beat-change overlays)
  engagement         comment_bait | poll_choice | pause_challenge | exact_figure
                     (which comment-driving device the script's quiz uses)
  chapter_style      centered | editorial     (long-form chapter cards)

Same project id -> same fingerprint (resumable, reproducible); different
projects on the same channel -> meaningfully different edits.
"""
import hashlib

PALETTES = [
    "#f5d76e", "#7dd3fc", "#a78bfa", "#fda4af", "#86efac",
    "#f9a8d4", "#6ee7b7", "#fdba74", "#93c5fd", "#d8b4fe",
    "#fde68a", "#67e8f9",
]

CAPTION_STYLES = ["plate", "bare", "bar"]
HOOK_PLACEMENTS = ["top", "center"]
TRANSITION_DENSITY = ["subtle", "standard", "bold"]
ENGAGEMENT_DEVICES = ["comment_bait", "poll_choice", "pause_challenge", "exact_figure"]
CHAPTER_STYLES = ["centered", "editorial"]


def derive(proj_id):
    """Deterministic variation fingerprint for a project id."""
    h = hashlib.sha256(str(proj_id).encode()).hexdigest()

    def pick(seq, k):
        return seq[int(h[k * 4:k * 4 + 4], 16) % len(seq)]

    return {
        "accent": pick(PALETTES, 0),
        "caption_style": pick(CAPTION_STYLES, 1),
        "hook_placement": pick(HOOK_PLACEMENTS, 2),
        "transition_density": pick(TRANSITION_DENSITY, 3),
        "engagement": pick(ENGAGEMENT_DEVICES, 4),
        "chapter_style": pick(CHAPTER_STYLES, 5),
    }


# engagement device -> per-grammar quiz instruction
ENGAGEMENT_INSTRUCTIONS = {
    "comment_bait": (
        "ENGAGEMENT DEVICE (this video): the quiz asks viewers to drop their own "
        "answer/number in the comments ('comment yours', 'wrong answers only')."),
    "poll_choice": (
        "ENGAGEMENT DEVICE (this video): the quiz poses an A-or-B choice and asks "
        "viewers to type just A or B in the comments."),
    "pause_challenge": (
        "ENGAGEMENT DEVICE (this video): the quiz challenges the viewer to PAUSE the "
        "video and verify the claim themselves before you continue ('pause the video "
        "and check your own statement')."),
    "exact_figure": (
        "ENGAGEMENT DEVICE (this video): the quiz asks viewers to type the EXACT figure "
        "from their own situation (their rate, their year, their count) in the comments."),
}

# transition density -> which beat changes get an overlay
DENSITY_BEATS = {
    "subtle": {"reveal", "twist"},
    "standard": None,   # default picker (whip/wipe cycle etc.)
    "bold": None,       # default picker, plus quiz gets one too
}


def allowed_transition_beats(density):
    """Beat names that may carry a transition overlay for this density."""
    if density == "subtle":
        return {"reveal", "twist"}
    if density == "bold":
        return {"setup", "quiz", "reveal", "twist", "loop"}
    return {"setup", "quiz", "reveal", "twist", "loop"}


if __name__ == "__main__":
    import json
    import sys
    for pid in sys.argv[1:] or ["fin-1-demo", "fin-2-demo", "hist-1-demo"]:
        print(pid, "->", json.dumps(derive(pid)))
