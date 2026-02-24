import { useState, useEffect, useCallback } from 'react';
import { Gift, Clock, DollarSign, Sparkles } from 'lucide-react';
import api from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

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

  useEffect(() => { fetchInfo(); }, [fetchInfo]);

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
        <p className="text-[10px] text-zinc-500 font-heading italic">Play Rock Paper Scissors. Win rewards. 3 plays every 6 hours.</p>
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

      {/* Throw in progress: show your choice + "..." for computer */}
      {lastThrow && !result && playing && (
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

      {/* Result reveal (after play) */}
      {result && (
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

      {/* Choices */}
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
    </div>
  );
}
