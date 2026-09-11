# CLAUDE.md — claude-faceless-shorts-creator

A **faceless-shorts factory** driven by Claude Code. Three production tracks, one repo — the
right skill is picked automatically from the request:

| The user asks for… | Skill | Pixels come from | Projects live in |
|---|---|---|---|
| "make a short about X" (default) | `/make-short` | 100% TSX (Remotion animation) | `shorts/short-N-<niche>/` |
| "make an AI video short", "blue-man video" | `/make-ai-short` | a fal video model (locked recurring character) | `ai-shorts/<series>/` |
| "vox style / documentary / explainer short" | `/make-vox` | layered paper-collage (AI images + cutouts) | `vox-shorts/vox-N-<topic>/` |

All three share the same backbone: a `beats.json` contract, ElevenLabs voice with word-exact
captions (`gen_voice.py`), frame-by-frame QA at phone scale, library-first SFX (`/suggest-sfx`),
optional music bed, seamless frame-0==last-frame loops, no CTA outros. TSX crash rules live in
`/vidtsx-2d-generator`.

## Multi-channel automation (operator)

The operator dashboard (`./launch.sh operator` → localhost:3457) automates **multiple YouTube
channels** in parallel. Channels live in the `channels` DB table (seeded: `cosmic-archive`
space · `wealth-engine` finance · `footnote-files` history); each has its own niche, voice,
publish slots, cadence, and YouTube OAuth tokens (`operator/data/youtube_tokens[_<channel>].json`).
The **Channels tab** is the automation hub: per-channel auto-research, generation stats,
YouTube connect, and add/edit channels.

`tools/make_short.py --pipeline space|finance|history` switches the whole pipeline:
script grammar (`gen_script.py` / `gen_script_finance.py` / `gen_script_history.py`),
imagery strategy, and Remotion edit format (`lib/story` / `lib/finance` / `lib/archival`).
Real-archive-first sourcing for every pipeline — see **IMAGERY-SOURCES.md** (NASA,
Wikimedia, LoC, Openverse, Met, archive.org footage; AI only as labeled fallback).

**Growth loop** (2026 Shorts-algorithm driven): per-channel target durations
(completion lever), A/B hook races (`POST /api/channels/:id/start {"variants":3}` —
one topic, 3 hook angles, the feed votes), micro-cuts (visual change every ~2.5s
inside a voice line), comment-bait quiz beats, weighted slots (Fri PM / weekend AM
bonus slots), and a retention feedback loop — `refreshRetention` pulls
averageViewPercentage per published short (needs one re-auth per channel for the
new analytics scope) and `winningHooks` feeds 70%+ retention hooks back into
topic research. Monetization guard: the July 2025 "inauthentic content" policy
targets templated mass-production — keep the human review gate ON and the three
channels' formats distinct.

## Layout

```
tools/            Python tools: gen_voice, gen_sfx, gen_music, mix_sfx, mix_music, gen_chords,
                  gen_image, gen_clip, bakeoff_clip, cutout, capture_web
remotion/         the Remotion project — src/lib/ (shared + niche kits incl. collage.tsx),
                  src/shots/{short-N, ai-N, vox-N}/
media/            Remotion's public root: library/ (reusable: sfx, music, logos)
                  + projects/<proj>/ (media for ONE video — incl. committed AI clips & layers)
shorts/           TSX shorts: script.md, beats.json, sfx-plan.json each
ai-shorts/        generative shorts: + character.json (LOCKED reference), shot sidecars, IDEAS.md
vox-shorts/       collage shorts: + DESIGN.md (the visual language — read before any vox work)
brand.md          the style contract every skill reads (palette, motion, safe areas, SFX taste)
IDEAS.md          the TSX-shorts idea bank + niche ranking
.claude/skills/   make-short, make-ai-short, make-vox, vidtsx-2d-generator, suggest-sfx
```

## Conventions (hard rules)

- **Run everything from the repo root.** Tools resolve engine paths (media/library, catalogs)
  against their own location, but project paths (`shorts/...`) against the CWD.
- **Python:** any Python 3.10+ — the core pipeline is stdlib-only. Only vox layer production
  needs extras: `pip install pillow rembg` (cutout.py) and `pip install playwright &&
  playwright install chromium` (capture_web.py). `ffmpeg`/`ffprobe` and `node`/`npx` on PATH.
- **API keys** live in `.env` at the repo root (copy `.env.example`). Never commit `.env`.
  ELEVENLABS_API_KEY = voice/SFX/music · FAL_KEY = AI clips + images · GEMINI_API_KEY = images.
- **Registry is generated:** after adding/renaming a shot, `cd remotion && npm run gen`
  (frames.mjs/render-all.mjs do NOT run it themselves).
- **Media rules:** `media/library/` is for CROSS-VIDEO reusable assets only (each with a
  catalog). Anything generated FOR ONE video (story frames, AI clips, collage layers) goes in
  `media/projects/<proj>/`, referenced as `staticFile('projects/<proj>/x')`. Reuse before you
  generate — check the catalogs first.
- **Committed vs gitignored media:** AI-generated clips and collage layers in
  `media/projects/` ARE committed (paid, non-reproducible pixels). `*/voice/` and `*/output/`
  are gitignored everywhere (regenerable); `ai-shorts/*/shots/*.mp4` working copies too — the
  canonical clip lives in `media/projects/<name>/`.
- **Costs (ai-shorts only):** state the derived generation cost BEFORE spending it, and never
  regenerate a locked character from text (see /make-ai-short's iron rules).
- **QA is not optional:** render frames at phone scale and READ them before any full render.
