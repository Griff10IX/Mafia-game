import { useState, useEffect } from 'react';
import { Target, Eye, ShieldOff, DollarSign, Coins, User, Users, UserPlus, Clock, Crosshair } from 'lucide-react';
import { Link } from 'react-router-dom';
import api, { refreshUser } from '../utils/api';
import { toast } from 'sonner';
import { FormattedNumberInput } from '../components/FormattedNumberInput';

const BUY_OFF_MULTIPLIER = 1.5;

// Enhanced animations for 1920s mafia theme
const HITLIST_STYLES = `
  @keyframes hit-fade-in { 
    from { opacity: 0; transform: translateY(12px); } 
    to { opacity: 1; transform: translateY(0); } 
  }
  .hit-fade-in { animation: hit-fade-in 0.5s ease-out both; }
  
  @keyframes smoke-rise {
    0% { transform: translateY(0) scaleX(1); opacity: 0.4; }
    50% { transform: translateY(-20px) scaleX(1.5); opacity: 0.2; }
    100% { transform: translateY(-40px) scaleX(2); opacity: 0; }
  }
  .smoke-wisp { animation: smoke-rise 4s ease-out infinite; }
  
  @keyframes flicker {
    0%, 100% { opacity: 1; filter: brightness(1); }
    50% { opacity: 0.85; filter: brightness(0.9); }
    75% { opacity: 0.95; filter: brightness(0.95); }
  }
  .flicker-light { animation: flicker 3s ease-in-out infinite; }
  
  @keyframes stamp-appear {
    0% { transform: scale(2.5) rotate(-20deg); opacity: 0; }
    60% { transform: scale(1.1) rotate(-14deg); opacity: 1; }
    100% { transform: scale(1) rotate(-15deg); opacity: 0.9; }
  }
  .stamp { animation: stamp-appear 0.6s cubic-bezier(0.2, 0.8, 0.3, 1) forwards; }
  
  @keyframes coin-spin {
    0% { transform: rotateY(0deg); }
    100% { transform: rotateY(360deg); }
  }
  .coin-spin { animation: coin-spin 2s linear infinite; }
  
  @keyframes typewriter-blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0; }
  }
  .typewriter-cursor { animation: typewriter-blink 1s step-end infinite; }
  
  .bullet-hole {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: radial-gradient(circle, #0a0a0a 40%, #1a1a1a 60%, transparent 100%);
    box-shadow: inset 0 1px 2px rgba(0,0,0,0.8);
  }
  
  .ink-splatter {
    filter: blur(0.5px);
    opacity: 0.15;
  }
  
  .parchment-bg {
    background: linear-gradient(135deg, #f5f5dc 0%, #e8e5d0 100%);
    position: relative;
  }
  
  .parchment-texture::before {
    content: '';
    position: absolute;
    inset: 0;
    background-image: 
      radial-gradient(circle at 20% 30%, rgba(112, 66, 20, 0.03) 0%, transparent 50%),
      radial-gradient(circle at 80% 70%, rgba(112, 66, 20, 0.02) 0%, transparent 50%);
    pointer-events: none;
  }
`;

/* ═══════════════════════════════════════════════════════
   Decorative Components
   ═══════════════════════════════════════════════════════ */

// Cigarette smoke effect
const SmokeWisp = ({ delay = 0, className = "" }) => (
  <div className={`absolute w-6 h-6 ${className}`} style={{ animationDelay: `${delay}s` }}>
    <svg viewBox="0 0 24 24" className="w-full h-full smoke-wisp" style={{ animationDelay: `${delay}s` }}>
      <path d="M12 20 Q10 15, 12 10 Q14 15, 12 20 Z" fill="currentColor" className="text-zinc-500/30" />
      <path d="M10 18 Q9 14, 10 10 Q11 14, 10 18 Z" fill="currentColor" className="text-zinc-500/20" />
      <path d="M14 18 Q13 14, 14 10 Q15 14, 14 18 Z" fill="currentColor" className="text-zinc-500/20" />
    </svg>
  </div>
);

// Bullet hole decoration
const BulletHole = ({ top, left, right, bottom, size = "sm" }) => {
  const sizeClass = size === "sm" ? "w-1.5 h-1.5" : "w-2 h-2";
  return (
    <div className={`absolute ${sizeClass} bullet-hole`} style={{ top, left, right, bottom }} />
  );
};

// Ink splatter decoration
const InkSplatter = ({ className = "" }) => (
  <svg viewBox="0 0 32 32" className={`w-6 h-6 ink-splatter ${className}`}>
    <path d="M16,4 Q20,10 22,16 Q16,22 10,16 Q12,10 16,4 Z" fill="currentColor" className="text-zinc-900" />
    <circle cx="14" cy="14" r="1.5" fill="currentColor" className="text-zinc-900" />
    <circle cx="18" cy="16" r="1" fill="currentColor" className="text-zinc-900" />
    <circle cx="16" cy="20" r="1.2" fill="currentColor" className="text-zinc-900" />
  </svg>
);

// Animated coin
const CoinIcon = ({ className = "" }) => (
  <svg viewBox="0 0 24 24" className={`w-4 h-4 coin-spin ${className}`}>
    <circle cx="12" cy="12" r="10" fill="#d4af37" stroke="#8b6914" strokeWidth="1.5" />
    <circle cx="12" cy="12" r="7" fill="none" stroke="#8b6914" strokeWidth="0.5" />
    <text x="12" y="16" textAnchor="middle" className="text-[10px] font-bold" fill="#1a1a1a">P</text>
  </svg>
);

// Cash stack
const CashStack = ({ className = "" }) => (
  <svg viewBox="0 0 24 24" className={`w-5 h-4 ${className}`}>
    <rect x="2" y="10" width="20" height="6" rx="1" fill="#3d6f3d" stroke="#2d5f2d" strokeWidth="0.5" />
    <rect x="3" y="8" width="20" height="6" rx="1" fill="#4d7f4d" stroke="#3d6f3d" strokeWidth="0.5" />
    <rect x="4" y="6" width="20" height="6" rx="1" fill="#5d8f5d" stroke="#4d7f4d" strokeWidth="0.5" />
    <text x="14" y="11" className="text-[7px] font-bold" fill="#fff">$</text>
  </svg>
);

/* ═══════════════════════════════════════════════════════
   Loading Spinner
   ═══════════════════════════════════════════════════════ */
const LoadingSpinner = () => (
  <div className="space-y-3 px-3 sm:px-4">
    <style>{HITLIST_STYLES}</style>
    <div className="flex flex-col items-center justify-center min-h-[40vh] gap-3">
      <Target size={24} className="text-primary/40 animate-pulse" />
      <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      <span className="text-primary text-[10px] sm:text-xs font-heading uppercase tracking-[0.2em]">Loading contracts...</span>
    </div>
  </div>
);

/* ═══════════════════════════════════════════════════════
   Your Status Card (Combined)
   ═══════════════════════════════════════════════════════ */
const YourStatusCard = ({ me, user, revealed, who, submitting, onBuyOff, onReveal, npcStatus, addingNpc, onAddNpc }) => {
  const onHitlist = me?.on_hitlist ?? false;
  
  // Don't show if not on hitlist and no NPC status
  if (!onHitlist && !npcStatus) return null;
  
  const needCash = me?.buy_off_cash ?? 0;
  const needPoints = me?.buy_off_points ?? 0;
  const haveCash = Number(user?.money ?? 0);
  const havePoints = Number(user?.points ?? 0);
  const canAfford = (needCash === 0 || haveCash >= needCash) && (needPoints === 0 || havePoints >= needPoints);
  const costLabel = [needCash > 0 && `$${Number(needCash).toLocaleString()}`, needPoints > 0 && `${Number(needPoints).toLocaleString()}p`].filter(Boolean).join(' + ');
  
  return (
    <div className={`relative rounded-lg overflow-hidden border-2 ${onHitlist ? 'border-red-900/40 bg-gradient-to-br from-zinc-900 via-zinc-900/95 to-red-950/20' : 'border-primary/30 bg-gradient-to-br from-zinc-900 to-zinc-900/90'} hit-fade-in`}>
      {/* Decorative elements */}
      <SmokeWisp delay={0} className="top-2 left-2" />
      <SmokeWisp delay={1.5} className="top-2 right-2" />
      <BulletHole top="12px" right="16px" />
      <BulletHole bottom="16px" left="20px" size="md" />
      <InkSplatter className="absolute bottom-3 right-4" />
      
      {/* Header */}
      <div className={`relative px-2.5 sm:px-3 py-2 border-b-2 ${onHitlist ? 'border-red-900/40 bg-red-950/20' : 'border-primary/20 bg-primary/5'}`}>
        <div className="absolute inset-0 opacity-5 mix-blend-overlay" style={{
          backgroundImage: 'repeating-linear-gradient(90deg, transparent, transparent 2px, currentColor 2px, currentColor 4px)'
        }} />
        <h2 className={`relative text-[10px] sm:text-xs font-heading font-bold uppercase tracking-wider flex items-center gap-1.5 ${onHitlist ? 'text-red-400' : 'text-primary'}`}>
          {onHitlist ? <Target size={14} className="sm:w-4 sm:h-4" /> : <UserPlus size={14} className="sm:w-4 sm:h-4" />}
          {onHitlist ? '☠️ YOUR CONTRACTS' : '🎯 Your Status'}
        </h2>
      </div>
      
      <div className="p-2.5 sm:p-3 space-y-2.5 sm:space-y-3">
        {/* Stats if on hitlist */}
        {onHitlist && (
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded bg-zinc-800/50 p-2 sm:p-2.5 border border-zinc-700/40">
              <div className="text-[8px] sm:text-[9px] text-zinc-500 font-heading uppercase mb-0.5">Bounties</div>
              <div className="text-xl sm:text-2xl font-heading font-bold text-red-400">
                {me.count}
              </div>
            </div>
            
            <div className="rounded bg-zinc-800/50 p-2 sm:p-2.5 border border-zinc-700/40">
              <div className="text-[8px] sm:text-[9px] text-zinc-500 font-heading uppercase mb-0.5">Total Reward</div>
              <div className="flex flex-col gap-0.5">
                {me.total_cash > 0 && (
                  <div className="text-sm sm:text-base font-heading font-bold text-emerald-400 flex items-center gap-1">
                    <CashStack className="w-4 h-3 sm:w-5 sm:h-4" />
                    ${Number(me.total_cash).toLocaleString()}
                  </div>
                )}
                {me.total_points > 0 && (
                  <div className="text-xs sm:text-sm font-heading font-bold text-primary flex items-center gap-1">
                    <CoinIcon className="w-3 h-3 sm:w-4 sm:h-4" />
                    {Number(me.total_points).toLocaleString()}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        
        {/* Action buttons */}
        <div className="flex flex-wrap gap-1.5 sm:gap-2">
          {onHitlist && (
            <button
              onClick={onBuyOff}
              disabled={submitting || !canAfford}
              className="flex-1 min-w-[120px] bg-primary/20 text-primary rounded px-2.5 sm:px-3 py-1.5 sm:py-2 font-heading font-bold uppercase tracking-wide text-[9px] sm:text-[10px] border border-primary/40 hover:bg-primary/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 inline-flex items-center justify-center gap-1 touch-manipulation"
            >
              <ShieldOff size={10} className="sm:w-3 sm:h-3" />
              Buy Off {costLabel && `(${costLabel})`}
            </button>
          )}
          
          {onHitlist && !revealed && (
            <button
              onClick={onReveal}
              disabled={submitting || (user?.points ?? 0) < 5000}
              className="flex-1 min-w-[120px] bg-zinc-800 text-foreground border border-zinc-700/50 hover:bg-zinc-700 hover:border-primary/30 rounded px-2.5 sm:px-3 py-1.5 sm:py-2 font-heading font-bold uppercase tracking-wide text-[9px] sm:text-[10px] transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 inline-flex items-center justify-center gap-1 touch-manipulation"
            >
              <Eye size={10} className="sm:w-3 sm:h-3" />
              Reveal (5,000p)
            </button>
          )}
          
          {npcStatus && (
            npcStatus.can_add ? (
              <button
                type="button"
                onClick={onAddNpc}
                disabled={addingNpc}
                className="flex-1 min-w-[120px] bg-primary/20 text-primary rounded px-2.5 sm:px-3 py-1.5 sm:py-2 font-heading font-bold uppercase tracking-wide text-[9px] sm:text-[10px] border border-primary/40 hover:bg-primary/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 inline-flex items-center justify-center gap-1 touch-manipulation"
              >
                <UserPlus size={10} className="sm:w-3 sm:h-3" />
                {addingNpc ? 'Adding...' : 'Add NPC'}
              </button>
            ) : (
              <div className="flex-1 min-w-[120px] flex items-center justify-center gap-1 text-[9px] sm:text-[10px] text-zinc-400 font-heading bg-zinc-800/50 px-2 py-1.5 rounded border border-zinc-700/40">
                <Clock size={10} />
                <span>
                  {npcStatus.adds_used_in_window ?? 0}/{npcStatus.max_per_window ?? 3} NPCs
                </span>
              </div>
            )
          )}
        </div>
        
        {/* NPC info */}
        {npcStatus && !onHitlist && (
          <p className="text-[9px] sm:text-[10px] text-zinc-400 font-heading">
            Add practice targets · Max {npcStatus.max_per_window ?? 3} per {npcStatus.window_hours ?? 3} hours
          </p>
        )}
        
        {/* Revealed bounty placers */}
        {revealed && who.length > 0 && (
          <details className="group">
            <summary className="cursor-pointer text-[9px] sm:text-[10px] font-heading font-bold text-primary uppercase tracking-wider flex items-center gap-1 hover:text-primary/80 transition-colors">
              <span className="group-open:rotate-90 transition-transform inline-block">▶</span>
              Who Placed Contracts ({who.length})
            </summary>
            <div className="mt-2 space-y-1">
              {who.map((w, i) => (
                <div key={i} className="flex items-center justify-between gap-2 text-[9px] sm:text-[10px] font-heading bg-zinc-800/40 rounded p-1.5 border border-zinc-700/30">
                  <span className="text-foreground font-bold truncate">{w.placer_username}</span>
                  <span className="text-zinc-400 text-[8px] sm:text-[9px] whitespace-nowrap">
                    {w.reward_amount} {w.reward_type} · {w.target_type}
                  </span>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════
   Place Bounty Card
   ═══════════════════════════════════════════════════════ */
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
  <div className="relative rounded-lg overflow-hidden border border-primary/30 bg-gradient-to-br from-zinc-900 to-zinc-900/90 hit-fade-in" style={{ animationDelay: '0.1s' }}>
    {/* Decorations */}
    <div className="absolute top-0 left-0 w-24 h-24 bg-primary/5 rounded-full blur-2xl pointer-events-none flicker-light" />
    <BulletHole top="16px" left="16px" />
    <BulletHole bottom="20px" right="24px" size="md" />
    <InkSplatter className="absolute top-4 right-6" />
    
    {/* Header */}
    <div className="relative px-2.5 sm:px-3 py-2 bg-primary/5 border-b border-primary/20">
      <h2 className="text-[10px] sm:text-xs font-heading font-bold text-primary uppercase tracking-wider flex items-center gap-1.5">
        💰 Issue a Contract
      </h2>
    </div>
    
    <div className="p-2.5 sm:p-3">
      <form onSubmit={onSubmit} className="space-y-2 sm:space-y-2.5">
        {/* Target username */}
        <div>
          <label className="block text-[9px] sm:text-[10px] text-zinc-400 font-heading mb-1">
            Target Username
          </label>
          <input
            type="text"
            value={targetUsername}
            onChange={(e) => setTargetUsername(e.target.value)}
            placeholder="Enter username..."
            className="w-full bg-zinc-800/80 border border-zinc-700/50 rounded px-2.5 sm:px-3 py-1.5 sm:py-2 text-[10px] sm:text-xs text-foreground placeholder:text-zinc-500 focus:border-primary/50 focus:outline-none transition-colors font-heading"
            required
          />
        </div>

        {/* Target type & Hidden checkbox row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <label className="block text-[9px] sm:text-[10px] text-zinc-400 font-heading mb-1">
              Target Type
            </label>
            <select
              value={targetType}
              onChange={(e) => setTargetType(e.target.value)}
              className="w-full bg-zinc-800/80 border border-zinc-700/50 rounded px-2.5 sm:px-3 py-1.5 sm:py-2 text-[10px] sm:text-xs text-foreground focus:border-primary/50 focus:outline-none transition-colors font-heading"
            >
              <option value="user">User</option>
              <option value="bodyguards">Bodyguards</option>
            </select>
          </div>
          
          <label className="flex items-center gap-2 cursor-pointer p-2 rounded bg-zinc-800/40 border border-zinc-700/40 hover:bg-zinc-800/60 transition-colors">
            <input
              type="checkbox"
              checked={hidden}
              onChange={(e) => setHidden(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-zinc-600 text-primary focus:ring-primary/50 cursor-pointer"
            />
            <span className="text-[9px] sm:text-[10px] font-heading text-foreground">
              Hidden <span className="text-zinc-500">(+50%)</span>
            </span>
          </label>
        </div>

        {/* Rewards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <label className="block text-[9px] sm:text-[10px] text-zinc-400 font-heading mb-1 flex items-center gap-1">
              <CashStack className="w-4 h-3" />
              Cash Reward
            </label>
            <FormattedNumberInput
              value={rewardCash}
              onChange={setRewardCash}
              placeholder="0"
              className="w-full bg-zinc-800/80 border border-zinc-700/50 rounded px-2.5 sm:px-3 py-1.5 sm:py-2 text-[10px] sm:text-xs text-foreground placeholder:text-zinc-500 focus:border-primary/50 focus:outline-none transition-colors font-heading"
            />
          </div>
          <div>
            <label className="block text-[9px] sm:text-[10px] text-zinc-400 font-heading mb-1 flex items-center gap-1">
              <CoinIcon className="w-3.5 h-3.5" />
              Points Reward
            </label>
            <FormattedNumberInput
              value={rewardPoints}
              onChange={setRewardPoints}
              placeholder="0"
              className="w-full bg-zinc-800/80 border border-zinc-700/50 rounded px-2.5 sm:px-3 py-1.5 sm:py-2 text-[10px] sm:text-xs text-foreground placeholder:text-zinc-500 focus:border-primary/50 focus:outline-none transition-colors font-heading"
            />
          </div>
        </div>
        
        {(totalCostCash > 0 || totalCostPoints > 0) && (
          <p className="text-[9px] sm:text-[10px] text-zinc-400 font-heading">
            Cost to you:{' '}
            <span className="text-foreground font-bold">
              {[totalCostCash > 0 && `$${totalCostCash.toLocaleString()}`, totalCostPoints > 0 && `${totalCostPoints.toLocaleString()}p`].filter(Boolean).join(' + ')}
            </span>
            {hidden && <span className="text-amber-400"> (+50% for hidden)</span>}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting || !targetUsername.trim() || !hasReward}
          className="w-full bg-gradient-to-b from-primary/30 to-primary/20 text-primary rounded px-3 sm:px-4 py-2 sm:py-2.5 font-heading font-bold uppercase tracking-wide text-[10px] sm:text-xs border border-primary/50 hover:from-primary/40 hover:to-primary/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 touch-manipulation"
        >
          {submitting ? (
            <span className="flex items-center justify-center gap-2">
              <span className="typewriter-cursor">|</span>
              Typing contract...
            </span>
          ) : (
            '📝 Issue Contract'
          )}
        </button>
      </form>
    </div>
  </div>
);

/* ═══════════════════════════════════════════════════════
   Active Bounties Card
   ═══════════════════════════════════════════════════════ */
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
    <div className="relative rounded-lg overflow-hidden border border-primary/30 bg-gradient-to-br from-zinc-900 to-zinc-900/90 hit-fade-in" style={{ animationDelay: '0.2s' }}>
      {/* Decorations */}
      <div className="absolute top-0 left-0 w-24 h-24 bg-primary/5 rounded-full blur-2xl pointer-events-none flicker-light" />
      <BulletHole top="20px" right="20px" />
      <BulletHole bottom="24px" left="28px" size="md" />
      
      {/* Header */}
      <div className="relative px-2.5 sm:px-3 py-2 bg-primary/5 border-b border-primary/20">
        <h2 className="text-[10px] sm:text-xs font-heading font-bold text-primary uppercase tracking-wider flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            🎯 The Board
          </span>
          <span className="px-2 py-0.5 rounded bg-primary/20 text-primary text-[9px] sm:text-[10px] font-heading font-bold border border-primary/40">
            {list.length}
          </span>
        </h2>
      </div>
      
      {list.length === 0 ? (
        <div className="py-12 text-center">
          <Target size={32} className="mx-auto text-primary/30 mb-3" />
          <p className="text-[10px] sm:text-xs text-zinc-500 font-heading">
            No active contracts
          </p>
        </div>
      ) : (
        <>
          {/* Desktop: Ledger Table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-xs font-heading">
              <thead>
                <tr className="bg-zinc-800/50 text-[9px] uppercase tracking-wider font-heading text-zinc-500 border-b border-zinc-700/50">
                  <th className="text-left py-2 px-3">Target</th>
                  <th className="text-left py-2 px-3">Type</th>
                  <th className="text-left py-2 px-3">Reward</th>
                  <th className="text-left py-2 px-3">Posted By</th>
                  <th className="text-left py-2 px-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-700/30">
                {list.map((item, index) => {
                  const showBuyOff = isFirstForTarget(item, index);
                  const cost = showBuyOff ? getBuyOffCostForTarget(list, item.target_username) : null;
                  const costLabel = cost && (cost.cash > 0 || cost.points > 0)
                    ? [cost.cash > 0 && `$${cost.cash.toLocaleString()}`, cost.points > 0 && `${cost.points.toLocaleString()}p`].filter(Boolean).join(' + ')
                    : null;
                  const buying = buyingOffTarget === item.target_username;
                  const afford = cost && canAffordBuyOff(cost.cash, cost.points);
                  return (
                    <tr key={item.id} className="hover:bg-zinc-800/30 transition-colors">
                      <td className="py-2 px-3">
                        <div className="flex items-center gap-1.5">
                          {item.target_type === 'npc' ? (
                            <span className="text-foreground font-bold text-xs">{item.target_username}</span>
                          ) : (
                            <Link to={`/profile/${encodeURIComponent(item.target_username)}`} className="text-primary hover:underline font-bold text-xs">{item.target_username}</Link>
                          )}
                          <Link
                            to={`/attack?target=${encodeURIComponent(item.target_username)}`}
                            className="shrink-0 p-1 rounded hover:bg-primary/20 text-primary transition-colors"
                            title="Attack"
                          >
                            <Crosshair size={11} />
                          </Link>
                        </div>
                      </td>
                      <td className="py-2 px-3 text-zinc-400">
                        <div className="flex items-center gap-1 text-[10px]">
                          {item.target_type === 'bodyguards' ? (
                            <>
                              <Users size={11} />
                              Bodyguards
                            </>
                          ) : item.target_type === 'npc' ? (
                            <>NPC</>
                          ) : (
                            <>
                              <User size={11} />
                              User
                            </>
                          )}
                        </div>
                      </td>
                      <td className="py-2 px-3">
                        <div className="flex items-center gap-1 text-primary font-bold text-xs">
                          {item.reward_type === 'cash' ? (
                            <>
                              <CashStack className="w-4 h-3" />
                              ${Number(item.reward_amount).toLocaleString()}
                            </>
                          ) : (
                            <>
                              <CoinIcon className="w-3.5 h-3.5" />
                              {Number(item.reward_amount).toLocaleString()}
                            </>
                          )}
                        </div>
                      </td>
                      <td className="py-2 px-3 text-zinc-400 text-[10px]">
                        {item.placer_username ?? 'Hidden'}
                      </td>
                      <td className="py-2 px-3">
                        {showBuyOff && costLabel && (
                          <button
                            type="button"
                            onClick={() => onBuyOffUser?.(item.target_username)}
                            disabled={buying || !afford}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded text-[9px] font-heading font-bold uppercase tracking-wider bg-primary/20 text-primary border border-primary/40 hover:bg-primary/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95"
                          >
                            <ShieldOff size={10} />
                            {buying ? '...' : `Buy (${costLabel})`}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          
          {/* Mobile: Wanted Poster Cards */}
          <div className="md:hidden divide-y divide-zinc-700/30">
            {list.map((item, index) => {
              const showBuyOff = isFirstForTarget(item, index);
              const cost = showBuyOff ? getBuyOffCostForTarget(list, item.target_username) : null;
              const costLabel = cost && (cost.cash > 0 || cost.points > 0)
                ? [cost.cash > 0 && `$${cost.cash.toLocaleString()}`, cost.points > 0 && `${cost.points.toLocaleString()}p`].filter(Boolean).join(' + ')
                : null;
              const buying = buyingOffTarget === item.target_username;
              const afford = cost && canAffordBuyOff(cost.cash, cost.points);
              return (
                <div key={item.id} className="p-2.5 space-y-2 hover:bg-zinc-800/20 transition-colors">
                  {/* Wanted poster style */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-1">
                        {item.target_type === 'npc' ? (
                          <span className="text-foreground font-heading font-bold text-xs">{item.target_username}</span>
                        ) : (
                          <Link to={`/profile/${encodeURIComponent(item.target_username)}`} className="text-primary hover:underline font-heading font-bold text-xs">{item.target_username}</Link>
                        )}
                        <Link
                          to={`/attack?target=${encodeURIComponent(item.target_username)}`}
                          className="shrink-0 p-1 rounded hover:bg-primary/20 text-primary transition-colors"
                          title="Attack"
                        >
                          <Crosshair size={10} />
                        </Link>
                      </div>
                      <div className="flex items-center gap-1 text-[9px] text-zinc-400 font-heading">
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
                      <div className="flex items-center gap-1 text-primary font-heading font-bold text-xs mb-0.5">
                        {item.reward_type === 'cash' ? (
                          <>
                            <CashStack className="w-4 h-3" />
                            ${Number(item.reward_amount).toLocaleString()}
                          </>
                        ) : (
                          <>
                            <CoinIcon className="w-3.5 h-3.5" />
                            {Number(item.reward_amount).toLocaleString()}
                          </>
                        )}
                      </div>
                      <div className="text-[8px] text-zinc-500 font-heading">
                        by {item.placer_username ?? 'Hidden'}
                      </div>
                    </div>
                  </div>
                  
                  {showBuyOff && costLabel && (
                    <button
                      type="button"
                      onClick={() => onBuyOffUser?.(item.target_username)}
                      disabled={buying || !afford}
                      className="w-full inline-flex items-center justify-center gap-1 py-2 rounded text-[10px] font-heading font-bold uppercase tracking-wider bg-primary/20 text-primary border border-primary/40 hover:bg-primary/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95"
                    >
                      <ShieldOff size={10} />
                      {buying ? 'Buying off...' : `Buy off (${costLabel})`}
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

/* ═══════════════════════════════════════════════════════
   Info Card
   ═══════════════════════════════════════════════════════ */
const InfoCard = () => (
  <div className="relative rounded-lg overflow-hidden border border-zinc-700/40 bg-zinc-900/60 hit-fade-in" style={{ animationDelay: '0.3s' }}>
    <div className="px-2.5 sm:px-3 py-2 bg-zinc-800/40 border-b border-zinc-700/40">
      <h3 className="text-[10px] sm:text-xs font-heading font-bold text-zinc-400 uppercase tracking-wider">
        ℹ️ How It Works
      </h3>
    </div>
    <div className="p-2.5 sm:p-3">
      <div className="space-y-1.5 text-[9px] sm:text-[10px] text-zinc-400 font-heading leading-relaxed">
        <p className="flex items-start gap-1.5">
          <span className="text-primary shrink-0 mt-0.5">•</span>
          <span>
            Place contracts on <strong className="text-foreground">users</strong> or their <strong className="text-foreground">bodyguards</strong> using cash or points
          </span>
        </p>
        <p className="flex items-start gap-1.5">
          <span className="text-primary shrink-0 mt-0.5">•</span>
          <span>
            <strong className="text-amber-400">Hidden contracts</strong> cost 50% extra — your name won't appear
          </span>
        </p>
        <p className="flex items-start gap-1.5">
          <span className="text-primary shrink-0 mt-0.5">•</span>
          <span>
            <strong className="text-foreground">Buy yourself off</strong> at bounty + 50% (e.g., $1M bounty = $1.5M to remove)
          </span>
        </p>
        <p className="flex items-start gap-1.5">
          <span className="text-primary shrink-0 mt-0.5">•</span>
          <span>
            Pay <strong className="text-primary">5,000 points</strong> once to reveal who placed contracts on you
          </span>
        </p>
      </div>
    </div>
  </div>
);

/* ═══════════════════════════════════════════════════════
   Main Component
   ═══════════════════════════════════════════════════════ */
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
      toast.error('Failed to load contracts');
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
      toast.success('Contract issued');
      setTargetUsername('');
      setRewardCash('');
      setRewardPoints('');
      setHidden(false);
      refreshUser();
      fetchData();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to issue contract');
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
    <div className="space-y-3 px-3 sm:px-4" data-testid="hitlist-page">
      <style>{HITLIST_STYLES}</style>

      {/* Page intro */}
      <div className="relative hit-fade-in">
        <p className="text-[9px] sm:text-[10px] text-zinc-500 font-heading italic">
          Place contracts, buy yourself off, see who wants you eliminated.
        </p>
      </div>

      <YourStatusCard
        me={me}
        user={user}
        revealed={revealed}
        who={who}
        submitting={submitting}
        onBuyOff={handleBuyOff}
        onReveal={handleReveal}
        npcStatus={npcStatus}
        addingNpc={addingNpc}
        onAddNpc={handleAddNpc}
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
