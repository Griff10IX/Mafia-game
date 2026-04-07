import { useState, useEffect, useCallback } from 'react';
import { Gift, Clock, DollarSign, Sparkles, Hand, Grid3X3, Star } from 'lucide-react';
import api, { getApiErrorMessage } from '../../utils/api';
import { toast } from 'sonner';
import styles from '../../styles/noir.module.css';

const GAME_MODES = [
  { id: 'rps', label: 'Rock Paper Scissors', icon: Hand },
  { id: 'ttt', label: 'Noughts & Crosses', icon: Grid3X3 },
];

const RPS_STYLES = `
  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(16px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes fadeIn {
    from { opacity: 0; } to { opacity: 1; }
  }
  @keyframes scaleIn {
    from { opacity: 0; transform: scale(0.7) rotate(-6deg); }
    60%  { transform: scale(1.08) rotate(1deg); }
    to   { opacity: 1; transform: scale(1) rotate(0deg); }
  }
  @keyframes floatBob {
    0%,100% { transform: translateY(0) scale(1); }
    50%      { transform: translateY(-6px) scale(1.04); }
  }
  @keyframes throwBounce {
    0%   { transform: scale(1) translateY(0); }
    25%  { transform: scale(1.2) translateY(-12px); }
    55%  { transform: scale(1.06) translateY(-5px); }
    75%  { transform: scale(1.02) translateY(-2px); }
    100% { transform: scale(1) translateY(0); }
  }
  @keyframes winPulse {
    0%,100% { filter: drop-shadow(0 0 6px rgba(var(--noir-primary-rgb),0.4)); transform: scale(1); }
    50%     { filter: drop-shadow(0 0 18px rgba(var(--noir-primary-rgb),0.85)); transform: scale(1.06); }
  }
  @keyframes losePulse {
    0%,100% { filter: drop-shadow(0 0 6px rgba(239,68,68,0.3)); }
    50%     { filter: drop-shadow(0 0 16px rgba(239,68,68,0.6)); }
  }
  @keyframes shake {
    0%,100% { transform: translateX(0); }
    15%     { transform: translateX(-8px) rotate(-1deg); }
    35%     { transform: translateX(8px) rotate(1deg); }
    55%     { transform: translateX(-5px) rotate(-0.5deg); }
    75%     { transform: translateX(5px) rotate(0.5deg); }
  }
  @keyframes resultSlide {
    from { opacity: 0; transform: translateY(20px) scale(0.95); }
    to   { opacity: 1; transform: translateY(0) scale(1); }
  }
  @keyframes goldGlow {
    0%,100% { box-shadow: 0 0 0px transparent; }
    50%     { box-shadow: 0 0 20px rgba(var(--noir-primary-rgb),0.25), 0 0 40px rgba(var(--noir-primary-rgb),0.1); }
  }
  @keyframes spinnerRotate {
    to { transform: rotate(360deg); }
  }
  @keyframes dotPulse {
    0%,80%,100% { transform: scale(0.6); opacity: 0.4; }
    40%          { transform: scale(1); opacity: 1; }
  }
  @keyframes vsFloat {
    0%,100% { transform: translateY(0) rotate(-2deg); }
    50%      { transform: translateY(-4px) rotate(2deg); }
  }
  @keyframes cellPop {
    0%   { transform: scale(0.4); opacity: 0; }
    60%  { transform: scale(1.15); opacity: 1; }
    100% { transform: scale(1); opacity: 1; }
  }
  @keyframes winnerGlow {
    0%,100% { background: rgba(var(--noir-primary-rgb),0.08); }
    50%     { background: rgba(var(--noir-primary-rgb),0.18); }
  }
  @keyframes shimmer {
    0%   { background-position: -200% center; }
    100% { background-position: 200% center; }
  }
  @keyframes coinSpin {
    0%   { transform: rotateY(0deg); }
    100% { transform: rotateY(360deg); }
  }
  @keyframes starBurst {
    0%   { transform: scale(0) rotate(0deg); opacity: 1; }
    100% { transform: scale(2.5) rotate(180deg); opacity: 0; }
  }

  .anim-fadeUp   { animation: fadeUp 0.4s cubic-bezier(0.22,1,0.36,1) both; }
  .anim-scaleIn  { animation: scaleIn 0.45s cubic-bezier(0.22,1,0.36,1) both; }
  .anim-float    { animation: floatBob 2.4s ease-in-out infinite; }
  .anim-throw    { animation: throwBounce 0.55s cubic-bezier(0.22,1,0.36,1) both; }
  .anim-win      { animation: winPulse 1.2s ease-in-out infinite; }
  .anim-lose     { animation: losePulse 1.2s ease-in-out infinite; }
  .anim-shake    { animation: shake 0.45s ease-out; }
  .anim-result   { animation: resultSlide 0.4s cubic-bezier(0.22,1,0.36,1) both; }
  .anim-goldGlow { animation: goldGlow 2s ease-in-out infinite; }
  .anim-vsFloat  { animation: vsFloat 2s ease-in-out infinite; }
  .anim-cellPop  { animation: cellPop 0.3s cubic-bezier(0.22,1,0.36,1) both; }

  .shimmer-text {
    background: linear-gradient(
      90deg,
      rgba(var(--noir-primary-rgb),0.65) 0%,
      rgba(var(--noir-primary-rgb),1) 40%,
      rgba(var(--noir-primary-rgb),0.85) 55%,
      rgba(var(--noir-primary-rgb),1) 70%,
      rgba(var(--noir-primary-rgb),0.65) 100%
    );
    background-size: 200% auto;
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    animation: shimmer 2.5s linear infinite;
  }
  .thinking-dot {
    display: inline-block;
    width: 6px; height: 6px;
    border-radius: 50%;
    background: rgba(var(--noir-primary-rgb),1);
    animation: dotPulse 1.2s ease-in-out infinite;
  }
  .thinking-dot:nth-child(2) { animation-delay: 0.2s; }
  .thinking-dot:nth-child(3) { animation-delay: 0.4s; }

  .rps-btn-idle:not(:disabled) { animation: floatBob 2.4s ease-in-out infinite; }
  .rps-btn-idle:not(:disabled):hover { animation: none; transform: scale(1.06) translateY(-2px); }
  .rps-btn-idle:nth-child(2):not(:disabled) { animation-delay: 0.3s; }
  .rps-btn-idle:nth-child(3):not(:disabled) { animation-delay: 0.6s; }

  .ttt-cell-filled { animation: cellPop 0.3s cubic-bezier(0.22,1,0.36,1) both; }
  .winner-row { animation: winnerGlow 0.8s ease-in-out infinite; border-radius: 8px; }

  .star-burst { animation: starBurst 0.6s ease-out forwards; }
`;

const CHOICES = [
  { id: 'rock',     label: 'Rock',     emoji: '✊' },
  { id: 'paper',    label: 'Paper',    emoji: '✋' },
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
  } catch { return iso; }
}

function PlaysBar({ left, total }) {
  const pct = total > 0 ? (left / total) * 100 : 0;
  return (
    <div className="w-full h-1.5 bg-zinc-700/60 rounded-full overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-700 ease-out"
        style={{
          width: `${pct}%`,
          background: pct > 0
            ? 'linear-gradient(90deg, rgba(var(--noir-primary-rgb),0.7), rgba(var(--noir-primary-rgb),1), rgba(var(--noir-primary-rgb),0.6))'
            : 'transparent',
          boxShadow: pct > 0 ? '0 0 8px rgba(var(--noir-primary-rgb),0.5)' : 'none',
        }}
      />
    </div>
  );
}

function ThinkingDots() {
  return (
    <span className="flex items-center gap-1">
      <span className="thinking-dot" />
      <span className="thinking-dot" />
      <span className="thinking-dot" />
    </span>
  );
}

export default function DailyRewards() {
  const [info,       setInfo]       = useState(null);
  const [playing,    setPlaying]    = useState(false);
  const [result,     setResult]     = useState(null);
  const [lastThrow,  setLastThrow]  = useState(null);
  const [gameMode,   setGameMode]   = useState('rps');
  const [tttGame,    setTttGame]    = useState(null);
  const [tttResult,  setTttResult]  = useState(null);
  const [tttLoading, setTttLoading] = useState(false);
  const [resultKey,  setResultKey]  = useState(0); // force re-animation

  const fetchInfo = useCallback(async () => {
    try {
      const res = await api.get('/daily-rewards/info');
      setInfo(res.data ?? null);
    } catch (e) {
      toast.error(getApiErrorMessage(e) || 'Failed to load daily rewards');
      setInfo(null);
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
      setTttResult(null);
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
      setResultKey(k => k + 1);
      setInfo(prev => prev
        ? { ...prev, plays_left: res.data.plays_left, next_play_at: res.data.next_play_at }
        : null
      );
      if (res.data.result === 'win') {
        const parts = [`You win! ${formatMoney(res.data.money_won)}`];
        if (res.data.cars_won?.length) parts.push(res.data.cars_won.join(', '));
        toast.success(parts.join(' — '));
        window.dispatchEvent(new CustomEvent('app:refresh-user'));
      } else if (res.data.result === 'lose') {
        toast.info('Computer wins this round.');
      } else {
        toast.info("It's a draw!");
      }
    } catch (e) {
      toast.error(getApiErrorMessage(e) || 'Play failed');
      setLastThrow(null);
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
      setInfo(prev => prev
        ? { ...prev, plays_left: res.data.plays_left, next_play_at: res.data.next_play_at }
        : null
      );
    } catch (e) {
      toast.error(getApiErrorMessage(e) || 'Failed to start game');
    } finally {
      setTttLoading(false);
    }
  };

  const tttMove = async (cell) => {
    if (!tttGame || tttGame.turn !== tttGame.player_side || tttLoading) return;
    if (tttGame.board[cell]) return;
    setTttLoading(true);
    try {
      const res = await api.post('/daily-rewards/ttt/move', { cell });
      if (res.data.result !== 'ongoing') {
        setTttResult(res.data);
        setTttGame(null);
        setInfo(prev => prev
          ? { ...prev, plays_left: res.data.plays_left, next_play_at: res.data.next_play_at }
          : null
        );
        if (res.data.result === 'win') {
          const parts = [`You win! ${formatMoney(res.data.money_won)}`];
          if (res.data.cars_won?.length) parts.push(res.data.cars_won.join(', '));
          toast.success(parts.join(' — '));
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
      toast.error(getApiErrorMessage(e) || 'Move failed');
    } finally {
      setTttLoading(false);
    }
  };

  if (!info) {
    return (
      <div className={`space-y-4 ${styles.pageContent} mobile-page-root`}>
        <style>{RPS_STYLES}</style>
      </div>
    );
  }

  const playsLeft  = info?.plays_left ?? 0;
  const playsTotal = info?.plays_per_window ?? 3;
  const canPlay    = playsLeft > 0;

  /* ── Main render ─────────────────────────────────────────── */
  return (
    <div className={`space-y-4 ${styles.pageContent} mobile-page-root`} data-testid="daily-rewards-page">
      <style>{RPS_STYLES}</style>

      {/* Header tagline */}
      <div className="anim-fadeUp" style={{ animationDelay: '0s' }}>
        <p className="text-[10px] text-zinc-500 font-heading italic">
          Choose a game. Win rewards. {playsTotal} plays every 6 hours (shared).
        </p>
      </div>

      {/* Info card */}
      <div
        className={`${styles.panel} rounded-xl overflow-hidden border border-primary/20 anim-fadeUp mobile-panel ${canPlay ? 'anim-goldGlow' : ''}`}
        style={{ animationDelay: '0.04s' }}
      >
        <div className="px-4 py-3 flex items-center gap-2 bg-primary/10 border-b border-primary/20">
          <Gift size={15} className="text-primary" />
          <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">Daily Rewards</span>
          {canPlay && <Star size={11} className="text-primary ml-auto anim-float" fill="currentColor" />}
        </div>
        <div className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles size={13} className="text-primary" />
              <span className="text-xs font-heading text-foreground">Plays remaining</span>
            </div>
            <span className={`text-sm font-heading font-bold tabular-nums ${canPlay ? 'shimmer-text' : 'text-zinc-500'}`}>
              {playsLeft} / {playsTotal}
            </span>
          </div>
          <PlaysBar left={playsLeft} total={playsTotal} />
          {!canPlay && info?.next_play_at && (
            <div className="flex items-center gap-2 pt-1">
              <Clock size={13} className="text-amber-400" />
              <span className="text-[10px] text-zinc-400 font-heading">
                Refreshes at <span className="text-amber-300">{formatNextPlay(info.next_play_at)}</span>
              </span>
            </div>
          )}
          <div className="flex items-center gap-2 pt-2 border-t border-zinc-700/40">
            <DollarSign size={13} className="text-emerald-400" />
            <span className="text-[11px] text-zinc-500 font-heading">
              Win = <span className="text-emerald-400">{formatMoney(info?.win_money ?? 50000)}</span> cash, maybe a car or two (max rare)
            </span>
          </div>
        </div>
      </div>

      {/* Mode selector */}
      <div
        className={`${styles.panel} rounded-xl overflow-hidden border border-primary/20 anim-fadeUp mobile-panel`}
        style={{ animationDelay: '0.08s' }}
      >
        <div className="p-2 grid grid-cols-2 gap-2">
          {GAME_MODES.map((m) => {
            const Icon = m.icon;
            const active = gameMode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => { setGameMode(m.id); setResult(null); setLastThrow(null); }}
                className="flex items-center justify-center gap-2 py-3 px-4 rounded-lg font-heading text-xs uppercase tracking-wider transition-all duration-200 active:scale-95"
                style={{
                  border: `2px solid ${active ? 'rgba(var(--noir-primary-rgb),1)' : 'rgba(63,63,70,1)'}`,
                  background: active ? 'rgba(var(--noir-primary-rgb),0.12)' : 'rgba(39,39,42,0.5)',
                  color: active ? 'rgba(var(--noir-primary-rgb),1)' : '#71717a',
                  boxShadow: active ? '0 0 12px rgba(var(--noir-primary-rgb),0.15)' : 'none',
                }}
              >
                <Icon size={16} />
                {m.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── RPS ──────────────────────────────────────────────── */}
      {gameMode === 'rps' && (
        <>
          {/* In-flight state */}
          {lastThrow && !result && playing && (
            <div className={`${styles.panel} rounded-xl overflow-hidden border-2 border-primary/30 anim-fadeUp`}>
              <div className="p-5 flex items-center justify-center gap-10">
                <div className="flex flex-col items-center gap-2">
                  <span className="text-[9px] text-zinc-500 font-heading uppercase tracking-wider">You threw</span>
                  <span className="text-5xl anim-throw">
                    {CHOICES.find(c => c.id === lastThrow.player)?.emoji}
                  </span>
                  <span className="text-[10px] text-zinc-400 font-heading">
                    {CHOICES.find(c => c.id === lastThrow.player)?.label}
                  </span>
                </div>
                <div className="flex flex-col items-center gap-2">
                  <span className="text-[9px] text-zinc-500 font-heading uppercase tracking-wider">Computer</span>
                  <ThinkingDots />
                </div>
              </div>
            </div>
          )}

          {/* Result reveal */}
          {result && (
            <div
              key={resultKey}
              className={`${styles.panel} rounded-xl overflow-hidden anim-result`}
              style={{
                border: `2px solid ${result.result === 'win' ? 'rgba(234,179,8,0.5)' : result.result === 'lose' ? 'rgba(239,68,68,0.4)' : 'rgba(63,63,70,0.8)'}`,
                boxShadow: result.result === 'win' ? '0 0 30px rgba(234,179,8,0.15)' : 'none',
              }}
            >
              <div className="p-5 flex flex-col items-center gap-4">
                {/* Emoji face-off */}
                <div className="flex items-center justify-center gap-4 w-full">
                  <div className="flex flex-col items-center gap-1.5">
                    <span className="text-[9px] text-zinc-500 font-heading uppercase tracking-wider">You</span>
                    <span
                      className={`text-5xl ${
                        result.result === 'win'  ? 'anim-win' :
                        result.result === 'lose' ? 'anim-lose' : ''
                      }`}
                    >
                      {CHOICES.find(c => c.id === result.your_choice)?.emoji}
                    </span>
                    <span className="text-[10px] text-zinc-400 font-heading">
                      {CHOICES.find(c => c.id === result.your_choice)?.label}
                    </span>
                  </div>

                  <div
                    className="text-base font-heading font-bold text-zinc-500 px-2 anim-vsFloat"
                    style={{ letterSpacing: '0.05em' }}
                  >
                    VS
                  </div>

                  <div className="flex flex-col items-center gap-1.5">
                    <span className="text-[9px] text-zinc-500 font-heading uppercase tracking-wider">Computer</span>
                    <span className="text-5xl anim-scaleIn">
                      {CHOICES.find(c => c.id === result.computer_choice)?.emoji}
                    </span>
                    <span className="text-[10px] text-zinc-400 font-heading">
                      {CHOICES.find(c => c.id === result.computer_choice)?.label}
                    </span>
                  </div>
                </div>

                {/* Outcome banner */}
                <div
                  className={`px-6 py-2 rounded-full font-heading font-bold text-sm uppercase tracking-widest ${
                    result.result === 'win'  ? 'anim-shake' :
                    result.result === 'lose' ? 'anim-shake' : ''
                  }`}
                  style={{
                    background: result.result === 'win'
                      ? 'linear-gradient(90deg,rgba(234,179,8,0.2),rgba(254,240,138,0.15))'
                      : result.result === 'lose'
                      ? 'rgba(239,68,68,0.12)'
                      : 'rgba(63,63,70,0.4)',
                    border: `1px solid ${
                      result.result === 'win'  ? 'rgba(234,179,8,0.5)'  :
                      result.result === 'lose' ? 'rgba(239,68,68,0.4)' :
                      'rgba(63,63,70,0.6)'}`,
                    color: result.result === 'win' ? 'rgba(var(--noir-primary-rgb),1)' : result.result === 'lose' ? '#f87171' : '#71717a',
                  }}
                >
                  {result.result === 'win' ? '🏆 You win!' : result.result === 'lose' ? '💀 You lose' : '🤝 Draw'}
                </div>

                {result.result === 'win' && (
                  <p className="text-xs font-heading text-primary">
                    <span className="shimmer-text font-bold text-sm">+{formatMoney(result.money_won)}</span>
                    {result.cars_won?.length ? (
                      <span className="text-zinc-400 mx-1">—</span>
                    ) : null}
                    {result.cars_won?.length ? (
                      <span className="text-primary font-bold">{result.cars_won.join(', ')}</span>
                    ) : null}
                  </p>
                )}
                <p className="text-[10px] text-zinc-600 font-heading">
                  {result.plays_left} play{result.plays_left !== 1 ? 's' : ''} left this window
                </p>
              </div>
            </div>
          )}

          {/* Choice buttons */}
          <div
            className={`${styles.panel} rounded-xl overflow-hidden border border-primary/20 anim-fadeUp mobile-panel`}
            style={{ animationDelay: '0.12s' }}
          >
            <div className="px-4 py-3 border-b border-primary/20 flex items-center justify-between">
              <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">Choose your throw</span>
              {!canPlay && <span className="text-[9px] text-red-400 font-heading uppercase">Out of plays</span>}
            </div>
            <div className="p-4 grid grid-cols-3 gap-3">
              {CHOICES.map((c, i) => (
                <button
                  key={c.id}
                  type="button"
                  disabled={playing || !canPlay}
                  onClick={() => play(c.id)}
                  className="rps-btn-idle flex flex-col items-center justify-center gap-2 py-5 rounded-xl transition-all duration-200 active:scale-90 focus:outline-none"
                  style={{
                    animationDelay: `${i * 0.3}s`,
                    border: canPlay && !playing
                      ? '2px solid rgba(234,179,8,0.4)'
                      : '2px solid rgba(63,63,70,0.6)',
                    background: canPlay && !playing
                      ? 'rgba(234,179,8,0.07)'
                      : 'rgba(39,39,42,0.4)',
                    opacity: playing ? 0.6 : canPlay ? 1 : 0.5,
                    cursor: canPlay && !playing ? 'pointer' : 'not-allowed',
                    boxShadow: canPlay && !playing
                      ? '0 0 0px rgba(234,179,8,0)'
                      : 'none',
                    transition: 'all 0.2s ease',
                  }}
                  onMouseEnter={e => {
                    if (canPlay && !playing) {
                      e.currentTarget.style.boxShadow = '0 0 16px rgba(234,179,8,0.2)';
                      e.currentTarget.style.borderColor = 'rgba(234,179,8,0.7)';
                      e.currentTarget.style.background = 'rgba(234,179,8,0.14)';
                    }
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.boxShadow = '0 0 0px rgba(234,179,8,0)';
                    e.currentTarget.style.borderColor = canPlay ? 'rgba(234,179,8,0.4)' : 'rgba(63,63,70,0.6)';
                    e.currentTarget.style.background = canPlay ? 'rgba(234,179,8,0.07)' : 'rgba(39,39,42,0.4)';
                  }}
                >
                  <span className="text-4xl select-none">{c.emoji}</span>
                  <span
                    className="text-[10px] font-heading font-bold uppercase tracking-wider"
                style={{ color: canPlay && !playing ? 'rgba(var(--noir-primary-rgb),1)' : '#52525b' }}
                  >
                    {c.label}
                  </span>
                </button>
              ))}
            </div>
            {!canPlay && info?.next_play_at && (
              <p className="px-4 pb-4 text-[10px] text-zinc-600 font-heading text-center">
                Next play available at {formatNextPlay(info.next_play_at)}
              </p>
            )}
          </div>
        </>
      )}

      {/* ── Noughts & Crosses ────────────────────────────────── */}
      {gameMode === 'ttt' && (
        <div
          className={`${styles.panel} rounded-xl overflow-hidden border border-primary/20 anim-fadeUp mobile-panel`}
          style={{ animationDelay: '0.08s' }}
        >
          <div className="px-4 py-3 border-b border-primary/20 flex items-center justify-between">
            <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">Noughts &amp; Crosses</span>
            {tttGame && (
              <span className="text-[9px] font-heading uppercase tracking-wider"
                style={{ color: tttGame.turn === tttGame.player_side ? '#4ade80' : 'rgba(var(--noir-primary-rgb),1)' }}
              >
                {tttGame.turn === tttGame.player_side ? '● Your turn' : '● AI thinking…'}
              </span>
            )}
          </div>
          <div className="p-4">

            {/* Pre-game */}
            {!tttGame && !tttResult && (
              <div className="flex flex-col items-center gap-4">
                <div className="flex flex-col items-center gap-1">
                  <span className="text-4xl anim-float">🎯</span>
                  <p className="text-xs text-zinc-500 font-heading text-center mt-1">
                    Challenge the AI. Win to earn rewards.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={!canPlay || tttLoading}
                  onClick={tttStart}
                  className="px-8 py-3 rounded-xl font-heading text-sm uppercase tracking-wider transition-all duration-200 active:scale-95"
                  style={{
                    border: canPlay && !tttLoading ? '2px solid rgba(var(--noir-primary-rgb),1)' : '2px solid rgba(63,63,70,0.6)',
                    background: canPlay && !tttLoading ? 'rgba(var(--noir-primary-rgb),0.12)' : 'rgba(39,39,42,0.4)',
                    color: canPlay && !tttLoading ? 'rgba(var(--noir-primary-rgb),1)' : '#52525b',
                    boxShadow: canPlay && !tttLoading ? '0 0 16px rgba(var(--noir-primary-rgb),0.15)' : 'none',
                    cursor: canPlay && !tttLoading ? 'pointer' : 'not-allowed',
                  }}
                >
                  {tttLoading ? <ThinkingDots /> : 'Start game'}
                </button>
                {!canPlay && info?.next_play_at && (
                  <p className="text-[10px] text-zinc-600 font-heading">
                    Next play at <span className="text-amber-400">{formatNextPlay(info.next_play_at)}</span>
                  </p>
                )}
              </div>
            )}

            {/* Active game */}
            {tttGame && !tttResult && (
              <div className="flex flex-col items-center gap-4">
                <p className="text-[10px] text-zinc-500 font-heading">
                  You are <span className="text-primary font-bold text-xs">{tttGame.player_side}</span>
                </p>

                {/* Board */}
                <div
                  className="grid grid-cols-3"
                  style={{
                    width: 'min(228px, 82vw)',
                    gap: '6px',
                  }}
                >
                  {(tttGame.board || Array(9).fill('')).map((cell, i) => {
                    const isPlayerCell = cell === tttGame.player_side;
                    const isX = cell === 'X';
                    const isEmpty = !cell;
                    const isMyTurn = tttGame.turn === tttGame.player_side && !tttLoading;
                    return (
                      <button
                        key={i}
                        type="button"
                        disabled={!!cell || !isMyTurn}
                        onClick={() => tttMove(i)}
                        className={`flex items-center justify-center rounded-lg font-bold transition-all duration-150 active:scale-90 focus:outline-none ${cell ? 'ttt-cell-filled' : ''}`}
                        style={{
                          aspectRatio: '1',
                          fontSize: '1.75rem',
                          border: cell
                            ? `2px solid ${isX ? 'rgba(var(--noir-primary-rgb),0.6)' : 'rgba(167,139,250,0.5)'}`
                            : isEmpty && isMyTurn
                            ? '2px solid rgba(var(--noir-primary-rgb),0.25)'
                            : '2px solid rgba(63,63,70,0.4)',
                          background: cell
                            ? isX ? 'rgba(var(--noir-primary-rgb),0.1)' : 'rgba(167,139,250,0.08)'
                            : isEmpty && isMyTurn
                            ? 'rgba(var(--noir-primary-rgb),0.04)'
                            : 'rgba(24,24,27,0.4)',
                          color: isX ? 'rgba(var(--noir-primary-rgb),1)' : '#a78bfa',
                          cursor: isEmpty && isMyTurn ? 'pointer' : 'not-allowed',
                          boxShadow: cell
                            ? isX ? '0 0 8px rgba(var(--noir-primary-rgb),0.15)' : '0 0 8px rgba(167,139,250,0.12)'
                            : 'none',
                        }}
                        onMouseEnter={e => {
                          if (isEmpty && isMyTurn) {
                            e.currentTarget.style.borderColor = 'rgba(var(--noir-primary-rgb),0.5)';
                            e.currentTarget.style.background = 'rgba(var(--noir-primary-rgb),0.08)';
                          }
                        }}
                        onMouseLeave={e => {
                          if (isEmpty) {
                            e.currentTarget.style.borderColor = isMyTurn ? 'rgba(var(--noir-primary-rgb),0.25)' : 'rgba(63,63,70,0.4)';
                            e.currentTarget.style.background = isMyTurn ? 'rgba(var(--noir-primary-rgb),0.04)' : 'rgba(24,24,27,0.4)';
                          }
                        }}
                      >
                        {cell || (isEmpty && isMyTurn ? (
                          <span style={{ opacity: 0.15, color: 'rgba(var(--noir-primary-rgb),1)', fontSize: '1.2rem' }}>+</span>
                        ) : '')}
                      </button>
                    );
                  })}
                </div>

                {/* Thinking indicator */}
                {tttLoading && (
                  <div className="flex items-center gap-2">
                    <ThinkingDots />
                    <span className="text-[10px] text-zinc-500 font-heading">AI is thinking…</span>
                  </div>
                )}
              </div>
            )}

            {/* Result */}
            {tttResult && (
              <div className="flex flex-col items-center gap-3 anim-result">
                <div
                  className="px-6 py-2.5 rounded-full font-heading font-bold text-sm uppercase tracking-widest"
                  style={{
                    background: tttResult.result === 'win'
                      ? 'linear-gradient(90deg,rgba(var(--noir-primary-rgb),0.18),rgba(var(--noir-primary-rgb),0.12))'
                      : tttResult.result === 'lose'
                      ? 'rgba(239,68,68,0.1)'
                      : 'rgba(63,63,70,0.4)',
                    border: `1px solid ${
                      tttResult.result === 'win'  ? 'rgba(var(--noir-primary-rgb),0.5)'  :
                      tttResult.result === 'lose' ? 'rgba(239,68,68,0.4)' :
                      'rgba(63,63,70,0.5)'}`,
                    color: tttResult.result === 'win' ? 'rgba(var(--noir-primary-rgb),1)' : tttResult.result === 'lose' ? '#f87171' : '#71717a',
                  }}
                >
                  {tttResult.result === 'win' ? '🏆 You win!' : tttResult.result === 'lose' ? '💀 You lose' : '🤝 Draw'}
                </div>
                {tttResult.result === 'win' && (
                  <p className="text-xs font-heading text-center">
                    <span className="shimmer-text font-bold text-sm">+{formatMoney(tttResult.money_won)}</span>
                    {tttResult.cars_won?.length ? (
                      <span className="text-zinc-400 mx-1">—</span>
                    ) : null}
                    {tttResult.cars_won?.length ? (
                      <span className="text-primary font-bold">{tttResult.cars_won.join(', ')}</span>
                    ) : null}
                  </p>
                )}
                <p className="text-[10px] text-zinc-600 font-heading">
                  {tttResult.plays_left} play{tttResult.plays_left !== 1 ? 's' : ''} left
                </p>
                {(info?.plays_left ?? 0) > 0 && (
                  <button
                    type="button"
                    onClick={tttStart}
                    disabled={tttLoading}
                    className="px-6 py-2 rounded-xl font-heading text-xs uppercase tracking-wider transition-all duration-200 active:scale-95"
                    style={{
                      border: '2px solid rgba(var(--noir-primary-rgb),0.4)',
                      background: 'rgba(var(--noir-primary-rgb),0.08)',
                      color: 'rgba(var(--noir-primary-rgb),1)',
                    }}
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
