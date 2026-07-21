/**
 * Name Glow + Border color presets.
 * Keep ids/colors in sync with backend/utils/profile_cosmetics.py PROFILE_GLOW_PRESETS.
 */
export const PROFILE_GLOW_PRESETS = [
  { id: 'violet', label: 'Violet', hex: '#a78bfa' },
  { id: 'purple', label: 'Purple', hex: '#c084fc' },
  { id: 'fuchsia', label: 'Fuchsia', hex: '#e879f9' },
  { id: 'pink', label: 'Pink', hex: '#f472b6' },
  { id: 'rose', label: 'Rose', hex: '#fb7185' },
  { id: 'red', label: 'Red', hex: '#f87171' },
  { id: 'blood', label: 'Blood', hex: '#dc2626' },
  { id: 'orange', label: 'Orange', hex: '#fb923c' },
  { id: 'copper', label: 'Copper', hex: '#d97706' },
  { id: 'gold', label: 'Gold', hex: '#fbbf24' },
  { id: 'yellow', label: 'Yellow', hex: '#facc15' },
  { id: 'lime', label: 'Lime', hex: '#a3e635' },
  { id: 'green', label: 'Green', hex: '#4ade80' },
  { id: 'emerald', label: 'Emerald', hex: '#34d399' },
  { id: 'teal', label: 'Teal', hex: '#2dd4bf' },
  { id: 'cyan', label: 'Cyan', hex: '#22d3ee' },
  { id: 'sky', label: 'Sky', hex: '#38bdf8' },
  { id: 'blue', label: 'Blue', hex: '#60a5fa' },
  { id: 'indigo', label: 'Indigo', hex: '#818cf8' },
  { id: 'silver', label: 'Silver', hex: '#d1d5db' },
  { id: 'steel', label: 'Steel', hex: '#94a3b8' },
];

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ].join(', ');
}

/** CSS for all .prof-border-<id> classes (dossier border + soft glow per preset). */
export const PROFILE_GLOW_BORDER_CSS = PROFILE_GLOW_PRESETS.map((p) => {
  const rgb = hexToRgb(p.hex);
  return `.prof-border-${p.id} { border-color: rgba(${rgb}, 0.7) !important; box-shadow: 0 0 16px rgba(${rgb}, 0.4), inset 0 0 12px rgba(${rgb}, 0.08) !important; }`;
}).join('\n');
