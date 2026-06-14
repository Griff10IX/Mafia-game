import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  Users,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  DollarSign,
  Crosshair,
  Zap,
  Package,
  Swords,
  Lock,
  MapPin,
  Clock,
  RefreshCw,
} from 'lucide-react';
import api from '../utils/api';
import { getFamiliesPrefetch, setFamiliesPrefetch } from '../utils/prefetchCache';

const POLL_INTERVAL_MS = 30000;
const MINIMIZED_KEY = 'family_command_center_minimized';

const ROLE_LABELS = {
  boss: 'Don',
  underboss: 'Underboss',
  consigliere: 'Consigliere',
  capo: 'Caporegime',
  soldier: 'Soldier',
  associate: 'Associate',
};

function getStoredMinimized() {
  try {
    return localStorage.getItem(MINIMIZED_KEY) === '1';
  } catch (_) {
    return false;
  }
}

function formatMoney(n) {
  const num = Number(n ?? 0);
  if (Number.isNaN(num)) return '$0';
  return `$${Math.trunc(num).toLocaleString()}`;
}

function formatInt(n) {
  const num = Number(n ?? 0);
  if (Number.isNaN(num)) return '0';
  return Math.trunc(num).toLocaleString();
}

function countReadyRackets(rackets) {
  const now = Date.now();
  return (rackets || []).filter((r) => {
    if (r.locked || (r.level || 0) <= 0) return false;
    const next = r.next_collect_at;
    if (!next) return true;
    const t = new Date(next).getTime();
    return !Number.isNaN(t) && t <= now;
  }).length;
}

function cooldownRemaining(untilIso) {
  if (!untilIso) return null;
  const ms = new Date(untilIso).getTime() - Date.now();
  if (ms <= 0) return null;
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function StatRow({ icon, label, value, tone }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1.5 px-2 rounded-sm" style={{ background: 'rgba(0,0,0,0.25)' }}>
      <span className="flex items-center gap-1.5 min-w-0 text-[9px] font-heading uppercase tracking-wide truncate" style={{ color: 'var(--noir-muted)' }}>
        {icon}
        {label}
      </span>
      <span className={`text-[10px] font-heading font-bold tabular-nums shrink-0 ${tone || ''}`} style={tone ? undefined : { color: 'var(--noir-foreground)' }}>
        {value}
      </span>
    </div>
  );
}

export default function FamilyCommandCenter({ onCloseSidebar, hasFamily }) {
  const [isMinimized, setIsMinimized] = useState(getStoredMinimized);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [myFamily, setMyFamily] = useState(() => getFamiliesPrefetch()?.myFamily ?? null);
  const [activeWars, setActiveWars] = useState([]);

  const toggleMinimized = () => {
    setIsMinimized((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(MINIMIZED_KEY, next ? '1' : '0');
      } catch (_) {}
      return next;
    });
  };

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const [myRes, warRes] = await Promise.all([
        api.get('/families/my'),
        hasFamily !== false ? api.get('/families/war').catch(() => ({ data: { wars: [] } })) : Promise.resolve({ data: { wars: [] } }),
      ]);
      const payload = myRes.data || {};
      setMyFamily(payload);
      setActiveWars(warRes.data?.wars || []);
      const prev = getFamiliesPrefetch() || {};
      setFamiliesPrefetch({ ...prev, myFamily: payload });
    } catch (_) {
      if (!silent) setMyFamily({ family: null, members: [], rackets: [], my_role: null });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [hasFamily]);

  useEffect(() => {
    fetchData(false);
    const t = setInterval(() => fetchData(true), POLL_INTERVAL_MS);
    return () => clearInterval(t);
  }, [fetchData]);

  const family = myFamily?.family;
  const members = myFamily?.members || [];
  const rackets = myFamily?.rackets || [];
  const myRole = myFamily?.my_role;
  const readyRackets = countReadyRackets(rackets);
  const unlockedRackets = rackets.filter((r) => !r.locked && (r.level || 0) > 0).length;
  const crewOcCd = cooldownRemaining(family?.crew_oc_cooldown_until);
  const vaultLocked = !!myFamily?.vault_and_rackets_locked;
  const warCount = activeWars.length;

  const handleOpenFamily = () => {
    onCloseSidebar?.();
  };

  return (
    <div
      className="family-command-center flex flex-col min-h-0 border-t mt-2 w-full"
      data-panel="family-command-center"
      style={{ borderColor: 'rgba(var(--noir-primary-rgb), 0.12)' }}
    >
      <div
        className="flex items-center justify-between px-2 sm:px-3 py-2 shrink-0 min-h-[44px] cursor-pointer select-none"
        style={{
          background: 'rgba(var(--noir-primary-rgb), 0.06)',
          borderBottom: isMinimized ? 'none' : '1px solid rgba(var(--noir-primary-rgb), 0.12)',
        }}
        onClick={isMinimized ? toggleMinimized : undefined}
        role={isMinimized ? 'button' : undefined}
        tabIndex={isMinimized ? 0 : undefined}
        onKeyDown={isMinimized ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleMinimized(); } } : undefined}
        aria-expanded={!isMinimized}
        aria-label={isMinimized ? 'Expand family command center' : undefined}
      >
        <span className="text-[9px] font-heading uppercase tracking-widest flex items-center gap-1.5" style={{ color: 'var(--noir-primary)' }}>
          <Users size={10} className="shrink-0" />
          Family HQ
        </span>
        <div className="flex items-center gap-1" onClick={(e) => !isMinimized && e.stopPropagation()}>
          {!isMinimized && (
            <>
              <button
                type="button"
                onClick={() => fetchData(true)}
                disabled={refreshing}
                className="min-w-[32px] min-h-[32px] flex items-center justify-center rounded transition-colors hover:opacity-80 touch-manipulation"
                style={{ color: 'rgba(var(--noir-primary-rgb), 0.55)' }}
                aria-label="Refresh family info"
              >
                <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
              </button>
              <button
                type="button"
                onClick={toggleMinimized}
                className="min-w-[36px] min-h-[36px] sm:min-w-[28px] sm:min-h-[28px] flex items-center justify-center rounded transition-colors hover:opacity-80 touch-manipulation active:scale-95"
                style={{ color: 'rgba(var(--noir-primary-rgb), 0.6)' }}
                aria-label="Minimize family panel"
              >
                <ChevronDown size={14} className="shrink-0" />
              </button>
            </>
          )}
          {isMinimized && (
            <span className="flex items-center" style={{ color: 'rgba(var(--noir-primary-rgb), 0.6)' }} aria-hidden>
              <ChevronUp size={14} className="shrink-0" />
            </span>
          )}
        </div>
      </div>

      {!isMinimized && (
        <div
          className="flex-1 min-h-[180px] max-h-[400px] sm:min-h-[200px] sm:max-h-[380px] overflow-y-auto overflow-x-hidden scrollbar-thin touch-pan-y px-2 py-2 space-y-2"
          style={{ scrollbarColor: 'rgba(var(--noir-primary-rgb), 0.15) transparent' }}
        >
          {loading && !family ? (
            <p className="text-[10px] font-heading px-1 py-2" style={{ color: 'var(--noir-muted)' }}>Loading crew intel…</p>
          ) : !family ? (
            <div className="rounded-md border px-2.5 py-3 space-y-2" style={{ borderColor: 'rgba(var(--noir-primary-rgb), 0.15)', background: 'rgba(0,0,0,0.35)' }}>
              <p className="text-[10px] font-heading leading-relaxed" style={{ color: 'var(--noir-muted)' }}>
                You are not in a family yet. Join or create a crew to unlock vault, rackets, and crew OC.
              </p>
              <Link
                to="/families"
                onClick={handleOpenFamily}
                className="flex items-center justify-center gap-1 w-full py-2 rounded-sm border text-[10px] font-heading font-bold uppercase tracking-wider touch-manipulation"
                style={{ borderColor: 'rgba(var(--noir-primary-rgb), 0.35)', color: 'var(--noir-primary)', background: 'rgba(var(--noir-primary-rgb), 0.08)' }}
              >
                Find a family <ChevronRight size={12} />
              </Link>
            </div>
          ) : (
            <>
              <div className="rounded-md border px-2.5 py-2" style={{ borderColor: 'rgba(var(--noir-primary-rgb), 0.2)', background: 'rgba(var(--noir-primary-rgb), 0.06)' }}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[11px] font-heading font-bold truncate" style={{ color: 'var(--noir-foreground)' }}>
                      {family.name}
                      {family.tag ? <span style={{ color: 'var(--noir-primary)' }}> [{family.tag}]</span> : null}
                    </p>
                    {myRole && (
                      <p className="text-[9px] font-heading mt-0.5" style={{ color: 'var(--noir-muted)' }}>
                        Your role · {ROLE_LABELS[myRole] || myRole}
                      </p>
                    )}
                  </div>
                  <Link
                    to="/families"
                    onClick={handleOpenFamily}
                    className="shrink-0 text-[9px] font-heading uppercase tracking-wide hover:underline"
                    style={{ color: 'var(--noir-primary)' }}
                  >
                    Open
                  </Link>
                </div>
              </div>

              <div className="rounded-md border px-2.5 py-2.5 space-y-1.5" style={{ borderColor: 'rgba(34, 197, 94, 0.25)', background: 'rgba(16, 185, 129, 0.06)' }}>
                <div className="flex items-center gap-1.5 text-[9px] font-heading uppercase tracking-widest" style={{ color: 'rgb(52, 211, 153)' }}>
                  <DollarSign size={10} />
                  Vault
                  {vaultLocked && <Lock size={10} className="text-amber-400" title="Locked during war" />}
                </div>
                <p className="text-lg font-heading font-bold tabular-nums leading-none" style={{ color: 'rgb(167, 243, 208)' }}>
                  {formatMoney(family.treasury)}
                </p>
                <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[9px] font-heading tabular-nums" style={{ color: 'var(--noir-muted)' }}>
                  <span className="flex items-center gap-0.5"><Crosshair size={9} /> {formatInt(family.treasury_bullets)} bullets</span>
                  {(family.treasury_points || 0) > 0 && (
                    <span className="flex items-center gap-0.5"><Zap size={9} /> {formatInt(family.treasury_points)} pts</span>
                  )}
                  {(family.treasury_loot_pieces || 0) > 0 && (
                    <span className="flex items-center gap-0.5"><Package size={9} /> {formatInt(family.treasury_loot_pieces)} loot</span>
                  )}
                </div>
              </div>

              <div className="space-y-1">
                <StatRow icon={<Users size={10} />} label="Members" value={formatInt(members.length)} />
                <StatRow
                  icon={<DollarSign size={10} />}
                  label="Rackets"
                  value={readyRackets > 0 ? `${readyRackets} ready · ${unlockedRackets} active` : `${unlockedRackets} active`}
                  tone={readyRackets > 0 ? 'text-emerald-400' : ''}
                />
                {warCount > 0 && (
                  <StatRow icon={<Swords size={10} />} label="War" value={`${warCount} active`} tone="text-red-400" />
                )}
                {family.head_of_state && (
                  <StatRow icon={<MapPin size={10} />} label="Head of state" value={family.head_of_state} />
                )}
                {crewOcCd && (
                  <StatRow icon={<Clock size={10} />} label="Crew OC" value={`${crewOcCd} left`} />
                )}
                {(myFamily?.my_compound_cash || 0) > 0 && (
                  <StatRow icon={<DollarSign size={10} />} label="Your compound" value={formatMoney(myFamily.my_compound_cash)} />
                )}
              </div>

              <Link
                to="/families"
                onClick={handleOpenFamily}
                className="flex items-center justify-center gap-1 w-full py-2 rounded-sm border text-[10px] font-heading font-bold uppercase tracking-wider touch-manipulation min-h-[40px]"
                style={{ borderColor: 'rgba(var(--noir-primary-rgb), 0.3)', color: 'var(--noir-primary)', background: 'rgba(var(--noir-primary-rgb), 0.05)' }}
              >
                Family command center <ChevronRight size={12} />
              </Link>
            </>
          )}
        </div>
      )}
    </div>
  );
}
