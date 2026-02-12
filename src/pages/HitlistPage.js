import { useState, useEffect } from 'react';
import { Target, Eye, ShieldOff, DollarSign, Coins, User, Users } from 'lucide-react';
import api, { refreshUser } from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

export default function HitlistPage() {
  const [list, setList] = useState([]);
  const [me, setMe] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [targetUsername, setTargetUsername] = useState('');
  const [targetType, setTargetType] = useState('user');
  const [rewardType, setRewardType] = useState('cash');
  const [rewardAmount, setRewardAmount] = useState('');
  const [hidden, setHidden] = useState(false);

  const fetchData = async () => {
    try {
      const [listRes, meRes, userRes] = await Promise.all([
        api.get('/hitlist/list'),
        api.get('/hitlist/me'),
        api.get('/auth/me')
      ]);
      setList(listRes.data?.items || []);
      setMe(meRes.data);
      setUser(userRes.data);
    } catch (e) {
      toast.error('Failed to load hitlist');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const cost = () => {
    const amt = parseInt(rewardAmount, 10) || 0;
    if (amt < 1) return null;
    const mult = hidden ? 1.5 : 1;
    return Math.floor(amt * mult);
  };

  const handleAdd = async (e) => {
    e.preventDefault();
    const amt = parseInt(rewardAmount, 10) || 0;
    if (amt < 1) {
      toast.error('Reward amount must be at least 1');
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
        reward_type: rewardType,
        reward_amount: amt,
        hidden
      });
      toast.success('Bounty placed');
      setTargetUsername('');
      setRewardAmount('');
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

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-primary text-xl font-heading">Loading...</div>
      </div>
    );
  }

  const onHitlist = me?.on_hitlist ?? false;
  const revealed = me?.revealed ?? false;
  const who = me?.who ?? [];
  const totalCost = cost();

  return (
    <div className={`space-y-6 ${styles.pageContent}`}>
      <div>
        <div className="flex items-center gap-4 mb-3">
          <div className="h-px flex-1 bg-gradient-to-r from-transparent via-primary/40 to-primary/60" />
          <h1 className="text-3xl md:text-4xl font-heading font-bold text-primary tracking-wider uppercase">Hitlist</h1>
          <div className="h-px flex-1 bg-gradient-to-l from-transparent via-primary/40 to-primary/60" />
        </div>
        <p className="text-center text-mutedForeground font-heading tracking-wide">Place bounties on users or their bodyguards. Hidden bounties cost 50% extra.</p>
      </div>

      {/* You're on the hitlist */}
      {(onHitlist || revealed) && (
        <div className={`${styles.panel} rounded-sm overflow-hidden shadow-lg shadow-primary/5`}>
          <div className="px-4 py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30">
            <div className="flex items-center gap-2">
              <Target className="text-primary" size={18} />
              <h2 className="text-sm font-heading font-bold text-primary uppercase tracking-widest">You&apos;re on the hitlist</h2>
            </div>
          </div>
          <div className="p-4 space-y-3">
            {onHitlist && (
              <p className="text-sm text-mutedForeground">
                <span className="text-primary font-bold">{me.count}</span> bounty(ies) — total: {me.total_cash > 0 && `$${Number(me.total_cash).toLocaleString()} cash`}{me.total_cash > 0 && me.total_points > 0 && ' • '}{me.total_points > 0 && `${Number(me.total_points).toLocaleString()} pts`}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {onHitlist && (() => {
                const needCash = me?.buy_off_cash ?? 0;
                const needPoints = me?.buy_off_points ?? 0;
                const haveCash = Number(user?.money ?? 0);
                const havePoints = Number(user?.points ?? 0);
                const canAfford = (needCash === 0 || haveCash >= needCash) && (needPoints === 0 || havePoints >= needPoints);
                const costLabel = [needCash > 0 && `$${Number(needCash).toLocaleString()}`, needPoints > 0 && `${Number(needPoints).toLocaleString()} pts`].filter(Boolean).join(' + ');
                return (
                  <button
                    onClick={handleBuyOff}
                    disabled={submitting || !canAfford}
                    className="bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground hover:opacity-90 rounded-sm font-heading font-bold uppercase tracking-widest px-4 py-2 text-sm border border-yellow-600/50 disabled:opacity-50"
                  >
                    <span className="flex items-center gap-2"><ShieldOff size={16} /> Buy yourself off ({costLabel})</span>
                  </button>
                );
              })()}
              {!revealed && (
                <button
                  onClick={handleReveal}
                  disabled={submitting || (user?.points ?? 0) < 5000}
                  className={`${styles.surface} ${styles.raisedHover} border border-primary/30 text-primary rounded-sm font-heading font-bold uppercase tracking-widest px-4 py-2 text-sm disabled:opacity-50`}
                >
                  <span className="flex items-center gap-2"><Eye size={16} /> See who hitlisted you (5,000 pts)</span>
                </button>
              )}
            </div>
            {revealed && who.length > 0 && (
              <div className="mt-3 pt-3 border-t border-primary/20">
                <h3 className="text-xs font-heading font-bold text-primary uppercase tracking-widest mb-2">Who hitlisted you</h3>
                <ul className="space-y-1 text-sm">
                  {who.map((w, i) => (
                    <li key={i} className="flex items-center gap-2 text-mutedForeground">
                      <span className="text-primary font-heading">{w.placer_username}</span>
                      — {w.reward_amount} {w.reward_type} ({w.target_type})
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Add bounty */}
      <div className={`${styles.panel} rounded-sm overflow-hidden shadow-lg shadow-primary/5`}>
        <div className="px-4 py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30">
          <h2 className="text-sm font-heading font-bold text-primary uppercase tracking-widest">Place a bounty</h2>
        </div>
        <div className="p-4">
          <form onSubmit={handleAdd} className="space-y-4">
            <div>
              <label className="block text-xs font-heading font-bold text-primary uppercase tracking-wider mb-1">Target username</label>
              <input
                type="text"
                value={targetUsername}
                onChange={(e) => setTargetUsername(e.target.value)}
                placeholder="Username"
                className={`w-full ${styles.input} border border-primary/30 rounded-sm px-3 py-2 font-heading`}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-heading font-bold text-primary uppercase tracking-wider mb-1">Target</label>
                <select
                  value={targetType}
                  onChange={(e) => setTargetType(e.target.value)}
                  className={`w-full ${styles.input} border border-primary/30 rounded-sm px-3 py-2 font-heading`}
                >
                  <option value="user">User</option>
                  <option value="bodyguards">Bodyguards</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-heading font-bold text-primary uppercase tracking-wider mb-1">Reward type</label>
                <select
                  value={rewardType}
                  onChange={(e) => setRewardType(e.target.value)}
                  className={`w-full ${styles.input} border border-primary/30 rounded-sm px-3 py-2 font-heading`}
                >
                  <option value="cash">Cash</option>
                  <option value="points">Points</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-heading font-bold text-primary uppercase tracking-wider mb-1">Reward amount</label>
              <input
                type="number"
                min="1"
                value={rewardAmount}
                onChange={(e) => setRewardAmount(e.target.value)}
                placeholder="Amount"
                className={`w-full ${styles.input} border border-primary/30 rounded-sm px-3 py-2 font-heading`}
              />
              {totalCost != null && totalCost > 0 && (
                <p className="text-xs text-mutedForeground mt-1">
                  Cost: {rewardType === 'cash' ? `$${totalCost.toLocaleString()}` : `${totalCost} pts`}{hidden ? ' (50% extra for hidden)' : ''}
                </p>
              )}
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} className="rounded border-primary/50" />
              <span className="text-sm font-heading text-mutedForeground">Hidden (+50% cost) — your name won&apos;t show as placer</span>
            </label>
            <button
              type="submit"
              disabled={submitting || !targetUsername.trim() || !(parseInt(rewardAmount, 10) >= 1)}
              className="bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground hover:opacity-90 rounded-sm font-heading font-bold uppercase tracking-widest px-5 py-2 text-sm border border-yellow-600/50 disabled:opacity-50"
            >
              Place bounty
            </button>
          </form>
        </div>
      </div>

      {/* Hitlist table */}
      <div className={`${styles.panel} rounded-sm overflow-hidden shadow-lg shadow-primary/5`}>
        <div className="px-4 py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30">
          <h2 className="text-sm font-heading font-bold text-primary uppercase tracking-widest">Active bounties</h2>
        </div>
        <div className="overflow-x-auto">
          {list.length === 0 ? (
            <div className="p-6 text-center text-mutedForeground text-sm font-heading">No bounties on the list.</div>
          ) : (
            <table className="w-full text-sm font-heading">
              <thead>
                <tr className="border-b border-primary/20">
                  <th className="text-left py-2 px-3 text-primary uppercase tracking-wider">Target</th>
                  <th className="text-left py-2 px-3 text-primary uppercase tracking-wider">Type</th>
                  <th className="text-left py-2 px-3 text-primary uppercase tracking-wider">Reward</th>
                  <th className="text-left py-2 px-3 text-primary uppercase tracking-wider">Placed by</th>
                </tr>
              </thead>
              <tbody>
                {list.map((item) => (
                  <tr key={item.id} className="border-b border-primary/10 hover:bg-primary/5">
                    <td className="py-2 px-3 text-foreground font-medium">{item.target_username}</td>
                    <td className="py-2 px-3 text-mutedForeground">
                      {item.target_type === 'bodyguards' ? <span className="flex items-center gap-1"><Users size={14} /> Bodyguards</span> : <span className="flex items-center gap-1"><User size={14} /> User</span>}
                    </td>
                    <td className="py-2 px-3">
                      {item.reward_type === 'cash' ? <span className="flex items-center gap-1 text-primary"><DollarSign size={14} /> ${Number(item.reward_amount).toLocaleString()}</span> : <span className="flex items-center gap-1 text-primary"><Coins size={14} /> {Number(item.reward_amount).toLocaleString()} pts</span>}
                    </td>
                    <td className="py-2 px-3 text-mutedForeground">{item.placer_username ?? 'Hidden'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className={`${styles.panel} rounded-sm overflow-hidden`}>
        <div className="px-4 py-2 border-b border-primary/30">
          <h3 className="text-sm font-heading font-bold text-primary uppercase tracking-widest">About the hitlist</h3>
        </div>
        <div className="p-4">
          <ul className="space-y-1 text-xs text-mutedForeground font-heading">
            <li className="flex items-center gap-2"><span className="text-primary">◆</span> Place a bounty on a user or their bodyguards for cash or points.</li>
            <li className="flex items-center gap-2"><span className="text-primary">◆</span> Hidden bounties cost 50% extra; your name won&apos;t appear as the placer.</li>
            <li className="flex items-center gap-2"><span className="text-primary">◆</span> Buy yourself off at each bounty&apos;s amount + 50% (same currency: e.g. $1M bounty = $1.5M to buy off; 1,000 pts = 1,500 pts).</li>
            <li className="flex items-center gap-2"><span className="text-primary">◆</span> Pay 5,000 points once to see who placed bounties on you.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
