import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Users, Building2, DollarSign, TrendingUp, LogOut, Swords, Trophy, Shield, Skull, X, Crosshair, RefreshCw, Clock } from 'lucide-react';
import api, { refreshUser } from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

// ============================================================================
// CONSTANTS & UTILITIES
// ============================================================================

const ROLE_CONFIG = {
  boss: { label: 'Boss', icon: '👑', color: 'text-yellow-400' },
  underboss: { label: 'Underboss', icon: '⭐', color: 'text-purple-400' },
  consigliere: { label: 'Consigliere', icon: '🎭', color: 'text-blue-400' },
  capo: { label: 'Capo', icon: '🎖️', color: 'text-emerald-400' },
  soldier: { label: 'Soldier', icon: '🔫', color: 'text-zinc-300' },
  associate: { label: 'Associate', icon: '👤', color: 'text-zinc-400' },
};

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
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  } catch { return null; }
};

const apiDetail = (e) => {
  const d = e.response?.data?.detail;
  return typeof d === 'string' ? d : Array.isArray(d) && d.length ? d.map((x) => x.msg || x.loc?.join('.')).join('; ') : 'Request failed';
};

const getRoleConfig = (role) => ROLE_CONFIG[role?.toLowerCase()] || ROLE_CONFIG.associate;

// ============================================================================
// TAB BUTTON
// ============================================================================

const Tab = ({ active, onClick, children, badge }) => (
  <button
    onClick={onClick}
    className={`px-3 py-1.5 text-xs font-heading font-bold uppercase tracking-wider transition-all border-b-2 ${
      active
        ? 'text-primary border-primary bg-primary/5'
        : 'text-mutedForeground border-transparent hover:text-foreground hover:border-primary/30'
    }`}
  >
    {children}
    {badge > 0 && <span className="ml-1.5 px-1.5 py-0.5 text-[9px] rounded bg-red-500/80 text-white">{badge}</span>}
  </button>
);

// ============================================================================
// TREASURY TAB
// ============================================================================

const TreasuryTab = ({ treasury, canWithdraw, depositAmount, setDepositAmount, withdrawAmount, setWithdrawAmount, onDeposit, onWithdraw }) => (
  <div className="space-y-3">
    <div className="flex items-center justify-between px-1">
      <span className="text-xs text-mutedForeground">Current Balance</span>
      <span className="text-lg font-heading font-bold text-primary">{formatMoney(treasury)}</span>
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      <form onSubmit={onDeposit} className="flex gap-1">
        <input type="text" placeholder="Amount" value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} className="flex-1 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs text-foreground focus:border-primary/50 focus:outline-none min-w-0" />
        <button type="submit" className="bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground rounded px-2 py-1 text-[10px] font-bold uppercase border border-yellow-600/50 shrink-0">Deposit</button>
      </form>
      {canWithdraw && (
        <form onSubmit={onWithdraw} className="flex gap-1">
          <input type="text" placeholder="Amount" value={withdrawAmount} onChange={(e) => setWithdrawAmount(e.target.value)} className="flex-1 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs text-foreground focus:border-primary/50 focus:outline-none min-w-0" />
          <button type="submit" className="bg-zinc-700/50 text-foreground rounded px-2 py-1 text-[10px] font-bold uppercase border border-zinc-600/50 shrink-0">Withdraw</button>
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
  const readyCount = rackets.filter(r => r.level > 0 && (!formatTimeLeft(r.next_collect_at) || formatTimeLeft(r.next_collect_at) === 'Ready')).length;

  return (
    <div className="space-y-2">
      {eventsEnabled && event && (event.racket_payout !== 1 || event.racket_cooldown !== 1) && event.name && (
        <div className="text-xs font-heading px-2 py-1 bg-primary/10 rounded border border-primary/20">
          <span className="text-primary font-bold">✨ {event.name}</span> <span className="text-mutedForeground">{event.message}</span>
        </div>
      )}
      <p className="text-[10px] text-mutedForeground px-1">Unlock one racket at a time — fully upgrade the previous racket first (passive income).</p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] text-mutedForeground uppercase border-b border-zinc-700/50">
              <th className="text-left py-1 px-2 font-heading">Racket</th>
              <th className="text-center py-1 px-2 font-heading w-16">Level</th>
              <th className="text-right py-1 px-2 font-heading w-20">Income</th>
              <th className="text-center py-1 px-2 font-heading w-16">Timer</th>
              <th className="text-right py-1 px-2 font-heading w-24">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/50">
            {rackets.map((r) => {
              const timeLeft = formatTimeLeft(r.next_collect_at);
              const onCooldown = timeLeft && timeLeft !== 'Ready';
              const isReady = r.level > 0 && !onCooldown;
              const income = r.effective_income_per_collect ?? r.income_per_collect;
              const locked = r.locked || r.level <= 0;
              return (
                <tr key={r.id} className={isReady ? 'bg-primary/5' : locked ? 'opacity-70' : ''}>
                  <td className="py-1.5 px-2 font-heading font-bold text-foreground">
                    {r.name}
                    {locked && r.required_racket_name && (
                      <div className="text-[9px] text-mutedForeground font-normal">Requires {r.required_racket_name} at max</div>
                    )}
                  </td>
                  <td className="py-1.5 px-2 text-center text-mutedForeground">{r.level}/{maxLevel}</td>
                  <td className="py-1.5 px-2 text-right text-primary font-bold">{locked ? '—' : formatMoney(income)}</td>
                  <td className="py-1.5 px-2 text-center">
                    {r.level === 0 ? <span className="text-zinc-500">Locked</span> : onCooldown ? (
                      <span className="text-mutedForeground flex items-center justify-center gap-0.5"><Clock size={10} />{timeLeft}</span>
                    ) : <span className="text-emerald-400 font-bold">Ready</span>}
                  </td>
                  <td className="py-1.5 px-2 text-right">
                    <div className="flex justify-end gap-1">
                      {r.level > 0 && <button onClick={() => onCollect(r.id)} disabled={onCooldown} className="bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground rounded px-1.5 py-0.5 text-[9px] font-bold uppercase border border-yellow-600/50 disabled:opacity-40">💰</button>}
                      {canUpgrade && locked && r.can_unlock && <button onClick={() => onUnlock(r.id)} className="bg-primary/20 text-primary rounded px-1.5 py-0.5 text-[9px] font-bold uppercase border border-primary/50" title={r.unlock_cost ? `Unlock: ${formatMoney(r.unlock_cost)}` : ''}>🔓 Unlock</button>}
                      {canUpgrade && !locked && r.level < maxLevel && <button onClick={() => onUpgrade(r.id)} className="bg-zinc-700/50 text-foreground rounded px-1.5 py-0.5 text-[9px] font-bold uppercase border border-zinc-600/50">⬆️</button>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="text-[10px] text-mutedForeground px-1">
        {readyCount > 0 && <span className="text-emerald-400 font-bold">{readyCount} ready</span>}
        {config?.racket_unlock_cost && <span className="ml-2">Unlock next: {formatMoney(config.racket_unlock_cost)}</span>}
        {config?.racket_upgrade_cost && <span className="ml-2">Upgrade: {formatMoney(config.racket_upgrade_cost)}</span>}
      </div>
    </div>
  );
};

// ============================================================================
// RAID TAB
// ============================================================================

const RaidTab = ({ targets, loading, onRaid, onRefresh, refreshing }) => (
  <div className="space-y-3">
    <div className="flex items-center justify-between">
      <span className="text-[10px] text-mutedForeground">Take 25% of treasury · 2 raids per family / 3h</span>
      <button onClick={onRefresh} disabled={refreshing} className="text-primary hover:text-primary/80 p-1"><RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} /></button>
    </div>
    
    {targets.length === 0 ? (
      <div className="text-center py-8">
        <Crosshair size={24} className="mx-auto text-zinc-600 mb-2" />
        <p className="text-xs text-mutedForeground">No enemy rackets available</p>
      </div>
    ) : (
      <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
        {targets.map((t) => {
          const raidsLeft = (t.raids_remaining ?? 2);
          const canRaid = raidsLeft > 0;
          return (
            <div key={t.family_id} className={`rounded border ${canRaid ? 'border-primary/30 bg-zinc-900/50' : 'border-zinc-700/30 bg-zinc-900/30 opacity-60'}`}>
              {/* Family Header */}
              <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-700/30">
                <div className="flex items-center gap-2">
                  <span className="font-heading font-bold text-foreground">{t.family_name}</span>
                  <span className="text-primary text-[10px] font-mono">[{t.family_tag}]</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-heading ${canRaid ? 'text-emerald-400' : 'text-red-400'}`}>
                    {raidsLeft}/2 raids
                  </span>
                </div>
              </div>
              
              {/* Rackets Grid */}
              <div className="p-2 grid gap-1.5">
                {(t.rackets || []).map((r) => {
                  const key = `${t.family_id}-${r.racket_id}`;
                  const isLoading = loading === key;
                  return (
                    <div key={key} className="flex items-center justify-between gap-2 px-2 py-1.5 bg-zinc-800/40 rounded hover:bg-zinc-800/60 transition-colors">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-xs text-foreground font-medium truncate">{r.racket_name}</span>
                        <span className="text-[10px] text-zinc-500 shrink-0">L{r.level}</span>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <div className="text-right">
                          <div className="text-xs text-primary font-bold">{formatMoney(r.potential_take)}</div>
                          <div className="text-[9px] text-mutedForeground">{r.success_chance_pct}% chance</div>
                        </div>
                        <button 
                          onClick={() => onRaid(t.family_id, r.racket_id)} 
                          disabled={isLoading || !canRaid}
                          className={`w-14 py-1.5 rounded text-[10px] font-bold uppercase transition-all ${
                            canRaid 
                              ? 'bg-gradient-to-b from-red-600 to-red-800 text-white border border-red-500/50 hover:from-red-500 hover:to-red-700 shadow-lg shadow-red-900/20' 
                              : 'bg-zinc-700/30 text-zinc-500 border border-zinc-600/30 cursor-not-allowed'
                          }`}
                        >
                          {isLoading ? '...' : '⚔️ Raid'}
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
      <div className="overflow-x-auto max-h-48 overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-card">
            <tr className="text-[10px] text-mutedForeground uppercase border-b border-zinc-700/50">
              <th className="text-left py-1 px-2 font-heading">Member</th>
              <th className="text-left py-1 px-2 font-heading">Role</th>
              <th className="text-left py-1 px-2 font-heading">Rank</th>
              {canManage && <th className="text-right py-1 px-2 font-heading w-12"></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/30">
            {members.map((m) => {
              const cfg = getRoleConfig(m.role);
              return (
                <tr key={m.user_id} className="hover:bg-zinc-800/30">
                  <td className="py-1.5 px-2 font-heading font-bold text-foreground">{m.username}</td>
                  <td className="py-1.5 px-2"><span className={`${cfg.color} text-[10px] font-bold`}>{cfg.icon} {cfg.label}</span></td>
                  <td className="py-1.5 px-2 text-mutedForeground">{m.rank_name || '—'}</td>
                  {canManage && (
                    <td className="py-1.5 px-2 text-right">
                      {m.role !== 'boss' && <button onClick={() => onKick(m.user_id)} className="text-red-400 hover:text-red-300 text-[9px] font-bold">Kick</button>}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {myRole === 'boss' && (
        <form onSubmit={handleAssign} className="flex flex-wrap gap-1 pt-2 border-t border-zinc-700/30">
          <select value={assignRole} onChange={(e) => setAssignRole(e.target.value)} className="bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-[10px] text-foreground focus:border-primary/50 focus:outline-none">
            {(config?.roles || []).filter((r) => r !== 'boss').map((role) => <option key={role} value={role}>{getRoleConfig(role).label}</option>)}
          </select>
          <select value={assignUserId} onChange={(e) => setAssignUserId(e.target.value)} className="flex-1 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-[10px] text-foreground focus:border-primary/50 focus:outline-none min-w-[100px]">
            <option value="">Select member</option>
            {members.filter((m) => m.role !== 'boss').map((m) => <option key={m.user_id} value={m.user_id}>{m.username}</option>)}
          </select>
          <button type="submit" className="bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground rounded px-2 py-1 text-[9px] font-bold uppercase border border-yellow-600/50">Assign</button>
        </form>
      )}
    </div>
  );
};

// ============================================================================
// FAMILIES TAB
// ============================================================================

const FamiliesTab = ({ families, myFamilyId }) => (
  <div className="overflow-x-auto max-h-64 overflow-y-auto">
    {families.length === 0 ? (
      <p className="text-xs text-mutedForeground text-center py-4">No families yet</p>
    ) : (
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-card">
          <tr className="text-[10px] text-mutedForeground uppercase border-b border-zinc-700/50">
            <th className="text-left py-1 px-2 font-heading">Name</th>
            <th className="text-center py-1 px-2 font-heading w-14">Tag</th>
            <th className="text-center py-1 px-2 font-heading w-16">Members</th>
            <th className="text-right py-1 px-2 font-heading w-24">Treasury</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800/30">
          {families.map((f) => (
            <tr key={f.id} className={`hover:bg-zinc-800/30 ${myFamilyId === f.id ? 'bg-primary/10' : ''}`}>
              <td className="py-1.5 px-2">
                <Link to={`/families/${encodeURIComponent(f.tag || f.id)}`} className="font-heading font-bold text-foreground hover:text-primary">
                  {f.name} {myFamilyId === f.id && <span className="text-primary text-[9px]">(You)</span>}
                </Link>
              </td>
              <td className="py-1.5 px-2 text-center text-primary font-mono font-bold">[{f.tag}]</td>
              <td className="py-1.5 px-2 text-center text-mutedForeground">{f.member_count}</td>
              <td className="py-1.5 px-2 text-right text-primary font-bold">{formatMoney(f.treasury)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </div>
);

// ============================================================================
// WAR HISTORY TAB
// ============================================================================

const WarHistoryTab = ({ wars }) => (
  <div className="overflow-x-auto max-h-64 overflow-y-auto">
    {wars.length === 0 ? (
      <p className="text-xs text-mutedForeground text-center py-4 italic">No war history</p>
    ) : (
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-card">
          <tr className="text-[10px] text-mutedForeground uppercase border-b border-zinc-700/50">
            <th className="text-left py-1 px-2 font-heading">Combatants</th>
            <th className="text-center py-1 px-2 font-heading w-20">Status</th>
            <th className="text-right py-1 px-2 font-heading w-24">Date</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800/30">
          {wars.map((w) => {
            const isActive = w.status === 'active' || w.status === 'truce_offered';
            const isTruce = w.status === 'truce';
            const hasWinner = w.status === 'family_a_wins' || w.status === 'family_b_wins';
            return (
              <tr key={w.id} className={isActive ? 'bg-red-500/10' : 'hover:bg-zinc-800/30'}>
                <td className="py-1.5 px-2 font-heading text-foreground">
                  {w.family_a_name} <span className="text-primary">[{w.family_a_tag}]</span>
                  <span className="text-mutedForeground mx-1">vs</span>
                  {w.family_b_name} <span className="text-primary">[{w.family_b_tag}]</span>
                  {hasWinner && <span className="text-emerald-400 ml-1">→ {w.winner_family_name}</span>}
                </td>
                <td className="py-1.5 px-2 text-center">
                  {isActive && <span className="text-red-400 font-bold text-[10px] uppercase animate-pulse">Active</span>}
                  {isTruce && <span className="text-amber-400 font-bold text-[10px] uppercase">Truce</span>}
                  {hasWinner && <span className="text-emerald-400 font-bold text-[10px]">🏆</span>}
                </td>
                <td className="py-1.5 px-2 text-right text-mutedForeground">{w.ended_at ? new Date(w.ended_at).toLocaleDateString() : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    )}
  </div>
);

// ============================================================================
// WAR MODAL
// ============================================================================

const WarModal = ({ war, stats, family, canManage, onClose, onOfferTruce, onAcceptTruce }) => {
  if (!war) return null;

  const StatRow = ({ title, icon, rows, valueKey, valueColor }) => (
    <div className="space-y-1">
      <div className="flex items-center gap-1 text-[10px] text-mutedForeground uppercase">{icon}{title}</div>
      {(!rows || rows.length === 0) ? <p className="text-[10px] text-zinc-500 italic">No data</p> : (
        <div className="space-y-0.5">
          {rows.slice(0, 3).map((e, i) => (
            <div key={e.user_id} className="flex items-center justify-between text-xs">
              <span className="text-foreground">{i + 1}. {e.username} <span className="text-mutedForeground text-[10px]">[{e.family_tag}]</span></span>
              <span className={`font-bold ${valueColor}`}>{e[valueKey]}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <div className={`${styles.panel} border border-red-500/30 rounded-md w-full max-w-md shadow-2xl`} onClick={(e) => e.stopPropagation()}>
        <div className="px-3 py-2 bg-red-500/10 border-b border-red-500/30 flex items-center justify-between">
          <span className="text-xs font-heading font-bold text-red-400 uppercase flex items-center gap-1">
            <Swords size={12} /> vs {war.other_family_name} [{war.other_family_tag}]
          </span>
          <button onClick={onClose} className="text-mutedForeground hover:text-foreground"><X size={14} /></button>
        </div>
        <div className="p-3 space-y-3">
          {war.status === 'truce_offered' && <div className="text-[10px] text-primary bg-primary/10 border border-primary/30 rounded px-2 py-1">✋ Truce offered</div>}
          {stats && (
            <div className="grid grid-cols-3 gap-3">
              <StatRow title="BG Kills" icon={<Shield size={10} className="text-primary" />} rows={stats.top_bodyguard_killers} valueKey="bodyguard_kills" valueColor="text-primary" />
              <StatRow title="BGs Lost" icon={<Skull size={10} className="text-red-400" />} rows={stats.top_bodyguards_lost} valueKey="bodyguards_lost" valueColor="text-red-400" />
              <StatRow title="MVP" icon={<Trophy size={10} className="text-primary" />} rows={stats.mvp} valueKey="impact" valueColor="text-primary" />
            </div>
          )}
          {canManage && (
            <div className="flex gap-2 pt-2 border-t border-zinc-700/30">
              {war.status === 'active' && <button onClick={onOfferTruce} className="bg-zinc-700/50 text-foreground rounded px-2 py-1 text-[10px] font-bold uppercase border border-zinc-600/50">🤝 Truce</button>}
              {war.status === 'truce_offered' && war.truce_offered_by_family_id !== family?.id && <button onClick={onAcceptTruce} className="bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground rounded px-2 py-1 text-[10px] font-bold uppercase border border-yellow-600/50">✓ Accept</button>}
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

const NoFamilyView = ({ families, createName, setCreateName, createTag, setCreateTag, onCreate, joinId, setJoinId, onJoin, config }) => (
  <div className="space-y-4">
    {/* Create */}
    <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
      <div className="px-3 py-1.5 bg-primary/10 border-b border-primary/30">
        <span className="text-xs font-heading font-bold text-primary uppercase">🏛️ Create Family</span>
      </div>
      <form onSubmit={onCreate} className="p-3 flex flex-wrap gap-2 items-end">
        <div className="flex-1 min-w-[120px]">
          <label className="block text-[9px] text-mutedForeground mb-0.5 uppercase">Name</label>
          <input type="text" value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder="Five Families" maxLength={30} className="w-full bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs text-foreground focus:border-primary/50 focus:outline-none" />
        </div>
        <div className="w-16">
          <label className="block text-[9px] text-mutedForeground mb-0.5 uppercase">Tag</label>
          <input type="text" value={createTag} onChange={(e) => setCreateTag(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} placeholder="FF" maxLength={4} className="w-full bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs text-foreground uppercase focus:border-primary/50 focus:outline-none" />
        </div>
        <button type="submit" className="bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground rounded px-3 py-1 text-[10px] font-bold uppercase border border-yellow-600/50">Create</button>
      </form>
    </div>

    {/* Join */}
    <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
      <div className="px-3 py-1.5 bg-primary/10 border-b border-primary/30">
        <span className="text-xs font-heading font-bold text-primary uppercase">🤝 Join Family</span>
      </div>
      <form onSubmit={onJoin} className="p-3 flex gap-2">
        <select value={joinId} onChange={(e) => setJoinId(e.target.value)} className="flex-1 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs text-foreground focus:border-primary/50 focus:outline-none">
          <option value="">Choose...</option>
          {families.map((f) => <option key={f.id} value={f.id}>{f.name} [{f.tag}]</option>)}
        </select>
        <button type="submit" className="bg-zinc-700/50 text-foreground rounded px-3 py-1 text-[10px] font-bold uppercase border border-zinc-600/50">Join</button>
      </form>
    </div>

    {/* All Families */}
    <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
      <div className="px-3 py-1.5 bg-primary/10 border-b border-primary/30">
        <span className="text-xs font-heading font-bold text-primary uppercase">All Families</span>
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

  const handleCreate = async (e) => { e.preventDefault(); const name = createName.trim(), tag = createTag.trim().toUpperCase(); if (!name || !tag) { toast.error('Name and tag required'); return; } try { await api.post('/families', { name, tag }); toast.success('Family created!'); setCreateName(''); setCreateTag(''); refreshUser(); fetchData(); } catch (e) { const d = apiDetail(e); if (d.toLowerCase().includes('already in a family')) { toast.info('Already in a family'); fetchData(); } else toast.error(d); } };
  const handleJoin = async (e) => { e.preventDefault(); if (!joinId) { toast.error('Select a family'); return; } try { await api.post('/families/join', { family_id: joinId }); toast.success('Joined!'); setJoinId(''); refreshUser(); fetchData(); } catch (e) { const d = apiDetail(e); if (d.toLowerCase().includes('already in a family')) { toast.info('Already in a family'); fetchData(); } else toast.error(d); } };
  const handleLeave = async () => { if (!window.confirm('Leave this family?')) return; try { await api.post('/families/leave'); toast.success('Left family'); refreshUser(); fetchData(); } catch (e) { toast.error(apiDetail(e)); } };
  const handleKick = async (userId) => { if (!window.confirm('Kick?')) return; try { await api.post('/families/kick', { user_id: userId }); toast.success('Kicked'); fetchData(); } catch (e) { toast.error(apiDetail(e)); } };
  const handleAssignRole = async (userId, role) => { try { await api.post('/families/assign-role', { user_id: userId, role }); toast.success(`Role: ${getRoleConfig(role).label}`); fetchData(); } catch (e) { toast.error(apiDetail(e)); } };
  const handleDeposit = async (e) => { e.preventDefault(); const amount = parseInt(depositAmount.replace(/\D/g, ''), 10); if (!amount) { toast.error('Enter amount'); return; } try { await api.post('/families/deposit', { amount }); toast.success('Deposited'); setDepositAmount(''); refreshUser(); fetchData(); } catch (e) { toast.error(apiDetail(e)); } };
  const handleWithdraw = async (e) => { e.preventDefault(); const amount = parseInt(withdrawAmount.replace(/\D/g, ''), 10); if (!amount) { toast.error('Enter amount'); return; } try { await api.post('/families/withdraw', { amount }); toast.success('Withdrew'); setWithdrawAmount(''); refreshUser(); fetchData(); } catch (e) { toast.error(apiDetail(e)); } };
  const collectRacket = async (id) => { try { const res = await api.post(`/families/rackets/${id}/collect`); toast.success(res.data?.message || 'Collected'); fetchData(); } catch (e) { toast.error(apiDetail(e)); } };
  const upgradeRacket = async (id) => { try { const res = await api.post(`/families/rackets/${id}/upgrade`); toast.success(res.data?.message || 'Upgraded'); fetchData(); } catch (e) { toast.error(apiDetail(e)); } };
  const unlockRacket = async (id) => { try { const res = await api.post(`/families/rackets/${id}/unlock`); toast.success(res.data?.message || 'Unlocked'); fetchData(); } catch (e) { toast.error(apiDetail(e)); } };
  const attackFamilyRacket = async (familyId, racketId) => { setRacketAttackLoading(`${familyId}-${racketId}`); try { const res = await api.post('/families/attack-racket', { family_id: familyId, racket_id: racketId }); res.data?.success ? toast.success(res.data?.message || 'Success!') : toast.error(res.data?.message || 'Failed'); fetchRacketAttackTargets(); fetchData(); } catch (e) { toast.error(apiDetail(e)); } finally { setRacketAttackLoading(null); } };
  const handleOfferTruce = async () => { const entry = activeWars[selectedWarIndex]; if (!entry?.war?.id) return; try { await api.post('/families/war/truce/offer', { war_id: entry.war.id }); toast.success('Truce offered'); fetchData(); setShowWarModal(false); } catch (e) { toast.error(apiDetail(e)); } };
  const handleAcceptTruce = async () => { const entry = activeWars[selectedWarIndex]; if (!entry?.war?.id) return; try { await api.post('/families/war/truce/accept', { war_id: entry.war.id }); toast.success('Truce accepted'); fetchData(); setShowWarModal(false); } catch (e) { toast.error(apiDetail(e)); } };

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { const id = setInterval(() => setTick((t) => t + 1), 1000); return () => clearInterval(id); }, []);
  useEffect(() => { if (showWarModal && myFamily?.family) api.get('/families/war/stats').then((res) => setWarStats(res.data)).catch(() => {}); }, [showWarModal, myFamily?.family]);

  if (loading) return <div className="flex items-center justify-center min-h-[60vh]"><div className="text-primary text-xl font-heading">Loading...</div></div>;

  const readyRackets = rackets.filter(r => r.level > 0 && (!formatTimeLeft(r.next_collect_at) || formatTimeLeft(r.next_collect_at) === 'Ready')).length;

  return (
    <div className={`space-y-3 ${styles.pageContent}`} data-testid="families-page">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h1 className="text-xl sm:text-2xl font-heading font-bold text-primary">🏛️ {family ? family.name : 'Families'}</h1>
          {family && <span className="text-xs text-primary font-mono">[{family.tag}]</span>}
        </div>
        {family && (
          <div className="flex items-center gap-3 text-xs">
            <span className={getRoleConfig(myRole).color}>{getRoleConfig(myRole).icon} {getRoleConfig(myRole).label}</span>
            <span className="text-primary font-bold">{formatMoney(family.treasury)}</span>
            <button onClick={handleLeave} className="text-red-400 hover:text-red-300 flex items-center gap-0.5"><LogOut size={10} />Leave</button>
          </div>
        )}
      </div>

      {/* War Alert */}
      {activeWars.length > 0 && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-red-500/10 border border-red-500/30 rounded-md">
          <Swords size={14} className="text-red-400 animate-pulse shrink-0" />
          <span className="text-xs text-red-400 font-heading font-bold">⚔️ At War:</span>
          {activeWars.map((entry, i) => (
            <button key={entry.war?.id} onClick={() => { setSelectedWarIndex(i); setShowWarModal(true); }} className="text-xs text-foreground hover:text-primary font-heading">
              vs {entry.war?.other_family_name} <span className="text-primary">[{entry.war?.other_family_tag}]</span>
            </button>
          ))}
        </div>
      )}

      {family ? (
        <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
          {/* Tabs */}
          <div className="flex flex-wrap border-b border-primary/20 bg-zinc-900/30">
            <Tab active={activeTab === 'treasury'} onClick={() => setActiveTab('treasury')}>
              <DollarSign size={12} className="inline mr-1" />Treasury
            </Tab>
            <Tab active={activeTab === 'rackets'} onClick={() => setActiveTab('rackets')} badge={readyRackets}>
              <TrendingUp size={12} className="inline mr-1" />Rackets
            </Tab>
            <Tab active={activeTab === 'raid'} onClick={() => setActiveTab('raid')}>
              <Crosshair size={12} className="inline mr-1" />Raid
            </Tab>
            <Tab active={activeTab === 'roster'} onClick={() => setActiveTab('roster')}>
              <Users size={12} className="inline mr-1" />Roster
            </Tab>
            <Tab active={activeTab === 'families'} onClick={() => setActiveTab('families')}>
              <Building2 size={12} className="inline mr-1" />All
            </Tab>
            <Tab active={activeTab === 'history'} onClick={() => setActiveTab('history')}>
              <Trophy size={12} className="inline mr-1" />Wars
            </Tab>
          </div>

          {/* Tab Content */}
          <div className="p-3">
            {activeTab === 'treasury' && <TreasuryTab treasury={family.treasury} canWithdraw={canWithdraw} depositAmount={depositAmount} setDepositAmount={setDepositAmount} withdrawAmount={withdrawAmount} setWithdrawAmount={setWithdrawAmount} onDeposit={handleDeposit} onWithdraw={handleWithdraw} />}
            {activeTab === 'rackets' && <RacketsTab rackets={rackets} config={config} canUpgrade={canUpgradeRacket} onCollect={collectRacket} onUpgrade={upgradeRacket} onUnlock={unlockRacket} event={event} eventsEnabled={eventsEnabled} />}
            {activeTab === 'raid' && <RaidTab targets={racketAttackTargets} loading={racketAttackLoading} onRaid={attackFamilyRacket} onRefresh={fetchRacketAttackTargets} refreshing={targetsRefreshing} />}
            {activeTab === 'roster' && <RosterTab members={members} canManage={canManage} myRole={myRole} config={config} onKick={handleKick} onAssignRole={handleAssignRole} />}
            {activeTab === 'families' && <FamiliesTab families={families} myFamilyId={family?.id} />}
            {activeTab === 'history' && <WarHistoryTab wars={warHistory} />}
          </div>
        </div>
      ) : (
        <NoFamilyView families={families} createName={createName} setCreateName={setCreateName} createTag={createTag} setCreateTag={setCreateTag} onCreate={handleCreate} joinId={joinId} setJoinId={setJoinId} onJoin={handleJoin} config={config} />
      )}

      {/* War Modal */}
      {showWarModal && activeWars[selectedWarIndex] && <WarModal war={activeWars[selectedWarIndex].war} stats={activeWars[selectedWarIndex].stats} family={family} canManage={canManage} onClose={() => setShowWarModal(false)} onOfferTruce={handleOfferTruce} onAcceptTruce={handleAcceptTruce} />}
    </div>
  );
}
