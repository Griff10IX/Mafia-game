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
  blood_lock: 'Power',
  crown_sigil: 'Power',
  star_north: 'Power',
  omerta_shield: 'Power',
  black_diamond: 'Power',
  old_world: 'Power',
  throne_claim: 'Power',
  empire_mark: 'Power',
  rose_thorn: 'Stealth',
  serpent_coil: 'Stealth',
  crosshairs: 'Stealth',
  mask_void: 'Stealth',
  skeleton_key: 'Stealth',
  watcher: 'Stealth',
  night_veil: 'Stealth',
  silent_contract: 'Stealth',
  ace_spade: 'Money',
  dirty_cash: 'Money',
  coin_ring: 'Money',
  tax_collector: 'Money',
  front_business: 'Money',
  loaded_dice: 'Money',
  tribute: 'Money',
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

const wrapClass =
  'rounded-full overflow-hidden flex items-center justify-center shrink-0 border-2 border-amber-500/75 bg-[#070b14] ring-1 ring-amber-600/25 shadow-[0_0_10px_rgba(201,164,96,.12)]';

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
  const Icon = emblemPresetId ? PRESET_ICON[emblemPresetId] : null;
  if (!Icon) return null;
  const iconSize = Math.max(14, Math.round(size * 0.46));
  return (
    <div className={combined} style={dim} aria-hidden>
      <Icon size={iconSize} className="text-amber-400/95" strokeWidth={2.2} />
    </div>
  );
}
