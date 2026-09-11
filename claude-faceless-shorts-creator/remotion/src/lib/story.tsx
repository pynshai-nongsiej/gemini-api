// Storybook kit — animated stills for the image-driven STORY shorts (kids, manga…).
// One new niche lib for the whole story-shorts series. Ken-burns over a full-bleed AI
// image; base scale stays >= 1.12 so soft watercolor "paper" edges always crop OUTSIDE
// the 1080x1920 frame (the AI stills often bleed to a deckled white border). Motion
// varies per beat via `variant` so no two adjacent beats drift the same way.
import React from 'react';
import { AbsoluteFill, Easing, Img, staticFile, useCurrentFrame } from 'remotion';
import { EASE_INOUT, prog } from './shorts';

// =============================================================================
// CAMERA SYSTEM — named moves at intensity 1.0 (the designed amplitude).
// intensity < 1 softens the move (hook, calm setup beats), > 1 amplifies it
// (reveal, twist, explosion) — the progressive "documentary cinematography"
// curve: calm approach -> building -> payoff.
//
// Scale stays >= ~1.06 so the cover-crop never shows an edge; translate stays
// within the zoom margin. Orbit moves add a tiny rotation (sub-degree) for a
// parallax feel — the margin math still hides the corners.
// =============================================================================
export type CameraMoveName =
  | 'push-in' | 'pull-back' | 'orbit-left' | 'orbit-right' | 'drift-up'
  | 'drift-down' | 'pan-left' | 'pan-right' | 'crash-zoom' | 'settle';

type CameraMove = {
  s: [number, number]; // scale from -> to
  x: [number, number]; // translate % across
  y: [number, number]; // translate % vertical
  r?: [number, number]; // rotation deg (orbital feel)
  ease?: 'inout' | 'in' | 'out';
};

export const CAMERA_MOVES: Record<CameraMoveName, CameraMove> = {
  'push-in': { s: [1.06, 1.26], x: [0, 0], y: [0, -1] },
  'pull-back': { s: [1.3, 1.08], x: [0, 0], y: [0, 0.5] },
  'orbit-left': { s: [1.14, 1.24], x: [2.2, -2.2], y: [0.6, -0.6], r: [0.7, -0.7] },
  'orbit-right': { s: [1.14, 1.24], x: [-2.2, 2.2], y: [0.6, -0.6], r: [-0.7, 0.7] },
  'drift-up': { s: [1.16, 1.22], x: [0, 0], y: [2, -2] },
  'drift-down': { s: [1.16, 1.22], x: [0, 0], y: [-2, 2] },
  'pan-left': { s: [1.16, 1.22], x: [2.2, -2.2], y: [0, 0] },
  'pan-right': { s: [1.16, 1.22], x: [-2.2, 2.2], y: [0, 0] },
  'crash-zoom': { s: [1.02, 1.5], x: [0, 0], y: [0, -1.5], ease: 'in' },
  'settle': { s: [1.24, 1.12], x: [1, 0], y: [0.5, 0], ease: 'out' },
};

// legacy numeric `variant` (pre-camera-move compositions) -> move names
const LEGACY_VARIANTS: CameraMoveName[] = [
  'push-in', 'settle', 'pan-right', 'drift-down', 'pan-left', 'push-in',
];

const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
const amp = (pair: [number, number], k: number): [number, number] => [
  lerp(pair[0], pair[1], (1 - k) / 2),
  lerp(pair[0], pair[1], (1 + k) / 2),
];

export const KenBurnsImage: React.FC<{
  src: string; //     staticFile path, e.g. 'projects/short-7-kids/b1-hook.png'
  dur: number; //     sequence length in frames (motion spans this)
  variant?: number; // legacy index into the old preset list
  move?: string; //   camera move name (overrides variant)
  intensity?: number; // motion amplitude multiplier (0.2 calm … 1.4 dramatic)
  fadeIn?: number; // frames to fade in (0 = fully composed at frame 0 — hook rule)
}> = ({ src, dur, variant = 0, move, intensity = 1, fadeIn = 14 }) => {
  const frame = useCurrentFrame();
  const known = move && move in CAMERA_MOVES;
  const name = (known ? move : LEGACY_VARIANTS[variant % LEGACY_VARIANTS.length]) as CameraMoveName;
  const m = CAMERA_MOVES[name];
  const k = Math.max(0.2, Math.min(1.4, intensity));
  const p = name === 'crash-zoom'
    ? Easing.in(Easing.cubic)(prog(frame, 0, dur))
    : name === 'settle'
      ? Easing.out(Easing.cubic)(prog(frame, 0, dur))
      : EASE_INOUT(prog(frame, 0, dur));
  const [s0, s1] = amp(m.s, k);
  const [x0, x1] = amp(m.x, k);
  const [y0, y1] = amp(m.y, k);
  const scale = lerp(s0, s1, p);
  const tx = lerp(x0, x1, p);
  const ty = lerp(y0, y1, p);
  const rot = m.r ? (() => { const [r0, r1] = amp(m.r, k); return lerp(r0, r1, p); })() : 0;
  const opacity = fadeIn > 0 ? prog(frame, 0, fadeIn) : 1;
  return (
    <AbsoluteFill style={{ opacity }}>
      <Img
        src={staticFile(src)}
        style={{
          position: 'absolute',
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: `scale(${scale}) translate(${tx}%, ${ty}%) rotate(${rot}deg)`,
          transformOrigin: 'center center',
        }}
      />
    </AbsoluteFill>
  );
};

// Soft dark vignette to seat captions and focus the eye — gentle, storybook.
export const StoryVignette: React.FC<{ strength?: number }> = ({ strength = 0.42 }) => (
  <AbsoluteFill
    style={{
      background: `radial-gradient(ellipse 108% 82% at 50% 44%, transparent 46%, rgba(20,16,30,${strength}) 100%)`,
      pointerEvents: 'none',
    }}
  />
);
