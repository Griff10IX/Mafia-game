import { Zap } from 'lucide-react';

const TOKEN_INFO = {
  xp_crimes: { name: 'Crimes XP', desc: '2x XP from crimes' },
  xp_gta: { name: 'GTA XP', desc: '2x XP from GTA' },
  melt: { name: 'Melt Boost', desc: 'Reduced melt cooldown' },
  oc_reduced: { name: 'OC Boost', desc: 'Reduced OC cost & cooldown' },
  booze: { name: 'Booze Boost', desc: 'Cheaper booze purchases' },
  racket: { name: 'Racket Boost', desc: 'Increased racket profit' },
  travel: { name: 'Travel Boost', desc: 'Cheaper & faster travel' },
  properties: { name: 'Property Boost', desc: '3x property income' },
  jailbust_bonus: { name: 'Jailbust Boost', desc: '+10% bust success' },
};

const BADGE_STYLES = `
  @keyframes token-pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.7; transform: scale(1.05); }
  }
  .token-badge-pulse {
    animation: token-pulse 1.5s ease-in-out infinite;
  }
`;

export function isTokenActive(untilIso) {
  if (!untilIso) return false;
  try {
    const until = new Date(untilIso).getTime();
    return until > Date.now();
  } catch {
    return false;
  }
}

export function getTimeRemaining(untilIso) {
  if (!untilIso) return null;
  try {
    const until = new Date(untilIso).getTime();
    const diff = until - Date.now();
    if (diff <= 0) return null;
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(mins / 60);
    const remainMins = mins % 60;
    if (hours > 0) return `${hours}h ${remainMins}m`;
    return `${mins}m`;
  } catch {
    return null;
  }
}

export default function ActiveTokenBadge({ tokenType, untilIso, compact = false, symbol = false }) {
  const active = isTokenActive(untilIso);
  if (!active) return null;
  
  const info = TOKEN_INFO[tokenType] || { name: 'Boost', desc: 'Active bonus' };
  const timeLeft = getTimeRemaining(untilIso);
  const title = `${info.name}: ${info.desc}${timeLeft ? ` (${timeLeft} left)` : ''}`;
  
  if (symbol) {
    return (
      <span
        className="inline-flex items-center justify-center w-6 h-6 rounded bg-amber-500/15 border border-amber-500/30 text-amber-400 shrink-0"
        title={title}
      >
        <Zap size={12} />
      </span>
    );
  }
  
  if (compact) {
    return (
      <>
        <style>{BADGE_STYLES}</style>
        <span 
          className="token-badge-pulse inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/20 border border-amber-500/40 text-amber-400"
          title={title}
        >
          <Zap size={10} className="shrink-0" />
          <span className="text-[9px] font-heading font-bold uppercase tracking-wide">{info.name}</span>
        </span>
      </>
    );
  }
  
  return (
    <>
      <style>{BADGE_STYLES}</style>
      <div className="token-badge-pulse flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-amber-500/15 border border-amber-500/30">
        <Zap size={14} className="text-amber-400 shrink-0" />
        <div className="min-w-0">
          <span className="text-[10px] font-heading font-bold text-amber-400 uppercase tracking-wide block">
            {info.name} Active
          </span>
          <span className="text-[9px] text-amber-400/80 block">
            {info.desc}{timeLeft ? ` · ${timeLeft} left` : ''}
          </span>
        </div>
      </div>
    </>
  );
}
