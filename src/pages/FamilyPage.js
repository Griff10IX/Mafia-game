import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Users, Building2, DollarSign, TrendingUp, LogOut, Swords, Trophy, Shield, Skull, X, Crosshair, RefreshCw, Clock, ChevronRight, MessageSquare, UserPlus, Lock, Unlock, ArrowUpCircle, Flame } from 'lucide-react';
import api, { refreshUser } from '../utils/api';
import { toast } from 'sonner';
import { getRacketAccent } from '../constants';
import styles from '../styles/noir.module.css';

// ============================================================================
// CONSTANTS & UTILITIES
// ============================================================================

const ROLE_CONFIG = {
  boss: { label: 'Don', icon: '👑', color: 'text-yellow-400', bg: 'bg-yellow-500/20', border: 'border-yellow-500/40', rank: 0 },
  underboss: { label: 'Underboss', icon: '⭐', color: 'text-purple-400', bg: 'bg-purple-500/20', border: 'border-purple-500/40', rank: 1 },
  consigliere: { label: 'Consigliere', icon: '🎭', color: 'text-blue-400', bg: 'bg-blue-500/20', border: 'border-blue-500/40', rank: 2 },
  capo: { label: 'Caporegime', icon: '🎖️', color: 'text-emerald-400', bg: 'bg-emerald-500/20', border: 'border-emerald-500/40', rank: 3 },
  soldier: { label: 'Soldier', icon: '🔫', color: 'text-zinc-300', bg: 'bg-zinc-500/20', border: 'border-zinc-500/40', rank: 4 },
  associate: { label: 'Associate', icon: '👤', color: 'text-zinc-400', bg: 'bg-zinc-500/20', border: 'border-zinc-500/40', rank: 5 },
};

const TREASURY_QUICK = [
  { label: '100K', value: 100_000 },
  { label: '1M', value: 1_000_000 },
  { label: '10M', value: 10_000_000 },
  { label: '100M', value: 100_000_000 },
  { label: '1B', value: 1_000_000_000 },
];

const formatMoney = (n) => {
  const num = Number(n ?? 0);
  if (Number.isNaN(num)) return '$0';
  if (num >= 1_000_000_000) return `$${(num / 1_000_000_000).toFixed(1)}B`;
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `$${(num / 1_000).toFixed(0)}K`;
  return `$${num.toLocaleString()}`;
};

const formatMoneyFull = (n) => {
  const num = Number(n ?? 0);
  return Number.isNaN(num) ? '$0' : `$${Math.trunc(num).toLocaleString()}`;
};

const formatTimeLeft = (isoUntil) => {
  if (!isoUntil) return null;
  try {
    const sec = Math.max(0, Math.floor((new Date(isoUntil) - new Date()) / 1000));
    if (sec <= 0) return 'Ready';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  } catch { return null; }
};

const apiDetail = (e) => {
  const d = e.response?.data?.detail;
  return typeof d === 'string' ? d : Array.isArray(d) && d.length ? d.map((x) => x.msg || x.loc?.join('.')).join('; ') : 'Request failed';
};

const getRoleConfig = (role) => ROLE_CONFIG[role?.toLowerCase()] || ROLE_CONFIG.associate;

/* ═══════════════════════════════════════════════════════
   Animated Counter
   ═══════════════════════════════════════════════════════ */
function AnimatedCounter({ target, prefix = '', duration = 1000 }) {
  const [display, setDisplay] = useState(0);
  const ref = useRef(null);
  useEffect(() => {
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(target * eased));
      if (t < 1) ref.current = requestAnimationFrame(tick);
    };
    ref.current = requestAnimationFrame(tick);
    return () => { if (ref.current) cancelAnimationFrame(ref.current); };
  }, [target, duration]);
  return <span>{prefix}{display.toLocaleString()}</span>;
}

// ============================================================================
// STAT CARD — themed with icon glow
// ============================================================================

const StatCard = ({ label, value, highlight, icon, accent: accentColor, delay = 0 }) => (
  <div className={`relative overflow-hidden rounded-lg p-3 fam-stat-card art-deco-corner fam-scale-in ${highlight ? 'bg-emerald-500/10 border border-emerald-500/30' : `${styles.surface} border border-primary/20`}`} style={{ animationDelay: `${delay}s` }}>
    {highlight && <div className="absolute -top-4 -right-4 w-16 h-16 rounded-full bg-emerald-500/10 blur-xl" />}
    {!highlight && <div className="absolute -top-6 left-1/2 -translate-x-1/2 w-20 h-12 bg-primary/5 rounded-full blur-xl pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity" />}
    <div className="flex items-center gap-1.5 text-[9px] text-zinc-500 uppercase tracking-[0.15em] mb-1.5 font-heading">
      {icon}
      {label}
    </div>
    <div className={`text-lg font-heading font-bold ${highlight ? 'text-emerald-400' : accentColor || 'text-foreground'}`}>{value}</div>
  </div>
);

// ============================================================================
// TAB BUTTON — sleek underline tabs
// ============================================================================

const Tab = ({ active, onClick, children, icon }) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-1 px-2.5 py-2.5 text-[10px] font-heading font-bold uppercase tracking-wider transition-all border-b-2 whitespace-nowrap ${
      active
        ? 'text-primary border-primary bg-primary/5'
        : 'text-zinc-500 border-transparent hover:text-zinc-300 hover:border-zinc-600'
    }`}
  >
    {icon}
    <span className="hidden sm:inline">{children}</span>
    <span className="sm:hidden">{children}</span>
  </button>
);

// ============================================================================
// ROLE BADGE — proper insignia
// ============================================================================

const RoleBadge = ({ role, size = 'sm' }) => {
  const cfg = getRoleConfig(role);
  const px = size === 'lg' ? 'px-2.5 py-1 text-xs' : 'px-1.5 py-0.5 text-[10px]';
  return (
    <span className={`inline-flex items-center gap-1 rounded-md font-heading font-bold ${cfg.bg} ${cfg.color} ${cfg.border} border ${px}`}>
      <span>{cfg.icon}</span>
      <span>{cfg.label}</span>
    </span>
  );
};

// ============================================================================
// RACKET CARD — business front with progress & glow
// ============================================================================

const RacketCard = ({ racket, maxLevel, canUpgrade, onCollect, onUpgrade, onUnlock }) => {
  const timeLeft = formatTimeLeft(racket.next_collect_at);
  const onCooldown = timeLeft && timeLeft !== 'Ready';
  const isReady = racket.level > 0 && !onCooldown;
  const income = racket.effective_income_per_collect ?? racket.income_per_collect;
  const locked = racket.locked || racket.level <= 0;
  const isMax = racket.level >= maxLevel;
  const pct = maxLevel ? (racket.level / maxLevel) * 100 : 0;

  return (
    <div className={`relative rounded-lg overflow-hidden fam-racket-card ${isReady ? 'animate-ready-pulse bg-emerald-500/5 border border-emerald-500/35' : locked ? 'bg-zinc-900/50 border border-dashed border-zinc-700/50' : 'bg-zinc-800/30 border border-zinc-700/30'}`}>
      {isReady && <>
        <div className="absolute -top-3 -right-3 w-14 h-14 rounded-full bg-emerald-500/15 blur-lg pointer-events-none" />
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-emerald-400/50 to-transparent" />
      </>}
      {isMax && <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-primary/60 to-transparent" />}

      <div className="p-3">
        {/* Header row */}
        <div className="flex items-center justify-between mb-2">
          <h3 className={`font-heading font-bold text-sm tracking-wide ${locked ? 'text-zinc-500' : 'text-foreground'}`}>
            {locked && <Lock size={10} className="inline mr-1 opacity-60" />}
            {racket.name}
          </h3>
          <span className={`text-[10px] font-heading font-bold px-1.5 py-0.5 rounded ${
            isMax ? 'bg-primary/20 text-primary border border-primary/30' : locked ? 'bg-zinc-800 text-zinc-500' : 'bg-zinc-800 text-zinc-400'
          }`}>
            {isMax ? 'MAX' : locked ? 'LCK' : `L${racket.level}`}
          </span>
        </div>

        {/* Level progress bar */}
        <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden mb-2">
          <div
            className={`h-full rounded-full transition-all duration-700 ${locked ? 'bg-zinc-600' : isMax ? 'bg-gradient-to-r from-primary via-amber-400 to-primary' : 'bg-gradient-to-r from-primary to-yellow-700'}`}
            style={{ width: `${pct}%`, minWidth: racket.level > 0 ? 4 : 0 }}
          />
        </div>

        {/* Status line */}
        <div className="flex items-center justify-between mb-2">
          <span className={`text-[10px] font-heading font-bold ${
            isReady ? 'text-emerald-400' : locked ? 'text-zinc-600' : onCooldown ? 'text-amber-400' : 'text-zinc-500'
          }`}>
            {locked ? (racket.required_racket_name ? `Needs ${racket.required_racket_name}` : 'Locked')
              : isReady ? '● COLLECT' : onCooldown ? `⏱ ${timeLeft}` : ''}
          </span>
          <span className={`font-heading font-bold text-sm ${locked ? 'text-zinc-600' : isReady ? 'fam-shimmer-text' : 'text-primary'}`}>
            {locked ? '—' : formatMoney(income)}
          </span>
        </div>

        {/* Action buttons */}
        <div className="flex gap-1.5">
          {racket.level > 0 && (
            <button
              onClick={() => onCollect(racket.id)}
              disabled={onCooldown}
              className={`flex-1 px-3 py-1.5 rounded-md text-[10px] font-heading font-bold uppercase tracking-wider border transition-all ${
                isReady
                  ? 'bg-gradient-to-b from-emerald-600/30 to-emerald-800/20 border-emerald-500/40 text-emerald-400 hover:from-emerald-600/50 hover:shadow-md hover:shadow-emerald-900/30'
                  : 'bg-zinc-800/50 border-zinc-700/30 text-zinc-500 cursor-not-allowed'
              } disabled:opacity-40`}
            >
              {onCooldown ? `${timeLeft}` : 'Collect'}
            </button>
          )}
          {canUpgrade && locked && racket.can_unlock && (
            <button
              onClick={() => onUnlock(racket.id)}
              className="flex items-center gap-1 px-3 py-1.5 rounded-md text-[10px] font-heading font-bold uppercase border bg-primary/20 border-primary/40 text-primary hover:bg-primary/30 hover:shadow-md hover:shadow-primary/10 transition-all"
            >
              <Unlock size={10} /> Unlock
            </button>
          )}
          {canUpgrade && !locked && racket.level < maxLevel && (
            <button
              onClick={() => onUpgrade(racket.id)}
              className="px-2.5 py-1.5 rounded-md text-[10px] font-heading font-bold border bg-zinc-800/60 border-zinc-600/40 text-zinc-300 hover:border-primary/40 hover:text-primary hover:bg-primary/5 transition-all"
            >
              <ArrowUpCircle size={12} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// TREASURY TAB — vault with quick amounts
// ============================================================================

const TreasuryTab = ({ treasury, canWithdraw, depositAmount, setDepositAmount, withdrawAmount, setWithdrawAmount, onDeposit, onWithdraw }) => (
  <div className="space-y-4">
    {/* Vault display */}
    <div className={`relative ${styles.surface} rounded-lg overflow-hidden p-8 text-center border border-primary/25 art-deco-corner`}>
      <div className="absolute inset-0 fam-vault-bg pointer-events-none" />
      <div className="absolute -top-10 left-1/2 -translate-x-1/2 w-48 h-24 rounded-full bg-primary/8 blur-3xl pointer-events-none fam-glow" />
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
      <DollarSign size={24} className="mx-auto text-primary/40 mb-2" />
      <p className="text-[9px] text-zinc-500 uppercase tracking-[0.3em] font-heading mb-2">The Family Vault</p>
      <p className="text-3xl sm:text-4xl font-heading font-bold text-primary relative fam-shimmer-text">
        <AnimatedCounter target={Number(treasury ?? 0)} prefix="$" />
      </p>
      <p className="text-[9px] text-zinc-600 font-heading mt-2 italic">Every dollar earned in blood and sweat</p>
    </div>

    {/* Deposit */}
    <div className="bg-zinc-800/30 rounded-lg border border-zinc-700/30 p-3 fam-fade-in" style={{ animationDelay: '0.1s' }}>
      <p className="text-[10px] text-zinc-500 font-heading uppercase tracking-[0.15em] mb-2 flex items-center gap-1.5">
        <DollarSign size={10} /> Deposit to Vault
      </p>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {TREASURY_QUICK.map((q) => (
          <button key={q.value} type="button" onClick={() => setDepositAmount(String(q.value))}
            className={`px-2.5 py-1 rounded-md text-[10px] font-heading font-bold border transition-all ${
              depositAmount === String(q.value) ? 'bg-primary/20 border-primary/50 text-primary shadow-sm shadow-primary/10' : 'bg-zinc-800/60 border-zinc-700/40 text-zinc-400 hover:border-zinc-500 hover:text-zinc-300'
            }`}>{q.label}</button>
        ))}
      </div>
      <form onSubmit={onDeposit} className="flex gap-2">
        <input type="text" inputMode="numeric" placeholder="Custom amount" value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)}
          className="flex-1 bg-zinc-900/80 border border-zinc-600/40 rounded-lg px-3 py-2 text-xs text-foreground font-heading focus:border-primary/50 focus:outline-none min-w-0 transition-colors" />
        <button type="submit" className="px-4 py-2 rounded-lg text-[10px] font-heading font-bold uppercase tracking-wider border bg-primary/20 border-primary/50 text-primary hover:bg-primary/30 hover:shadow-md hover:shadow-primary/10 transition-all shrink-0">
          Deposit
        </button>
      </form>
    </div>

    {/* Withdraw */}
    {canWithdraw && (
      <div className="bg-zinc-800/30 rounded-lg border border-zinc-700/30 p-3 fam-fade-in" style={{ animationDelay: '0.15s' }}>
        <p className="text-[10px] text-zinc-500 font-heading uppercase tracking-[0.15em] mb-2 flex items-center gap-1.5">
          <LogOut size={10} /> Withdraw from Vault
        </p>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {TREASURY_QUICK.map((q) => (
            <button key={q.value} type="button" onClick={() => setWithdrawAmount(String(q.value))}
              className={`px-2.5 py-1 rounded-md text-[10px] font-heading font-bold border transition-all ${
                withdrawAmount === String(q.value) ? 'bg-zinc-700/60 border-zinc-500/50 text-zinc-200' : 'bg-zinc-800/60 border-zinc-700/40 text-zinc-400 hover:border-zinc-500 hover:text-zinc-300'
              }`}>{q.label}</button>
          ))}
        </div>
        <form onSubmit={onWithdraw} className="flex gap-2">
          <input type="text" inputMode="numeric" placeholder="Custom amount" value={withdrawAmount} onChange={(e) => setWithdrawAmount(e.target.value)}
            className="flex-1 bg-zinc-900/80 border border-zinc-600/40 rounded-lg px-3 py-2 text-xs text-foreground font-heading focus:border-primary/50 focus:outline-none min-w-0 transition-colors" />
          <button type="submit" className="px-4 py-2 rounded-lg text-[10px] font-heading font-bold uppercase tracking-wider border bg-zinc-700/50 border-zinc-600/50 text-zinc-300 hover:bg-zinc-700/70 transition-all shrink-0">
            Withdraw
          </button>
        </form>
      </div>
    )}
  </div>
);

// ============================================================================
// RACKETS TAB
// ============================================================================

const RacketsTab = ({ rackets, config, canUpgrade, onCollect, onUpgrade, onUnlock, event, eventsEnabled }) => {
  const maxLevel = config?.racket_max_level ?? 5;

  return (
    <div className="space-y-3">
      {/* Event Banner */}
      {eventsEnabled && event && (event.racket_payout !== 1 || event.racket_cooldown !== 1) && event.name && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-[10px] border border-primary/30 bg-primary/5">
          <span className="text-primary font-heading font-bold">✨ {event.name}</span>
          <span className="text-zinc-400">{event.message}</span>
        </div>
      )}

      {/* Racket Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {rackets.map((r) => (
          <RacketCard key={r.id} racket={r} maxLevel={maxLevel} canUpgrade={canUpgrade} onCollect={onCollect} onUpgrade={onUpgrade} onUnlock={onUnlock} />
        ))}
      </div>

      {/* Footer Stats */}
      <div className="flex items-center justify-between text-[10px] text-zinc-500 px-1 pt-2 border-t border-zinc-700/30">
        {config?.racket_unlock_cost && <span className="flex items-center gap-1"><Unlock size={9} /> Unlock: {formatMoney(config.racket_unlock_cost)}</span>}
        {config?.racket_upgrade_cost && <span className="flex items-center gap-1"><ArrowUpCircle size={9} /> Expand: {formatMoney(config.racket_upgrade_cost)}</span>}
      </div>
    </div>
  );
};

// ============================================================================
// RAID TAB — war room / corkboard aesthetic
// ============================================================================

const RaidTab = ({ targets, loading, onRaid, onRefresh, refreshing }) => (
  <div className="space-y-3">
    <div className="flex items-center justify-between">
      <div>
        <p className="text-[10px] text-zinc-500 font-heading italic leading-relaxed">Hit their rackets, take 25% of the take. Two hits per rival family every 3 hours.</p>
      </div>
      <button onClick={onRefresh} disabled={refreshing} className="text-primary hover:opacity-80 p-2 rounded-md hover:bg-primary/10 transition-all shrink-0 ml-2">
        <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
      </button>
    </div>
    
    {targets.length === 0 ? (
      <div className="text-center py-12 rounded-lg bg-zinc-800/20 border border-dashed border-zinc-700/40">
        <Crosshair size={32} className="mx-auto text-zinc-700 mb-3" />
        <p className="text-xs text-zinc-500 font-heading tracking-wider uppercase">No targets on the map</p>
        <p className="text-[9px] text-zinc-600 font-heading mt-1 italic">The streets are quiet... for now</p>
      </div>
    ) : (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-80 overflow-y-auto pr-1">
        {targets.map((t, idx) => {
          const raidsLeft = t.raids_remaining ?? 2;
          const canRaid = raidsLeft > 0;
          return (
            <div key={t.family_id} className={`rounded-lg overflow-hidden fam-target-card fam-fade-in ${canRaid ? 'bg-red-500/5 border fam-blood-pulse' : 'bg-zinc-800/30 border border-zinc-800/30 opacity-40'}`} style={{ animationDelay: `${idx * 0.05}s` }}>
              <div className="px-3 py-2.5 flex items-center justify-between border-b border-zinc-700/30 bg-zinc-900/30">
                <div className="flex items-center gap-2 min-w-0">
                  <Crosshair size={12} className={canRaid ? 'text-red-400' : 'text-zinc-600'} />
                  <span className="font-heading font-bold text-foreground text-sm truncate tracking-wide">{t.family_name}</span>
                  <span className="text-primary/60 text-[10px]">[{t.family_tag}]</span>
                </div>
                <div className="flex items-center gap-1" title={`${raidsLeft} hits remaining`}>
                  {[...Array(2)].map((_, i) => (
                    <div key={i} className={`w-2 h-2 rounded-full transition-colors ${i < raidsLeft ? 'bg-red-400 shadow-sm shadow-red-500/30' : 'bg-zinc-700'}`} />
                  ))}
                </div>
              </div>
              <div className="p-2 space-y-1">
                {(t.rackets || []).slice(0, 3).map((r) => {
                  const key = `${t.family_id}-${r.racket_id}`;
                  const isLoading = loading === key;
                  return (
                    <div key={key} className="flex items-center justify-between text-[11px] px-2 py-1.5 bg-zinc-900/50 rounded-md hover:bg-zinc-900/70 transition-colors">
                      <div className="min-w-0">
                        <span className="text-foreground">{r.racket_name}</span>
                        <span className="text-zinc-500 ml-1 text-[10px]">L{r.level}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-primary font-heading font-bold">{formatMoney(r.potential_take)}</span>
                        <button 
                          onClick={() => onRaid(t.family_id, r.racket_id)} 
                          disabled={isLoading || !canRaid}
                          className={`px-2.5 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider transition-all ${
                            canRaid ? 'bg-red-600/80 text-white hover:bg-red-500 hover:shadow-md hover:shadow-red-900/30' : 'bg-zinc-700 text-zinc-500'
                          } disabled:opacity-40`}
                        >
                          {isLoading ? '...' : 'Hit'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    )}
  </div>
);

// ============================================================================
// ROSTER TAB — hierarchy layout with role badges
// ============================================================================

const RosterTab = ({ members, canManage, myRole, config, onKick, onAssignRole }) => {
  const [assignUserId, setAssignUserId] = useState('');
  const [assignRole, setAssignRole] = useState('associate');

  const handleAssign = (e) => {
    e.preventDefault();
    if (assignUserId && assignRole) {
      onAssignRole(assignUserId, assignRole);
      setAssignUserId('');
      setAssignRole('associate');
    }
  };

  const sorted = [...members].sort((a, b) => (getRoleConfig(a.role).rank ?? 5) - (getRoleConfig(b.role).rank ?? 5));

  return (
    <div className="space-y-3">
      {/* Hierarchy */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-80 overflow-y-auto pr-1">
        {sorted.map((m, idx) => {
          const cfg = getRoleConfig(m.role);
          const isBoss = m.role === 'boss';
          const isHighRank = ['boss', 'underboss', 'consigliere'].includes(m.role);
          return (
            <div key={m.user_id} className={`relative flex items-center justify-between px-3 py-2.5 rounded-lg fam-member-row fam-fade-in overflow-hidden ${
              isBoss ? 'bg-gradient-to-r from-primary/8 to-primary/3 border-2 border-primary/30' : isHighRank ? 'bg-zinc-800/40 border border-zinc-700/40' : 'bg-zinc-800/30 border border-zinc-700/30'
            }`} style={{ animationDelay: `${idx * 0.03}s` }}>
              {isBoss && <>
                <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
                <div className="absolute -top-4 -left-4 w-16 h-16 bg-primary/5 rounded-full blur-xl pointer-events-none" />
              </>}
              <div className="min-w-0">
                <Link to={`/profile/${encodeURIComponent(m.username)}`} className={`font-heading font-bold text-xs hover:text-primary transition-colors block truncate ${isBoss ? 'text-primary' : 'text-foreground'}`}>
                  {m.username}
                </Link>
                <RoleBadge role={m.role} />
              </div>
              {canManage && m.role !== 'boss' && (
                <button onClick={() => onKick(m.user_id)} className="text-red-400 hover:text-red-300 text-[9px] font-bold px-2 py-1 rounded hover:bg-red-500/10 transition-all shrink-0">
                  Kick
                </button>
              )}
            </div>
          );
        })}
      </div>
      
      {/* Assign Role */}
      {myRole === 'boss' && (
        <div className="pt-3 border-t border-zinc-700/30">
          <p className="text-[9px] text-zinc-500 font-heading uppercase tracking-[0.2em] mb-2">Assign Rank</p>
          <form onSubmit={handleAssign} className="flex flex-wrap gap-2">
            <select value={assignRole} onChange={(e) => setAssignRole(e.target.value)}
              className="bg-zinc-900/80 border border-zinc-600/40 rounded-lg px-2 py-1.5 text-[10px] text-foreground font-heading focus:border-primary/50 focus:outline-none">
              {(config?.roles || []).filter((r) => r !== 'boss').map((role) => <option key={role} value={role}>{getRoleConfig(role).label}</option>)}
            </select>
            <select value={assignUserId} onChange={(e) => setAssignUserId(e.target.value)}
              className="flex-1 bg-zinc-900/80 border border-zinc-600/40 rounded-lg px-2 py-1.5 text-[10px] text-foreground font-heading focus:border-primary/50 focus:outline-none min-w-[80px]">
              <option value="">Member...</option>
              {members.filter((m) => m.role !== 'boss').map((m) => <option key={m.user_id} value={m.user_id}>{m.username}</option>)}
            </select>
            <button type="submit" className="px-3 py-1.5 rounded-lg text-[10px] font-heading font-bold uppercase tracking-wider bg-primary text-primaryForeground hover:opacity-90 transition-all">
              Assign
            </button>
          </form>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// ALL FAMILIES TAB
// ============================================================================

const FamiliesTab = ({ families, myFamilyId }) => (
  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-80 overflow-y-auto pr-1">
    {families.length === 0 ? (
      <div className="text-center py-10 col-span-2">
        <Building2 size={28} className="mx-auto text-zinc-700 mb-2" />
        <p className="text-xs text-zinc-500 font-heading tracking-wider uppercase">No known families</p>
        <p className="text-[9px] text-zinc-600 font-heading mt-1 italic">The underworld awaits its first Don</p>
      </div>
    ) : families.map((f, idx) => (
      <Link 
        key={f.id} 
        to={`/families/${encodeURIComponent(f.tag || f.id)}`} 
        className={`relative flex items-center justify-between px-3 py-2.5 rounded-lg transition-all group fam-member-row fam-fade-in overflow-hidden ${myFamilyId === f.id ? 'bg-primary/5 border border-primary/25' : 'bg-zinc-800/30 border border-zinc-700/30 hover:border-zinc-600/50'}`}
        style={{ animationDelay: `${idx * 0.03}s` }}
      >
        {myFamilyId === f.id && <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-primary/60" />}
        <div className="min-w-0">
          <span className="font-heading font-bold text-foreground text-xs group-hover:text-primary transition-colors tracking-wide">{f.name}</span>
          <span className="text-primary/50 text-[10px] ml-1">[{f.tag}]</span>
          {myFamilyId === f.id && <span className="text-[9px] text-primary ml-1 font-heading font-bold">(Yours)</span>}
        </div>
        <div className="flex items-center gap-3 text-[10px] shrink-0">
          <span className="text-zinc-400 flex items-center gap-0.5"><Users size={10} /> {f.member_count}</span>
          <span className="text-primary font-heading font-bold">{formatMoney(f.treasury)}</span>
          <ChevronRight size={12} className="text-zinc-600 group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
        </div>
      </Link>
    ))}
  </div>
);

// ============================================================================
// WAR HISTORY TAB
// ============================================================================

const WarHistoryTab = ({ wars }) => (
  <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
    {wars.length === 0 ? (
      <div className="text-center py-12 rounded-lg bg-zinc-800/20 border border-dashed border-zinc-700/40">
        <Swords size={32} className="mx-auto text-zinc-700 mb-3" />
        <p className="text-xs text-zinc-500 font-heading tracking-wider uppercase">No vendettas on record</p>
        <p className="text-[9px] text-zinc-600 font-heading mt-1 italic">Peace... or just the calm before the storm</p>
      </div>
    ) : wars.map((w, idx) => {
      const isActive = w.status === 'active' || w.status === 'truce_offered';
      const hasWinner = w.status === 'family_a_wins' || w.status === 'family_b_wins';
      return (
        <div key={w.id} className={`relative px-3 py-3 rounded-lg transition-all fam-fade-in overflow-hidden ${isActive ? 'bg-red-500/8 border fam-blood-pulse' : 'bg-zinc-800/30 border border-zinc-700/30 hover:bg-zinc-800/40'}`} style={{ animationDelay: `${idx * 0.04}s` }}>
          {isActive && <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-red-500/60" />}
          {hasWinner && <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-emerald-500/50" />}
          <div className="flex items-center justify-between">
            <div className="text-xs font-heading tracking-wide">
              <span className="text-foreground font-bold">{w.family_a_name}</span>
              <span className="text-zinc-600 mx-2 text-[10px] italic">vs</span>
              <span className="text-foreground font-bold">{w.family_b_name}</span>
            </div>
            {isActive && <span className="text-red-400 text-[10px] font-bold animate-pulse flex items-center gap-1"><Flame size={10} /> ACTIVE</span>}
            {hasWinner && <span className="text-emerald-400 text-[10px] font-heading font-bold flex items-center gap-1"><Trophy size={10} /> {w.winner_family_name}</span>}
          </div>
          <div className="text-[9px] text-zinc-500 mt-1 font-heading flex items-center gap-1">
            <Clock size={8} />
            {w.ended_at ? new Date(w.ended_at).toLocaleDateString() : 'Ongoing vendetta'}
          </div>
        </div>
      );
    })}
  </div>
);

// ============================================================================
// WAR MODAL — dramatic battle stats
// ============================================================================

const WarModal = ({ war, stats, family, canManage, onClose, onOfferTruce, onAcceptTruce }) => {
  if (!war) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-sm" onClick={onClose}>
      <div className={`relative w-full max-w-md ${styles.panel} rounded-xl overflow-hidden border-2 border-red-500/30 shadow-2xl fam-scale-in`} onClick={(e) => e.stopPropagation()}>
        <div className="absolute -top-10 left-1/2 -translate-x-1/2 w-40 h-20 bg-red-500/10 rounded-full blur-3xl pointer-events-none" />
        {/* War header */}
        <div className="px-4 py-3.5 flex items-center justify-between bg-gradient-to-r from-red-500/15 via-red-500/10 to-red-500/15 border-b border-red-500/20">
          <span className="text-sm font-heading font-bold text-red-400 uppercase tracking-[0.15em] flex items-center gap-2">
            <Swords size={16} /> Vendetta: {war.other_family_name}
          </span>
          <button onClick={onClose} className="text-zinc-500 hover:text-foreground transition-colors"><X size={16} /></button>
        </div>

        <div className="p-4 space-y-3">
          {war.status === 'truce_offered' && (
            <div className="text-[11px] rounded-lg px-3 py-2 bg-primary/10 text-primary border border-primary/30 font-heading font-bold text-center">
              ✋ Truce Offered
            </div>
          )}
          
          {stats && (
            <>
              {(stats.my_family_totals || stats.other_family_totals) && (
                <div className="grid grid-cols-2 gap-3 pb-3 border-b border-zinc-700/30">
                  <div className="p-3 rounded-lg text-center bg-emerald-500/10 border border-emerald-500/25">
                    <div className="text-[9px] text-zinc-400 uppercase tracking-wider font-heading mb-1">Our Famiglia</div>
                    <div className="text-base font-heading font-bold text-emerald-400">
                      {stats.my_family_totals?.kills ?? 0}K / {stats.my_family_totals?.deaths ?? 0}D
                    </div>
                    <div className="text-[9px] text-zinc-500 mt-0.5">BG kills: {stats.my_family_totals?.bodyguard_kills ?? 0} · Lost: {stats.my_family_totals?.bodyguards_lost ?? 0}</div>
                  </div>
                  <div className="p-3 rounded-lg text-center bg-red-500/10 border border-red-500/25">
                    <div className="text-[9px] text-zinc-400 uppercase tracking-wider font-heading mb-1">The Enemy</div>
                    <div className="text-base font-heading font-bold text-red-400">
                      {stats.other_family_totals?.kills ?? 0}K / {stats.other_family_totals?.deaths ?? 0}D
                    </div>
                    <div className="text-[9px] text-zinc-500 mt-0.5">BG kills: {stats.other_family_totals?.bodyguard_kills ?? 0} · Lost: {stats.other_family_totals?.bodyguards_lost ?? 0}</div>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="p-2.5 rounded-lg bg-zinc-800/30 border border-zinc-700/30">
                  <Shield size={14} className="mx-auto mb-1 text-primary" />
                  <div className="text-[9px] text-zinc-500 font-heading">Top BG Kills</div>
                  {stats.top_bodyguard_killers?.[0] && (
                    <div className="text-[10px] text-foreground font-bold truncate mt-0.5">
                      <Link to={`/profile/${encodeURIComponent(stats.top_bodyguard_killers[0].username)}`} className="text-primary hover:underline">{stats.top_bodyguard_killers[0].username}</Link>: {stats.top_bodyguard_killers[0].bodyguard_kills}
                    </div>
                  )}
                </div>
                <div className="p-2.5 rounded-lg bg-zinc-800/30 border border-zinc-700/30">
                  <Skull size={14} className="mx-auto text-red-400 mb-1" />
                  <div className="text-[9px] text-zinc-500 font-heading">Most BGs Lost</div>
                  {stats.top_bodyguards_lost?.[0] && (
                    <div className="text-[10px] text-foreground font-bold truncate mt-0.5">
                      <Link to={`/profile/${encodeURIComponent(stats.top_bodyguards_lost[0].username)}`} className="text-primary hover:underline">{stats.top_bodyguards_lost[0].username}</Link>: {stats.top_bodyguards_lost[0].bodyguards_lost}
                    </div>
                  )}
                </div>
                <div className="p-2.5 rounded-lg bg-zinc-800/30 border border-zinc-700/30">
                  <Trophy size={14} className="mx-auto text-yellow-400 mb-1" />
                  <div className="text-[9px] text-zinc-500 font-heading">MVP</div>
                  {stats.mvp?.[0] && (
                    <div className="text-[10px] text-foreground font-bold truncate mt-0.5">
                      <Link to={`/profile/${encodeURIComponent(stats.mvp[0].username)}`} className="text-primary hover:underline">{stats.mvp[0].username}</Link>: {(stats.mvp[0].impact ?? (stats.mvp[0].kills ?? 0) + (stats.mvp[0].bodyguard_kills ?? 0))}
                    </div>
                  )}
                </div>
              </div>
              {stats.top_killers?.[0] && (
                <div className="text-[9px] text-zinc-500 text-center pt-1 font-heading">
                  Most kills: <Link to={`/profile/${encodeURIComponent(stats.top_killers[0].username)}`} className="text-primary font-bold hover:underline">{stats.top_killers[0].username}</Link> ({stats.top_killers[0].kills ?? 0})
                </div>
              )}
            </>
          )}
          
          {canManage && (
            <div className="flex gap-2 pt-3 border-t border-zinc-700/30">
              {war.status === 'active' && (
                <button onClick={onOfferTruce} className="flex-1 py-2 rounded-lg text-[10px] font-heading font-bold uppercase border bg-zinc-800/60 border-zinc-600/40 text-zinc-300 hover:border-primary/40 hover:text-primary transition-all">
                  🤝 Offer Truce
                </button>
              )}
              {war.status === 'truce_offered' && war.truce_offered_by_family_id !== family?.id && (
                <button onClick={onAcceptTruce} className="flex-1 py-2 rounded-lg text-[10px] font-heading font-bold uppercase border bg-primary/20 border-primary/50 text-primary hover:bg-primary/30 transition-all">
                  ✓ Accept Truce
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// CREW OC TAB
// ============================================================================

const CrewOCTab = ({
  family, myRole, crewOCCooldownUntil, committerHasTimer, crewOCJoinFee, crewOCForumTopicId,
  crewOCApplications, canManageCrewOC, onCommit, committing, feeInput, setFeeInput,
  onSetFee, setFeeLoading, onAdvertise, advertiseLoading, onAcceptApp, onRejectApp,
}) => {
  const canCommit = ['boss', 'underboss', 'capo'].includes(myRole?.toLowerCase());
  const cooldownHours = committerHasTimer ? 6 : 8;
  const now = Date.now();
  const until = family?.crew_oc_cooldown_until ? new Date(family.crew_oc_cooldown_until).getTime() : 0;
  const onCooldown = until > now;
  const timeLeft = onCooldown ? formatTimeLeft(family.crew_oc_cooldown_until) : 'Ready';
  const pending = (crewOCApplications || []).filter((a) => a.status === 'pending');
  const accepted = (crewOCApplications || []).filter((a) => a.status === 'accepted');

  return (
    <div className="space-y-3">
      <p className="text-[10px] text-zinc-500 font-heading leading-relaxed italic">
        When the Don, Underboss, or Caporegime calls the crew together, every living member and accepted outsiders earn their cut — cash, XP, bullets, points, booze. The family vault takes its share. Once every {cooldownHours}h{committerHasTimer ? ' (you hold the timer)' : ''}.
      </p>

      {/* Set join fee & Advertise */}
      {canManageCrewOC && (
        <div className="space-y-2 p-3 rounded-lg bg-zinc-800/30 border border-zinc-700/30">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] text-zinc-500 font-heading">Join fee:</span>
            <span className="text-[10px] font-heading text-primary">{(crewOCJoinFee ?? 0) > 0 ? `Current: ${formatMoney(crewOCJoinFee)}` : 'Free'}</span>
            <input
              type="number" min={0} value={feeInput} onChange={(e) => setFeeInput(e.target.value.replace(/\D/g, ''))} placeholder="0 = free"
              className="w-24 bg-zinc-900/80 border border-zinc-600/40 rounded-lg px-2 py-1 text-xs text-foreground font-heading focus:border-primary/50 focus:outline-none"
            />
            <button type="button" onClick={onSetFee} disabled={setFeeLoading}
              className="px-2.5 py-1 text-[10px] font-heading font-bold uppercase rounded-lg border bg-primary/20 border-primary/50 text-primary hover:bg-primary/30 disabled:opacity-50 transition-all">
              {setFeeLoading ? '...' : 'Set fee'}
            </button>
          </div>
          <div className="flex items-center gap-2">
            {crewOCForumTopicId ? (
              <Link to={`/forum/topic/${crewOCForumTopicId}`} className="inline-flex items-center gap-1 text-xs font-heading text-primary hover:underline">
                <MessageSquare size={12} /> View Crew OC topic
              </Link>
            ) : (
              <button type="button" onClick={onAdvertise} disabled={advertiseLoading}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-[10px] font-heading font-bold uppercase rounded-lg border bg-primary/20 border-primary/50 text-primary hover:bg-primary/30 disabled:opacity-50 transition-all">
                <MessageSquare size={12} /> {advertiseLoading ? '...' : 'Advertise'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Cooldown & commit */}
      <div className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-zinc-800/30 border border-zinc-700/30">
        <span className="text-[10px] text-zinc-500 font-heading flex items-center gap-1"><Clock size={10} /> Next commit</span>
        <span className={`text-xs font-heading font-bold ${onCooldown ? 'text-amber-400' : 'text-emerald-400'}`}>{timeLeft}</span>
      </div>

      {canCommit ? (
        <button type="button" onClick={onCommit} disabled={onCooldown || committing}
          className={`w-full py-3 font-heading font-bold uppercase tracking-wider text-xs rounded-lg border-2 transition-all ${
            onCooldown || committing
              ? 'opacity-40 cursor-not-allowed bg-zinc-800 text-zinc-500 border-zinc-700'
              : 'bg-gradient-to-b from-primary/30 to-primary/10 border-primary/50 text-primary hover:from-primary/40 hover:shadow-lg hover:shadow-primary/10'
          }`}>
          {committing ? 'Committing...' : onCooldown ? `Cooldown ${timeLeft}` : 'Commit Crew OC'}
        </button>
      ) : (
        <p className="text-[10px] text-zinc-500 font-heading">Only Boss, Underboss, or Capo can commit.</p>
      )}

      {/* Applications */}
      {(pending.length > 0 || accepted.length > 0) && (
        <div className="space-y-2 pt-2 border-t border-zinc-700/30">
          <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-wider flex items-center gap-1">
            <UserPlus size={12} /> Applications
          </span>
          {accepted.length > 0 && (
            <div className="text-[10px] text-zinc-400 font-heading">
              In crew: {accepted.map((a, i) => (
              <span key={a.id}>{i > 0 && ', '}<Link to={`/profile/${encodeURIComponent(a.username)}`} className="text-primary hover:underline">{a.username}</Link></span>
            ))}
            </div>
          )}
          {pending.map((a) => (
            <div key={a.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-zinc-800/30 border border-zinc-700/30">
              <Link to={`/profile/${encodeURIComponent(a.username)}`} className="text-xs font-heading text-primary hover:underline">{a.username}</Link>
              {canManageCrewOC && (
                <div className="flex gap-2">
                  <button type="button" onClick={() => onAcceptApp(a.id)} className="text-[10px] font-bold text-emerald-400 hover:underline">Accept</button>
                  <button type="button" onClick={() => onRejectApp(a.id)} className="text-[10px] font-bold text-red-400 hover:underline">Reject</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ============================================================================
// NO FAMILY VIEW — recruitment board
// ============================================================================

const NoFamilyView = ({ families, createName, setCreateName, createTag, setCreateTag, onCreate, joinId, setJoinId, onJoin }) => (
  <div className="space-y-4">
    {/* Flavor text */}
    <div className="text-center py-2 fam-fade-in">
      <p className="text-[10px] text-zinc-500 font-heading italic leading-relaxed max-w-md mx-auto">
        "In this world, a man without a family is nothing. You need people you can trust — people who bleed for you."
      </p>
    </div>

    {/* Establish a Crime Family */}
    <div className={`${styles.panel} rounded-xl overflow-hidden border-2 border-primary/25 fam-fade-in`} style={{ animationDelay: '0.1s' }}>
      <div className="px-4 py-3 flex items-center gap-2 bg-primary/10 border-b border-primary/20">
        <Building2 size={16} className="text-primary" />
        <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">Establish a Crime Family</span>
      </div>
      <form onSubmit={onCreate} className="p-4 space-y-3">
        <p className="text-[10px] text-zinc-500 font-heading">Become the Don. Build your empire from nothing, recruit soldiers, run rackets, and make your name feared across every borough.</p>
        <div className="flex gap-2">
          <input type="text" value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder="Family name" maxLength={30}
            className="flex-1 bg-zinc-900/80 border border-zinc-600/40 rounded-lg px-3 py-2.5 text-sm text-foreground font-heading focus:border-primary/50 focus:outline-none transition-colors" />
          <input type="text" value={createTag} onChange={(e) => setCreateTag(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} placeholder="TAG" maxLength={4}
            className="w-20 bg-zinc-900/80 border border-zinc-600/40 rounded-lg px-3 py-2.5 text-sm text-foreground font-heading uppercase text-center focus:border-primary/50 focus:outline-none transition-colors" />
        </div>
        <button type="submit" className="w-full py-3 rounded-lg text-xs font-heading font-bold uppercase tracking-wider border-2 bg-gradient-to-b from-primary/30 to-primary/10 border-primary/50 text-primary hover:from-primary/40 hover:shadow-lg hover:shadow-primary/10 transition-all">
          Found the Family
        </button>
      </form>
    </div>

    {/* Swear Allegiance */}
    <div className={`${styles.panel} rounded-xl overflow-hidden fam-fade-in`} style={{ animationDelay: '0.2s' }}>
      <div className="px-4 py-3 flex items-center gap-2 border-b border-zinc-700/30">
        <Users size={16} className="text-primary" />
        <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">Swear Allegiance</span>
      </div>
      <form onSubmit={onJoin} className="p-4 space-y-2">
        <p className="text-[10px] text-zinc-500 font-heading">Pledge yourself to a family. Work your way up from associate to caporegime — or maybe one day, the Don himself.</p>
        <div className="flex gap-2">
          <select value={joinId} onChange={(e) => setJoinId(e.target.value)}
            className="flex-1 bg-zinc-900/80 border border-zinc-600/40 rounded-lg px-3 py-2.5 text-xs text-foreground font-heading focus:border-primary/50 focus:outline-none transition-colors">
            <option value="">Select family...</option>
            {families.map((f) => <option key={f.id} value={f.id}>{f.name} [{f.tag}]</option>)}
          </select>
          <button type="submit" className="px-5 py-2.5 rounded-lg text-xs font-heading font-bold uppercase border bg-zinc-800/60 border-zinc-600/40 text-zinc-300 hover:border-primary/40 hover:text-primary transition-all">
            Join
          </button>
        </div>
      </form>
    </div>

    {/* Known Families */}
    <div className={`${styles.panel} rounded-xl overflow-hidden fam-fade-in`} style={{ animationDelay: '0.3s' }}>
      <div className="px-4 py-3 flex items-center gap-2 border-b border-zinc-700/30">
        <Building2 size={16} className="text-zinc-400" />
        <span className="text-xs font-heading font-bold text-zinc-400 uppercase tracking-widest">Known Families</span>
      </div>
      <div className="p-3">
        <FamiliesTab families={families} myFamilyId={null} />
      </div>
    </div>
  </div>
);

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function FamilyPage() {
  const [families, setFamilies] = useState([]);
  const [myFamily, setMyFamily] = useState(null);
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('rackets');
  const [createName, setCreateName] = useState('');
  const [createTag, setCreateTag] = useState('');
  const [joinId, setJoinId] = useState('');
  const [depositAmount, setDepositAmount] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [warStats, setWarStats] = useState(null);
  const [warHistory, setWarHistory] = useState([]);
  const [showWarModal, setShowWarModal] = useState(false);
  const [selectedWarIndex, setSelectedWarIndex] = useState(0);
  const [event, setEvent] = useState(null);
  const [eventsEnabled, setEventsEnabled] = useState(false);
  const [, setTick] = useState(0);
  const [racketAttackTargets, setRacketAttackTargets] = useState([]);
  const [racketAttackLoading, setRacketAttackLoading] = useState(null);
  const [raidCooldownUntil, setRaidCooldownUntil] = useState(0);
  const [targetsRefreshing, setTargetsRefreshing] = useState(false);
  const [crewOCCommitting, setCrewOCCommitting] = useState(false);
  const [crewOCFeeInput, setCrewOCFeeInput] = useState('');
  const [crewOCSetFeeLoading, setCrewOCSetFeeLoading] = useState(false);
  const [crewOCAdvertiseLoading, setCrewOCAdvertiseLoading] = useState(false);

  const family = myFamily?.family;
  const members = myFamily?.members || [];
  const rackets = myFamily?.rackets || [];
  const myRole = myFamily?.my_role?.toLowerCase() || null;
  const canManage = ['boss', 'underboss'].includes(myRole);
  const canWithdraw = ['boss', 'underboss', 'consigliere'].includes(myRole);
  const canUpgradeRacket = ['boss', 'underboss', 'consigliere'].includes(myRole);
  const canManageCrewOC = ['boss', 'underboss', 'capo'].includes(myRole);
  const activeWars = warStats?.wars ?? [];

  const readyRackets = rackets.filter(r => r.level > 0 && (!formatTimeLeft(r.next_collect_at) || formatTimeLeft(r.next_collect_at) === 'Ready')).length;
  const unlockedRackets = rackets.filter(r => r.level > 0).length;

  const fetchData = useCallback(async () => {
    try {
      const [listRes, myRes, configRes, historyRes, eventsRes] = await Promise.allSettled([
        api.get('/families'), api.get('/families/my'), api.get('/families/config').catch(() => ({ data: {} })),
        api.get('/families/wars/history').catch(() => ({ data: { wars: [] } })), api.get('/events/active').catch(() => ({ data: { event: null, events_enabled: false } })),
      ]);
      if (listRes.status === 'fulfilled') setFamilies(listRes.value?.data || []);
      if (myRes.status === 'fulfilled' && myRes.value?.data) {
        setMyFamily(myRes.value.data);
        if (myRes.value.data?.family) {
          const [statsRes, targetsRes] = await Promise.allSettled([api.get('/families/war/stats'), api.get('/families/racket-attack-targets', { params: { _: Date.now() } })]);
          if (statsRes.status === 'fulfilled') setWarStats(statsRes.value?.data);
          setRacketAttackTargets(targetsRes.status === 'fulfilled' ? targetsRes.value?.data?.targets ?? [] : []);
        } else { setWarStats(null); setRacketAttackTargets([]); }
      }
      if (configRes.status === 'fulfilled') setConfig(configRes.value?.data);
      if (historyRes.status === 'fulfilled') setWarHistory(historyRes.value?.data?.wars || []);
      if (eventsRes.status === 'fulfilled') { setEvent(eventsRes.value?.data?.event ?? null); setEventsEnabled(!!eventsRes.value?.data?.events_enabled); }
    } catch (e) { toast.error(apiDetail(e)); } finally { setLoading(false); }
  }, []);

  const fetchRacketAttackTargets = useCallback(async () => {
    if (!myFamily?.family) return;
    setTargetsRefreshing(true);
    try { const res = await api.get('/families/racket-attack-targets', { params: { _: Date.now() } }); setRacketAttackTargets(res.data?.targets ?? []); }
    catch { setRacketAttackTargets([]); } finally { setTargetsRefreshing(false); }
  }, [myFamily?.family]);

  // Handlers — all preserved exactly
  const handleCreate = async (e) => { e.preventDefault(); const name = createName.trim(), tag = createTag.trim().toUpperCase(); if (!name || !tag) { toast.error('Name and tag required'); return; } try { await api.post('/families', { name, tag }); toast.success('Family created!'); setCreateName(''); setCreateTag(''); refreshUser(); fetchData(); } catch (e) { toast.error(apiDetail(e)); } };
  const handleJoin = async (e) => { e.preventDefault(); if (!joinId) { toast.error('Select a family'); return; } try { await api.post('/families/join', { family_id: joinId }); toast.success('Joined!'); setJoinId(''); refreshUser(); fetchData(); } catch (e) { toast.error(apiDetail(e)); } };
  const handleLeave = async () => { if (!window.confirm('Leave family?')) return; try { await api.post('/families/leave'); toast.success('Left'); refreshUser(); fetchData(); } catch (e) { toast.error(apiDetail(e)); } };
  const handleKick = async (userId) => { if (!window.confirm('Kick?')) return; try { await api.post('/families/kick', { user_id: userId }); toast.success('Kicked'); fetchData(); } catch (e) { toast.error(apiDetail(e)); } };
  const handleAssignRole = async (userId, role) => { try { await api.post('/families/assign-role', { user_id: userId, role }); toast.success(`Assigned ${getRoleConfig(role).label}`); fetchData(); } catch (e) { toast.error(apiDetail(e)); } };
  const handleDeposit = async (e) => { e.preventDefault(); const amount = parseInt(depositAmount.replace(/\D/g, ''), 10); if (!amount) return; try { await api.post('/families/deposit', { amount }); toast.success('Deposited'); setDepositAmount(''); refreshUser(); fetchData(); } catch (e) { toast.error(apiDetail(e)); } };
  const handleWithdraw = async (e) => { e.preventDefault(); const amount = parseInt(withdrawAmount.replace(/\D/g, ''), 10); if (!amount) return; try { await api.post('/families/withdraw', { amount }); toast.success('Withdrew'); setWithdrawAmount(''); refreshUser(); fetchData(); } catch (e) { toast.error(apiDetail(e)); } };
  const collectRacket = async (id) => { try { const res = await api.post(`/families/rackets/${id}/collect`); toast.success(res.data?.message || 'Collected'); fetchData(); } catch (e) { toast.error(apiDetail(e)); } };
  const upgradeRacket = async (id) => { try { const res = await api.post(`/families/rackets/${id}/upgrade`); toast.success(res.data?.message || 'Upgraded'); fetchData(); } catch (e) { toast.error(apiDetail(e)); } };
  const unlockRacket = async (id) => { try { const res = await api.post(`/families/rackets/${id}/unlock`); toast.success(res.data?.message || 'Unlocked'); fetchData(); } catch (e) { toast.error(apiDetail(e)); } };
  const attackFamilyRacket = async (familyId, racketId) => {
    setRacketAttackLoading(`${familyId}-${racketId}`);
    try {
      const res = await api.post('/families/attack-racket', { family_id: familyId, racket_id: racketId });
      res.data?.success ? toast.success(res.data?.message || 'Success!') : toast.error(res.data?.message || 'Failed');
      fetchRacketAttackTargets(); fetchData();
    } catch (e) { toast.error(apiDetail(e)); }
    finally { setRacketAttackLoading(null); setRaidCooldownUntil(Date.now() + 2000); }
  };
  const handleOfferTruce = async () => { const entry = activeWars[selectedWarIndex]; if (!entry?.war?.id) return; try { await api.post('/families/war/truce/offer', { war_id: entry.war.id }); toast.success('Truce offered'); fetchData(); setShowWarModal(false); } catch (e) { toast.error(apiDetail(e)); } };
  const handleAcceptTruce = async () => { const entry = activeWars[selectedWarIndex]; if (!entry?.war?.id) return; try { await api.post('/families/war/truce/accept', { war_id: entry.war.id }); toast.success('Accepted'); fetchData(); setShowWarModal(false); } catch (e) { toast.error(apiDetail(e)); } };
  const handleCrewOCCommit = async () => {
    setCrewOCCommitting(true);
    try { const res = await api.post('/families/crew-oc/commit'); toast.success(res.data?.message || 'Crew OC committed.'); refreshUser(); fetchData(); }
    catch (e) { toast.error(apiDetail(e)); } finally { setCrewOCCommitting(false); }
  };
  const handleCrewOCSetFee = async () => {
    const fee = parseInt(crewOCFeeInput.replace(/\D/g, ''), 10);
    if (Number.isNaN(fee) || fee < 0) { toast.error('Enter a valid fee (0 or more)'); return; }
    setCrewOCSetFeeLoading(true);
    try { await api.post('/families/crew-oc/set-fee', { fee }); toast.success('Join fee updated.'); setCrewOCFeeInput(''); fetchData(); }
    catch (e) { toast.error(apiDetail(e)); } finally { setCrewOCSetFeeLoading(false); }
  };
  const handleCrewOCAdvertise = async () => {
    setCrewOCAdvertiseLoading(true);
    try { const res = await api.post('/families/crew-oc/advertise'); toast.success(res.data?.message || 'Crew OC topic created.'); fetchData(); }
    catch (e) { toast.error(apiDetail(e)); } finally { setCrewOCAdvertiseLoading(false); }
  };
  const handleCrewOCAccept = async (applicationId) => {
    try { await api.post(`/families/crew-oc/applications/${applicationId}/accept`); toast.success('Application accepted.'); fetchData(); }
    catch (e) { toast.error(apiDetail(e)); }
  };
  const handleCrewOCReject = async (applicationId) => {
    try { await api.post(`/families/crew-oc/applications/${applicationId}/reject`); toast.success('Application rejected.'); fetchData(); }
    catch (e) { toast.error(apiDetail(e)); }
  };

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { const id = setInterval(() => setTick((t) => t + 1), 1000); return () => clearInterval(id); }, []);
  useEffect(() => { if (showWarModal && myFamily?.family) api.get('/families/war/stats').then((res) => setWarStats(res.data)).catch(() => {}); }, [showWarModal, myFamily?.family]);

  if (loading) return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
      <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      <span className="text-primary text-[10px] font-heading uppercase tracking-[0.3em]">Gathering intel...</span>
    </div>
  );

  return (
    <div className={`space-y-4 ${styles.pageContent}`} data-testid="families-page">
      <style>{`
        @keyframes ready-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(var(--noir-primary-rgb), 0); }
          50% { box-shadow: 0 0 12px 2px rgba(var(--noir-primary-rgb), 0.15); }
        }
        .animate-ready-pulse { animation: ready-pulse 2s ease-in-out infinite; }
        @keyframes fam-fade-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .fam-fade-in { animation: fam-fade-in 0.5s ease-out both; }
        @keyframes fam-glow { 0%, 100% { opacity: 0.3; } 50% { opacity: 0.7; } }
        .fam-glow { animation: fam-glow 4s ease-in-out infinite; }
        @keyframes fam-slide-right { from { opacity: 0; transform: translateX(-12px); } to { opacity: 1; transform: translateX(0); } }
        .fam-slide-right { animation: fam-slide-right 0.4s ease-out both; }
        @keyframes fam-scale-in { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
        .fam-scale-in { animation: fam-scale-in 0.35s ease-out both; }
        @keyframes fam-gold-shimmer {
          0% { background-position: -200% center; }
          100% { background-position: 200% center; }
        }
        .fam-shimmer-text {
          background: linear-gradient(90deg, rgba(var(--noir-primary-rgb),0.6) 0%, rgba(var(--noir-primary-rgb),1) 50%, rgba(var(--noir-primary-rgb),0.6) 100%);
          background-size: 200% auto;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          animation: fam-gold-shimmer 3s linear infinite;
        }
        .art-deco-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.15; }
        .art-deco-corner::before, .art-deco-corner::after {
          content: ''; position: absolute; width: 12px; height: 12px; border-color: rgba(var(--noir-primary-rgb), 0.2); pointer-events: none;
        }
        .art-deco-corner::before { top: 4px; left: 4px; border-top: 1px solid; border-left: 1px solid; }
        .art-deco-corner::after { bottom: 4px; right: 4px; border-bottom: 1px solid; border-right: 1px solid; }
        .fam-stat-card { transition: all 0.3s ease; }
        .fam-stat-card:hover { transform: translateY(-2px); box-shadow: 0 4px 16px rgba(0,0,0,0.3), 0 0 0 1px rgba(var(--noir-primary-rgb), 0.1); }
        .fam-racket-card { transition: all 0.3s ease; }
        .fam-racket-card:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(0,0,0,0.25); }
        .fam-member-row { transition: all 0.2s ease; }
        .fam-member-row:hover { transform: translateX(3px); background-color: rgba(var(--noir-primary-rgb), 0.05); }
        .fam-target-card { transition: all 0.3s ease; }
        .fam-target-card:hover { transform: scale(1.01); }
        @keyframes fam-blood-pulse { 0%, 100% { border-color: rgba(239, 68, 68, 0.25); } 50% { border-color: rgba(239, 68, 68, 0.5); } }
        .fam-blood-pulse { animation: fam-blood-pulse 2s ease-in-out infinite; }
        .fam-vault-bg {
          background: radial-gradient(ellipse at center, rgba(var(--noir-primary-rgb), 0.08) 0%, transparent 70%);
        }
      `}</style>

      {/* ── Family HQ Header ── */}
      <div className={`relative rounded-xl overflow-hidden fam-fade-in ${family ? `${styles.panel} border-2 border-primary/20` : ''}`}>
        {family && <>
          <div className="h-1 bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
          <div className="absolute top-0 left-0 w-32 h-32 bg-primary/5 rounded-full blur-3xl pointer-events-none fam-glow" />
          <div className="absolute top-0 right-0 w-24 h-24 bg-primary/3 rounded-full blur-2xl pointer-events-none" />
        </>}

        <div className={`${family ? 'px-4 py-5 sm:px-6' : ''}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              {family ? (
                <>
                  <p className="text-[9px] text-primary/40 font-heading uppercase tracking-[0.3em] mb-1">La Cosa Nostra</p>
                  <h1 className="text-xl sm:text-2xl font-heading font-bold text-primary flex items-center gap-2 tracking-wider uppercase">
                    {family.name}
                    <span className="text-sm text-primary/40 font-mono font-normal">[{family.tag}]</span>
                  </h1>
                </>
              ) : (
                <>
                  <p className="text-[9px] text-primary/40 font-heading uppercase tracking-[0.3em] mb-1">The Five Families & Beyond</p>
                  <h1 className="text-xl sm:text-2xl font-heading font-bold text-primary tracking-wider uppercase">
                    Crime Families
                  </h1>
                </>
              )}
              {family && (
                <div className="flex items-center gap-2 mt-2">
                  <RoleBadge role={myRole} size="lg" />
                  {activeWars.length > 0 && (
                    <button onClick={() => { setSelectedWarIndex(0); setShowWarModal(true); }}
                      className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold bg-red-500/15 border border-red-500/30 text-red-400 animate-pulse hover:bg-red-500/25 transition-all">
                      <Swords size={11} /> At War ({activeWars.length})
                    </button>
                  )}
                </div>
              )}
            </div>
            {family && (
              <button onClick={handleLeave} className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-red-400 px-2 py-1 rounded-md hover:bg-red-500/10 transition-all">
                <LogOut size={11} /> Leave
              </button>
            )}
          </div>
        </div>

        {family && <div className="art-deco-line text-primary mx-4" />}
      </div>

      {family ? (
        <>
          {/* ── Stats Row ── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <StatCard label="The Vault" value={formatMoney(family.treasury)} icon={<DollarSign size={10} />} accent="text-primary" delay={0} />
            <StatCard label="Made Men" value={members.length} icon={<Users size={10} />} delay={0.05} />
            <StatCard label="Rackets" value={`${unlockedRackets}/${rackets.length}`} icon={<TrendingUp size={10} />} delay={0.1} />
            <StatCard label="Ready" value={readyRackets} highlight={readyRackets > 0} icon={<Clock size={10} />} delay={0.15} />
          </div>

          {/* ── War Banner ── */}
          {activeWars.length > 0 && (
            <div className="flex items-center justify-between px-4 py-3 rounded-lg bg-red-500/8 border fam-blood-pulse fam-fade-in relative overflow-hidden">
              <div className="absolute left-0 top-0 bottom-0 w-1 bg-red-500/40" />
              <div className="flex items-center gap-2 flex-wrap">
                <Swords size={15} className="text-red-400 animate-pulse shrink-0" />
                <span className="text-xs text-red-400 font-heading font-bold tracking-wider uppercase">Blood Feud:</span>
                {activeWars.map((entry, i) => (
                  <button key={entry.war?.id} onClick={() => { setSelectedWarIndex(i); setShowWarModal(true); }}
                    className="text-xs text-foreground hover:text-primary font-heading transition-colors">
                    vs {entry.war?.other_family_name} <span className="text-primary">[{entry.war?.other_family_tag}]</span>
                  </button>
                ))}
              </div>
              <button onClick={() => { setSelectedWarIndex(0); setShowWarModal(true); }} className="text-[10px] text-zinc-500 hover:text-foreground shrink-0 transition-colors">
                Details →
              </button>
            </div>
          )}

          {/* ── Tabbed Content ── */}
          <div className={`${styles.panel} rounded-xl overflow-hidden`}>
            {/* Tab bar */}
            <div className="flex overflow-x-auto scrollbar-hide border-b border-zinc-700/40 bg-zinc-900/70">
              <Tab active={activeTab === 'rackets'} onClick={() => setActiveTab('rackets')} icon={<TrendingUp size={10} />}>Rackets</Tab>
              <Tab active={activeTab === 'raid'} onClick={() => setActiveTab('raid')} icon={<Swords size={10} />}>Hit Jobs</Tab>
              <Tab active={activeTab === 'crewoc'} onClick={() => setActiveTab('crewoc')} icon={<Crosshair size={10} />}>Crew OC</Tab>
              <Tab active={activeTab === 'treasury'} onClick={() => setActiveTab('treasury')} icon={<DollarSign size={10} />}>Vault</Tab>
              <Tab active={activeTab === 'roster'} onClick={() => setActiveTab('roster')} icon={<Users size={10} />}>Made Men</Tab>
              <Tab active={activeTab === 'families'} onClick={() => setActiveTab('families')} icon={<Building2 size={10} />}>Families</Tab>
              <Tab active={activeTab === 'history'} onClick={() => setActiveTab('history')} icon={<Trophy size={10} />}>Vendettas</Tab>
            </div>

            {/* Tab content */}
            <div className="p-4">
              {activeTab === 'rackets' && <RacketsTab rackets={rackets} config={config} canUpgrade={canUpgradeRacket} onCollect={collectRacket} onUpgrade={upgradeRacket} onUnlock={unlockRacket} event={event} eventsEnabled={eventsEnabled} />}
              {activeTab === 'crewoc' && (
                <CrewOCTab
                  family={family} myRole={myRole} crewOCCooldownUntil={family?.crew_oc_cooldown_until}
                  committerHasTimer={myFamily?.crew_oc_committer_has_timer} crewOCJoinFee={family?.crew_oc_join_fee}
                  crewOCForumTopicId={family?.crew_oc_forum_topic_id} crewOCApplications={myFamily?.crew_oc_applications}
                  canManageCrewOC={canManageCrewOC} onCommit={handleCrewOCCommit} committing={crewOCCommitting}
                  feeInput={crewOCFeeInput} setFeeInput={setCrewOCFeeInput} onSetFee={handleCrewOCSetFee}
                  setFeeLoading={crewOCSetFeeLoading} onAdvertise={handleCrewOCAdvertise} advertiseLoading={crewOCAdvertiseLoading}
                  onAcceptApp={handleCrewOCAccept} onRejectApp={handleCrewOCReject}
                />
              )}
              {activeTab === 'raid' && (
                <RaidTab targets={racketAttackTargets} loading={racketAttackLoading}
                  raidCooldown={raidCooldownUntil > 0 && Date.now() < raidCooldownUntil}
                  onRaid={attackFamilyRacket} onRefresh={fetchRacketAttackTargets} refreshing={targetsRefreshing} />
              )}
              {activeTab === 'treasury' && <TreasuryTab treasury={family.treasury} canWithdraw={canWithdraw} depositAmount={depositAmount} setDepositAmount={setDepositAmount} withdrawAmount={withdrawAmount} setWithdrawAmount={setWithdrawAmount} onDeposit={handleDeposit} onWithdraw={handleWithdraw} />}
              {activeTab === 'roster' && <RosterTab members={members} canManage={canManage} myRole={myRole} config={config} onKick={handleKick} onAssignRole={handleAssignRole} />}
              {activeTab === 'families' && <FamiliesTab families={families} myFamilyId={family?.id} />}
              {activeTab === 'history' && <WarHistoryTab wars={warHistory} />}
            </div>
          </div>
        </>
      ) : (
        <NoFamilyView families={families} createName={createName} setCreateName={setCreateName} createTag={createTag} setCreateTag={setCreateTag} onCreate={handleCreate} joinId={joinId} setJoinId={setJoinId} onJoin={handleJoin} />
      )}

      {/* War Modal */}
      {showWarModal && activeWars[selectedWarIndex] && (
        <WarModal 
          war={activeWars[selectedWarIndex].war} stats={activeWars[selectedWarIndex].stats} 
          family={family} canManage={canManage} onClose={() => setShowWarModal(false)} 
          onOfferTruce={handleOfferTruce} onAcceptTruce={handleAcceptTruce} 
        />
      )}
    </div>
  );
}
