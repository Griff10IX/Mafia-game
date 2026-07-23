import {
  Palette,
  Zap,
  Car,
  Bot,
  Plane,
  Lock,
  FlaskConical,
  Target,
} from 'lucide-react';

/** Fixed-sequence new-player tutorial step copy + CTAs. */
export const TUTORIAL_STEPS = [
  {
    id: 'theme',
    icon: Palette,
    title: 'Pick your look',
    body: 'Choose Default or Modern for the game UI. You can change this anytime under Theme.',
    tips: 'Default is the classic noir look. Modern uses a cleaner layout and colours.',
    gate: 'theme',
    primaryCta: { label: 'Choose theme', action: 'open_theme' },
    nextLabel: 'Next',
  },
  {
    id: 'crimes',
    icon: Zap,
    title: 'Commit a crime',
    body: 'Crimes are your main cash and respect loop. Attempt one crime (success or fail counts) to continue.',
    tips: 'Each crime has a cooldown and progress bar. Higher progress means better odds.',
    gate: 'crime',
    route: '/crime/crimes',
    primaryCta: { label: 'Go to Crimes', action: 'navigate' },
    nextLabel: 'Next',
  },
  {
    id: 'gta',
    icon: Car,
    title: 'GTA (Grand Theft Auto)',
    body: 'GTA is under Rank → GTA. It unlocks at Hustler — you can’t steal cars yet at starting ranks. Come back when you hit Hustler to fill your garage.',
    tips: 'Cars let you travel for free. Damaged cars need repair before they can drive. Street Parking is the first option (Hustler).',
    gate: 'ack',
    route: '/crime/gta',
    primaryCta: { label: 'Show GTA page', action: 'navigate' },
    nextLabel: 'Got it',
  },
  {
    id: 'auto_rank',
    icon: Bot,
    title: 'Auto Rank',
    body: 'Auto Rank is a paid Store perk that can run crimes, GTA, busts, and more while you are away.',
    tips: 'Buy it in the Store, then toggle options under Account → Auto Rank.',
    gate: 'ack',
    route: '/game/store',
    primaryCta: { label: 'Open Store', action: 'navigate' },
    secondaryCta: { label: 'Auto Rank settings', route: '/account/autorank' },
    nextLabel: 'Got it',
  },
  {
    id: 'travel',
    icon: Plane,
    title: 'Travel the map',
    body: 'Move between cities for booze runs, Kill targets, properties and casinos. Hot/cold cities also tweak crime and GTA odds.',
    tips: 'Crimes and GTA options are the same everywhere. Airport travel is instant (costs points); cars take time.',
    gate: 'ack',
    route: '/game/travel',
    primaryCta: { label: 'Go to Travel', action: 'navigate' },
    nextLabel: 'Got it',
  },
  {
    id: 'jail',
    icon: Lock,
    title: 'Jail & busts',
    body: 'Fail a crime or GTA and you may land in jail. Bust yourself or friends out from the Jail page.',
    tips: 'While jailed, many actions pause. Busts earn respect and help your crew. No one in jail? Use Private Cell to summon 5 inmates only you can bust (every 5 minutes).',
    gate: 'ack',
    route: '/crime/jail',
    primaryCta: { label: 'Open Jail', action: 'navigate' },
    nextLabel: 'Got it',
  },
  {
    id: 'distillery',
    icon: FlaskConical,
    title: 'Distillery (later)',
    body: 'The Distillery needs Capo rank and the Booze-making racket. Collect, manage heat, and auto-sell when you unlock it.',
    tips: 'Start with Rackets when you qualify. Distillery is a longer-term money engine.',
    gate: 'ack',
    route: '/money/racket',
    primaryCta: { label: 'View Racket', action: 'navigate' },
    secondaryCta: { label: 'Distillery', route: '/money/distillery' },
    nextLabel: 'Got it',
  },
  {
    id: 'missions',
    icon: Target,
    title: 'Missions & objectives',
    body: 'The Consigliere’s Ledger (Missions) and Objectives give longer goals and big rewards. Finish the tutorial to claim your starter pack.',
    tips: 'Rewards: 3,000 respect, 2 robot bodyguards, and 1 free Rare loot box.',
    gate: 'ack',
    route: '/account/missions',
    primaryCta: { label: 'Open Missions', action: 'navigate' },
    secondaryCta: { label: 'Objectives', route: '/account/objectives' },
    nextLabel: 'Complete tutorial',
    showRewards: true,
  },
];

export const TUTORIAL_REWARD_CHIPS = [
  '3,000 respect',
  '2 robot bodyguards',
  '1 free Rare box',
];

export const TUTORIAL_LOOT_REDIRECT = '/money/loot-box?tier=rare&tutorial=1';

export function getTutorialStep(stepId) {
  return TUTORIAL_STEPS.find((s) => s.id === stepId) || TUTORIAL_STEPS[0];
}
