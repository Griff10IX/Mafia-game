import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Users, Building2, DollarSign, TrendingUp, LogOut, Swords, Trophy, Shield, Skull, X, Crosshair, RefreshCw, Clock } from 'lucide-react';
import api, { refreshUser } from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

// ============================================================================
// CONSTANTS
// ============================================================================

const ROLE_CONFIG = {
  boss: { label: 'Boss', icon: '👑', color: 'text-yellow-400' },
  underboss: { label: 'Underboss', icon: '⭐', color: 'text-purple-400' },
  consigliere: { label: 'Consigliere', icon: '🎭', color: 'text-blue-400' },
  capo: { label: 'Capo', icon: '🎖️', color: 'text-emerald-400' },
  soldier: { label: 'Soldier', icon: '🔫', color: 'text-zinc-300' },
  associate: { label: 'Associate', icon: '👤', color: 'text-zinc-400' },
};

// ============================================================================
// UTILITIES
// ============================================================================

const formatMoney = (n) => {
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
    const s = sec % 60;
    return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`;
  } catch { return null; }
};

const apiDetail = (e) => {
  const d = e.response?.data?.detail;
  return typeof d === 'string' ? d : Array.isArray(d) && d.length ? d.map((x) => x.msg || x.loc?.join('.')).join('; ') : 'Request failed';
};

const getRoleConfig = (role) => ROLE_CONFIG[role?.toLowerCase()] || ROLE_CONFIG.associate;

// ============================================================================
// SUBCOMPONENTS
// ============================================================================

const LoadingSpinner = () => (
  <div className="flex items-center justify-center min-h-[60vh]">
    <div className="text-primary text-xl font-heading font-bold">Loading...</div>
  </div>
);

const PageHeader = ({ family, myRole, onLeave }) => (
  <div className="flex flex-wrap items-end justify-between gap-4">
    <div>
      <h1 className="text-2xl sm:text-3xl font-heading font-bold text-primary mb-1 flex items-center gap-2">
        🏛️ {family ? family.name : 'Mafia Families'}
      </h1>
      <p className="text-xs text-mutedForeground">
        {family ? (
          <>
            <span className="text-primary font-bold">[{family.tag}]</span>
            <span className="mx-2">·</span>
            <span className={getRoleConfig(myRole).color}>{getRoleConfig(myRole).icon} {getRoleConfig(myRole).label}</span>
          </>
        ) : (
          'Run rackets, grow the treasury, dominate the underworld'
        )}
      </p>
    </div>
    {family && (
      <div className="flex items-center gap-3 text-xs font-heading">
        <span className="text-mutedForeground">Treasury: <span className="text-primary font-bold">{formatMoney(family.treasury)}</span></span>
        <button onClick={onLeave} className="text-red-400 hover:text-red-300 flex items-center gap-1">
          <LogOut size={12} /> Leave
        </button>
      </div>
    )}
  </div>
);

const RoleBadge = ({ role }) => {
  const cfg = getRoleConfig(role);
  return <span className={`text-xs font-heading font-bold ${cfg.color}`}>{cfg.icon} {cfg.label}</span>;
};

// ============================================================================
// WAR ALERT
// ============================================================================

const WarAlert = ({ wars, onViewWar }) => {
  if (!wars || wars.length === 0) return null;
  return (
    <div className={`${styles.panel} rounded-md overflow-hidden border-2 border-red-500/40`}>
      <div className="px-3 py-2 bg-red-500/10 border-b border-red-500/30 flex items-center gap-2">
        <Swords size={16} className="text-red-400 animate-pulse" />
        <span className="text-xs font-heading font-bold text-red-400 uppercase tracking-widest">⚔️ Active War{wars.length > 1 ? 's' : ''}</span>
      </div>
      <div className="p-2 space-y-1">
        {wars.map((entry, i) => (
          <button key={entry.war?.id} type="button" onClick={() => onViewWar(i)} className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded bg-red-500/10 border border-red-500/30 hover:border-red-400 transition-all text-left">
            <div className="flex items-center gap-2 min-w-0">
              <Swords size={14} className="text-red-400 shrink-0" />
              <span className="text-sm font-heading font-bold text-foreground truncate">vs {entry.war?.other_family_name} <span className="text-primary">[{entry.war?.other_family_tag}]</span></span>
            </div>
            <span className="text-[10px] text-red-400 font-heading uppercase shrink-0">View →</span>
          </button>
        ))}
      </div>
    </div>
  );
};

// ============================================================================
// TREASURY SECTION
// ============================================================================

const TreasurySection = ({ treasury, canWithdraw, depositAmount, setDepositAmount, withdrawAmount, setWithdrawAmount, onDeposit, onWithdraw }) => (
  <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
    <div className="px-3 py-2 bg-primary/10 border-b border-primary/30 flex items-center justify-between">
      <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest flex items-center gap-2">
        <DollarSign size={14} /> Treasury
      </span>
      <span className="text-sm font-heading font-bold text-primary">{formatMoney(treasury)}</span>
    </div>
    <div className="p-3 space-y-2">
      <form onSubmit={onDeposit} className="flex gap-2">
        <input type="text" placeholder="Amount" value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} className="flex-1 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1.5 text-xs text-foreground focus:border-primary/50 focus:outline-none" />
        <button type="submit" className="bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground rounded px-3 py-1.5 text-[10px] font-bold uppercase border border-yellow-600/50">💰 Deposit</button>
      </form>
      {canWithdraw && (
        <form onSubmit={onWithdraw} className="flex gap-2">
          <input type="text" placeholder="Amount" value={withdrawAmount} onChange={(e) => setWithdrawAmount(e.target.value)} className="flex-1 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1.5 text-xs text-foreground focus:border-primary/50 focus:outline-none" />
          <button type="submit" className="bg-zinc-700/50 text-foreground rounded px-3 py-1.5 text-[10px] font-bold uppercase border border-zinc-600/50">Withdraw</button>
        </form>
      )}
    </div>
  </div>
);

// ============================================================================
// RACKETS SECTION
// ============================================================================

const RacketRow = ({ racket, config, canUpgrade, onCollect, onUpgrade }) => {
  const incomeDisplay = racket.effective_income_per_collect ?? racket.income_per_collect;
  const cooldownDisplay = racket.effective_cooldown_hours ?? racket.cooldown_hours;
  const timeLeft = formatTimeLeft(racket.next_collect_at);
  const onCooldown = timeLeft && timeLeft !== 'Ready';
  const isReady = racket.level > 0 && !onCooldown;
  const maxLevel = config?.racket_max_level ?? 5;

  return (
    <div className={`flex items-center justify-between gap-3 px-3 py-2 rounded-md transition-all ${isReady ? 'bg-zinc-800/50 border border-primary/30' : 'bg-zinc-800/30 border border-transparent'}`}>
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <span className="text-primary/50 text-xs">▸</span>
        <div className="min-w-0">
          <div className="text-sm font-heading font-bold text-foreground truncate">{racket.name}</div>
          <div className="text-[10px] text-mutedForeground truncate">
            Lv.{racket.level}/{maxLevel} · {formatMoney(incomeDisplay)} · {cooldownDisplay}h
          </div>
        </div>
      </div>

      <div className="shrink-0 w-16 text-center">
        {racket.level === 0 ? (
          <span className="text-[10px] text-mutedForeground">Locked</span>
        ) : onCooldown ? (
          <div className="flex items-center justify-center gap-1 text-xs text-mutedForeground font-heading">
            <Clock size={10} className="text-primary" />
            <span>{timeLeft}</span>
          </div>
        ) : (
          <span className="text-[10px] text-primary font-bold">Ready</span>
        )}
      </div>

      <div className="shrink-0 flex gap-1">
        {racket.level > 0 && (
          <button onClick={() => onCollect(racket.id)} disabled={onCooldown} className="bg-gradient-to-b from-primary to-yellow-700 hover:from-yellow-500 hover:to-yellow-600 text-primaryForeground rounded px-2 py-1 text-[10px] font-bold uppercase border border-yellow-600/50 disabled:opacity-50">
            💰
          </button>
        )}
        {canUpgrade && racket.level < maxLevel && (
          <button onClick={() => onUpgrade(racket.id)} className="bg-zinc-700/50 text-foreground rounded px-2 py-1 text-[10px] font-bold uppercase border border-zinc-600/50 hover:border-primary/50">
            {racket.level === 0 ? '🔓' : '⬆️'}
          </button>
        )}
      </div>
    </div>
  );
};

const RacketsSection = ({ rackets, config, canUpgrade, onCollect, onUpgrade, event, eventsEnabled }) => (
  <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
    <div className="px-3 py-2 bg-primary/10 border-b border-primary/30 flex items-center justify-between">
      <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest flex items-center gap-2">
        <TrendingUp size={14} /> Rackets
      </span>
      {config?.racket_upgrade_cost && (
        <span className="text-[10px] text-mutedForeground">Upgrade: {formatMoney(config.racket_upgrade_cost)}</span>
      )}
    </div>
    {eventsEnabled && event && (event.racket_payout !== 1 || event.racket_cooldown !== 1) && event.name && (
      <div className="px-3 py-2 bg-primary/5 border-b border-primary/20">
        <p className="text-xs font-heading"><span className="text-primary font-bold">✨ {event.name}</span> <span className="text-mutedForeground ml-1">{event.message}</span></p>
      </div>
    )}
    <div className="p-2 space-y-1">
      {rackets.map((r) => <RacketRow key={r.id} racket={r} config={config} canUpgrade={canUpgrade} onCollect={onCollect} onUpgrade={onUpgrade} />)}
    </div>
  </div>
);

// ============================================================================
// RAID SECTION
// ============================================================================

const RaidSection = ({ targets, loading, onRaid, onRefresh, refreshing }) => (
  <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
    <div className="px-3 py-2 bg-primary/10 border-b border-primary/30 flex items-center justify-between">
      <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest flex items-center gap-2">
        <Crosshair size={14} /> Raid Enemy Rackets
      </span>
      <button onClick={onRefresh} disabled={refreshing} className="text-primary hover:text-primary/80">
        <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
      </button>
    </div>
    <div className="p-2">
      {targets.length === 0 ? (
        <p className="text-xs text-mutedForeground text-center py-3 font-heading">No enemy rackets to raid</p>
      ) : (
        <div className="space-y-2">
          {targets.map((t) => (
            <div key={t.family_id} className="bg-zinc-800/30 rounded-md border border-zinc-700/50 overflow-hidden">
              <div className="px-3 py-2 flex items-center justify-between gap-2 border-b border-zinc-700/30">
                <div className="min-w-0">
                  <span className="text-sm font-heading font-bold text-foreground">{t.family_name} <span className="text-primary">[{t.family_tag}]</span></span>
                  <span className="text-[10px] text-mutedForeground ml-2">Raids: {t.raids_used ?? 0}/2</span>
                </div>
                <Link to={`/families/${encodeURIComponent(t.family_tag || t.family_id)}`} className="text-[10px] text-primary hover:underline font-heading">View</Link>
              </div>
              <div className="divide-y divide-zinc-700/30">
                {(t.rackets || []).map((r) => {
                  const key = `${t.family_id}-${r.racket_id}`;
                  const canRaid = (t.raids_remaining ?? 2) > 0;
                  return (
                    <div key={r.racket_id} className="flex items-center justify-between gap-2 px-3 py-1.5">
                      <span className="text-xs text-foreground font-heading">{r.racket_name} <span className="text-mutedForeground">Lv.{r.level}</span></span>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-primary font-heading font-bold">{formatMoney(r.potential_take)}</span>
                        <span className="text-[10px] text-mutedForeground">{r.success_chance_pct}%</span>
                        <button onClick={() => onRaid(t.family_id, r.racket_id)} disabled={loading === key || !canRaid} className="bg-primary/20 text-primary border border-primary/40 hover:bg-primary/30 px-2 py-0.5 rounded text-[10px] font-bold uppercase disabled:opacity-50">
                          {loading === key ? '…' : 'Raid'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
    <div className="px-3 py-2 border-t border-primary/10">
      <p className="text-[10px] text-mutedForeground font-heading">Take 25% of one collect from their treasury. 2 raids per crew every 3h.</p>
    </div>
  </div>
);

// ============================================================================
// ROSTER SECTION
// ============================================================================

const RosterSection = ({ members, canManage, myRole, config, onKick, onAssignRole }) => {
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

  return (
    <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
      <div className="px-3 py-2 bg-primary/10 border-b border-primary/30 flex items-center justify-between">
        <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest flex items-center gap-2">
          <Users size={14} /> Roster
        </span>
        <span className="text-[10px] text-mutedForeground font-heading">{members.length} members</span>
      </div>
      <div className="p-2 space-y-1">
        {members.map((m) => (
          <div key={m.user_id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-md bg-zinc-800/30 hover:bg-zinc-800/50">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-8 h-8 rounded bg-gradient-to-br from-primary/30 to-yellow-700/30 border border-primary/30 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                {m.username?.charAt(0)?.toUpperCase() || '?'}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-heading font-bold text-foreground truncate">{m.username}</div>
                <div className="text-[10px] text-mutedForeground">{m.rank_name || 'Unknown'}</div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <RoleBadge role={m.role} />
              {canManage && m.role !== 'boss' && (
                <button onClick={() => onKick(m.user_id)} className="text-red-400 hover:text-red-300 text-[10px] font-heading font-bold">Kick</button>
              )}
            </div>
          </div>
        ))}
      </div>
      {myRole === 'boss' && (
        <form onSubmit={handleAssign} className="px-3 py-2 border-t border-primary/20 flex flex-wrap gap-2">
          <select value={assignRole} onChange={(e) => setAssignRole(e.target.value)} className="bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs text-foreground focus:border-primary/50 focus:outline-none">
            {(config?.roles || []).filter((r) => r !== 'boss').map((role) => <option key={role} value={role}>{getRoleConfig(role).label}</option>)}
          </select>
          <select value={assignUserId} onChange={(e) => setAssignUserId(e.target.value)} className="flex-1 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs text-foreground focus:border-primary/50 focus:outline-none min-w-[120px]">
            <option value="">Select member</option>
            {members.filter((m) => m.role !== 'boss').map((m) => <option key={m.user_id} value={m.user_id}>{m.username}</option>)}
          </select>
          <button type="submit" className="bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground rounded px-3 py-1 text-[10px] font-bold uppercase border border-yellow-600/50">Assign</button>
        </form>
      )}
    </div>
  );
};

// ============================================================================
// ALL FAMILIES SECTION
// ============================================================================

const AllFamiliesSection = ({ families, myFamilyId }) => (
  <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
    <div className="px-3 py-2 bg-primary/10 border-b border-primary/30 flex items-center justify-between">
      <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest flex items-center gap-2">
        <Building2 size={14} /> All Families
      </span>
      <span className="text-[10px] text-mutedForeground font-heading">{families.length} families</span>
    </div>
    {families.length === 0 ? (
      <p className="text-xs text-mutedForeground text-center py-4 font-heading">No families yet</p>
    ) : (
      <div className="p-2 space-y-1">
        {families.map((f) => (
          <Link key={f.id} to={`/families/${encodeURIComponent(f.tag || f.id)}`} className={`flex items-center justify-between gap-2 px-3 py-2 rounded-md transition-all ${myFamilyId === f.id ? 'bg-primary/10 border border-primary/30' : 'bg-zinc-800/30 border border-transparent hover:border-primary/20'}`}>
            <div className="flex items-center gap-2 min-w-0">
              <Building2 size={14} className="text-primary shrink-0" />
              <span className="text-sm font-heading font-bold text-foreground truncate">{f.name}</span>
              <span className="text-xs text-primary font-mono">[{f.tag}]</span>
              {myFamilyId === f.id && <span className="text-[10px] text-primary font-bold">(You)</span>}
            </div>
            <div className="flex items-center gap-3 text-xs shrink-0">
              <span className="text-mutedForeground">{f.member_count} <span className="hidden sm:inline">members</span></span>
              <span className="text-primary font-bold">{formatMoney(f.treasury)}</span>
            </div>
          </Link>
        ))}
      </div>
    )}
  </div>
);

// ============================================================================
// WAR HISTORY SECTION
// ============================================================================

const WarHistorySection = ({ wars }) => (
  <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
    <div className="px-3 py-2 bg-primary/10 border-b border-primary/30 flex items-center justify-between">
      <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest flex items-center gap-2">
        <Trophy size={14} /> War History
      </span>
      <span className="text-[10px] text-mutedForeground font-heading">{wars.length} wars</span>
    </div>
    {wars.length === 0 ? (
      <p className="text-xs text-mutedForeground text-center py-4 font-heading italic">No war history yet</p>
    ) : (
      <div className="p-2 space-y-1">
        {wars.map((w) => {
          const isActive = w.status === 'active' || w.status === 'truce_offered';
          const isTruce = w.status === 'truce';
          const hasWinner = w.status === 'family_a_wins' || w.status === 'family_b_wins';
          return (
            <div key={w.id} className={`flex items-center justify-between gap-2 px-3 py-2 rounded-md ${isActive ? 'bg-red-500/10 border border-red-500/30' : 'bg-zinc-800/30 border border-transparent'}`}>
              <div className="min-w-0">
                <div className="text-xs font-heading font-bold text-foreground truncate">
                  {w.family_a_name} <span className="text-primary">[{w.family_a_tag}]</span>
                  <span className="text-mutedForeground mx-1">vs</span>
                  {w.family_b_name} <span className="text-primary">[{w.family_b_tag}]</span>
                </div>
                {hasWinner && <div className="text-[10px] text-emerald-400 font-heading">🏆 {w.winner_family_name} won</div>}
              </div>
              <div className="shrink-0">
                {isActive && <span className="text-[10px] font-bold text-red-400 uppercase animate-pulse">Active</span>}
                {isTruce && <span className="text-[10px] font-bold text-amber-400 uppercase">Truce</span>}
                {hasWinner && <span className="text-[10px] text-mutedForeground">{w.ended_at ? new Date(w.ended_at).toLocaleDateString() : ''}</span>}
              </div>
            </div>
          );
        })}
      </div>
    )}
  </div>
);

// ============================================================================
// CREATE/JOIN FAMILY SECTIONS
// ============================================================================

const CreateFamilySection = ({ createName, setCreateName, createTag, setCreateTag, onCreate, config }) => (
  <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
    <div className="px-3 py-2 bg-primary/10 border-b border-primary/30">
      <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">🏛️ Create A Family</span>
    </div>
    <form onSubmit={onCreate} className="p-3 space-y-3">
      <div className="flex flex-wrap gap-2">
        <div className="flex-1 min-w-[150px]">
          <label className="block text-[10px] text-mutedForeground mb-1 font-heading uppercase">Name (2-30)</label>
          <input type="text" value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder="Five Families" maxLength={30} className="w-full bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1.5 text-xs text-foreground focus:border-primary/50 focus:outline-none" />
        </div>
        <div className="w-20">
          <label className="block text-[10px] text-mutedForeground mb-1 font-heading uppercase">Tag (2-4)</label>
          <input type="text" value={createTag} onChange={(e) => setCreateTag(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} placeholder="FF" maxLength={4} className="w-full bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1.5 text-xs text-foreground uppercase focus:border-primary/50 focus:outline-none" />
        </div>
      </div>
      <div className="flex items-center justify-between">
        <p className="text-[10px] text-mutedForeground font-heading">Max {config?.max_families ?? 10} families. You become Boss.</p>
        <button type="submit" className="bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground rounded px-3 py-1.5 text-[10px] font-bold uppercase border border-yellow-600/50">Create</button>
      </div>
    </form>
  </div>
);

const JoinFamilySection = ({ families, joinId, setJoinId, onJoin }) => (
  <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
    <div className="px-3 py-2 bg-primary/10 border-b border-primary/30">
      <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">🤝 Join A Family</span>
    </div>
    <form onSubmit={onJoin} className="p-3 flex gap-2">
      <select value={joinId} onChange={(e) => setJoinId(e.target.value)} className="flex-1 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1.5 text-xs text-foreground focus:border-primary/50 focus:outline-none">
        <option value="">Choose a family...</option>
        {families.map((f) => <option key={f.id} value={f.id}>{f.name} [{f.tag}] — {f.member_count} members</option>)}
      </select>
      <button type="submit" className="bg-zinc-700/50 text-foreground rounded px-3 py-1.5 text-[10px] font-bold uppercase border border-zinc-600/50">Join</button>
    </form>
  </div>
);

// ============================================================================
// WAR MODAL
// ============================================================================

const WarModal = ({ war, stats, family, canManage, onClose, onOfferTruce, onAcceptTruce }) => {
  if (!war) return null;

  const StatTable = ({ title, icon, rows, valueKey, valueColor }) => (
    <div className="bg-zinc-800/30 rounded-md border border-zinc-700/50 overflow-hidden">
      <div className="px-3 py-2 bg-zinc-800/50 border-b border-zinc-700/30 flex items-center gap-2">
        {icon}
        <span className="text-xs font-heading font-bold text-primary uppercase">{title}</span>
      </div>
      {(!rows || rows.length === 0) ? (
        <div className="px-3 py-4 text-center text-xs text-mutedForeground italic">No data yet</div>
      ) : (
        <div className="divide-y divide-zinc-700/30">
          {rows.map((e, i) => (
            <div key={e.user_id} className="flex items-center justify-between px-3 py-1.5 hover:bg-zinc-800/30">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[10px] text-mutedForeground w-4">{i + 1}</span>
                <span className="text-xs font-heading font-bold text-foreground truncate">{e.username}</span>
                <span className="text-[10px] text-mutedForeground truncate hidden sm:block">[{e.family_tag}]</span>
              </div>
              <span className={`text-xs font-heading font-bold ${valueColor}`}>{e[valueKey]}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <div className={`${styles.panel} border border-red-500/30 rounded-md max-w-lg w-full max-h-[90vh] overflow-y-auto shadow-2xl`} onClick={(e) => e.stopPropagation()}>
        <div className="px-3 py-2 bg-red-500/10 border-b border-red-500/30 flex items-center justify-between">
          <span className="text-xs font-heading font-bold text-red-400 uppercase flex items-center gap-2">
            <Swords size={14} /> War: vs {war.other_family_name} [{war.other_family_tag}]
          </span>
          <button onClick={onClose} className="text-mutedForeground hover:text-foreground"><X size={16} /></button>
        </div>
        <div className="p-3 space-y-3">
          {war.status === 'truce_offered' && (
            <div className="text-xs text-primary bg-primary/10 border border-primary/30 rounded px-2 py-1.5 font-heading">
              ✋ A truce has been offered
            </div>
          )}
          {stats && (
            <>
              <StatTable title="BG Kills" icon={<Shield size={12} className="text-primary" />} rows={stats.top_bodyguard_killers} valueKey="bodyguard_kills" valueColor="text-primary" />
              <StatTable title="BGs Lost" icon={<Skull size={12} className="text-red-400" />} rows={stats.top_bodyguards_lost} valueKey="bodyguards_lost" valueColor="text-red-400" />
              <StatTable title="MVP" icon={<Trophy size={12} className="text-primary" />} rows={stats.mvp} valueKey="impact" valueColor="text-primary" />
            </>
          )}
          {canManage && (
            <div className="flex flex-wrap gap-2 pt-2 border-t border-zinc-700/30">
              {war.status === 'active' && (
                <button onClick={onOfferTruce} className="bg-zinc-700/50 text-foreground rounded px-3 py-1.5 text-[10px] font-bold uppercase border border-zinc-600/50">🤝 Offer Truce</button>
              )}
              {war.status === 'truce_offered' && war.truce_offered_by_family_id !== family?.id && (
                <button onClick={onAcceptTruce} className="bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground rounded px-3 py-1.5 text-[10px] font-bold uppercase border border-yellow-600/50">✓ Accept</button>
              )}
            </div>
          )}
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
  const [loading, setLoading] = useState(true);
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
  const [targetsRefreshing, setTargetsRefreshing] = useState(false);

  const family = myFamily?.family;
  const members = myFamily?.members || [];
  const rackets = myFamily?.rackets || [];
  const myRole = myFamily?.my_role?.toLowerCase() || null;
  const canManage = ['boss', 'underboss'].includes(myRole);
  const canWithdraw = ['boss', 'underboss', 'consigliere'].includes(myRole);
  const canUpgradeRacket = ['boss', 'underboss', 'consigliere'].includes(myRole);
  const activeWars = warStats?.wars ?? [];

  // API CALLS
  const fetchData = useCallback(async () => {
    try {
      const [listRes, myRes, configRes, historyRes, eventsRes] = await Promise.allSettled([
        api.get('/families'),
        api.get('/families/my'),
        api.get('/families/config').catch(() => ({ data: {} })),
        api.get('/families/wars/history').catch(() => ({ data: { wars: [] } })),
        api.get('/events/active').catch(() => ({ data: { event: null, events_enabled: false } })),
      ]);
      if (listRes.status === 'fulfilled') setFamilies(listRes.value?.data || []);
      if (myRes.status === 'fulfilled' && myRes.value?.data) {
        setMyFamily(myRes.value.data);
        if (myRes.value.data?.family) {
          const [statsRes, targetsRes] = await Promise.allSettled([
            api.get('/families/war/stats'),
            api.get('/families/racket-attack-targets', { params: { _: Date.now() } })
          ]);
          if (statsRes.status === 'fulfilled') setWarStats(statsRes.value?.data);
          setRacketAttackTargets(targetsRes.status === 'fulfilled' ? targetsRes.value?.data?.targets ?? [] : []);
        } else {
          setWarStats(null);
          setRacketAttackTargets([]);
        }
      }
      if (configRes.status === 'fulfilled') setConfig(configRes.value?.data);
      if (historyRes.status === 'fulfilled') setWarHistory(historyRes.value?.data?.wars || []);
      if (eventsRes.status === 'fulfilled') {
        setEvent(eventsRes.value?.data?.event ?? null);
        setEventsEnabled(!!eventsRes.value?.data?.events_enabled);
      }
    } catch (e) {
      toast.error(apiDetail(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchRacketAttackTargets = useCallback(async () => {
    if (!myFamily?.family) return;
    setTargetsRefreshing(true);
    try {
      const res = await api.get('/families/racket-attack-targets', { params: { _: Date.now() } });
      setRacketAttackTargets(res.data?.targets ?? []);
    } catch {
      setRacketAttackTargets([]);
    } finally {
      setTargetsRefreshing(false);
    }
  }, [myFamily?.family]);

  // HANDLERS
  const handleCreate = async (e) => {
    e.preventDefault();
    const name = createName.trim(), tag = createTag.trim().toUpperCase();
    if (!name || !tag) { toast.error('Name and tag required'); return; }
    try {
      await api.post('/families', { name, tag });
      toast.success('Family created!');
      setCreateName(''); setCreateTag('');
      refreshUser(); fetchData();
    } catch (e) {
      const d = apiDetail(e);
      if (d.toLowerCase().includes('already in a family')) { toast.info('Already in a family'); fetchData(); }
      else toast.error(d);
    }
  };

  const handleJoin = async (e) => {
    e.preventDefault();
    if (!joinId) { toast.error('Select a family'); return; }
    try {
      await api.post('/families/join', { family_id: joinId });
      toast.success('Joined family!');
      setJoinId('');
      refreshUser(); fetchData();
    } catch (e) {
      const d = apiDetail(e);
      if (d.toLowerCase().includes('already in a family')) { toast.info('Already in a family'); fetchData(); }
      else toast.error(d);
    }
  };

  const handleLeave = async () => {
    if (!window.confirm('Leave this family?')) return;
    try {
      await api.post('/families/leave');
      toast.success('Left family');
      refreshUser(); fetchData();
    } catch (e) { toast.error(apiDetail(e)); }
  };

  const handleKick = async (userId) => {
    if (!window.confirm('Kick this member?')) return;
    try {
      await api.post('/families/kick', { user_id: userId });
      toast.success('Kicked');
      fetchData();
    } catch (e) { toast.error(apiDetail(e)); }
  };

  const handleAssignRole = async (userId, role) => {
    try {
      await api.post('/families/assign-role', { user_id: userId, role });
      toast.success(`Role set to ${getRoleConfig(role).label}`);
      fetchData();
    } catch (e) { toast.error(apiDetail(e)); }
  };

  const handleDeposit = async (e) => {
    e.preventDefault();
    const amount = parseInt(depositAmount.replace(/\D/g, ''), 10);
    if (!amount) { toast.error('Enter amount'); return; }
    try {
      await api.post('/families/deposit', { amount });
      toast.success('Deposited');
      setDepositAmount('');
      refreshUser(); fetchData();
    } catch (e) { toast.error(apiDetail(e)); }
  };

  const handleWithdraw = async (e) => {
    e.preventDefault();
    const amount = parseInt(withdrawAmount.replace(/\D/g, ''), 10);
    if (!amount) { toast.error('Enter amount'); return; }
    try {
      await api.post('/families/withdraw', { amount });
      toast.success('Withdrew');
      setWithdrawAmount('');
      refreshUser(); fetchData();
    } catch (e) { toast.error(apiDetail(e)); }
  };

  const collectRacket = async (id) => {
    try {
      const res = await api.post(`/families/rackets/${id}/collect`);
      toast.success(res.data?.message || 'Collected');
      fetchData();
    } catch (e) { toast.error(apiDetail(e)); }
  };

  const upgradeRacket = async (id) => {
    try {
      const res = await api.post(`/families/rackets/${id}/upgrade`);
      toast.success(res.data?.message || 'Upgraded');
      fetchData();
    } catch (e) { toast.error(apiDetail(e)); }
  };

  const attackFamilyRacket = async (familyId, racketId) => {
    setRacketAttackLoading(`${familyId}-${racketId}`);
    try {
      const res = await api.post('/families/attack-racket', { family_id: familyId, racket_id: racketId });
      res.data?.success ? toast.success(res.data?.message || 'Success!') : toast.error(res.data?.message || 'Failed');
      fetchRacketAttackTargets();
      fetchData();
    } catch (e) { toast.error(apiDetail(e)); }
    finally { setRacketAttackLoading(null); }
  };

  const handleOfferTruce = async () => {
    const entry = activeWars[selectedWarIndex];
    if (!entry?.war?.id) return;
    try {
      await api.post('/families/war/truce/offer', { war_id: entry.war.id });
      toast.success('Truce offered');
      fetchData();
      setShowWarModal(false);
    } catch (e) { toast.error(apiDetail(e)); }
  };

  const handleAcceptTruce = async () => {
    const entry = activeWars[selectedWarIndex];
    if (!entry?.war?.id) return;
    try {
      await api.post('/families/war/truce/accept', { war_id: entry.war.id });
      toast.success('Truce accepted');
      fetchData();
      setShowWarModal(false);
    } catch (e) { toast.error(apiDetail(e)); }
  };

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { const id = setInterval(() => setTick((t) => t + 1), 1000); return () => clearInterval(id); }, []);
  useEffect(() => { if (showWarModal && myFamily?.family) api.get('/families/war/stats').then((res) => setWarStats(res.data)).catch(() => {}); }, [showWarModal, myFamily?.family]);

  if (loading) return <LoadingSpinner />;

  return (
    <div className={`space-y-4 ${styles.pageContent}`} data-testid="families-page">
      <PageHeader family={family} myRole={myRole} onLeave={handleLeave} />

      {family ? (
        <>
          <WarAlert wars={activeWars} onViewWar={(i) => { setSelectedWarIndex(i); setShowWarModal(true); }} />

          <TreasurySection
            treasury={family.treasury}
            canWithdraw={canWithdraw}
            depositAmount={depositAmount}
            setDepositAmount={setDepositAmount}
            withdrawAmount={withdrawAmount}
            setWithdrawAmount={setWithdrawAmount}
            onDeposit={handleDeposit}
            onWithdraw={handleWithdraw}
          />

          <RacketsSection
            rackets={rackets}
            config={config}
            canUpgrade={canUpgradeRacket}
            onCollect={collectRacket}
            onUpgrade={upgradeRacket}
            event={event}
            eventsEnabled={eventsEnabled}
          />

          <RaidSection
            targets={racketAttackTargets}
            loading={racketAttackLoading}
            onRaid={attackFamilyRacket}
            onRefresh={fetchRacketAttackTargets}
            refreshing={targetsRefreshing}
          />

          <RosterSection
            members={members}
            canManage={canManage}
            myRole={myRole}
            config={config}
            onKick={handleKick}
            onAssignRole={handleAssignRole}
          />
        </>
      ) : (
        <>
          <CreateFamilySection
            createName={createName}
            setCreateName={setCreateName}
            createTag={createTag}
            setCreateTag={setCreateTag}
            onCreate={handleCreate}
            config={config}
          />

          <JoinFamilySection
            families={families}
            joinId={joinId}
            setJoinId={setJoinId}
            onJoin={handleJoin}
          />
        </>
      )}

      <AllFamiliesSection families={families} myFamilyId={family?.id} />

      <WarHistorySection wars={warHistory} />

      {showWarModal && activeWars[selectedWarIndex] && (
        <WarModal
          war={activeWars[selectedWarIndex].war}
          stats={activeWars[selectedWarIndex].stats}
          family={family}
          canManage={canManage}
          onClose={() => setShowWarModal(false)}
          onOfferTruce={handleOfferTruce}
          onAcceptTruce={handleAcceptTruce}
        />
      )}
    </div>
  );
}
