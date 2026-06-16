import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const hx = (n) => Math.round((n + m) * 255).toString(16).padStart(2, '0');
  return `#${hx(r)}${hx(g)}${hx(b)}`;
}

function makeSolid(id, name, h, s, l) {
  const primary = hslToHex(h, s, l);
  const primaryBright = hslToHex(h, Math.min(s + 8, 100), Math.min(l + 14, 92));
  const primaryDark = hslToHex(h, s, Math.max(l - 18, 8));
  return {
    id,
    name,
    primary,
    primaryBright,
    primaryDark,
    foregroundOnPrimary: l > 58 ? '#000000' : '#ffffff',
  };
}

function makeGrad2(id, name, h1, h2, s = 72, l = 46) {
  const c1 = hslToHex(h1, s, l);
  const c2 = hslToHex(h2, s, Math.min(l + 8, 55));
  return {
    id,
    name,
    stops: [c1, c2],
    primary: c1,
    primaryBright: c2,
    primaryDark: c1,
    foregroundOnPrimary: '#ffffff',
  };
}

function makeGrad4(id, name, hs) {
  const stops = hs.map(([h, s, l]) => hslToHex(h, s, l));
  return {
    id,
    name,
    stops,
    primary: stops[0],
    primaryBright: stops[1],
    primaryDark: stops[stops.length - 1],
    foregroundOnPrimary: '#ffffff',
  };
}

function makeWriting(id, name, h, s, l, mutedDelta = 18) {
  const fg = hslToHex(h, Math.max(s - 35, 8), Math.min(l + 42, 96));
  const muted = hslToHex(h, Math.max(s - 45, 6), Math.max(l + mutedDelta, 35));
  return { id, name, foreground: fg, muted };
}

const named = [
  ['x-capone-gold', 'Capone Gold', 42, 88, 50],
  ['x-lucky-luciano', 'Lucky Luciano', 38, 75, 42],
  ['x-chicago-noir', 'Chicago Noir', 220, 12, 18],
  ['x-prohibition', 'Prohibition Brass', 35, 60, 38],
  ['x-rum-runner', 'Rum Runner', 28, 70, 45],
  ['x-jazz-club', 'Jazz Club', 280, 45, 35],
  ['x-havana-night', 'Havana Night', 195, 65, 32],
  ['x-vegas-neon', 'Vegas Neon', 320, 95, 58],
  ['x-casino-felt', 'Casino Felt', 145, 55, 28],
  ['x-poker-chip', 'Poker Chip Red', 0, 78, 48],
  ['x-whiskey-barrel', 'Whiskey Barrel', 25, 55, 32],
  ['x-cigarette-ash', 'Cigarette Ash', 30, 8, 42],
  ['x-tommy-gun', 'Tommy Gun Steel', 210, 12, 35],
  ['x-fedora-brown', 'Fedora Brown', 28, 35, 30],
  ['x-marble-hall', 'Marble Hall', 40, 15, 78],
  ['x-velvet-rope', 'Velvet Rope', 350, 72, 38],
  ['x-diamond-heist', 'Diamond Heist', 200, 20, 88],
  ['x-blackmail', 'Blackmail Ink', 250, 30, 12],
  ['x-bribe-cash', 'Bribe Cash', 95, 45, 72],
  ['x-safe-cracker', 'Safe Cracker', 45, 25, 22],
  ['x-dockside', 'Dockside Fog', 205, 18, 55],
  ['x-warehouse', 'Warehouse Lamp', 45, 80, 55],
  ['x-penthouse', 'Penthouse View', 210, 40, 72],
  ['x-underboss', 'Underboss Crimson', 355, 68, 40],
  ['x-consigliere', 'Consigliere Navy', 225, 55, 28],
  ['x-hitman', 'Hitman Shadow', 0, 0, 14],
  ['x-racket-green', 'Racket Green', 140, 48, 34],
  ['x-loan-shark', 'Loan Shark', 15, 80, 42],
  ['x-nightclub', 'Nightclub Purple', 275, 70, 48],
  ['x-backroom', 'Backroom Amber', 32, 85, 50],
];

const hueNames = [
  'Crimson Tide', 'Solar Flare', 'Arctic Mint', 'Deep Lagoon', 'Royal Orchid', 'Copper Flame',
  'Storm Grey', 'Moss Stone', 'Cherry Bomb', 'Electric Lime', 'Cosmic Blue', 'Sunset Coral',
  'Glacier Peak', 'Desert Rose', 'Midnight Jade', 'Volcanic Ash', 'Neon Magenta', 'Ocean Spray',
  'Golden Hour', 'Steel Dawn', 'Plum Wine', 'Frost Berry', 'Tropical Punch', 'Sage Mist',
  'Ink Blue', 'Blaze Orange', 'Moon Silver', 'Pistachio', 'Berry Crush', 'Cobalt Dream',
  'Rust Belt', 'Pearl Mist', 'Dragon Fire', 'Lilac Haze', 'Tidal Wave', 'Sandstorm',
  'Grape Soda', 'Pine Needle', 'Hot Ember', 'Crystal Ice',
];

const EXPANDED_THEME_COLOURS = named.map(([id, name, h, s, l]) => makeSolid(id, name, h, s, l));
for (let i = 0; i < 40; i += 1) {
  const h = Math.round((i * 360) / 40 + 7) % 360;
  const s = 55 + (i % 5) * 8;
  const l = 38 + (i % 4) * 7;
  EXPANDED_THEME_COLOURS.push(makeSolid(`x-hue-${i}`, hueNames[i], h, s, l));
}

const gradPairs = [
  ['x-grad-sunrise', 'Sunrise Blaze', 15, 45],
  ['x-grad-dusk', 'Dusk Horizon', 280, 20],
  ['x-grad-aurora-borealis', 'Aurora Borealis', 160, 280],
  ['x-grad-molten', 'Molten Core', 10, 35],
  ['x-grad-deep-sea', 'Deep Sea', 210, 175],
  ['x-grad-royal-flame', 'Royal Flame', 260, 15],
  ['x-grad-forest-mist', 'Forest Mist', 130, 180],
  ['x-grad-candy-pop', 'Candy Pop', 330, 55],
  ['x-grad-storm-sky', 'Storm Sky', 220, 250],
  ['x-grad-desert-sunset', 'Desert Sunset', 25, 340],
  ['x-grad-toxic', 'Toxic Glow', 85, 160],
  ['x-grad-blood-moon', 'Blood Moon', 0, 280],
  ['x-grad-arctic-fire', 'Arctic Fire', 195, 12],
  ['x-grad-jungle', 'Jungle Heat', 95, 145],
  ['x-grad-galaxy', 'Galaxy Drift', 265, 200],
];
gradPairs.forEach(([id, name, h1, h2]) => {
  EXPANDED_THEME_COLOURS.push(makeGrad2(id, name, h1, h2));
});
EXPANDED_THEME_COLOURS.push(
  makeGrad4('x-grad-neon-party', 'Neon Party', [
    [300, 90, 55], [200, 90, 50], [120, 85, 45], [30, 90, 55],
  ]),
);
EXPANDED_THEME_COLOURS.push(
  makeGrad4('x-grad-mafia-classic', 'Mafia Classic', [
    [45, 80, 45], [30, 20, 18], [0, 0, 12], [42, 70, 38],
  ]),
);

const EXPANDED_THEME_TEXTURES = [
  'noise', 'dots', 'paper', 'carbon', 'fabric', 'grain', 'mesh', 'stipple', 'weave',
  'brushed', 'sand', 'diagonal', 'herringbone', 'speckle', 'linen', 'circuit', 'waves',
  'brick', 'concrete', 'subtle-dots', 'scatter',
].map((id) => ({
  id,
  name: id.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' '),
}));

const EXPANDED_THEME_FONTS = [
  { id: 'x-gothic', name: 'Gothic', heading: '"UnifrakturMaguntia", "Old English Text MT", serif', body: 'Georgia, serif' },
  { id: 'x-stencil', name: 'Stencil', heading: '"Black Ops One", Impact, sans-serif', body: 'Inter, system-ui, sans-serif' },
  { id: 'x-display', name: 'Display', heading: '"Abril Fatface", Georgia, serif', body: 'Inter, system-ui, sans-serif' },
  { id: 'x-condensed', name: 'Condensed', heading: '"Barlow Condensed", "Arial Narrow", sans-serif', body: '"Barlow Condensed", sans-serif' },
  { id: 'x-script', name: 'Script', heading: '"Great Vibes", cursive', body: '"Cormorant Garamond", serif' },
  { id: 'x-brutalist', name: 'Brutalist', heading: '"Archivo Black", sans-serif', body: 'Inter, system-ui, sans-serif' },
  { id: 'x-futura', name: 'Futura', heading: 'Futura, "Century Gothic", sans-serif', body: 'Futura, sans-serif' },
  { id: 'x-terminal', name: 'Terminal', heading: '"Share Tech Mono", monospace', body: '"Share Tech Mono", monospace' },
];

const EXPANDED_THEME_WRITING_COLOURS = [];
for (let i = 0; i < 35; i += 1) {
  const h = Math.round((i * 360) / 35);
  EXPANDED_THEME_WRITING_COLOURS.push(
    makeWriting(`x-write-${i}`, `Tint ${hueNames[i % hueNames.length]}`, h, 40, 28),
  );
}

const quickTextures = ['none', 'grain', 'dots', 'paper', 'carbon', 'circuit', 'waves', 'brick'];
const quickDefs = [
  ['x-q-neon-vegas', 'Neon Vegas', 'x-vegas-neon', 'Vegas hot pink neon'],
  ['x-q-casino', 'Casino Night', 'x-casino-felt', 'Green felt table'],
  ['x-q-whiskey', 'Whiskey Room', 'x-whiskey-barrel', 'Warm barrel brown'],
  ['x-q-prohibition', 'Prohibition', 'x-prohibition', 'Brass speakeasy'],
  ['x-q-chicago', 'Chicago Noir', 'x-chicago-noir', 'Dark city night'],
  ['x-q-capone', 'Capone Gold', 'x-capone-gold', 'Boss gold accent'],
  ['x-q-poker', 'Poker Chip', 'x-poker-chip', 'Classic red chip'],
  ['x-q-diamond', 'Diamond Heist', 'x-diamond-heist', 'Bright ice white'],
  ['x-q-velvet', 'Velvet Rope', 'x-velvet-rope', 'Club velvet red'],
  ['x-q-dockside', 'Dockside', 'x-dockside', 'Foggy harbour blue'],
  ['x-q-penthouse', 'Penthouse', 'x-penthouse', 'Skyline blue'],
  ['x-q-hitman', 'Hitman', 'x-hitman', 'Pure shadow black'],
  ['x-q-racket', 'Racket Money', 'x-racket-green', 'Street racket green'],
  ['x-q-loan', 'Loan Shark', 'x-loan-shark', 'Aggressive red-orange'],
  ['x-q-nightclub', 'Nightclub', 'x-nightclub', 'Purple dance floor'],
  ['x-q-backroom', 'Backroom Deal', 'x-backroom', 'Amber backroom'],
  ['x-q-havana', 'Havana Nights', 'x-havana-night', 'Caribbean teal'],
  ['x-q-jazz', 'Jazz Club', 'x-jazz-club', 'Smoky purple jazz'],
  ['x-q-rum', 'Rum Runner', 'x-rum-runner', 'Caribbean rum'],
  ['x-q-safe', 'Safe Cracker', 'x-safe-cracker', 'Dark vault'],
  ['x-q-bribe', 'Bribe Cash', 'x-bribe-cash', 'Stack of bills'],
  ['x-q-underboss', 'Underboss', 'x-underboss', 'Crimson power'],
  ['x-q-consigliere', 'Consigliere', 'x-consigliere', 'Strategic navy'],
  ['x-q-tommy', 'Tommy Steel', 'x-tommy-gun', 'Gunmetal grey'],
  ['x-q-fedora', 'Fedora', 'x-fedora-brown', 'Brown fedora'],
  ['x-q-marble', 'Marble Hall', 'x-marble-hall', 'Grand marble'],
  ['x-q-cigarette', 'Smoky Ash', 'x-cigarette-ash', 'Ash grey smoke'],
  ['x-q-warehouse', 'Warehouse', 'x-warehouse', 'Industrial lamp gold'],
  ['x-q-blackmail', 'Blackmail', 'x-blackmail', 'Deep ink black'],
  ['x-q-sunrise', 'Sunrise Blaze', 'x-grad-sunrise', 'Orange sunrise'],
  ['x-q-dusk', 'Dusk', 'x-grad-dusk', 'Purple dusk'],
  ['x-q-aurora', 'Aurora', 'x-grad-aurora-borealis', 'Northern lights'],
  ['x-q-molten', 'Molten', 'x-grad-molten', 'Lava orange'],
  ['x-q-deep-sea', 'Deep Sea', 'x-grad-deep-sea', 'Ocean depths'],
  ['x-q-galaxy', 'Galaxy', 'x-grad-galaxy', 'Space purple-blue'],
  ['x-q-toxic', 'Toxic', 'x-grad-toxic', 'Neon toxic'],
  ['x-q-blood-moon', 'Blood Moon', 'x-grad-blood-moon', 'Red eclipse'],
  ['x-q-neon-party', 'Neon Party', 'x-grad-neon-party', 'Four-color neon'],
  ['x-q-arctic-fire', 'Arctic Fire', 'x-grad-arctic-fire', 'Ice meets flame'],
  ['x-q-jungle', 'Jungle', 'x-grad-jungle', 'Tropical green'],
  ['x-q-candy', 'Candy Pop', 'x-grad-candy-pop', 'Sweet candy'],
  ['x-q-storm', 'Storm Sky', 'x-grad-storm-sky', 'Thunder clouds'],
  ['x-q-desert', 'Desert Sunset', 'x-grad-desert-sunset', 'Sahara dusk'],
  ['x-q-royal', 'Royal Flame', 'x-grad-royal-flame', 'Purple fire'],
  ['x-q-forest-mist', 'Forest Mist', 'x-grad-forest-mist', 'Misty woods'],
  ['x-q-mafia-classic', 'Mafia Classic', 'x-grad-mafia-classic', 'Gold noir blend'],
  ['x-q-hue-0', 'Crimson Tide', 'x-hue-0', 'Bold crimson'],
  ['x-q-hue-5', 'Electric Lime', 'x-hue-5', 'Neon lime punch'],
  ['x-q-hue-10', 'Cosmic Blue', 'x-hue-10', 'Deep cosmic blue'],
  ['x-q-hue-15', 'Volcanic Ash', 'x-hue-15', 'Dark volcanic'],
  ['x-q-hue-20', 'Steel Dawn', 'x-hue-20', 'Cool steel morning'],
  ['x-q-hue-25', 'Blaze Orange', 'x-hue-25', 'Hot blaze'],
  ['x-q-hue-30', 'Berry Crush', 'x-hue-30', 'Berry splash'],
  ['x-q-hue-35', 'Sandstorm', 'x-hue-35', 'Desert sand'],
];

const EXPANDED_QUICK_PRESETS = quickDefs.map(([id, name, colourId, description], i) => ({
  id,
  name,
  description,
  colourId,
  textureId: quickTextures[i % quickTextures.length],
  buttonColourId: null,
  accentLineColourId: null,
}));

const btnStyles = ['flat', 'glossy', 'shaded', 'shadow', 'raised', 'outline', 'opaque'];
const fontPool = ['classic', 'modern', 'tech', 'bold', 'elegant', 'mono', 'geometric', 'luxury', 'x-gothic', 'x-stencil', 'x-display', 'x-terminal'];
const writePool = ['default', 'cool-white', 'cream-gold', 'blush-text', 'mint-text', 'sky-text', 'lavender-text', 'peach-text', 'chrome-text', 'sapphire-text', 'neon-cyan-text', 'matrix-text', 'burgundy-text', 'x-write-0', 'x-write-5', 'x-write-10', 'x-write-15', 'x-write-20', 'x-write-25', 'x-write-30'];
const mutedPool = ['zinc-400', 'powder-blue', 'sage-text', 'slate-300', 'coral-text', 'aqua-text', 'lilac', 'warm-white', 'steel-text', 'garnet-text', 'seafoam', 'chrome-text'];

const categories = {
  mafia: { textures: ['none', 'grain', 'carbon', 'paper'], variant: 'classic' },
  neon: { textures: ['circuit', 'dots', 'scatter'], variant: 'modern' },
  pastel: { textures: ['subtle-dots', 'linen', 'modern-soft'], variant: 'modern' },
  earth: { textures: ['sand', 'weave', 'brick'], variant: 'classic' },
  ocean: { textures: ['waves', 'mesh', 'fine-lines'], variant: 'modern' },
  fire: { textures: ['diagonal', 'speckle', 'grain'], variant: 'modern' },
  arcade: { textures: ['circuit', 'hexagons', 'grid'], variant: 'modern' },
  gothic: { textures: ['crosshatch', 'stipple', 'carbon'], variant: 'classic' },
  cosmic: { textures: ['scatter', 'noise', 'mesh'], variant: 'modern' },
};

const EXPANDED_FULL_PRESETS = [];
let fi = 0;
const catColours = EXPANDED_THEME_COLOURS.filter((c) => c.id.startsWith('x-'));
for (const [cat, cfg] of Object.entries(categories)) {
  for (let j = 0; j < 12; j += 1) {
    const c = catColours[(fi + j) % catColours.length];
    const tex = cfg.textures[j % cfg.textures.length];
    const btn = btnStyles[j % btnStyles.length];
    const font = fontPool[(fi + j) % fontPool.length];
    const wr = writePool[(fi + j) % writePool.length];
    const mu = mutedPool[(fi + j) % mutedPool.length];
    EXPANDED_FULL_PRESETS.push({
      id: `x-full-${cat}-${j}`,
      name: `${c.name} ${cat[0].toUpperCase()}${cat.slice(1)}`,
      description: `${cat} themed full preset`,
      colourId: c.id,
      textureId: tex,
      buttonColourId: c.id,
      accentLineColourId: c.id,
      writingColourId: wr,
      mutedWritingColourId: mu,
      buttonStyleId: btn,
      fontId: font,
      textStyleId: j % 2 ? 'medium' : 'semibold',
      toastTextColourId: wr,
      mobileNavStyle: 'bottom',
      themeVariant: cfg.variant,
      isFullPreset: true,
      presetCategory: cat,
    });
  }
  fi += 12;
}

export const EXPANDED_PRESET_CATEGORIES = Object.keys(categories).map((id) => ({
  id,
  label: id[0].toUpperCase() + id.slice(1),
}));

export const EXPANDED_COLOUR_SECTION = {
  label: 'Expanded studio',
  ids: EXPANDED_THEME_COLOURS.map((c) => c.id),
};

export const EXPANDED_WRITING_SECTION = {
  label: 'Expanded tints',
  ids: EXPANDED_THEME_WRITING_COLOURS.map((w) => w.id),
};

const out = `/**
 * Auto-generated theme studio expansion. Run: node scripts/gen-themes-expanded.mjs
 */
export const EXPANDED_THEME_COLOURS = ${JSON.stringify(EXPANDED_THEME_COLOURS, null, 2)};

export const EXPANDED_THEME_TEXTURES = ${JSON.stringify(EXPANDED_THEME_TEXTURES, null, 2)};

export const EXPANDED_THEME_FONTS = ${JSON.stringify(EXPANDED_THEME_FONTS, null, 2)};

export const EXPANDED_THEME_WRITING_COLOURS = ${JSON.stringify(EXPANDED_THEME_WRITING_COLOURS, null, 2)};

export const EXPANDED_QUICK_PRESETS = ${JSON.stringify(EXPANDED_QUICK_PRESETS, null, 2)};

export const EXPANDED_FULL_PRESETS = ${JSON.stringify(EXPANDED_FULL_PRESETS, null, 2)};

export const EXPANDED_PRESET_CATEGORIES = ${JSON.stringify(EXPANDED_PRESET_CATEGORIES, null, 2)};

export const EXPANDED_COLOUR_SECTION = ${JSON.stringify(EXPANDED_COLOUR_SECTION, null, 2)};

export const EXPANDED_WRITING_SECTION = ${JSON.stringify(EXPANDED_WRITING_SECTION, null, 2)};
`;

const target = join(__dirname, '..', 'src', 'constants', 'themes-expanded.js');
writeFileSync(target, out, 'utf8');

const total = EXPANDED_THEME_COLOURS.length + EXPANDED_QUICK_PRESETS.length + EXPANDED_FULL_PRESETS.length
  + EXPANDED_THEME_TEXTURES.length + EXPANDED_THEME_FONTS.length + EXPANDED_THEME_WRITING_COLOURS.length;

console.log('Wrote', target);
console.log({
  colours: EXPANDED_THEME_COLOURS.length,
  quick: EXPANDED_QUICK_PRESETS.length,
  full: EXPANDED_FULL_PRESETS.length,
  textures: EXPANDED_THEME_TEXTURES.length,
  fonts: EXPANDED_THEME_FONTS.length,
  writing: EXPANDED_THEME_WRITING_COLOURS.length,
  total,
});
