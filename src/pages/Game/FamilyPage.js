import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Users, Building2, DollarSign, TrendingUp, TrendingDown, LogOut, Swords, Trophy, Shield, Skull, X, Crosshair, RefreshCw, Clock, ChevronRight, MessageSquare, UserPlus, Lock, Unlock, ArrowUpCircle, Flame, MapPin, Plane, Sparkles } from 'lucide-react';
import api, { refreshUser } from '../../utils/api';
import { toast } from 'sonner';
import { getRacketAccent } from '../../constants';
import { FormattedNumberInput } from '../../components/FormattedNumberInput';
import styles from '../../styles/noir.module.css';
import { getFamiliesPrefetch, setFamiliesPrefetch } from '../../utils/prefetchCache';
import FamilyEmblem, { FAMILY_EMBLEM_PRESETS, groupFamilyEmblemPresets } from '../../components/FamilyEmblem';
import { fileToCompressedDataUrl, validateSafeImageFile } from '../../utils/fileToCompressedDataUrl';

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

const VAULT_TX_KIND_LABELS = {
  deposit: 'Deposit',
  withdraw: 'Withdraw',
  give_bullets: 'Give bullets',
  split_bullets: 'Split all bullets',
  give_loot: 'Give loot box pieces',
  split_loot: 'Split all loot box pieces',
  compound_to_vault: 'Compound → vault',
  crew_oc_join_fee: 'Crew OC join fee',
  crew_oc_refund: 'Crew OC refund',
  crew_oc_commit: 'Crew OC commit',
  racket_collect: 'Racket income',
  racket_unlock: 'Racket unlock',
  racket_upgrade: 'Racket upgrade',
  racket_raid_lost: 'Raided (lost cash)',
  racket_raid_won: 'Raid (stolen)',
  gta_melt: 'Garage melt',
  hourly_bullets_bonus: 'Hourly vault bullets',
  war_prize_in: 'War spoils',
};

const formatVaultTxDeltas = (tx) => {
  const parts = [];
  const c = Number(tx.cash_delta || 0);
  const b = Number(tx.bullets_delta || 0);
  const p = Number(tx.points_delta || 0);
  const l = Number(tx.loot_delta || 0);
  if (c !== 0) parts.push(c > 0 ? `+$${Math.abs(c).toLocaleString()} cash` : `-$${Math.abs(c).toLocaleString()} cash`);
  if (b !== 0) parts.push(b > 0 ? `+${b.toLocaleString()} bullets` : `-${Math.abs(b).toLocaleString()} bullets`);
  if (p !== 0) parts.push(p > 0 ? `+${p.toLocaleString()} pts` : `-${Math.abs(p).toLocaleString()} pts`);
  if (l !== 0) parts.push(l > 0 ? `+${l.toLocaleString()} loot box pcs` : `-${Math.abs(l).toLocaleString()} loot box pcs`);
  return parts.length ? parts.join(' · ') : '—';
};

const vaultTxSubtitle = (tx) => {
  const bits = [];
  const actor = (tx.actor_username || '').trim();
  if (actor && actor !== '?' && actor !== 'System' && actor !== 'War spoils') bits.push(actor);
  if (tx.target_username) bits.push(`→ ${tx.target_username}`);
  const m = tx.meta || {};
  if (m.racket_id) bits.push(String(m.racket_id).replace(/_/g, ' '));
  if (tx.kind === 'gta_melt' && (m.melt_reward_hits_paid > 0 || m.melt_treasury_pct > 0)) {
    const hits = m.melt_reward_hits_paid != null ? `${m.melt_reward_hits_paid} melt reward hit${m.melt_reward_hits_paid === 1 ? '' : 's'}` : '';
    const pct = m.melt_treasury_pct != null ? `${m.melt_treasury_pct}% cut` : '';
    bits.push([hits, pct].filter(Boolean).join(', '));
  }
  if (m.attacker_family_name && tx.kind === 'racket_raid_lost') bits.push(`by ${m.attacker_family_name}`);
  if (m.target_family_name && tx.kind === 'racket_raid_won') bits.push(`from ${m.target_family_name}`);
  if ((m.loser_family_name || m.loser_family_id) && tx.kind === 'war_prize_in') bits.push(`from ${m.loser_family_name || m.loser_family_id}`);
  return bits.filter(Boolean).join(' · ') || null;
};

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

/** Live countdown for racket raid crew window (matches server sliding 3h window). */
const formatRaidCountdown = (isoUntil) => {
  if (!isoUntil) return null;
  try {
    const sec = Math.max(0, Math.floor((new Date(isoUntil) - Date.now()) / 1000));
    if (sec <= 0) return 'Ready';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
    if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
    return `${s}s`;
  } catch { return null; }
};

function RaidNextRaidCountdown({ nextRaidAt }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!nextRaidAt) return undefined;
    const id = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, [nextRaidAt]);
  const text = formatRaidCountdown(nextRaidAt);
  if (!nextRaidAt || !text) return null;
  if (text === 'Ready') {
    return (
      <span className="flex items-center gap-1 text-[9px] text-emerald-400/90 font-heading">
        <Clock size={10} className="shrink-0 opacity-80" />
        Ready — tap refresh
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-[9px] text-amber-400/90 font-heading">
      <Clock size={10} className="shrink-0 opacity-80" />
      Next hit in <span className="font-mono tabular-nums font-bold">{text}</span>
    </span>
  );
}

/** Compact nav hint under “Crew OC” tab label. */
function CrewOCNavCountdown({ isoUntil }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!isoUntil) return undefined;
    const end = new Date(isoUntil).getTime();
    if (!Number.isFinite(end) || end <= Date.now()) return undefined;
    const id = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, [isoUntil]);
  const text = formatRaidCountdown(isoUntil);
  const ready = !isoUntil || !text || text === 'Ready';
  return (
    <span className="flex items-center gap-0.5 max-w-[5.5rem] sm:max-w-none whitespace-nowrap">
      {!ready && <Clock size={9} className="shrink-0 text-amber-400/80" />}
      <span
        className={`text-[8px] leading-none font-heading font-bold uppercase tracking-tight ${
          ready ? 'text-emerald-400/95' : 'text-amber-400/95'
        }`}
      >
        {ready ? 'OC ready' : text}
      </span>
    </span>
  );
}

const isRacketReadyAt = (isoUntil) => {
  if (!isoUntil) return true;
  const t = new Date(isoUntil).getTime();
  if (!Number.isFinite(t)) return true;
  return t <= Date.now();
};

const formatUtcDateTime = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return String(iso);
  return d.toLocaleString();
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
  <div className={`relative overflow-hidden rounded-lg p-2 sm:p-3 fam-stat-card fam-scale-in ${highlight ? 'bg-emerald-500/10 border border-emerald-500/30' : `${styles.surface} border border-primary/20`}`} style={{ animationDelay: `${delay}s` }}>
    {highlight && <div className="absolute -top-4 -right-4 w-16 h-16 rounded-full bg-emerald-500/10 blur-xl" />}
    {!highlight && <div className="absolute -top-6 left-1/2 -translate-x-1/2 w-20 h-12 bg-primary/5 rounded-full blur-xl pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity" />}
    <div className="flex items-center gap-1.5 text-[9px] text-zinc-500 uppercase tracking-[0.15em] mb-1 font-heading">
      {icon}
      {label}
    </div>
    <div className={`text-base sm:text-lg font-heading font-bold ${highlight ? 'text-emerald-400' : accentColor || 'text-foreground'}`}>{value}</div>
  </div>
);

// ============================================================================
// TAB BUTTON — sleek underline tabs
// ============================================================================

const Tab = ({ active, onClick, children, icon, subline }) => (
  <button
    type="button"
    onClick={onClick}
    className={`flex items-center gap-1 px-2 sm:px-2.5 py-2 sm:py-2.5 min-h-[44px] sm:min-h-0 text-[10px] font-heading font-bold uppercase tracking-wider transition-all border-b-2 touch-manipulation shrink-0 snap-start ${
      subline ? 'whitespace-normal' : 'whitespace-nowrap'
    } ${
      active
        ? 'text-primary border-primary bg-primary/5'
        : 'text-zinc-500 border-transparent hover:text-zinc-300 hover:border-zinc-600'
    }`}
  >
    {subline ? (
      <span className="flex flex-col items-start gap-0.5 min-w-0 text-left">
        <span className="flex items-center gap-1 whitespace-nowrap">
          {icon}
          <span className="hidden sm:inline">{children}</span>
          <span className="sm:hidden">{children}</span>
        </span>
        {subline}
      </span>
    ) : (
      <>
        {icon}
        <span className="hidden sm:inline">{children}</span>
        <span className="sm:hidden">{children}</span>
      </>
    )}
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

const RacketCard = ({ racket, maxLevel, canUpgrade, canCollect = true, onCollect, onUpgrade, onUnlock, showDebugReadout = false }) => {
  const timeLeft = formatTimeLeft(racket.next_collect_at);
  const isReady = racket.level > 0 && isRacketReadyAt(racket.next_collect_at);
  const onCooldown = racket.level > 0 && !isReady;
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

      <div className="p-2.5 sm:p-3">
        {/* Header row */}
        <div className="flex items-center justify-between mb-1.5">
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
        <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden mb-1.5">
          <div
            className={`h-full rounded-full transition-all duration-700 ${locked ? 'bg-zinc-600' : isMax ? 'bg-gradient-to-r from-primary via-amber-400 to-primary' : 'bg-gradient-to-r from-primary to-yellow-700'}`}
            style={{ width: `${pct}%`, minWidth: racket.level > 0 ? 4 : 0 }}
          />
        </div>

        {/* Status line */}
        <div className="flex items-center justify-between mb-1.5">
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
              type="button"
              onClick={() => isReady && canCollect && onCollect(racket.id)}
              disabled={onCooldown || !canCollect}
              className={`flex-1 px-3 py-2 sm:py-1.5 min-h-[44px] sm:min-h-0 rounded-md text-[10px] font-heading font-bold uppercase tracking-wider border transition-all touch-manipulation ${
                isReady && canCollect
                  ? 'bg-gradient-to-b from-emerald-600/30 to-emerald-800/20 border-emerald-500/40 text-emerald-400 hover:from-emerald-600/50 hover:shadow-md hover:shadow-emerald-900/30'
                  : 'bg-zinc-800/50 border-zinc-700/30 text-zinc-500 cursor-not-allowed'
              } disabled:opacity-40`}
            >
              {onCooldown ? `${timeLeft || 'Cooldown'}` : !canCollect ? 'Locked' : 'Collect'}
            </button>
          )}
          {canUpgrade && locked && racket.can_unlock && (
            <button
              type="button"
              onClick={() => onUnlock(racket.id)}
              className="flex items-center gap-1 px-3 py-2 sm:py-1.5 min-h-[44px] sm:min-h-0 rounded-md text-[10px] font-heading font-bold uppercase border bg-primary/20 border-primary/40 text-primary hover:bg-primary/30 hover:shadow-md hover:shadow-primary/10 transition-all touch-manipulation"
            >
              <Unlock size={10} /> Unlock
            </button>
          )}
          {canUpgrade && !locked && racket.level < maxLevel && (
            <button
              type="button"
              onClick={() => onUpgrade(racket.id)}
              className="px-2.5 py-2 sm:py-1.5 min-h-[44px] sm:min-h-0 rounded-md text-[10px] font-heading font-bold border bg-zinc-800/60 border-zinc-600/40 text-zinc-300 hover:border-primary/40 hover:text-primary hover:bg-primary/5 transition-all touch-manipulation"
            >
              <ArrowUpCircle size={12} />
            </button>
          )}
        </div>
        {showDebugReadout && (
          <div className="mt-1.5 pt-1.5 border-t border-zinc-700/30 text-[9px] font-mono text-zinc-500 space-y-0.5">
            <div>last_collected_at: {formatUtcDateTime(racket.debug_last_collected_at)}</div>
            <div>next_collect_at: {formatUtcDateTime(racket.debug_next_collect_at || racket.next_collect_at)}</div>
          </div>
        )}
      </div>
    </div>
  );
};

// ============================================================================
// TREASURY TAB — vault with quick amounts
// ============================================================================

const TreasuryTab = ({
  treasury, treasuryBullets, treasuryPoints, treasuryLootPieces, canWithdraw, vaultAndRacketsLocked,
  meltTreasuryPct, meltRewardTiers, members,
  depositAmount, setDepositAmount, depositBullets, setDepositBullets,
  withdrawAmount, setWithdrawAmount, withdrawBullets, setWithdrawBullets, onDeposit, onWithdraw,
  giveBulletsUserId, setGiveBulletsUserId, giveBulletsAmount, setGiveBulletsAmount, onGiveBullets, onSplitAllBullets, splitAllBulletsLoading,
  giveLootUserId, setGiveLootUserId, giveLootAmount, setGiveLootAmount, onGiveLoot, onSplitAllLoot, splitAllLootLoading,
  compoundCash, compoundPoints, compoundLootPieces, myCompoundCash, myCompoundPoints, myCompoundLootPieces, myCompoundCars,
  compoundDepositCash, setCompoundDepositCash, compoundDepositPoints, setCompoundDepositPoints, compoundDepositLootPieces, setCompoundDepositLootPieces,
  compoundWithdrawCash, setCompoundWithdrawCash, compoundWithdrawPoints, setCompoundWithdrawPoints, compoundWithdrawLootPieces, setCompoundWithdrawLootPieces,
  onCompoundDeposit, onCompoundWithdraw,
  returningMembersWithBalance, onCompoundReturnToMember, onCompoundClaimForFamily,
  vaultTransactions, vaultTxTotal,
}) => (
  <div className="space-y-3">
    {vaultAndRacketsLocked && (
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[10px] text-amber-200/90 font-heading">
        Vault and rackets are locked until the family war is over.
      </div>
    )}
    {/* Vault display */}
    <div className={`relative ${styles.surface} rounded-lg overflow-hidden p-4 sm:p-6 text-center border border-primary/25`}>
      <div className="absolute inset-0 fam-vault-bg pointer-events-none" />
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
      <DollarSign size={24} className="mx-auto text-primary/40 mb-2" />
      <p className="text-[9px] text-zinc-500 uppercase tracking-[0.3em] font-heading mb-2">The Family Vault</p>
      <p className="text-3xl sm:text-4xl font-heading font-bold text-primary relative fam-shimmer-text">
        <AnimatedCounter target={Number(treasury ?? 0)} prefix="$" />
      </p>
      <p className="text-[9px] text-zinc-600 font-heading mt-2 italic">Every dollar earned in blood and sweat</p>
      {((treasuryPoints ?? 0) > 0 || (treasuryLootPieces ?? 0) > 0) && (
        <p className="text-[10px] font-heading text-zinc-500 mt-2">
          {(treasuryPoints ?? 0) > 0 && <span>{(treasuryPoints ?? 0).toLocaleString()} pts</span>}
          {(treasuryPoints ?? 0) > 0 && (treasuryLootPieces ?? 0) > 0 && ' · '}
          {(treasuryLootPieces ?? 0) > 0 && <span title="Loot box pieces (100 = 1 Loot Box open)">{(treasuryLootPieces ?? 0).toLocaleString()} loot box pieces</span>}
        </p>
      )}
      <p className="text-[10px] font-heading text-amber-300 mt-2">
        Bullet treasury: {(Number(treasuryBullets || 0)).toLocaleString()} bullets
      </p>
      <p className="text-[9px] text-zinc-500 font-heading mt-1">
        Family melt cut: {Number(meltTreasuryPct || 0)}%
      </p>
    </div>

    <div className="bg-zinc-800/30 rounded-lg border border-zinc-700/30 p-2.5 sm:p-3 fam-fade-in" style={{ animationDelay: '0.05s' }}>
      <p className="text-[10px] text-zinc-500 font-heading uppercase tracking-[0.15em] mb-2 flex items-center gap-1.5">
        <Clock size={10} /> Recent vault activity
      </p>
      {(!vaultTransactions || vaultTransactions.length === 0) ? (
        <p className="text-[10px] text-zinc-600">No transactions yet — deposits, melts, rackets, and raids show up here.</p>
      ) : (
        <ul className="space-y-2 max-h-64 overflow-y-auto pr-1 text-left">
          {vaultTransactions.map((tx) => {
            const sub = vaultTxSubtitle(tx);
            const when = tx.at ? new Date(tx.at).toLocaleString() : '';
            return (
              <li key={tx.id} className="text-[10px] border-b border-zinc-700/30 pb-2 last:border-0 last:pb-0">
                <div className="flex justify-between gap-2 items-start">
                  <span className="font-heading font-bold text-zinc-200">{VAULT_TX_KIND_LABELS[tx.kind] || tx.kind}</span>
                  <span className="text-zinc-500 shrink-0 font-mono text-[9px]">{when}</span>
                </div>
                <div className="text-primary/90 font-heading mt-0.5">{formatVaultTxDeltas(tx)}</div>
                {sub && <div className="text-zinc-500 mt-0.5 leading-snug">{sub}</div>}
              </li>
            );
          })}
        </ul>
      )}
      {vaultTxTotal > (vaultTransactions?.length || 0) && (
        <p className="text-[9px] text-zinc-600 mt-2">Showing {vaultTransactions.length} of {vaultTxTotal} entries.</p>
      )}
    </div>

    {/* Deposit */}
    <div className={`bg-zinc-800/30 rounded-lg border border-zinc-700/30 p-2.5 sm:p-3 fam-fade-in ${vaultAndRacketsLocked ? 'opacity-60 pointer-events-none' : ''}`} style={{ animationDelay: '0.1s' }}>
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
        <FormattedNumberInput
          value={depositAmount}
          onChange={setDepositAmount}
          placeholder="Cash amount"
          className="flex-1 bg-zinc-900/80 border border-zinc-600/40 rounded-lg px-3 py-2 text-xs text-foreground font-heading focus:border-primary/50 focus:outline-none min-w-0 transition-colors"
        />
        <FormattedNumberInput
          value={depositBullets}
          onChange={setDepositBullets}
          placeholder="Bullets"
          className="w-28 bg-zinc-900/80 border border-zinc-600/40 rounded-lg px-3 py-2 text-xs text-foreground font-heading focus:border-primary/50 focus:outline-none transition-colors"
        />
        <button type="submit" className="px-4 py-2 min-h-[44px] sm:min-h-0 rounded-lg text-[10px] font-heading font-bold uppercase tracking-wider border bg-primary/20 border-primary/50 text-primary hover:bg-primary/30 hover:shadow-md hover:shadow-primary/10 transition-all shrink-0 touch-manipulation">
          Deposit
        </button>
      </form>
    </div>

    {/* Withdraw */}
    {canWithdraw && !vaultAndRacketsLocked && (
      <div className="bg-zinc-800/30 rounded-lg border border-zinc-700/30 p-2.5 sm:p-3 fam-fade-in" style={{ animationDelay: '0.15s' }}>
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
          <FormattedNumberInput
            value={withdrawAmount}
            onChange={setWithdrawAmount}
            placeholder="Cash amount"
            className="flex-1 bg-zinc-900/80 border border-zinc-600/40 rounded-lg px-3 py-2 text-xs text-foreground font-heading focus:border-primary/50 focus:outline-none min-w-0 transition-colors"
          />
          <FormattedNumberInput
            value={withdrawBullets}
            onChange={setWithdrawBullets}
            placeholder="Bullets"
            className="w-28 bg-zinc-900/80 border border-zinc-600/40 rounded-lg px-3 py-2 text-xs text-foreground font-heading focus:border-primary/50 focus:outline-none transition-colors"
          />
          <button type="submit" className="px-4 py-2 min-h-[44px] sm:min-h-0 rounded-lg text-[10px] font-heading font-bold uppercase tracking-wider border bg-zinc-700/50 border-zinc-600/50 text-zinc-300 hover:bg-zinc-700/70 transition-all shrink-0 touch-manipulation">
            Withdraw
          </button>
        </form>

        <form onSubmit={onGiveBullets} className="flex flex-wrap gap-2 mt-2">
          <select
            value={giveBulletsUserId}
            onChange={(e) => setGiveBulletsUserId(e.target.value)}
            className="flex-1 min-w-[140px] bg-zinc-900/80 border border-zinc-600/40 rounded-lg px-2 py-2 text-xs font-heading focus:border-primary/50 focus:outline-none"
          >
            <option value="">Give bullets to member...</option>
            {(members || []).map((m) => (
              <option key={m.user_id} value={m.user_id}>{m.username}</option>
            ))}
          </select>
          <FormattedNumberInput
            value={giveBulletsAmount}
            onChange={setGiveBulletsAmount}
            placeholder="Bullets"
            className="w-28 bg-zinc-900/80 border border-zinc-600/40 rounded-lg px-3 py-2 text-xs text-foreground font-heading focus:border-primary/50 focus:outline-none transition-colors"
          />
          <button type="submit" className="px-3 py-2 rounded-lg text-[10px] font-heading font-bold uppercase tracking-wider border bg-amber-500/20 border-amber-500/40 text-amber-300 hover:bg-amber-500/30 transition-all shrink-0 touch-manipulation">
            Give
          </button>
          <button
            type="button"
            onClick={onSplitAllBullets}
            disabled={splitAllBulletsLoading}
            className="px-3 py-2 rounded-lg text-[10px] font-heading font-bold uppercase tracking-wider border bg-primary/20 border-primary/50 text-primary hover:bg-primary/30 transition-all shrink-0 touch-manipulation disabled:opacity-50"
            title="Split all vault bullets across living members (requires at least one bullet per member)"
          >
            {splitAllBulletsLoading ? '...' : 'Split all bullets'}
          </button>
        </form>

        <form onSubmit={onGiveLoot} className="flex flex-wrap gap-2 mt-2">
          <select
            value={giveLootUserId}
            onChange={(e) => setGiveLootUserId(e.target.value)}
            className="flex-1 min-w-[140px] bg-zinc-900/80 border border-zinc-600/40 rounded-lg px-2 py-2 text-xs font-heading focus:border-primary/50 focus:outline-none"
          >
            <option value="">Give loot box pieces to member...</option>
            {(members || []).map((m) => (
              <option key={m.user_id} value={m.user_id}>{m.username}</option>
            ))}
          </select>
          <FormattedNumberInput
            value={giveLootAmount}
            onChange={setGiveLootAmount}
            placeholder="Loot box pieces"
            className="w-28 bg-zinc-900/80 border border-zinc-600/40 rounded-lg px-3 py-2 text-xs text-foreground font-heading focus:border-primary/50 focus:outline-none transition-colors"
          />
          <button type="submit" className="px-3 py-2 rounded-lg text-[10px] font-heading font-bold uppercase tracking-wider border bg-cyan-500/15 border-cyan-500/35 text-cyan-300 hover:bg-cyan-500/25 transition-all shrink-0 touch-manipulation">
            Give
          </button>
          <button
            type="button"
            onClick={onSplitAllLoot}
            disabled={splitAllLootLoading}
            className="px-3 py-2 rounded-lg text-[10px] font-heading font-bold uppercase tracking-wider border bg-cyan-500/10 border-cyan-500/30 text-cyan-200/90 hover:bg-cyan-500/20 transition-all shrink-0 touch-manipulation disabled:opacity-50"
            title="Split all vault loot box pieces across living members (requires at least one piece per member)"
          >
            {splitAllLootLoading ? '...' : 'Split loot box pieces'}
          </button>
        </form>
      </div>
    )}

    {/* Compound */}
    <div className={`border-t border-zinc-700/40 pt-4 mt-4 ${vaultAndRacketsLocked ? 'opacity-60 pointer-events-none' : ''}`}>
      <p className="text-[10px] text-zinc-500 font-heading uppercase tracking-[0.15em] mb-2 flex items-center gap-1.5">
        <Shield size={10} /> Family Compound
      </p>
      <p className="text-[10px] text-zinc-600 mb-2">Shared stash. On war loss, the enemy takes it. Your share can be returned if you rejoin after a solo death.</p>
      <div className="grid grid-cols-3 gap-2 mb-2 text-center">
        <div className="bg-zinc-800/50 rounded border border-zinc-700/40 px-2 py-1.5">
          <span className="text-[9px] text-zinc-500 block">Cash</span>
          <span className="text-sm font-heading font-bold text-primary">{formatMoney(compoundCash ?? 0)}</span>
        </div>
        <div className="bg-zinc-800/50 rounded border border-zinc-700/40 px-2 py-1.5">
          <span className="text-[9px] text-zinc-500 block">Points</span>
          <span className="text-sm font-heading font-bold">{(compoundPoints ?? 0).toLocaleString()}</span>
        </div>
        <div className="bg-zinc-800/50 rounded border border-zinc-700/40 px-2 py-1.5">
          <span className="text-[9px] text-zinc-500 block" title="Loot box pieces — 100 opens one Loot Box">Loot box pieces</span>
          <span className="text-sm font-heading font-bold">{(compoundLootPieces ?? 0).toLocaleString()}</span>
        </div>
      </div>
      <p className="text-[9px] text-zinc-500 mb-2">Your share: {formatMoney(myCompoundCash ?? 0)} · {(myCompoundPoints ?? 0).toLocaleString()} pts · {(myCompoundLootPieces ?? 0).toLocaleString()} loot box pcs{(myCompoundCars ? ` · ${myCompoundCars} car(s)` : '')}</p>

      <form onSubmit={onCompoundDeposit} className="flex flex-wrap gap-2 mb-2">
        <input type="number" min="0" placeholder="Cash" value={compoundDepositCash} onChange={(e) => setCompoundDepositCash(e.target.value)} className="w-24 px-2 py-1 bg-zinc-900/80 border border-zinc-600/40 rounded text-xs font-heading" />
        <input type="number" min="0" placeholder="Points" value={compoundDepositPoints} onChange={(e) => setCompoundDepositPoints(e.target.value)} className="w-20 px-2 py-1 bg-zinc-900/80 border border-zinc-600/40 rounded text-xs font-heading" />
        <input type="number" min="0" placeholder="Box pcs" title="Loot box pieces" value={compoundDepositLootPieces} onChange={(e) => setCompoundDepositLootPieces(e.target.value)} className="w-20 px-2 py-1 bg-zinc-900/80 border border-zinc-600/40 rounded text-xs font-heading" />
        <button type="submit" className="px-3 py-1 rounded text-[10px] font-heading font-bold uppercase border bg-primary/20 border-primary/50 text-primary hover:bg-primary/30">Deposit to compound</button>
      </form>

      {canWithdraw && (
        <form onSubmit={onCompoundWithdraw} className="flex flex-wrap gap-2 mb-3">
          <input type="number" min="0" placeholder="Cash" value={compoundWithdrawCash} onChange={(e) => setCompoundWithdrawCash(e.target.value)} className="w-24 px-2 py-1 bg-zinc-900/80 border border-zinc-600/40 rounded text-xs font-heading" />
          <input type="number" min="0" placeholder="Points" value={compoundWithdrawPoints} onChange={(e) => setCompoundWithdrawPoints(e.target.value)} className="w-20 px-2 py-1 bg-zinc-900/80 border border-zinc-600/40 rounded text-xs font-heading" />
          <input type="number" min="0" placeholder="Box pcs" title="Loot box pieces" value={compoundWithdrawLootPieces} onChange={(e) => setCompoundWithdrawLootPieces(e.target.value)} className="w-20 px-2 py-1 bg-zinc-900/80 border border-zinc-600/40 rounded text-xs font-heading" />
          <button type="submit" className="px-3 py-1 rounded text-[10px] font-heading font-bold uppercase border bg-zinc-700/50 border-zinc-600/50 text-zinc-300 hover:bg-zinc-700/70">Withdraw from compound</button>
        </form>
      )}

      {returningMembersWithBalance && returningMembersWithBalance.length > 0 && (
        <div className="mt-3 pt-3 border-t border-zinc-700/40">
          <p className="text-[9px] text-zinc-500 font-heading uppercase tracking-wider mb-2">Returning members (your share)</p>
          <div className="space-y-1.5">
            {returningMembersWithBalance.map((m) => (
              <div key={m.user_id} className="flex flex-wrap items-center justify-between gap-2 bg-zinc-800/40 rounded px-2 py-1.5 border border-zinc-700/30">
                <span className="text-xs font-heading text-foreground">{m.username}</span>
                <span className="text-[10px] text-zinc-500">{formatMoney(m.compound_cash)} · {m.compound_points} pts · {m.compound_loot_pieces} loot box pcs</span>
                <div className="flex gap-1">
                  <button type="button" onClick={() => onCompoundReturnToMember(m.user_id)} className="px-2 py-0.5 rounded text-[9px] font-heading font-bold uppercase border border-emerald-600/50 text-emerald-400 hover:bg-emerald-500/10">Return</button>
                  <button type="button" onClick={() => onCompoundClaimForFamily(m.user_id)} className="px-2 py-0.5 rounded text-[9px] font-heading font-bold uppercase border border-amber-600/50 text-amber-400 hover:bg-amber-500/10">Keep for family</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>

    <div className="bg-zinc-800/30 rounded-lg border border-zinc-700/30 p-2.5 sm:p-3">
      <p className="text-[10px] text-zinc-500 font-heading uppercase tracking-[0.15em] mb-2">Melt rewards (configured)</p>
      {(meltRewardTiers && meltRewardTiers.length > 0) ? (
        <div className="space-y-1.5">
          {meltRewardTiers.map((t) => (
            <div key={t.threshold_bullets} className="flex items-center justify-between px-2 py-1 rounded bg-zinc-900/40 border border-zinc-700/30">
              <span className="text-[10px] text-zinc-300">{Number(t.threshold_bullets || 0).toLocaleString()} bullets</span>
              <span className="text-[10px] text-emerald-400">{formatMoneyFull(t.reward_money || 0)}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[10px] text-zinc-500">No reward tiers set.</p>
      )}
    </div>

    <div className="bg-zinc-800/30 rounded-lg border border-zinc-700/30 p-2.5 sm:p-3">
      <p className="text-[10px] text-zinc-500 font-heading uppercase tracking-[0.15em] mb-2">Member melt + reward stats</p>
      {(members && members.length > 0) ? (
        <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
          {[...members]
            .sort((a, b) => Number(b.family_bullets_melted || 0) - Number(a.family_bullets_melted || 0))
            .map((m) => (
              <div key={m.user_id} className="grid grid-cols-[1fr_auto_auto] items-center gap-2 px-2 py-1 rounded bg-zinc-900/40 border border-zinc-700/30">
                <span className="text-[10px] text-foreground truncate">{m.username}</span>
                <span className="text-[10px] text-amber-300">{Number(m.family_bullets_melted || 0).toLocaleString()} family bullets</span>
                <span className="text-[10px] text-emerald-400">{formatMoneyFull(m.family_melt_reward_money_earned || 0)} ({Number(m.family_melt_reward_hits || 0)}x)</span>
              </div>
            ))}
        </div>
      ) : (
        <p className="text-[10px] text-zinc-500">No member data.</p>
      )}
    </div>
  </div>
);

// ============================================================================
// RACKETS TAB
// ============================================================================

const RacketsTab = ({ rackets, config, canUpgrade, vaultAndRacketsLocked, onCollect, onCollectAll, collectAllLoading, readyCount, onUpgrade, onUnlock, event, eventsEnabled }) => {
  const maxLevel = config?.racket_max_level ?? 5;
  const showDebugReadout = (rackets || []).some((r) => r.debug_last_collected_at || r.debug_next_collect_at);

  const effectiveCanUpgrade = canUpgrade && !vaultAndRacketsLocked;
  const effectiveCanCollect = !vaultAndRacketsLocked;
  return (
    <div className="space-y-2">
      {vaultAndRacketsLocked && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[10px] text-amber-200/90 font-heading">
          Vault and rackets are locked until the family war is over.
        </div>
      )}
      {/* Event Banner + Collect all */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {eventsEnabled && event && (event.racket_payout !== 1 || event.racket_cooldown !== 1) && event.name && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-[10px] border border-primary/30 bg-primary/5">
            <span className="text-primary font-heading font-bold">✨ {event.name}</span>
            <span className="text-zinc-400">{event.message}</span>
          </div>
        )}
        {readyCount > 0 && effectiveCanCollect && (
          <button
            type="button"
            onClick={onCollectAll}
            disabled={collectAllLoading}
            className="text-[9px] font-heading font-bold uppercase tracking-wider text-primary border border-primary/40 hover:bg-primary/10 rounded px-2 py-1 disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation flex items-center gap-1.5 shrink-0"
          >
            <DollarSign size={12} />
            {collectAllLoading ? '...' : `Collect all (${readyCount})`}
          </button>
        )}
      </div>

      {/* Racket Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {rackets.map((r) => (
          <RacketCard key={r.id} racket={r} maxLevel={maxLevel} canUpgrade={effectiveCanUpgrade} canCollect={effectiveCanCollect} onCollect={onCollect} onUpgrade={onUpgrade} onUnlock={onUnlock} showDebugReadout={showDebugReadout} />
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
  <div className="space-y-2">
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
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-80 overflow-y-auto pr-1">
        {targets.map((t, idx) => {
          const raidsLeft = t.raids_remaining ?? 2;
          const canRaid = raidsLeft > 0;
          return (
            <div key={t.family_id} className={`rounded-lg overflow-hidden fam-target-card fam-fade-in ${canRaid ? 'bg-red-500/5 border fam-blood-pulse' : 'bg-zinc-800/30 border border-zinc-800/30 opacity-40'}`} style={{ animationDelay: `${idx * 0.05}s` }}>
              <div className="px-2.5 sm:px-3 py-2 flex items-center justify-between border-b border-zinc-700/30 bg-zinc-900/30">
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
              {!canRaid && t.next_raid_at && (
                <div className="px-2.5 sm:px-3 py-1 border-b border-zinc-700/20 bg-zinc-950/40">
                  <RaidNextRaidCountdown nextRaidAt={t.next_raid_at} />
                </div>
              )}
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
                          type="button"
                          onClick={() => onRaid(t.family_id, r.racket_id)} 
                          disabled={isLoading || !canRaid}
                          className={`px-2.5 py-1.5 min-h-[36px] sm:min-h-0 rounded-md text-[9px] font-bold uppercase tracking-wider transition-all touch-manipulation ${
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

const RosterTab = ({
  members, fallen, canManage, myRole, config, onKick, onAssignRole, joinApplications, joinMode, joinAutoAccept, joinAutoAcceptRankMin,
  onAcceptJoinApplication, onDenyJoinApplication, onJoinSettingsUpdate, meltTreasuryPct, meltRewardTiers, onMeltSettingsUpdate,
  airportCrewPerk, onAirportCrewPerkUpdate,
}) => {
  const [assignUserId, setAssignUserId] = useState('');
  const [assignRole, setAssignRole] = useState('associate');
  const [joinModeSetting, setJoinModeSetting] = useState(joinMode ?? 'open');
  const [joinAutoAcceptSetting, setJoinAutoAcceptSetting] = useState(joinAutoAccept ?? 'none');
  const [joinRankMinSetting, setJoinRankMinSetting] = useState(joinAutoAcceptRankMin ?? '');
  const [meltPctInput, setMeltPctInput] = useState(String(meltTreasuryPct ?? 0));
  const [tierThresholdInput, setTierThresholdInput] = useState('');
  const [tierRewardInput, setTierRewardInput] = useState('');

  useEffect(() => {
    setJoinModeSetting(joinMode ?? 'open');
    setJoinAutoAcceptSetting(joinAutoAccept ?? 'none');
    setJoinRankMinSetting(joinAutoAcceptRankMin ?? '');
  }, [joinMode, joinAutoAccept, joinAutoAcceptRankMin]);

  useEffect(() => {
    setMeltPctInput(String(meltTreasuryPct ?? 0));
  }, [meltTreasuryPct]);

  const handleAssign = (e) => {
    e.preventDefault();
    if (assignUserId && assignRole) {
      onAssignRole(assignUserId, assignRole);
      setAssignUserId('');
      setAssignRole('associate');
    }
  };

  const isDon = (myRole || '').toLowerCase() === 'boss';
  const assignableRoleKeys = useMemo(
    () => (isDon ? (config?.roles || []) : ['capo', 'soldier', 'associate']),
    [isDon, config?.roles],
  );
  const assignableMembers = useMemo(() => members.filter((m) => {
    if (m.role === 'boss') return false;
    if (!isDon && ['underboss', 'consigliere'].includes(m.role)) return false;
    return true;
  }), [members, isDon]);

  useEffect(() => {
    setAssignRole((r) => (assignableRoleKeys.includes(r) ? r : (assignableRoleKeys[0] || 'associate')));
  }, [assignableRoleKeys]);

  const sorted = [...members].sort((a, b) => (getRoleConfig(a.role).rank ?? 5) - (getRoleConfig(b.role).rank ?? 5));

  return (
    <div className="space-y-2">
      {/* Hierarchy */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 sm:gap-2 max-h-80 overflow-y-auto pr-1">
        {sorted.map((m, idx) => {
          const cfg = getRoleConfig(m.role);
          const isBoss = m.role === 'boss';
          const isHighRank = ['boss', 'underboss', 'consigliere'].includes(m.role);
          return (
            <div key={m.user_id} className={`relative flex items-center justify-between px-2.5 sm:px-3 py-2 rounded-lg fam-member-row fam-fade-in overflow-hidden ${
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
                <p className="text-[9px] text-zinc-500 mt-0.5">
                  Melted for family: {(Number(m.family_bullets_melted || 0)).toLocaleString()} bullets
                </p>
                <p className="text-[9px] text-emerald-400/90 mt-0.5">
                  Rewards: {formatMoneyFull(m.family_melt_reward_money_earned || 0)} ({Number(m.family_melt_reward_hits || 0)}x)
                </p>
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
      
      {/* Assign Rank — Don: full roster; Underboss: capo / soldier / associate only */}
      {canManage && (
        <div className="pt-3 border-t border-zinc-700/30">
          <p className="text-[9px] text-zinc-500 font-heading uppercase tracking-[0.2em] mb-1">Assign Rank</p>
          {!isDon && (
            <p className="text-[8px] text-zinc-600 font-heading mb-2 leading-relaxed">
              As Underboss you can set Capo, Soldier, and Associate. Don, Underboss, and Consigliere are set by the Don only.
            </p>
          )}
          <form onSubmit={handleAssign} className="flex flex-wrap gap-2">
            <select value={assignRole} onChange={(e) => setAssignRole(e.target.value)}
              className="bg-zinc-900/80 border border-zinc-600/40 rounded-lg px-2 py-1.5 text-[10px] text-foreground font-heading focus:border-primary/50 focus:outline-none">
              {assignableRoleKeys.map((role) => (
                <option key={role} value={role}>
                  {role === 'boss' ? 'Don (transfer family)' : getRoleConfig(role).label}
                </option>
              ))}
            </select>
            <select value={assignUserId} onChange={(e) => setAssignUserId(e.target.value)}
              className="flex-1 bg-zinc-900/80 border border-zinc-600/40 rounded-lg px-2 py-1.5 text-[10px] text-foreground font-heading focus:border-primary/50 focus:outline-none min-w-[80px]">
              <option value="">Member...</option>
              {assignableMembers.map((m) => <option key={m.user_id} value={m.user_id}>{m.username}</option>)}
            </select>
            <button type="submit" className="px-3 py-1.5 rounded-lg text-[10px] font-heading font-bold uppercase tracking-wider bg-primary/20 text-primary border border-primary/40 hover:bg-primary/30 transition-all">
              Assign
            </button>
          </form>
        </div>
      )}

      {/* ── Join applications (Don/Underboss) ── */}
      {joinApplications?.length > 0 && (myRole === 'boss' || myRole === 'underboss') && (
        <div className="pt-3 border-t border-zinc-700/30">
          <p className="text-[9px] text-zinc-500 font-heading uppercase tracking-[0.2em] mb-2">Join applications</p>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {joinApplications.map((app) => (
              <div key={app.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-zinc-800/40 border border-zinc-700/40">
                <div className="min-w-0">
                  <Link to={`/profile/${encodeURIComponent(app.username)}`} className="font-heading font-bold text-xs text-foreground hover:text-primary block truncate">
                    {app.username}
                  </Link>
                  <span className="text-[9px] text-zinc-500 font-heading">{app.rank_name ?? '—'}</span>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button type="button" onClick={() => onAcceptJoinApplication(app.id)} className="px-2 py-1 rounded text-[10px] font-heading font-bold uppercase bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 hover:bg-emerald-500/30">
                    Accept
                  </button>
                  <button type="button" onClick={() => onDenyJoinApplication(app.id)} className="px-2 py-1 rounded text-[10px] font-heading font-bold uppercase bg-red-500/20 text-red-400 border border-red-500/40 hover:bg-red-500/30">
                    Deny
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Join settings (Don only) ── */}
      {myRole === 'boss' && onJoinSettingsUpdate && (
        <div className="pt-3 border-t border-zinc-700/30">
          <p className="text-[9px] text-zinc-500 font-heading uppercase tracking-[0.2em] mb-2">Who can join</p>
          <div className="flex flex-wrap gap-2 items-end">
            <div>
              <label className="block text-[9px] text-zinc-500 font-heading mb-0.5">Join</label>
              <select
                value={joinModeSetting}
                onChange={(e) => { const v = e.target.value; setJoinModeSetting(v); onJoinSettingsUpdate({ join_mode: v }); }}
                className="bg-zinc-900/80 border border-zinc-600/40 rounded-lg px-2 py-1.5 text-[10px] font-heading focus:border-primary/50 focus:outline-none"
              >
                <option value="open">Open (anyone can join)</option>
                <option value="approval">Approval (apply to join)</option>
              </select>
            </div>
            {joinModeSetting === 'approval' && (
              <>
                <div>
                  <label className="block text-[9px] text-zinc-500 font-heading mb-0.5">Auto-accept</label>
                  <select
                    value={joinAutoAcceptSetting}
                    onChange={(e) => {
                      const v = e.target.value;
                      setJoinAutoAcceptSetting(v);
                      onJoinSettingsUpdate({ join_auto_accept: v, join_auto_accept_rank_min: v === 'rank_min' ? (parseInt(joinRankMinSetting, 10) || undefined) : undefined });
                    }}
                    className="bg-zinc-900/80 border border-zinc-600/40 rounded-lg px-2 py-1.5 text-[10px] font-heading focus:border-primary/50 focus:outline-none"
                  >
                    <option value="none">Manual only</option>
                    <option value="all">Auto accept all</option>
                    <option value="rank_min">Auto accept rank above</option>
                  </select>
                </div>
                {joinAutoAcceptSetting === 'rank_min' && (
                  <div>
                    <label className="block text-[9px] text-zinc-500 font-heading mb-0.5">Rank</label>
                    <select
                      value={joinRankMinSetting}
                      onChange={(e) => { const v = e.target.value; setJoinRankMinSetting(v); onJoinSettingsUpdate({ join_auto_accept_rank_min: parseInt(v, 10) || undefined }); }}
                      className="bg-zinc-900/80 border border-zinc-600/40 rounded-lg px-2 py-1.5 text-[10px] font-heading focus:border-primary/50 focus:outline-none"
                    >
                      {(config?.ranks || []).map((r) => (
                        <option key={r.id} value={r.id}>{r.name}</option>
                      ))}
                    </select>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Airport crew perk (Don only): −1s travel OR 10% points — mutually exclusive ── */}
      {myRole === 'boss' && onAirportCrewPerkUpdate && (
        <div className="pt-3 border-t border-zinc-700/30 space-y-2">
          <p className="text-[9px] text-zinc-500 font-heading uppercase tracking-[0.2em]">Airport crew perk</p>
          <p className="text-[10px] text-zinc-400">
            When the Don, Underboss, or Consigliere owns an airport, pick one family-wide bonus. You cannot have both.
          </p>
          <div className="flex flex-wrap gap-2 items-center">
            <label className="text-[9px] text-zinc-500 font-heading">Perk</label>
            <select
              value={airportCrewPerk ?? 'none'}
              onChange={(e) => onAirportCrewPerkUpdate(e.target.value)}
              className="bg-zinc-900/80 border border-zinc-600/40 rounded-lg px-2 py-1.5 text-[10px] font-heading focus:border-primary/50 focus:outline-none min-w-[200px]"
            >
              <option value="none">None</option>
              <option value="travel_time">−1s airport travel time (all members)</option>
              <option value="points_discount">10% off airport points cost (all members)</option>
            </select>
          </div>
        </div>
      )}

      {/* ── Melt settings (Don/Underboss/Consigliere) ── */}
      {['boss', 'underboss', 'consigliere'].includes(myRole) && onMeltSettingsUpdate && (
        <div className="pt-3 border-t border-zinc-700/30 space-y-2">
          <p className="text-[9px] text-zinc-500 font-heading uppercase tracking-[0.2em]">Garage melt treasury settings</p>
          <div className="flex flex-wrap gap-2 items-end">
            <div>
              <label className="block text-[9px] text-zinc-500 font-heading mb-0.5">Family cut % (max 50)</label>
              <input
                value={meltPctInput}
                onChange={(e) => setMeltPctInput(e.target.value.replace(/[^\d]/g, ''))}
                className="bg-zinc-900/80 border border-zinc-600/40 rounded-lg px-2 py-1.5 text-[10px] font-heading focus:border-primary/50 focus:outline-none w-24"
                placeholder="0-50"
              />
            </div>
            <button
              type="button"
              onClick={() => onMeltSettingsUpdate({ melt_treasury_pct: Math.max(0, Math.min(50, parseInt(meltPctInput || '0', 10) || 0)) })}
              className="px-3 py-1.5 rounded-lg text-[10px] font-heading font-bold uppercase tracking-wider bg-primary/20 text-primary border border-primary/40 hover:bg-primary/30 transition-all"
            >
              Save %
            </button>
          </div>

          <div className="space-y-1.5">
            <label className="block text-[9px] text-zinc-500 font-heading">Reward tiers (stack on melt)</label>
            {(meltRewardTiers || []).length > 0 ? (
              <div className="space-y-1">
                {(meltRewardTiers || []).map((t) => (
                  <div key={t.threshold_bullets} className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-zinc-900/40 border border-zinc-700/40">
                    <span className="text-[10px] text-zinc-300">{Number(t.threshold_bullets || 0).toLocaleString()} bullets</span>
                    <span className="text-[10px] text-emerald-400">{formatMoneyFull(t.reward_money || 0)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[10px] text-zinc-500">No tiers configured.</p>
            )}
            <div className="flex flex-wrap gap-2 items-end">
              <div>
                <label className="block text-[9px] text-zinc-500 font-heading mb-0.5">Threshold bullets</label>
                <FormattedNumberInput
                  value={tierThresholdInput}
                  onChange={setTierThresholdInput}
                  className="bg-zinc-900/80 border border-zinc-600/40 rounded-lg px-2 py-1.5 text-[10px] font-heading focus:border-primary/50 focus:outline-none w-32"
                  placeholder="5,000"
                />
              </div>
              <div>
                <label className="block text-[9px] text-zinc-500 font-heading mb-0.5">Reward money</label>
                <FormattedNumberInput
                  value={tierRewardInput}
                  onChange={setTierRewardInput}
                  className="bg-zinc-900/80 border border-zinc-600/40 rounded-lg px-2 py-1.5 text-[10px] font-heading focus:border-primary/50 focus:outline-none w-32"
                  placeholder="5,000,000"
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  const threshold = parseInt(tierThresholdInput || '0', 10) || 0;
                  const reward = parseInt(tierRewardInput || '0', 10) || 0;
                  if (threshold < 1000 || reward < 1) return;
                  const next = [...(meltRewardTiers || []).filter((x) => Number(x.threshold_bullets) !== threshold), { threshold_bullets: threshold, reward_money: reward }]
                    .sort((a, b) => Number(a.threshold_bullets) - Number(b.threshold_bullets));
                  onMeltSettingsUpdate({ melt_reward_tiers: next });
                  setTierThresholdInput('');
                  setTierRewardInput('');
                }}
                className="px-3 py-1.5 rounded-lg text-[10px] font-heading font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 hover:bg-emerald-500/30 transition-all"
              >
                Add/Update tier
              </button>
              {(meltRewardTiers || []).length > 0 && (
                <button
                  type="button"
                  onClick={() => onMeltSettingsUpdate({ melt_reward_tiers: [] })}
                  className="px-3 py-1.5 rounded-lg text-[10px] font-heading font-bold uppercase tracking-wider bg-red-500/20 text-red-400 border border-red-500/40 hover:bg-red-500/30 transition-all"
                >
                  Clear tiers
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Graveyard ── */}
      {fallen.length > 0 && (
        <div className="pt-3 border-t border-zinc-700/20">
          <div className="flex items-center gap-2 mb-2">
            <Skull size={11} className="text-zinc-600" />
            <p className="text-[9px] text-zinc-600 font-heading uppercase tracking-[0.2em]">Graveyard — {fallen.length} fallen</p>
          </div>
          <div className="space-y-1">
            {fallen.map((m, idx) => {
              const cfg = getRoleConfig(m.role);
              const deadDate = m.dead_at
                ? new Date(m.dead_at).toLocaleDateString([], { month: 'short', day: 'numeric', year: '2-digit' })
                : null;
              return (
                <div
                  key={m.user_id}
                  className="relative flex items-center justify-between px-3 py-2 rounded-lg bg-zinc-900/50 border border-zinc-800/50 opacity-60 fam-fade-in"
                  style={{ animationDelay: `${idx * 0.04}s` }}
                >
                  <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-zinc-700/40 rounded-l-lg" />
                  <div className="min-w-0 flex items-center gap-2">
                    <Skull size={10} className="text-zinc-600 shrink-0" />
                    <div className="min-w-0">
                      <Link
                        to={`/profile/${encodeURIComponent(m.username)}`}
                        className="font-heading font-bold text-xs text-zinc-500 hover:text-zinc-300 transition-colors block truncate line-through decoration-zinc-700"
                      >
                        {m.username}
                      </Link>
                      <span className={`inline-flex items-center gap-0.5 text-[9px] font-heading ${cfg.color} opacity-60`}>
                        {cfg.icon} {cfg.label}
                      </span>
                      <p className="text-[9px] text-zinc-600 mt-0.5">
                        Melted for family: {(Number(m.family_bullets_melted || 0)).toLocaleString()}
                      </p>
                      <p className="text-[9px] text-emerald-400/80 mt-0.5">
                        Rewards: {formatMoneyFull(m.family_melt_reward_money_earned || 0)} ({Number(m.family_melt_reward_hits || 0)}x)
                      </p>
                    </div>
                  </div>
                  {deadDate && (
                    <span className="text-[8px] text-zinc-700 font-heading shrink-0 ml-2">†&nbsp;{deadDate}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// ALL FAMILIES TAB
// ============================================================================

function FamilyListCrewOCHint({ isoUntil }) {
  const text = formatRaidCountdown(isoUntil);
  const ready = !isoUntil || !text || text === 'Ready';
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[8px] font-heading font-bold tracking-tight ${
        ready ? 'text-emerald-400/90' : 'text-amber-400/90'
      }`}
      title={ready ? 'Crew OC available' : 'Time until this family can Crew OC again'}
    >
      <Crosshair size={9} className="shrink-0 opacity-80" />
      <span className="font-mono tabular-nums normal-case tracking-tight">{ready ? 'OC ready' : text}</span>
    </span>
  );
}

const FamiliesTab = ({ families, myFamilyId }) => {
  const [, setFamiliesOcTick] = useState(0);
  useEffect(() => {
    if (!families?.length) return undefined;
    const id = setInterval(() => setFamiliesOcTick((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, [families]);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 sm:gap-2 max-h-80 overflow-y-auto pr-1">
      {families.length === 0 ? (
        <div className="text-center py-10 col-span-2">
          <Building2 size={28} className="mx-auto text-zinc-700 mb-2" />
          <p className="text-xs text-zinc-500 font-heading tracking-wider uppercase">No known families</p>
          <p className="text-[9px] text-zinc-600 font-heading mt-1 italic">The underworld awaits its first Don</p>
        </div>
      ) : (
        families.map((f, idx) => (
          <Link
            key={f.id}
            to={`/families/${encodeURIComponent(f.tag || f.id)}`}
            className={`relative flex items-center justify-between gap-2 px-2.5 sm:px-3 py-2 min-h-[44px] sm:min-h-0 rounded-lg transition-all group fam-member-row fam-fade-in overflow-hidden touch-manipulation ${myFamilyId === f.id ? 'bg-primary/5 border border-primary/25' : 'bg-zinc-800/30 border border-zinc-700/30 hover:border-zinc-600/50'}`}
            style={{ animationDelay: `${idx * 0.03}s` }}
          >
            {myFamilyId === f.id && <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-primary/60" />}
            <div className="min-w-0 flex-1 flex items-start">
              <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="font-heading font-bold text-foreground text-xs group-hover:text-primary transition-colors tracking-wide">{f.name}</span>
                <span className="text-primary/50 text-[10px]">[{f.tag}]</span>
                {myFamilyId === f.id && <span className="text-[9px] text-primary font-heading font-bold">(Yours)</span>}
                {f.at_war && (
                  <span className="inline-flex items-center gap-0.5 text-[8px] font-heading font-bold text-red-400 bg-red-500/10 border border-red-500/20 rounded px-1 py-0.5 animate-pulse">
                    <Swords size={8} /> AT WAR
                  </span>
                )}
              </div>
              <div className="mt-0.5">
                <FamilyListCrewOCHint isoUntil={f.crew_oc_cooldown_until} />
              </div>
              </div>
            </div>
            <div className="flex items-center gap-2 sm:gap-3 text-[10px] shrink-0">
              <span className="text-zinc-400 flex items-center gap-0.5"><Users size={10} /> {f.member_count}</span>
              <span className="text-primary font-heading font-bold">{formatMoney(f.treasury)}</span>
              <ChevronRight size={12} className="text-zinc-600 group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
            </div>
          </Link>
        ))
      )}
    </div>
  );
};

// ============================================================================
// WAR HISTORY TAB
// ============================================================================

const WarHistoryTab = ({ wars, onDetails }) => (
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
        <div key={w.id} className={`relative px-2.5 sm:px-3 py-2.5 rounded-lg transition-all fam-fade-in overflow-hidden ${isActive ? 'bg-red-500/8 border fam-blood-pulse' : 'bg-zinc-800/30 border border-zinc-700/30 hover:bg-zinc-800/40'}`} style={{ animationDelay: `${idx * 0.04}s` }}>
          {isActive && <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-red-500/60" />}
          {hasWinner && <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-emerald-500/50" />}
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-xs font-heading tracking-wide">
                <span className="text-foreground font-bold">{w.family_a_name}</span>
                <span className="text-zinc-600 mx-2 text-[10px] italic">vs</span>
                <span className="text-foreground font-bold">{w.family_b_name}</span>
              </div>
              <div className="text-[9px] text-zinc-500 mt-1 font-heading flex items-center gap-1">
                <Clock size={8} />
                {w.ended_at ? new Date(w.ended_at).toLocaleDateString() : 'Ongoing vendetta'}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {isActive && <span className="text-red-400 text-[10px] font-bold animate-pulse flex items-center gap-1"><Flame size={10} /> ACTIVE</span>}
              {hasWinner && <span className="text-emerald-400 text-[10px] font-heading font-bold flex items-center gap-1"><Trophy size={10} /> {w.winner_family_name}</span>}
              {onDetails && w.id && (
                <button
                  type="button"
                  onClick={() => onDetails(w.id)}
                  className="px-2 py-1.5 min-h-[36px] sm:min-h-0 rounded text-[9px] font-heading font-bold uppercase tracking-widest border border-primary/25 text-primary/60 hover:text-primary hover:border-primary/50 hover:bg-primary/5 transition-all touch-manipulation"
                >
                  Details
                </button>
              )}
            </div>
          </div>
        </div>
      );
    })}
  </div>
);

// ============================================================================
// WAR DETAILS MODAL — public read-only view of any war
// ============================================================================

const WarDetailsModal = ({ warId, onClose }) => {
  const [tab, setTab] = useState('fighters');
  const [data, setData] = useState(null);
  const [feed, setFeed] = useState(null);
  const [loading, setLoading] = useState(false);
  const [feedLoading, setFeedLoading] = useState(false);

  useEffect(() => {
    if (!warId) return;
    setLoading(true);
    setData(null);
    setFeed(null);
    setTab('fighters');
    api.get(`/families/war/${warId}/stats`)
      .then(res => setData(res.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [warId]);

  useEffect(() => {
    if (tab !== 'feed' || feed !== null || !warId) return;
    setFeedLoading(true);
    api.get(`/families/war/${warId}/feed`)
      .then(res => setFeed(res.data?.feed ?? []))
      .catch(() => setFeed([]))
      .finally(() => setFeedLoading(false));
  }, [tab, warId, feed]);

  if (!warId) return null;

  const war = data?.war;
  const faTotals = data?.family_a_totals ?? {};
  const fbTotals = data?.family_b_totals ?? {};
  const allPlayers = data?.all_players ?? [];
  const faFighters = allPlayers.filter(p => p.family_id === war?.family_a_id).sort((a, b) => (b.impact || 0) - (a.impact || 0));
  const fbFighters = allPlayers.filter(p => p.family_id === war?.family_b_id).sort((a, b) => (b.impact || 0) - (a.impact || 0));
  const isActive = war?.status === 'active' || war?.status === 'truce_offered';

  const StatRow = ({ label, val, accent }) => (
    <div className="flex items-center justify-between px-1 text-[9px] font-heading text-zinc-600">
      <span>{label}</span>
      <span className={val > 0 ? `text-${accent}-500 font-bold` : ''}>{val}</span>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/95 backdrop-blur-sm" onClick={onClose}>
      <div
        className={`relative w-full max-w-lg ${styles.panel} rounded-xl overflow-hidden shadow-2xl fam-scale-in`}
        style={{ border: '1px solid rgba(239,68,68,0.2)', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Top bar */}
        <div className="relative flex items-center justify-between px-4 py-2.5 bg-zinc-900/80 border-b border-zinc-800/60 shrink-0">
          <div className="flex items-center gap-2">
            {isActive && <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />}
            <span className="text-[9px] font-heading font-bold text-red-400/70 uppercase tracking-[0.25em]">
              {isActive ? 'Blood Feud · Active' : 'Vendetta · Concluded'}
            </span>
          </div>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 transition-colors p-1 rounded hover:bg-zinc-800">
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-zinc-600 text-xs font-heading">Loading intel...</div>
          ) : !war ? (
            <div className="flex items-center justify-center py-16 text-zinc-600 text-xs font-heading">No data available</div>
          ) : <>
            {/* Fight card */}
            <div className="px-4 pt-4 pb-2">
              <div className="grid grid-cols-[1fr_52px_1fr] items-start gap-1">
                {/* Family A */}
                <div className="text-center">
                  <div className="text-[8px] font-heading font-bold text-emerald-400/50 uppercase tracking-[0.18em] mb-1">Corner A</div>
                  <div className="text-sm font-heading font-bold text-foreground leading-tight truncate">{war.family_a_name}</div>
                  <div className="text-[10px] text-emerald-500/40 font-heading mb-2">[{war.family_a_tag}]</div>
                  <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl py-3 px-2">
                    <div className="text-3xl font-heading font-bold text-emerald-400 tabular-nums">{faTotals.kills ?? 0}</div>
                    <div className="text-[9px] text-emerald-600 font-heading font-bold uppercase tracking-wider mt-0.5">kills</div>
                    <div className="text-[9px] text-zinc-500 font-heading mt-1">{faTotals.deaths ?? 0} deaths</div>
                  </div>
                  <div className="mt-1.5 space-y-0.5">
                    <StatRow label="BG Kills" val={faTotals.bodyguard_kills ?? 0} accent="emerald" />
                    <StatRow label="BG Lost" val={faTotals.bodyguards_lost ?? 0} accent="zinc" />
                  </div>
                </div>
                {/* VS */}
                <div className="flex flex-col items-center justify-start gap-1.5 pt-6">
                  <div className="w-px h-5 bg-gradient-to-b from-transparent via-zinc-700 to-transparent" />
                  <div className="relative p-1.5 rounded-full bg-zinc-900 border border-zinc-700/50">
                    <Swords size={16} className="text-red-400" />
                  </div>
                  <div className="text-[8px] font-heading font-bold text-zinc-600 uppercase tracking-widest">VS</div>
                  <div className="w-px h-5 bg-gradient-to-b from-transparent via-zinc-700 to-transparent" />
                </div>
                {/* Family B */}
                <div className="text-center">
                  <div className="text-[8px] font-heading font-bold text-red-400/50 uppercase tracking-[0.18em] mb-1">Corner B</div>
                  <div className="text-sm font-heading font-bold text-foreground leading-tight truncate">{war.family_b_name}</div>
                  <div className="text-[10px] text-red-500/40 font-heading mb-2">[{war.family_b_tag}]</div>
                  <div className="bg-red-500/10 border border-red-500/20 rounded-xl py-3 px-2">
                    <div className="text-3xl font-heading font-bold text-red-400 tabular-nums">{fbTotals.kills ?? 0}</div>
                    <div className="text-[9px] text-red-700 font-heading font-bold uppercase tracking-wider mt-0.5">kills</div>
                    <div className="text-[9px] text-zinc-500 font-heading mt-1">{fbTotals.deaths ?? 0} deaths</div>
                  </div>
                  <div className="mt-1.5 space-y-0.5">
                    <StatRow label="BG Kills" val={fbTotals.bodyguard_kills ?? 0} accent="red" />
                    <StatRow label="BG Lost" val={fbTotals.bodyguards_lost ?? 0} accent="zinc" />
                  </div>
                </div>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-zinc-800/60 mx-4 mb-3">
              {[['fighters', 'Fighters'], ['feed', 'Kill Feed']].map(([id, label]) => (
                <button key={id} onClick={() => setTab(id)}
                  className={`px-3 py-2 text-[10px] font-heading font-bold uppercase tracking-widest transition-colors ${tab === id ? 'text-primary border-b-2 border-primary -mb-px' : 'text-zinc-600 hover:text-zinc-400'}`}>
                  {label}
                </button>
              ))}
            </div>

            {/* Fighters */}
            {tab === 'fighters' && (
              <div className="px-4 pb-4 grid grid-cols-2 gap-3">
                {[
                  { fighters: faFighters, color: 'emerald', name: war.family_a_name },
                  { fighters: fbFighters, color: 'red', name: war.family_b_name },
                ].map(({ fighters, color, name }) => (
                  <div key={name}>
                    <div className={`text-[9px] font-heading font-bold text-${color}-400/60 uppercase tracking-widest mb-1.5 truncate`}>{name}</div>
                    {fighters.length === 0
                      ? <div className="text-[9px] text-zinc-700 font-heading italic px-1">No activity recorded</div>
                      : fighters.slice(0, 8).map((f, i) => (
                        <div key={f.user_id || i} className={`flex items-center justify-between px-2 py-1.5 rounded mb-1 bg-${color}-500/5 border border-${color}-500/10`}>
                          <span className="text-[10px] font-heading text-foreground truncate flex-1">{f.username}</span>
                          <div className="flex items-center gap-1.5 text-[9px] shrink-0 ml-1">
                            <span className={`text-${color}-400 font-bold`}>{f.kills ?? 0}K</span>
                            <span className="text-zinc-600">{f.bodyguard_kills ?? 0}BG</span>
                          </div>
                        </div>
                      ))
                    }
                  </div>
                ))}
              </div>
            )}

            {/* Kill Feed */}
            {tab === 'feed' && (
              <div className="px-4 pb-4">
                {feedLoading
                  ? <div className="text-center py-6 text-zinc-600 text-xs font-heading">Loading feed...</div>
                  : (feed ?? []).length === 0
                    ? <div className="text-center py-6 text-zinc-700 text-xs font-heading italic">No kill events recorded</div>
                    : <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                        {(feed ?? []).map((ev, i) => (
                          <div key={i} className="px-3 py-2 rounded-lg bg-zinc-800/20 border border-zinc-700/20">
                            <div className="text-[10px] font-heading">
                              <span className="text-emerald-400 font-bold">{ev.killer_username}</span>
                              {ev.event_type === 'player_kill'
                                ? <><span className="text-zinc-600"> killed </span><span className="text-red-400 font-bold">{ev.victim_username}</span></>
                                : <><span className="text-zinc-600"> eliminated BG of </span><span className="text-red-400 font-bold">{ev.victim_username ?? ev.bg_username}</span></>
                              }
                            </div>
                            <div className="flex flex-wrap gap-2 mt-0.5 text-[9px] text-zinc-600 font-heading">
                              {(ev.bullets_used || 0) > 0 && <span>🔫 {Number(ev.bullets_used).toLocaleString()}</span>}
                              {(ev.cash_loot || 0) > 0 && <span>💰 ${Number(ev.cash_loot).toLocaleString()}</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                }
              </div>
            )}
          </>}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// TRUCE BANNERS
// ============================================================================

const TruceOfferBanner = ({ war, family }) => {
  const [secondsLeft, setSecondsLeft] = useState(null);
  const weOffered = war.truce_offered_by_family_id === family?.id;

  useEffect(() => {
    if (!war.truce_offered_at) return;
    const timeoutMinutes = war.truce_timeout_minutes || 30;
    const offeredAt = new Date(war.truce_offered_at).getTime();
    const deadline = offeredAt + timeoutMinutes * 60 * 1000;

    const update = () => {
      const now = Date.now();
      const remaining = Math.max(0, Math.floor((deadline - now) / 1000));
      setSecondsLeft(remaining);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [war.truce_offered_at, war.truce_timeout_minutes]);

  const mins = secondsLeft !== null ? Math.floor(secondsLeft / 60) : '--';
  const secs = secondsLeft !== null ? String(secondsLeft % 60).padStart(2, '0') : '--';

  return (
    <div className="mx-4 mt-3 text-[10px] rounded-lg px-3 py-2 bg-primary/10 text-primary border border-primary/25 font-heading font-bold text-center">
      {weOffered ? (
        <>✋ You offered a truce — waiting for response</>
      ) : (
        <>🤝 Enemy offered a truce — Boss/Underboss can accept</>
      )}
      {secondsLeft !== null && secondsLeft > 0 && (
        <div className="mt-1 text-[9px] text-primary/70">
          Expires in {mins}:{secs}
        </div>
      )}
      {secondsLeft === 0 && (
        <div className="mt-1 text-[9px] text-red-400">
          Offer expired
        </div>
      )}
    </div>
  );
};

const TruceCooldownBanner = ({ cooldownUntil }) => {
  const [secondsLeft, setSecondsLeft] = useState(null);

  useEffect(() => {
    if (!cooldownUntil) return;
    const deadline = new Date(cooldownUntil).getTime();

    const update = () => {
      const now = Date.now();
      const remaining = Math.max(0, Math.floor((deadline - now) / 1000));
      setSecondsLeft(remaining);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [cooldownUntil]);

  if (secondsLeft === null || secondsLeft <= 0) return null;

  const hours = Math.floor(secondsLeft / 3600);
  const mins = Math.floor((secondsLeft % 3600) / 60);

  return (
    <div className="mx-4 mt-3 text-[10px] rounded-lg px-3 py-2 bg-zinc-800/60 text-zinc-400 border border-zinc-700/40 font-heading text-center">
      ⏳ Truce cooldown: {hours}h {mins}m remaining
    </div>
  );
};

// ============================================================================
// WAR MODAL — Boxing Match Card
// ============================================================================

const WarModal = ({ war, stats, family, canManage, onClose, onOfferTruce, onAcceptTruce }) => {
  const [modalTab, setModalTab] = useState('fighters');
  const [feed, setFeed] = useState(null);
  const [feedLoading, setFeedLoading] = useState(false);

  const [feedMeta, setFeedMeta] = useState(null); // { war_over, my_totals, other_totals }

  useEffect(() => {
    if (modalTab === 'feed' && war?.id && feed === null) {
      setFeedLoading(true);
      api.get(`/families/war/${war.id}/feed`)
        .then((res) => {
          setFeed(res.data?.feed ?? []);
          setFeedMeta({
            war_over: res.data?.war_over ?? false,
            my_totals: res.data?.my_totals ?? { bullets_used: 0, bg_points_spent: 0 },
            other_totals: res.data?.other_totals ?? { bullets_used: 0, bg_points_spent: 0 },
          });
        })
        .catch(() => { setFeed([]); setFeedMeta(null); })
        .finally(() => setFeedLoading(false));
    }
  }, [modalTab, war?.id, feed]);

  useEffect(() => { setFeed(null); setFeedMeta(null); setModalTab('fighters'); }, [war?.id]);

  if (!war) return null;

  const myK    = stats?.my_family_totals?.kills ?? 0;
  const myD    = stats?.my_family_totals?.deaths ?? 0;
  const myBGK  = stats?.my_family_totals?.bodyguard_kills ?? 0;
  const myBGL  = stats?.my_family_totals?.bodyguards_lost ?? 0;
  const theirK   = stats?.other_family_totals?.kills ?? 0;
  const theirD   = stats?.other_family_totals?.deaths ?? 0;
  const theirBGK = stats?.other_family_totals?.bodyguard_kills ?? 0;
  const theirBGL = stats?.other_family_totals?.bodyguards_lost ?? 0;

  const totalKills = myK + theirK;
  const myDomPct = totalKills > 0 ? Math.round((myK / totalKills) * 100) : 50;

  const ourFid   = family?.id;
  const theirFid = war.other_family_id;
  const allPlayers = stats?.mvp || [];
  const ourFighters   = allPlayers.filter(p => p.family_id === ourFid).sort((a, b) => (b.impact || 0) - (a.impact || 0)).slice(0, 5);
  const theirFighters = allPlayers.filter(p => p.family_id === theirFid).sort((a, b) => (b.impact || 0) - (a.impact || 0)).slice(0, 5);

  const formatTs = (iso) => {
    if (!iso) return '';
    try { return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
    catch { return ''; }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/95 backdrop-blur-sm" onClick={onClose}>
      <div
        className={`relative w-full max-w-lg ${styles.panel} rounded-xl overflow-hidden shadow-2xl fam-scale-in`}
        style={{ border: '1px solid rgba(239,68,68,0.2)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Background glow split */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute left-0 top-0 bottom-0 w-1/2 bg-[radial-gradient(ellipse_at_left_center,rgba(16,185,129,0.06),transparent_70%)]" />
          <div className="absolute right-0 top-0 bottom-0 w-1/2 bg-[radial-gradient(ellipse_at_right_center,rgba(239,68,68,0.06),transparent_70%)]" />
        </div>

        {/* ── TOP BAR ── */}
        <div className="relative flex items-center justify-between px-4 py-2.5 bg-zinc-900/80 border-b border-zinc-800/60">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
            <span className="text-[9px] font-heading font-bold text-red-400/70 uppercase tracking-[0.25em]">Blood Feud · Active</span>
          </div>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 transition-colors p-1 rounded hover:bg-zinc-800">
            <X size={14} />
          </button>
        </div>

        {war.status === 'truce_offered' && (
          <TruceOfferBanner war={war} family={family} />
        )}
        {war.status === 'active' && war.truce_cooldown_until && (
          <TruceCooldownBanner cooldownUntil={war.truce_cooldown_until} />
        )}

        {/* ── FIGHT CARD ── */}
        <div className="relative px-4 pt-4 pb-3">
          <div className="grid grid-cols-[1fr_52px_1fr] items-start gap-1">

            {/* GREEN CORNER — us */}
            <div className="text-center">
              <div className="text-[8px] font-heading font-bold text-emerald-400/50 uppercase tracking-[0.18em] mb-1">Our Famiglia</div>
              <div className="text-sm font-heading font-bold text-foreground leading-tight truncate">{family?.name || '—'}</div>
              <div className="text-[10px] text-emerald-500/40 font-heading mb-2.5">[{family?.tag || '—'}]</div>
              <div className="relative bg-emerald-500/10 border border-emerald-500/20 rounded-xl py-3 px-2">
                <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-emerald-500/30 to-transparent rounded-t-xl" />
                <div className="text-3xl font-heading font-bold text-emerald-400 leading-none tabular-nums">{myK}</div>
                <div className="text-[9px] text-emerald-600 font-heading font-bold uppercase tracking-wider mt-0.5">kills</div>
                <div className="text-[9px] text-zinc-500 font-heading mt-1.5">{myD} deaths</div>
              </div>
              <div className="mt-2 space-y-0.5 text-[9px] font-heading">
                <div className="flex items-center justify-between px-1 text-zinc-600">
                  <span>BG Kills</span>
                  <span className={myBGK > 0 ? 'text-emerald-500 font-bold' : 'text-zinc-600'}>{myBGK}</span>
                </div>
                <div className="flex items-center justify-between px-1 text-zinc-600">
                  <span>BG Lost</span>
                  <span className={myBGL > 0 ? 'text-zinc-400' : 'text-zinc-700'}>{myBGL}</span>
                </div>
              </div>
            </div>

            {/* VS centre */}
            <div className="flex flex-col items-center justify-start gap-1.5 pt-6">
              <div className="w-px h-5 bg-gradient-to-b from-transparent via-zinc-700 to-transparent" />
              <div className="relative p-1.5 rounded-full bg-zinc-900 border border-zinc-700/50">
                <div className="absolute inset-0 rounded-full bg-red-500/10 blur-md" />
                <Swords size={16} className="text-red-400 relative" />
              </div>
              <div className="text-[8px] font-heading font-bold text-zinc-600 uppercase tracking-widest">VS</div>
              <div className="w-px h-5 bg-gradient-to-b from-transparent via-zinc-700 to-transparent" />
            </div>

            {/* RED CORNER — enemy */}
            <div className="text-center">
              <div className="text-[8px] font-heading font-bold text-red-400/50 uppercase tracking-[0.18em] mb-1">The Enemy</div>
              <div className="text-sm font-heading font-bold text-foreground leading-tight truncate">{war.other_family_name}</div>
              <div className="text-[10px] text-red-500/40 font-heading mb-2.5">[{war.other_family_tag}]</div>
              <div className="relative bg-red-500/10 border border-red-500/20 rounded-xl py-3 px-2">
                <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-red-500/30 to-transparent rounded-t-xl" />
                <div className="text-3xl font-heading font-bold text-red-400 leading-none tabular-nums">{theirK}</div>
                <div className="text-[9px] text-red-600 font-heading font-bold uppercase tracking-wider mt-0.5">kills</div>
                <div className="text-[9px] text-zinc-500 font-heading mt-1.5">{theirD} deaths</div>
              </div>
              <div className="mt-2 space-y-0.5 text-[9px] font-heading">
                <div className="flex items-center justify-between px-1 text-zinc-600">
                  <span>BG Kills</span>
                  <span className={theirBGK > 0 ? 'text-red-500 font-bold' : 'text-zinc-600'}>{theirBGK}</span>
                </div>
                <div className="flex items-center justify-between px-1 text-zinc-600">
                  <span>BG Lost</span>
                  <span className={theirBGL > 0 ? 'text-zinc-400' : 'text-zinc-700'}>{theirBGL}</span>
                </div>
              </div>
            </div>
          </div>

          {/* ── DOMINANCE BAR ── */}
          <div className="mt-4">
            <div className="flex items-center justify-between text-[8px] font-heading text-zinc-600 mb-1 uppercase tracking-wider">
              <span className="text-emerald-600">{myDomPct}%</span>
              <span className="text-zinc-600">Dominance</span>
              <span className="text-red-600">{100 - myDomPct}%</span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)' }}>
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  background: totalKills === 0
                    ? 'linear-gradient(90deg, rgb(16,185,129) 50%, rgb(239,68,68) 50%)'
                    : `linear-gradient(90deg, rgb(16,185,129) ${myDomPct}%, rgb(239,68,68) ${myDomPct}%)`
                }}
              />
            </div>
          </div>
        </div>

        {/* ── SUB-TABS ── */}
        <div className="flex border-y border-zinc-800/60 bg-zinc-900/40">
          {[['fighters', 'Fighters'], ['feed', 'Kill Feed']].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setModalTab(key)}
              className={`flex-1 py-2 text-[9px] font-heading font-bold uppercase tracking-[0.12em] transition-all border-b-2 ${
                modalTab === key
                  ? 'text-primary border-primary bg-primary/5'
                  : 'text-zinc-600 border-transparent hover:text-zinc-400'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ── TAB CONTENT ── */}
        <div className="overflow-y-auto" style={{ maxHeight: '220px' }}>

          {/* FIGHTERS TAB */}
          {modalTab === 'fighters' && (
            <div className="grid grid-cols-2 divide-x divide-zinc-800/50">
              {[
                { fighters: ourFighters, color: 'emerald', side: 'us' },
                { fighters: theirFighters, color: 'red', side: 'them' },
              ].map(({ fighters, color, side }) => (
                <div key={side} className="p-2.5 space-y-1">
                  {fighters.length === 0 ? (
                    <p className="text-[9px] text-zinc-700 font-heading italic text-center py-4">No activity yet</p>
                  ) : fighters.map(p => (
                    <div
                      key={p.username}
                      className={`flex items-center justify-between gap-1 px-2 py-1.5 rounded-md text-[9px] font-heading bg-${color}-500/5`}
                    >
                      <Link
                        to={`/profile/${encodeURIComponent(p.username)}`}
                        className={`font-bold truncate text-${color}-400 hover:underline max-w-[80px]`}
                      >
                        {p.username}
                      </Link>
                      <span className="text-zinc-600 shrink-0">
                        {p.kills}K&nbsp;{p.bodyguard_kills > 0 ? `${p.bodyguard_kills}BG` : ''}&nbsp;{p.deaths}D
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {/* KILL FEED TAB */}
          {modalTab === 'feed' && (
            <div className="p-2.5 space-y-1.5">
              {feedLoading ? (
                <div className="flex items-center justify-center py-8 gap-2 text-zinc-600 text-[9px] font-heading">
                  <div className="w-3 h-3 border border-primary border-t-transparent rounded-full animate-spin" />
                  Loading...
                </div>
              ) : !feed || feed.length === 0 ? (
                <div className="text-center py-8">
                  <Skull size={22} className="mx-auto text-zinc-800 mb-2" />
                  <p className="text-[9px] text-zinc-600 font-heading uppercase tracking-wider">No kills recorded yet</p>
                  <p className="text-[8px] text-zinc-700 font-heading italic mt-1">Every death will be logged here</p>
                </div>
              ) : feed.map((event, idx) => {
                const isBG   = event.kill_type === 'bodyguard';
                const isOurs = event.killer_family_id === ourFid;
                return (
                  <div
                    key={event.id || idx}
                    className={`relative pl-2.5 pr-2 py-1.5 rounded-md text-[9px] font-heading border-l-2 ${
                      isOurs ? 'border-emerald-500/50 bg-emerald-500/5' : 'border-red-500/50 bg-red-500/5'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <span className={`font-bold ${isOurs ? 'text-emerald-400' : 'text-red-400'}`}>
                          {event.killer_username}
                        </span>
                        {isBG ? (
                          <>
                            <span className="text-zinc-500"> killed </span>
                            <span className="text-zinc-300 font-bold">{event.bg_username || 'bodyguard'}</span>
                            {event.bg_owner_username && (
                              <span className="text-zinc-600"> (protecting <span className="text-zinc-400">{event.bg_owner_username}</span>)</span>
                            )}
                          </>
                        ) : (
                          <span className="text-zinc-500"> killed <span className="text-zinc-300 font-bold">{event.victim_username}</span></span>
                        )}
                        {(event.bullets_used > 0 || (!isBG && (event.cash_taken > 0 || event.props_taken > 0 || event.cars_taken > 0))) && (
                          <div className="text-[8px] text-zinc-600 mt-0.5 flex flex-wrap gap-1.5">
                            {event.bullets_used > 0 && <span className="text-zinc-500">{Number(event.bullets_used).toLocaleString()} bullets</span>}
                            {!isBG && event.cash_taken > 0 && <span className="text-primary font-bold">${Number(event.cash_taken).toLocaleString()}</span>}
                            {!isBG && event.props_taken > 0 && <span>{event.props_taken} prop{event.props_taken > 1 ? 's' : ''}</span>}
                            {!isBG && event.cars_taken > 0 && <span>{event.cars_taken} car{event.cars_taken > 1 ? 's' : ''}</span>}
                          </div>
                        )}
                      </div>
                      <div className="shrink-0 text-right">
                        <span className={`px-1 py-0.5 rounded text-[8px] font-bold ${isBG ? 'bg-primary/10 text-primary' : isOurs ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-400'}`}>
                          {isBG ? 'BG' : 'KILL'}
                        </span>
                        <p className="text-[8px] text-zinc-700 mt-0.5">{formatTs(event.created_at)}</p>
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* War totals row */}
              {feedMeta && (
                <div className="mt-3 pt-2.5 border-t border-zinc-800/60 grid grid-cols-2 gap-2 text-[8px] font-heading">
                  {[
                    { label: family?.name || 'Us', totals: feedMeta.my_totals, color: 'emerald' },
                    { label: war.other_family_name, totals: feedMeta.other_totals, color: 'red' },
                  ].map(({ label, totals, color }) => (
                    <div key={label} className={`rounded-md p-2 bg-${color}-500/5 border border-${color}-500/15 space-y-1`}>
                      <div className={`text-[8px] font-bold text-${color}-500/70 uppercase tracking-wider truncate`}>{label}</div>
                      <div className="flex items-center justify-between text-zinc-500">
                        <span>Bullets used</span>
                        <span className="text-zinc-300 font-bold">{Number(totals.bullets_used).toLocaleString()}</span>
                      </div>
                      <div className="flex items-center justify-between text-zinc-500">
                        <span>Points on BGs</span>
                        {feedMeta.war_over ? (
                          <span className="text-zinc-300 font-bold">{Number(totals.bg_points_spent).toLocaleString()}</span>
                        ) : (
                          <span className="text-zinc-600 italic">revealed at war end</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── TRUCE BUTTONS ── */}
        {canManage && (war.status === 'active' || (war.status === 'truce_offered' && war.truce_offered_by_family_id !== family?.id)) && (
          <div className="flex gap-2 px-4 py-3 border-t border-zinc-800/60">
            {war.status === 'active' && (() => {
              const onCooldown = war.truce_cooldown_until && new Date(war.truce_cooldown_until) > new Date();
              return (
                <button
                  onClick={onOfferTruce}
                  disabled={onCooldown}
                  className={`flex-1 py-2 rounded-lg text-[10px] font-heading font-bold uppercase tracking-wider border transition-all ${onCooldown ? 'bg-zinc-900 border-zinc-800 text-zinc-600 cursor-not-allowed' : 'bg-zinc-800/60 border-zinc-700/40 text-zinc-400 hover:border-primary/40 hover:text-primary'}`}
                >
                  {onCooldown ? '⏳ Truce on Cooldown' : '🤝 Offer Truce'}
                </button>
              );
            })()}
            {war.status === 'truce_offered' && war.truce_offered_by_family_id !== family?.id && (
              <button
                onClick={onAcceptTruce}
                className="flex-1 py-2 rounded-lg text-[10px] font-heading font-bold uppercase tracking-wider border bg-primary/20 border-primary/50 text-primary hover:bg-primary/30 transition-all"
              >
                ✓ Accept Truce
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ============================================================================
// CREW OC TAB
// ============================================================================

const CrewOCTab = ({
  family, myRole, crewOCCooldownUntil, committerHasTimer, crewOCJoinFee, crewOCAutoAccept, crewOCForumTopicId,
  crewOCApplications, canManageCrewOC, onCommit, committing, feeInput, setFeeInput,
  onSetFee, setFeeLoading, onAdvertise, advertiseLoading, onAcceptApp, onRejectApp, onKickApp, onSetAutoAccept, setAutoAcceptLoading,
}) => {
  const canCommit = ['boss', 'underboss', 'capo'].includes(myRole?.toLowerCase());
  const cooldownHours = committerHasTimer ? 6 : 8;
  const [, setCrewOcTick] = useState(0);
  useEffect(() => {
    const iso = family?.crew_oc_cooldown_until;
    if (!iso) return undefined;
    const end = new Date(iso).getTime();
    if (!Number.isFinite(end) || end <= Date.now()) return undefined;
    const id = setInterval(() => setCrewOcTick((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, [family?.crew_oc_cooldown_until]);

  const now = Date.now();
  const until = family?.crew_oc_cooldown_until ? new Date(family.crew_oc_cooldown_until).getTime() : 0;
  const onCooldown = until > now;
  const liveCountdown = formatRaidCountdown(family?.crew_oc_cooldown_until);
  const crewOcReady = !family?.crew_oc_cooldown_until || !liveCountdown || liveCountdown === 'Ready';
  const pending = (crewOCApplications || []).filter((a) => a.status === 'pending');
  const accepted = (crewOCApplications || []).filter((a) => a.status === 'accepted');

  return (
    <div className="space-y-2">
      <p className="text-[10px] text-zinc-500 font-heading leading-relaxed italic">
        When the Don, Underboss, or Caporegime calls the crew together, every living member and accepted outsiders earn their cut — cash, XP, bullets, points, booze. The family vault takes its share. Once every {cooldownHours}h{committerHasTimer ? ' (you hold the timer)' : ''}.
      </p>

      {/* Set join fee & Advertise */}
      {canManageCrewOC && (
        <div className="space-y-2 p-2.5 sm:p-3 rounded-lg bg-zinc-800/30 border border-zinc-700/30">
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
          <label className="flex items-center gap-2 cursor-pointer group">
            <input
              type="checkbox"
              checked={!!crewOCAutoAccept}
              onChange={(e) => onSetAutoAccept && onSetAutoAccept(e.target.checked)}
              disabled={setAutoAcceptLoading}
              className="rounded border-zinc-600 bg-zinc-900 text-primary focus:ring-primary/50"
            />
            <span className="text-[10px] font-heading text-zinc-400 group-hover:text-zinc-300">Auto-accept applications</span>
          </label>
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

      {/* Cooldown & commit — live countdown (matches crew_oc_cooldown_until) */}
      <div className="flex items-center justify-between px-2.5 sm:px-3 py-2 rounded-lg bg-zinc-800/30 border border-zinc-700/30 gap-2">
        <span className="text-[10px] text-zinc-500 font-heading flex items-center gap-1 shrink-0"><Clock size={10} /> Next commit</span>
        <span className={`text-xs font-heading font-bold text-right min-w-0 ${crewOcReady ? 'text-emerald-400' : 'text-amber-400'}`}>
          {crewOcReady ? 'Ready' : <span className="font-mono tabular-nums tracking-tight">{liveCountdown}</span>}
        </span>
      </div>

      {canCommit ? (
        <button type="button" onClick={onCommit} disabled={onCooldown || committing}
          className={`w-full py-2.5 sm:py-3 min-h-[44px] sm:min-h-0 font-heading font-bold uppercase tracking-wider text-xs rounded-lg border-2 transition-all touch-manipulation ${
            onCooldown || committing
              ? 'opacity-40 cursor-not-allowed bg-zinc-800 text-zinc-500 border-zinc-700'
              : 'bg-gradient-to-b from-primary/30 to-primary/10 border-primary/50 text-primary hover:from-primary/40 hover:shadow-lg hover:shadow-primary/10'
          }`}>
          {committing ? 'Committing...' : onCooldown ? `Cooldown ${liveCountdown}` : 'Commit Crew OC'}
        </button>
      ) : (
        <p className="text-[10px] text-zinc-500 font-heading">Only Boss, Underboss, or Capo can commit.</p>
      )}

      {/* Applications — always visible for Boss/Underboss/Capo so they can accept/reject; also when there are any */}
      {(canManageCrewOC || pending.length > 0 || accepted.length > 0) && (
        <div className="space-y-2 pt-2 border-t border-zinc-700/30">
          <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-wider flex items-center gap-1">
            <UserPlus size={12} /> Applications
          </span>
          {accepted.length > 0 && (
            <div className="space-y-1.5">
              <span className="text-[10px] text-zinc-400 font-heading block">In crew (kick from here):</span>
              {accepted.map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-zinc-800/30 border border-zinc-700/30">
                  <Link to={`/profile/${encodeURIComponent(a.username)}`} className="text-xs font-heading text-primary hover:underline">{a.username}</Link>
                  {canManageCrewOC && onKickApp && (
                    <button type="button" onClick={() => onKickApp(a.id)} className="shrink-0 text-[10px] font-bold text-amber-400 hover:text-amber-300 px-2 py-1 rounded border border-amber-500/40 hover:bg-amber-500/10 transition-all">Kick</button>
                  )}
                </div>
              ))}
            </div>
          )}
          {pending.length === 0 && canManageCrewOC && (
            <p className="text-[10px] text-zinc-500 font-heading">No pending applications.</p>
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
// STATE HEAD TAB — profits from being head of state (casinos + dead tax)
// ============================================================================

const STATE_HEAD_INCOME_KEYS = [
  { key: 'dice', label: 'Dice (house edge)' },
  { key: 'roulette', label: 'Roulette (house edge)' },
  { key: 'blackjack', label: 'Blackjack (house edge)' },
  { key: 'horseracing', label: 'Horse Racing (house edge)' },
  { key: 'slots', label: 'Slots (house edge)' },
  { key: 'videopoker', label: 'Video Poker (house edge)' },
  { key: 'dead_alive_tax', label: 'Dead > Alive (0.05% tax)', themeLabel: true },
];

const StateHeadTab = ({ headOfState, stateHeadIncome, stateHeadCasinoWeekStats = {} }) => {
  const income = stateHeadIncome || {};
  const weekStats = stateHeadCasinoWeekStats || {};
  const total = STATE_HEAD_INCOME_KEYS.reduce((sum, { key }) => sum + (Number(income[key]) || 0), 0);
  return (
    <div className="space-y-3">
      <p className="text-[10px] text-zinc-500 font-heading leading-relaxed">
        Your family is <span className="text-primary font-bold">Head of {headOfState}</span>. All house fees (0.05% edge) from casinos in that state and 0.05% of Dead &gt; Alive retrievals there go to the family vault. Breakdown below.
      </p>
      <div className="rounded-lg border border-primary/20 bg-zinc-800/30 overflow-hidden shadow-lg shadow-primary/5 transition-shadow hover:shadow-primary/10">
        <div className="px-3 py-2.5 border-b border-zinc-700/40 bg-primary/8 flex items-center justify-between">
          <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-wider">Profit by source</span>
          <span className="text-[9px] font-heading text-zinc-500 uppercase">This week: wins / losses</span>
        </div>
        <ul className="divide-y divide-zinc-700/40">
          {STATE_HEAD_INCOME_KEYS.map(({ key, label, themeLabel }) => {
            const amount = Number(income[key]) || 0;
            const stats = key !== 'dead_alive_tax' ? (weekStats[key] || { wins: 0, losses: 0 }) : null;
            const hasWeekStats = stats && (stats.wins > 0 || stats.losses > 0);
            return (
              <li
                key={key}
                className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 px-3 py-2.5 transition-colors hover:bg-zinc-700/20 active:bg-zinc-700/30"
              >
                <div className="flex items-center justify-between sm:justify-start gap-2 min-w-0">
                  <span className={`text-xs font-heading shrink-0 ${themeLabel ? 'text-primary' : 'text-foreground'}`}>{label}</span>
                  {hasWeekStats && (
                    <span className="flex items-center gap-2 text-[10px] font-heading text-zinc-400 shrink-0">
                      <span className="flex items-center gap-0.5 text-emerald-400/90">
                        <TrendingUp size={10} /> {stats.wins}
                      </span>
                      <span className="text-zinc-600">/</span>
                      <span className="flex items-center gap-0.5 text-red-400/90">
                        <TrendingDown size={10} /> {stats.losses}
                      </span>
                    </span>
                  )}
                </div>
                <span className="text-xs font-heading font-bold text-primary tabular-nums sm:ml-2">{formatMoneyFull(amount)}</span>
              </li>
            );
          })}
        </ul>
        <div className="flex items-center justify-between px-3 py-2.5 border-t-2 border-primary/30 bg-primary/10">
          <span className="text-xs font-heading font-bold text-primary">Total to vault</span>
          <span className="text-sm font-heading font-bold text-primary tabular-nums">{formatMoneyFull(total)}</span>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// NO FAMILY VIEW — recruitment board
// ============================================================================

const NoFamilyView = ({
  families, config, createName, setCreateName, createTag, setCreateTag, onCreate, joinId, setJoinId, onJoin, joinModeForSelected, warHistory, onDetails,
  emblemPresets, createEmblemPreset, setCreateEmblemPreset, createEmblemDataUrl, setCreateEmblemDataUrl,
}) => {
  const maxFamilies = config?.max_families ?? 6;
  const towardCap = config?.player_cap_families_count ?? 0;
  const atPlayerCap = towardCap >= maxFamilies;
  return (
  <div className="space-y-2">
    <p className="text-center text-[10px] text-zinc-500 font-heading italic py-0.5 fam-fade-in">"In this world, a man without a family is nothing."</p>

    {/* Establish a Crime Family */}
    <div className={`${styles.panel} rounded-xl overflow-hidden border-2 border-primary/25 fam-fade-in mobile-panel`} style={{ animationDelay: '0.1s' }}>
      <div className="px-2.5 sm:px-3 py-2 flex items-center gap-2 bg-primary/10 border-b border-primary/20">
        <Building2 size={14} className="text-primary" />
        <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">Establish a Crime Family</span>
      </div>
      <form onSubmit={onCreate} className="p-2.5 sm:p-3 space-y-2">
        <p className="text-[10px] text-zinc-500 font-heading">Build your empire: recruit soldiers, run rackets, make your name feared.</p>
        <p className="text-[10px] font-heading text-zinc-400">
          Player founded families: <span className="text-primary font-bold tabular-nums">{towardCap}</span> / <span className="text-primary font-bold tabular-nums">{maxFamilies}</span>
          {atPlayerCap && <span className="block mt-1 text-amber-400/90">Family limit reached — join an existing family or wait for a slot.</span>}
        </p>
        {config?.family_create_cost != null && (
          <p className="text-[10px] font-heading text-primary">Cost: {formatMoney(config.family_create_cost)}</p>
        )}
        <div className="flex gap-2">
          <input type="text" value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder="Family name" maxLength={30}
            className="flex-1 bg-zinc-900/80 border border-zinc-600/40 rounded-lg px-3 py-2 text-sm text-foreground font-heading focus:border-primary/50 focus:outline-none transition-colors" />
          <input type="text" value={createTag} onChange={(e) => setCreateTag(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} placeholder="TAG" maxLength={4}
            className="w-20 bg-zinc-900/80 border border-zinc-600/40 rounded-lg px-3 py-2 text-sm text-foreground font-heading uppercase text-center focus:border-primary/50 focus:outline-none transition-colors" />
        </div>
        <div className="space-y-1.5">
          <p className="text-[9px] text-zinc-500 font-heading leading-snug">Crew emblem (optional). Each preset or custom image can only belong to one active family — if taken, pick another.</p>
          <div className="space-y-2">
            {groupFamilyEmblemPresets(emblemPresets || FAMILY_EMBLEM_PRESETS).map(({ group, items }) => (
              <div key={group}>
                <p className="text-[9px] font-heading text-zinc-500 uppercase tracking-wider mb-1">{group}</p>
                <div className="flex flex-wrap gap-1.5">
                  {items.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      title={p.label}
                      onClick={() => {
                        setCreateEmblemPreset((cur) => (cur === p.id ? '' : p.id));
                        setCreateEmblemDataUrl('');
                      }}
                      className={`p-0.5 rounded-full border transition-colors ${createEmblemPreset === p.id ? 'border-primary ring-2 ring-primary/40' : 'border-zinc-600/50 hover:border-primary/40 opacity-90 hover:opacity-100'}`}
                    >
                      <FamilyEmblem emblemPresetId={p.id} size={32} />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <label className="block">
            <span className="text-[9px] font-heading text-zinc-500 uppercase tracking-wider">Or upload custom</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              className="mt-1 block w-full text-[10px] text-zinc-400 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:bg-primary/20 file:text-primary file:font-heading"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                const valid = validateSafeImageFile(file);
                if (!valid.ok) {
                  toast.error(valid.reason);
                  return;
                }
                try {
                  const url = await fileToCompressedDataUrl(file, 160, 0.82);
                  if (!url) {
                    toast.error('Invalid image');
                    return;
                  }
                  setCreateEmblemDataUrl(url);
                  setCreateEmblemPreset('');
                } catch {
                  toast.error('Could not read image');
                }
              }}
            />
          </label>
          {createEmblemDataUrl ? (
            <div className="flex items-center gap-2">
              <FamilyEmblem avatarUrl={createEmblemDataUrl} size={34} />
              <button type="button" onClick={() => setCreateEmblemDataUrl('')} className="text-[9px] font-heading text-zinc-500 hover:text-primary uppercase">Clear upload</button>
            </div>
          ) : null}
        </div>
        <button type="submit" disabled={atPlayerCap} title={atPlayerCap ? 'Maximum player founded families reached' : undefined} className="w-full py-2.5 min-h-[44px] rounded-lg text-xs font-heading font-bold uppercase tracking-wider border-2 bg-gradient-to-b from-primary/30 to-primary/10 border-primary/50 text-primary hover:from-primary/40 hover:shadow-lg hover:shadow-primary/10 transition-all touch-manipulation disabled:opacity-50 disabled:pointer-events-none disabled:cursor-not-allowed">
          Found the Family
        </button>
      </form>
    </div>

    {/* Swear Allegiance */}
    <div className={`${styles.panel} rounded-xl overflow-hidden fam-fade-in mobile-panel`} style={{ animationDelay: '0.2s' }}>
      <div className="px-2.5 sm:px-3 py-2 flex items-center gap-2 border-b border-zinc-700/30">
        <Users size={14} className="text-primary" />
        <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">Swear Allegiance</span>
      </div>
      <form onSubmit={onJoin} className="p-2.5 sm:p-3 space-y-2">
        <p className="text-[10px] text-zinc-500 font-heading">Pledge to a family. Rise from associate to capo — or one day, the Don.</p>
        <div className="flex gap-2">
          <select value={joinId} onChange={(e) => setJoinId(e.target.value)}
            className="flex-1 bg-zinc-900/80 border border-zinc-600/40 rounded-lg px-3 py-2 text-xs text-foreground font-heading focus:border-primary/50 focus:outline-none transition-colors">
            <option value="">Select family...</option>
            {families.filter((f) => f?.id).map((f) => <option key={f.id} value={f.id}>{f.name} [{f.tag}]{f.join_mode === 'approval' ? ' (approval)' : ''}</option>)}
          </select>
          <button type="submit" className="px-4 py-2 min-h-[44px] sm:min-h-0 rounded-lg text-xs font-heading font-bold uppercase border bg-zinc-800/60 border-zinc-600/40 text-zinc-300 hover:border-primary/40 hover:text-primary transition-all touch-manipulation shrink-0">
            {joinModeForSelected === 'approval' ? 'Apply to join' : 'Join'}
          </button>
        </div>
      </form>
    </div>

    {/* Known Families */}
    <div className={`${styles.panel} rounded-xl overflow-hidden fam-fade-in mobile-panel`} style={{ animationDelay: '0.3s' }}>
      <div className="px-2.5 sm:px-3 py-2 flex items-center gap-2 border-b border-zinc-700/30">
        <Building2 size={14} className="text-zinc-400" />
        <span className="text-xs font-heading font-bold text-zinc-400 uppercase tracking-widest">Known Families</span>
      </div>
      <div className="p-2 sm:p-2.5">
        <FamiliesTab families={families} myFamilyId={null} />
      </div>
    </div>

    {/* Vendettas */}
    <div className={`${styles.panel} rounded-xl overflow-hidden fam-fade-in mobile-panel`} style={{ animationDelay: '0.4s' }}>
      <div className="px-2.5 sm:px-3 py-2 flex items-center gap-2 border-b border-zinc-700/30">
        <Swords size={12} className="text-red-400/70" />
        <span className="text-xs font-heading font-bold text-red-400/70 uppercase tracking-widest">Vendettas</span>
      </div>
      <div className="p-2">
        <WarHistoryTab wars={warHistory ?? []} onDetails={onDetails} />
      </div>
    </div>
  </div>
  );
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function FamilyPage() {
  const [families, setFamilies] = useState([]);
  const [myFamily, setMyFamily] = useState(null);
  const [config, setConfig] = useState(null);
  const [activeTab, setActiveTab] = useState('rackets');
  const [createName, setCreateName] = useState('');
  const [createTag, setCreateTag] = useState('');
  const [createEmblemPreset, setCreateEmblemPreset] = useState('');
  const [createEmblemDataUrl, setCreateEmblemDataUrl] = useState('');
  const [joinId, setJoinId] = useState('');
  const [depositAmount, setDepositAmount] = useState('');
  const [depositBullets, setDepositBullets] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawBullets, setWithdrawBullets] = useState('');
  const [giveBulletsUserId, setGiveBulletsUserId] = useState('');
  const [giveBulletsAmount, setGiveBulletsAmount] = useState('');
  const [splitAllBulletsLoading, setSplitAllBulletsLoading] = useState(false);
  const [giveLootUserId, setGiveLootUserId] = useState('');
  const [giveLootAmount, setGiveLootAmount] = useState('');
  const [splitAllLootLoading, setSplitAllLootLoading] = useState(false);
  const [compoundDepositCash, setCompoundDepositCash] = useState('');
  const [compoundDepositPoints, setCompoundDepositPoints] = useState('');
  const [compoundDepositLootPieces, setCompoundDepositLootPieces] = useState('');
  const [compoundWithdrawCash, setCompoundWithdrawCash] = useState('');
  const [compoundWithdrawPoints, setCompoundWithdrawPoints] = useState('');
  const [compoundWithdrawLootPieces, setCompoundWithdrawLootPieces] = useState('');
  const [warStats, setWarStats] = useState(null);
  const [warHistory, setWarHistory] = useState([]);
  const [showWarModal, setShowWarModal] = useState(false);
  const [selectedWarIndex, setSelectedWarIndex] = useState(0);
  const [event, setEvent] = useState(null);
  const [eventsEnabled, setEventsEnabled] = useState(false);
  const [, setTick] = useState(0);
  const [racketAttackTargets, setRacketAttackTargets] = useState([]);
  const [racketAttackLoading, setRacketAttackLoading] = useState(null);
  const [collectAllRacketsLoading, setCollectAllRacketsLoading] = useState(false);
  const [targetsRefreshing, setTargetsRefreshing] = useState(false);
  const [crewOCCommitting, setCrewOCCommitting] = useState(false);
  const [crewOCFeeInput, setCrewOCFeeInput] = useState('');
  const [crewOCSetFeeLoading, setCrewOCSetFeeLoading] = useState(false);
  const [crewOCAdvertiseLoading, setCrewOCAdvertiseLoading] = useState(false);
  const [detailsWarId, setDetailsWarId] = useState(null);
  const [stateTakeoverLoading, setStateTakeoverLoading] = useState(false);
  const [vaultTransactions, setVaultTransactions] = useState([]);
  const [vaultTxTotal, setVaultTxTotal] = useState(0);

  useEffect(() => {
    const cached = getFamiliesPrefetch();
    if (!cached) return;
    setFamilies(cached.families ?? []);
    setMyFamily(cached.myFamily ?? null);
    setConfig(cached.config ?? null);
    setWarHistory(cached.warHistory ?? []);
    setEvent(cached.event ?? null);
    setEventsEnabled(!!cached.eventsEnabled);
    setWarStats(cached.warStats ?? null);
    setRacketAttackTargets(cached.racketAttackTargets ?? []);
    setVaultTransactions(cached.vaultTransactions ?? []);
    setVaultTxTotal(cached.vaultTxTotal ?? 0);
  }, []);

  const family = myFamily?.family;
  const members = myFamily?.members || [];
  const fallen = myFamily?.fallen || [];
  const rackets = myFamily?.rackets || [];
  const myRole = myFamily?.my_role?.toLowerCase() || null;
  const canManage = ['boss', 'underboss'].includes(myRole);
  const canWithdraw = ['boss', 'underboss', 'consigliere'].includes(myRole);
  const canUpgradeRacket = ['boss', 'underboss', 'consigliere'].includes(myRole);
  const vaultAndRacketsLocked = !!myFamily?.vault_and_rackets_locked;
  const canManageCrewOC = ['boss', 'underboss', 'capo'].includes(myRole);
  const activeWars = warStats?.wars ?? [];

  const readyRackets = rackets.filter((r) => r.level > 0 && isRacketReadyAt(r.next_collect_at)).length;
  const unlockedRackets = rackets.filter(r => r.level > 0).length;

  const fetchData = useCallback(async () => {
    try {
      let nextFamilies = [];
      let nextMyFamily = null;
      let nextConfig = null;
      let nextWarHistory = [];
      let nextEvent = null;
      let nextEventsEnabled = false;
      let nextWarStats = null;
      let nextRacketAttackTargets = [];
      let nextVaultTransactions = [];
      let nextVaultTxTotal = 0;

      const [listRes, myRes, configRes, historyRes, eventsRes] = await Promise.allSettled([
        api.get('/families'), api.get('/families/my'), api.get('/families/config').catch(() => ({ data: {} })),
        api.get('/families/wars/history').catch(() => ({ data: { wars: [] } })), api.get('/events/active').catch(() => ({ data: { event: null, events_enabled: false } })),
      ]);
      if (listRes.status === 'fulfilled') {
        nextFamilies = listRes.value?.data || [];
        setFamilies(nextFamilies);
      }
      if (myRes.status === 'fulfilled' && myRes.value?.data) {
        nextMyFamily = myRes.value.data;
        setMyFamily(nextMyFamily);
        if (myRes.value.data?.family) {
          const [statsRes, targetsRes, vaultRes] = await Promise.allSettled([
            api.get('/families/war/stats'),
            api.get('/families/racket-attack-targets', { params: { _: Date.now() } }),
            api.get('/families/vault-transactions', { params: { limit: 50 } }).catch(() => ({ data: { transactions: [], total: 0 } })),
          ]);
          if (statsRes.status === 'fulfilled') {
            nextWarStats = statsRes.value?.data;
            setWarStats(nextWarStats);
          }
          nextRacketAttackTargets = targetsRes.status === 'fulfilled' ? targetsRes.value?.data?.targets ?? [] : [];
          setRacketAttackTargets(nextRacketAttackTargets);
          if (vaultRes.status === 'fulfilled') {
            nextVaultTransactions = vaultRes.value?.data?.transactions ?? [];
            nextVaultTxTotal = vaultRes.value?.data?.total ?? 0;
            setVaultTransactions(nextVaultTransactions);
            setVaultTxTotal(nextVaultTxTotal);
          } else {
            setVaultTransactions([]);
            setVaultTxTotal(0);
          }
        } else {
          nextWarStats = null;
          nextRacketAttackTargets = [];
          nextVaultTransactions = [];
          nextVaultTxTotal = 0;
          setWarStats(null);
          setRacketAttackTargets([]);
          setVaultTransactions([]);
          setVaultTxTotal(0);
        }
      }
      if (configRes.status === 'fulfilled') {
        nextConfig = configRes.value?.data;
        setConfig(nextConfig);
      }
      if (historyRes.status === 'fulfilled') {
        nextWarHistory = historyRes.value?.data?.wars || [];
        setWarHistory(nextWarHistory);
      }
      if (eventsRes.status === 'fulfilled') {
        nextEvent = eventsRes.value?.data?.event ?? null;
        nextEventsEnabled = !!eventsRes.value?.data?.events_enabled;
        setEvent(nextEvent);
        setEventsEnabled(nextEventsEnabled);
      }

      setFamiliesPrefetch({
        families: nextFamilies,
        myFamily: nextMyFamily,
        config: nextConfig,
        warHistory: nextWarHistory,
        event: nextEvent,
        eventsEnabled: nextEventsEnabled,
        warStats: nextWarStats,
        racketAttackTargets: nextRacketAttackTargets,
        vaultTransactions: nextVaultTransactions,
        vaultTxTotal: nextVaultTxTotal,
      });
    } catch (e) { toast.error(apiDetail(e)); }
  }, []);

  const fetchRacketAttackTargets = useCallback(async () => {
    if (!myFamily?.family) return;
    setTargetsRefreshing(true);
    try { const res = await api.get('/families/racket-attack-targets', { params: { _: Date.now() } }); setRacketAttackTargets(res.data?.targets ?? []); }
    catch { setRacketAttackTargets([]); } finally { setTargetsRefreshing(false); }
  }, [myFamily?.family]);

  // Handlers — all preserved exactly
  const handleCreate = async (e) => {
    e.preventDefault();
    const name = createName.trim();
    const tag = createTag.trim().toUpperCase();
    if (!name || !tag) {
      toast.error('Name and tag required');
      return;
    }
    if (createEmblemPreset && createEmblemDataUrl) {
      toast.error('Choose either a preset emblem or a custom upload');
      return;
    }
    const payload = { name, tag };
    if (createEmblemPreset) payload.emblem_preset_id = createEmblemPreset;
    else if (createEmblemDataUrl) payload.emblem_custom_data = createEmblemDataUrl;
    try {
      await api.post('/families', payload);
      toast.success('Family created!');
      setCreateName('');
      setCreateTag('');
      setCreateEmblemPreset('');
      setCreateEmblemDataUrl('');
      refreshUser();
      fetchData();
    } catch (err) {
      toast.error(apiDetail(err));
    }
  };
  const handleJoin = async (e) => {
    e.preventDefault();
    if (!joinId) { toast.error('Select a family'); return; }
    const fam = families.find((f) => f.id === joinId);
    const isApproval = fam?.join_mode === 'approval';
    try {
      if (isApproval) {
        const res = await api.post('/families/apply', { family_id: joinId });
        toast.success(res.data?.auto_accepted ? 'Joined!' : 'Application submitted.');
      } else {
        await api.post('/families/join', { family_id: joinId });
        toast.success('Joined!');
      }
      setJoinId('');
      refreshUser();
      fetchData();
    } catch (e) { toast.error(apiDetail(e)); }
  };
  const handleLeave = async () => { if (!window.confirm('Leave family?')) return; try { const res = await api.post('/families/leave'); if (res.data?.retribution) { toast.warning(`Left family. The family sent a hitman — you were shot and lost ${res.data.health_lost_pct ?? '?'}% health. You survived.`); } else { toast.success('Left'); } refreshUser(); fetchData(); } catch (e) { toast.error(apiDetail(e)); } };
  const handleKick = async (userId) => { if (!window.confirm('Kick?')) return; try { await api.post('/families/kick', { user_id: userId }); toast.success('Kicked'); fetchData(); } catch (e) { toast.error(apiDetail(e)); } };
  const handleAcceptJoinApplication = async (applicationId) => { try { await api.post(`/families/join-applications/${applicationId}/accept`); toast.success('Application accepted'); fetchData(); } catch (e) { toast.error(apiDetail(e)); } };
  const handleDenyJoinApplication = async (applicationId) => { try { await api.post(`/families/join-applications/${applicationId}/deny`); toast.success('Application denied'); fetchData(); } catch (e) { toast.error(apiDetail(e)); } };
  const handleJoinSettingsUpdate = async (payload) => { try { await api.patch('/families/join-settings', payload); toast.success('Join settings updated'); fetchData(); } catch (e) { toast.error(apiDetail(e)); } };
  const handleMeltSettingsUpdate = async (payload) => { try { await api.patch('/families/melt-settings', payload); toast.success('Melt settings updated'); fetchData(); } catch (e) { toast.error(apiDetail(e)); } };
  const handleAirportCrewPerkUpdate = async (airport_crew_perk) => {
    try {
      await api.patch('/families/airport-crew-perk', { airport_crew_perk });
      toast.success('Airport crew perk updated');
      fetchData();
    } catch (e) { toast.error(apiDetail(e)); }
  };
  const handleAssignRole = async (userId, role) => {
    if (role === 'boss' && !window.confirm('Transfer family leadership to this member? You will become Underboss.')) return;
    try { await api.post('/families/assign-role', { user_id: userId, role }); toast.success(role === 'boss' ? 'Leadership transferred.' : `Assigned ${getRoleConfig(role).label}`); refreshUser(); fetchData(); } catch (e) { toast.error(apiDetail(e)); }
  };
  const handleDeposit = async (e) => {
    e.preventDefault();
    const amount = parseInt(String(depositAmount).replace(/\D/g, ''), 10) || 0;
    const bullets = parseInt(String(depositBullets).replace(/\D/g, ''), 10) || 0;
    if (amount === 0 && bullets === 0) return;
    try {
      await api.post('/families/deposit', { amount, bullets });
      toast.success('Deposited');
      setDepositAmount('');
      setDepositBullets('');
      refreshUser();
      fetchData();
    } catch (e) { toast.error(apiDetail(e)); }
  };
  const handleWithdraw = async (e) => {
    e.preventDefault();
    const amount = parseInt(String(withdrawAmount).replace(/\D/g, ''), 10) || 0;
    const bullets = parseInt(String(withdrawBullets).replace(/\D/g, ''), 10) || 0;
    if (amount === 0 && bullets === 0) return;
    try {
      await api.post('/families/withdraw', { amount, bullets });
      toast.success('Withdrew');
      setWithdrawAmount('');
      setWithdrawBullets('');
      refreshUser();
      fetchData();
    } catch (e) { toast.error(apiDetail(e)); }
  };
  const handleGiveBullets = async (e) => {
    e.preventDefault();
    const user_id = String(giveBulletsUserId || '').trim();
    const bullets = parseInt(String(giveBulletsAmount).replace(/\D/g, ''), 10) || 0;
    if (!user_id || bullets <= 0) return;
    try {
      await api.post('/families/bullets/give', { user_id, bullets });
      toast.success('Bullets sent');
      setGiveBulletsAmount('');
      setGiveBulletsUserId('');
      refreshUser();
      fetchData();
    } catch (e) { toast.error(apiDetail(e)); }
  };
  const handleSplitAllBullets = async () => {
    if (splitAllBulletsLoading) return;
    if (!window.confirm('Split ALL vault bullets across all living members? Everyone must get at least one bullet, or the split will be rejected.')) return;
    setSplitAllBulletsLoading(true);
    try {
      const res = await api.post('/families/bullets/split-all');
      toast.success(res?.data?.message || 'Split complete');
      refreshUser();
      fetchData();
    } catch (e) { toast.error(apiDetail(e)); }
    finally { setSplitAllBulletsLoading(false); }
  };
  const handleGiveLoot = async (e) => {
    e.preventDefault();
    const user_id = String(giveLootUserId || '').trim();
    const loot_pieces = parseInt(String(giveLootAmount).replace(/\D/g, ''), 10) || 0;
    if (!user_id || loot_pieces <= 0) return;
    try {
      await api.post('/families/loot/give', { user_id, loot_pieces });
      toast.success('Loot box pieces sent');
      setGiveLootAmount('');
      setGiveLootUserId('');
      refreshUser();
      fetchData();
    } catch (e) { toast.error(apiDetail(e)); }
  };
  const handleSplitAllLoot = async () => {
    if (splitAllLootLoading) return;
    if (!window.confirm('Split ALL vault loot box pieces across all living members? Everyone must get at least one piece, or the split will be rejected.')) return;
    setSplitAllLootLoading(true);
    try {
      const res = await api.post('/families/loot/split-all');
      toast.success(res?.data?.message || 'Split complete');
      refreshUser();
      fetchData();
    } catch (e) { toast.error(apiDetail(e)); }
    finally { setSplitAllLootLoading(false); }
  };
  const handleCompoundDeposit = async (e) => {
    e.preventDefault();
    const cash = parseInt(String(compoundDepositCash).replace(/\D/g, ''), 10) || 0;
    const points = parseInt(String(compoundDepositPoints).replace(/\D/g, ''), 10) || 0;
    const loot_pieces = parseInt(String(compoundDepositLootPieces).replace(/\D/g, ''), 10) || 0;
    if (cash === 0 && points === 0 && loot_pieces === 0) return;
    try {
      await api.post('/families/compound/deposit', { cash, points, loot_pieces });
      toast.success('Deposited to compound');
      setCompoundDepositCash(''); setCompoundDepositPoints(''); setCompoundDepositLootPieces('');
      refreshUser(); fetchData();
    } catch (err) { toast.error(apiDetail(err)); }
  };
  const handleCompoundWithdraw = async (e) => {
    e.preventDefault();
    const cash = parseInt(String(compoundWithdrawCash).replace(/\D/g, ''), 10) || 0;
    const points = parseInt(String(compoundWithdrawPoints).replace(/\D/g, ''), 10) || 0;
    const loot_pieces = parseInt(String(compoundWithdrawLootPieces).replace(/\D/g, ''), 10) || 0;
    if (cash === 0 && points === 0 && loot_pieces === 0) return;
    try {
      await api.post('/families/compound/withdraw', { cash, points, loot_pieces });
      toast.success('Withdrew from compound');
      setCompoundWithdrawCash(''); setCompoundWithdrawPoints(''); setCompoundWithdrawLootPieces('');
      refreshUser(); fetchData();
    } catch (err) { toast.error(apiDetail(err)); }
  };
  const handleCompoundReturnToMember = async (userId) => {
    if (!window.confirm('Return this member\'s compound share?')) return;
    try {
      await api.post('/families/compound/return-to-member', { user_id: userId });
      toast.success('Returned share to member');
      fetchData();
    } catch (err) { toast.error(apiDetail(err)); }
  };
  const handleCompoundClaimForFamily = async (userId) => {
    if (!window.confirm('Keep this member\'s share for the family? They will get nothing back.')) return;
    try {
      await api.post('/families/compound/claim-for-family', { user_id: userId });
      toast.success('Claimed for family');
      fetchData();
    } catch (err) { toast.error(apiDetail(err)); }
  };
  const collectRacket = async (id) => {
    const target = (rackets || []).find((r) => r.id === id);
    if (!target || target.level <= 0 || !isRacketReadyAt(target.next_collect_at)) return;
    try { const res = await api.post(`/families/rackets/${id}/collect`); toast.success(res.data?.message || 'Collected'); fetchData(); } catch (e) { toast.error(apiDetail(e)); }
  };
  const collectAllRackets = async () => {
    const ready = rackets.filter((r) => r.level > 0 && isRacketReadyAt(r.next_collect_at));
    if (ready.length === 0 || collectAllRacketsLoading) return;
    setCollectAllRacketsLoading(true);
    let collected = 0;
    let total = 0;
    try {
      for (const r of ready) {
        try {
          const res = await api.post(`/families/rackets/${r.id}/collect`);
          collected++;
          total += Number(res.data?.amount ?? 0);
        } catch (e) {
          toast.error(apiDetail(e));
        }
      }
      // Keep button disabled until fresh cooldown state is loaded.
      await fetchData();
      if (collected > 0) {
        toast.success(total > 0 ? `Collected ${formatMoneyFull(total)} from ${collected} racket${collected === 1 ? '' : 's'}` : `Collected from ${collected} racket${collected === 1 ? '' : 's'}`);
      }
    } finally {
      setCollectAllRacketsLoading(false);
    }
  };
  const upgradeRacket = async (id) => { try { const res = await api.post(`/families/rackets/${id}/upgrade`); toast.success(res.data?.message || 'Upgraded'); fetchData(); } catch (e) { toast.error(apiDetail(e)); } };
  const unlockRacket = async (id) => { try { const res = await api.post(`/families/rackets/${id}/unlock`); toast.success(res.data?.message || 'Unlocked'); fetchData(); } catch (e) { toast.error(apiDetail(e)); } };
  const attackFamilyRacket = async (familyId, racketId) => {
    setRacketAttackLoading(`${familyId}-${racketId}`);
    try {
      const res = await api.post('/families/attack-racket', { family_id: familyId, racket_id: racketId });
      res.data?.success ? toast.success(res.data?.message || 'Success!') : toast.error(res.data?.message || 'Failed');
      fetchRacketAttackTargets(); fetchData();
    } catch (e) { toast.error(apiDetail(e)); }
    finally { setRacketAttackLoading(null); }
  };
  const handleOfferTruce = async () => { const entry = activeWars[selectedWarIndex]; if (!entry?.war?.id) return; try { await api.post('/families/war/truce/offer', { war_id: entry.war.id }); toast.success('Truce offered'); fetchData(); setShowWarModal(false); } catch (e) { toast.error(apiDetail(e)); } };
  const handleAcceptTruce = async () => { const entry = activeWars[selectedWarIndex]; if (!entry?.war?.id) return; try { await api.post('/families/war/truce/accept', { war_id: entry.war.id }); toast.success('Accepted'); fetchData(); setShowWarModal(false); } catch (e) { toast.error(apiDetail(e)); } };
  const handleStateTakeoverAccept = async () => {
    if (!window.confirm(`Accept takeover of ${family?.pending_state_takeover}? Your current state (${family?.head_of_state}) will become unclaimed.`)) return;
    setStateTakeoverLoading(true);
    try { const res = await api.post('/families/state-takeover/accept'); toast.success(res.data?.message || 'Takeover accepted!'); fetchData(); }
    catch (e) { toast.error(apiDetail(e)); } finally { setStateTakeoverLoading(false); }
  };
  const handleStateTakeoverReject = async () => {
    if (!window.confirm(`Reject takeover of ${family?.pending_state_takeover}? It will remain unclaimed.`)) return;
    setStateTakeoverLoading(true);
    try { const res = await api.post('/families/state-takeover/reject'); toast.success(res.data?.message || 'Takeover rejected'); fetchData(); }
    catch (e) { toast.error(apiDetail(e)); } finally { setStateTakeoverLoading(false); }
  };
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
  const handleCrewOCKick = async (applicationId) => {
    try { await api.post(`/families/crew-oc/applications/${applicationId}/kick`); toast.success('Crew member kicked.'); fetchData(); }
    catch (e) { toast.error(apiDetail(e)); }
  };
  const [crewOCSetAutoAcceptLoading, setCrewOCSetAutoAcceptLoading] = useState(false);
  const handleCrewOCSetAutoAccept = async (autoAccept) => {
    setCrewOCSetAutoAcceptLoading(true);
    try {
      await api.post('/families/crew-oc/set-auto-accept', { auto_accept: autoAccept });
      toast.success(autoAccept ? 'Auto-accept turned on.' : 'Auto-accept turned off.');
      fetchData();
    } catch (e) { toast.error(apiDetail(e)); }
    finally { setCrewOCSetAutoAcceptLoading(false); }
  };

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { const id = setInterval(() => setTick((t) => t + 1), 1000); return () => clearInterval(id); }, []);
  useEffect(() => { if (showWarModal && myFamily?.family) api.get('/families/war/stats').then((res) => setWarStats(res.data)).catch(() => {}); }, [showWarModal, myFamily?.family]);

  return (
    <div className={`space-y-2 sm:space-y-3 ${styles.pageContent} mobile-page-root px-3 sm:px-4 pb-6`} data-testid="families-page">
      <style>{`
        @keyframes ready-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(var(--noir-primary-rgb), 0); }
          50% { box-shadow: 0 0 12px 2px rgba(var(--noir-primary-rgb), 0.15); }
        }
        .animate-ready-pulse { animation: ready-pulse 2s ease-in-out infinite; }
        @keyframes fam-fade-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .fam-fade-in { animation: fam-fade-in 0.5s ease-out both; }
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
      <div className={`relative rounded-xl overflow-hidden fam-fade-in mobile-panel ${family ? `${styles.panel} border-2 border-primary/20` : ''}`}>
        {family && <>
          <div className="h-1 bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
        </>}

        <div className={`${family ? 'px-3 py-3 sm:px-4 sm:py-4' : 'px-2 sm:px-0'}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              {family ? (
                <div className="flex items-start gap-3">
                  <FamilyEmblem emblemPresetId={family.emblem_preset_id} avatarUrl={family.avatar_url} size={46} className="mt-0.5 shrink-0" />
                  <div className="min-w-0">
                  <p className="text-[9px] text-primary/40 font-heading uppercase tracking-[0.3em] mb-1">La Cosa Nostra</p>
                  <h1 className="text-xl sm:text-2xl font-heading font-bold text-primary flex flex-wrap items-center gap-2 tracking-wider uppercase">
                    {family.name}
                    <span className="text-sm text-primary/40 font-mono font-normal">[{family.tag}]</span>
                  </h1>
                  </div>
                </div>
              ) : null}
              {family && (
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <RoleBadge role={myRole} size="lg" />
                  {family.head_of_state && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-heading font-bold bg-primary/15 text-primary border border-primary/30">
                      <MapPin size={9} /> Head of {family.head_of_state}
                    </span>
                  )}
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
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 sm:gap-2">
            <StatCard label="The Vault" value={formatMoney(family.treasury)} icon={<DollarSign size={10} />} accent="text-primary" delay={0} />
            <StatCard label="Made Men" value={`${members.length}${fallen.length > 0 ? ` (+${fallen.length}†)` : ''}`} icon={<Users size={10} />} delay={0.05} />
            <StatCard label="Rackets" value={`${unlockedRackets}/${rackets.length}`} icon={<TrendingUp size={10} />} delay={0.1} />
            <StatCard label="Ready" value={readyRackets} highlight={readyRackets > 0} icon={<Clock size={10} />} delay={0.15} />
          </div>

          {(() => {
            const ph = family.property_holdings ?? { airports: [], armouries: [], casinos: [] };
            const cb = family.crew_bonuses ?? { summary_lines: [], bonus_warnings: [], treasury_bullets_hourly: { active: false }, airport_crew_perk: { active: false } };
            const n = (ph.airports?.length || 0) + (ph.armouries?.length || 0) + (ph.casinos?.length || 0);
            return (
              <div className="rounded-lg border border-primary/15 bg-zinc-900/40 px-3 py-2.5 space-y-2">
                <div className="flex items-center gap-2 text-[9px] font-heading font-bold uppercase tracking-wider text-primary/70">
                  <Building2 size={11} className="text-primary/60 shrink-0" />
                  Territory and perks
                  {n > 0 && <span className="text-zinc-500 font-normal normal-case ml-auto">{n} crew holding{n !== 1 ? 's' : ''}</span>}
                </div>
                <p className="text-[8px] text-zinc-600 leading-snug border-b border-primary/5 pb-2">
                  Each member may hold <span className="text-zinc-400 font-heading font-bold">one</span> airport and <span className="text-zinc-400 font-heading font-bold">one</span> armoury. Hourly vault bullets stack when high command holds both for <span className="text-zinc-500">this family</span> (airport + armoury)—no alt accounts required. Casinos are separate.
                </p>
                {n > 0 ? (
                  <ul className="text-[10px] text-zinc-400 space-y-0.5 max-h-28 overflow-y-auto">
                    {(ph.airports || []).map((a, i) => (
                      <li key={`a-${i}`}><span className="text-primary/80 font-heading">Airport</span> {a.state}{a.slot != null ? ` #${a.slot}` : ''} <span className="text-zinc-600">— {a.owner_username}</span></li>
                    ))}
                    {(ph.armouries || []).map((a, i) => (
                      <li key={`m-${i}`}><span className="text-primary/80 font-heading">Armoury</span> {a.state} <span className="text-zinc-600">— {a.owner_username}</span></li>
                    ))}
                    {(ph.casinos || []).map((c, i) => (
                      <li key={`c-${i}`}><span className="text-primary/80 font-heading">{c.game}</span> {c.city} <span className="text-zinc-600">— {c.owner_username}</span></li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[9px] text-zinc-600">No crew-owned airports, armouries, or casinos yet.</p>
                )}
                {(cb.summary_lines || []).length > 0 || (cb.bonus_warnings || []).length > 0 ? (
                  <div className="pt-1 border-t border-primary/10 space-y-0.5">
                    <p className="text-[9px] font-heading uppercase tracking-wider text-zinc-500 flex items-center gap-1"><Sparkles size={9} /> Bonuses</p>
                    {(cb.bonus_warnings || []).map((line, i) => (
                      <p key={`w-${i}`} className="text-[9px] text-amber-400/90 leading-snug pl-2 border-l border-amber-500/30">{line}</p>
                    ))}
                    {(cb.summary_lines || []).map((line, i) => (
                      <p key={i} className="text-[9px] text-emerald-400/90 leading-snug pl-2 border-l border-emerald-500/30">{line}</p>
                    ))}
                  </div>
                ) : (
                  <p className="text-[9px] text-zinc-600 pt-1 border-t border-primary/10 flex items-start gap-1 leading-snug"><Plane size={10} className="shrink-0 mt-0.5 opacity-50" /> No active vault or airport crew bonuses right now. Hourly vault bullets apply per source when high command owns this family&apos;s airport and/or armoury (both stack for the crew). The Don can pick an airport crew perk when high command holds an airport.</p>
                )}
              </div>
            );
          })()}

          {/* ── State Takeover Offer Banner ── */}
          {family?.pending_state_takeover && canManage && (
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 px-3 py-3 sm:px-4 rounded-lg bg-amber-500/10 border border-amber-500/30 fam-fade-in relative overflow-hidden">
              <div className="absolute left-0 top-0 bottom-0 w-1 bg-amber-500/60" />
              <div className="flex items-start sm:items-center gap-2 flex-wrap">
                <MapPin size={15} className="text-amber-400 shrink-0 mt-0.5 sm:mt-0" />
                <div>
                  <span className="text-xs text-amber-400 font-heading font-bold tracking-wider uppercase block sm:inline">State Conquest!</span>
                  <span className="text-xs text-foreground ml-0 sm:ml-2 block sm:inline">
                    You can take control of <strong className="text-amber-300">{family.pending_state_takeover}</strong>.
                    {family.head_of_state && <span className="text-mutedForeground"> Your current state ({family.head_of_state}) will become unclaimed.</span>}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 ml-5 sm:ml-0 shrink-0">
                <button
                  onClick={handleStateTakeoverAccept}
                  disabled={stateTakeoverLoading}
                  className="px-3 py-1.5 rounded text-[10px] font-heading font-bold uppercase tracking-wide bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 hover:bg-emerald-500/30 transition-all disabled:opacity-50"
                >
                  Accept
                </button>
                <button
                  onClick={handleStateTakeoverReject}
                  disabled={stateTakeoverLoading}
                  className="px-3 py-1.5 rounded text-[10px] font-heading font-bold uppercase tracking-wide bg-zinc-700/50 text-zinc-300 border border-zinc-600/50 hover:bg-zinc-600/50 transition-all disabled:opacity-50"
                >
                  Reject
                </button>
              </div>
            </div>
          )}

          {/* ── War Banner ── */}
          {activeWars.length > 0 && (
            <div className="flex items-center justify-between px-3 py-2 sm:px-4 sm:py-3 rounded-lg bg-red-500/8 border fam-blood-pulse fam-fade-in relative overflow-hidden">
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
          <div className={`${styles.panel} rounded-xl overflow-hidden mobile-panel`}>
            {/* Tab bar — scrollable on mobile */}
            <div className="flex overflow-x-auto overflow-y-hidden scrollbar-hide scroll-smooth border-b border-zinc-700/40 bg-zinc-900/70 snap-x snap-mandatory">
              <Tab active={activeTab === 'rackets'} onClick={() => setActiveTab('rackets')} icon={<TrendingUp size={10} />}>Rackets</Tab>
              <Tab active={activeTab === 'raid'} onClick={() => setActiveTab('raid')} icon={<Swords size={10} />}>Hit Jobs</Tab>
              <Tab
                active={activeTab === 'crewoc'}
                onClick={() => setActiveTab('crewoc')}
                icon={<Crosshair size={10} />}
                subline={<CrewOCNavCountdown isoUntil={family?.crew_oc_cooldown_until} />}
              >
                Crew OC
              </Tab>
              <Tab active={activeTab === 'treasury'} onClick={() => setActiveTab('treasury')} icon={<DollarSign size={10} />}>Vault</Tab>
              {family?.head_of_state && (
                <Tab active={activeTab === 'statehead'} onClick={() => setActiveTab('statehead')} icon={<MapPin size={10} />}>Head of state</Tab>
              )}
              <Tab active={activeTab === 'roster'} onClick={() => setActiveTab('roster')} icon={<Users size={10} />}>Made Men</Tab>
              <Tab active={activeTab === 'families'} onClick={() => { setActiveTab('families'); fetchData(); }} icon={<Building2 size={10} />}>Families</Tab>
              <Tab active={activeTab === 'history'} onClick={() => setActiveTab('history')} icon={<Trophy size={10} />}>Vendettas</Tab>
            </div>

            {/* Tab content */}
            <div className="p-3 sm:p-4">
              {activeTab === 'rackets' && <RacketsTab rackets={rackets} config={config} canUpgrade={canUpgradeRacket} vaultAndRacketsLocked={vaultAndRacketsLocked} onCollect={collectRacket} onCollectAll={collectAllRackets} collectAllLoading={collectAllRacketsLoading} readyCount={readyRackets} onUpgrade={upgradeRacket} onUnlock={unlockRacket} event={event} eventsEnabled={eventsEnabled} />}
              {activeTab === 'crewoc' && (
                <CrewOCTab
                  family={family} myRole={myRole}
                  committerHasTimer={myFamily?.crew_oc_committer_has_timer} crewOCJoinFee={family?.crew_oc_join_fee}
                  crewOCAutoAccept={family?.crew_oc_auto_accept} crewOCForumTopicId={family?.crew_oc_forum_topic_id}
                  crewOCApplications={myFamily?.crew_oc_applications}
                  canManageCrewOC={canManageCrewOC} onCommit={handleCrewOCCommit} committing={crewOCCommitting}
                  feeInput={crewOCFeeInput} setFeeInput={setCrewOCFeeInput} onSetFee={handleCrewOCSetFee}
                  setFeeLoading={crewOCSetFeeLoading} onAdvertise={handleCrewOCAdvertise} advertiseLoading={crewOCAdvertiseLoading}
                  onAcceptApp={handleCrewOCAccept} onRejectApp={handleCrewOCReject} onKickApp={handleCrewOCKick}
                  onSetAutoAccept={handleCrewOCSetAutoAccept} setAutoAcceptLoading={crewOCSetAutoAcceptLoading}
                />
              )}
              {activeTab === 'raid' && (
                <RaidTab targets={racketAttackTargets} loading={racketAttackLoading}
                  onRaid={attackFamilyRacket} onRefresh={fetchRacketAttackTargets} refreshing={targetsRefreshing} />
              )}
              {activeTab === 'treasury' && <TreasuryTab
                treasury={family.treasury}
                treasuryBullets={family.treasury_bullets}
                treasuryPoints={family.treasury_points}
                treasuryLootPieces={family.treasury_loot_pieces}
                meltTreasuryPct={family.melt_treasury_pct}
                meltRewardTiers={family.melt_reward_tiers ?? []}
                members={members}
                canWithdraw={canWithdraw}
                vaultAndRacketsLocked={vaultAndRacketsLocked}
                depositAmount={depositAmount}
                setDepositAmount={setDepositAmount}
                depositBullets={depositBullets}
                setDepositBullets={setDepositBullets}
                withdrawAmount={withdrawAmount}
                setWithdrawAmount={setWithdrawAmount}
                withdrawBullets={withdrawBullets}
                setWithdrawBullets={setWithdrawBullets}
                onDeposit={handleDeposit}
                onWithdraw={handleWithdraw}
                giveBulletsUserId={giveBulletsUserId}
                setGiveBulletsUserId={setGiveBulletsUserId}
                giveBulletsAmount={giveBulletsAmount}
                setGiveBulletsAmount={setGiveBulletsAmount}
                onGiveBullets={handleGiveBullets}
                onSplitAllBullets={handleSplitAllBullets}
                splitAllBulletsLoading={splitAllBulletsLoading}
                giveLootUserId={giveLootUserId}
                setGiveLootUserId={setGiveLootUserId}
                giveLootAmount={giveLootAmount}
                setGiveLootAmount={setGiveLootAmount}
                onGiveLoot={handleGiveLoot}
                onSplitAllLoot={handleSplitAllLoot}
                splitAllLootLoading={splitAllLootLoading}
                compoundCash={family.compound_cash}
                compoundPoints={family.compound_points}
                compoundLootPieces={family.compound_loot_pieces}
                myCompoundCash={myFamily.my_compound_cash}
                myCompoundPoints={myFamily.my_compound_points}
                myCompoundLootPieces={myFamily.my_compound_loot_pieces}
                myCompoundCars={myFamily.my_compound_cars}
                compoundDepositCash={compoundDepositCash}
                setCompoundDepositCash={setCompoundDepositCash}
                compoundDepositPoints={compoundDepositPoints}
                setCompoundDepositPoints={setCompoundDepositPoints}
                compoundDepositLootPieces={compoundDepositLootPieces}
                setCompoundDepositLootPieces={setCompoundDepositLootPieces}
                compoundWithdrawCash={compoundWithdrawCash}
                setCompoundWithdrawCash={setCompoundWithdrawCash}
                compoundWithdrawPoints={compoundWithdrawPoints}
                setCompoundWithdrawPoints={setCompoundWithdrawPoints}
                compoundWithdrawLootPieces={compoundWithdrawLootPieces}
                setCompoundWithdrawLootPieces={setCompoundWithdrawLootPieces}
                onCompoundDeposit={handleCompoundDeposit}
                onCompoundWithdraw={handleCompoundWithdraw}
                returningMembersWithBalance={myFamily.returning_members_with_balance}
                onCompoundReturnToMember={handleCompoundReturnToMember}
                onCompoundClaimForFamily={handleCompoundClaimForFamily}
                vaultTransactions={vaultTransactions}
                vaultTxTotal={vaultTxTotal}
              />}
              {activeTab === 'statehead' && family?.head_of_state && (
                <StateHeadTab headOfState={family.head_of_state} stateHeadIncome={family.state_head_income} stateHeadCasinoWeekStats={myFamily?.state_head_casino_week_stats} />
              )}
              {activeTab === 'roster' && (
                <RosterTab
                  members={members}
                  fallen={fallen}
                  canManage={canManage}
                  myRole={myRole}
                  config={config}
                  onKick={handleKick}
                  onAssignRole={handleAssignRole}
                  joinApplications={myFamily?.join_applications ?? []}
                  joinMode={family?.join_mode}
                  joinAutoAccept={family?.join_auto_accept}
                  joinAutoAcceptRankMin={family?.join_auto_accept_rank_min}
                  meltTreasuryPct={family?.melt_treasury_pct}
                  meltRewardTiers={family?.melt_reward_tiers ?? []}
                  onAcceptJoinApplication={handleAcceptJoinApplication}
                  onDenyJoinApplication={handleDenyJoinApplication}
                  onJoinSettingsUpdate={handleJoinSettingsUpdate}
                  onMeltSettingsUpdate={handleMeltSettingsUpdate}
                  airportCrewPerk={family?.airport_crew_perk ?? 'none'}
                  onAirportCrewPerkUpdate={handleAirportCrewPerkUpdate}
                />
              )}
              {activeTab === 'families' && <FamiliesTab families={families} myFamilyId={family?.id} />}
              {activeTab === 'history' && <WarHistoryTab wars={warHistory} onDetails={setDetailsWarId} />}
            </div>
          </div>
        </>
      ) : (
        <NoFamilyView
          families={families}
          config={config}
          createName={createName}
          setCreateName={setCreateName}
          createTag={createTag}
          setCreateTag={setCreateTag}
          onCreate={handleCreate}
          joinId={joinId}
          setJoinId={setJoinId}
          onJoin={handleJoin}
          joinModeForSelected={families.find((f) => f.id === joinId)?.join_mode}
          warHistory={warHistory}
          onDetails={setDetailsWarId}
          emblemPresets={config?.emblem_presets}
          createEmblemPreset={createEmblemPreset}
          setCreateEmblemPreset={setCreateEmblemPreset}
          createEmblemDataUrl={createEmblemDataUrl}
          setCreateEmblemDataUrl={setCreateEmblemDataUrl}
        />
      )}

      {/* War Details Modal — public, opened from history */}
      {detailsWarId && (
        <WarDetailsModal warId={detailsWarId} onClose={() => setDetailsWarId(null)} />
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
