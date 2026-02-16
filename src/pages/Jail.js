import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Lock, Users, AlertCircle, DoorOpen, Bot } from 'lucide-react';
import api, { refreshUser } from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

// Card background (jail cell). Override: REACT_APP_JAIL_BACKGROUND_IMAGE in .env
const JAIL_BACKGROUND_IMAGE =
  process.env.REACT_APP_JAIL_BACKGROUND_IMAGE ||
  `${(process.env.PUBLIC_URL || '')}/jail-background.png`;

// Subcomponents
const LoadingSpinner = () => (
  <div className="flex items-center justify-center min-h-[60vh]">
    <div className="text-primary text-xl font-heading font-bold">Loading...</div>
  </div>
);

const JailStatusCard = ({ 
  inJail, 
  secondsRemaining, 
  bustRewardInput, 
  onBustRewardChange, 
  onSetReward, 
  setRewardLoading,
  onLeaveJail,
  leavingJail,
  currentReward
}) => {
  if (inJail) {
    return (
      <div className="relative border-2 border-red-500/60 rounded-lg overflow-hidden">
        <img 
          src={JAIL_BACKGROUND_IMAGE} 
          alt="" 
          className="absolute inset-0 w-full h-full object-cover" 
        />
        <div className="absolute inset-0 bg-black/70" aria-hidden />
        <div className="absolute inset-0 bg-red-950/30" aria-hidden />
        <div 
          className="relative z-10 p-4 md:p-6 text-center flex flex-col items-center justify-center" 
          style={{ textShadow: '0 2px 8px rgba(0,0,0,0.8)' }}
        >
          <Lock className="text-red-400 mb-2 drop-shadow-lg" size={32} />
          <h2 className="text-lg font-heading font-bold text-red-400 uppercase tracking-wider mb-1">
            You Are In Jail
          </h2>
          <div className="text-3xl font-heading font-bold text-red-400 mb-3 tabular-nums">
            {secondsRemaining}s
          </div>
          
          {/* Bust reward input */}
          <div className="mb-3 w-full max-w-xs">
            <label className="block text-[10px] font-heading text-zinc-300 mb-1">
              💰 Reward for busting you out
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/60 text-sm">$</span>
                <input
                  type="number"
                  min="0"
                  value={bustRewardInput}
                  onChange={(e) => onBustRewardChange(e.target.value)}
                  className="w-full h-8 pl-6 pr-2 rounded-md border border-primary/30 bg-black/40 text-white text-sm font-heading focus:border-primary/50 focus:outline-none"
                  placeholder="0"
                />
              </div>
              <button
                type="button"
                onClick={onSetReward}
                disabled={setRewardLoading}
                className="h-8 px-3 rounded-md bg-primary/20 text-primary font-heading text-xs font-bold uppercase border border-primary/40 hover:bg-primary/30 disabled:opacity-50 transition-all"
              >
                {setRewardLoading ? '...' : 'Set'}
              </button>
            </div>
          </div>
          
          <button
            type="button"
            onClick={onLeaveJail}
            disabled={leavingJail}
            className="bg-gradient-to-r from-primary via-yellow-600 to-primary hover:from-yellow-500 hover:via-yellow-600 hover:to-yellow-500 text-primaryForeground rounded-md px-4 py-2 text-xs font-bold uppercase tracking-wide shadow-lg shadow-primary/20 disabled:opacity-50 transition-all touch-manipulation inline-flex items-center gap-1.5 border border-yellow-600/50"
          >
            <DoorOpen size={14} />
            {leavingJail ? 'Leaving...' : 'Leave Jail (3 pts)'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative border border-primary/30 rounded-lg overflow-hidden shadow-lg">
      <img 
        src={JAIL_BACKGROUND_IMAGE} 
        alt="" 
        className="absolute inset-0 w-full h-full object-cover" 
      />
      <div className="absolute inset-0 bg-black/60" aria-hidden />
      <div 
        className="relative z-10 p-4 md:p-6 text-center flex flex-col items-center justify-center" 
        style={{ textShadow: '0 2px 8px rgba(0,0,0,0.8)' }}
      >
        <AlertCircle className="text-primary/80 mb-2 drop-shadow-lg" size={32} />
        <h2 className="text-lg font-heading font-bold text-primary uppercase tracking-wider mb-1">
          You Are Free
        </h2>
        <p className="text-xs text-zinc-300 font-heading mb-3">
          Bust out jailed players for rank points
        </p>
        
        {/* Reward setting when free */}
        <div className="w-full max-w-xs">
          <label className="block text-[10px] font-heading text-zinc-400 mb-1">
            💰 Set reward if you get jailed
            {currentReward > 0 && <span className="text-primary ml-1">(Current: ${Number(currentReward).toLocaleString()})</span>}
          </label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/60 text-sm">$</span>
              <input
                type="number"
                min="0"
                value={bustRewardInput}
                onChange={(e) => onBustRewardChange(e.target.value)}
                className="w-full h-8 pl-6 pr-2 rounded-md border border-primary/30 bg-black/40 text-white text-sm font-heading focus:border-primary/50 focus:outline-none"
                placeholder="0"
              />
            </div>
            <button
              type="button"
              onClick={onSetReward}
              disabled={setRewardLoading}
              className="h-8 px-3 rounded-md bg-primary/20 text-primary font-heading text-xs font-bold uppercase border border-primary/40 hover:bg-primary/30 disabled:opacity-50 transition-all"
            >
              {setRewardLoading ? '...' : 'Set'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const AutoRankJailNotice = () => (
  <div className={`p-2.5 ${styles.panel} border border-amber-500/40 rounded-md text-xs`}>
    <div className="flex items-center gap-2">
      <Bot size={14} className="text-amber-400 shrink-0" />
      <span className="text-amber-200/80">
        <strong className="text-amber-300">Auto Rank</strong> — Busts are running automatically. Manual play disabled.
      </span>
    </div>
  </div>
);

const JailedPlayerRow = ({ player, index, onBust, loading, userInJail, manualPlayDisabled }) => {
  const rp = player.rp_reward ?? (player.is_npc ? 25 : 15);

  return (
    <div
      className={`flex items-center justify-between gap-3 px-3 py-2 rounded-md transition-all ${
        player.is_self 
          ? 'bg-red-500/10 border border-red-500/20 opacity-60' 
          : 'bg-zinc-800/30 border border-transparent hover:border-primary/20 hover:bg-zinc-800/50'
      }`}
      data-testid={`jailed-player-${index}`}
    >
      {/* Player info */}
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="min-w-0">
          <div className="text-sm font-heading font-bold text-foreground truncate">
            {player.is_npc ? player.username : <Link to={`/profile/${encodeURIComponent(player.username)}`} className="text-primary hover:underline">{player.username}</Link>}
          </div>
          <div className="text-[10px] text-mutedForeground truncate">
            {player.rank_name}
          </div>
        </div>
      </div>

      {/* Badge */}
      <div className="shrink-0">
        {player.is_self ? (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-red-500/20 text-red-400 border border-red-500/40">
            You
          </span>
        ) : player.is_npc ? (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-zinc-700/50 text-mutedForeground border border-zinc-600/50">
            NPC
          </span>
        ) : null}
      </div>

      {/* Stats: RP and cash reward only (bust chance is your skill, not per-target) */}
      <div className="flex items-center gap-3 text-xs font-heading shrink-0">
        <span className="text-primary font-bold">+{rp} RP</span>
        <span className="text-mutedForeground w-16 text-right">
          {player.bust_reward_cash > 0 ? `$${Number(player.bust_reward_cash).toLocaleString()}` : '—'}
        </span>
      </div>

      {/* Action */}
      <div className="shrink-0">
        {player.is_self ? (
          <span className="text-xs text-mutedForeground w-16 text-center inline-block">—</span>
        ) : manualPlayDisabled ? (
          <button
            type="button"
            disabled
            className="bg-zinc-700/50 text-mutedForeground rounded px-3 py-1 text-[10px] font-bold uppercase border border-zinc-600/50 cursor-not-allowed inline-flex items-center gap-1"
          >
            Locked
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onBust(player.username, player.is_npc)}
            disabled={loading || userInJail}
            className="bg-gradient-to-b from-primary to-yellow-700 hover:from-yellow-500 hover:to-yellow-600 text-primaryForeground rounded px-3 py-1 text-[10px] font-bold uppercase tracking-wide shadow shadow-primary/20 transition-all touch-manipulation border border-yellow-600/50 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1"
            data-testid={`bust-out-${index}`}
          >
            🔓 Bust
          </button>
        )}
      </div>
    </div>
  );
};

const InfoSection = () => (
  <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
    <div className="px-3 py-2 bg-primary/10 border-b border-primary/30">
      <h3 className="text-xs font-heading font-bold text-primary uppercase tracking-widest">
        ℹ️ Jail System
      </h3>
    </div>
    <div className="p-3">
      <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-mutedForeground font-heading">
        <li className="flex items-start gap-1.5">
          <span className="text-primary shrink-0">•</span>
          <span>Failed crimes/GTA = 15–60s jail</span>
        </li>
        <li className="flex items-start gap-1.5">
          <span className="text-primary shrink-0">•</span>
          <span>Success chance = your bust skill (more busts = higher %)</span>
        </li>
        <li className="flex items-start gap-1.5">
          <span className="text-primary shrink-0">•</span>
          <span>NPCs: 25 RP · Players: 15 RP (+ cash if they set a reward)</span>
        </li>
        <li className="flex items-start gap-1.5">
          <span className="text-primary shrink-0">•</span>
          <span>Failed bust = 30s in jail</span>
        </li>
      </ul>
    </div>
  </div>
);

// Main component
export default function Jail() {
  const [jailStatus, setJailStatus] = useState({ in_jail: false });
  const [jailedPlayers, setJailedPlayers] = useState([]);
  const [jailStats, setJailStats] = useState({
    count_today: 0, count_week: 0, success_today: 0, success_week: 0,
    profit_today: 0, profit_24h: 0, profit_week: 0,
  });
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [bustRewardInput, setBustRewardInput] = useState('');
  const [setRewardLoading, setSetRewardLoading] = useState(false);
  const [leavingJail, setLeavingJail] = useState(false);

  const [autoRankJailDisabled, setAutoRankJailDisabled] = useState(false);

  const fetchJailData = async () => {
    try {
      const [jailRes, playersRes, statsRes, autoRankRes] = await Promise.all([
        api.get('/jail/status'),
        api.get('/jail/players'),
        api.get('/jail/stats').catch(() => ({ data: {} })),
        api.get('/auto-rank/me').catch(() => ({ data: {} })),
      ]);
      setJailStatus(jailRes.data);
      setJailedPlayers(playersRes.data.players);
      setJailStats(statsRes.data || {});
      const ar = autoRankRes.data || {};
      setAutoRankJailDisabled(!!ar.auto_rank_bust_every_5_sec);
    } catch (error) {
      console.error('Failed to load jail data:', error);
      toast.error('Failed to load jail data');
    } finally {
      setInitialLoading(false);
    }
  };

  const fetchJailStatus = async () => {
    try {
      const response = await api.get('/jail/status');
      const wasInJail = jailStatus.in_jail;
      setJailStatus(response.data);
      
      if (wasInJail && !response.data.in_jail) {
        toast.success('You are free!');
        fetchJailData();
      }
    } catch (error) {
      console.error('Failed to check jail status:', error);
    }
  };

  useEffect(() => {
    fetchJailData();
    const interval = setInterval(fetchJailStatus, 1000);
    return () => clearInterval(interval);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (bustRewardInput === '' && (jailStatus.bust_reward_cash ?? 0) > 0) {
      setBustRewardInput(String(jailStatus.bust_reward_cash));
    }
  }, [jailStatus.bust_reward_cash, bustRewardInput]);

  const leaveJail = async () => {
    setLeavingJail(true);
    try {
      const response = await api.post('/jail/leave');
      if (response.data.success) {
        toast.success(response.data.message);
        window.dispatchEvent(new CustomEvent('app:refresh-user'));
      } else {
        toast.error(response.data.message || 'Failed to leave jail');
      }
      fetchJailData();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to leave jail');
    } finally {
      setLeavingJail(false);
    }
  };

  const bustOut = async (username, isNpc) => {
    setLoading(true);
    try {
      const response = await api.post('/jail/bust', { target_username: username });
      if (response.data.success) {
        let msg = `${response.data.message} (+${response.data.rank_points_earned} RP)`;
        if (response.data.cash_reward > 0) {
          msg += ` +$${Number(response.data.cash_reward).toLocaleString()}`;
        }
        toast.success(msg);
        refreshUser();
      } else {
        toast.error(response.data.message);
      }
      fetchJailData();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to bust out');
    } finally {
      setLoading(false);
    }
  };

  const setBustReward = async () => {
    const amount = Math.max(0, parseInt(String(bustRewardInput).replace(/\D/g, ''), 10) || 0);
    setSetRewardLoading(true);
    try {
      const res = await api.post('/jail/set-bust-reward', { amount });
      toast.success(res.data?.message || 'Reward set');
      setJailStatus((s) => ({ ...s, bust_reward_cash: res.data?.bust_reward_cash ?? amount }));
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to set reward');
    } finally {
      setSetRewardLoading(false);
    }
  };

  if (initialLoading) {
    return <LoadingSpinner />;
  }

  return (
    <div className={`space-y-4 ${styles.pageContent}`} data-testid="jail-page">
      {autoRankJailDisabled && <AutoRankJailNotice />}
      <JailStatusCard
        inJail={jailStatus.in_jail}
        secondsRemaining={jailStatus.seconds_remaining}
        bustRewardInput={bustRewardInput}
        onBustRewardChange={setBustRewardInput}
        onSetReward={setBustReward}
        setRewardLoading={setRewardLoading}
        onLeaveJail={leaveJail}
        leavingJail={leavingJail}
        currentReward={jailStatus.bust_reward_cash ?? 0}
      />

      {/* Bust stats */}
      <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
        <div className="px-3 py-2 bg-primary/10 border-b border-primary/30">
          <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">Bust stats</span>
        </div>
        <div className="p-3 text-sm font-heading text-foreground">
          Busts today: {jailStats.count_today ?? 0}  streak {jailStatus.current_consecutive_busts ?? 0}  total successful busts {jailStatus.jail_busts ?? 0}
          <div className="mt-1.5 text-mutedForeground text-xs">
            Record {jailStatus.consecutive_busts_record ?? 0}  ·  Past week {jailStats.count_week ?? 0} busts, {jailStats.success_week ?? 0} successful  ·  Profit today ${(jailStats.profit_today ?? 0).toLocaleString()}  ·  Past week ${(jailStats.profit_week ?? 0).toLocaleString()}
          </div>
        </div>
      </div>

      {/* Jailed Players */}
      <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
        <div className="px-3 py-2 bg-primary/10 border-b border-primary/30 flex items-center justify-between">
          <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest flex items-center gap-1.5">
            <Users size={14} />
            Jailed Players
          </span>
          <span className="text-xs text-primary font-heading font-bold">
            {jailedPlayers.length}
          </span>
        </div>

        {jailedPlayers.length === 0 ? (
          <div className="px-4 py-8 text-center text-mutedForeground text-xs font-heading italic">
            No players currently in jail
          </div>
        ) : (
          <div className="p-2 space-y-1">
            {jailedPlayers.map((player, index) => (
              <JailedPlayerRow
                key={`${player.username}-${index}`}
                player={player}
                index={index}
                onBust={bustOut}
                loading={loading}
                userInJail={jailStatus.in_jail}
                manualPlayDisabled={autoRankJailDisabled}
              />
            ))}
          </div>
        )}
      </div>

      <InfoSection />
    </div>
  );
}
