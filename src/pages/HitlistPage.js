import { useState, useEffect } from 'react';
import { Target, Eye, ShieldOff, DollarSign, Coins, User, Users, UserPlus, Clock, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import api, { refreshUser } from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

// Subcomponents
const LoadingSpinner = () => (
  <div className="flex items-center justify-center min-h-[60vh]">
    <div className="text-primary text-xl font-heading font-bold">Loading...</div>
  </div>
);

const PageHeader = () => (
  <div>
    <h1 className="text-2xl sm:text-4xl md:text-5xl font-heading font-bold text-primary mb-1 md:mb-2 flex items-center gap-3">
      <Target className="w-8 h-8 md:w-10 md:h-10" />
      Hitlist
    </h1>
    <p className="text-sm text-mutedForeground">
      Place bounties on users or bodyguards · Add NPCs for target practice
    </p>
  </div>
);

const AddNpcCard = ({ npcStatus, addingNpc, onAddNpc }) => {
  if (!npcStatus) return null;
  
  return (
    <div className="bg-card rounded-md overflow-hidden border border-primary/20">
      <div className="px-4 py-2.5 bg-primary/10 border-b border-primary/30">
        <h2 className="text-sm font-heading font-bold text-primary uppercase tracking-widest flex items-center gap-2">
          <UserPlus size={16} />
          Add NPC Target
        </h2>
      </div>
      <div className="p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex-1">
          <p className="text-sm text-foreground font-heading mb-1">
            Add a random NPC to practice attacking
          </p>
          <p className="text-xs text-mutedForeground font-heading">
            Max {npcStatus.max_per_window ?? 3} per {npcStatus.window_hours ?? 3} hours · Attack from the Attack page
          </p>
        </div>
        
        {npcStatus.can_add ? (
          <button
            type="button"
            onClick={onAddNpc}
            disabled={addingNpc}
            className="bg-gradient-to-r from-primary via-yellow-600 to-primary hover:from-yellow-500 hover:via-yellow-600 hover:to-yellow-500 text-black rounded-lg px-4 py-2.5 font-heading font-bold uppercase tracking-wide text-sm border-2 border-yellow-600/50 shadow-lg shadow-primary/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 inline-flex items-center gap-2 touch-manipulation whitespace-nowrap"
            data-testid="hitlist-add-npc"
          >
            <UserPlus size={16} />
            {addingNpc ? 'Adding...' : 'Add NPC'}
          </button>
        ) : (
          <div className="flex items-center gap-2 text-sm text-mutedForeground font-heading bg-secondary/50 px-4 py-2 rounded-md border border-border">
            <Clock size={16} />
            <span className="text-xs">
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
        <div className="bg-card rounded-md overflow-hidden border border-border">
          <div className="px-4 py-2 bg-secondary/50 border-b border-border">
            <h2 className="text-sm font-heading font-bold text-mutedForeground uppercase tracking-widest">
              Previously on hitlist (revealed)
            </h2>
          </div>
          <div className="p-4">
            <h3 className="text-xs font-heading font-bold text-primary uppercase tracking-widest mb-3">Who had placed bounties</h3>
            <div className="space-y-2">
              {who.map((w, i) => (
                <div key={i} className="flex items-center justify-between gap-2 text-sm font-heading bg-secondary/30 rounded-md p-2 border border-border">
                  <span className="text-foreground font-bold">{w.placer_username}</span>
                  <span className="text-mutedForeground text-xs">
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
    <div className="bg-card rounded-md overflow-hidden border-2 border-red-500/30 shadow-lg shadow-red-500/10">
      <div className="px-4 py-2.5 bg-red-500/10 border-b border-red-500/30">
        <h2 className="text-sm font-heading font-bold text-red-400 uppercase tracking-widest flex items-center gap-2">
          <Target size={16} />
          You're on the Hitlist
        </h2>
      </div>
      <div className="p-4 space-y-4">
        {onHitlist && (
          <div className="bg-secondary/50 rounded-md p-3 border border-border">
            <div className="text-sm font-heading">
              <span className="text-primary font-bold text-lg">{me.count}</span>{' '}
              <span className="text-mutedForeground">
                {me.count === 1 ? 'bounty' : 'bounties'} placed on you
              </span>
            </div>
            <div className="text-sm text-mutedForeground font-heading mt-1">
              Total reward:{' '}
              {me.total_cash > 0 && <span className="text-emerald-400 font-bold">${Number(me.total_cash).toLocaleString()}</span>}
              {me.total_cash > 0 && me.total_points > 0 && <span className="text-mutedForeground"> + </span>}
              {me.total_points > 0 && <span className="text-primary font-bold">{Number(me.total_points).toLocaleString()} pts</span>}
            </div>
          </div>
        )}
        
        <div className="flex flex-col sm:flex-row gap-3">
          {onHitlist && (
            <button
              onClick={onBuyOff}
              disabled={submitting || !canAfford}
              className="flex-1 bg-gradient-to-r from-primary via-yellow-600 to-primary hover:from-yellow-500 hover:via-yellow-600 hover:to-yellow-500 text-black rounded-lg px-4 py-2.5 font-heading font-bold uppercase tracking-wide text-sm border-2 border-yellow-600/50 shadow-lg shadow-primary/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 inline-flex items-center justify-center gap-2 touch-manipulation"
            >
              <ShieldOff size={16} />
              Buy Off ({costLabel})
            </button>
          )}
          
          {!revealed && (
            <button
              onClick={onReveal}
              disabled={submitting || (user?.points ?? 0) < 5000}
              className="flex-1 bg-secondary text-foreground border border-border hover:bg-secondary/80 hover:border-primary/30 rounded-lg px-4 py-2.5 font-heading font-bold uppercase tracking-wide text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 inline-flex items-center justify-center gap-2 touch-manipulation"
            >
              <Eye size={16} />
              Reveal (5,000 pts)
            </button>
          )}
        </div>
        
        {revealed && who.length > 0 && (
          <div className="pt-4 border-t border-border">
            <h3 className="text-xs font-heading font-bold text-primary uppercase tracking-widest mb-3">
              Who Placed Bounties
            </h3>
            <div className="space-y-2">
              {who.map((w, i) => (
                <div key={i} className="flex items-center justify-between gap-2 text-sm font-heading bg-secondary/30 rounded-md p-2 border border-border">
                  <span className="text-foreground font-bold">{w.placer_username}</span>
                  <span className="text-mutedForeground text-xs">
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
  <div className="bg-card rounded-md overflow-hidden border border-primary/20">
    <div className="px-4 py-2.5 bg-primary/10 border-b border-primary/30">
      <h2 className="text-sm font-heading font-bold text-primary uppercase tracking-widest">
        💰 Place a Bounty
      </h2>
    </div>
    <div className="p-4">
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className="block text-sm text-mutedForeground font-heading mb-2">
            Target Username
          </label>
          <input
            type="text"
            value={targetUsername}
            onChange={(e) => setTargetUsername(e.target.value)}
            placeholder="Enter username..."
            className="w-full bg-input border border-border rounded-md px-3 py-2.5 text-sm text-foreground placeholder:text-mutedForeground focus:border-primary/50 focus:outline-none transition-colors font-heading"
            required
          />
        </div>

        <div>
          <label className="block text-sm text-mutedForeground font-heading mb-2">
            Target Type
          </label>
          <select
            value={targetType}
            onChange={(e) => setTargetType(e.target.value)}
            className="w-full bg-input border border-border rounded-md px-3 py-2.5 text-sm text-foreground focus:border-primary/50 focus:outline-none transition-colors font-heading"
          >
            <option value="user">User</option>
            <option value="bodyguards">Bodyguards</option>
          </select>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-mutedForeground font-heading mb-2">
              Cash reward ($)
            </label>
            <input
              type="number"
              min="0"
              value={rewardCash}
              onChange={(e) => setRewardCash(e.target.value)}
              placeholder="0"
              className="w-full bg-input border border-border rounded-md px-3 py-2.5 text-sm text-foreground placeholder:text-mutedForeground focus:border-primary/50 focus:outline-none transition-colors font-heading"
            />
          </div>
          <div>
            <label className="block text-sm text-mutedForeground font-heading mb-2">
              Points reward
            </label>
            <input
              type="number"
              min="0"
              value={rewardPoints}
              onChange={(e) => setRewardPoints(e.target.value)}
              placeholder="0"
              className="w-full bg-input border border-border rounded-md px-3 py-2.5 text-sm text-foreground placeholder:text-mutedForeground focus:border-primary/50 focus:outline-none transition-colors font-heading"
            />
          </div>
        </div>
        <p className="text-xs text-mutedForeground font-heading">
          Use one or both. At least one reward must be greater than 0.
        </p>
        {(totalCostCash > 0 || totalCostPoints > 0) && (
          <p className="text-xs text-mutedForeground font-heading">
            Cost to you:{' '}
            <span className="text-foreground font-bold">
              {[totalCostCash > 0 && `$${totalCostCash.toLocaleString()}`, totalCostPoints > 0 && `${totalCostPoints.toLocaleString()} pts`].filter(Boolean).join(' + ')}
            </span>
            {hidden && <span className="text-amber-400"> (+50% for hidden)</span>}
          </p>
        )}

        <label className="flex items-center gap-3 cursor-pointer p-3 rounded-md bg-secondary/30 border border-border hover:bg-secondary/50 transition-colors">
          <input
            type="checkbox"
            checked={hidden}
            onChange={(e) => setHidden(e.target.checked)}
            className="w-4 h-4 rounded border-border text-primary focus:ring-primary/50 cursor-pointer"
          />
          <span className="text-sm font-heading text-foreground">
            Hidden bounty <span className="text-mutedForeground">(+50% cost · your name won't show)</span>
          </span>
        </label>

        <button
          type="submit"
          disabled={submitting || !targetUsername.trim() || !hasReward}
          className="w-full bg-gradient-to-r from-primary via-yellow-600 to-primary hover:from-yellow-500 hover:via-yellow-600 hover:to-yellow-500 text-black rounded-lg px-4 py-3 font-heading font-bold uppercase tracking-wide text-sm border-2 border-yellow-600/50 shadow-lg shadow-primary/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 touch-manipulation"
        >
          {submitting ? 'Placing...' : 'Place Bounty'}
        </button>
      </form>
    </div>
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
  <div className="bg-card rounded-md overflow-hidden border border-primary/20">
    <div className="px-4 py-2.5 bg-primary/10 border-b border-primary/30">
      <h2 className="text-sm font-heading font-bold text-primary uppercase tracking-widest flex items-center justify-between">
        <span>🎯 Active Bounties</span>
        <span className="px-2 py-1 rounded-md bg-primary/20 text-primary text-xs border border-primary/30">
          {list.length}
        </span>
      </h2>
    </div>
    
    {list.length === 0 ? (
      <div className="py-16 text-center">
        <Target size={48} className="mx-auto text-primary/30 mb-3" />
        <p className="text-sm text-mutedForeground font-heading">
          No active bounties
        </p>
      </div>
    ) : (
      <>
        {/* Desktop: Table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm font-heading">
            <thead>
              <tr className="bg-secondary/30 text-xs uppercase tracking-wider text-primary/80 border-b border-border">
                <th className="text-left py-2.5 px-4">Target</th>
                <th className="text-left py-2.5 px-4">Type</th>
                <th className="text-left py-2.5 px-4">Reward</th>
                <th className="text-left py-2.5 px-4">Placed By</th>
                <th className="text-left py-2.5 px-4">Buy Off</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {list.map((item, index) => {
                const showBuyOff = isFirstForTarget(item, index);
                const cost = showBuyOff ? getBuyOffCostForTarget(list, item.target_username) : null;
                const costLabel = cost && (cost.cash > 0 || cost.points > 0)
                  ? [cost.cash > 0 && `$${cost.cash.toLocaleString()}`, cost.points > 0 && `${cost.points.toLocaleString()} pts`].filter(Boolean).join(' + ')
                  : null;
                const buying = buyingOffTarget === item.target_username;
                const afford = cost && canAffordBuyOff(cost.cash, cost.points);
                return (
                <tr key={item.id} className="hover:bg-secondary/30 transition-colors">
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <span className="text-foreground font-bold truncate">{item.target_username}</span>
                      <Link
                        to={`/attack?target=${encodeURIComponent(item.target_username)}`}
                        className="shrink-0 p-1 rounded hover:bg-primary/20 text-primary transition-colors"
                        title="Search on Attack page"
                      >
                        <Search size={14} />
                      </Link>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-mutedForeground">
                    <div className="flex items-center gap-1.5">
                      {item.target_type === 'bodyguards' ? (
                        <>
                          <Users size={14} />
                          Bodyguards
                        </>
                      ) : item.target_type === 'npc' ? (
                        <>NPC</>
                      ) : (
                        <>
                          <User size={14} />
                          User
                        </>
                      )}
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-1.5 text-primary font-bold">
                      {item.reward_type === 'cash' ? (
                        <>
                          <DollarSign size={14} />
                          ${Number(item.reward_amount).toLocaleString()}
                        </>
                      ) : (
                        <>
                          <Coins size={14} />
                          {Number(item.reward_amount).toLocaleString()} pts
                        </>
                      )}
                    </div>
                  </td>
                  <td className="py-3 px-4 text-mutedForeground">
                    {item.placer_username ?? 'Hidden'}
                  </td>
                  <td className="py-3 px-4">
                    {showBuyOff && costLabel && (
                      <button
                        type="button"
                        onClick={() => onBuyOffUser?.(item.target_username)}
                        disabled={buying || !afford}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-sm text-xs font-heading font-bold uppercase tracking-wider bg-primary/20 text-primary border border-primary/40 hover:bg-primary/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        <ShieldOff size={12} />
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
        <div className="md:hidden divide-y divide-border">
          {list.map((item, index) => {
            const showBuyOff = isFirstForTarget(item, index);
            const cost = showBuyOff ? getBuyOffCostForTarget(list, item.target_username) : null;
            const costLabel = cost && (cost.cash > 0 || cost.points > 0)
              ? [cost.cash > 0 && `$${cost.cash.toLocaleString()}`, cost.points > 0 && `${cost.points.toLocaleString()} pts`].filter(Boolean).join(' + ')
              : null;
            const buying = buyingOffTarget === item.target_username;
            const afford = cost && canAffordBuyOff(cost.cash, cost.points);
            return (
            <div key={item.id} className="p-4 space-y-3 hover:bg-secondary/30 transition-colors">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-foreground font-heading font-bold text-base truncate">
                      {item.target_username}
                    </span>
                    <Link
                      to={`/attack?target=${encodeURIComponent(item.target_username)}`}
                      className="shrink-0 p-1 rounded hover:bg-primary/20 text-primary transition-colors"
                      title="Search on Attack page"
                    >
                      <Search size={14} />
                    </Link>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-mutedForeground font-heading">
                    {item.target_type === 'bodyguards' ? (
                      <>
                        <Users size={12} />
                        Bodyguards
                      </>
                    ) : item.target_type === 'npc' ? (
                      <>NPC</>
                    ) : (
                      <>
                        <User size={12} />
                        User
                      </>
                    )}
                  </div>
                </div>
                
                <div className="text-right">
                  <div className="flex items-center gap-1.5 text-primary font-heading font-bold text-sm">
                    {item.reward_type === 'cash' ? (
                      <>
                        <DollarSign size={14} />
                        ${Number(item.reward_amount).toLocaleString()}
                      </>
                    ) : (
                      <>
                        <Coins size={14} />
                        {Number(item.reward_amount).toLocaleString()}
                      </>
                    )}
                  </div>
                </div>
              </div>
              
              <div className="text-xs text-mutedForeground font-heading">
                Placed by: <span className="text-foreground">{item.placer_username ?? 'Hidden'}</span>
              </div>
              {showBuyOff && costLabel && (
                <button
                  type="button"
                  onClick={() => onBuyOffUser?.(item.target_username)}
                  disabled={buying || !afford}
                  className="w-full inline-flex items-center justify-center gap-2 py-2 rounded-md text-xs font-heading font-bold uppercase tracking-wider bg-primary/20 text-primary border border-primary/40 hover:bg-primary/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <ShieldOff size={14} />
                  {buying ? 'Buying off...' : `Buy off ${item.target_username} (${costLabel})`}
                </button>
              )}
            </div>
            );
          })}
        </div>
      </>
    )}
  </div>
  );
};

const InfoCard = () => (
  <div className="bg-card rounded-md overflow-hidden border border-primary/20">
    <div className="px-4 py-2.5 bg-primary/10 border-b border-primary/30">
      <h3 className="text-sm font-heading font-bold text-primary uppercase tracking-widest">
        ℹ️ How It Works
      </h3>
    </div>
    <div className="p-4">
      <div className="space-y-2 text-sm text-mutedForeground font-heading leading-relaxed">
        <p className="flex items-start gap-2">
          <span className="text-primary shrink-0">•</span>
          <span>
            Place bounties on <strong className="text-foreground">users</strong> or their <strong className="text-foreground">bodyguards</strong> using cash or points
          </span>
        </p>
        <p className="flex items-start gap-2">
          <span className="text-primary shrink-0">•</span>
          <span>
            <strong className="text-amber-400">Hidden bounties</strong> cost 50% extra · your name won't appear as the placer
          </span>
        </p>
        <p className="flex items-start gap-2">
          <span className="text-primary shrink-0">•</span>
          <span>
            <strong className="text-foreground">Buy yourself off</strong> at bounty amount + 50% (same currency: $1M bounty = $1.5M to remove)
          </span>
        </p>
        <p className="flex items-start gap-2">
          <span className="text-primary shrink-0">•</span>
          <span>
            Pay <strong className="text-primary">5,000 points</strong> once to reveal who placed bounties on you
          </span>
        </p>
      </div>
    </div>
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
    <div className={`space-y-4 md:space-y-6 ${styles.pageContent}`}>
      <PageHeader />

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
