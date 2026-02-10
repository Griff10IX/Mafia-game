import { useState, useEffect } from 'react';
import { Lock, Users, AlertCircle, Zap } from 'lucide-react';
import api from '../utils/api';
import { toast } from 'sonner';

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
    <div className="space-y-6" data-testid="jail-page">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-mutedForeground">Jail</div>
          <h1 className="text-3xl md:text-4xl font-heading font-bold text-primary mt-2">Jail</h1>
        </div>
      </div>

      <div className="flex justify-center">
        <div className="w-full max-w-3xl">
          {jailStatus.in_jail ? (
            <div className="bg-destructive/10 border border-destructive rounded-sm p-6 text-center">
              <Lock className="text-destructive mx-auto mb-4" size={40} />
              <h2 className="text-xl font-heading font-bold text-destructive mb-2">You are in Jail!</h2>
              <p className="text-foreground mb-3">Time remaining:</p>
              <div className="text-3xl font-mono font-bold text-destructive mb-3">
                {jailStatus.seconds_remaining}s
              </div>
              <p className="text-xs text-mutedForeground">Wait for release or ask another player to bust you out</p>
            </div>
          ) : (
            <div className="bg-card border border-border rounded-sm p-6 text-center">
              <AlertCircle className="text-primary mx-auto mb-3" size={40} />
              <h2 className="text-xl font-heading font-bold text-foreground mb-2">You are Free</h2>
              <p className="text-sm text-mutedForeground">Bust out jailed players for rank points</p>
            </div>
          )}
        </div>
      </div>

      <div className="flex justify-center">
        <div className="w-full max-w-3xl bg-card border border-border rounded-sm overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 bg-secondary/40">
            <div className="text-xs uppercase tracking-wider text-mutedForeground">Jailed Players</div>
            <div className="text-xs text-mutedForeground flex items-center gap-2">
              <Users size={14} />
              <span>{jailedPlayers.length}</span>
            </div>
          </div>

          {jailedPlayers.length === 0 ? (
            <div className="px-4 py-10 text-center text-mutedForeground text-sm">No players currently in jail</div>
          ) : (
            <>
              <div className="grid grid-cols-12 bg-secondary/20 text-xs uppercase tracking-wider text-mutedForeground px-4 py-3 border-t border-border">
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
                    className="grid grid-cols-12 px-4 py-3 border-t border-border items-center transition-smooth bg-background/30 hover:bg-background/50"
                    data-testid={`jailed-player-${index}`}
                  >
                    <div className="col-span-5 min-w-0">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-foreground truncate">{player.username}</div>
                          <div className="text-xs text-mutedForeground truncate">{player.rank_name}</div>
                        </div>
                        {player.is_self ? (
                          <span className="shrink-0 text-[10px] uppercase tracking-wider font-bold bg-destructive/15 text-destructive px-2 py-0.5 rounded-sm border border-destructive/30">
                            You
                          </span>
                        ) : player.is_npc ? (
                          <span className="shrink-0 text-[10px] uppercase tracking-wider font-bold bg-secondary text-mutedForeground px-2 py-0.5 rounded-sm">
                            NPC
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="col-span-3 text-xs text-mutedForeground">
                      {player.is_npc ? (
                        <span className="inline-flex items-center gap-1">
                          <Zap size={12} className="text-yellow-400" />
                          Harder bust ({successRate}%)
                        </span>
                      ) : (
                        <span>Normal bust ({successRate}%)</span>
                      )}
                    </div>

                    <div className="col-span-2 text-right text-sm font-mono text-primary font-bold">
                      +{rp} RP
                    </div>

                    <div className="col-span-2 text-right">
                      {player.is_self ? (
                        <span className="text-xs text-mutedForeground font-mono">—</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => bustOut(player.username, player.is_npc)}
                          disabled={loading || jailStatus.in_jail}
                          className="bg-primary text-primaryForeground hover:opacity-90 rounded-sm px-3 py-1.5 text-xs font-bold uppercase tracking-widest transition-smooth gold-glow disabled:opacity-50"
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
        <div className="w-full max-w-3xl bg-card border border-border rounded-sm p-6">
          <h3 className="text-xl font-heading font-semibold text-primary mb-3">Jail System</h3>
          <ul className="space-y-2 text-sm text-mutedForeground">
            <li>• Failed crimes/GTA send you to jail (15-60 seconds)</li>
            <li>• NPCs appear every 1-2 minutes with harder bust rates (50% vs 70%)</li>
            <li>• Earn 15 RP for regular bust-outs, 25 RP for NPC bust-outs</li>
            <li>• Failed bust attempts send you to jail for 30 seconds</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
