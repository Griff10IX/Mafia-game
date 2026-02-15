import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Users, Building2, DollarSign, TrendingUp, LogOut, Swords, Trophy, Shield, Skull, X, Crosshair, RefreshCw, Clock, ChevronRight } from 'lucide-react';
import api, { refreshUser } from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

// ============================================================================
// CONSTANTS & UTILITIES
// ============================================================================

const ROLE_CONFIG = {
  boss: { label: 'Boss', icon: '👑', color: 'text-yellow-400', bg: 'bg-yellow-500/20' },
  underboss: { label: 'Underboss', icon: '⭐', color: 'text-purple-400', bg: 'bg-purple-500/20' },
  consigliere: { label: 'Consigliere', icon: '🎭', color: 'text-blue-400', bg: 'bg-blue-500/20' },
  capo: { label: 'Capo', icon: '🎖️', color: 'text-emerald-400', bg: 'bg-emerald-500/20' },
  soldier: { label: 'Soldier', icon: '🔫', color: 'text-zinc-300', bg: 'bg-zinc-500/20' },
  associate: { label: 'Associate', icon: '👤', color: 'text-zinc-400', bg: 'bg-zinc-500/20' },
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

const apiDetail = (e) => {
  const d = e.response?.data?.detail;
  return typeof d === 'string' ? d : Array.isArray(d) && d.length ? d.map((x) => x.msg || x.loc?.join('.')).join('; ') : 'Request failed';
};

const getRoleConfig = (role) => ROLE_CONFIG[role?.toLowerCase()] || ROLE_CONFIG.associate;

// ============================================================================
// STAT CARD
// ============================================================================

const StatCard = ({ label, value, highlight, icon }) => (
  <div className={`p-2.5 rounded-md border ${highlight ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-zinc-800/30 border-zinc-700/30'}`}>
    <div className="flex items-center gap-1.5 text-[9px] text-mutedForeground uppercase tracking-wider mb-0.5">
      {icon}
      {label}
    </div>
    <div className={`text-lg font-heading font-bold ${highlight ? 'text-emerald-400' : 'text-foreground'}`}>{value}</div>
  </div>
);

// ============================================================================
// TAB BUTTON
// ============================================================================

const Tab = ({ active, onClick, children }) => (
  <button
    onClick={onClick}
    className={`flex-1 px-2 py-2 text-[10px] font-heading font-bold uppercase tracking-wider transition-all border-b-2 ${
      active
        ? 'text-primary border-primary bg-primary/5'
        : 'text-mutedForeground border-transparent hover:text-foreground'
    }`}
  >
    {children}
  </button>
);

// ============================================================================
// RACKET CARD
// ============================================================================

const RacketCard = ({ racket, maxLevel, canUpgrade, onCollect, onUpgrade, onUnlock }) => {
  const timeLeft = formatTimeLeft(racket.next_collect_at);
  const onCooldown = timeLeft && timeLeft !== 'Ready';
  const isReady = racket.level > 0 && !onCooldown;
  const income = racket.effective_income_per_collect ?? racket.income_per_collect;
  const locked = racket.locked || racket.level <= 0;
  const isMax = racket.level >= maxLevel;

  return (
    <div className={`p-3 rounded-md border transition-all ${
      locked ? 'bg-zinc-800/20 border-zinc-700/30 border-dashed opacity-60' :
      isReady ? 'bg-zinc-800/30 border-emerald-500/30' : 'bg-zinc-800/30 border-zinc-700/30'
    }`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <span className={`text-[10px] font-bold ${isReady ? 'text-emerald-400' : locked ? 'text-zinc-500' : 'text-mutedForeground'}`}>
          {locked ? '🔒 LOCKED' : isReady ? '● READY' : onCooldown ? `⏱ ${timeLeft}` : ''}
        </span>
        <span className="text-[10px] text-mutedForeground">{isMax ? 'MAX' : `L${racket.level}`}</span>
      </div>

      {/* Name */}
      <h3 className={`font-heading font-bold text-sm mb-2 ${locked ? 'text-zinc-400' : 'text-foreground'}`}>{racket.name}</h3>

      {/* Level Bar */}
      <div className="flex gap-0.5 mb-2">
        {[...Array(maxLevel)].map((_, i) => (
          <div key={i} className={`flex-1 h-1.5 rounded-full ${i < racket.level ? 'bg-primary' : 'bg-zinc-700'}`} />
        ))}
      </div>

      {/* Requirement */}
      {locked && racket.required_racket_name && (
        <p className="text-[9px] text-mutedForeground mb-2">Requires {racket.required_racket_name} at max</p>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between">
        <span className={`font-heading font-bold ${locked ? 'text-zinc-500' : 'text-primary'}`}>
          {locked ? '—' : formatMoney(income)}
        </span>
        <div className="flex gap-1">
          {racket.level > 0 && (
            <button
              onClick={() => onCollect(racket.id)}
              disabled={onCooldown}
              className="bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground px-2.5 py-1 rounded text-[10px] font-bold border border-yellow-600/50 disabled:opacity-40 transition-all"
            >
              Collect
            </button>
          )}
          {canUpgrade && locked && racket.can_unlock && (
            <button
              onClick={() => onUnlock(racket.id)}
              className="bg-emerald-500/20 text-emerald-400 px-2.5 py-1 rounded text-[10px] font-bold border border-emerald-500/50 transition-all"
            >
              Unlock
            </button>
          )}
          {canUpgrade && !locked && racket.level < maxLevel && (
            <button
              onClick={() => onUpgrade(racket.id)}
              className="bg-zinc-700/50 text-foreground px-2 py-1 rounded text-[10px] font-bold border border-zinc-600/50 transition-all"
            >
              ⬆️
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// TREASURY TAB
// ============================================================================

const TreasuryTab = ({ treasury, canWithdraw, depositAmount, setDepositAmount, withdrawAmount, setWithdrawAmount, onDeposit, onWithdraw }) => (
  <div className="space-y-3">
    <div className="text-center py-4 bg-zinc-800/30 rounded-md border border-zinc-700/30">
      <p className="text-[10px] text-mutedForeground uppercase tracking-wider mb-1">Family Treasury</p>
      <p className="text-3xl font-heading font-bold text-primary">{formatMoneyFull(treasury)}</p>
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      <form onSubmit={onDeposit} className="flex gap-1">
        <input type="text" inputMode="numeric" placeholder="Amount" value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} className="flex-1 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1.5 text-xs text-foreground focus:border-primary/50 focus:outline-none min-w-0" />
        <button type="submit" className="bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground rounded px-3 py-1.5 text-[10px] font-bold uppercase border border-yellow-600/50 shrink-0">Deposit</button>
      </form>
      {canWithdraw && (
        <form onSubmit={onWithdraw} className="flex gap-1">
          <input type="text" inputMode="numeric" placeholder="Amount" value={withdrawAmount} onChange={(e) => setWithdrawAmount(e.target.value)} className="flex-1 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1.5 text-xs text-foreground focus:border-primary/50 focus:outline-none min-w-0" />
          <button type="submit" className="bg-zinc-700/50 text-foreground rounded px-3 py-1.5 text-[10px] font-bold uppercase border border-zinc-600/50 shrink-0">Withdraw</button>
        </form>
      )}
    </div>
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
        <div className="text-[10px] px-3 py-2 bg-primary/10 rounded-md border border-primary/20 flex items-center gap-2">
          <span className="text-primary font-bold">✨ {event.name}</span>
          <span className="text-mutedForeground">{event.message}</span>
        </div>
      )}

      {/* Racket Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {rackets.map((r) => (
          <RacketCard
            key={r.id}
            racket={r}
            maxLevel={maxLevel}
            canUpgrade={canUpgrade}
            onCollect={onCollect}
            onUpgrade={onUpgrade}
            onUnlock={onUnlock}
          />
        ))}
      </div>

      {/* Footer Stats */}
      <div className="flex items-center justify-between text-[10px] text-mutedForeground px-1 pt-2 border-t border-zinc-700/30">
        {config?.racket_unlock_cost && <span>Unlock: {formatMoney(config.racket_unlock_cost)}</span>}
        {config?.racket_upgrade_cost && <span>Upgrade: {formatMoney(config.racket_upgrade_cost)}</span>}
      </div>
    </div>
  );
};

// ============================================================================
// RAID TAB
// ============================================================================

const RaidTab = ({ targets, loading, onRaid, onRefresh, refreshing }) => (
  <div className="space-y-2">
    <div className="flex items-center justify-between px-1">
      <span className="text-[10px] text-mutedForeground">Take 25% treasury · 2 raids/family/3h</span>
      <button onClick={onRefresh} disabled={refreshing} className="text-primary hover:text-primary/80 p-1">
        <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
      </button>
    </div>
    
    {targets.length === 0 ? (
      <div className="text-center py-8 bg-zinc-800/20 rounded-md border border-zinc-700/30">
        <Crosshair size={24} className="mx-auto text-zinc-600 mb-2" />
        <p className="text-xs text-mutedForeground">No targets available</p>
      </div>
    ) : (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-72 overflow-y-auto">
        {targets.map((t) => {
          const raidsLeft = t.raids_remaining ?? 2;
          const canRaid = raidsLeft > 0;
          return (
            <div key={t.family_id} className={`p-3 rounded-md border ${canRaid ? 'bg-zinc-800/30 border-red-500/30' : 'bg-zinc-800/20 border-zinc-700/30 opacity-50'}`}>
              <div className="flex items-center justify-between mb-2">
                <div>
                  <span className="font-heading font-bold text-foreground text-sm">{t.family_name}</span>
                  <span className="text-primary text-[10px] ml-1">[{t.family_tag}]</span>
                </div>
                <span className={`text-[10px] font-bold ${canRaid ? 'text-emerald-400' : 'text-red-400'}`}>{raidsLeft}/2</span>
              </div>
              <div className="space-y-1">
                {(t.rackets || []).slice(0, 3).map((r) => {
                  const key = `${t.family_id}-${r.racket_id}`;
                  const isLoading = loading === key;
                  return (
                    <div key={key} className="flex items-center justify-between text-[11px] px-2 py-1.5 bg-zinc-900/50 rounded">
                      <div>
                        <span className="text-foreground">{r.racket_name}</span>
                        <span className="text-mutedForeground ml-1">L{r.level}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-primary font-bold">{formatMoney(r.potential_take)}</span>
                        <button 
                          onClick={() => onRaid(t.family_id, r.racket_id)} 
                          disabled={isLoading || !canRaid}
                          className={`px-2 py-0.5 rounded text-[9px] font-bold ${canRaid ? 'bg-red-600 text-white' : 'bg-zinc-700 text-zinc-500'}`}
                        >
                          {isLoading ? '...' : '⚔️'}
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
// ROSTER TAB
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

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-56 overflow-y-auto">
        {members.map((m) => {
          const cfg = getRoleConfig(m.role);
          return (
            <div key={m.user_id} className="flex items-center justify-between px-3 py-2 bg-zinc-800/30 rounded-md border border-zinc-700/30">
              <div>
                <span className="font-heading font-bold text-foreground text-xs block">{m.username}</span>
                <span className={`text-[10px] ${cfg.color}`}>{cfg.icon} {cfg.label}</span>
              </div>
              {canManage && m.role !== 'boss' && (
                <button onClick={() => onKick(m.user_id)} className="text-red-400 hover:text-red-300 text-[9px] font-bold px-2 py-1">Kick</button>
              )}
            </div>
          );
        })}
      </div>
      
      {myRole === 'boss' && (
        <form onSubmit={handleAssign} className="flex flex-wrap gap-1 pt-2 border-t border-zinc-700/30">
          <select value={assignRole} onChange={(e) => setAssignRole(e.target.value)} className="bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-[10px] text-foreground focus:border-primary/50 focus:outline-none">
            {(config?.roles || []).filter((r) => r !== 'boss').map((role) => <option key={role} value={role}>{getRoleConfig(role).label}</option>)}
          </select>
          <select value={assignUserId} onChange={(e) => setAssignUserId(e.target.value)} className="flex-1 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-[10px] text-foreground focus:border-primary/50 focus:outline-none min-w-[80px]">
            <option value="">Member...</option>
            {members.filter((m) => m.role !== 'boss').map((m) => <option key={m.user_id} value={m.user_id}>{m.username}</option>)}
          </select>
          <button type="submit" className="bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground rounded px-2 py-1 text-[9px] font-bold uppercase border border-yellow-600/50">Assign</button>
        </form>
      )}
    </div>
  );
};

// ============================================================================
// ALL FAMILIES TAB
// ============================================================================

const FamiliesTab = ({ families, myFamilyId }) => (
  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-64 overflow-y-auto">
    {families.length === 0 ? (
      <p className="text-xs text-mutedForeground text-center py-4 col-span-2">No families yet</p>
    ) : families.map((f) => (
      <Link 
        key={f.id} 
        to={`/families/${encodeURIComponent(f.tag || f.id)}`} 
        className={`flex items-center justify-between px-3 py-2 rounded-md border transition-colors ${myFamilyId === f.id ? 'bg-primary/10 border-primary/30' : 'bg-zinc-800/30 border-zinc-700/30 hover:border-primary/30'}`}
      >
        <div>
          <span className="font-heading font-bold text-foreground text-xs">{f.name}</span>
          <span className="text-primary text-[10px] ml-1">[{f.tag}]</span>
          {myFamilyId === f.id && <span className="text-[9px] text-primary ml-1">(You)</span>}
        </div>
        <div className="flex items-center gap-2 text-[10px]">
          <span className="text-mutedForeground">{f.member_count} 👥</span>
          <span className="text-primary font-bold">{formatMoney(f.treasury)}</span>
          <ChevronRight size={12} className="text-mutedForeground" />
        </div>
      </Link>
    ))}
  </div>
);

// ============================================================================
// WAR HISTORY TAB
// ============================================================================

const WarHistoryTab = ({ wars }) => (
  <div className="space-y-2 max-h-64 overflow-y-auto">
    {wars.length === 0 ? (
      <p className="text-xs text-mutedForeground text-center py-8 italic">No war history</p>
    ) : wars.map((w) => {
      const isActive = w.status === 'active' || w.status === 'truce_offered';
      const hasWinner = w.status === 'family_a_wins' || w.status === 'family_b_wins';
      return (
        <div key={w.id} className={`px-3 py-2 rounded-md border ${isActive ? 'bg-red-500/10 border-red-500/30' : 'bg-zinc-800/30 border-zinc-700/30'}`}>
          <div className="flex items-center justify-between">
            <div className="text-xs">
              <span className="text-foreground font-bold">{w.family_a_name}</span>
              <span className="text-mutedForeground mx-1">vs</span>
              <span className="text-foreground font-bold">{w.family_b_name}</span>
            </div>
            {isActive && <span className="text-red-400 text-[10px] font-bold animate-pulse">⚔️ ACTIVE</span>}
            {hasWinner && <span className="text-emerald-400 text-[10px]">🏆 {w.winner_family_name}</span>}
          </div>
          <div className="text-[9px] text-mutedForeground mt-0.5">
            {w.ended_at ? new Date(w.ended_at).toLocaleDateString() : 'Ongoing'}
          </div>
        </div>
      );
    })}
  </div>
);

// ============================================================================
// WAR MODAL
// ============================================================================

const WarModal = ({ war, stats, family, canManage, onClose, onOfferTruce, onAcceptTruce }) => {
  if (!war) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <div className={`${styles.panel} border border-red-500/30 rounded-md w-full max-w-sm shadow-2xl`} onClick={(e) => e.stopPropagation()}>
        <div className="px-3 py-2 bg-red-500/10 border-b border-red-500/30 flex items-center justify-between">
          <span className="text-xs font-heading font-bold text-red-400 uppercase flex items-center gap-1">
            <Swords size={12} /> War: {war.other_family_name}
          </span>
          <button onClick={onClose} className="text-mutedForeground hover:text-foreground"><X size={14} /></button>
        </div>
        <div className="p-3 space-y-3">
          {war.status === 'truce_offered' && (
            <div className="text-[10px] text-primary bg-primary/10 border border-primary/30 rounded px-2 py-1">✋ Truce offered</div>
          )}
          
          {stats && (
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="p-2 bg-zinc-800/30 rounded-md border border-zinc-700/30">
                <Shield size={14} className="mx-auto text-primary mb-1" />
                <div className="text-[9px] text-mutedForeground">BG Kills</div>
                {stats.top_bodyguard_killers?.[0] && (
                  <div className="text-[10px] text-foreground font-bold truncate">{stats.top_bodyguard_killers[0].username}: {stats.top_bodyguard_killers[0].bodyguard_kills}</div>
                )}
              </div>
              <div className="p-2 bg-zinc-800/30 rounded-md border border-zinc-700/30">
                <Skull size={14} className="mx-auto text-red-400 mb-1" />
                <div className="text-[9px] text-mutedForeground">BGs Lost</div>
                {stats.top_bodyguards_lost?.[0] && (
                  <div className="text-[10px] text-foreground font-bold truncate">{stats.top_bodyguards_lost[0].username}: {stats.top_bodyguards_lost[0].bodyguards_lost}</div>
                )}
              </div>
              <div className="p-2 bg-zinc-800/30 rounded-md border border-zinc-700/30">
                <Trophy size={14} className="mx-auto text-yellow-400 mb-1" />
                <div className="text-[9px] text-mutedForeground">MVP</div>
                {stats.mvp?.[0] && (
                  <div className="text-[10px] text-foreground font-bold truncate">{stats.mvp[0].username}</div>
                )}
              </div>
            </div>
          )}
          
          {canManage && (
            <div className="flex gap-2 pt-2 border-t border-zinc-700/30">
              {war.status === 'active' && (
                <button onClick={onOfferTruce} className="flex-1 bg-zinc-700/50 text-foreground rounded px-2 py-1.5 text-[10px] font-bold uppercase border border-zinc-600/50">🤝 Offer Truce</button>
              )}
              {war.status === 'truce_offered' && war.truce_offered_by_family_id !== family?.id && (
                <button onClick={onAcceptTruce} className="flex-1 bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground rounded px-2 py-1.5 text-[10px] font-bold uppercase border border-yellow-600/50">✓ Accept Truce</button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// NO FAMILY VIEW
// ============================================================================

const NoFamilyView = ({ families, createName, setCreateName, createTag, setCreateTag, onCreate, joinId, setJoinId, onJoin }) => (
  <div className="space-y-3">
    {/* Create */}
    <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
      <div className="px-3 py-2 bg-primary/10 border-b border-primary/30">
        <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">🏛️ Create Family</span>
      </div>
      <form onSubmit={onCreate} className="p-3 space-y-2">
        <div className="flex gap-2">
          <input type="text" value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder="Family name" maxLength={30} className="flex-1 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1.5 text-xs text-foreground focus:border-primary/50 focus:outline-none" />
          <input type="text" value={createTag} onChange={(e) => setCreateTag(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} placeholder="TAG" maxLength={4} className="w-16 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1.5 text-xs text-foreground uppercase text-center focus:border-primary/50 focus:outline-none" />
        </div>
        <button type="submit" className="w-full bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground rounded px-3 py-2 text-xs font-heading font-bold uppercase border border-yellow-600/50">Create Family</button>
      </form>
    </div>

    {/* Join */}
    <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
      <div className="px-3 py-2 bg-primary/10 border-b border-primary/30">
        <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">🤝 Join Family</span>
      </div>
      <form onSubmit={onJoin} className="p-3 flex gap-2">
        <select value={joinId} onChange={(e) => setJoinId(e.target.value)} className="flex-1 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1.5 text-xs text-foreground focus:border-primary/50 focus:outline-none">
          <option value="">Select family...</option>
          {families.map((f) => <option key={f.id} value={f.id}>{f.name} [{f.tag}]</option>)}
        </select>
        <button type="submit" className="bg-zinc-700/50 text-foreground rounded px-4 py-1.5 text-xs font-bold uppercase border border-zinc-600/50">Join</button>
      </form>
    </div>

    {/* All Families */}
    <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
      <div className="px-3 py-2 bg-primary/10 border-b border-primary/30">
        <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">📋 All Families</span>
      </div>
      <div className="p-2">
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
  const [targetsRefreshing, setTargetsRefreshing] = useState(false);

  const family = myFamily?.family;
  const members = myFamily?.members || [];
  const rackets = myFamily?.rackets || [];
  const myRole = myFamily?.my_role?.toLowerCase() || null;
  const canManage = ['boss', 'underboss'].includes(myRole);
  const canWithdraw = ['boss', 'underboss', 'consigliere'].includes(myRole);
  const canUpgradeRacket = ['boss', 'underboss', 'consigliere'].includes(myRole);
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

  // Handlers
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
  const attackFamilyRacket = async (familyId, racketId) => { setRacketAttackLoading(`${familyId}-${racketId}`); try { const res = await api.post('/families/attack-racket', { family_id: familyId, racket_id: racketId }); res.data?.success ? toast.success(res.data?.message || 'Success!') : toast.error(res.data?.message || 'Failed'); fetchRacketAttackTargets(); fetchData(); } catch (e) { toast.error(apiDetail(e)); } finally { setRacketAttackLoading(null); } };
  const handleOfferTruce = async () => { const entry = activeWars[selectedWarIndex]; if (!entry?.war?.id) return; try { await api.post('/families/war/truce/offer', { war_id: entry.war.id }); toast.success('Truce offered'); fetchData(); setShowWarModal(false); } catch (e) { toast.error(apiDetail(e)); } };
  const handleAcceptTruce = async () => { const entry = activeWars[selectedWarIndex]; if (!entry?.war?.id) return; try { await api.post('/families/war/truce/accept', { war_id: entry.war.id }); toast.success('Accepted'); fetchData(); setShowWarModal(false); } catch (e) { toast.error(apiDetail(e)); } };

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { const id = setInterval(() => setTick((t) => t + 1), 1000); return () => clearInterval(id); }, []);
  useEffect(() => { if (showWarModal && myFamily?.family) api.get('/families/war/stats').then((res) => setWarStats(res.data)).catch(() => {}); }, [showWarModal, myFamily?.family]);

  if (loading) return <div className="flex items-center justify-center min-h-[60vh]"><div className="text-primary text-sm font-heading">Loading...</div></div>;

  return (
    <div className={`space-y-3 ${styles.pageContent}`} data-testid="families-page">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl sm:text-2xl font-heading font-bold text-primary flex items-center gap-2">
            🏛️ {family ? family.name : 'Families'}
            {family && <span className="text-sm text-primary/60 font-mono">[{family.tag}]</span>}
          </h1>
          {family && (
            <div className="flex items-center gap-2 mt-1">
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${getRoleConfig(myRole).bg} ${getRoleConfig(myRole).color}`}>
                {getRoleConfig(myRole).icon} {getRoleConfig(myRole).label}
              </span>
              {activeWars.length > 0 && (
                <button onClick={() => { setSelectedWarIndex(0); setShowWarModal(true); }} className="text-red-400 text-[10px] font-bold animate-pulse">
                  ⚔️ At War
                </button>
              )}
            </div>
          )}
        </div>
        {family && (
          <button onClick={handleLeave} className="text-red-400 hover:text-red-300 text-[10px] flex items-center gap-0.5">
            <LogOut size={10} /> Leave
          </button>
        )}
      </div>

      {family ? (
        <>
          {/* Stats Cards */}
          <div className="grid grid-cols-4 gap-2">
            <StatCard label="Treasury" value={formatMoney(family.treasury)} icon={<DollarSign size={10} />} />
            <StatCard label="Members" value={members.length} icon={<Users size={10} />} />
            <StatCard label="Rackets" value={`${unlockedRackets}/${rackets.length}`} icon={<TrendingUp size={10} />} />
            <StatCard label="Ready" value={readyRackets} highlight={readyRackets > 0} icon={<Clock size={10} />} />
          </div>

          {/* War Banner */}
          {activeWars.length > 0 && (
            <div className="flex items-center justify-between px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-md">
              <div className="flex items-center gap-2">
                <Swords size={14} className="text-red-400 animate-pulse" />
                <span className="text-xs text-red-400 font-bold">At War:</span>
                {activeWars.map((entry, i) => (
                  <button key={entry.war?.id} onClick={() => { setSelectedWarIndex(i); setShowWarModal(true); }} className="text-xs text-foreground hover:text-primary">
                    vs {entry.war?.other_family_name} <span className="text-primary">[{entry.war?.other_family_tag}]</span>
                  </button>
                ))}
              </div>
              <button onClick={() => { setSelectedWarIndex(0); setShowWarModal(true); }} className="text-[10px] text-mutedForeground hover:text-foreground">View →</button>
            </div>
          )}

          {/* Tabbed Content */}
          <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
            <div className="flex border-b border-primary/20 bg-zinc-900/30">
              <Tab active={activeTab === 'rackets'} onClick={() => setActiveTab('rackets')}>💰 Rackets</Tab>
              <Tab active={activeTab === 'raid'} onClick={() => setActiveTab('raid')}>⚔️ Raid</Tab>
              <Tab active={activeTab === 'treasury'} onClick={() => setActiveTab('treasury')}>💵 Treasury</Tab>
              <Tab active={activeTab === 'roster'} onClick={() => setActiveTab('roster')}>👥 Roster</Tab>
              <Tab active={activeTab === 'families'} onClick={() => setActiveTab('families')}>🏛️ All</Tab>
              <Tab active={activeTab === 'history'} onClick={() => setActiveTab('history')}>🏆 Wars</Tab>
            </div>
            <div className="p-3">
              {activeTab === 'rackets' && <RacketsTab rackets={rackets} config={config} canUpgrade={canUpgradeRacket} onCollect={collectRacket} onUpgrade={upgradeRacket} onUnlock={unlockRacket} event={event} eventsEnabled={eventsEnabled} />}
              {activeTab === 'raid' && <RaidTab targets={racketAttackTargets} loading={racketAttackLoading} onRaid={attackFamilyRacket} onRefresh={fetchRacketAttackTargets} refreshing={targetsRefreshing} />}
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
