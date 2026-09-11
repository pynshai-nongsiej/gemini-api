import React from 'react';
import { AbsoluteFill, useCurrentFrame, interpolate, Easing } from 'remotion';

// =============================================================================
// transitions.tsx — beat-change punctuation for the generated compositions.
//
// Each overlay plays in the ~8 frames STRADDLING a beat cut and reads as an
// editorial transition, matched with the SFX plan's cut cue:
//   whip-pan  motion-blur streak across the cut — hard, fast, "next fact"
//   flash     a one-frame color bloom — the number/reveal lands
//   glitch    RGB-split bars — system/money "data" energy
//   wipe      dark panel wipe with an accent edge — archival scene change
//   rewind    reverse streak — history: going back to the evidence
// =============================================================================

const easeIn = Easing.in(Easing.cubic);
const easeOut = Easing.out(Easing.cubic);

export type TransitionKind = 'whip-pan' | 'flash' | 'glitch' | 'wipe' | 'rewind' | 'flare';

export const Transition: React.FC<{
  kind: TransitionKind;
  dur: number; // frames the overlay lives for (use 7-9)
  accent?: string;
  label?: string; // wipe can carry the next beat's stamp
}> = ({ kind, dur, accent = '#f5d76e', label }) => {
  const frame = useCurrentFrame();
  const p = Math.min(1, Math.max(0, frame / Math.max(1, dur)));
  switch (kind) {
    case 'flash': {
      const opacity = p < 0.35 ? p / 0.35 : 1 - easeOut((p - 0.35) / 0.65);
      return (
        <AbsoluteFill style={{ background: accent, opacity: 0.85 * opacity, mixBlendMode: 'screen' }} />
      );
    }
    case 'glitch': {
      const visible = p < 0.7;
      const off = (1 - p) * 26;
      const n = 5;
      return (
        <AbsoluteFill style={{ opacity: visible ? 1 : 0 }}>
          {Array.from({ length: n }).map((_, i) => {
            const y = ((i * 191 + frame * 97) % 100) + '%';
            const h = 3 + ((i * 37) % 9);
            const dir = i % 2 === 0 ? 1 : -1;
            return (
              <div key={i} style={{
                position: 'absolute', top: y, left: 0, right: 0, height: `${h}%`,
                transform: `translateX(${dir * off}px)`,
                background: i % 3 === 0 ? `${accent}33` : 'rgba(140,180,255,0.14)',
                mixBlendMode: 'screen',
              }} />
            );
          })}
        </AbsoluteFill>
      );
    }
    case 'wipe': {
      const x = interpolate(easeIn(p), [0, 1], ['-102%', '0%']);
      const exit = interpolate(p, [0.55, 1], ['0%', '-102%'], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
      return (
        <AbsoluteFill>
          <div style={{
            position: 'absolute', inset: 0,
            transform: `translateX(calc(${x} + ${exit}))`,
            background: '#0b0a08',
            borderRight: `6px solid ${accent}`,
            boxShadow: '-20px 0 60px rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'flex-end', padding: '0 0 260px 60px',
          }}>
            {label ? (
              <span style={{
                fontFamily: '"JetBrains Mono", monospace', fontWeight: 700, fontSize: 40,
                letterSpacing: 3, color: '#f2e8d5', opacity: p < 0.5 ? 0 : (p - 0.5) * 3,
              }}>{label}</span>
            ) : null}
          </div>
        </AbsoluteFill>
      );
    }
    case 'rewind': {
      const x = interpolate(easeOut(1 - p), [0, 1], ['-102%', '0%']);
      const opacity = 1 - Math.max(0, (p - 0.6) / 0.4);
      return (
        <AbsoluteFill style={{ opacity }}>
          <div style={{
            position: 'absolute', inset: 0, transform: `translateX(${x}%)`,
            background: `repeating-linear-gradient(90deg, rgba(15,12,8,0.95) 0 40px, rgba(35,28,16,0.95) 40px 80px)`,
            borderLeft: `6px solid ${accent}`,
            boxShadow: '20px 0 60px rgba(0,0,0,0.6)',
          }} />
        </AbsoluteFill>
      );
    }
    case 'flare': {
      // space pipeline: a lens-flare light leak blooms over the cut — cosmic
      // reveal energy without a hard editorial cut
      const bloom = p < 0.4 ? easeOut(p / 0.4) : 1 - easeOut((p - 0.4) / 0.6);
      const cx = 50 + Math.sin(frame * 1.7) * 4;
      const cy = 42 + Math.cos(frame * 1.3) * 3;
      return (
        <AbsoluteFill style={{ opacity: Math.max(0, bloom) }}>
          <div style={{
            position: 'absolute', inset: 0,
            background: `radial-gradient(circle at ${cx}% ${cy}%, rgba(255,240,200,0.9) 0%, ${accent}66 18%, transparent 55%)`,
            mixBlendMode: 'screen',
          }} />
          <div style={{
            position: 'absolute', left: '-20%', right: '-20%', top: `${cy - 1.2}%`, height: '2.4%',
            transform: `rotate(${Math.sin(frame * 0.9) * 8 - 12}deg)`,
            background: `linear-gradient(90deg, transparent, rgba(255,255,255,0.85) 45%, ${accent}aa 55%, transparent)`,
            filter: 'blur(10px)', mixBlendMode: 'screen',
          }} />
        </AbsoluteFill>
      );
    }
    case 'whip-pan':
    default: {
      // a motion-blur streak sweeps across; underneath it the cut already happened
      const x = interpolate(easeOut(p), [0, 1], ['-115%', '115%']);
      return (
        <AbsoluteFill style={{ pointerEvents: 'none' }}>
          <div style={{
            position: 'absolute', top: 0, bottom: 0, width: '70%',
            transform: `translateX(${x}%) skewX(-12deg)`,
            background: `linear-gradient(90deg, transparent, rgba(255,255,255,0.75) 35%, ${accent}cc 50%, rgba(255,255,255,0.75) 65%, transparent)`,
            filter: 'blur(18px)',
            mixBlendMode: 'screen',
            opacity: 1 - Math.max(0, (p - 0.7) / 0.3),
          }} />
        </AbsoluteFill>
      );
    }
  }
};

/** transition picked for a beat change — deterministic, beat-pair aware.
 *  Returns null where the pipeline stays soft (space setup/quiz keep their
 *  gentle crossfades). */
export function transitionFor(nextBeat: string, i: number, pipeline: string): TransitionKind | null {
  if (pipeline === 'space') {
    if (nextBeat === 'reveal') return 'flare';
    if (nextBeat === 'twist') return 'whip-pan';
    return null;
  }
  if (nextBeat === 'reveal') return pipeline === 'history' ? 'rewind' : 'flash';
  if (nextBeat === 'twist') return pipeline === 'history' ? 'wipe' : 'glitch';
  const cycle: TransitionKind[] = ['whip-pan', 'wipe', 'whip-pan', 'glitch'];
  return cycle[i % cycle.length];
}
