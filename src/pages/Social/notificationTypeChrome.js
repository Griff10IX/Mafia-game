import { Bell, Trophy, Shield, Skull, Gift, MessageCircle, Bot, Leaf } from 'lucide-react';

export const NOTIFICATION_ICONS = {
  rank_up: Trophy,
  reward: Gift,
  bodyguard: Shield,
  attack: Skull,
  system: Bell,
  user_message: MessageCircle,
  staff_bot_client: Bot,
};

/** Full class strings so Tailwind JIT keeps them. */
export const NOTIFICATION_VISUALS = {
  staff_bot: {
    icon: 'text-red-400',
    chip: 'bg-red-500/25 border border-red-500/40',
    row: 'bg-red-500/10 border border-red-500/30 hover:bg-red-500/15',
    card: 'rounded-md border border-red-500/30 bg-red-500/10',
    title: 'text-red-200',
    header: 'bg-red-500/10 border-b border-red-500/25',
  },
  reward: {
    icon: 'text-emerald-400',
    chip: 'bg-emerald-500/25 border border-emerald-500/40',
    row: 'bg-emerald-500/10 border border-emerald-500/30 hover:bg-emerald-500/15',
    card: 'rounded-md border border-emerald-500/30 bg-emerald-500/10',
    title: 'text-emerald-200',
    header: 'bg-emerald-500/10 border-b border-emerald-500/25',
  },
  weed: {
    icon: 'text-amber-400',
    chip: 'bg-amber-500/25 border border-amber-500/40',
    row: 'bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/15',
    card: 'rounded-md border border-amber-500/30 bg-amber-500/10',
    title: 'text-amber-200',
    header: 'bg-amber-500/10 border-b border-amber-500/25',
  },
  bodyguard: {
    icon: 'text-sky-400',
    chip: 'bg-sky-500/25 border border-sky-500/40',
    row: 'bg-sky-500/10 border border-sky-500/30 hover:bg-sky-500/15',
    card: 'rounded-md border border-sky-500/30 bg-sky-500/10',
    title: 'text-sky-200',
    header: 'bg-sky-500/10 border-b border-sky-500/25',
  },
  attack: {
    icon: 'text-rose-400',
    chip: 'bg-rose-500/25 border border-rose-500/40',
    row: 'bg-rose-500/10 border border-rose-500/30 hover:bg-rose-500/15',
    card: 'rounded-md border border-rose-500/30 bg-rose-500/10',
    title: 'text-rose-200',
    header: 'bg-rose-500/10 border-b border-rose-500/25',
  },
  rank_up: {
    icon: 'text-yellow-400',
    chip: 'bg-yellow-500/25 border border-yellow-500/40',
    row: 'bg-yellow-500/10 border border-yellow-500/30 hover:bg-yellow-500/15',
    card: 'rounded-md border border-yellow-500/30 bg-yellow-500/10',
    title: 'text-yellow-200',
    header: 'bg-yellow-500/10 border-b border-yellow-500/25',
  },
  system: {
    icon: 'text-amber-400',
    chip: 'bg-amber-500/20 border border-amber-500/35',
    row: 'bg-amber-500/8 border border-amber-500/25 hover:bg-amber-500/14',
    card: 'rounded-md border border-amber-500/30 bg-amber-500/10',
    title: 'text-amber-200',
    header: 'bg-amber-500/10 border-b border-amber-500/25',
  },
  message: {
    icon: 'text-primary',
    chip: 'bg-primary/20 border border-primary/35',
    row: 'bg-primary/8 border border-primary/25 hover:bg-primary/14',
    card: 'rounded-md border border-primary/30 bg-primary/10',
    title: 'text-primary',
    header: 'bg-primary/10 border-b border-primary/25',
  },
};

export function notificationVisualKind(notification) {
  const type = notification?.notification_type || '';
  const blob = `${notification?.title || ''} ${notification?.message || ''}`.toLowerCase();
  if (type === 'staff_bot_client') return 'staff_bot';
  if (type === 'bodyguard') return 'bodyguard';
  if (type === 'attack') return 'attack';
  if (type === 'rank_up') return 'rank_up';
  if (type === 'user_message' || type === 'user_message_sent') return 'message';
  if (/\bweed empire\b|\bweed raid\b/.test(blob)) return 'weed';
  if (type === 'reward' || /\bgame pass\b/.test(blob)) return 'reward';
  if (type === 'system') return 'system';
  return 'system';
}

export function notificationVisual(notification) {
  return NOTIFICATION_VISUALS[notificationVisualKind(notification)] || NOTIFICATION_VISUALS.system;
}

export function notificationIcon(notification) {
  if (notificationVisualKind(notification) === 'weed') return Leaf;
  return NOTIFICATION_ICONS[notification?.notification_type] || Bell;
}
