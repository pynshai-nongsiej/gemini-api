import React from 'react';
import { AbsoluteFill, useCurrentFrame, interpolate, Easing } from 'remotion';
import { KenBurnsImage } from './story';
import { AccentText } from './finance';

// =============================================================================
// archival.tsx — the NARRATIVE HISTORY edit format's visual language.
//
// EVIDENCE FIRST: every frame looks like an evidence reel —
//   - archival photo with a documentary film grade (sepia-warm shadows,
//     lifted blacks, gentle vignette) and deliberate Ken Burns moves
//   - a typewriter-style DATE/PLACE stamp punched over the evidence
//   - a provenance tag (Wikimedia Commons · 1911, AI reconstruction …)
// The archival imagery must never be mistaken for AI; the grade + tags make
// the source part of the storytelling.
// =============================================================================

const easeOut = Easing.out(Easing.cubic);

/** Film grade over ANY child: warm documentary tone, lifted blacks, vignette,
 *  and a slow flicker so even a still reads as a film element. */
export const FilmGrade: React.FC<{ strength?: number; children?: React.ReactNode }> = ({
  strength = 1, children,
}) => {
  const frame = useCurrentFrame();
  const flicker = 0.965 + 0.035 * Math.sin(frame / 5.3) * Math.sin(frame / 2.1);
  return (
    <>
      {children}
      <AbsoluteFill style={{
        background: `rgba(28, 20, 8, ${0.16 * strength})`,
        mixBlendMode: 'multiply',
        opacity: flicker,
      }} />
      <AbsoluteFill style={{
        background: `radial-gradient(ellipse at center, transparent 52%, rgba(10, 6, 2, ${0.5 * strength}) 100%)`,
      }} />
    </>
  );
};

/** Archival image: Ken Burns motion + film grade, wrapped as one beat layer. */
export const ArchivalImage: React.FC<{
  src: string;
  dur: number;
  move?: string;
  intensity?: number;
  fadeIn?: number;
  tag?: string;      // date/place stamp, e.g. "JULY 17, 1981"
  source?: string;   // provenance label, e.g. "Wikimedia Commons · 1981"
}> = ({ src, dur, move, intensity = 1, fadeIn = 14, tag, source }) => (
  <>
    <KenBurnsImage src={src} dur={dur} move={move} intensity={Math.min(intensity, 1.05)} fadeIn={fadeIn} />
    <FilmGrade />
    {tag ? <EvidenceStamp text={tag} /> : null}
    {source ? <SourceTag text={source} /> : null}
  </>
);

/** Typewriter-style date/place stamp — punched hard over the evidence. */
export const EvidenceStamp: React.FC<{ text: string }> = ({ text }) => {
  const frame = useCurrentFrame();
  if (!text) return null;
  const punch = interpolate(frame, [0, 8], [1.6, 1], { extrapolateRight: 'clamp', easing: easeOut });
  const fade = interpolate(frame, [0, 6], [0, 1], { extrapolateRight: 'clamp' });
  const chars = Math.floor(interpolate(frame, [2, 16], [0, text.length], { extrapolateRight: 'clamp', extrapolateLeft: 'clamp' }));
  const typing = chars < text.length; // cursor only while the stamp is typing
  return (
    <AbsoluteFill style={{ justifyContent: 'flex-start', alignItems: 'flex-start', padding: '150px 54px', opacity: fade }}>
      <div style={{
        transform: `scale(${punch})`, transformOrigin: 'top left',
        fontFamily: '"JetBrains Mono", "Courier New", monospace', fontWeight: 700,
        fontSize: 46, letterSpacing: 3, color: '#f2e8d5',
        background: 'rgba(12, 9, 5, 0.66)', border: '2px solid rgba(242, 232, 213, 0.85)',
        padding: '12px 22px', textShadow: '0 2px 10px rgba(0,0,0,0.8)',
      }}>
        {text.slice(0, chars)}{typing ? <span style={{ opacity: chars % 2 ? 1 : 0.25 }}>|</span> : null}
      </div>
    </AbsoluteFill>
  );
};

/** Provenance credit, bottom-left — small, honest, always visible. */
export const SourceTag: React.FC<{ text: string }> = ({ text }) => {
  const frame = useCurrentFrame();
  if (!text) return null;
  const fade = interpolate(frame, [6, 14], [0, 1], { extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'flex-start', padding: '0 54px 214px', opacity: fade * 0.92 }}>
      <div style={{
        fontFamily: '"JetBrains Mono", monospace', fontSize: 22, letterSpacing: 1,
        color: '#d8cdb6', background: 'rgba(12, 9, 5, 0.5)', padding: '6px 14px',
        borderRadius: 6,
      }}>
        {text}
      </div>
    </AbsoluteFill>
  );
};

/** ALL-CAPS banner over frame 0 (shares the finance hook-card convention:
 *  _underscored_ words render in the accent color). */
export const HookCard: React.FC<{ text: string; accent: string }> = ({ text, accent }) => {
  const frame = useCurrentFrame();
  const rise = interpolate(frame, [0, 12], [40, 0], { extrapolateRight: 'clamp', easing: easeOut });
  const fade = interpolate(frame, [0, 8], [0, 1], { extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ justifyContent: 'flex-start', alignItems: 'center', paddingTop: 320, opacity: fade }}>
      <div style={{
        transform: `translateY(${rise}px)`,
        background: 'rgba(12, 9, 5, 0.62)',
        border: '1px solid rgba(245, 215, 110, 0.35)',
        borderRadius: 14, padding: '18px 30px', maxWidth: '88%',
      }}>
        <AccentText text={text} accent={accent} size={58} />
      </div>
    </AbsoluteFill>
  );
};
