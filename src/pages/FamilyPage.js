import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { 
  Users, Building2, DollarSign, TrendingUp, LogOut, Swords, Trophy, 
  Shield, Skull, X, Crosshair, RefreshCw, ChevronDown, ChevronRight 
} from 'lucide-react';
import api, { refreshUser } from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

// ============================================================================
// CONSTANTS
// ============================================================================

const ROLE_CONFIG = {
  boss: { label: 'Boss', icon: '👑', colors: 'bg-gradient-to-r from-yellow-500/30 to-amber-500/30 border-yellow-500/50 text-yellow-300' },
  underboss: { label: 'Underboss', icon: '⭐', colors: 'bg-gradient-to-r from-purple-500/30 to-violet-500/30 border-purple-500/50 text-purple-300' },
  consigliere: { label: 'Consigliere', icon: '🎭', colors: 'bg-gradient-to-r from-blue-500/30 to-cyan-500/30 border-blue-500/50 text-blue-300' },
  capo: { label: 'Capo', icon: '🎖️', colors: 'bg-gradient-to-r from-emerald-500/30 to-teal-500/30 border-emerald-500/50 text-emerald-300' },
  soldier: { label: 'Soldier', icon: '🔫', colors: 'bg-zinc-700/50 border-zinc-600/50 text-zinc-300' },
  associate: { label: 'Associate', icon: '👤', colors: 'bg-zinc-800/50 border-zinc-700/50 text-zinc-400' },
};

const COLLAPSED_KEY = 'mafia_families_collapsed';

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
    return h > 0 ? `${h}h ${m}m ${s}s` : m > 0 ? `${m}m ${s}s` : `${s}s`;
  } catch { return null; }
};

const apiDetail = (e) => {
  const d = e.response?.data?.detail;
  return typeof d === 'string' ? d : Array.isArray(d) && d.length ? d.map((x) => x.msg || x.loc?.join('.')).join('; ') : 'Request failed';
};

const getRoleConfig = (role) => ROLE_CONFIG[role?.toLowerCase()] || ROLE_CONFIG.associate;

// ============================================================================
// SHARED COMPONENTS
// ============================================================================

const SectionHeader = ({ icon: Icon, title, isCollapsed, onToggle, actions }) => (
  <button type="button" onClick={onToggle} className="w-full px-4 py-2.5 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30 text-left flex items-center justify-between hover:opacity-95 transition-opacity">
    <div className="flex items-center gap-2">
      <div className="w-6 h-px bg-primary/50" />
      <h3 className="text-sm font-heading font-bold text-primary uppercase tracking-widest flex items-center gap-2">
        {Icon && <Icon size={16} />} {title}
      </h3>
      <div className="flex-1 h-px bg-primary/50" />
    </div>
    <div className="flex items-center gap-2">
      {actions}
      <span className="shrink-0 text-primary/80">{isCollapsed ? <ChevronRight size={18} /> : <ChevronDown size={18} />}</span>
    </div>
  </button>
);

const RoleBadge = ({ role }) => {
  const config = getRoleConfig(role);
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded border text-xs font-bold ${config.colors}`}>
      <span>{config.icon}</span> {config.label}
    </span>
  );
};

const StatBox = ({ label, value }) => (
  <div className="text-center bg-zinc-900/50 rounded-lg py-2.5 px-3">
    <div className="text-primary font-heading font-bold text-sm">{value}</div>
    <div className="text-[10px] text-mutedForeground uppercase tracking-wider mt-0.5">{label}</div>
  </div>
);

const StatusBadge = ({ status }) => {
  const configs = {
    active: { cls: 'bg-red-500/20 border-red-500/40 text-red-400 animate-pulse', label: '⚔️ Active' },
    truce_offered: { cls: 'bg-red-500/20 border-red-500/40 text-red-400 animate-pulse', label: '⚔️ Active' },
    truce: { cls: 'bg-amber-500/20 border-amber-500/40 text-amber-400', label: '🤝 Truce' },
    family_a_wins: { cls: 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400', label: '🏆 Ended' },
    family_b_wins: { cls: 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400', label: '🏆 Ended' },
  };
  const c = configs[status] || { cls: 'bg-zinc-700/50 border-zinc-600/50 text-zinc-400', label: status };
  return <span className={`inline-flex items-center px-2.5 py-1 rounded-lg border text-xs font-heading font-bold ${c.cls}`}>{c.label}</span>;
};

const GradientButton = ({ children, onClick, disabled, type = 'button', className = '' }) => (
  <button type={type} onClick={onClick} disabled={disabled} className={`bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground px-4 py-2 rounded-sm text-xs font-heading font-bold uppercase tracking-wider hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed border border-yellow-600/50 touch-manipulation transition-all ${className}`}>
    {children}
  </button>
);

const SecondaryButton = ({ children, onClick, disabled, type = 'button', className = '' }) => (
  <button type={type} onClick={onClick} disabled={disabled} className={`${styles.surface} ${styles.raisedHover} border border-primary/30 text-foreground px-4 py-2 rounded-sm text-xs font-heading font-bold uppercase tracking-wider transition-all disabled:opacity-40 ${className}`}>
    {children}
  </button>
);

// ============================================================================
// ROSTER COMPONENTS
// ============================================================================

const RosterMemberCard = ({ member, canManage, onKick }) => (
  <div className="bg-zinc-800/50 border border-primary/20 rounded-lg p-4 hover:border-primary/40 transition-all">
    <div className="flex items-start justify-between gap-3 mb-3">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-primary/30 to-yellow-700/30 border border-primary/30 flex items-center justify-center text-lg font-bold text-primary">
          {member.username?.charAt(0)?.toUpperCase() || '?'}
        </div>
        <div>
          <div className="font-heading font-bold text-foreground text-sm">{member.username}</div>
          <div className="text-xs text-mutedForeground">{member.rank_name || 'Unknown'}</div>
        </div>
      </div>
    </div>
    <div className="flex items-center justify-between">
      <RoleBadge role={member.role} />
      {canManage && member.role !== 'boss' && (
        <button type="button" onClick={() => onKick(member.user_id)} className="px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/20 border border-red-500/30 rounded-lg transition-all font-heading font-bold uppercase">
          Kick
        </button>
      )}
    </div>
  </div>
);

const RosterTable = ({ members, canManage, onKick }) => (
  <table className="w-full text-xs">
    <thead>
      <tr className={`border-b border-primary/20 ${styles.surfaceMuted}`}>
        <th className="text-left py-2.5 px-3 font-heading font-bold text-primary uppercase tracking-wider">Member</th>
        <th className="text-left py-2.5 px-3 font-heading font-bold text-primary uppercase tracking-wider">Role</th>
        <th className="text-left py-2.5 px-3 font-heading font-bold text-primary uppercase tracking-wider">Rank</th>
        {canManage && <th className="text-right py-2.5 px-3 font-heading font-bold text-primary uppercase tracking-wider">Actions</th>}
      </tr>
    </thead>
    <tbody>
      {members.map((m) => (
        <tr key={m.user_id} className="border-b border-primary/10 last:border-0 hover:bg-primary/5 transition-colors">
          <td className="py-2.5 px-3 font-heading font-medium text-foreground">{m.username}</td>
          <td className="py-2.5 px-3"><RoleBadge role={m.role} /></td>
          <td className="py-2.5 px-3 text-mutedForeground font-heading">{m.rank_name}</td>
          {canManage && (
            <td className="py-2.5 px-3 text-right">
              {m.role !== 'boss' && <button type="button" onClick={() => onKick(m.user_id)} className="text-red-400 hover:text-red-300 text-xs font-heading font-bold uppercase">Kick</button>}
            </td>
          )}
        </tr>
      ))}
    </tbody>
  </table>
);

const RosterSection = ({ members, canManage, myRole, config, onKick, onAssignRole }) => {
  const [assignUserId, setAssignUserId] = useState('');
  const [assignRole, setAssignRole] = useState('associate');
  const handleAssign = (e) => { e.preventDefault(); if (assignUserId && assignRole) { onAssignRole(assignUserId, assignRole); setAssignUserId(''); setAssignRole('associate'); } };

  return (
    <div className="p-4">
      <div className="hidden md:block overflow-x-auto"><RosterTable members={members} canManage={canManage} onKick={onKick} /></div>
      <div className="md:hidden space-y-3">{members.map((m) => <RosterMemberCard key={m.user_id} member={m} canManage={canManage} onKick={onKick} />)}</div>
      {myRole === 'boss' && (
        <form onSubmit={handleAssign} className="mt-4 pt-4 border-t border-primary/20 flex flex-wrap items-center gap-2">
          <select value={assignRole} onChange={(e) => setAssignRole(e.target.value)} className={`${styles.surface} border border-primary/20 rounded px-3 py-2 text-sm font-heading focus:border-primary/50 focus:outline-none`}>
            {(config?.roles || []).filter((r) => r !== 'boss').map((role) => <option key={role} value={role}>{getRoleConfig(role).label}</option>)}
          </select>
          <select value={assignUserId} onChange={(e) => setAssignUserId(e.target.value)} className={`${styles.surface} border border-primary/20 rounded px-3 py-2 text-sm font-heading focus:border-primary/50 focus:outline-none flex-1 min-w-[150px]`}>
            <option value="">Select member</option>
            {members.filter((m) => m.role !== 'boss').map((m) => <option key={m.user_id} value={m.user_id}>{m.username}</option>)}
          </select>
          <GradientButton type="submit">Assign Role</GradientButton>
        </form>
      )}
    </div>
  );
};

// ============================================================================
// FAMILIES COMPONENTS
// ============================================================================

const FamilyCard = ({ family, isOwn }) => (
  <div className={`relative rounded-lg p-4 transition-all ${isOwn ? 'bg-gradient-to-br from-primary/20 via-amber-900/15 to-primary/20 border-2 border-primary/50' : 'bg-zinc-800/50 border border-primary/20 hover:border-primary/40'}`}>
    {isOwn && <div className="absolute top-2 right-2 px-2 py-0.5 bg-primary/30 rounded text-[10px] text-primary font-heading font-bold uppercase">Your Family</div>}
    <div className="flex items-start gap-3 mb-3">
      <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-primary/30 to-yellow-700/30 border border-primary/30 flex items-center justify-center"><Building2 size={20} className="text-primary" /></div>
      <div className="flex-1 min-w-0">
        <Link to={`/families/${encodeURIComponent(family.tag || family.id)}`} className="font-heading font-bold text-foreground hover:text-primary transition-colors block truncate">{family.name}</Link>
        <span className="px-1.5 py-0.5 bg-primary/20 rounded text-xs text-primary font-mono font-bold">[{family.tag}]</span>
      </div>
    </div>
    <div className="grid grid-cols-2 gap-2">
      <StatBox label="Members" value={family.member_count} />
      <StatBox label="Treasury" value={formatMoney(family.treasury)} />
    </div>
  </div>
);

const FamiliesTable = ({ families, myFamilyId }) => (
  <table className="w-full text-xs">
    <thead>
      <tr className={`border-b border-primary/20 ${styles.surfaceMuted}`}>
        <th className="text-left py-2.5 px-3 font-heading font-bold text-primary uppercase tracking-wider">Name</th>
        <th className="text-left py-2.5 px-3 font-heading font-bold text-primary uppercase tracking-wider">Tag</th>
        <th className="text-right py-2.5 px-3 font-heading font-bold text-primary uppercase tracking-wider">Members</th>
        <th className="text-right py-2.5 px-3 font-heading font-bold text-primary uppercase tracking-wider">Treasury</th>
      </tr>
    </thead>
    <tbody>
      {families.length === 0 ? <tr><td colSpan={4} className="py-6 text-center text-mutedForeground font-heading">No families yet.</td></tr> : families.map((f) => (
        <tr key={f.id} className={`border-b border-primary/10 last:border-0 hover:bg-primary/5 ${myFamilyId === f.id ? 'bg-primary/10' : ''}`}>
          <td className="py-2.5 px-3"><Link to={`/families/${encodeURIComponent(f.tag || f.id)}`} className="font-heading font-medium text-foreground hover:text-primary">{f.name}</Link>{myFamilyId === f.id && <span className="ml-2 text-[10px] text-primary font-bold">(YOU)</span>}</td>
          <td className="py-2.5 px-3 font-heading text-primary font-bold">[{f.tag}]</td>
          <td className="py-2.5 px-3 text-right text-mutedForeground font-heading">{f.member_count}</td>
          <td className="py-2.5 px-3 text-right font-heading text-primary font-bold">{formatMoney(f.treasury)}</td>
        </tr>
      ))}
    </tbody>
  </table>
);

const AllFamiliesSection = ({ families, myFamilyId }) => (
  <div className="p-4">
    <div className="hidden md:block overflow-x-auto"><FamiliesTable families={families} myFamilyId={myFamilyId} /></div>
    <div className="md:hidden space-y-3">{families.length === 0 ? <p className="text-center text-mutedForeground font-heading py-6">No families yet.</p> : families.map((f) => <FamilyCard key={f.id} family={f} isOwn={myFamilyId === f.id} />)}</div>
  </div>
);

// ============================================================================
// WAR HISTORY COMPONENTS
// ============================================================================

const WarHistoryCard = ({ war }) => {
  const isActive = war.status === 'active' || war.status === 'truce_offered';
  const hasWinner = war.status === 'family_a_wins' || war.status === 'family_b_wins';
  return (
    <div className={`rounded-lg p-4 border ${isActive ? 'bg-gradient-to-br from-red-900/20 to-red-800/10 border-red-500/40' : 'bg-zinc-800/50 border-primary/20 hover:border-primary/40'}`}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Swords size={18} className={`shrink-0 ${isActive ? 'text-red-400' : 'text-primary'}`} />
          <div className="min-w-0">
            <div className="text-sm font-heading font-bold text-foreground truncate">{war.family_a_name} <span className="text-primary">[{war.family_a_tag}]</span></div>
            <div className="text-xs text-mutedForeground truncate">vs {war.family_b_name} <span className="text-primary">[{war.family_b_tag}]</span></div>
          </div>
        </div>
        <StatusBadge status={war.status} />
      </div>
      {hasWinner && <div className="mb-3 px-3 py-2 bg-emerald-500/10 border border-emerald-500/30 rounded-lg"><div className="text-[10px] text-emerald-400/80 uppercase mb-0.5">Winner</div><div className="text-sm font-heading font-bold text-emerald-400">{war.winner_family_name}</div></div>}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="bg-zinc-900/50 rounded-lg p-2.5"><div className="text-mutedForeground text-[10px] uppercase mb-1">Prize</div><div className="text-foreground font-heading text-sm">{war.prize_exclusive_cars ? `${war.prize_exclusive_cars} car(s)` : ''}{war.prize_rackets?.length > 0 && war.prize_rackets.map(r => `${r.name} Lv.${r.level}`).join(', ')}{!war.prize_exclusive_cars && (!war.prize_rackets || !war.prize_rackets.length) && '—'}</div></div>
        <div className="bg-zinc-900/50 rounded-lg p-2.5"><div className="text-mutedForeground text-[10px] uppercase mb-1">Ended</div><div className="text-foreground font-heading text-sm">{war.ended_at ? new Date(war.ended_at).toLocaleDateString() : '—'}</div></div>
      </div>
    </div>
  );
};

const WarHistoryTable = ({ wars }) => (
  <table className="w-full text-xs">
    <thead><tr className={`border-b border-primary/20 ${styles.surfaceMuted}`}><th className="text-left py-2.5 px-3 font-heading font-bold text-primary uppercase">Sides</th><th className="text-left py-2.5 px-3 font-heading font-bold text-primary uppercase">Result</th><th className="text-left py-2.5 px-3 font-heading font-bold text-primary uppercase">Prize</th><th className="text-right py-2.5 px-3 font-heading font-bold text-primary uppercase">Ended</th></tr></thead>
    <tbody>{wars.map((w) => (
      <tr key={w.id} className="border-b border-primary/10 last:border-0 hover:bg-primary/5">
        <td className="py-2.5 px-3 text-foreground font-heading">{w.family_a_name} <span className="text-primary">[{w.family_a_tag}]</span> <span className="text-mutedForeground">vs</span> {w.family_b_name} <span className="text-primary">[{w.family_b_tag}]</span></td>
        <td className="py-2.5 px-3 font-heading">{w.status === 'truce' && <span className="text-amber-400">Truce</span>}{(w.status === 'family_a_wins' || w.status === 'family_b_wins') && <span className="text-emerald-400 font-bold">{w.winner_family_name} won</span>}{(w.status === 'active' || w.status === 'truce_offered') && <span className="text-red-400 font-bold uppercase">Active</span>}</td>
        <td className="py-2.5 px-3 text-mutedForeground font-heading">{w.prize_exclusive_cars && `${w.prize_exclusive_cars} car(s)`}{w.prize_rackets?.length > 0 && w.prize_rackets.map((r) => `${r.name} Lv.${r.level}`).join(', ')}{!w.prize_exclusive_cars && (!w.prize_rackets || !w.prize_rackets.length) && '—'}</td>
        <td className="py-2.5 px-3 text-right text-mutedForeground font-heading">{w.ended_at ? new Date(w.ended_at).toLocaleDateString() : '—'}</td>
      </tr>
    ))}</tbody>
  </table>
);

const WarHistorySection = ({ wars }) => (
  <div className="p-4">
    {wars.length === 0 ? <p className="text-sm text-mutedForeground font-heading italic text-center py-4">No war history yet.</p> : <>
      <div className="hidden md:block overflow-x-auto"><WarHistoryTable wars={wars} /></div>
      <div className="md:hidden space-y-3">{wars.map((w) => <WarHistoryCard key={w.id} war={w} />)}</div>
    </>}
  </div>
);

// ============================================================================
// RACKET CARD
// ============================================================================

const RacketCard = ({ racket, config, canUpgrade, onCollect, onUpgrade }) => {
  const incomeDisplay = racket.effective_income_per_collect ?? racket.income_per_collect;
  const cooldownDisplay = racket.effective_cooldown_hours ?? racket.cooldown_hours;
  const timeLeft = formatTimeLeft(racket.next_collect_at);
  const onCooldown = timeLeft && timeLeft !== 'Ready';
  const isReady = racket.level > 0 && !onCooldown;
  const maxLevel = config?.racket_max_level ?? 5;
  const levelPct = Math.min(100, (racket.level / maxLevel) * 100);

  return (
    <div className={`${styles.panel} border rounded-lg overflow-hidden ${isReady ? 'border-primary/40' : 'border-primary/15'}`}>
      <div className="px-3 py-2.5 bg-gradient-to-r from-primary/10 to-transparent border-b border-primary/15 flex items-center justify-between">
        <h4 className="font-heading font-bold text-foreground text-sm truncate">{racket.name}</h4>
        <span className={`text-[10px] font-heading font-bold uppercase px-2 py-0.5 rounded ${racket.level === 0 ? 'text-mutedForeground bg-zinc-800 border border-primary/10' : isReady ? 'text-primary bg-primary/15 border border-primary/30' : 'text-mutedForeground bg-zinc-800 border border-primary/10'}`}>
          {racket.level === 0 ? 'Locked' : isReady ? 'Ready' : onCooldown ? timeLeft : `Lv.${racket.level}`}
        </span>
      </div>
      <div className="px-3 py-3 space-y-2.5">
        <p className="text-[11px] text-mutedForeground font-heading line-clamp-2">{racket.description}</p>
        <div className="flex items-center gap-3 text-[11px] font-heading">
          <span className="text-foreground font-bold">Lv.{racket.level}<span className="text-mutedForeground font-normal">/{maxLevel}</span></span>
          <span className="text-primary font-bold">{formatMoney(incomeDisplay)}</span>
          <span className="text-mutedForeground">{cooldownDisplay}h</span>
        </div>
        <div className="relative w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden"><div className="absolute top-0 left-0 bottom-0 bg-gradient-to-r from-primary to-yellow-600 rounded-full transition-all duration-300" style={{ width: `${levelPct}%` }} /></div>
        <div className="flex flex-wrap gap-2 pt-1">
          {racket.level > 0 && <GradientButton onClick={() => onCollect(racket.id)} disabled={onCooldown} className="text-[10px] px-3 py-1.5">💰 Collect</GradientButton>}
          {canUpgrade && racket.level < maxLevel && (racket.level === 0 
            ? <GradientButton onClick={() => onUpgrade(racket.id)} className="text-[10px] px-3 py-1.5">Purchase {config?.racket_upgrade_cost ? `(${formatMoney(config.racket_upgrade_cost)})` : ''}</GradientButton>
            : <SecondaryButton onClick={() => onUpgrade(racket.id)} className="text-[10px] px-3 py-1.5">Upgrade {config?.racket_upgrade_cost ? `(${formatMoney(config.racket_upgrade_cost)})` : ''}</SecondaryButton>
          )}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// RAID TARGET BLOCK
// ============================================================================

const RaidTargetFamilyBlock = ({ target, attackLoading, onRaid }) => {
  const [collapsed, setCollapsed] = useState(false);
  const rackets = target.rackets || [];
  const raidsRemaining = target.raids_remaining ?? 2;
  const canRaid = raidsRemaining > 0;

  return (
    <div className={`${styles.surfaceMuted} border border-primary/20 rounded-lg overflow-hidden`}>
      <button type="button" onClick={() => setCollapsed((c) => !c)} className="w-full px-4 py-3 border-b border-primary/20 flex flex-wrap items-center gap-x-3 gap-y-1 text-left hover:bg-primary/5 transition-colors">
        <span className="shrink-0 text-primary/80">{collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}</span>
        <span className="font-heading font-bold text-foreground text-sm">{target.family_name} <span className="text-primary">[{target.family_tag}]</span></span>
        <span className="text-xs text-primary font-heading font-semibold">{formatMoney(target.treasury)}</span>
        <span className="text-xs text-mutedForeground font-heading">Raids: {target.raids_used ?? 0}/2</span>
        {(target.family_tag || target.family_id) && <Link to={`/families/${encodeURIComponent(target.family_tag || target.family_id)}`} onClick={(e) => e.stopPropagation()} className="text-xs text-primary hover:underline font-heading">View →</Link>}
      </button>
      {!collapsed && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-heading min-w-[320px]">
            <thead><tr className="border-b border-primary/15"><th className="text-left py-2 px-3 text-mutedForeground font-bold uppercase">Operation</th><th className="text-right py-2 px-3 text-mutedForeground font-bold uppercase">Value</th><th className="text-right py-2 px-3 text-mutedForeground font-bold uppercase">Chance</th><th className="text-right py-2 px-3 text-mutedForeground font-bold uppercase w-20">Raid</th></tr></thead>
            <tbody>{rackets.map((r) => {
              const key = `${target.family_id}-${r.racket_id}`;
              return (
                <tr key={r.racket_id} className="border-b border-primary/10 last:border-0 hover:bg-primary/5">
                  <td className="py-2 px-3 text-foreground">{r.racket_name} <span className="text-mutedForeground">Lv.{r.level}</span></td>
                  <td className="py-2 px-3 text-right text-primary font-bold">{formatMoney(r.potential_take)}</td>
                  <td className="py-2 px-3 text-right text-primary">{r.success_chance_pct}%</td>
                  <td className="py-2 px-3 text-right"><button type="button" onClick={() => onRaid(target.family_id, r.racket_id)} disabled={attackLoading === key || !canRaid} className="bg-primary/20 text-primary border border-primary/40 hover:bg-primary/30 px-3 py-1 rounded text-xs font-bold uppercase disabled:opacity-50 touch-manipulation">{attackLoading === key ? '…' : canRaid ? 'Raid' : '0 left'}</button></td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// WAR MODAL
// ============================================================================

const WarModal = ({ war, stats, family, canManage, onClose, onOfferTruce, onAcceptTruce }) => {
  if (!war) return null;
  const WarTable = ({ title, icon, rows, valueKey, valueColor }) => (
    <div className={`${styles.panel} rounded-lg overflow-hidden`}>
      <div className="px-4 py-2.5 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30 flex items-center gap-2">{icon}<span className="text-xs font-heading font-bold text-primary uppercase">{title}</span></div>
      {(!rows || rows.length === 0) ? <div className="px-4 py-6 text-center text-sm text-mutedForeground font-heading italic">No data yet.</div> : (
        <div className="divide-y divide-primary/10">{rows.map((e, i) => (
          <div key={e.user_id} className="grid grid-cols-12 gap-2 px-4 py-2 items-center hover:bg-zinc-800/30">
            <div className="col-span-1 text-xs text-mutedForeground">{i + 1}</div>
            <div className="col-span-4 text-sm font-heading font-bold text-foreground truncate">{e.username}</div>
            <div className="col-span-4 text-xs text-mutedForeground truncate">{e.family_name} <span className="text-primary">[{e.family_tag}]</span></div>
            <div className={`col-span-3 text-right text-sm font-heading font-bold ${valueColor}`}>{e[valueKey]}</div>
          </div>
        ))}</div>
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <div className={`${styles.panel} border border-primary/30 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl`} onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-4 bg-gradient-to-r from-red-900/30 via-red-800/20 to-red-900/30 border-b border-red-600/30 flex items-center justify-between">
          <h2 className="text-lg font-heading font-bold text-red-400 uppercase flex items-center gap-2"><Swords size={20} /> War: vs {war.other_family_name} [{war.other_family_tag}]</h2>
          <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-zinc-800 text-mutedForeground hover:text-foreground"><X size={20} /></button>
        </div>
        <div className="p-4 space-y-4">
          {war.status === 'truce_offered' && <div className="text-sm text-primary bg-primary/10 border border-primary/30 rounded-lg p-3 font-heading">✋ A truce has been offered. Boss or Underboss can accept.</div>}
          {stats && <>
            <WarTable title="Most Bodyguard Kills" icon={<Shield size={16} className="text-primary" />} rows={stats.top_bodyguard_killers} valueKey="bodyguard_kills" valueColor="text-primary" />
            <WarTable title="Most Bodyguards Lost" icon={<Skull size={16} className="text-red-400" />} rows={stats.top_bodyguards_lost} valueKey="bodyguards_lost" valueColor="text-red-400" />
            <WarTable title="MVP (Impact Score)" icon={<Trophy size={16} className="text-primary" />} rows={stats.mvp} valueKey="impact" valueColor="text-primary" />
          </>}
          {canManage && (
            <div className="flex flex-wrap gap-3 pt-4 border-t border-primary/20">
              {war.status === 'active' && <SecondaryButton onClick={onOfferTruce}>🤝 Offer Truce</SecondaryButton>}
              {war.status === 'truce_offered' && war.truce_offered_by_family_id !== family?.id && <GradientButton onClick={onAcceptTruce}>✓ Accept Truce</GradientButton>}
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
  const [dbSnapshot, setDbSnapshot] = useState(null);
  const [collapsedSections, setCollapsedSections] = useState(() => { try { const r = localStorage.getItem(COLLAPSED_KEY); return r ? JSON.parse(r) : {}; } catch { return {}; } });

  const toggleSection = (id) => setCollapsedSections((prev) => { const next = { ...prev, [id]: !prev[id] }; try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next)); } catch {} return next; });
  const isCollapsed = (id) => !!collapsedSections[id];

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
        api.get('/families'), api.get('/families/my'), api.get('/families/config').catch(() => ({ data: {} })),
        api.get('/families/wars/history').catch(() => ({ data: { wars: [] } })), api.get('/events/active').catch(() => ({ data: { event: null, events_enabled: false } })),
      ]);
      if (listRes.status === 'fulfilled') setFamilies(listRes.value?.data || []);
      if (myRes.status === 'fulfilled' && myRes.value?.data) {
        setMyFamily(myRes.value.data);
        if (myRes.value.data?.family) {
          const [statsRes, targetsRes] = await Promise.allSettled([api.get('/families/war/stats'), api.get('/families/racket-attack-targets', { params: { _: Date.now() } })]);
          if (statsRes.status === 'fulfilled') setWarStats(statsRes.value?.data);
          const targets = targetsRes.status === 'fulfilled' ? targetsRes.value?.data?.targets ?? [] : [];
          setRacketAttackTargets(targets);
          if (targets.length === 0 && targetsRes.value?.data?._debug) setDbSnapshot(targetsRes.value.data._debug);
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
    try { const res = await api.get('/families/racket-attack-targets', { params: { _: Date.now() } }); setRacketAttackTargets(res.data?.targets ?? []); if (res.data?.targets?.length === 0 && res.data?._debug) setDbSnapshot(res.data._debug); else setDbSnapshot(null); }
    catch { setRacketAttackTargets([]); } finally { setTargetsRefreshing(false); }
  }, [myFamily?.family]);

  const checkDatabase = useCallback(async () => { try { const res = await api.get('/families/racket-attack-targets', { params: { debug: true } }); setDbSnapshot(res.data?._debug ?? null); } catch (e) { toast.error(apiDetail(e)); } }, []);

  // HANDLERS
  const handleCreate = async (e) => { e.preventDefault(); const name = createName.trim(), tag = createTag.trim().toUpperCase(); if (!name || !tag) { toast.error('Name and tag required'); return; } try { await api.post('/families', { name, tag }); toast.success('Family created.'); setCreateName(''); setCreateTag(''); refreshUser(); fetchData(); } catch (e) { const d = apiDetail(e); if (d.toLowerCase().includes('already in a family')) { toast.info('Already in a family.'); fetchData(); } else toast.error(d); } };
  const handleJoin = async (e) => { e.preventDefault(); if (!joinId) { toast.error('Select a family'); return; } try { await api.post('/families/join', { family_id: joinId }); toast.success('Joined family.'); setJoinId(''); refreshUser(); fetchData(); } catch (e) { const d = apiDetail(e); if (d.toLowerCase().includes('already in a family')) { toast.info('Already in a family.'); fetchData(); } else toast.error(d); } };
  const handleLeave = async () => { if (!window.confirm('Leave this family?')) return; try { await api.post('/families/leave'); toast.success('Left family.'); refreshUser(); fetchData(); } catch (e) { toast.error(apiDetail(e)); } };
  const handleKick = async (userId) => { if (!window.confirm('Kick this member?')) return; try { await api.post('/families/kick', { user_id: userId }); toast.success('Kicked.'); fetchData(); } catch (e) { toast.error(apiDetail(e)); } };
  const handleAssignRole = async (userId, role) => { try { await api.post('/families/assign-role', { user_id: userId, role }); toast.success(`Role set to ${getRoleConfig(role).label}.`); fetchData(); } catch (e) { toast.error(apiDetail(e)); } };
  const handleDeposit = async (e) => { e.preventDefault(); const amount = parseInt(depositAmount.replace(/\D/g, ''), 10); if (!amount) { toast.error('Enter amount'); return; } try { await api.post('/families/deposit', { amount }); toast.success('Deposited.'); setDepositAmount(''); refreshUser(); fetchData(); } catch (e) { toast.error(apiDetail(e)); } };
  const handleWithdraw = async (e) => { e.preventDefault(); const amount = parseInt(withdrawAmount.replace(/\D/g, ''), 10); if (!amount) { toast.error('Enter amount'); return; } try { await api.post('/families/withdraw', { amount }); toast.success('Withdrew.'); setWithdrawAmount(''); refreshUser(); fetchData(); } catch (e) { toast.error(apiDetail(e)); } };
  const collectRacket = async (id) => { try { const res = await api.post(`/families/rackets/${id}/collect`); toast.success(res.data?.message || 'Collected.'); fetchData(); } catch (e) { toast.error(apiDetail(e)); } };
  const upgradeRacket = async (id) => { try { const res = await api.post(`/families/rackets/${id}/upgrade`); toast.success(res.data?.message || 'Upgraded.'); fetchData(); } catch (e) { toast.error(apiDetail(e)); } };
  const attackFamilyRacket = async (familyId, racketId) => { setRacketAttackLoading(`${familyId}-${racketId}`); try { const res = await api.post('/families/attack-racket', { family_id: familyId, racket_id: racketId }); res.data?.success ? toast.success(res.data?.message || 'Success!') : toast.error(res.data?.message || 'Failed.'); fetchRacketAttackTargets(); fetchData(); } catch (e) { toast.error(apiDetail(e)); } finally { setRacketAttackLoading(null); } };
  const handleOfferTruce = async () => { const entry = activeWars[selectedWarIndex]; if (!entry?.war?.id) return; try { await api.post('/families/war/truce/offer', { war_id: entry.war.id }); toast.success('Truce offered.'); fetchData(); setShowWarModal(false); } catch (e) { toast.error(apiDetail(e)); } };
  const handleAcceptTruce = async () => { const entry = activeWars[selectedWarIndex]; if (!entry?.war?.id) return; try { await api.post('/families/war/truce/accept', { war_id: entry.war.id }); toast.success('Truce accepted.'); fetchData(); setShowWarModal(false); } catch (e) { toast.error(apiDetail(e)); } };

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { const id = setInterval(() => setTick((t) => t + 1), 1000); return () => clearInterval(id); }, []);
  useEffect(() => { if (showWarModal && myFamily?.family) api.get('/families/war/stats').then((res) => setWarStats(res.data)).catch(() => {}); }, [showWarModal, myFamily?.family]);

  if (loading) return <div className="flex items-center justify-center min-h-[60vh]"><div className="text-primary text-xl font-heading">Loading...</div></div>;

  return (
    <div className={`space-y-5 ${styles.pageContent}`} data-testid="families-page">
      {/* HEADER */}
      <div className="text-center">
        <div className="flex items-center gap-4 mb-2">
          <div className="h-px flex-1 bg-gradient-to-r from-transparent via-primary/40 to-primary/60" />
          <h1 className="text-3xl md:text-4xl font-heading font-bold text-primary uppercase flex items-center gap-3"><Building2 size={28} /> Mafia Families</h1>
          <div className="h-px flex-1 bg-gradient-to-l from-transparent via-primary/40 to-primary/60" />
        </div>
        <p className="text-sm text-mutedForeground font-heading">Run rackets, grow the treasury, dominate the underworld</p>
      </div>

      {family ? (
        <>
          {/* WAR ALERT */}
          {activeWars.length > 0 && (
            <div className={`${styles.panel} rounded-lg overflow-hidden border-2 border-red-600/40`}>
              <button type="button" onClick={() => toggleSection('warAlerts')} className="w-full px-4 py-3 bg-gradient-to-r from-red-900/30 via-red-800/20 to-red-900/30 border-b border-red-600/30 text-left flex items-center justify-between">
                <div className="flex items-center gap-3"><Swords className="text-red-500 animate-pulse" size={24} /><div><p className="font-heading font-bold text-red-400 uppercase">⚔️ Your Family Is At War</p><p className="text-xs text-mutedForeground">{activeWars.length} active war(s)</p></div></div>
                <span className="text-red-400/80">{isCollapsed('warAlerts') ? <ChevronRight size={20} /> : <ChevronDown size={20} />}</span>
              </button>
              {!isCollapsed('warAlerts') && <div className="p-3 space-y-2">{activeWars.map((entry, i) => (
                <button key={entry.war?.id} type="button" onClick={() => { setSelectedWarIndex(i); setShowWarModal(true); }} className="w-full bg-gradient-to-r from-red-900/20 via-red-800/15 to-red-900/20 border border-red-600/50 rounded-lg p-3 text-left hover:border-red-500 flex items-center gap-3">
                  <Swords className="text-red-500 shrink-0" size={20} />
                  <div><p className="font-heading font-bold text-red-400 uppercase text-sm">vs {entry.war?.other_family_name} [{entry.war?.other_family_tag}]</p><p className="text-xs text-mutedForeground">Click for details</p></div>
                </button>
              ))}</div>}
            </div>
          )}

          {/* FAMILY INFO */}
          <div className={`${styles.panel} border border-primary/40 rounded-lg overflow-hidden shadow-lg shadow-primary/5`}>
            <div className="px-4 py-4 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-xl font-heading font-bold text-primary">{family.name} <span className="text-primary/70">[{family.tag}]</span></h2>
                  <p className="text-sm text-mutedForeground font-heading mt-1">Your role: <RoleBadge role={myRole} /></p>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right"><p className="text-xs text-mutedForeground font-heading uppercase">Treasury</p><p className="text-2xl font-heading font-bold text-primary">{formatMoney(family.treasury)}</p></div>
                  <button type="button" onClick={handleLeave} className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border border-red-500/30 ${styles.surface} text-red-400 hover:bg-red-500/10 text-xs font-heading font-bold uppercase`}><LogOut size={14} /> Leave</button>
                </div>
              </div>
            </div>
          </div>

          {/* TREASURY */}
          <div className={`${styles.panel} rounded-lg overflow-hidden`}>
            <SectionHeader icon={DollarSign} title="Treasury" isCollapsed={isCollapsed('treasury')} onToggle={() => toggleSection('treasury')} />
            {!isCollapsed('treasury') && (
              <div className="p-4 space-y-3">
                <form onSubmit={handleDeposit} className="flex gap-2"><input type="text" placeholder="Amount to deposit" value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} className={`flex-1 ${styles.input} border border-primary/20 rounded-lg px-4 py-2.5 font-heading text-sm focus:border-primary/50 focus:outline-none`} /><GradientButton type="submit">💰 Deposit</GradientButton></form>
                {canWithdraw && <form onSubmit={handleWithdraw} className="flex gap-2"><input type="text" placeholder="Amount to withdraw" value={withdrawAmount} onChange={(e) => setWithdrawAmount(e.target.value)} className={`flex-1 ${styles.input} border border-primary/20 rounded-lg px-4 py-2.5 font-heading text-sm focus:border-primary/50 focus:outline-none`} /><SecondaryButton type="submit">Withdraw</SecondaryButton></form>}
              </div>
            )}
          </div>

          {/* RACKETS */}
          <div className={`${styles.panel} rounded-lg overflow-hidden`}>
            <SectionHeader icon={TrendingUp} title="Rackets" isCollapsed={isCollapsed('rackets')} onToggle={() => toggleSection('rackets')} />
            {!isCollapsed('rackets') && (
              <div className="p-4">
                <p className="text-xs text-mutedForeground mb-4 font-heading">Collect income on cooldown. Upgrade with family treasury.</p>
                {eventsEnabled && event && (event.racket_payout !== 1 || event.racket_cooldown !== 1) && event.name && (
                  <div className="mb-4 p-3 bg-primary/10 border border-primary/30 rounded-lg"><p className="text-xs font-heading font-bold text-primary uppercase mb-1">✨ Today's Event</p><p className="text-sm font-heading text-foreground">{event.name}</p><p className="text-xs text-mutedForeground mt-1">{event.message}</p></div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">{rackets.map((r) => <RacketCard key={r.id} racket={r} config={config} canUpgrade={canUpgradeRacket} onCollect={collectRacket} onUpgrade={upgradeRacket} />)}</div>
                <p className="text-xs text-mutedForeground mt-4 font-heading italic">💡 Upgrades improve defense. Lose a war = lose your rackets.</p>
                <a href="#raid-enemy-rackets" className="inline-flex items-center gap-1.5 mt-3 text-xs font-heading font-bold text-primary hover:underline uppercase"><Crosshair size={14} /> Raid Enemy Rackets →</a>
              </div>
            )}
          </div>

          {/* RAID ENEMY RACKETS */}
          <div id="raid-enemy-rackets" className={`${styles.panel} rounded-lg overflow-hidden scroll-mt-4`}>
            <SectionHeader icon={Crosshair} title="Raid Enemy Rackets" isCollapsed={isCollapsed('raidEnemy')} onToggle={() => toggleSection('raidEnemy')} actions={<button type="button" onClick={(e) => { e.stopPropagation(); fetchRacketAttackTargets(); }} disabled={targetsRefreshing} className="text-xs text-mutedForeground hover:text-primary flex items-center gap-1 mr-2"><RefreshCw size={12} className={targetsRefreshing ? 'animate-spin' : ''} /></button>} />
            {!isCollapsed('raidEnemy') && (
              <div className="p-4">
                <p className="text-xs text-mutedForeground mb-4 font-heading">Take 25% of one collect from their treasury. 2 raids per crew every 3h.</p>
                {racketAttackTargets.length > 0 ? <div className="space-y-3">{racketAttackTargets.map((t) => <RaidTargetFamilyBlock key={t.family_id} target={t} attackLoading={racketAttackLoading} onRaid={attackFamilyRacket} />)}</div> : (
                  <div className="text-center py-6"><p className="text-sm text-mutedForeground font-heading mb-3">No enemy rackets to raid.</p><button type="button" onClick={checkDatabase} className="text-xs text-primary hover:underline font-heading">Check database</button>{dbSnapshot && <div className={`mt-4 p-3 ${styles.surfaceMuted} rounded-lg border border-primary/20 text-xs font-mono text-left`}><p className="text-foreground font-semibold">Debug: {dbSnapshot.total_families} families</p>{dbSnapshot.reason && <p className="text-amber-400">{dbSnapshot.reason}</p>}</div>}</div>
                )}
              </div>
            )}
          </div>

          {/* ROSTER */}
          <div className={`${styles.panel} rounded-lg overflow-hidden`}>
            <SectionHeader icon={Users} title="Roster" isCollapsed={isCollapsed('roster')} onToggle={() => toggleSection('roster')} />
            {!isCollapsed('roster') && <RosterSection members={members} canManage={canManage} myRole={myRole} config={config} onKick={handleKick} onAssignRole={handleAssignRole} />}
          </div>
        </>
      ) : (
        <>
          <div className="flex justify-end"><button type="button" onClick={() => { setLoading(true); fetchData(); }} disabled={loading} className="inline-flex items-center gap-1.5 text-xs font-heading text-primary hover:underline uppercase disabled:opacity-50"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh status</button></div>
          
          {/* CREATE FAMILY */}
          <div className={`${styles.panel} rounded-lg overflow-hidden`}>
            <SectionHeader title="Create A Family" isCollapsed={isCollapsed('createFamily')} onToggle={() => toggleSection('createFamily')} />
            {!isCollapsed('createFamily') && (
              <div className="p-4">
                <form onSubmit={handleCreate} className="flex flex-wrap gap-3 items-end">
                  <div><label className="block text-xs text-mutedForeground mb-1.5 font-heading uppercase">Name (2–30)</label><input type="text" value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder="Five Families" maxLength={30} className={`${styles.input} border border-primary/20 rounded-lg px-4 py-2.5 w-48 font-heading focus:border-primary/50 focus:outline-none`} /></div>
                  <div><label className="block text-xs text-mutedForeground mb-1.5 font-heading uppercase">Tag (2–4)</label><input type="text" value={createTag} onChange={(e) => setCreateTag(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} placeholder="FF" maxLength={4} className={`${styles.input} border border-primary/20 rounded-lg px-4 py-2.5 w-20 font-heading uppercase focus:border-primary/50 focus:outline-none`} /></div>
                  <GradientButton type="submit">🏛️ Create Family</GradientButton>
                </form>
                <p className="text-xs text-mutedForeground mt-3 font-heading">Max {config?.max_families ?? 10} families. You become Boss.</p>
              </div>
            )}
          </div>

          {/* JOIN FAMILY */}
          <div className={`${styles.panel} rounded-lg overflow-hidden`}>
            <SectionHeader title="Join A Family" isCollapsed={isCollapsed('joinFamily')} onToggle={() => toggleSection('joinFamily')} />
            {!isCollapsed('joinFamily') && (
              <div className="p-4">
                <form onSubmit={handleJoin} className="flex flex-wrap gap-3 items-end">
                  <div className="flex-1 min-w-[200px]"><label className="block text-xs text-mutedForeground mb-1.5 font-heading uppercase">Select Family</label><select value={joinId} onChange={(e) => setJoinId(e.target.value)} className={`w-full ${styles.input} border border-primary/20 rounded-lg px-4 py-2.5 font-heading focus:border-primary/50 focus:outline-none`}><option value="">Choose a family...</option>{families.map((f) => <option key={f.id} value={f.id}>{f.name} [{f.tag}] — {f.member_count} members</option>)}</select></div>
                  <SecondaryButton type="submit">🤝 Join as Associate</SecondaryButton>
                </form>
              </div>
            )}
          </div>
        </>
      )}

      {/* ALL FAMILIES */}
      <div className={`${styles.panel} rounded-lg overflow-hidden`}>
        <SectionHeader icon={Building2} title="All Families" isCollapsed={isCollapsed('allFamilies')} onToggle={() => toggleSection('allFamilies')} />
        {!isCollapsed('allFamilies') && <AllFamiliesSection families={families} myFamilyId={family?.id} />}
      </div>

      {/* WAR HISTORY */}
      <div className={`${styles.panel} rounded-lg overflow-hidden`}>
        <SectionHeader icon={Trophy} title="War History" isCollapsed={isCollapsed('warHistory')} onToggle={() => toggleSection('warHistory')} />
        {!isCollapsed('warHistory') && <WarHistorySection wars={warHistory} />}
      </div>

      {/* WAR MODAL */}
      {showWarModal && activeWars[selectedWarIndex] && <WarModal war={activeWars[selectedWarIndex].war} stats={activeWars[selectedWarIndex].stats} family={family} canManage={canManage} onClose={() => setShowWarModal(false)} onOfferTruce={handleOfferTruce} onAcceptTruce={handleAcceptTruce} />}
    </div>
  );
}
