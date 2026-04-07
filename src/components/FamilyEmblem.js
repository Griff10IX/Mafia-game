import {
  Skull,
  PawPrint,
  Sparkles,
  Sword,
  Crown,
  HandMetal,
  Star,
  Spade,
  GitBranch,
  Hourglass,
  Crosshair,
  VenetianMask,
  Shield,
  Lock,
  KeyRound,
  Gem,
  Flame,
  Target,
  DollarSign,
  Landmark,
  Car,
  Bomb,
  Eye,
  Cross,
  CircleDollarSign,
  BadgeDollarSign,
  Briefcase,
  Building2,
  Dice5,
  HandCoins,
} from 'lucide-react';

/** Must match backend FAMILY_EMBLEM_PRESETS_PUBLIC ids (families.py). */
export const FAMILY_EMBLEM_PRESETS = [
  { id: 'skull_bones', label: 'Skull & bones' },
  { id: 'wolf_strike', label: 'Wolf strike' },
  { id: 'rose_thorn', label: 'Rose thorn' },
  { id: 'dagger_drop', label: 'Dagger drop' },
  { id: 'crown_sigil', label: 'Crown sigil' },
  { id: 'fist_city', label: 'Fist of the city' },
  { id: 'star_north', label: 'North star' },
  { id: 'ace_spade', label: 'Ace of spades' },
  { id: 'serpent_coil', label: 'Serpent coil' },
  { id: 'hourglass', label: 'Hourglass oath' },
  { id: 'crosshairs', label: 'Crosshairs' },
  { id: 'mask_void', label: 'Venetian mask' },
  { id: 'omerta_shield', label: 'Omerta shield' },
  { id: 'blood_lock', label: 'Blood lock' },
  { id: 'skeleton_key', label: 'Skeleton key' },
  { id: 'black_diamond', label: 'Black diamond' },
  { id: 'vendetta_flame', label: 'Vendetta flame' },
  { id: 'headhunter', label: 'Headhunter' },
  { id: 'dirty_cash', label: 'Dirty cash' },
  { id: 'old_world', label: 'Old world' },
  { id: 'getaway', label: 'Getaway' },
  { id: 'powder_keg', label: 'Powder keg' },
  { id: 'watcher', label: 'The watcher' },
  { id: 'grave_cross', label: 'Grave cross' },
  { id: 'coin_ring', label: 'Coin ring' },
  { id: 'tax_collector', label: 'Tax collector' },
  { id: 'front_business', label: 'Front business' },
  { id: 'safehouse', label: 'Safehouse' },
  { id: 'loaded_dice', label: 'Loaded dice' },
  { id: 'tribute', label: 'Tribute' },
  { id: 'racket_iron', label: 'Racket iron' },
  { id: 'night_veil', label: 'Night veil' },
  { id: 'throne_claim', label: 'Throne claim' },
  { id: 'silent_contract', label: 'Silent contract' },
  { id: 'war_crest', label: 'War crest' },
  { id: 'empire_mark', label: 'Empire mark' },
  { id: 'don_regalia', label: 'Don regalia' },
  { id: 'crossed_tommy', label: 'Crossed tommy guns' },
  { id: 'honor_and_blood', label: 'Honor and blood' },
  { id: 'black_hand', label: 'Black hand' },
  { id: 'golden_omerta', label: 'Golden omerta' },
  { id: 'la_famiglia', label: 'La famiglia' },
  { id: 'midnight_syndicate', label: 'Midnight syndicate' },
  { id: 'vault_dynasty', label: 'Vault dynasty' },
  { id: 'iron_rose', label: 'Iron rose' },
  { id: 'boss_throne', label: 'Boss throne' },
];

const PRESET_GROUP_BY_ID = {
  skull_bones: 'Violence',
  wolf_strike: 'Violence',
  dagger_drop: 'Violence',
  vendetta_flame: 'Violence',
  headhunter: 'Violence',
  powder_keg: 'Violence',
  grave_cross: 'Violence',
  racket_iron: 'Violence',
  war_crest: 'Violence',
  crossed_tommy: 'Violence',
  honor_and_blood: 'Violence',
  iron_rose: 'Violence',
  blood_lock: 'Power',
  crown_sigil: 'Power',
  star_north: 'Power',
  omerta_shield: 'Power',
  black_diamond: 'Power',
  old_world: 'Power',
  throne_claim: 'Power',
  empire_mark: 'Power',
  don_regalia: 'Power',
  golden_omerta: 'Power',
  la_famiglia: 'Power',
  boss_throne: 'Power',
  rose_thorn: 'Stealth',
  serpent_coil: 'Stealth',
  crosshairs: 'Stealth',
  mask_void: 'Stealth',
  skeleton_key: 'Stealth',
  watcher: 'Stealth',
  night_veil: 'Stealth',
  silent_contract: 'Stealth',
  black_hand: 'Stealth',
  midnight_syndicate: 'Stealth',
  ace_spade: 'Money',
  dirty_cash: 'Money',
  coin_ring: 'Money',
  tax_collector: 'Money',
  front_business: 'Money',
  loaded_dice: 'Money',
  tribute: 'Money',
  vault_dynasty: 'Money',
  fist_city: 'Operations',
  hourglass: 'Operations',
  getaway: 'Operations',
  safehouse: 'Operations',
};

export const FAMILY_EMBLEM_GROUPS = ['Violence', 'Power', 'Stealth', 'Money', 'Operations'];

export function groupFamilyEmblemPresets(presets = FAMILY_EMBLEM_PRESETS) {
  const byId = new Map((presets || []).map((p) => [p.id, p]));
  const groups = FAMILY_EMBLEM_GROUPS.map((group) => ({
    group,
    items: (presets || []).filter((p) => PRESET_GROUP_BY_ID[p.id] === group),
  })).filter((g) => g.items.length > 0);
  const groupedIds = new Set(groups.flatMap((g) => g.items.map((p) => p.id)));
  const ungrouped = (presets || []).filter((p) => !groupedIds.has(p.id) && byId.has(p.id));
  if (ungrouped.length) groups.push({ group: 'Other', items: ungrouped });
  return groups;
}

const PRESET_ICON = {
  skull_bones: Skull,
  wolf_strike: PawPrint,
  rose_thorn: Sparkles,
  dagger_drop: Sword,
  crown_sigil: Crown,
  fist_city: HandMetal,
  star_north: Star,
  ace_spade: Spade,
  serpent_coil: GitBranch,
  hourglass: Hourglass,
  crosshairs: Crosshair,
  mask_void: VenetianMask,
  omerta_shield: Shield,
  blood_lock: Lock,
  skeleton_key: KeyRound,
  black_diamond: Gem,
  vendetta_flame: Flame,
  headhunter: Target,
  dirty_cash: DollarSign,
  old_world: Landmark,
  getaway: Car,
  powder_keg: Bomb,
  watcher: Eye,
  grave_cross: Cross,
  coin_ring: CircleDollarSign,
  tax_collector: BadgeDollarSign,
  front_business: Briefcase,
  safehouse: Building2,
  loaded_dice: Dice5,
  tribute: HandCoins,
  racket_iron: Sword,
  night_veil: VenetianMask,
  throne_claim: Crown,
  silent_contract: Lock,
  war_crest: Shield,
  empire_mark: Landmark,
};

const ART_PRESET_IDS = new Set([
  'don_regalia',
  'crossed_tommy',
  'honor_and_blood',
  'black_hand',
  'golden_omerta',
  'la_famiglia',
  'midnight_syndicate',
  'vault_dynasty',
  'iron_rose',
  'boss_throne',
]);

const wrapClass =
  'rounded-full overflow-hidden flex items-center justify-center shrink-0 border-2 border-amber-500/75 bg-[#070b14] ring-1 ring-amber-600/25 shadow-[0_0_10px_rgba(201,164,96,.12)]';

function ArtPreset({ id, size }) {
  const s = size;
  const c = s / 2;
  const ring = Math.max(1.5, s * 0.05);
  const gunW = Math.max(1.8, s * 0.03);
  const mini = Math.max(8, s * 0.2);
  return (
    <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} aria-hidden>
      <defs>
        <radialGradient id={`bg-${id}`} cx="50%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#1a2233" />
          <stop offset="100%" stopColor="#06090f" />
        </radialGradient>
      </defs>
      <circle cx={c} cy={c} r={c - ring * 0.5} fill={`url(#bg-${id})`} stroke="#c9a460" strokeWidth={ring} />
      <circle cx={c} cy={c} r={c - ring * 2} fill="none" stroke="rgba(201,164,96,.35)" strokeWidth={Math.max(1, ring * 0.5)} />

      {(id === 'crossed_tommy' || id === 'honor_and_blood' || id === 'iron_rose') && (
        <>
          <line x1={s * 0.26} y1={s * 0.72} x2={s * 0.76} y2={s * 0.24} stroke="#8c95a3" strokeWidth={gunW} strokeLinecap="round" />
          <line x1={s * 0.24} y1={s * 0.24} x2={s * 0.74} y2={s * 0.72} stroke="#8c95a3" strokeWidth={gunW} strokeLinecap="round" />
        </>
      )}
      {(id === 'don_regalia' || id === 'boss_throne' || id === 'golden_omerta') && (
        <path d={`M ${s * 0.34} ${s * 0.4} L ${s * 0.42} ${s * 0.25} L ${s * 0.5} ${s * 0.37} L ${s * 0.58} ${s * 0.25} L ${s * 0.66} ${s * 0.4} Z`} fill="#d4af5f" />
      )}
      {(id === 'la_famiglia' || id === 'vault_dynasty') && (
        <path d={`M ${s * 0.5} ${s * 0.26} L ${s * 0.68} ${s * 0.36} L ${s * 0.64} ${s * 0.64} L ${s * 0.5} ${s * 0.74} L ${s * 0.36} ${s * 0.64} L ${s * 0.32} ${s * 0.36} Z`} fill="#12223d" stroke="#c9a460" strokeWidth={Math.max(1.2, s * 0.02)} />
      )}
      {id === 'black_hand' && (
        <path d={`M ${s * 0.44} ${s * 0.32} L ${s * 0.46} ${s * 0.56} L ${s * 0.41} ${s * 0.58} L ${s * 0.39} ${s * 0.39} Z M ${s * 0.49} ${s * 0.3} L ${s * 0.51} ${s * 0.56} L ${s * 0.47} ${s * 0.56} L ${s * 0.45} ${s * 0.31} Z M ${s * 0.54} ${s * 0.33} L ${s * 0.56} ${s * 0.57} L ${s * 0.52} ${s * 0.57} L ${s * 0.5} ${s * 0.34} Z M ${s * 0.59} ${s * 0.37} L ${s * 0.61} ${s * 0.56} L ${s * 0.57} ${s * 0.56} L ${s * 0.55} ${s * 0.38} Z M ${s * 0.38} ${s * 0.57} Q ${s * 0.5} ${s * 0.72} ${s * 0.64} ${s * 0.56} L ${s * 0.62} ${s * 0.66} Q ${s * 0.5} ${s * 0.78} ${s * 0.36} ${s * 0.66} Z`} fill="#161a24" stroke="#c9a460" strokeWidth={Math.max(1, s * 0.015)} />
      )}
      {id === 'midnight_syndicate' && (
        <>
          <ellipse cx={c} cy={s * 0.44} rx={s * 0.18} ry={s * 0.14} fill="#0f131c" stroke="#c9a460" strokeWidth={Math.max(1, s * 0.016)} />
          <rect x={s * 0.3} y={s * 0.54} width={s * 0.4} height={s * 0.07} rx={s * 0.02} fill="#0f131c" stroke="#c9a460" strokeWidth={Math.max(1, s * 0.014)} />
        </>
      )}
      {id === 'vault_dynasty' && <circle cx={c} cy={s * 0.5} r={s * 0.08} fill="#d4af5f" />}
      {id === 'iron_rose' && <circle cx={c} cy={s * 0.5} r={s * 0.1} fill="#7b1f2b" stroke="#d4af5f" strokeWidth={Math.max(1, s * 0.015)} />}

      <text x={c} y={s * 0.86} textAnchor="middle" fontSize={mini} fontWeight="700" fill="#d4af5f" fontFamily="Georgia,serif">
        {id === 'la_famiglia' ? 'LF' : id === 'boss_throne' ? 'BT' : id === 'don_regalia' ? 'DR' : id === 'golden_omerta' ? 'GO' : id === 'vault_dynasty' ? '$' : ''}
      </text>
    </svg>
  );
}

/**
 * Crew emblem: custom data URL or preset. Omit both for no emblem.
 */
export default function FamilyEmblem({ emblemPresetId, avatarUrl, size = 40, className = '' }) {
  const dim = { width: size, height: size };
  const combined = `${wrapClass} ${className}`.trim();
  if (avatarUrl && String(avatarUrl).startsWith('data:')) {
    return (
      <div className={combined} style={dim} aria-hidden>
        <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
      </div>
    );
  }
  if (ART_PRESET_IDS.has(emblemPresetId)) {
    return (
      <div className={combined} style={dim} aria-hidden>
        <ArtPreset id={emblemPresetId} size={size} />
      </div>
    );
  }
  const Icon = emblemPresetId ? PRESET_ICON[emblemPresetId] : null;
  if (!Icon) return null;
  const iconSize = Math.max(14, Math.round(size * 0.46));
  return (
    <div className={combined} style={dim} aria-hidden>
      <Icon size={iconSize} className="text-amber-400/95" strokeWidth={2.2} />
    </div>
  );
}
