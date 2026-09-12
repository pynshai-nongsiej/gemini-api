import React from 'react';
import { AbsoluteFill, useCurrentFrame, interpolate, Easing } from 'remotion';

// =============================================================================
// finance.tsx — the PERSONAL FINANCE edit format's kinetic data-graphic layer.
//
// The numbers ARE the visuals: each beat renders one graphic on top of a dark
// background plate —
//   counter  huge value that snaps/counts in, label under it
//   bars     horizontal comparison bars (statBars: ["Label=Value", ...])
//   percent  percent dial / fill gauge
//   rule     framework card (e.g. "20 / 4 / 10")
// plus an optional ALL-CAPS kinetic onScreen line. Design: flat, high-contrast,
// tabular numerals, one accent color — the "clean spreadsheet" aesthetic.
// =============================================================================

const easeOut = Easing.out(Easing.cubic);

/** "_WORD_" spans render in the accent color (same convention as hookCard) */
export const AccentText: React.FC<{ text: string; accent: string; size?: number; weight?: number }> = ({
  text, accent, size = 54, weight = 900,
}) => {
  const parts = String(text || '').split(/(_[^_]+_)/g).filter(Boolean);
  return (
    <div style={{
      fontFamily: 'Inter, sans-serif', fontSize: size, fontWeight: weight,
      letterSpacing: 2, color: '#f4f2ee', textTransform: 'uppercase',
      textAlign: 'center', lineHeight: 1.18, textShadow: '0 2px 18px rgba(0,0,0,0.65)',
    }}>
      {parts.map((p, i) => p.startsWith('_') && p.endsWith('_') ? (
        <span key={i} style={{ color: accent }}>{p.slice(1, -1)}</span>
      ) : (
        <span key={i}>{p}</span>
      ))}
    </div>
  );
};

/** ALL-CAPS banner over frame 0. placement rotates per video (anti-template). */
export const HookCard: React.FC<{ text: string; accent: string; placement?: 'top' | 'center' }> = ({ text, accent, placement = 'top' }) => {
  const frame = useCurrentFrame();
  const rise = interpolate(frame, [0, 12], [40, 0], { extrapolateRight: 'clamp', easing: easeOut });
  const fade = interpolate(frame, [0, 8], [0, 1], { extrapolateRight: 'clamp' });
  const centered = placement === 'center';
  return (
    <AbsoluteFill style={{
      justifyContent: centered ? 'center' : 'flex-start',
      alignItems: 'center', paddingTop: centered ? 0 : 170, opacity: fade,
    }}>
      <div style={{
        transform: `translateY(${rise}px)`,
        background: 'rgba(10, 12, 16, 0.55)',
        border: `1px solid ${accent}44`,
        borderRadius: 14, padding: '18px 30px', maxWidth: '88%',
        backdropFilter: 'blur(6px)',
      }}>
        <AccentText text={text} accent={accent} size={58} />
      </div>
    </AbsoluteFill>
  );
};

const parseBars = (bars: readonly string[] | string[] | null | undefined) =>
  (bars || []).map((b) => {
    const idx = String(b).lastIndexOf('=');
    if (idx === -1) return { label: String(b), value: 1 };
    return { label: String(b).slice(0, idx).trim(), value: parseFloat(String(b).slice(idx + 1)) || 0 };
  });

export const StatLayer: React.FC<{
  graphic: string;                       // counter | bars | percent | rule
  value: string;                         // the number, as text ("$612", "0.01%")
  label: string;                         // caption under the number
  bars?: readonly string[] | null;       // comparison bars for graphic=bars
  onScreen?: string;                     // kinetic ALL-CAPS line (_accent_ words)
  accent: string;
}> = ({ graphic, value, label, bars, onScreen, accent }) => {
  const frame = useCurrentFrame();
  const rise = interpolate(frame, [0, 14], [56, 0], { extrapolateRight: 'clamp', easing: easeOut });
  const fade = interpolate(frame, [0, 10], [0, 1], { extrapolateRight: 'clamp' });
  const slam = interpolate(frame, [0, 9], [1.5, 1], { extrapolateRight: 'clamp', easing: easeOut });

  const numeric = parseFloat(String(value).replace(/[^0-9.]/g, ''));
  const countUp = Number.isFinite(numeric) && numeric > 0 && numeric <= 100000;
  const shown = countUp
    ? String(value).replace(String(numeric), String(Math.round(numeric * Math.min(1, easeOut(frame / 14) * 1.04) * 100) / 100).replace(/\.0+$/, ''))
    : value;

  const barData = parseBars(bars);
  const maxBar = Math.max(1e-9, ...barData.map((b) => Math.abs(b.value)));

  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', opacity: fade }}>
      <div style={{ transform: `translateY(${rise}px)`, width: '86%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>

        {graphic === 'bars' && barData.length > 0 && (
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 18, marginBottom: 26 }}>
            {barData.map((b, i) => {
              const fill = easeOut(Math.max(0, Math.min(1, (frame - 4 - i * 4) / 14)));
              const isTop = Math.abs(b.value) === maxBar;
              return (
                <div key={i}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 700, fontSize: 30, color: '#f4f2ee' }}>{b.label}</span>
                    <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 900, fontSize: 30, color: isTop ? accent : '#9aa3ad' }}>{b.value}</span>
                  </div>
                  <div style={{ height: 16, borderRadius: 8, background: 'rgba(255,255,255,0.12)' }}>
                    <div style={{
                      height: '100%', borderRadius: 8, width: `${fill * (Math.abs(b.value) / maxBar) * 100}%`,
                      background: isTop ? accent : '#7a828c',
                    }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {graphic === 'rule' ? (
          <div style={{
            border: `3px solid ${accent}`, borderRadius: 18, padding: '30px 44px',
            background: 'rgba(10,12,16,0.55)', transform: `scale(${slam})`,
          }}>
            <AccentText text={String(value)} accent={accent} size={110} weight={900} />
          </div>
        ) : graphic !== 'bars' && (
          <div style={{ transform: `scale(${slam})`, textAlign: 'center' }}>
            <div style={{
              fontFamily: 'Inter, sans-serif', fontWeight: 900, fontSize: 168,
              color: accent, letterSpacing: -4, lineHeight: 1,
              textShadow: `0 0 46px ${accent}55, 0 4px 24px rgba(0,0,0,0.7)`,
              fontVariantNumeric: 'tabular-nums',
            }}>{shown}</div>
          </div>
        )}

        {label && (
          <div style={{
            fontFamily: 'Inter, sans-serif', fontWeight: 600, fontSize: 34,
            color: '#c9ced4', marginTop: 14, textAlign: 'center',
          }}>{label}</div>
        )}

        {onScreen && (
          <div style={{ marginTop: 30 }}>
            <AccentText text={onScreen} accent={accent} size={44} />
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};
