import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Ban } from 'lucide-react';
import { useAuthUser } from '../context/AuthContext';
import {
  formatGamblingSelfBanRemaining,
  isGamblingSelfBanned,
} from '../utils/gamblingSelfBan';

/**
 * Blocks casino / sports wager UIs while gambling self-exclusion is active.
 * @param {'hard'|'notice'} mode hard = no interaction; notice = banner only (e.g. MDG staff joins).
 */
export default function GamblingSelfBanGate({ children, mode = 'hard' }) {
  const user = useAuthUser();
  const [, setTick] = useState(0);
  const active = isGamblingSelfBanned(user);

  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => setTick((x) => x + 1), 30_000);
    return () => clearInterval(id);
  }, [active]);

  if (!active) return children;

  const left = formatGamblingSelfBanRemaining(user) || 'a short time';
  const banner = (
    <div
      role="alert"
      className="rounded-md border border-red-500/40 bg-red-950/80 px-3 py-2.5 text-[11px] text-red-100 font-heading leading-snug"
    >
      <div className="flex items-start gap-2">
        <Ban size={14} className="shrink-0 mt-0.5 text-red-300" aria-hidden />
        <div className="min-w-0 space-y-1">
          <p className="font-bold text-red-200 uppercase tracking-wider text-[10px]">
            Gambling self-exclusion active
          </p>
          <p>
            Casino and sports betting are locked for <span className="font-bold tabular-nums">{left}</span>.
            Staff will not remove this ban.
          </p>
          <Link
            to="/casino/gambling-ban"
            className="inline-block text-red-200/90 underline underline-offset-2 hover:text-red-100"
          >
            View exclusion status
          </Link>
        </div>
      </div>
    </div>
  );

  if (mode === 'notice') {
    return (
      <div className="space-y-3">
        {banner}
        {children}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {banner}
      <div className="relative rounded-lg overflow-hidden">
        <div
          className="pointer-events-none select-none opacity-45 blur-[0.5px]"
          aria-hidden
        >
          {children}
        </div>
        <div
          className="absolute inset-0 z-20 flex items-center justify-center bg-zinc-950/55 p-4"
          aria-disabled="true"
        >
          <div className="max-w-sm text-center rounded-md border border-red-500/35 bg-zinc-950/90 px-4 py-3 shadow-lg">
            <Ban size={22} className="mx-auto text-red-400 mb-2" aria-hidden />
            <p className="text-sm font-heading font-bold text-red-200 uppercase tracking-wider">
              Betting locked
            </p>
            <p className="text-[11px] text-zinc-400 font-heading mt-1.5 leading-snug">
              You cannot place casino or sports bets until your self-exclusion ends ({left} left).
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
