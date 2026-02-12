import { useState, useEffect } from 'react';
import { Lock, Users, AlertCircle, Zap, DoorOpen } from 'lucide-react';
import api from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

// Card background (jail cell). Override: REACT_APP_JAIL_BACKGROUND_IMAGE in .env
const JAIL_BACKGROUND_IMAGE =
  process.env.REACT_APP_JAIL_BACKGROUND_IMAGE ||
  `${(process.env.PUBLIC_URL || '')}/jail-background.png`;
export default function Jail() {
  const [jailStatus, setJailStatus] = useState({ in_jail: false });
  const [jailedPlayers, setJailedPlayers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [bustRewardInput, setBustRewardInput] = useState('');
  const [setRewardLoading, setSetRewardLoading] = useState(false);

  useEffect(() => {
    fetchJailData();
    const interval = setInterval(fetchJailStatus, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (jailStatus.in_jail && bustRewardInput === '' && (jailStatus.bust_reward_cash ?? 0) > 0) {
      setBustRewardInput(String(jailStatus.bust_reward_cash));
    }
  }, [jailStatus.in_jail, jailStatus.bust_reward_cash]);

  const fetchJailData = async () => {
    try {
      const [jailRes, playersRes] = await Promise.all([
        api.get('/jail/status'),
        api.get('/jail/players')
      ]);
      setJailStatus(jailRes.data);
      setJailedPlayers(playersRes.data.players);
    } catch (error) {
      console.error('Failed to load jail data');
    }
  };

  const fetchJailStatus = async () => {
    try {
      const response = await api.get('/jail/status');
      setJailStatus(response.data);
      if (!response.data.in_jail && jailStatus.in_jail) {
        toast.success('You are free!');
        fetchJailData();
      }
    } catch (error) {
      console.error('Failed to check jail status');
    }
  };

  const [leavingJail, setLeavingJail] = useState(false);

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
        if (response.data.cash_reward > 0) msg += ` +$${Number(response.data.cash_reward).toLocaleString()}`;
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

  return (
    <div className={`min-h-full ${styles.pageContent}`} data-testid="jail-page">
      <div className="space-y-4 sm:space-y-5 p-3 sm:p-4 md:p-6">
      {/* Art Deco Header */}
      <div>
        <div className="flex items-center gap-2 sm:gap-4 mb-2 sm:mb-3">
          <div className="h-px flex-1 bg-gradient-to-r from-transparent via-primary/40 to-primary/60" />
          <h1 className="text-xl sm:text-2xl md:text-3xl font-heading font-bold text-primary tracking-wider uppercase flex items-center gap-2 sm:gap-3">
            <Lock size={20} className="text-primary/80 sm:w-6 sm:h-6" />
            Jail
          </h1>
          <div className="h-px flex-1 bg-gradient-to-l from-transparent via-primary/40 to-primary/60" />
        </div>
        <p className="text-center text-xs sm:text-sm text-mutedForeground font-heading tracking-wide">Bust out players for rank points</p>
        <div className="flex flex-wrap justify-center gap-3 sm:gap-4 mt-2 text-xs sm:text-sm font-heading">
          <span className="text-primary/90">Your busts: <strong>{jailStatus.jail_busts ?? 0}</strong></span>
          <span className="text-mutedForeground">Streak: <strong>{jailStatus.current_consecutive_busts ?? 0}</strong></span>
          <span className="text-primary/80">Record: <strong>{jailStatus.consecutive_busts_record ?? 0}</strong></span>
        </div>
      </div>

      <div className="flex justify-center">
        <div className="w-full max-w-3xl">
          {jailStatus.in_jail ? (
            <div className="relative border-2 border-red-600/60 rounded-sm overflow-hidden min-h-[160px] sm:min-h-[200px]">
              <img src={JAIL_BACKGROUND_IMAGE} alt="" className="absolute inset-0 w-full h-full object-cover" />
              <div className="absolute inset-0 bg-black/70" aria-hidden />
              <div className="absolute inset-0 bg-red-950/30" aria-hidden />
              <div className="relative z-10 p-4 sm:p-6 text-center" style={{ textShadow: '0 2px 8px rgba(0,0,0,0.8)' }}>
                <Lock className="text-red-400 mx-auto mb-2 sm:mb-4 drop-shadow-lg" size={32} />
                <h2 className="text-base sm:text-lg font-heading font-bold text-red-400 uppercase tracking-wider mb-1 sm:mb-2">You Are In Jail</h2>
                <p className="text-white font-heading mb-2 sm:mb-3 text-xs sm:text-sm">Time remaining:</p>
                <div className="text-2xl sm:text-3xl font-heading font-bold text-red-400 mb-2 sm:mb-3 tabular-nums">
                  {jailStatus.seconds_remaining}s
                </div>
                <p className="text-[11px] sm:text-xs text-zinc-300 font-heading mb-3">Wait for release or ask another player to bust you out</p>
                {jailStatus.in_jail && (
                  <div className="mb-3 flex flex-wrap items-center justify-center gap-2">
                    <label className="text-xs font-heading text-zinc-300">$ reward for busting you out:</label>
                    <input
                      type="number"
                      min="0"
                      value={bustRewardInput}
                      onChange={(e) => setBustRewardInput(e.target.value)}
                      className="w-24 h-8 px-2 rounded border border-primary/30 bg-black/40 text-white text-sm font-heading"
                      placeholder="0"
                    />
                    <button
                      type="button"
                      onClick={setBustReward}
                      disabled={setRewardLoading}
                      className="h-8 px-3 rounded bg-primary/20 text-primary font-heading text-xs uppercase border border-primary/40 hover:bg-primary/30 disabled:opacity-50"
                    >
                      {setRewardLoading ? '...' : 'Set'}
                    </button>
                  </div>
                )}
                <button
                  type="button"
                  onClick={leaveJail}
                  disabled={leavingJail}
                  className="bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground hover:opacity-90 rounded-sm px-4 py-2 text-xs font-heading font-bold uppercase tracking-wider border border-yellow-600/50 disabled:opacity-50 transition-smooth touch-manipulation inline-flex items-center gap-2 shadow-lg"
                >
                  <DoorOpen size={14} />
                  {leavingJail ? 'Leaving...' : 'Leave Jail (3 pts)'}
                </button>
              </div>
            </div>
          ) : (
            <div className="relative border border-primary/30 rounded-sm overflow-hidden min-h-[120px] sm:min-h-[160px] shadow-lg shadow-primary/5">
              <img src={JAIL_BACKGROUND_IMAGE} alt="" className="absolute inset-0 w-full h-full object-cover" />
              <div className="absolute inset-0 bg-black/60" aria-hidden />
              <div className="relative z-10 p-4 sm:p-6 text-center" style={{ textShadow: '0 2px 8px rgba(0,0,0,0.8)' }}>
                <AlertCircle className="text-primary/80 mx-auto mb-2 sm:mb-3 drop-shadow-lg" size={32} />
                <h2 className="text-base sm:text-lg font-heading font-bold text-primary uppercase tracking-wider mb-1 sm:mb-2">You Are Free</h2>
                <p className="text-xs sm:text-sm text-zinc-300 font-heading">Bust out jailed players for rank points</p>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex justify-center">
        <div className={`w-full max-w-3xl ${styles.panel} rounded-md overflow-hidden`}>
          <div className="px-3 py-1.5 sm:px-4 sm:py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30 flex items-center justify-between">
            <div className="flex items-center gap-1.5 sm:gap-2">
              <div className="w-4 sm:w-6 h-px bg-primary/50" />
              <span className="text-[11px] sm:text-xs font-heading font-bold text-primary uppercase tracking-widest flex items-center gap-1.5 sm:gap-2">
                <Users size={12} className="sm:w-[14px] sm:h-[14px]" /> Jailed Players
              </span>
              <div className="w-4 sm:w-6 h-px bg-primary/50" />
            </div>
            <span className="text-[11px] sm:text-xs text-primary font-heading font-bold">{jailedPlayers.length}</span>
          </div>

          {jailedPlayers.length === 0 ? (
            <div className="px-3 py-6 sm:px-4 sm:py-10 text-center text-mutedForeground text-xs sm:text-sm font-heading italic">No players currently in jail</div>
          ) : (
            <>
              <div className="hidden md:grid grid-cols-12 bg-zinc-800/50 text-xs uppercase tracking-widest font-heading text-primary/80 px-4 py-2 border-b border-primary/20">
                <div className="col-span-4">Player</div>
                <div className="col-span-2">Bust</div>
                <div className="col-span-2 text-right">RP</div>
                <div className="col-span-2 text-right">$ Reward</div>
                <div className="col-span-2 text-right">Action</div>
              </div>

              {jailedPlayers.map((player, index) => {
                const successRate = player.bust_success_rate ?? (player.is_npc ? 50 : 70);
                const rp = player.rp_reward ?? (player.is_npc ? 25 : 15);
                return (
                  <div
                    key={`${player.username}-${index}`}
                    className="grid grid-cols-1 md:grid-cols-12 gap-1.5 md:gap-0 px-3 py-2 sm:px-4 sm:py-2.5 border-b border-primary/10 items-center transition-smooth bg-transparent hover:bg-zinc-800/30 min-w-0"
                    data-testid={`jailed-player-${index}`}
                  >
                    <div className="md:col-span-4 min-w-0">
                      <div className="flex items-center justify-between gap-2 sm:gap-3">
                        <div className="min-w-0">
                          <div className="text-xs sm:text-sm font-heading font-bold text-foreground truncate">{player.username}</div>
                          <div className="text-[11px] sm:text-xs text-mutedForeground truncate font-heading">{player.rank_name}</div>
                        </div>
                        {player.is_self ? (
                          <span className="shrink-0 text-[10px] uppercase tracking-wider font-heading font-bold bg-red-600/20 text-red-400 px-1.5 py-0.5 rounded-sm border border-red-500/30">
                            You
                          </span>
                        ) : player.is_npc ? (
                          <span className="shrink-0 text-[10px] uppercase tracking-wider font-heading font-bold bg-zinc-800 text-mutedForeground px-1.5 py-0.5 rounded-sm border border-primary/20">
                            NPC
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="md:col-span-2 text-[11px] sm:text-xs text-mutedForeground font-heading">
                      {player.is_npc ? (
                        <span className="inline-flex items-center gap-1">
                          <Zap size={11} className="text-amber-400 sm:w-3 sm:h-3" />
                          {successRate}%
                        </span>
                      ) : (
                        <span>{successRate}%</span>
                      )}
                    </div>

                    <div className="md:col-span-2 text-xs font-heading text-primary font-bold">
                      +{rp} RP
                    </div>

                    <div className="md:col-span-2 text-xs font-heading text-mutedForeground text-right">
                      {player.bust_reward_cash > 0 ? `$${Number(player.bust_reward_cash).toLocaleString()}` : '—'}
                    </div>

                    <div className="md:col-span-2 flex justify-end">
                      {player.is_self ? (
                        <span className="text-[11px] sm:text-xs text-mutedForeground font-heading">—</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => bustOut(player.username, player.is_npc)}
                          disabled={loading || jailStatus.in_jail}
                          className="bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground hover:opacity-90 rounded-sm px-2 py-1.5 sm:px-3 sm:py-2 text-[11px] sm:text-xs font-heading font-bold uppercase tracking-wider border border-yellow-600/50 disabled:opacity-50 transition-smooth min-h-[36px] sm:min-h-[44px] touch-manipulation"
                          data-testid={`bust-out-${index}`}
                        >
                          {loading ? '...' : 'Bust'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>

      <div className="flex justify-center">
        <div className={`w-full max-w-3xl ${styles.panel} rounded-md overflow-hidden`}>
          <div className="px-3 py-1.5 sm:px-4 sm:py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30">
            <div className="flex items-center gap-1.5 sm:gap-2">
              <div className="w-4 sm:w-6 h-px bg-primary/50" />
              <h3 className="text-xs sm:text-sm font-heading font-bold text-primary uppercase tracking-widest">Jail System</h3>
              <div className="flex-1 h-px bg-primary/50" />
            </div>
          </div>
          <div className="p-3 sm:p-4">
            <ul className="space-y-0.5 sm:space-y-1 text-[11px] sm:text-xs text-mutedForeground font-heading">
              <li className="flex items-center gap-2"><span className="text-primary">◆</span> Failed crimes/GTA send you to jail (15–60s)</li>
              <li className="flex items-center gap-2"><span className="text-primary">◆</span> NPCs appear every 1–2 min, harder bust (50% vs 70%)</li>
              <li className="flex items-center gap-2"><span className="text-primary">◆</span> 15 RP regular bust, 25 RP NPC bust</li>
              <li className="flex items-center gap-2"><span className="text-primary">◆</span> Failed bust = 30s in jail</li>
              <li className="flex items-center gap-2"><span className="text-primary">◆</span> Booze runs have a small chance to get you caught and sent to jail</li>
            </ul>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}
