// Prestige badge: heraldic shield crest with crown finial, colour-coded by level.
import React from 'react';

const PRESTIGE_META = {
  1: { numeral: 'I',   label: 'Made',             color: '#cd7f32', glow: 'rgba(205,127,50,0.35)' },
  2: { numeral: 'II',  label: 'Earner',           color: '#a8a9ad', glow: 'rgba(168,169,173,0.35)' },
  3: { numeral: 'III', label: 'Capo di Capi',     color: '#ffd700', glow: 'rgba(255,215,0,0.35)' },
  4: { numeral: 'IV',  label: 'The Don',          color: '#b9f2ff', glow: 'rgba(185,242,255,0.35)' },
  5: { numeral: 'V',   label: 'Godfather Legacy', color: '#ef4444', glow: 'rgba(220,38,38,0.45)' },
};

// Crown path per level:
// L1–L2: simple triangle point (single peak)
// L3–L4: two-prong crown
// L5: full 3-ball royal crown
function CrownPath({ level, color }) {
  if (level <= 2) {
    return (
      <>
        <polygon
          points="4,4 7,1 10,4"
          fill={`${color}80`}
          stroke={color}
          strokeWidth="0.6"
        />
        <line x1="7" y1="1" x2="7" y2="4.2" stroke={color} strokeWidth="0.7" />
      </>
    );
  }
  if (level <= 4) {
    return (
      <>
        <polygon
          points="4,4 7,1 10,4"
          fill={`${color}80`}
          stroke={color}
          strokeWidth="0.6"
        />
        <line x1="5.5" y1="2.5" x2="5.5" y2="4.2" stroke={color} strokeWidth="0.7" />
        <line x1="8.5" y1="2.5" x2="8.5" y2="4.2" stroke={color} strokeWidth="0.7" />
      </>
    );
  }
  // L5 — full 3-ball royal crown
  return (
    <>
      <path
        d="M2 4.5 L4 2.5 L7 4 L10 2.5 L12 4.5"
        fill="none"
        stroke={color}
        strokeWidth="0.75"
        strokeLinejoin="round"
      />
      <circle cx="4"  cy="2.5" r="0.85" fill={color} />
      <circle cx="7"  cy="1.5" r="0.85" fill={color} />
      <circle cx="10" cy="2.5" r="0.85" fill={color} />
    </>
  );
}

// Numeral font sizes mapped to fit inside shield at various character widths
const NUMERAL_FS = { 1: 5.2, 2: 4.4, 3: 3.7, 4: 4.4, 5: 5.2 };

export default function PrestigeBadge({ level, size = 'sm', showLabel = false }) {
  if (!level || level < 1 || level > 5) return null;

  const meta = PRESTIGE_META[level];

  // Rendered SVG dimensions by size
  const dims = {
    sm:   { w: 14, h: 17 },
    md:   { w: 18, h: 22 },
    lg:   { w: 24, h: 29 },
    icon: { w: 24, h: 29 },
  };
  const { w, h } = dims[size] || dims.sm;

  const hasGlow = level >= 3;

  const shieldSvg = (
    <svg
      width={w}
      height={h}
      viewBox="0 0 14 17"
      style={{ flexShrink: 0, verticalAlign: 'middle', display: 'inline-block' }}
      aria-hidden="true"
    >
      {/* Glow halo for L3+ */}
      {hasGlow && (
        <path
          d="M1 4.5 L1 10 Q1 15 7 16.5 Q13 15 13 10 L13 4.5 L7 3 Z"
          fill="none"
          stroke={meta.color}
          strokeWidth="2.5"
          opacity="0.14"
        />
      )}

      {/* Shield body */}
      <path
        d="M1 4.5 L1 10 Q1 15 7 16.5 Q13 15 13 10 L13 4.5 L7 3 Z"
        fill={`${meta.color}26`}
        stroke={meta.color}
        strokeWidth="0.9"
      />

      {/* Inner shield bevel */}
      <path
        d="M3 6 L3 10 Q3 13 7 14.2 Q11 13 11 10 L11 6 L7 5 Z"
        fill="none"
        stroke={meta.color}
        strokeWidth="0.5"
        opacity="0.3"
      />

      {/* Crown finial */}
      <CrownPath level={level} color={meta.color} />

      {/* Roman numeral */}
      <text
        x="7"
        y="11.8"
        textAnchor="middle"
        fontFamily="Cinzel, serif"
        fontSize={NUMERAL_FS[level]}
        fontWeight="700"
        fill={meta.color}
        letterSpacing="0.3"
      >
        {meta.numeral}
      </text>
    </svg>
  );

  if (showLabel) {
    const labelSize = size === 'lg' || size === 'icon' ? 10 : size === 'md' ? 9 : 8;
    return (
      <span
        title={`Prestige ${level} — ${meta.label}`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          verticalAlign: 'middle',
          whiteSpace: 'nowrap',
        }}
      >
        {shieldSvg}
        <span
          style={{
            fontFamily: 'var(--font-heading, Cinzel, serif)',
            fontSize: labelSize,
            fontWeight: 600,
            color: meta.color,
            letterSpacing: '0.06em',
            opacity: 0.9,
          }}
        >
          {meta.label}
        </span>
      </span>
    );
  }

  // icon size: centred in a fixed square to match h-7/h-8 buttons
  if (size === 'icon') {
    return (
      <span
        title={`Prestige ${level} — ${meta.label}`}
        className="h-7 w-7 md:h-8 md:w-8 inline-flex items-center justify-center shrink-0"
        style={{ verticalAlign: 'middle' }}
      >
        {shieldSvg}
      </span>
    );
  }

  return (
    <span
      title={`Prestige ${level} — ${meta.label}`}
      style={{ display: 'inline-flex', alignItems: 'center', verticalAlign: 'middle' }}
    >
      {shieldSvg}
    </span>
  );
}
