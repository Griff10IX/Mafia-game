import { useState, useEffect } from 'react';
import { Target, Eye, ShieldOff, DollarSign, Coins, User, Users, UserPlus, Clock, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import api, { refreshUser } from '../utils/api';
import { toast } from 'sonner';
import { FormattedNumberInput } from '../components/FormattedNumberInput';
import styles from '../styles/noir.module.css';

const HITLIST_STYLES = `
  @keyframes hit-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .hit-fade-in { animation: hit-fade-in 0.4s ease-out both; }
  @keyframes hit-glow { 0%, 100% { opacity: 0.3; } 50% { opacity: 0.7; } }
  .hit-glow { animation: hit-glow 4s ease-in-out infinite; }
  .hit-corner::before, .hit-corner::after {
    content: ''; position: absolute; width: 12px; height: 12px; border-color: rgba(var(--noir-primary-rgb), 0.2); pointer-events: none;
  }
  .hit-corner::before { top: 4px; left: 4px; border-top: 1px solid; border-left: 1px solid; }
  .hit-corner::after { bottom: 4px; right: 4px; border-bottom: 1px solid; border-right: 1px solid; }
  .hit-card { transition: all 0.3s ease; }
  .hit-card:hover { transform: translateY(-2px); box-shadow: 0 4px 16px rgba(0,0,0,0.3), 0 0 0 1px rgba(var(--noir-primary-rgb), 0.1); }
  .hit-row { transition: all 0.2s ease; }
  .hit-row:hover { background-color: rgba(var(--noir-primary-rgb), 0.04); }
  .hit-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.15; }
`;

// Subcomponents
const LoadingSpinner = () => (
  <div className={`space-y-2 ${styles.pageContent}`}>
    <style>{HITLIST_STYLES}</style>
    <div className="flex flex-col items-center justify-center min-h-[40vh] gap-2">
      <Target size={22} className="text-primary/40 animate-pulse" />
      <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      <span className="text-primary text-[9px] font-heading uppercase tracking-[0.2em]">Loading hitlist...</span>
    </div>
  </div>
);

const AddNpcCard = ({ npcStatus, addingNpc, onAddNpc }) => {
  if (!npcStatus) return null;

  return (
    <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 hit-card hit-corner hit-fade-in`}>
      <div className="absolute top-0 left-0 w-20 h-20 bg-primary/5 rounded-full blur-2xl pointer-events-none hit-glow" />
      <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20">
        <h2 className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em] flex items-center gap-1">
          <UserPlus size={12} />
          Add NPC Target
        </h2>
      </div>
      <div className="px-2.5 py-2 flex flex-col md:flex-row items-start md:items-center justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-[11px] text-foreground font-heading mb-0.5">
            Add a random NPC to practice attacking
          </p>
          <p className="text-[9px] text-mutedForeground font-heading">
            Max {npcStatus.max_per_window ?? 3} per {npcStatus.window_hours ?? 3} hours · Attack from the Attack page
          </p>
        </div>
        
        {npcStatus.can_add ? (
          <button
            type="button"
            onClick={onAddNpc}
            disabled={addingNpc}
            className="bg-primary/20 text-primary rounded-md px-2.5 py-1.5 font-heading font-bold uppercase tracking-wide text-[10px] border border-primary/40 hover:bg-primary/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 inline-flex items-center gap-1 touch-manipulation whitespace-nowrap"
            data-testid="hitlist-add-npc"
          >
            <UserPlus size={10} />
            {addingNpc ? 'Adding...' : 'Add NPC'}
          </button>
        ) : (
          <div className="flex items-center gap-1.5 text-[10px] text-mutedForeground font-heading bg-secondary/50 px-2 py-1 rounded border border-border">
            <Clock size={10} />
            <span className="text-[9px]">
              {npcStatus.adds_used_in_window ?? 0}/{npcStatus.max_per_window ?? 3} used
              {npcStatus.next_add_at && (
                <span className="block mt-0.5">
                  Next: {new Date(npcStatus.next_add_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </span>
          </div>
        )}
      </div>
      <div className="hit-art-line text-primary mx-2.5" />
    </div>
  );
};

const YoureOnHitlistCard = ({ me, user, revealed, who, submitting, onBuyOff, onReveal }) => {
  const onHitlist = me?.on_hitlist ?? false;
  
  // Only show "You're on the Hitlist" when actually on the hitlist
    if (!onHitlist) {
      // Optional: show past "who placed" if they had revealed and are no longer on list
      if (revealed && who?.length > 0) {
      return (
        <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 hit-fade-in`}>
          <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20">
            <h2 className="text-[9px] font-heading font-bold text-mutedForeground uppercase tracking-[0.12em]">
              Previously on hitlist (revealed)
            </h2>
          </div>
          <div className="p-2">
            <h3 className="text-[9px] font-heading font-bold text-primary uppercase tracking-widest mb-1.5">Who had placed bounties</h3>
            <div className="space-y-1">
              {who.map((w, i) => (
                <div key={i} className="flex items-center justify-between gap-1.5 text-[10px] font-heading bg-secondary/30 rounded p-1.5 border border-border">
                  <span className="text-foreground font-bold">{w.placer_username}</span>
                  <span className="text-mutedForeground text-[9px]">
                    {w.reward_amount} {w.reward_type} · {w.target_type}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      );
    }
    return null;
  }
  
  const needCash = me?.buy_off_cash ?? 0;
  const needPoints = me?.buy_off_points ?? 0;
  const haveCash = Number(user?.money ?? 0);
  const havePoints = Number(user?.points ?? 0);
  const canAfford = (needCash === 0 || haveCash >= needCash) && (needPoints === 0 || havePoints >= needPoints);
  const costLabel = [needCash > 0 && `$${Number(needCash).toLocaleString()}`, needPoints > 0 && `${Number(needPoints).toLocaleString()} pts`].filter(Boolean).join(' + ');
  
  return (
    <div className={`relative ${styles.panel} rounded-md overflow-hidden border-2 border-red-500/30 shadow-md shadow-red-500/10 hit-fade-in`}>
      <div className="h-px bg-gradient-to-r from-transparent via-red-500/50 to-transparent" />
      <div className="px-2.5 py-1.5 bg-red-500/10 border-b border-red-500/30">
        <h2 className="text-[9px] font-heading font-bold text-red-400 uppercase tracking-[0.12em] flex items-center gap-1">
          <Target size={12} />
          You're on the Hitlist
        </h2>
      </div>
      <div className="p-2 space-y-2">
        {onHitlist && (
          <div className="bg-secondary/50 rounded p-2 border border-border">
            <div className="text-[11px] font-heading">
              <span className="text-primary font-bold text-sm">{me.count}</span>{' '}
              <span className="text-mutedForeground">
                {me.count === 1 ? 'bounty' : 'bounties'} placed on you
              </span>
            </div>
            <div className="text-[10px] text-mutedForeground font-heading mt-0.5">
              Total reward:{' '}
              {me.total_cash > 0 && <span className="text-emerald-400 font-bold">${Number(me.total_cash).toLocaleString()}</span>}
              {me.total_cash > 0 && me.total_points > 0 && <span className="text-mutedForeground"> + </span>}
              {me.total_points > 0 && <span className="text-primary font-bold">{Number(me.total_points).toLocaleString()} pts</span>}
            </div>
          </div>
        )}
        
        <div className="flex flex-col sm:flex-row gap-1.5">
          {onHitlist && (
            <button
              onClick={onBuyOff}
              disabled={submitting || !canAfford}
              className="flex-1 bg-primary/20 text-primary rounded-md px-2.5 py-1.5 font-heading font-bold uppercase tracking-wide text-[10px] border border-primary/40 hover:bg-primary/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 inline-flex items-center justify-center gap-1 touch-manipulation"
            >
              <ShieldOff size={10} />
              Buy Off ({costLabel})
            </button>
          )}
          
          {!revealed && (
            <button
              onClick={onReveal}
              disabled={submitting || (user?.points ?? 0) < 5000}
              className="flex-1 bg-secondary text-foreground border border-border hover:bg-secondary/80 hover:border-primary/30 rounded-md px-2.5 py-1.5 font-heading font-bold uppercase tracking-wide text-[10px] transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 inline-flex items-center justify-center gap-1 touch-manipulation"
            >
              <Eye size={10} />
              Reveal (5,000 pts)
            </button>
          )}
        </div>
        
        {revealed && who.length > 0 && (
          <div className="pt-2 border-t border-border">
            <h3 className="text-[9px] font-heading font-bold text-primary uppercase tracking-widest mb-1.5">
              Who Placed Bounties
            </h3>
            <div className="space-y-1">
              {who.map((w, i) => (
                <div key={i} className="flex items-center justify-between gap-1.5 text-[10px] font-heading bg-secondary/30 rounded p-1.5 border border-border">
                  <span className="text-foreground font-bold">{w.placer_username}</span>
                  <span className="text-mutedForeground text-[9px]">
                    {w.reward_amount} {w.reward_type} · {w.target_type}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const PlaceBountyCard = ({
  targetUsername,
  setTargetUsername,
  targetType,
  setTargetType,
  rewardCash,
  setRewardCash,
  rewardPoints,
  setRewardPoints,
  hidden,
  setHidden,
  totalCostCash,
  totalCostPoints,
  submitting,
  onSubmit,
  hasReward,
}) => (
  <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 hit-card hit-corner hit-fade-in`} style={{ animationDelay: '0.05s' }}>
    <div className="absolute top-0 left-0 w-20 h-20 bg-primary/5 rounded-full blur-2xl pointer-events-none hit-glow" />
    <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
    <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20">
      <h2 className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em]">
        💰 Place a Bounty
      </h2>
    </div>
    <div className="p-2">
      <form onSubmit={onSubmit} className="space-y-2">
        <div>
          <label className="block text-[10px] text-mutedForeground font-heading mb-1">
            Target Username
          </label>
          <input
            type="text"
            value={targetUsername}
            onChange={(e) => setTargetUsername(e.target.value)}
            placeholder="Enter username..."
            className="w-full bg-input border border-border rounded px-2 py-1.5 text-[11px] text-foreground placeholder:text-mutedForeground focus:border-primary/50 focus:outline-none transition-colors font-heading"
            required
          />
        </div>

        <div>
          <label className="block text-[10px] text-mutedForeground font-heading mb-1">
            Target Type
          </label>
          <select
            value={targetType}
            onChange={(e) => setTargetType(e.target.value)}
            className="w-full bg-input border border-border rounded px-2 py-1.5 text-[11px] text-foreground focus:border-primary/50 focus:outline-none transition-colors font-heading"
          >
            <option value="user">User</option>
            <option value="bodyguards">Bodyguards</option>
          </select>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <div>
            <label className="block text-[10px] text-mutedForeground font-heading mb-1">
              Cash reward ($)
            </label>
            <FormattedNumberInput
              value={rewardCash}
              onChange={setRewardCash}
              placeholder="0"
              className="w-full bg-input border border-border rounded px-2 py-1.5 text-[11px] text-foreground placeholder:text-mutedForeground focus:border-primary/50 focus:outline-none transition-colors font-heading"
            />
          </div>
          <div>
            <label className="block text-[10px] text-mutedForeground font-heading mb-1">
              Points reward
            </label>
            <FormattedNumberInput
              value={rewardPoints}
              onChange={setRewardPoints}
              placeholder="0"
              className="w-full bg-input border border-border rounded px-2 py-1.5 text-[11px] text-foreground placeholder:text-mutedForeground focus:border-primary/50 focus:outline-none transition-colors font-heading"
            />
          </div>
        </div>
        <p className="text-[9px] text-mutedForeground font-heading">
          Use one or both. At least one reward must be greater than 0.
        </p>
        {(totalCostCash > 0 || totalCostPoints > 0) && (
          <p className="text-[9px] text-mutedForeground font-heading">
            Cost to you:{' '}
            <span className="text-foreground font-bold">
              {[totalCostCash > 0 && `$${totalCostCash.toLocaleString()}`, totalCostPoints > 0 && `${totalCostPoints.toLocaleString()} pts`].filter(Boolean).join(' + ')}
            </span>
            {hidden && <span className="text-amber-400"> (+50% for hidden)</span>}
          </p>
        )}

        <label className="flex items-center gap-2 cursor-pointer p-2 rounded bg-secondary/30 border border-border hover:bg-secondary/50 transition-colors">
          <input
            type="checkbox"
            checked={hidden}
            onChange={(e) => setHidden(e.target.checked)}
            className="w-3.5 h-3.5 rounded border-border text-primary focus:ring-primary/50 cursor-pointer"
          />
          <span className="text-[10px] font-heading text-foreground">
            Hidden bounty <span className="text-mutedForeground">(+50% cost · your name won't show)</span>
          </span>
        </label>

        <button
          type="submit"
          disabled={submitting || !targetUsername.trim() || !hasReward}
          className="w-full bg-primary/20 text-primary rounded-md px-2.5 py-2 font-heading font-bold uppercase tracking-wide text-[10px] border border-primary/40 hover:bg-primary/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 touch-manipulation"
        >
          {submitting ? 'Placing...' : 'Place Bounty'}
        </button>
      </form>
    </div>
    <div className="hit-art-line text-primary mx-2.5" />
  </div>
);

const BUY_OFF_MULTIPLIER = 1.5;

function getBuyOffCostForTarget(list, targetUsername) {
  const entries = list.filter((i) => i.target_username === targetUsername && i.target_type !== 'npc');
  const cash = Math.floor(entries.filter((e) => e.reward_type === 'cash').reduce((s, e) => s + (e.reward_amount || 0) * BUY_OFF_MULTIPLIER, 0));
  const points = Math.floor(entries.filter((e) => e.reward_type === 'points').reduce((s, e) => s + (e.reward_amount || 0) * BUY_OFF_MULTIPLIER, 0));
  return { cash, points };
}

const ActiveBountiesCard = ({ list, user, onBuyOffUser, buyingOffTarget }) => {
  const isFirstForTarget = (item, index) =>
    item.target_type !== 'npc' &&
    list.findIndex((i) => i.target_username === item.target_username && i.target_type !== 'npc') === index;
  const haveCash = Number(user?.money ?? 0);
  const havePoints = Number(user?.points ?? 0);
  const canAffordBuyOff = (cash, points) =>
    (cash === 0 || haveCash >= cash) && (points === 0 || havePoints >= points);

  return (
  <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 hit-card hit-corner hit-fade-in`} style={{ animationDelay: '0.1s' }}>
    <div className="absolute top-0 left-0 w-20 h-20 bg-primary/5 rounded-full blur-2xl pointer-events-none hit-glow" />
    <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
    <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20">
      <h2 className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em] flex items-center justify-between">
        <span>🎯 Active Bounties</span>
        <span className="px-1.5 py-0.5 rounded bg-primary/20 text-primary text-[9px] font-heading font-bold border border-primary/30">
          {list.length}
        </span>
      </h2>
    </div>
    
    {list.length === 0 ? (
      <div className="py-8 text-center">
        <Target size={28} className="mx-auto text-primary/30 mb-2" />
        <p className="text-[10px] text-mutedForeground font-heading">
          No active bounties
        </p>
      </div>
    ) : (
      <>
        {/* Desktop: Table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-[11px] font-heading">
            <thead>
              <tr className="bg-zinc-800/50 text-[8px] uppercase tracking-[0.1em] font-heading text-zinc-500 border-b border-zinc-700/40">
                <th className="text-left py-1.5 px-2">Target</th>
                <th className="text-left py-1.5 px-2">Type</th>
                <th className="text-left py-1.5 px-2">Reward</th>
                <th className="text-left py-1.5 px-2">Placed By</th>
                <th className="text-left py-1.5 px-2">Buy Off</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-700/30">
              {list.map((item, index) => {
                const showBuyOff = isFirstForTarget(item, index);
                const cost = showBuyOff ? getBuyOffCostForTarget(list, item.target_username) : null;
                const costLabel = cost && (cost.cash > 0 || cost.points > 0)
                  ? [cost.cash > 0 && `$${cost.cash.toLocaleString()}`, cost.points > 0 && `${cost.points.toLocaleString()} pts`].filter(Boolean).join(' + ')
                  : null;
                const buying = buyingOffTarget === item.target_username;
                const afford = cost && canAffordBuyOff(cost.cash, cost.points);
                return (
                <tr key={item.id} className="hit-row">
                  <td className="py-1.5 px-2">
                    <div className="flex items-center gap-1">
                      {item.target_type === 'npc' ? (
                        <span className="text-foreground font-bold truncate text-[11px]">{item.target_username}</span>
                      ) : (
                        <Link to={`/profile/${encodeURIComponent(item.target_username)}`} className="text-primary hover:underline font-bold truncate text-[11px]">{item.target_username}</Link>
                      )}
                      <Link
                        to={`/attack?target=${encodeURIComponent(item.target_username)}`}
                        className="shrink-0 p-0.5 rounded hover:bg-primary/20 text-primary transition-colors"
                        title="Search on Attack page"
                      >
                        <Search size={10} />
                      </Link>
                    </div>
                  </td>
                  <td className="py-1.5 px-2 text-mutedForeground">
                    <div className="flex items-center gap-0.5">
                      {item.target_type === 'bodyguards' ? (
                        <>
                          <Users size={10} />
                          Bodyguards
                        </>
                      ) : item.target_type === 'npc' ? (
                        <>NPC</>
                      ) : (
                        <>
                          <User size={10} />
                          User
                        </>
                      )}
                    </div>
                  </td>
                  <td className="py-1.5 px-2">
                    <div className="flex items-center gap-0.5 text-primary font-bold">
                      {item.reward_type === 'cash' ? (
                        <>
                          <DollarSign size={10} />
                          ${Number(item.reward_amount).toLocaleString()}
                        </>
                      ) : (
                        <>
                          <Coins size={10} />
                          {Number(item.reward_amount).toLocaleString()} pts
                        </>
                      )}
                    </div>
                  </td>
                  <td className="py-1.5 px-2 text-mutedForeground">
                    {item.placer_username ?? 'Hidden'}
                  </td>
                  <td className="py-1.5 px-2">
                    {showBuyOff && costLabel && (
                      <button
                        type="button"
                        onClick={() => onBuyOffUser?.(item.target_username)}
                        disabled={buying || !afford}
                        className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-heading font-bold uppercase tracking-wider bg-primary/20 text-primary border border-primary/40 hover:bg-primary/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        <ShieldOff size={9} />
                        {buying ? '...' : `Buy off (${costLabel})`}
                      </button>
                    )}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        
        {/* Mobile: Cards */}
        <div className="md:hidden divide-y divide-zinc-700/30">
          {list.map((item, index) => {
            const showBuyOff = isFirstForTarget(item, index);
            const cost = showBuyOff ? getBuyOffCostForTarget(list, item.target_username) : null;
            const costLabel = cost && (cost.cash > 0 || cost.points > 0)
              ? [cost.cash > 0 && `$${cost.cash.toLocaleString()}`, cost.points > 0 && `${cost.points.toLocaleString()} pts`].filter(Boolean).join(' + ')
              : null;
            const buying = buyingOffTarget === item.target_username;
            const afford = cost && canAffordBuyOff(cost.cash, cost.points);
            return (
            <div key={item.id} className="hit-row p-2 space-y-1.5">
              <div className="flex items-start justify-between gap-1.5">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1 mb-0.5">
                    {item.target_type === 'npc' ? (
                      <span className="text-foreground font-heading font-bold text-[11px] truncate">{item.target_username}</span>
                    ) : (
                      <Link to={`/profile/${encodeURIComponent(item.target_username)}`} className="text-primary hover:underline font-heading font-bold text-[11px] truncate">{item.target_username}</Link>
                    )}
                    <Link
                      to={`/attack?target=${encodeURIComponent(item.target_username)}`}
                      className="shrink-0 p-0.5 rounded hover:bg-primary/20 text-primary transition-colors"
                      title="Search on Attack page"
                    >
                      <Search size={10} />
                    </Link>
                  </div>
                  <div className="flex items-center gap-0.5 text-[9px] text-mutedForeground font-heading">
                    {item.target_type === 'bodyguards' ? (
                      <>
                        <Users size={9} />
                        Bodyguards
                      </>
                    ) : item.target_type === 'npc' ? (
                      <>NPC</>
                    ) : (
                      <>
                        <User size={9} />
                        User
                      </>
                    )}
                  </div>
                </div>
                
                <div className="text-right">
                  <div className="flex items-center gap-0.5 text-primary font-heading font-bold text-[11px]">
                    {item.reward_type === 'cash' ? (
                      <>
                        <DollarSign size={10} />
                        ${Number(item.reward_amount).toLocaleString()}
                      </>
                    ) : (
                      <>
                        <Coins size={10} />
                        {Number(item.reward_amount).toLocaleString()}
                      </>
                    )}
                  </div>
                </div>
              </div>
              
              <div className="text-[9px] text-mutedForeground font-heading">
                Placed by: <span className="text-foreground">{item.placer_username ?? 'Hidden'}</span>
              </div>
              {showBuyOff && costLabel && (
                <button
                  type="button"
                  onClick={() => onBuyOffUser?.(item.target_username)}
                  disabled={buying || !afford}
                  className="w-full inline-flex items-center justify-center gap-1 py-1.5 rounded text-[9px] font-heading font-bold uppercase tracking-wider bg-primary/20 text-primary border border-primary/40 hover:bg-primary/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <ShieldOff size={9} />
                  {buying ? 'Buying off...' : `Buy off ${item.target_username} (${costLabel})`}
                </button>
              )}
            </div>
            );
          })}
        </div>
      </>
    )}
    <div className="hit-art-line text-primary mx-2.5" />
  </div>
  );
};

const InfoCard = () => (
  <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 hit-fade-in`} style={{ animationDelay: '0.15s' }}>
    <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
    <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20">
      <h3 className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em]">
        ℹ️ How It Works
      </h3>
    </div>
    <div className="p-2">
      <div className="space-y-1 text-[10px] text-mutedForeground font-heading leading-snug">
        <p className="flex items-start gap-1">
          <span className="text-primary shrink-0">•</span>
          <span>
            Place bounties on <strong className="text-foreground">users</strong> or their <strong className="text-foreground">bodyguards</strong> using cash or points
          </span>
        </p>
        <p className="flex items-start gap-1">
          <span className="text-primary shrink-0">•</span>
          <span>
            <strong className="text-amber-400">Hidden bounties</strong> cost 50% extra · your name won't appear as the placer
          </span>
        </p>
        <p className="flex items-start gap-1">
          <span className="text-primary shrink-0">•</span>
          <span>
            <strong className="text-foreground">Buy yourself off</strong> at bounty amount + 50% (same currency: $1M bounty = $1.5M to remove)
          </span>
        </p>
        <p className="flex items-start gap-1">
          <span className="text-primary shrink-0">•</span>
          <span>
            Pay <strong className="text-primary">5,000 points</strong> once to reveal who placed bounties on you
          </span>
        </p>
      </div>
    </div>
    <div className="hit-art-line text-primary mx-2.5" />
  </div>
);

// Main component
export default function HitlistPage() {
  const [list, setList] = useState([]);
  const [me, setMe] = useState(null);
  const [user, setUser] = useState(null);
  const [npcStatus, setNpcStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [addingNpc, setAddingNpc] = useState(false);
  const [targetUsername, setTargetUsername] = useState('');
  const [targetType, setTargetType] = useState('user');
  const [rewardCash, setRewardCash] = useState('');
  const [rewardPoints, setRewardPoints] = useState('');
  const [hidden, setHidden] = useState(false);
  const [buyingOffTarget, setBuyingOffTarget] = useState(null);

  const fetchData = async () => {
    try {
      const [listRes, meRes, userRes, npcStatusRes] = await Promise.all([
        api.get('/hitlist/list'),
        api.get('/hitlist/me'),
        api.get('/auth/me'),
        api.get('/hitlist/npc-status').catch(() => ({ data: null }))
      ]);
      setList(listRes.data?.items || []);
      setMe(meRes.data);
      setUser(userRes.data);
      setNpcStatus(npcStatusRes.data);
    } catch (e) {
      toast.error('Failed to load hitlist');
      console.error('Error fetching hitlist:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const mult = hidden ? 1.5 : 1;
  const cashAmt = parseInt(rewardCash, 10) || 0;
  const pointsAmt = parseInt(rewardPoints, 10) || 0;
  const totalCostCash = Math.floor(cashAmt * mult);
  const totalCostPoints = Math.floor(pointsAmt * mult);
  const hasReward = cashAmt >= 1 || pointsAmt >= 1;

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!hasReward) {
      toast.error('Enter at least one reward (cash and/or points)');
      return;
    }
    if (!targetUsername.trim()) {
      toast.error('Enter a target username');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/hitlist/add', {
        target_username: targetUsername.trim(),
        target_type: targetType,
        reward_cash: cashAmt,
        reward_points: pointsAmt,
        hidden
      });
      toast.success('Bounty placed');
      setTargetUsername('');
      setRewardCash('');
      setRewardPoints('');
      setHidden(false);
      refreshUser();
      fetchData();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to place bounty');
    } finally {
      setSubmitting(false);
    }
  };

  const handleBuyOff = async () => {
    setSubmitting(true);
    try {
      const res = await api.post('/hitlist/buy-off');
      toast.success(res.data?.message);
      refreshUser();
      fetchData();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to buy off');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReveal = async () => {
    setSubmitting(true);
    try {
      const res = await api.post('/hitlist/reveal');
      toast.success(res.data?.message);
      setMe({ ...me, revealed: true, who: res.data?.who || [] });
      refreshUser();
      fetchData();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to reveal');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddNpc = async () => {
    if (!npcStatus?.can_add || addingNpc) return;
    setAddingNpc(true);
    try {
      const res = await api.post('/hitlist/add-npc');
      toast.success(res.data?.message);
      refreshUser();
      fetchData();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to add NPC');
    } finally {
      setAddingNpc(false);
    }
  };

  const handleBuyOffUser = async (targetUsername) => {
    if (!targetUsername || buyingOffTarget) return;
    setBuyingOffTarget(targetUsername);
    try {
      const res = await api.post('/hitlist/buy-off-user', { target_username: targetUsername });
      toast.success(res.data?.message);
      refreshUser();
      fetchData();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to buy off');
    } finally {
      setBuyingOffTarget(null);
    }
  };

  if (loading) {
    return <LoadingSpinner />;
  }

  const revealed = me?.revealed ?? false;
  const who = me?.who ?? [];

  return (
    <div className={`space-y-2 ${styles.pageContent}`} data-testid="hitlist-page">
      <style>{HITLIST_STYLES}</style>

      {/* Page header */}
      <div className="relative hit-fade-in">
        <p className="text-[9px] text-zinc-500 font-heading italic">Place bounties, buy yourself off, see who wants you dead.</p>
      </div>

      <AddNpcCard
        npcStatus={npcStatus}
        addingNpc={addingNpc}
        onAddNpc={handleAddNpc}
      />

      <YoureOnHitlistCard
        me={me}
        user={user}
        revealed={revealed}
        who={who}
        submitting={submitting}
        onBuyOff={handleBuyOff}
        onReveal={handleReveal}
      />

      <PlaceBountyCard
        targetUsername={targetUsername}
        setTargetUsername={setTargetUsername}
        targetType={targetType}
        setTargetType={setTargetType}
        rewardCash={rewardCash}
        setRewardCash={setRewardCash}
        rewardPoints={rewardPoints}
        setRewardPoints={setRewardPoints}
        hidden={hidden}
        setHidden={setHidden}
        totalCostCash={totalCostCash}
        totalCostPoints={totalCostPoints}
        submitting={submitting}
        onSubmit={handleAdd}
        hasReward={hasReward}
      />

      <ActiveBountiesCard
        list={list}
        user={user}
        onBuyOffUser={handleBuyOffUser}
        buyingOffTarget={buyingOffTarget}
      />

      <InfoCard />
    </div>
  );
}
