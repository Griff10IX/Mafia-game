import { useEffect, useState } from 'react';
import { Shield } from 'lucide-react';
import { formatProtectionRemaining, protectionRemainingMs } from '../utils/protectionCountdown';

/**
 * Small shield + live countdown for new-account (civilian) protection on profiles.
 */
export default function CivilianProtectionBadge({
  active,
  endsAt,
  size = 'md',
  className = '',
}) {
  const [tick, setTick] = useState(0);
  const isActive = Boolean(active) && protectionRemainingMs(endsAt) > 0;

  useEffect(() => {
    if (!isActive) return undefined;
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [isActive, endsAt]);

  if (!isActive) return null;

  void tick;
  const label = formatProtectionRemaining(endsAt);
  const compact = size === 'sm';
  const iconSize = compact ? 10 : 11;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border border-emerald-500/45 bg-emerald-500/15 text-emerald-200 shrink-0 ${
        compact ? 'h-5 px-1.5' : 'h-6 md:h-7 px-1.5 sm:px-2'
      } ${className}`}
      title={`New account protection · ${label} remaining`}
      aria-label={`Protected · ${label} remaining`}
    >
      <Shield size={iconSize} className="text-emerald-300 shrink-0" aria-hidden />
      <span
        className={`font-heading font-bold tabular-nums leading-none text-emerald-100 ${
          compact ? 'text-[8px]' : 'text-[9px] md:text-[10px]'
        }`}
      >
        {label}
      </span>
    </span>
  );
}
