import { useState, useEffect, useCallback } from 'react';
import { Gift, Clock, DollarSign, Sparkles, Hand, Grid3X3 } from 'lucide-react';
import api from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

const GAME_MODES = [
  { id: 'rps', label: 'Rock Paper Scissors', icon: Hand },
  { id: 'ttt', label: 'Noughts & Crosses', icon: Grid3X3 },
];

const RPS_STYLES = `
  @keyframes rps-fade-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes rps-throw {
    0% { transform: scale(1) translateY(0); }
    30% { transform: scale(1.15) translateY(-8px); }
    60% { transform: scale(1.05) translateY(-4px); }
    100% { transform: scale(1) translateY(0); }
  }
  @keyframes rps-reveal {
    0% { opacity: 0; transform: scale(0.3) rotate(-10deg); }
    60% { transform: scale(1.1) rotate(2deg); }
    100% { opacity: 1; transform: scale(1) rotate(0deg); }
  }
  @keyframes rps-idle {
    0%,100% { transform: scale(1); }
    50% { transform: scale(1.03); }
  }
  @keyframes rps-win-glow {
    0%,100% { box-shadow: 0 0 20px rgba(212,175,55,0.3); }
    50% { box-shadow: 0 0 40px rgba(212,175,55,0.6); }
  }
  @keyframes rps-shake {
    0%,100% { transform: translateX(0); }
    20% { transform: translateX(-6px); }
    40% { transform: translateX(6px); }
    60% { transform: translateX(-4px); }
    80% { transform: translateX(4px); }
  }
  .rps-fade-in { animation: rps-fade-in 0.35s ease-out both; }
  .rps-throw { animation: rps-throw 0.5s ease-out; }
  .rps-reveal { animation: rps-reveal 0.4s ease-out; }
  .rps-idle { animation: rps-idle 2s ease-in-out infinite; }
  .rps-win-glow { animation: rps-win-glow 1s ease-in-out infinite; }
  .rps-shake { animation: rps-shake 0.4s ease-out; }
`;

const CHOICES = [
  { id: 'rock', label: 'Rock', emoji: '✊' },
  { id: 'paper', label: 'Paper', emoji: '✋' },
  { id: 'scissors', label: 'Scissors', emoji: '✌️' },
];

function formatMoney(n) {
  return `$${Math.trunc(Number(n ?? 0)).toLocaleString()}`;
}

function formatNextPlay(iso) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

export default function DailyRewards() {
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [result, setResult] = useState(null);
  const [lastThrow, setLastThrow] = useState(null);
  const [gameMode, setGameMode] = useState('rps');
  const [tttGame, setTttGame] = useState(null);
  const [tttResult, setTttResult] = useState(null);
  const [tttLoading, setTttLoading] = useState(false);

  const fetchInfo = useCallback(async () => {
    try {
      const res = await api.get('/daily-rewards/info');
      setInfo(res.data);
    } catch {
      toast.error('Failed to load daily rewards');
      setInfo(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchTttGame = useCallback(async () => {
    try {
      const res = await api.get('/daily-rewards/ttt');
      if (res.data.has_game) {
        setTttGame({ board: res.data.board, player_side: res.data.player_side, turn: res.data.turn });
        setTttResult(null);
      } else {
        setTttGame(null);
      }
    } catch {
      setTttGame(null);
    }
  }, []);

  useEffect(() => { fetchInfo(); }, [fetchInfo]);
  useEffect(() => {
    if (gameMode === 'ttt') fetchTttGame();
  }, [gameMode, fetchTttGame]);

  const play = async (choice) => {
    if (!info || info.plays_left <= 0 || playing) return;
    setPlaying(true);
    setResult(null);
    setLastThrow({ player: choice });
    try {
      const res = await api.post('/daily-rewards/play', { choice });
      setResult(res.data);
      setInfo(prev => prev ? { ...prev, plays_left: res.data.plays_left, next_play_at: res.data.next_play_at } : null);
      if (res.data.result === 'win') {
        toast.success(`You win! ${formatMoney(res.data.money_won)} + ${res.data.points_won} points`);
        window.dispatchEvent(new CustomEvent('app:refresh-user'));
      } else if (res.data.result === 'lose') {
        toast.info('Computer wins this round.');
      } else {
        toast.info("It's a draw!");
      }
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Play failed');
      setLastThrow(null);
      setResult(null);
    } finally {
      setPlaying(false);
    }
  };

  const tttStart = async () => {
    if (!info || info.plays_left <= 0 || tttLoading) return;
    setTttLoading(true);
    setTttResult(null);
    try {
      const res = await api.post('/daily-rewards/ttt/start');
      setTttGame({ board: res.data.board, player_side: res.data.player_side, turn: res.data.turn });
      setInfo(prev => prev ? { ...prev, plays_left: res.data.plays_left, next_play_at: res.data.next_play_at } : null);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to start game');
    } finally {
      setTttLoading(false);
    }
  };

  const tttMove = async (cell) => {
    if (!tttGame || tttGame.turn !== tttGame.player_side || tttLoading) return;
    if (tttGame.board[cell]) return;
    setTttLoading(true);
    setTttResult(null);
    try {
      const res = await api.post('/daily-rewards/ttt/move', { cell });
      setTttGame(prev => prev ? { ...prev, board: res.data.board, turn: res.data.result === 'ongoing' ? prev.player_side : null } : null);
      if (res.data.result !== 'ongoing') {
        setTttResult(res.data);
        setTttGame(null);
        setInfo(prev => prev ? { ...prev, plays_left: res.data.plays_left, next_play_at: res.data.next_play_at } : null);
        if (res.data.result === 'win') {
          toast.success(`You win! ${formatMoney(res.data.money_won)} + ${res.data.points_won} points`);
          window.dispatchEvent(new CustomEvent('app:refresh-user'));
        } else if (res.data.result === 'lose') {
          toast.info('Computer wins.');
        } else {
          toast.info("It's a draw!");
        }
      } else {
        setTttGame(prev => prev ? { ...prev, board: res.data.board } : null);
      }
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Move failed');
    } finally {
      setTttLoading(false);
    }
  };

  if (loading) {
    return (
      <div className={`space-y-4 ${styles.pageContent}`}>
        <style>{RPS_STYLES}</style>
        <div className="flex flex-col items-center justify-center min-h-[40vh] gap-2">
          <Gift size={28} className="text-primary/50 animate-pulse" />
          <span className="text-primary text-xs font-heading uppercase tracking-wider">Loading...</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${styles.pageContent}`} data-testid="daily-rewards-page">
      <style>{RPS_STYLES}</style>

      <div className="rps-fade-in">
        <p className="text-[10px] text-zinc-500 font-heading italic">Choose a game. Win rewards. 3 plays every 6 hours (shared).</p>
      </div>

      {/* Game selector */}
      <div className={`${styles.panel} rounded-xl overflow-hidden border border-primary/20 rps-fade-in`}>
        <div className="p-2 grid grid-cols-2 gap-2">
          {GAME_MODES.map((m) => {
            const Icon = m.icon;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setGameMode(m.id)}
                className={`flex items-center justify-center gap-2 py-3 px-4 rounded-lg border-2 transition-all font-heading text-xs uppercase tracking-wider ${
                  gameMode === m.id
                    ? 'border-primary bg-primary/20 text-primary'
                    : 'border-zinc-700 bg-zinc-800/50 text-zinc-400 hover:border-zinc-600'
                }`}
              >
                <Icon size={18} />
                {m.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Info card */}
      <div className={`${styles.panel} rounded-xl overflow-hidden border border-primary/20 rps-fade-in`} style={{ animationDelay: '0.05s' }}>
        <div className="px-4 py-3 flex items-center gap-2 bg-primary/10 border-b border-primary/20">
          <Gift size={16} className="text-primary" />
          <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">Daily Rewards</span>
        </div>
        <div className="p-4 grid grid-cols-2 gap-3">
          <div className="flex items-center gap-2">
            <Sparkles size={14} className="text-primary" />
            <span className="text-xs font-heading text-foreground">Plays left</span>
          </div>
          <div className="text-sm font-heading font-bold text-primary tabular-nums">
            {info?.plays_left ?? 0} / {info?.plays_per_window ?? 3}
          </div>
          {info?.next_play_at && info?.plays_left <= 0 && (
            <>
              <div className="flex items-center gap-2 col-span-2">
                <Clock size={14} className="text-amber-400" />
                <span className="text-xs text-zinc-500 font-heading">Next play</span>
              </div>
              <div className="text-xs font-heading text-foreground col-span-2">
                {formatNextPlay(info.next_play_at)}
              </div>
            </>
          )}
          <div className="flex items-center gap-2 col-span-2 mt-1 pt-2 border-t border-zinc-700/40">
            <DollarSign size={14} className="text-emerald-400" />
            <span className="text-[11px] text-zinc-500 font-heading">Win = {formatMoney(info?.win_money ?? 50000)} + {(info?.win_points ?? 2)} points</span>
          </div>
        </div>
      </div>

      {/* RPS: Throw in progress */}
      {gameMode === 'rps' && lastThrow && !result && playing && (
        <div className={`${styles.panel} rounded-xl overflow-hidden border-2 border-primary/20 rps-fade-in`}>
          <div className="p-4 flex items-center justify-center gap-8">
            <div className="flex flex-col items-center gap-1">
              <span className="text-[10px] text-zinc-500 font-heading uppercase">You threw</span>
              <span className="text-5xl rps-throw" role="img" aria-label={lastThrow.player}>
                {CHOICES.find(c => c.id === lastThrow.player)?.emoji ?? '?'}
              </span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <span className="text-[10px] text-zinc-500 font-heading uppercase">Computer</span>
              <span className="text-4xl text-primary/60 animate-pulse">…</span>
            </div>
          </div>
        </div>
      )}

      {/* RPS: Result reveal */}
      {gameMode === 'rps' && result && (
        <div className={`${styles.panel} rounded-xl overflow-hidden border-2 border-primary/30 rps-fade-in rps-reveal`}>
          <div className="p-4 flex flex-col items-center gap-4">
            <div className="flex items-center justify-center gap-6 w-full">
              <div className="flex flex-col items-center gap-1">
                <span className="text-[10px] text-zinc-500 font-heading uppercase">You</span>
                <span className="text-4xl rps-throw" role="img" aria-label={result.your_choice}>
                  {CHOICES.find(c => c.id === result.your_choice)?.emoji ?? '?'}
                </span>
                <span className="text-xs font-heading text-foreground">{CHOICES.find(c => c.id === result.your_choice)?.label ?? result.your_choice}</span>
              </div>
              <span className="text-xl text-zinc-500 font-heading">vs</span>
              <div className="flex flex-col items-center gap-1">
                <span className="text-[10px] text-zinc-500 font-heading uppercase">Computer</span>
                <span className="text-4xl rps-reveal" role="img" aria-label={result.computer_choice}>
                  {CHOICES.find(c => c.id === result.computer_choice)?.emoji ?? '?'}
                </span>
                <span className="text-xs font-heading text-foreground">{CHOICES.find(c => c.id === result.computer_choice)?.label ?? result.computer_choice}</span>
              </div>
            </div>
            <div className={`text-lg font-heading font-bold uppercase tracking-wider ${
              result.result === 'win' ? 'text-emerald-400 rps-win-glow' : result.result === 'lose' ? 'text-red-400 rps-shake' : 'text-zinc-400'
            }`}>
              {result.result === 'win' ? 'You win!' : result.result === 'lose' ? 'You lose' : "Draw"}
            </div>
            {result.result === 'win' && (
              <p className="text-sm font-heading text-primary">
                +{formatMoney(result.money_won)} + {result.points_won} points
              </p>
            )}
            <p className="text-[10px] text-zinc-500 font-heading">{result.plays_left} play{result.plays_left !== 1 ? 's' : ''} left this window</p>
          </div>
        </div>
      )}

      {/* RPS: Choices */}
      {gameMode === 'rps' && (
        <div className={`${styles.panel} rounded-xl overflow-hidden border border-primary/20 rps-fade-in`} style={{ animationDelay: '0.1s' }}>
          <div className="px-4 py-3 border-b border-primary/20">
            <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">Choose your throw</span>
          </div>
          <div className="p-4 grid grid-cols-3 gap-3">
            {CHOICES.map((c) => (
              <button
                key={c.id}
                type="button"
                disabled={playing || (info?.plays_left ?? 0) <= 0}
                onClick={() => play(c.id)}
                className={`
                  flex flex-col items-center justify-center gap-2 py-6 rounded-xl border-2 transition-all
                  ${(info?.plays_left ?? 0) > 0 && !playing
                    ? 'border-primary/40 bg-primary/10 hover:bg-primary/20 hover:border-primary/60 text-primary rps-idle cursor-pointer'
                    : 'border-zinc-700 bg-zinc-800/50 text-zinc-500 cursor-not-allowed opacity-70'
                  }
                `}
              >
                <span className="text-4xl" role="img" aria-label={c.label}>{c.emoji}</span>
                <span className="text-xs font-heading font-bold uppercase">{c.label}</span>
              </button>
            ))}
          </div>
          {(info?.plays_left ?? 0) <= 0 && info?.next_play_at && (
            <p className="px-4 pb-4 text-[10px] text-zinc-500 font-heading text-center">
              Next play available at {formatNextPlay(info.next_play_at)}
            </p>
          )}
        </div>
      )}

      {/* Noughts & Crosses */}
      {gameMode === 'ttt' && (
        <div className={`${styles.panel} rounded-xl overflow-hidden border border-primary/20 rps-fade-in`} style={{ animationDelay: '0.05s' }}>
          <div className="px-4 py-3 border-b border-primary/20">
            <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">Noughts & Crosses</span>
          </div>
          <div className="p-4">
            {!tttGame && !tttResult && (
              <div className="flex flex-col items-center gap-4">
                <p className="text-xs text-zinc-500 font-heading text-center">You play vs computer. Win to earn rewards.</p>
                <button
                  type="button"
                  disabled={(info?.plays_left ?? 0) <= 0 || tttLoading}
                  onClick={tttStart}
                  className={`px-6 py-3 rounded-xl border-2 font-heading text-sm uppercase tracking-wider transition-all ${
                    (info?.plays_left ?? 0) > 0 && !tttLoading
                      ? 'border-primary bg-primary/20 text-primary hover:bg-primary/30 cursor-pointer'
                      : 'border-zinc-700 bg-zinc-800/50 text-zinc-500 cursor-not-allowed'
                  }`}
                >
                  {tttLoading ? 'Starting…' : 'Start game'}
                </button>
                {(info?.plays_left ?? 0) <= 0 && info?.next_play_at && (
                  <p className="text-[10px] text-zinc-500 font-heading">Next play at {formatNextPlay(info.next_play_at)}</p>
                )}
              </div>
            )}
            {tttGame && !tttResult && (
              <div className="flex flex-col items-center gap-3">
                <p className="text-[10px] text-zinc-500 font-heading">
                  You are <span className="text-primary font-bold">{tttGame.player_side}</span>. {tttGame.turn === tttGame.player_side ? 'Your turn' : 'Computer thinking…'}
                </p>
                <div className="grid grid-cols-3 gap-1 w-[min(240px,80vw)] aspect-square">
                  {(tttGame.board || Array(9).fill('')).map((cell, i) => (
                    <button
                      key={i}
                      type="button"
                      disabled={!!cell || tttGame.turn !== tttGame.player_side || tttLoading}
                      onClick={() => tttMove(i)}
                      className="flex items-center justify-center text-2xl font-bold border-2 border-primary/40 bg-primary/5 rounded-lg transition-all hover:bg-primary/15 disabled:opacity-70 disabled:cursor-not-allowed disabled:hover:bg-primary/5"
                    >
                      {cell || '\u00A0'}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {tttResult && (
              <div className="flex flex-col items-center gap-3">
                <p className={`text-lg font-heading font-bold uppercase ${
                  tttResult.result === 'win' ? 'text-emerald-400' : tttResult.result === 'lose' ? 'text-red-400' : 'text-zinc-400'
                }`}>
                  {tttResult.result === 'win' ? 'You win!' : tttResult.result === 'lose' ? 'You lose' : 'Draw'}
                </p>
                {tttResult.result === 'win' && (
                  <p className="text-sm font-heading text-primary">
                    +{formatMoney(tttResult.money_won)} + {tttResult.points_won} points
                  </p>
                )}
                <p className="text-[10px] text-zinc-500 font-heading">{tttResult.plays_left} play{tttResult.plays_left !== 1 ? 's' : ''} left</p>
                {(info?.plays_left ?? 0) > 0 && (
                  <button
                    type="button"
                    onClick={tttStart}
                    disabled={tttLoading}
                    className="px-6 py-2 rounded-xl border-2 border-primary/40 bg-primary/10 text-primary font-heading text-xs uppercase hover:bg-primary/20"
                  >
                    Play again
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
