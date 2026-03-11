import { useCallback, useEffect, useMemo, useState } from 'react';
import api, { getApiErrorMessage, refreshUser } from '../utils/api';
import { toast } from 'sonner';

function StatPill({ label, value }) {
  return (
    <div className="px-2 py-1 rounded-sm bg-[var(--noir-surface)] text-xs text-primary flex items-center justify-between gap-2">
      <span className="opacity-80">{label}</span>
      <span className="font-heading">{value}</span>
    </div>
  );
}

export default function Boxing() {
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [effective, setEffective] = useState(null);
  const [data, setData] = useState({ drills: {}, gyms: [], coaches: [], gear: [] });
  const [gearOwnedIds, setGearOwnedIds] = useState(new Set());

  const [opponentUsername, setOpponentUsername] = useState('');
  const [matchId, setMatchId] = useState('');
  const [match, setMatch] = useState(null);
  const [liveMatches, setLiveMatches] = useState([]);

  const [stake, setStake] = useState(10000);
  const [betFighter, setBetFighter] = useState('a');
  const [myBets, setMyBets] = useState({ open: [], closed: [] });
  const [leagueWeekly, setLeagueWeekly] = useState([]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const r = await api.get('/boxing/profile');
      setProfile(r.data.profile);
      setEffective(r.data.effective);
      setData({ drills: r.data.drills || {}, gyms: r.data.gyms || [], coaches: r.data.coaches || [], gear: r.data.gear || [] });
      const gear = await api.get('/boxing/gear');
      setGearOwnedIds(new Set((gear.data.owned_ids || []).filter(Boolean)));
      const lg = await api.get('/boxing/league', { params: { period: 'weekly' } });
      setLeagueWeekly(lg.data.standings || []);
      const bets = await api.get('/boxing/bets/my-bets');
      setMyBets(bets.data || { open: [], closed: [] });
      const live = await api.get('/boxing/matches/live');
      setLiveMatches(live.data.matches || []);
    } catch (e) {
      toast.error(getApiErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const equipped = profile?.equipped || {};
  const gym = useMemo(() => {
    const g = (data.gyms || []).find((x) => x.id === profile?.gym_id);
    return g || (data.gyms || [])[0] || null;
  }, [data.gyms, profile?.gym_id]);

  const doTrain = async (drillId) => {
    try {
      const r = await api.post('/boxing/train', { drill_id: drillId });
      setProfile(r.data.profile);
      setEffective(r.data.effective);
      toast.success(r.data.message || 'Trained');
    } catch (e) {
      toast.error(getApiErrorMessage(e));
    }
  };

  const upgradeGym = async () => {
    try {
      const r = await api.post('/boxing/gym/upgrade', {});
      setProfile(r.data.profile);
      setEffective(r.data.effective);
      toast.success(r.data.message || 'Gym upgraded');
      refreshUser();
    } catch (e) {
      toast.error(getApiErrorMessage(e));
    }
  };

  const moveGym = async (gymId) => {
    try {
      const r = await api.post('/boxing/gym/move', { gym_id: gymId });
      setProfile(r.data.profile);
      setEffective(r.data.effective);
      toast.success(r.data.message || 'Moved gyms');
    } catch (e) {
      toast.error(getApiErrorMessage(e));
    }
  };

  const hireCoach = async (coachId) => {
    try {
      const r = await api.post('/boxing/coach/hire', { coach_id: coachId });
      setProfile(r.data.profile);
      setEffective(r.data.effective);
      toast.success(r.data.message || 'Coach hired');
      refreshUser();
    } catch (e) {
      toast.error(getApiErrorMessage(e));
    }
  };

  const fireCoach = async () => {
    try {
      const r = await api.post('/boxing/coach/fire', {});
      setProfile(r.data.profile);
      setEffective(r.data.effective);
      toast.success(r.data.message || 'Coach fired');
    } catch (e) {
      toast.error(getApiErrorMessage(e));
    }
  };

  const refreshGear = async () => {
    try {
      const r = await api.get('/boxing/gear');
      setProfile((p) => ({ ...(p || {}), equipped: r.data.equipped || {} }));
      setGearOwnedIds(new Set((r.data.owned_ids || []).filter(Boolean)));
    } catch (e) {
      toast.error(getApiErrorMessage(e));
    }
  };

  const buyGear = async (gearId) => {
    try {
      const r = await api.post('/boxing/gear/buy', { gear_id: gearId });
      toast.success(r.data.message || 'Bought');
      refreshUser();
      await load();
    } catch (e) {
      toast.error(getApiErrorMessage(e));
    }
  };

  const equipGear = async (slot, gearId) => {
    try {
      const r = await api.post('/boxing/gear/equip', { slot, gear_id: gearId || null });
      setProfile(r.data.profile);
      setEffective(r.data.effective);
      toast.success(r.data.message || 'Equipped');
      await refreshGear();
    } catch (e) {
      toast.error(getApiErrorMessage(e));
    }
  };

  const unequipGear = async (slot) => equipGear(slot, null);

  const createMatch = async () => {
    try {
      const r = await api.post('/boxing/matches/create', { opponent_username: opponentUsername });
      setMatchId(r.data.match_id);
      toast.success(r.data.message || 'Match created');
    } catch (e) {
      toast.error(getApiErrorMessage(e));
    }
  };

  const readyUp = async (ready) => {
    try {
      const r = await api.post('/boxing/matches/ready', { match_id: matchId, ready: !!ready });
      toast.success(r.data.message || 'Ready updated');
      await loadMatch();
    } catch (e) {
      toast.error(getApiErrorMessage(e));
    }
  };

  const loadMatch = useCallback(async () => {
    if (!matchId) return;
    try {
      const r = await api.get(`/boxing/matches/${matchId}/watch`);
      setMatch(r.data);
    } catch (e) {
      toast.error(getApiErrorMessage(e));
    }
  }, [matchId]);

  useEffect(() => {
    if (!matchId) return;
    loadMatch();
    const t = setInterval(loadMatch, 1200);
    return () => clearInterval(t);
  }, [matchId, loadMatch]);

  const pickLiveMatch = (id) => {
    setMatchId(id);
    setMatch(null);
    setTimeout(loadMatch, 0);
  };

  const placeBet = async () => {
    try {
      const r = await api.post('/boxing/bets/place', { match_id: matchId, fighter: betFighter, stake: Number(stake) });
      toast.success(r.data.message || 'Bet placed');
      refreshUser();
      const bets = await api.get('/boxing/bets/my-bets');
      setMyBets(bets.data || { open: [], closed: [] });
    } catch (e) {
      toast.error(getApiErrorMessage(e));
    }
  };

  const cancelBet = async (betId) => {
    try {
      const r = await api.post('/boxing/bets/cancel', { bet_id: betId });
      toast.success(r.data.message || 'Bet cancelled');
      refreshUser();
      const bets = await api.get('/boxing/bets/my-bets');
      setMyBets(bets.data || { open: [], closed: [] });
    } catch (e) {
      toast.error(getApiErrorMessage(e));
    }
  };

  if (loading) {
    return <div className="p-4 text-primary text-sm font-heading">Loading boxing...</div>;
  }

  return (
    <div className="p-3 md:p-6 space-y-4 text-primary">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-lg font-heading">Boxing</div>
          <div className="text-xs opacity-70">Train, upgrade your gym, challenge players, watch fights round-by-round, and climb the weekly league.</div>
        </div>
        <button type="button" onClick={load} className="px-3 py-1 rounded-sm bg-[var(--noir-raised)] hover:bg-[var(--noir-surface)] text-xs">Refresh</button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <StatPill label="Rating" value={profile?.rating ?? '—'} />
        <StatPill label="Power" value={effective?.power ?? '—'} />
        <StatPill label="Speed" value={effective?.speed ?? '—'} />
        <StatPill label="Stamina" value={effective?.stamina ?? '—'} />
        <StatPill label="Defense" value={effective?.defense ?? '—'} />
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        <div className="rounded-md bg-[var(--noir-content)] p-3 space-y-2">
          <div className="font-heading">Training</div>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(data.drills || {}).map(([id, d]) => (
              <button key={id} type="button" onClick={() => doTrain(id)}
                className="px-3 py-2 rounded-sm bg-[var(--noir-raised)] hover:bg-[var(--noir-surface)] text-left">
                <div className="text-sm font-heading">{d.name}</div>
                <div className="text-[11px] opacity-70">Cooldown: {Math.round((d.cooldown_seconds || 0) / 60)}m</div>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-md bg-[var(--noir-content)] p-3 space-y-2">
          <div className="font-heading">Gym & Coach</div>
          <div className="text-sm">Gym: <span className="font-heading">{gym?.name || '—'}</span> (level {profile?.gym_level ?? 0}/{gym?.max_level ?? 0})</div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={upgradeGym} className="px-3 py-1 rounded-sm bg-[var(--noir-raised)] hover:bg-[var(--noir-surface)] text-xs">Upgrade gym</button>
            <div className="flex items-center gap-2 text-xs opacity-80">
              <span>Move:</span>
              {(data.gyms || []).map((g) => (
                <button key={g.id} type="button" onClick={() => moveGym(g.id)} className="px-2 py-1 rounded-sm bg-[var(--noir-raised)] hover:bg-[var(--noir-surface)]">{g.name}</button>
              ))}
            </div>
          </div>
          <div className="text-sm">Coach: <span className="font-heading">{profile?.coach_id || 'None'}</span></div>
          <div className="flex flex-wrap gap-2">
            {(data.coaches || []).map((c) => (
              <button key={c.id} type="button" onClick={() => hireCoach(c.id)} className="px-3 py-1 rounded-sm bg-[var(--noir-raised)] hover:bg-[var(--noir-surface)] text-xs">
                Hire {c.name}
              </button>
            ))}
            <button type="button" onClick={fireCoach} className="px-3 py-1 rounded-sm bg-[var(--noir-raised)] hover:bg-[var(--noir-surface)] text-xs">Fire coach</button>
          </div>
        </div>
      </div>

      <div className="rounded-md bg-[var(--noir-content)] p-3 space-y-2">
        <div className="font-heading">Equipment</div>
        <div className="text-xs opacity-70">Equipped: gloves={equipped.gloves || '—'} boots={equipped.boots || '—'} mouthguard={equipped.mouthguard || '—'} headgear={equipped.headgear || '—'}</div>
        <div className="flex flex-wrap gap-2">
          {['gloves', 'boots', 'mouthguard', 'headgear'].map((slot) => (
            <button
              key={slot}
              type="button"
              onClick={() => unequipGear(slot)}
              disabled={!equipped?.[slot]}
              className="px-3 py-1 rounded-sm bg-[var(--noir-raised)] hover:bg-[var(--noir-surface)] text-xs disabled:opacity-50"
            >
              Unequip {slot}
            </button>
          ))}
        </div>
        <div className="grid md:grid-cols-2 gap-2">
          {(data.gear || []).map((g) => (
            <div key={g.id} className="p-2 rounded-sm bg-[var(--noir-raised)] flex items-center justify-between gap-2">
              <div>
                <div className="text-sm font-heading">{g.name}</div>
                <div className="text-[11px] opacity-70">{g.slot} • ${Number(g.cost || 0).toLocaleString()}</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => buyGear(g.id)}
                  disabled={gearOwnedIds.has(g.id)}
                  className="px-2 py-1 rounded-sm bg-[var(--noir-surface)] hover:bg-[var(--noir-content)] text-xs disabled:opacity-50"
                >
                  {gearOwnedIds.has(g.id) ? 'Owned' : 'Buy'}
                </button>
                <button
                  type="button"
                  onClick={() => equipGear(g.slot, g.id)}
                  disabled={!gearOwnedIds.has(g.id)}
                  className="px-2 py-1 rounded-sm bg-[var(--noir-surface)] hover:bg-[var(--noir-content)] text-xs disabled:opacity-50"
                >
                  Equip
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="text-xs opacity-70">Unequip buttons clear a slot instantly.</div>
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        <div className="rounded-md bg-[var(--noir-content)] p-3 space-y-2">
          <div className="font-heading">Live / Pending fights</div>
          <div className="text-xs opacity-70">Tap a fight to watch (and bet if it hasn’t started yet).</div>
          <div className="max-h-[260px] overflow-auto space-y-1">
            {(liveMatches || []).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => pickLiveMatch(m.id)}
                className="w-full text-left text-xs bg-[var(--noir-raised)] hover:bg-[var(--noir-surface)] rounded-sm px-2 py-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-heading">{m.a_username}</span>
                  <span className="opacity-70">vs</span>
                  <span className="font-heading">{m.b_username}</span>
                  <span className="opacity-70">• {m.state}</span>
                </div>
                {m.state === 'running' ? (
                  <div className="opacity-70">Round {m.round}/{m.max_rounds} • HP {m.hp?.a}-{m.hp?.b}</div>
                ) : (
                  <div className="opacity-70">Odds A {m.odds?.a} / B {m.odds?.b}</div>
                )}
              </button>
            ))}
            {!liveMatches?.length ? <div className="text-xs opacity-70">No live/pending fights right now.</div> : null}
          </div>
          <button type="button" onClick={load} className="px-3 py-1 rounded-sm bg-[var(--noir-raised)] hover:bg-[var(--noir-surface)] text-xs">Refresh list</button>
        </div>

        <div className="rounded-md bg-[var(--noir-content)] p-3 space-y-2">
          <div className="font-heading">Create / Ready Match</div>
          <div className="flex gap-2">
            <input value={opponentUsername} onChange={(e) => setOpponentUsername(e.target.value)} placeholder="Opponent username"
              className="flex-1 px-3 py-2 rounded-sm bg-[var(--noir-surface)] text-sm outline-none" />
            <button type="button" onClick={createMatch} className="px-3 py-2 rounded-sm bg-[var(--noir-raised)] hover:bg-[var(--noir-surface)] text-sm">Challenge</button>
          </div>
          <div className="flex gap-2">
            <input value={matchId} onChange={(e) => setMatchId(e.target.value)} placeholder="Match id to watch/ready"
              className="flex-1 px-3 py-2 rounded-sm bg-[var(--noir-surface)] text-sm outline-none" />
            <button type="button" onClick={loadMatch} className="px-3 py-2 rounded-sm bg-[var(--noir-raised)] hover:bg-[var(--noir-surface)] text-sm">Load</button>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => readyUp(true)} disabled={!matchId}
              className="px-3 py-2 rounded-sm bg-[var(--noir-raised)] hover:bg-[var(--noir-surface)] text-sm disabled:opacity-50">Ready</button>
            <button type="button" onClick={() => readyUp(false)} disabled={!matchId}
              className="px-3 py-2 rounded-sm bg-[var(--noir-raised)] hover:bg-[var(--noir-surface)] text-sm disabled:opacity-50">Unready</button>
          </div>
        </div>

        <div className="rounded-md bg-[var(--noir-content)] p-3 space-y-2">
          <div className="font-heading">Betting (in-game)</div>
          <div className="text-xs opacity-70">Betting is open only while match is pending/ready.</div>
          <div className="flex gap-2 items-center">
            <select value={betFighter} onChange={(e) => setBetFighter(e.target.value)} className="px-2 py-2 rounded-sm bg-[var(--noir-surface)] text-sm">
              <option value="a">Fighter A</option>
              <option value="b">Fighter B</option>
            </select>
            <input type="number" value={stake} onChange={(e) => setStake(e.target.value)} className="flex-1 px-3 py-2 rounded-sm bg-[var(--noir-surface)] text-sm outline-none" />
            <button type="button" onClick={placeBet} disabled={!matchId} className="px-3 py-2 rounded-sm bg-[var(--noir-raised)] hover:bg-[var(--noir-surface)] text-sm disabled:opacity-50">Place</button>
          </div>
          <div className="space-y-1">
            <div className="text-sm font-heading">My open bets</div>
            {(myBets.open || []).slice(0, 6).map((b) => (
              <div key={b.id} className="flex items-center justify-between text-xs bg-[var(--noir-raised)] rounded-sm px-2 py-1">
                <span>Match {String(b.match_id).slice(0, 8)}… • {b.fighter?.toUpperCase()} • ${Number(b.stake || 0).toLocaleString()} @ {b.odds}</span>
                <button type="button" onClick={() => cancelBet(b.id)} className="px-2 py-1 rounded-sm bg-[var(--noir-surface)] hover:bg-[var(--noir-content)]">Cancel</button>
              </div>
            ))}
            {!myBets.open?.length ? <div className="text-xs opacity-70">No open bets.</div> : null}
          </div>
        </div>
      </div>

      <div className="rounded-md bg-[var(--noir-content)] p-3 space-y-2">
        <div className="font-heading">Watch Match</div>
        {!match ? (
          <div className="text-xs opacity-70">Load a match id to watch it.</div>
        ) : (
          <div className="space-y-2">
            <div className="text-sm">
              <span className="font-heading">{match.fighters?.a?.username}</span> vs <span className="font-heading">{match.fighters?.b?.username}</span>
              <span className="opacity-70"> • state={match.state} • round {match.round}/{match.max_rounds}</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-[var(--noir-raised)] rounded-sm p-2">
                <div className="font-heading">A</div>
                <div>HP: {match.hp?.a}</div>
                <div>Stam: {match.stam?.a}</div>
                <div>Odds: {match.odds?.a}</div>
              </div>
              <div className="bg-[var(--noir-raised)] rounded-sm p-2">
                <div className="font-heading">B</div>
                <div>HP: {match.hp?.b}</div>
                <div>Stam: {match.stam?.b}</div>
                <div>Odds: {match.odds?.b}</div>
              </div>
            </div>
            <div className="max-h-[320px] overflow-auto space-y-1">
              {(match.rounds || []).slice().reverse().slice(0, 30).map((r) => (
                <div key={`${r.round}-${r.at}`} className="text-xs bg-[var(--noir-raised)] rounded-sm px-2 py-1">
                  <span className="font-heading">R{r.round}</span>{' '}
                  A hits {r.a_hits} dmg {r.a_dmg} | B hits {r.b_hits} dmg {r.b_dmg}{' '}
                  <span className="opacity-70">HP A {r.hp?.a} / B {r.hp?.b}</span>
                </div>
              ))}
            </div>
            {match.state === 'finished' ? (
              <div className="text-sm">
                Winner: <span className="font-heading">{match.winner ? match.winner : 'Draw'}</span>{' '}
                <span className="opacity-70">({match.finish_reason})</span>
              </div>
            ) : null}
          </div>
        )}
      </div>

      <div className="rounded-md bg-[var(--noir-content)] p-3 space-y-2">
        <div className="font-heading">Weekly League</div>
        <div className="text-xs opacity-70">Rewards are paid weekly (Mon UTC) based on points earned from boxing matches.</div>
        <div className="grid md:grid-cols-2 gap-2">
          {(leagueWeekly || []).slice(0, 20).map((r) => (
            <div key={r.user_id} className="bg-[var(--noir-raised)] rounded-sm px-2 py-1 text-xs flex items-center justify-between">
              <span>
                <span className="font-heading">#{r.rank}</span> {r.username} <span className="opacity-70">({r.wins}-{r.losses})</span>
              </span>
              <span className="font-heading">{r.points} pts</span>
            </div>
          ))}
          {!leagueWeekly?.length ? <div className="text-xs opacity-70">No league data yet.</div> : null}
        </div>
      </div>
    </div>
  );
}

