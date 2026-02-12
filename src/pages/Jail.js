import { useState, useEffect } from 'react';
import { Lock, Users, AlertCircle, Zap } from 'lucide-react';
import api from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

// Card background (jail cell). Override: REACT_APP_JAIL_BACKGROUND_IMAGE in .env
const JAIL_BACKGROUND_IMAGE =
  process.env.REACT_APP_JAIL_BACKGROUND_IMAGE ||
  'https://tse4.mm.bing.net/th/id/OIP.FfNCHmXmT0T5oZ424A8VbgHaLE?pid=Api&P=0&h=180';
export default function Jail() {
  const [jailStatus, setJailStatus] = useState({ in_jail: false });
  const [jailedPlayers, setJailedPlayers] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchJailData();
    const interval = setInterval(fetchJailStatus, 1000);
    return () => clearInterval(interval);
  }, []);

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

  const bustOut = async (username, isNpc) => {
    setLoading(true);
    try {
      const response = await api.post('/jail/bust', { target_username: username });
      if (response.data.success) {
        toast.success(`${response.data.message} (+${response.data.rank_points_earned} RP)`);
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

  return (
    <div className={`min-h-full ${styles.pageContent}`} data-testid="jail-page">
      <div className="space-y-5 p-4 md:p-6">
      {/* Art Deco Header */}
      <div>
        <div className="flex items-center gap-4 mb-3">
          <div className="h-px flex-1 bg-gradient-to-r from-transparent via-primary/40 to-primary/60" />
          <h1 className="text-2xl md:text-3xl font-heading font-bold text-primary tracking-wider uppercase flex items-center gap-3">
            <Lock size={24} className="text-primary/80" />
            Jail
          </h1>
          <div className="h-px flex-1 bg-gradient-to-l from-transparent via-primary/40 to-primary/60" />
        </div>
        <p className="text-center text-sm text-mutedForeground font-heading tracking-wide">Bust out players for rank points</p>
      </div>

      <div className="flex justify-center">
        <div className="w-full max-w-3xl">
          {jailStatus.in_jail ? (
            <div className="relative border-2 border-red-600/60 rounded-sm overflow-hidden min-h-[200px]">
              <img src={JAIL_BACKGROUND_IMAGE} alt="" className="absolute inset-0 w-full h-full object-cover" />
              <div className="absolute inset-0 bg-red-950/50" aria-hidden />
              <div className="relative z-10 p-6 text-center">
                <Lock className="text-red-400 mx-auto mb-4" size={40} />
                <h2 className="text-lg font-heading font-bold text-red-400 uppercase tracking-wider mb-2">You Are In Jail</h2>
                <p className="text-foreground font-heading mb-3">Time remaining:</p>
                <div className="text-3xl font-heading font-bold text-red-400 mb-3 tabular-nums">
                  {jailStatus.seconds_remaining}s
                </div>
                <p className="text-xs text-mutedForeground font-heading">Wait for release or ask another player to bust you out</p>
              </div>
            </div>
          ) : (
            <div className="relative border border-primary/30 rounded-sm overflow-hidden min-h-[160px] shadow-lg shadow-primary/5">
              <img src={JAIL_BACKGROUND_IMAGE} alt="" className="absolute inset-0 w-full h-full object-cover" />
              <div className="absolute inset-0 bg-black/30" aria-hidden />
              <div className="relative z-10 p-6 text-center">
                <AlertCircle className="text-primary/80 mx-auto mb-3" size={40} />
                <h2 className="text-lg font-heading font-bold text-primary uppercase tracking-wider mb-2">You Are Free</h2>
                <p className="text-sm text-mutedForeground font-heading">Bust out jailed players for rank points</p>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex justify-center">
        <div className={`w-full max-w-3xl ${styles.panel} rounded-md overflow-hidden`}>
          <div className="px-4 py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-6 h-px bg-primary/50" />
              <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest flex items-center gap-2">
                <Users size={14} /> Jailed Players
              </span>
              <div className="w-6 h-px bg-primary/50" />
            </div>
            <span className="text-xs text-primary font-heading font-bold">{jailedPlayers.length}</span>
          </div>

          {jailedPlayers.length === 0 ? (
            <div className="px-4 py-10 text-center text-mutedForeground text-sm font-heading italic">No players currently in jail</div>
          ) : (
            <>
              <div className="grid grid-cols-12 bg-zinc-800/50 text-xs uppercase tracking-widest font-heading text-primary/80 px-4 py-2 border-b border-primary/20">
                <div className="col-span-5">Player</div>
                <div className="col-span-3">Bust</div>
                <div className="col-span-2 text-right">Reward</div>
                <div className="col-span-2 text-right">Action</div>
              </div>

              {jailedPlayers.map((player, index) => {
                const successRate = player.bust_success_rate ?? (player.is_npc ? 50 : 70);
                const rp = player.rp_reward ?? (player.is_npc ? 25 : 15);
                return (
                  <div
                    key={`${player.username}-${index}`}
                    className="grid grid-cols-12 px-4 py-2.5 border-b border-primary/10 items-center transition-smooth bg-transparent hover:bg-zinc-800/30"
                    data-testid={`jailed-player-${index}`}
                  >
                    <div className="col-span-5 min-w-0">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-heading font-bold text-foreground truncate">{player.username}</div>
                          <div className="text-xs text-mutedForeground truncate font-heading">{player.rank_name}</div>
                        </div>
                        {player.is_self ? (
                          <span className="shrink-0 text-[10px] uppercase tracking-wider font-heading font-bold bg-red-600/20 text-red-400 px-2 py-0.5 rounded-sm border border-red-500/30">
                            You
                          </span>
                        ) : player.is_npc ? (
                          <span className="shrink-0 text-[10px] uppercase tracking-wider font-heading font-bold bg-zinc-800 text-mutedForeground px-2 py-0.5 rounded-sm border border-primary/20">
                            NPC
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="col-span-3 text-xs text-mutedForeground font-heading">
                      {player.is_npc ? (
                        <span className="inline-flex items-center gap-1">
                          <Zap size={12} className="text-amber-400" />
                          Harder ({successRate}%)
                        </span>
                      ) : (
                        <span>Normal ({successRate}%)</span>
                      )}
                    </div>

                    <div className="col-span-2 text-right text-sm font-heading text-primary font-bold">
                      +{rp} RP
                    </div>

                    <div className="col-span-2 text-right">
                      {player.is_self ? (
                        <span className="text-xs text-mutedForeground font-heading">—</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => bustOut(player.username, player.is_npc)}
                          disabled={loading || jailStatus.in_jail}
                          className="bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground hover:opacity-90 rounded-sm px-3 py-1.5 text-xs font-heading font-bold uppercase tracking-wider border border-yellow-600/50 disabled:opacity-50 transition-smooth"
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
          <div className="px-4 py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30">
            <div className="flex items-center gap-2">
              <div className="w-6 h-px bg-primary/50" />
              <h3 className="text-sm font-heading font-bold text-primary uppercase tracking-widest">Jail System</h3>
              <div className="flex-1 h-px bg-primary/50" />
            </div>
          </div>
          <div className="p-4">
            <ul className="space-y-1 text-xs text-mutedForeground font-heading">
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
