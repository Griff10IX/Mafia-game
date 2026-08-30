import { Bell, Trophy, Shield, Skull, Gift, MessageCircle, Bot, Leaf, Landmark } from 'lucide-react';

export const NOTIFICATION_ICONS = {
  rank_up: Trophy,
  reward: Gift,
  bodyguard: Shield,
  attack: Skull,
  system: Bell,
  family: Landmark,
  user_message: MessageCircle,
  staff_bot_client: Bot,
};

/** Icon colour only — rows, titles, and cards stay neutral. */
export const NOTIFICATION_VISUALS = {
  staff_bot: { icon: 'text-red-400' },
  reward: { icon: 'text-emerald-400' },
  weed: { icon: 'text-amber-400' },
  bodyguard: { icon: 'text-sky-400' },
  attack: { icon: 'text-rose-400' },
  rank_up: { icon: 'text-yellow-400' },
  system: { icon: 'text-amber-400' },
  family: { icon: 'text-amber-400' },
  message: { icon: 'text-primary' },
};

export function notificationVisualKind(notification) {
  const type = notification?.notification_type || '';
  const blob = `${notification?.title || ''} ${notification?.message || ''}`.toLowerCase();
  if (type === 'staff_bot_client') return 'staff_bot';
  if (type === 'bodyguard') return 'bodyguard';
  if (type === 'family') return 'family';
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
