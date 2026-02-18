// Prestige badge: inline shield with Roman numeral, colour-coded by level.
import React from 'react';

const PRESTIGE_META = {
  1: { numeral: 'I',   color: '#cd7f32', label: 'Made',             glow: 'rgba(205,127,50,0.35)' },
  2: { numeral: 'II',  color: '#a8a9ad', label: 'Earner',           glow: 'rgba(168,169,173,0.35)' },
  3: { numeral: 'III', color: '#ffd700', label: 'Capo di Capi',     glow: 'rgba(255,215,0,0.35)' },
  4: { numeral: 'IV',  color: '#b9f2ff', label: 'The Don',          glow: 'rgba(185,242,255,0.35)' },
  5: { numeral: 'V',   color: '#dc2626', label: 'Godfather Legacy', glow: 'rgba(220,38,38,0.45)' },
};

export default function PrestigeBadge({ level, size = 'sm', showLabel = false }) {
  if (!level || level < 1 || level > 5) return null;
  const meta = PRESTIGE_META[level];
  const isLg = size === 'lg';
  const isMd = size === 'md';
  const isIcon = size === 'icon'; // same height as profile settings button (h-7 md:h-8)

  const px = isIcon ? 6 : isLg ? 8 : isMd ? 6 : 4;
  const py = isIcon ? 4 : isLg ? 4 : isMd ? 3 : 2;
  const fontSize = isIcon ? 9 : isLg ? 11 : isMd ? 9 : 7;
  const gap = isIcon ? 3 : isLg ? 4 : isMd ? 2 : 2;
  const svgW = isIcon ? 10 : isLg ? 10 : isMd ? 8 : 7;
  const svgH = isIcon ? 12 : isLg ? 12 : isMd ? 10 : 8;

  return (
    <span
      title={`Prestige ${level} — ${meta.label}`}
      className={isIcon ? 'h-7 w-7 md:h-8 md:w-8 inline-flex items-center justify-center shrink-0 rounded-md' : ''}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: `${gap}px`,
        paddingLeft: `${px}px`,
        paddingRight: `${px}px`,
        paddingTop: `${py}px`,
        paddingBottom: `${py}px`,
        borderRadius: 4,
        border: `1px solid ${meta.color}55`,
        backgroundColor: `${meta.color}15`,
        boxShadow: level >= 3 ? `0 0 6px ${meta.glow}` : undefined,
        lineHeight: 1,
        verticalAlign: 'middle',
        whiteSpace: 'nowrap',
      }}
    >
      {/* Shield icon (inline SVG) */}
      <svg
        width={svgW}
        height={svgH}
        viewBox="0 0 10 12"
        fill={meta.color}
        style={{ flexShrink: 0 }}
      >
        <path d="M5 0L0 2v4c0 3.3 2.1 5.6 5 6 2.9-.4 5-2.7 5-6V2L5 0z" />
      </svg>

      <span
        style={{
          fontSize: `${fontSize}px`,
          fontWeight: 800,
          fontFamily: 'var(--font-heading, serif)',
          color: meta.color,
          letterSpacing: '0.04em',
        }}
      >
        {meta.numeral}
      </span>

      {showLabel && (
        <span
          style={{
            fontSize: `${fontSize - 1}px`,
            fontWeight: 600,
            color: meta.color,
            opacity: 0.8,
          }}
        >
          {meta.label}
        </span>
      )}
    </span>
  );
}
