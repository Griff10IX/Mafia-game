export function Pumpkin({ className }) {
  return (
    <svg className={className} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <radialGradient id="hw-pk-body" cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#ffa341" />
          <stop offset="60%" stopColor="#e8751a" />
          <stop offset="100%" stopColor="#8a3a0a" />
        </radialGradient>
        <radialGradient id="hw-pk-glow" cx="50%" cy="55%" r="50%">
          <stop offset="0%" stopColor="#fff2a8" />
          <stop offset="100%" stopColor="#ff9a2a" />
        </radialGradient>
      </defs>
      <path d="M31 12c4 2 5 6 3 9" fill="none" stroke="#3d6b32" strokeWidth="4" strokeLinecap="round" />
      <path d="M34 15c4-4 9-3 11-1" fill="none" stroke="#5a9a44" strokeWidth="2" strokeLinecap="round" />
      <ellipse cx="32" cy="38" rx="19" ry="20" fill="url(#hw-pk-body)" />
      <ellipse cx="19" cy="38" rx="11" ry="18" fill="#c9600f" opacity="0.85" />
      <ellipse cx="45" cy="38" rx="11" ry="18" fill="#c9600f" opacity="0.85" />
      <ellipse cx="32" cy="38" rx="9" ry="19" fill="#f08a2b" opacity="0.6" />
      <path d="M22 32l8 4-8 3zM42 32l-8 4 8 3zM20 45q12 10 24 0l-3 6q-9 6-18 0z" fill="url(#hw-pk-glow)" />
      <path d="M22 32l8 4-8 3zM42 32l-8 4 8 3z" fill="#1a0d08" opacity="0.35" />
    </svg>
  );
}

export function CornerWeb({ className, withSpider }) {
  return (
    <svg className={className} viewBox="0 0 120 120" aria-hidden="true">
      <g fill="none" stroke="#f6ecd4" strokeWidth="1" opacity="0.9">
        <path d="M0 0 L120 10 M0 0 L118 40 M0 0 L100 80 M0 0 L70 110 M0 0 L30 120 M0 0 L8 120" />
        <path d="M0 22 Q20 26 40 20 Q58 16 72 6" />
        <path d="M0 44 Q30 50 56 40 Q80 30 98 14" />
        <path d="M0 66 Q36 74 68 60 Q96 48 118 26" />
        <path d="M0 88 Q40 98 78 80 Q106 66 120 50" />
        <path d="M0 108 Q44 118 90 100" />
      </g>
      {withSpider ? (
        <g className="hw-web-spider" transform="translate(60 30)">
          <path d="M12 -30 V0" stroke="#f6ecd4" strokeWidth="1" />
          <ellipse cx="12" cy="6" rx="6" ry="5" fill="#0a070c" />
          <ellipse cx="12" cy="16" rx="9" ry="8" fill="#120c14" />
          <path d="M6 8 L-6 0 M6 12 L-8 12 M7 16 L-5 24 M18 8 L30 0 M18 12 L32 12 M17 16 L29 24" stroke="#0a070c" strokeWidth="2" strokeLinecap="round" fill="none" />
          <circle cx="10" cy="5" r="1.2" fill="#ff9a2a" />
          <circle cx="14" cy="5" r="1.2" fill="#ff9a2a" />
        </g>
      ) : null}
    </svg>
  );
}

function Bat() {
  return (
    <svg className="hw-bat" viewBox="0 0 64 36" aria-hidden="true">
      <path d="M32 14c-3-6-8-9-14-8 1 4-2 8-6 8-5 0-9-3-12-8 2 9 8 16 16 18 5 1 9 0 11-3l3 4 3-4c2 3 6 4 11 3 8-2 14-9 16-18-3 5-7 8-12 8-4 0-7-4-6-8-6-1-11 2-14 8z" />
    </svg>
  );
}

export function HalloweenDecor() {
  return (
    <>
      <div className="hw-vignette" aria-hidden="true" />
      <div className="hw-fog" aria-hidden="true" />
      <div className="hw-moon" aria-hidden="true" />
      <div className="hw-bats" aria-hidden="true">
        <Bat />
        <Bat />
        <Bat />
      </div>
      <Pumpkin className="hw-pumpkin hw-pumpkin-top" />
      <Pumpkin className="hw-pumpkin hw-pumpkin-side" />
      <CornerWeb className="hw-corner-web hw-web-tl" withSpider />
      <CornerWeb className="hw-corner-web hw-web-br" />
    </>
  );
}
