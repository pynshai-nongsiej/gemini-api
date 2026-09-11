# Imagery & Footage Sourcing — how the pipelines get pixels

Every pipeline resolves each beat **real-imagery-first** and only falls back to
AI generation when the archives have no authentic match. Provenance is recorded
per beat in `media/projects/<id>/images.json` and shown in the dashboard
(review modal → "Beat imagery") with a source link for every asset.

## Per-pipeline resolution order

| Pipeline | 1st choice | 2nd | 3rd | Edit format |
|---|---|---|---|---|
| **space** (Cosmic Archive) | NASA Image Library (`images-api.nasa.gov`) | Pollinations FLUX | — | Ken Burns + word-pop captions |
| **finance** (Wealth Engine) | Remotion data-graphics (counter / bars / percent / rule — rendered, not photographed) | Pollinations FLUX background plates (dark, text-free) | — | kinetic numbers + hook card |
| **history** (The Footnote Files) | Wikimedia Commons → Library of Congress → Openverse → Met Museum | Pollinations FLUX, era-consistent ("period-accurate 1981, archival documentary photograph") | — | film grade + date stamp + source tag |
| motion beats (history) | archive.org public-domain footage (Prelinger et al., trimmed to 6s) | fal.ai AI clip (needs `FAL_KEY`) | Ken Burns still | sepia-graded clip |

All archive APIs below are **free and keyless**; no API key is required for any
source except the optional fal.ai clip fallback.

## The sources (`tools/archive_media.py`)

1. **Wikimedia Commons** — `commons.wikimedia.org/w/api.php`. Millions of
   historical photos, maps, documents, blueprints. Non-free licenses are
   filtered out automatically; scaled 1400px thumb downloads.
2. **Library of Congress** — `loc.gov/photos/?fo=json`. Photos, newsreels,
   WPA posters, Civil War plates. Public domain / rights-advisory.
3. **Openverse** — `api.openverse.org/v1/images`. Meta-search over CC-licensed
   imagery (Flickr, museums, …); restricted to `all-cc` license types.
4. **Met Museum** — `collectionapi.metmuseum.org`. Public-domain art and
   artifact photography (open-access objects only).
5. **archive.org footage** — `advancedsearch.php` for `mediatype:(movies)`,
   Prelinger Archives ranked first by downloads. Downloaded, trimmed to ≤6s
   (ffmpeg), vertical-cropped 1080×1920 for motion beats. License URL recorded
   per item — verify on the item page before commercial use.

Each hit returns `{source, title, creator, year, license, url, details_url}` —
the composition burns the source tag on-screen (e.g. "Wikimedia Commons · 1981")
and AI fallbacks are labeled "AI reconstruction" so viewers are never misled.

## Testing a query by hand

```bash
python3 tools/archive_media.py "hyatt regency skywalk 1981" --json        # search only
python3 tools/archive_media.py "mercury capsule 1961" --out /tmp/x.jpg    # image
python3 tools/archive_media.py "factory assembly line 1930" --clip --out /tmp/x.mp4  # footage
```

## Space extras (`tools/nasa_media.py`)

NASA Image Library, keyless: keyword extraction with astronomy stopwords,
non-astronomy filtering (diagrams/posters/portraits), telescope-priority
sorting (Hubble/Webb/Chandra/Spitzer), `~large > ~medium > ~orig` asset
preference, low-res rescue via `tools/enhance_image.py`.

## AI fallback (`tools/gen_image.py`)

Pollinations FLUX (free, keyless). Finance prompts get "no text, no numbers"
appended (the graphic layer carries the message); history prompts get
"period-accurate <year>, archival documentary photograph". 3-attempt backoff,
magic-byte validation, auto upscaling when the engine delivers undersized files.

## Sound effects (`tools/fetch_sfx.py`)

The shared library (`media/library/sfx/`, catalog + `clips/*.mp3`) is extended
by keyless downloads from **Wikimedia Commons audio** — free licenses only
(CC0/PD/CC-BY/CC-BY-SA), speech/podcast junk filtered out, files capped at 3MB
and 25s, converted to mp3, with full attribution in
`media/library/sfx/CREDITS.json`. The pack adds transition punctuation
(whip swish, bass drop), finance punctuation (cash register, coins, card swipe)
and history texture (typewriter, projector, film crackle — some sources may
need a re-run when Commons rate-limits: `python3 tools/fetch_sfx.py` resumes).

Commons rate-limits hard (HTTP 429): the fetcher backs off automatically, but
for a big refill run it in the background and expect several minutes.

## Edit-format wiring (transitions + captions + SFX as one system)

- `remotion/src/lib/transitions.tsx` — whip-pan / flash / glitch / wipe /
  rewind overlays generated at every beat change (`transitionFor` in
  `tools/make_short.py` mirrors the picker: reveal gets flash/rewind, twist
  gets glitch/wipe).
- `build_sfx_plan(..., pipeline)` — each cut cue matches its visual transition
  (whip→whip swish, rewind→reverse, wipe→paper slide); finance adds a cash
  register on the hook/reveal graphics.
- Captions take `highlight` — numbers/dollars/percents ("$612", "19%", "1981")
  burn in the accent color through the whole word, on top of the existing
  word-pop animation.

## Rules

- **Reuse before you generate** — check `media/library/` catalogs first.
- **One-video assets** go in `media/projects/<id>/`, referenced via
  `staticFile('projects/<id>/…')`; AI clips and archival downloads ARE
  committed (paid/irreplaceable pixels), `voice/` + `output/` are gitignored.
- **Licenses**: Wikimedia/LoC/Met/Openverse hits carry license metadata in the
  manifest — spot-check anything ambiguous before monetizing; archive.org
  footage items vary (Prelinger is generally safe).
- **AI disclosure**: the operator marks uploads as altered/synthetic content
  (`declare_ai_media` setting) whenever AI pixels are used.
