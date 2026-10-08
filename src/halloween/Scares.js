const KINDS = ['face', 'lantern', 'spider', 'hand', 'eyes'];

export function pickScareKind(kind) {
  if (KINDS.includes(kind)) return kind;
  return KINDS[Math.floor(Math.random() * KINDS.length)];
}

function Face() {
  return (
    <svg viewBox="0 0 240 280">
      <defs>
        <radialGradient id="hw-face-skin" cx="50%" cy="38%" r="65%">
          <stop offset="0%" stopColor="#f4ede0" />
          <stop offset="70%" stopColor="#cfc3b2" />
          <stop offset="100%" stopColor="#6d6257" />
        </radialGradient>
        <radialGradient id="hw-face-eye" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#000" />
          <stop offset="80%" stopColor="#0b0609" />
          <stop offset="100%" stopColor="#3a0a14" />
        </radialGradient>
      </defs>
      <path d="M120 18c58 0 96 52 96 118 0 68-40 126-96 126S24 204 24 136C24 70 62 18 120 18z" fill="url(#hw-face-skin)" />
      <path d="M46 120c10-30 34-40 50-24M194 120c-10-30-34-40-50-24" fill="none" stroke="#2a1c1e" strokeWidth="9" strokeLinecap="round" />
      <ellipse cx="82" cy="138" rx="22" ry="30" fill="url(#hw-face-eye)" />
      <ellipse cx="158" cy="138" rx="22" ry="30" fill="url(#hw-face-eye)" />
      <circle cx="88" cy="128" r="4" fill="#fff" opacity="0.8" />
      <circle cx="164" cy="128" r="4" fill="#fff" opacity="0.8" />
      <path d="M120 160l-10 22h20z" fill="#5a3a3a" opacity="0.7" />
      <path d="M72 206c18 44 78 44 96 0-14 12-82 12-96 0z" fill="#120406" />
      <path d="M86 206l6 16 6-16M114 210l6 20 6-20M142 206l6 16 6-16" fill="#f0ead8" />
      <path d="M78 214l8 2M154 214l8 2" stroke="#8a1d2a" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function Lantern() {
  return (
    <svg viewBox="0 0 260 280">
      <defs>
        <radialGradient id="hw-lt-body" cx="50%" cy="45%" r="60%">
          <stop offset="0%" stopColor="#ffb257" />
          <stop offset="55%" stopColor="#e8751a" />
          <stop offset="100%" stopColor="#6a2a06" />
        </radialGradient>
        <radialGradient id="hw-lt-fire" cx="50%" cy="60%" r="55%">
          <stop offset="0%" stopColor="#fff7b0" />
          <stop offset="50%" stopColor="#ffb340" />
          <stop offset="100%" stopColor="#c0400a" />
        </radialGradient>
      </defs>
      <path d="M130 14c10 6 14 18 8 34" fill="none" stroke="#3d6b32" strokeWidth="12" strokeLinecap="round" />
      <path d="M138 24c10-10 24-10 32-4" fill="none" stroke="#5a9a44" strokeWidth="5" strokeLinecap="round" />
      <ellipse cx="130" cy="156" rx="112" ry="104" fill="url(#hw-lt-body)" />
      <ellipse cx="66" cy="156" rx="40" ry="94" fill="#b85410" opacity="0.6" />
      <ellipse cx="194" cy="156" rx="40" ry="94" fill="#b85410" opacity="0.6" />
      <ellipse cx="130" cy="156" rx="34" ry="100" fill="#f58d2c" opacity="0.5" />
      <path d="M58 122l44 20-50 18zM202 122l-44 20 50 18z" fill="url(#hw-lt-fire)" />
      <path d="M122 150l8-18 8 18z" fill="url(#hw-lt-fire)" />
      <path d="M44 186q86 70 172 0l-10 22q-76 56-152 0z" fill="url(#hw-lt-fire)" />
      <path d="M70 196l10 20 10-18M118 208l12 26 12-26M172 196l-10 20-10-18" fill="#1a0d08" />
    </svg>
  );
}

function Spider() {
  return (
    <svg viewBox="0 0 260 220">
      <path d="M130 0 V50" stroke="#f6ecd4" strokeWidth="2" />
      <radialGradient id="hw-sp-body" cx="40%" cy="35%" r="70%">
        <stop offset="0%" stopColor="#3a2a36" />
        <stop offset="100%" stopColor="#07050a" />
      </radialGradient>
      <path d="M100 92 L28 40 M98 108 L14 100 M102 124 L24 176 M160 92 L232 40 M162 108 L246 100 M158 124 L236 176" fill="none" stroke="#0a070c" strokeWidth="9" strokeLinecap="round" />
      <path d="M100 92 L28 40 M98 108 L14 100 M102 124 L24 176 M160 92 L232 40 M162 108 L246 100 M158 124 L236 176" fill="none" stroke="#2a1a28" strokeWidth="3" strokeLinecap="round" />
      <ellipse cx="130" cy="92" rx="32" ry="26" fill="url(#hw-sp-body)" />
      <ellipse cx="130" cy="146" rx="52" ry="44" fill="url(#hw-sp-body)" />
      <path d="M118 128q12-6 24 0" fill="none" stroke="#ff9a2a" strokeWidth="3" opacity="0.6" />
      <path d="M116 112l-6 12M144 112l6 12" stroke="#f6ecd4" strokeWidth="4" strokeLinecap="round" />
      <circle cx="116" cy="84" r="7" fill="#ff9a2a" />
      <circle cx="144" cy="84" r="7" fill="#ff9a2a" />
      <circle cx="108" cy="96" r="4" fill="#ffb340" />
      <circle cx="152" cy="96" r="4" fill="#ffb340" />
      <circle cx="116" cy="84" r="3" fill="#120406" />
      <circle cx="144" cy="84" r="3" fill="#120406" />
    </svg>
  );
}

function Hand() {
  return (
    <svg viewBox="0 0 240 300">
      <defs>
        <linearGradient id="hw-hand-skin" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#c9c0b0" />
          <stop offset="100%" stopColor="#5a4e46" />
        </linearGradient>
      </defs>
      <path d="M70 300V150c0-14 20-14 20 0v60M100 210V100c0-14 20-14 20 0v110M130 210V84c0-14 20-14 20 0v126M160 220V110c0-14 20-14 20 0v110M190 230V150c0-12 18-12 18 0v80" fill="none" stroke="url(#hw-hand-skin)" strokeWidth="22" strokeLinecap="round" />
      <path d="M58 300V210c0-30 30-50 70-50h40c22 0 40 18 40 40v100z" fill="url(#hw-hand-skin)" />
      <path d="M90 150l-6-10M120 100l-4-10M150 84l-2-10M180 110l2-10M208 150l2-8" stroke="#f0ead8" strokeWidth="6" strokeLinecap="round" />
      <path d="M100 230l20 10M150 240l-16 12" stroke="#2a1c1e" strokeWidth="3" strokeLinecap="round" opacity="0.6" />
    </svg>
  );
}

function Eyes() {
  return (
    <svg viewBox="0 0 320 120">
      <defs>
        <radialGradient id="hw-eye-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fff6c0" />
          <stop offset="35%" stopColor="#ffb340" />
          <stop offset="100%" stopColor="#7a1f06" />
        </radialGradient>
      </defs>
      <ellipse cx="90" cy="60" rx="58" ry="34" fill="url(#hw-eye-glow)" />
      <ellipse cx="230" cy="60" rx="58" ry="34" fill="url(#hw-eye-glow)" />
      <ellipse cx="90" cy="60" rx="10" ry="30" fill="#0a0408" />
      <ellipse cx="230" cy="60" rx="10" ry="30" fill="#0a0408" />
    </svg>
  );
}

export function ScareFrame({ kind }) {
  const id = pickScareKind(kind);
  return (
    <div className={`hw-scare hw-scare-${id}`} data-halloween-scare="1" role="presentation">
      {id === 'face' ? <Face /> : null}
      {id === 'lantern' ? <Lantern /> : null}
      {id === 'spider' ? <Spider /> : null}
      {id === 'hand' ? <Hand /> : null}
      {id === 'eyes' ? <Eyes /> : null}
    </div>
  );
}
