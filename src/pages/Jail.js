import { useState, useEffect } from 'react';
import { Lock, Users, AlertCircle, Zap, DoorOpen } from 'lucide-react';
import api from '../utils/api';
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

const PageHeader = ({ jailStatus }) => (
  <div>
    <h1 className="text-2xl sm:text-4xl md:text-5xl font-heading font-bold text-primary mb-1 md:mb-2 flex items-center gap-3">
      <Lock className="w-8 h-8 md:w-10 md:h-10" />
      Jail
    </h1>
    <p className="text-sm text-mutedForeground mb-3">
      Bust out players for rank points
    </p>
    <div className="flex flex-wrap gap-4 text-sm">
      <div className="flex flex-col">
        <span className="text-xs text-mutedForeground uppercase tracking-wider">Your Busts</span>
        <span className="text-lg font-bold text-primary">{jailStatus.jail_busts ?? 0}</span>
      </div>
      <div className="flex flex-col">
        <span className="text-xs text-mutedForeground uppercase tracking-wider">Streak</span>
        <span className="text-lg font-bold text-foreground">{jailStatus.current_consecutive_busts ?? 0}</span>
      </div>
      <div className="flex flex-col">
        <span className="text-xs text-mutedForeground uppercase tracking-wider">Record</span>
        <span className="text-lg font-bold text-primary/80">{jailStatus.consecutive_busts_record ?? 0}</span>
      </div>
    </div>
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
  leavingJail 
}) => {
  if (inJail) {
    return (
      <div className="relative border-2 border-red-500/60 rounded-lg overflow-hidden min-h-[240px] md:min-h-[280px]">
        <img 
          src={JAIL_BACKGROUND_IMAGE} 
          alt="" 
          className="absolute inset-0 w-full h-full object-cover" 
        />
        <div className="absolute inset-0 bg-black/70" aria-hidden />
        <div className="absolute inset-0 bg-red-950/30" aria-hidden />
        <div 
          className="relative z-10 p-6 md:p-8 text-center flex flex-col items-center justify-center h-full" 
          style={{ textShadow: '0 2px 8px rgba(0,0,0,0.8)' }}
        >
          <Lock className="text-red-400 mb-4 drop-shadow-lg" size={48} />
          <h2 className="text-xl md:text-2xl font-heading font-bold text-red-400 uppercase tracking-wider mb-2">
            You Are In Jail
          </h2>
          <p className="text-white font-heading mb-3 text-sm">Time remaining:</p>
          <div className="text-4xl md:text-5xl font-heading font-bold text-red-400 mb-6 tabular-nums">
            {secondsRemaining}s
          </div>
          
          {/* Bust reward input */}
          <div className="mb-4 w-full max-w-sm">
            <label className="block text-xs font-heading text-zinc-300 mb-2">
              💰 Reward for busting you out
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/60">$</span>
                <input
                  type="number"
                  min="0"
                  value={bustRewardInput}
                  onChange={(e) => onBustRewardChange(e.target.value)}
                  className="w-full h-10 pl-7 pr-3 rounded-md border border-primary/30 bg-black/40 text-white text-sm font-heading focus:border-primary/50 focus:outline-none"
                  placeholder="0"
                />
              </div>
              <button
                type="button"
                onClick={onSetReward}
                disabled={setRewardLoading}
                className="h-10 px-4 rounded-md bg-primary/20 text-primary font-heading text-sm font-bold uppercase border border-primary/40 hover:bg-primary/30 disabled:opacity-50 transition-all"
              >
                {setRewardLoading ? '...' : 'Set'}
              </button>
            </div>
          </div>

          <p className="text-xs text-zinc-300 font-heading mb-4 max-w-md">
            Wait for release or ask another player to bust you out
          </p>
          
          <button
            type="button"
            onClick={onLeaveJail}
            disabled={leavingJail}
            className="bg-gradient-to-r from-primary via-yellow-600 to-primary hover:from-yellow-500 hover:via-yellow-600 hover:to-yellow-500 text-primaryForeground rounded-lg px-6 py-3 text-sm font-bold uppercase tracking-wide shadow-xl shadow-primary/20 disabled:opacity-50 transition-all touch-manipulation inline-flex items-center gap-2 border-2 border-yellow-600/50"
          >
            <DoorOpen size={18} />
            {leavingJail ? 'Leaving...' : 'Leave Jail (3 pts)'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative border border-primary/30 rounded-lg overflow-hidden min-h-[200px] md:min-h-[240px] shadow-lg">
      <img 
        src={JAIL_BACKGROUND_IMAGE} 
        alt="" 
        className="absolute inset-0 w-full h-full object-cover" 
      />
      <div className="absolute inset-0 bg-black/60" aria-hidden />
      <div 
        className="relative z-10 p-6 md:p-8 text-center flex flex-col items-center justify-center h-full" 
        style={{ textShadow: '0 2px 8px rgba(0,0,0,0.8)' }}
      >
        <AlertCircle className="text-primary/80 mb-4 drop-shadow-lg" size={48} />
        <h2 className="text-xl md:text-2xl font-heading font-bold text-primary uppercase tracking-wider mb-2">
          You Are Free
        </h2>
        <p className="text-sm text-zinc-300 font-heading">
          Bust out jailed players for rank points
        </p>
      </div>
    </div>
  );
};

const JailedPlayerCard = ({ player, index, onBust, loading, userInJail }) => {
  const successRate = player.bust_success_rate ?? (player.is_npc ? 50 : 70);
  const rp = player.rp_reward ?? (player.is_npc ? 25 : 15);

  return (
    <div
      className={`bg-card border rounded-md p-4 transition-all ${
        player.is_self 
          ? 'border-red-500/30 opacity-75' 
          : 'border-border hover:border-primary/30'
      }`}
      data-testid={`jailed-player-${index}`}
    >
      {/* Mobile: Stacked layout, Desktop: Horizontal */}
      <div className="space-y-3 md:space-y-0 md:flex md:items-center md:justify-between md:gap-4">
        
        {/* Player info + badges */}
        <div className="flex items-start justify-between gap-3 md:flex-1 md:min-w-0">
          <div className="flex-1 min-w-0">
            <h3 className="text-base md:text-sm font-heading font-bold text-foreground truncate">
              {player.username}
            </h3>
            <p className="text-sm md:text-xs text-mutedForeground truncate mt-0.5">
              {player.rank_name}
            </p>
          </div>

          {/* Badges */}
          <div className="flex-shrink-0 flex gap-2">
            {player.is_self ? (
              <span className="px-2 py-1 rounded-md text-xs font-bold uppercase bg-red-500/20 text-red-400 border border-red-500/40">
                You
              </span>
            ) : player.is_npc ? (
              <span className="px-2 py-1 rounded-md text-xs font-bold uppercase bg-secondary text-mutedForeground border border-border">
                NPC
              </span>
            ) : null}
          </div>
        </div>

        {/* Stats + Action */}
        <div className="flex items-center justify-between gap-3 md:gap-4">
          {/* Stats */}
          <div className="flex items-center gap-3 md:gap-4 text-sm md:text-xs">
            <div className="flex items-center gap-1.5">
              {player.is_npc && <Zap size={14} className="text-amber-400" />}
              <span className={player.is_npc ? 'text-amber-400 font-bold' : 'text-mutedForeground'}>
                {successRate}%
              </span>
            </div>
            <div className="text-primary font-bold">
              +{rp} RP
            </div>
            <div className="text-mutedForeground">
              {player.bust_reward_cash > 0 ? `$${Number(player.bust_reward_cash).toLocaleString()}` : '—'}
            </div>
          </div>

          {/* Action button */}
          <div className="flex-shrink-0">
            {player.is_self ? (
              <span className="text-xs text-mutedForeground">—</span>
            ) : (
              <button
                type="button"
                onClick={() => onBust(player.username, player.is_npc)}
                disabled={loading || userInJail}
                className="bg-gradient-to-r from-primary via-yellow-600 to-primary hover:from-yellow-500 hover:via-yellow-600 hover:to-yellow-500 text-primaryForeground active:scale-98 rounded-md px-5 py-2 md:px-4 md:py-1.5 text-sm md:text-xs font-bold uppercase tracking-wide shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-all touch-manipulation border border-yellow-600/50 disabled:opacity-50 disabled:cursor-not-allowed"
                data-testid={`bust-out-${index}`}
              >
                {loading ? '...' : '🔓 Bust'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const InfoSection = () => (
  <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
    <div className="px-4 py-2 bg-primary/10 border-b border-primary/30">
      <h3 className="text-sm font-heading font-bold text-primary uppercase tracking-widest">
        Jail System
      </h3>
    </div>
    <div className="p-4">
      <ul className="space-y-2 text-xs text-mutedForeground font-heading">
        <li className="flex items-start gap-2">
          <span className="text-primary shrink-0">▸</span>
          <span>Failed crimes/GTA send you to jail (15–60s)</span>
        </li>
        <li className="flex items-start gap-2">
          <span className="text-primary shrink-0">▸</span>
          <span>NPCs appear every 1–2 min, harder bust (50% vs 70%)</span>
        </li>
        <li className="flex items-start gap-2">
          <span className="text-primary shrink-0">▸</span>
          <span>15 RP regular bust, 25 RP NPC bust</span>
        </li>
        <li className="flex items-start gap-2">
          <span className="text-primary shrink-0">▸</span>
          <span>Failed bust = 30s in jail</span>
        </li>
        <li className="flex items-start gap-2">
          <span className="text-primary shrink-0">▸</span>
          <span>Booze runs have a small chance to get you caught and sent to jail</span>
        </li>
      </ul>
    </div>
  </div>
);

// Main component
export default function Jail() {
  const [jailStatus, setJailStatus] = useState({ in_jail: false });
  const [jailedPlayers, setJailedPlayers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [bustRewardInput, setBustRewardInput] = useState('');
  const [setRewardLoading, setSetRewardLoading] = useState(false);
  const [leavingJail, setLeavingJail] = useState(false);

  const fetchJailData = async () => {
    try {
      const [jailRes, playersRes] = await Promise.all([
        api.get('/jail/status'),
        api.get('/jail/players')
      ]);
      setJailStatus(jailRes.data);
      setJailedPlayers(playersRes.data.players);
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
  }, []);

  useEffect(() => {
    if (jailStatus.in_jail && bustRewardInput === '' && (jailStatus.bust_reward_cash ?? 0) > 0) {
      setBustRewardInput(String(jailStatus.bust_reward_cash));
    }
  }, [jailStatus.in_jail, jailStatus.bust_reward_cash, bustRewardInput]);

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
    <div className={`space-y-4 md:space-y-6 ${styles.pageContent}`} data-testid="jail-page">
      <PageHeader jailStatus={jailStatus} />

      <JailStatusCard
        inJail={jailStatus.in_jail}
        secondsRemaining={jailStatus.seconds_remaining}
        bustRewardInput={bustRewardInput}
        onBustRewardChange={setBustRewardInput}
        onSetReward={setBustReward}
        setRewardLoading={setRewardLoading}
        onLeaveJail={leaveJail}
        leavingJail={leavingJail}
      />

      {/* Jailed Players */}
      <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
        <div className="px-4 py-2 bg-primary/10 border-b border-primary/30 flex items-center justify-between">
          <span className="text-sm font-heading font-bold text-primary uppercase tracking-widest flex items-center gap-2">
            <Users size={16} />
            Jailed Players
          </span>
          <span className="text-sm text-primary font-heading font-bold">
            {jailedPlayers.length}
          </span>
        </div>

        {jailedPlayers.length === 0 ? (
          <div className="px-4 py-12 text-center text-mutedForeground text-sm font-heading italic">
            No players currently in jail
          </div>
        ) : (
          <div className="p-3 md:p-4 space-y-3">
            {jailedPlayers.map((player, index) => (
              <JailedPlayerCard
                key={`${player.username}-${index}`}
                player={player}
                index={index}
                onBust={bustOut}
                loading={loading}
                userInJail={jailStatus.in_jail}
              />
            ))}
          </div>
        )}
      </div>

      <InfoSection />
    </div>
  );
}
