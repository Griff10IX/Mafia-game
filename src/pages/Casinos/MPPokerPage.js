import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { PlusCircle, User, Users, Clock, DollarSign, Trophy, ShieldCheck } from 'lucide-react';
import api, { refreshUser, getApiErrorMessage } from '../../utils/api';
import { FormattedNumberInput } from '../../components/FormattedNumberInput';
import styles from '../../styles/noir.module.css';

const VS_DEALER_MAX_SMALL_BLIND = 25000;

function formatMoney(n) {
  const num = Number(n ?? 0);
  if (Number.isNaN(num)) return '$0';
  return `$${Math.trunc(num).toLocaleString()}`;
}

export default function MPPokerPage() {
  const navigate = useNavigate();
  const [games, setGames] = useState([]);
  const [recentGames, setRecentGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [joiningId, setJoiningId] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createMaxPlayers, setCreateMaxPlayers] = useState(6);
  const [createBuyIn, setCreateBuyIn] = useState('100000');
  const [createSmallBlind, setCreateSmallBlind] = useState('');
  const [createExtraPrize, setCreateExtraPrize] = useState('');
  const [creating, setCreating] = useState(false);
  const [tournaments, setTournaments] = useState([]);
  const [tournamentCreateOpen, setTournamentCreateOpen] = useState(false);
  const [tournamentMaxPlayers, setTournamentMaxPlayers] = useState(6);
  const [tournamentBuyIn, setTournamentBuyIn] = useState('100000');
  const [tournamentCreating, setTournamentCreating] = useState(false);
  const [joiningTournamentId, setJoiningTournamentId] = useState(null);
  const [vsDealerOpen, setVsDealerOpen] = useState(false);
  const [vsDealerBlind, setVsDealerBlind] = useState('5000');
  const [vsDealerStarting, setVsDealerStarting] = useState(false);
  const [cancellingId, setCancellingId] = useState(null);
  const [myUserId, setMyUserId] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminTournamentSettings, setAdminTournamentSettings] = useState({
    require_approval: true,
    tournament_limit_per_day: 10,
    tournaments_created_today: 0,
  });
  const [adminSettingsSaving, setAdminSettingsSaving] = useState(false);
  const [adminActionLoading, setAdminActionLoading] = useState(null);
  const [adminDrafts, setAdminDrafts] = useState({});

  useEffect(() => {
    api.get('/auth/me').then((r) => setMyUserId(r.data?.id ?? null)).catch(() => {});
    api.get('/admin/whoami')
      .then((r) => setIsAdmin(Boolean(r.data?.is_admin)))
      .catch(() => setIsAdmin(false));
  }, []);

  const fetchGames = useCallback(() => {
    api.get('/casino/mp-poker/games').then((r) => setGames(r.data?.games ?? [])).catch(() => setGames([])).finally(() => setLoading(false));
    api.get('/casino/mp-poker/recent-games').then((r) => setRecentGames(r.data?.games ?? [])).catch(() => {
      setRecentGames([]);
    });
    api.get('/casino/mp-poker/tournaments').then((r) => setTournaments(r.data?.tournaments ?? [])).catch(() => setTournaments([]));
  }, []);

  const fetchTournamentAdminSettings = useCallback(() => {
    if (!isAdmin) return;
    api.get('/casino/mp-poker/tournaments/admin-settings')
      .then((r) => setAdminTournamentSettings({
        require_approval: r.data?.require_approval !== false,
        tournament_limit_per_day: Number(r.data?.tournament_limit_per_day || 10),
        tournaments_created_today: Number(r.data?.tournaments_created_today || 0),
      }))
      .catch(() => {});
  }, [isAdmin]);

  useEffect(() => {
    fetchGames();
    const t = setInterval(fetchGames, 8000);
    return () => clearInterval(t);
  }, [fetchGames]);

  useEffect(() => {
    fetchTournamentAdminSettings();
  }, [fetchTournamentAdminSettings]);

  const handlePlayVsDealer = async () => {
    const parsed = parseInt(String(vsDealerBlind).replace(/\D/g, ''), 10) || 5000;
    const blind = Math.min(VS_DEALER_MAX_SMALL_BLIND, parsed);
    setVsDealerStarting(true);
    try {
      const res = await api.post('/casino/mp-poker/vs-dealer/start', { blind });
      await refreshUser();
      if (res.data?.game_id) {
        navigate(`/casino/mp-poker/game/${res.data.game_id}`, { state: { game: res.data.game } });
      }
    } catch (e) { toast.error(getApiErrorMessage(e) || 'Could not start'); }
    finally { setVsDealerStarting(false); }
  };

  const handleCreate = async () => {
    const buyIn = parseInt(String(createBuyIn).replace(/\D/g, ''), 10) || 0;
    if (buyIn <= 0) { toast.error('Buy-in must be positive'); return; }
    setCreating(true);
    try {
      const res = await api.post('/casino/mp-poker/games', {
        max_players: Math.max(2, Math.min(9, createMaxPlayers)),
        buy_in: buyIn,
        small_blind: parseInt(String(createSmallBlind).replace(/\D/g, ''), 10) || 0,
        extra_prize: parseInt(String(createExtraPrize).replace(/\D/g, ''), 10) || 0,
      });
      await refreshUser();
      toast.success('Table created');
      setCreateOpen(false);
      fetchGames();
      if (res.data?.game_id) {
        navigate(`/casino/mp-poker/game/${res.data.game_id}`, { state: { game: res.data.game } });
      }
    } catch (e) { toast.error(getApiErrorMessage(e) || 'Could not create'); }
    finally { setCreating(false); }
  };

  const handleJoin = async (gameId) => {
    setJoiningId(gameId);
    try {
      const res = await api.post(`/casino/mp-poker/games/${gameId}/join`);
      await refreshUser();
      fetchGames();
      if (res.data?.id) {
        navigate(`/casino/mp-poker/game/${res.data.id}`, { state: { game: res.data } });
      }
    } catch (e) { toast.error(getApiErrorMessage(e) || 'Could not join'); }
    finally { setJoiningId(null); }
  };

  const handleCancelGame = async (gameId) => {
    setCancellingId(gameId);
    try {
      await api.post(`/casino/mp-poker/games/${gameId}/cancel`);
      await refreshUser();
      toast.success('Game cancelled');
      fetchGames();
    } catch (e) { toast.error(getApiErrorMessage(e) || 'Could not cancel'); }
    finally { setCancellingId(null); }
  };

  const handleCreateTournament = async () => {
    const buyIn = parseInt(String(tournamentBuyIn).replace(/\D/g, ''), 10) || 0;
    if (buyIn <= 0) { toast.error('Tournament buy-in must be positive'); return; }
    setTournamentCreating(true);
    try {
      const res = await api.post('/casino/mp-poker/tournaments', {
        max_players: Math.max(4, Math.min(9, tournamentMaxPlayers)),
        buy_in: buyIn,
      });
      await refreshUser();
      const approvalStatus = res.data?.game?.approval_status;
      toast.success(approvalStatus === 'approved' ? 'Tournament created and open for registration' : 'Tournament submitted for admin approval');
      setTournamentCreateOpen(false);
      fetchGames();
      if (res.data?.game_id) {
        navigate(`/casino/mp-poker/game/${res.data.game_id}`, { state: { game: res.data.game } });
      }
    } catch (e) { toast.error(getApiErrorMessage(e) || 'Could not create tournament'); }
    finally { setTournamentCreating(false); }
  };

  const handleJoinTournament = async (gameId) => {
    setJoiningTournamentId(gameId);
    try {
      const res = await api.post(`/casino/mp-poker/tournaments/${gameId}/join`);
      await refreshUser();
      fetchGames();
      if (res.data?.id) {
        navigate(`/casino/mp-poker/game/${res.data.id}`, { state: { game: res.data } });
      }
    } catch (e) { toast.error(getApiErrorMessage(e) || 'Could not join tournament'); }
    finally { setJoiningTournamentId(null); }
  };

  const getAdminDraft = (gameId) => adminDrafts[gameId] || {
    reason: '',
    bonus_money: '',
    bonus_points: '',
    bonus_token_type: '',
    bonus_token_amount: '',
    bonus_car_id: '',
  };

  const setAdminDraft = (gameId, patch) => {
    setAdminDrafts((prev) => ({ ...prev, [gameId]: { ...getAdminDraft(gameId), ...patch } }));
  };

  const handleAdminSaveTournamentSettings = async () => {
    if (!isAdmin) return;
    setAdminSettingsSaving(true);
    try {
      const res = await api.patch('/casino/mp-poker/tournaments/admin-settings', {
        require_approval: Boolean(adminTournamentSettings.require_approval),
        tournament_limit_per_day: Math.max(1, parseInt(String(adminTournamentSettings.tournament_limit_per_day), 10) || 1),
      });
      setAdminTournamentSettings({
        require_approval: res.data?.require_approval !== false,
        tournament_limit_per_day: Number(res.data?.tournament_limit_per_day || 10),
        tournaments_created_today: Number(res.data?.tournaments_created_today || 0),
      });
      toast.success('Tournament settings saved');
    } catch (e) {
      toast.error(getApiErrorMessage(e) || 'Could not save tournament settings');
    } finally {
      setAdminSettingsSaving(false);
    }
  };

  const handleAdminApproveTournament = async (gameId) => {
    const draft = getAdminDraft(gameId);
    setAdminActionLoading(`approve-${gameId}`);
    try {
      await api.post(`/admin/mp-poker/tournaments/${gameId}/approve`, {
        reason: draft.reason || null,
        bonus_money: parseInt(String(draft.bonus_money).replace(/\D/g, ''), 10) || 0,
        bonus_points: parseInt(String(draft.bonus_points).replace(/\D/g, ''), 10) || 0,
        bonus_token_type: (draft.bonus_token_type || '').trim() || null,
        bonus_token_amount: parseInt(String(draft.bonus_token_amount).replace(/\D/g, ''), 10) || 0,
        bonus_car_id: (draft.bonus_car_id || '').trim() || null,
      });
      toast.success('Tournament approved');
      fetchGames();
    } catch (e) {
      toast.error(getApiErrorMessage(e) || 'Could not approve tournament');
    } finally {
      setAdminActionLoading(null);
    }
  };

  const handleAdminDenyTournament = async (gameId) => {
    const draft = getAdminDraft(gameId);
    setAdminActionLoading(`deny-${gameId}`);
    try {
      await api.post(`/admin/mp-poker/tournaments/${gameId}/deny`, {
        reason: draft.reason || null,
      });
      toast.success('Tournament denied and refunded');
      fetchGames();
    } catch (e) {
      toast.error(getApiErrorMessage(e) || 'Could not deny tournament');
    } finally {
      setAdminActionLoading(null);
    }
  };

  const inputStyle = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(212,175,55,0.2)', color: 'inherit' };
  const selectStyle = { ...inputStyle, background: '#27272a', color: '#e4e4e7', colorScheme: 'dark' };

  return (
    <div className={`space-y-4 ${styles.pageContent} mobile-page-root`} data-testid="mp-poker-page">
      <style>{`
        @keyframes pkr-lobby-fade { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
        .pkr-lobby-fade { animation: pkr-lobby-fade 0.4s ease-out both; }
        @keyframes pkr-row { from { opacity:0; transform:translateX(-4px); } to { opacity:1; transform:translateX(0); } }
        .pkr-row { animation: pkr-row 0.3s ease-out both; }
        @keyframes chip-spin { from { transform: rotateY(0deg); } to { transform: rotateY(360deg); } }
        .mp-poker-select option { background: #27272a; color: #e4e4e7; }
      `}</style>

      {/* ── Header ── */}
      <div className="pkr-lobby-fade">
        <p className="text-[9px] text-primary/40 font-heading uppercase tracking-[0.3em] mb-0.5">Texas Hold'em · Casino</p>
        <h1 className="text-xl font-heading font-bold text-primary tracking-wider uppercase">Poker Room</h1>
        <p className="text-[10px] text-mutedForeground font-heading italic mt-1">
          1v1 vs the house · or seat yourself at a live multiplayer table
        </p>
      </div>

      {/* ── Mode cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pkr-lobby-fade" style={{ animationDelay: '0.04s' }}>
        {/* Vs Dealer */}
        <div className={`relative ${styles.panel} mobile-panel rounded-xl overflow-hidden border-2`} style={{ borderColor: '#5a3e1b' }}>
          <div style={{ height: 3, background: 'linear-gradient(90deg,#5a3e1b,var(--noir-primary-bright),#8b6914,var(--noir-primary-bright),#5a3e1b)' }} />
          <div className="p-4">
            <div className="flex items-center gap-2 mb-1.5">
              <div className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: 'rgba(212,175,55,0.15)', border: '1px solid rgba(212,175,55,0.3)' }}>
                <User size={14} className="text-primary" />
              </div>
              <div>
                <h2 className="text-[11px] font-heading font-bold text-primary uppercase tracking-wider">Vs Dealer</h2>
                <p className="text-[8px] text-mutedForeground font-heading">1-on-1 · House bot</p>
              </div>
            </div>
            <p className="text-[9px] text-mutedForeground font-heading mb-3 leading-relaxed">
              Private hand against the house. Full Hold'em — blinds, flop, turn, river.
            </p>
            <button type="button" onClick={() => setVsDealerOpen((o) => !o)}
              className="w-full py-2 rounded-lg border-2 font-heading font-bold text-[9px] uppercase tracking-wider transition-all active:scale-[0.97]"
              style={{
                background: vsDealerOpen ? 'linear-gradient(180deg,var(--noir-primary),#a08020)' : 'rgba(212,175,55,0.1)',
                borderColor: 'var(--noir-primary-bright)', color: vsDealerOpen ? '#1a1200' : 'var(--noir-primary)',
              }}>
              {vsDealerOpen ? 'Close' : 'Take a Seat'}
            </button>
            {vsDealerOpen && (
              <div className="mt-3 space-y-2 pt-3 border-t border-primary/20">
                <label className="text-[9px] font-heading text-mutedForeground uppercase tracking-wider block">Small Blind</label>
                <FormattedNumberInput value={vsDealerBlind} onChange={setVsDealerBlind} max={VS_DEALER_MAX_SMALL_BLIND} placeholder="5,000"
                  className="w-full px-2.5 py-1.5 rounded-lg font-heading text-sm focus:outline-none" style={inputStyle} />
                <button type="button" onClick={handlePlayVsDealer} disabled={vsDealerStarting}
                  className="w-full py-2 rounded-lg border-2 font-heading font-bold text-[9px] uppercase disabled:opacity-50 active:scale-[0.97] transition-all"
                  style={{ background: 'linear-gradient(180deg,var(--noir-primary),#a08020)', borderColor: 'var(--noir-primary-bright)', color: '#1a1200' }}>
                  {vsDealerStarting ? 'Dealing…' : 'Deal Cards'}
                </button>
              </div>
            )}
          </div>
          <div style={{ height: 3, background: 'linear-gradient(90deg,#5a3e1b,var(--noir-primary-bright),#8b6914,var(--noir-primary-bright),#5a3e1b)' }} />
        </div>

        {/* Multiplayer */}
        <div className={`relative ${styles.panel} mobile-panel rounded-xl overflow-hidden border-2`} style={{ borderColor: '#5a3e1b' }}>
          <div style={{ height: 3, background: 'linear-gradient(90deg,#5a3e1b,var(--noir-primary-bright),#8b6914,var(--noir-primary-bright),#5a3e1b)' }} />
          <div className="p-4">
            <div className="flex items-center gap-2 mb-1.5">
              <div className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: 'rgba(212,175,55,0.15)', border: '1px solid rgba(212,175,55,0.3)' }}>
                <Users size={14} className="text-primary" />
              </div>
              <div>
                <h2 className="text-[11px] font-heading font-bold text-primary uppercase tracking-wider">Multiplayer</h2>
                <p className="text-[8px] text-mutedForeground font-heading">2–9 players · Live table</p>
              </div>
            </div>
            <p className="text-[9px] text-mutedForeground font-heading mb-3 leading-relaxed">
              Create or join a live Hold'em table. Buy in, compete for the pot.
            </p>
            <button type="button" onClick={() => setCreateOpen((o) => !o)}
              className="w-full py-2 rounded-lg border-2 font-heading font-bold text-[9px] uppercase tracking-wider transition-all active:scale-[0.97] flex items-center justify-center gap-1.5"
              style={{
                background: createOpen ? 'linear-gradient(180deg,var(--noir-primary),#a08020)' : 'rgba(212,175,55,0.1)',
                borderColor: 'var(--noir-primary-bright)', color: createOpen ? '#1a1200' : 'var(--noir-primary)',
              }}>
              <PlusCircle size={12} />
              {createOpen ? 'Close' : 'Deal New Table'}
            </button>
            {createOpen && (
              <div className="mt-3 space-y-2 pt-3 border-t border-primary/20">
                <div className="flex items-center gap-2">
                  <label className="text-[9px] font-heading text-mutedForeground uppercase tracking-wider w-20 shrink-0">Max Players</label>
                  <select value={createMaxPlayers} onChange={(e) => setCreateMaxPlayers(Number(e.target.value))}
                    className="mp-poker-select flex-1 px-2 py-1.5 rounded-lg font-heading text-sm focus:outline-none" style={selectStyle}>
                    {[2,3,4,5,6,7,8,9].map((n) => <option key={n} value={n}>{n} players</option>)}
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-[9px] font-heading text-mutedForeground uppercase tracking-wider w-20 shrink-0">Buy-in ($)</label>
                  <FormattedNumberInput value={createBuyIn} onChange={setCreateBuyIn} placeholder="100,000"
                    className="flex-1 px-2 py-1.5 rounded-lg font-heading text-sm focus:outline-none" style={inputStyle} />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-[9px] font-heading text-mutedForeground uppercase tracking-wider w-20 shrink-0">Small Blind</label>
                  <FormattedNumberInput value={createSmallBlind} onChange={setCreateSmallBlind} placeholder="Auto (buy-in/100)"
                    className="flex-1 px-2 py-1.5 rounded-lg font-heading text-sm focus:outline-none" style={inputStyle} />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-[9px] font-heading text-mutedForeground uppercase tracking-wider w-20 shrink-0">Bonus Prize</label>
                  <FormattedNumberInput value={createExtraPrize} onChange={setCreateExtraPrize} placeholder="0 (optional)"
                    className="flex-1 px-2 py-1.5 rounded-lg font-heading text-sm focus:outline-none" style={inputStyle} />
                </div>
                <button type="button" onClick={handleCreate} disabled={creating}
                  className="w-full py-2 rounded-lg border-2 font-heading font-bold text-[9px] uppercase disabled:opacity-50 active:scale-[0.97] transition-all mt-1"
                  style={{ background: 'linear-gradient(180deg,var(--noir-primary),#a08020)', borderColor: 'var(--noir-primary-bright)', color: '#1a1200' }}>
                  {creating ? 'Creating…' : 'Open Table'}
                </button>
              </div>
            )}
          </div>
          <div style={{ height: 3, background: 'linear-gradient(90deg,#5a3e1b,var(--noir-primary-bright),#8b6914,var(--noir-primary-bright),#5a3e1b)' }} />
        </div>
      </div>

      {/* ── Open tables ── */}
      <div className={`relative ${styles.panel} mobile-panel rounded-lg overflow-hidden border border-primary/20 pkr-lobby-fade`} style={{ animationDelay: '0.08s' }}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20">
          <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">Open Tables</h2>
          <p className="text-[9px] text-mutedForeground font-heading mt-0.5">Buy a seat before the cards are dealt</p>
        </div>
        <div className="divide-y divide-primary/10">
          {loading ? (
            <p className="text-[10px] text-mutedForeground font-heading py-5 text-center animate-pulse">Checking the room…</p>
          ) : games.length === 0 ? (
            <div className="py-8 text-center space-y-1">
              <p className="text-2xl opacity-20">♠</p>
              <p className="text-[10px] text-mutedForeground font-heading">No open tables. Be the first to sit down.</p>
            </div>
          ) : (
            games.map((g, idx) => {
              const isIn = (g.player_ids || []).includes(myUserId);
              const isCreator = g.creator_id === myUserId;
              const full = (g.player_count || 0) >= (g.max_players || 6);
              const isReady = g.phase === 'ready';
              const isPlaying = g.status === 'playing' && g.phase === 'playing';
              const pips = Array.from({ length: g.max_players ?? 6 }, (_, i) => i < (g.player_count ?? 0));
              return (
                <div key={g.id} className="pkr-row px-3 py-3 hover:bg-primary/5 transition-colors"
                  style={{ animationDelay: `${0.05 + idx * 0.03}s` }}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] font-heading font-bold text-foreground">{g.creator_username ?? '—'}</span>
                        <span className="text-[8px] font-heading font-bold px-1.5 py-0.5 rounded-full uppercase"
                          style={isPlaying
                            ? { background: 'rgba(212,175,55,0.15)', color: 'var(--noir-primary)', border: '1px solid rgba(212,175,55,0.3)' }
                            : isReady
                            ? { background: 'rgba(139,92,246,0.15)', color: '#a78bfa', border: '1px solid rgba(139,92,246,0.3)' }
                            : { background: 'rgba(52,211,153,0.12)', color: '#34d399', border: '1px solid rgba(52,211,153,0.25)' }
                          }>
                          {isPlaying ? 'In Progress' : isReady ? 'Ready Up' : 'Open'}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="text-[9px] font-heading text-mutedForeground">
                          Buy-in <span className="text-primary font-bold">{formatMoney(g.buy_in)}</span>
                        </span>
                        <span className="text-[9px] font-heading text-mutedForeground">
                          Pot <span className="text-primary font-bold">{formatMoney(g.pot)}</span>
                        </span>
                        {g.big_blind && (
                          <span className="text-[9px] font-heading text-mutedForeground">
                            Blinds <span className="text-primary/70 font-bold">{formatMoney(g.small_blind)}/{formatMoney(g.big_blind)}</span>
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        {pips.map((filled, i) => (
                          <div key={i} className="w-2 h-2 rounded-full"
                            style={{ background: filled ? 'var(--noir-primary)' : 'rgba(255,255,255,0.1)', border: filled ? '1px solid rgba(212,175,55,0.6)' : '1px solid rgba(255,255,255,0.1)' }} />
                        ))}
                        <span className="text-[8px] font-heading text-mutedForeground ml-1">{g.player_count}/{g.max_players}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {(isCreator || isIn) && !full && (
                        <button type="button" disabled={cancellingId !== null} onClick={() => handleCancelGame(g.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border font-heading font-bold text-[9px] uppercase disabled:opacity-50"
                          style={{ borderColor: 'rgba(248,113,113,0.4)', background: 'rgba(248,113,113,0.08)', color: '#f87171' }}>
                          {cancellingId === g.id ? '…' : 'Cancel'}
                        </button>
                      )}
                      {!isIn && !full && (
                        <button type="button" disabled={joiningId !== null} onClick={() => handleJoin(g.id)}
                          className="rounded-lg border-2 px-3 py-1.5 font-heading font-bold text-[9px] uppercase tracking-wider active:scale-[0.97] transition-all disabled:opacity-50"
                          style={{ background: 'linear-gradient(180deg,var(--noir-primary),#a08020)', borderColor: 'var(--noir-primary-bright)', color: '#1a1200' }}>
                          {joiningId === g.id ? '…' : 'Buy In'}
                        </button>
                      )}
                      {(isIn || isCreator) && (
                        <button type="button" onClick={() => navigate(`/casino/mp-poker/game/${g.id}`)}
                          className="inline-flex items-center gap-1 rounded-lg border border-primary/30 bg-primary/10 px-2.5 py-1.5 font-heading font-bold text-[9px] uppercase tracking-wider hover:bg-primary/20 active:scale-[0.97] transition-all text-primary">
                          Open
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ── Tournaments ── */}
      <div className={`relative ${styles.panel} mobile-panel rounded-lg overflow-hidden border border-primary/20 pkr-lobby-fade`} style={{ animationDelay: '0.1s' }}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between gap-2">
          <div>
            <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em] flex items-center gap-1.5">
              <Trophy size={12} /> Poker Tournaments
            </h2>
            <p className="text-[9px] text-mutedForeground font-heading mt-0.5">4–9 players · freezeout · escalating blinds</p>
          </div>
          <button
            type="button"
            onClick={() => setTournamentCreateOpen((o) => !o)}
            className="rounded-lg border border-primary/30 bg-primary/10 px-2.5 py-1.5 font-heading font-bold text-[9px] uppercase tracking-wider hover:bg-primary/20 transition-all"
          >
            {tournamentCreateOpen ? 'Close' : 'Create'}
          </button>
        </div>
        {tournamentCreateOpen && (
          <div className="p-3 space-y-2 border-b border-primary/10">
            <div className="flex items-center gap-2">
              <label className="text-[9px] font-heading text-mutedForeground uppercase tracking-wider w-20 shrink-0">Players</label>
              <select value={tournamentMaxPlayers} onChange={(e) => setTournamentMaxPlayers(Number(e.target.value))}
                className="mp-poker-select flex-1 px-2 py-1.5 rounded-lg font-heading text-sm focus:outline-none" style={selectStyle}>
                {[4,5,6,7,8,9].map((n) => <option key={n} value={n}>{n} players</option>)}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-[9px] font-heading text-mutedForeground uppercase tracking-wider w-20 shrink-0">Buy-in ($)</label>
              <FormattedNumberInput value={tournamentBuyIn} onChange={setTournamentBuyIn} placeholder="100,000"
                className="flex-1 px-2 py-1.5 rounded-lg font-heading text-sm focus:outline-none" style={inputStyle} />
            </div>
            <button type="button" onClick={handleCreateTournament} disabled={tournamentCreating}
              className="w-full py-2 rounded-lg border-2 font-heading font-bold text-[9px] uppercase disabled:opacity-50 active:scale-[0.97] transition-all mt-1"
              style={{ background: 'linear-gradient(180deg,var(--noir-primary),#a08020)', borderColor: 'var(--noir-primary-bright)', color: '#1a1200' }}>
              {tournamentCreating ? 'Submitting…' : 'Submit Tournament'}
            </button>
          </div>
        )}
        {isAdmin && (
          <div className="p-3 border-b border-primary/10 space-y-2">
            <div className="text-[9px] text-primary/80 font-heading font-bold uppercase tracking-wider">Admin Tournament Controls</div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-[9px] text-mutedForeground font-heading">Require approval</label>
              <button
                type="button"
                onClick={() => setAdminTournamentSettings((s) => ({ ...s, require_approval: !s.require_approval }))}
                className="px-2 py-1 rounded border text-[9px] font-heading"
                style={{ borderColor: 'rgba(212,175,55,0.35)', color: 'var(--noir-primary)', background: 'rgba(212,175,55,0.08)' }}
              >
                {adminTournamentSettings.require_approval ? 'On' : 'Off'}
              </button>
              <label className="text-[9px] text-mutedForeground font-heading ml-2">Daily limit</label>
              <input
                type="number"
                min={1}
                max={500}
                value={adminTournamentSettings.tournament_limit_per_day}
                onChange={(e) => setAdminTournamentSettings((s) => ({ ...s, tournament_limit_per_day: e.target.value }))}
                className="w-20 px-2 py-1 rounded border text-[10px] font-heading"
                style={inputStyle}
              />
              <button
                type="button"
                onClick={handleAdminSaveTournamentSettings}
                disabled={adminSettingsSaving}
                className="px-2.5 py-1 rounded border text-[9px] font-heading font-bold uppercase disabled:opacity-50"
                style={{ borderColor: 'rgba(212,175,55,0.35)', color: 'var(--noir-primary)', background: 'rgba(212,175,55,0.12)' }}
              >
                {adminSettingsSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
            <div className="text-[9px] text-mutedForeground font-heading">
              Today {Number(adminTournamentSettings.tournaments_created_today || 0).toLocaleString()}/
              {Number(adminTournamentSettings.tournament_limit_per_day || 0).toLocaleString()} tournaments used
            </div>
          </div>
        )}
        <div className="divide-y divide-primary/10">
          {tournaments.length === 0 ? (
            <div className="py-5 text-center text-[10px] text-mutedForeground font-heading">
              No tournaments yet.
            </div>
          ) : (
            tournaments.map((t, idx) => {
              const isIn = (t.player_ids || []).includes(myUserId);
              const isCreator = t.creator_id === myUserId;
              const full = (t.player_count || 0) >= (t.max_players || 9);
              const canJoin = t.approval_status === 'approved' && t.tournament_status === 'registration' && !isIn && !full;
              const statusText = t.approval_status === 'pending'
                ? 'Pending Approval'
                : t.approval_status === 'denied'
                ? 'Denied'
                : t.tournament_status === 'running'
                ? 'Running'
                : t.tournament_status === 'completed'
                ? 'Completed'
                : 'Registration Open';
              return (
                <div key={t.id} className="pkr-row px-3 py-2.5 hover:bg-primary/5 transition-colors" style={{ animationDelay: `${0.04 + idx * 0.03}s` }}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] font-heading font-bold text-foreground truncate">{t.creator_username || '—'}</span>
                        <span className="text-[8px] font-heading font-bold px-1.5 py-0.5 rounded-full uppercase"
                          style={{ background: 'rgba(212,175,55,0.12)', color: 'var(--noir-primary)', border: '1px solid rgba(212,175,55,0.3)' }}>
                          {statusText}
                        </span>
                      </div>
                      <div className="text-[9px] text-mutedForeground font-heading mt-0.5 flex items-center gap-3 flex-wrap">
                        <span>Buy-in <span className="text-primary font-bold">{formatMoney(t.buy_in)}</span></span>
                        <span>Prize <span className="text-primary font-bold">{formatMoney(t.prize_pool)}</span></span>
                        <span>Blinds <span className="text-primary/80">{formatMoney(t.small_blind)}/{formatMoney(t.big_blind)}</span></span>
                        <span>{t.player_count}/{t.max_players}</span>
                      </div>
                      {isAdmin && t.approval_status === 'pending' && (
                        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-w-[520px]">
                          <input
                            type="text"
                            value={getAdminDraft(t.id).reason}
                            onChange={(e) => setAdminDraft(t.id, { reason: e.target.value })}
                            placeholder="Reason (optional)"
                            className="sm:col-span-2 px-2 py-1 rounded border text-[10px] font-heading"
                            style={inputStyle}
                          />
                          <input
                            type="text"
                            value={getAdminDraft(t.id).bonus_money}
                            onChange={(e) => setAdminDraft(t.id, { bonus_money: e.target.value })}
                            placeholder="Winner bonus money"
                            className="px-2 py-1 rounded border text-[10px] font-heading"
                            style={inputStyle}
                          />
                          <input
                            type="text"
                            value={getAdminDraft(t.id).bonus_points}
                            onChange={(e) => setAdminDraft(t.id, { bonus_points: e.target.value })}
                            placeholder="Winner bonus points"
                            className="px-2 py-1 rounded border text-[10px] font-heading"
                            style={inputStyle}
                          />
                          <input
                            type="text"
                            value={getAdminDraft(t.id).bonus_token_type}
                            onChange={(e) => setAdminDraft(t.id, { bonus_token_type: e.target.value })}
                            placeholder="Token type (e.g. racket)"
                            className="px-2 py-1 rounded border text-[10px] font-heading"
                            style={inputStyle}
                          />
                          <input
                            type="text"
                            value={getAdminDraft(t.id).bonus_token_amount}
                            onChange={(e) => setAdminDraft(t.id, { bonus_token_amount: e.target.value })}
                            placeholder="Token amount"
                            className="px-2 py-1 rounded border text-[10px] font-heading"
                            style={inputStyle}
                          />
                          <input
                            type="text"
                            value={getAdminDraft(t.id).bonus_car_id}
                            onChange={(e) => setAdminDraft(t.id, { bonus_car_id: e.target.value })}
                            placeholder="Bonus car ID (optional)"
                            className="sm:col-span-2 px-2 py-1 rounded border text-[10px] font-heading"
                            style={inputStyle}
                          />
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {canJoin && (
                        <button type="button" disabled={joiningTournamentId !== null} onClick={() => handleJoinTournament(t.id)}
                          className="rounded-lg border-2 px-3 py-1.5 font-heading font-bold text-[9px] uppercase tracking-wider active:scale-[0.97] transition-all disabled:opacity-50"
                          style={{ background: 'linear-gradient(180deg,var(--noir-primary),#a08020)', borderColor: 'var(--noir-primary-bright)', color: '#1a1200' }}>
                          {joiningTournamentId === t.id ? '…' : 'Join'}
                        </button>
                      )}
                      {(isIn || isCreator) && (
                        <button type="button" onClick={() => navigate(`/casino/mp-poker/game/${t.id}`)}
                          className="inline-flex items-center gap-1 rounded-lg border border-primary/30 bg-primary/10 px-2.5 py-1.5 font-heading font-bold text-[9px] uppercase tracking-wider hover:bg-primary/20 active:scale-[0.97] transition-all text-primary">
                          <ShieldCheck size={11} /> Open
                        </button>
                      )}
                      {isAdmin && t.approval_status === 'pending' && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleAdminApproveTournament(t.id)}
                            disabled={adminActionLoading !== null}
                            className="rounded-lg border px-2.5 py-1.5 font-heading font-bold text-[9px] uppercase disabled:opacity-50"
                            style={{ borderColor: 'rgba(52,211,153,0.5)', color: '#34d399', background: 'rgba(52,211,153,0.08)' }}
                          >
                            {adminActionLoading === `approve-${t.id}` ? '…' : 'Approve'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleAdminDenyTournament(t.id)}
                            disabled={adminActionLoading !== null}
                            className="rounded-lg border px-2.5 py-1.5 font-heading font-bold text-[9px] uppercase disabled:opacity-50"
                            style={{ borderColor: 'rgba(248,113,113,0.5)', color: '#f87171', background: 'rgba(248,113,113,0.08)' }}
                          >
                            {adminActionLoading === `deny-${t.id}` ? '…' : 'Deny'}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ── Recent games ── */}
      {recentGames.length > 0 && (
        <div className={`${styles.panel} mobile-panel rounded-lg overflow-hidden border border-primary/20 pkr-lobby-fade`} style={{ animationDelay: '0.12s' }}>
          <div className="px-3 py-2 bg-primary/8 border-b border-primary/20">
            <span className="text-[9px] font-heading font-bold text-primary uppercase tracking-widest">Recent Games</span>
          </div>
          <div className="divide-y divide-primary/10">
            {recentGames.slice(0, 5).map((g) => (
              <div key={g.id} className="px-3 py-2 flex items-center justify-between text-[9px] font-heading">
                <span className="text-mutedForeground">{g.creator_username ?? '—'}</span>
                <span className="text-primary font-bold">{formatMoney(g.pot)}</span>
                <span className="text-mutedForeground">{g.completed_at ? new Date(g.completed_at).toLocaleDateString() : ''}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Rules ── */}
      <div className={`${styles.panel} mobile-panel rounded-lg overflow-hidden border border-primary/20 pkr-lobby-fade`} style={{ animationDelay: '0.14s' }}>
        <div className="px-3 py-2 bg-primary/8 border-b border-primary/20">
          <span className="text-[9px] font-heading font-bold text-primary uppercase tracking-widest">House Rules</span>
        </div>
        <div className="p-3 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
          {[
            'Texas Hold\'em — 2 hole cards, 5 community cards',
            'Blinds posted automatically each hand',
            'All players must ready up before cards are dealt',
            'Best 5-card hand from 7 wins the pot',
            'Fold, check, call, raise, or go all-in',
            '60s per turn — auto-fold on timeout',
          ].map((rule) => (
            <div key={rule} className="flex items-start gap-1.5 text-[9px] font-heading text-mutedForeground">
              <span className="text-primary mt-0.5 shrink-0">♠</span>{rule}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}