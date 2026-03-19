import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Gift, ChevronRight } from 'lucide-react';
import api, { getApiErrorMessage } from '../../utils/api';
import { toast } from 'sonner';
import styles from '../../styles/noir.module.css';

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
    const now = new Date();
    const sec = Math.max(0, Math.floor((d - now) / 1000));
    if (sec < 60) return `${sec}s`;
    if (sec < 3600) return `${Math.floor(sec / 60)}m`;
    return `${Math.floor(sec / 3600)}h`;
  } catch { return null; }
}

export default function DailyRewardsWidget({ onRefresh }) {
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [result, setResult] = useState(null);

  const fetchInfo = useCallback(async () => {
    try {
      const res = await api.get('/daily-rewards/info');
      setInfo(res.data ?? null);
    } catch {
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
    try {
      const res = await api.post('/daily-rewards/play', { choice });
      setResult(res.data);
      setInfo(prev => prev
        ? { ...prev, plays_left: res.data.plays_left, next_play_at: res.data.next_play_at }
        : null
      );
      if (res.data.result === 'win') {
        const parts = [`You win! ${formatMoney(res.data.money_won)}`];
        if (res.data.cars_won?.length) parts.push(res.data.cars_won.join(', '));
        toast.success(parts.join(' — '));
        onRefresh?.();
        window.dispatchEvent(new CustomEvent('app:refresh-user'));
      } else if (res.data.result === 'lose') {
        toast.info('Computer wins this round.');
      } else {
        toast.info("It's a draw!");
      }
    } catch (e) {
      toast.error(getApiErrorMessage(e) || 'Play failed');
    } finally {
      setPlaying(false);
    }
  };

  if (loading) {
    return (
      <div className={`${styles.panel} rounded-md border border-primary/20 p-2.5 mobile-panel`}>
        <div className="flex items-center gap-2 text-mutedForeground">
          <Gift size={14} className="animate-pulse" />
          <span className="text-[10px] font-heading">Loading...</span>
        </div>
      </div>
    );
  }

  const playsLeft = info?.plays_left ?? 0;
  const nextAt = formatNextPlay(info?.next_play_at);

  return (
    <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20 mobile-panel`}>
      <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between">
        <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.12em] flex items-center gap-1">
          <Gift size={10} />
          Daily Rewards
        </h2>
        <Link to="/game/daily-rewards" className="text-[9px] font-heading text-primary hover:text-primary/80 flex items-center gap-0.5">
          Full <ChevronRight size={10} />
        </Link>
      </div>
      <div className="p-2.5 space-y-2">
        {playsLeft > 0 ? (
          <>
            <p className="text-[10px] font-heading text-mutedForeground">
              {playsLeft}/{info?.plays_per_window ?? 3} plays left
            </p>
            <div className="flex gap-1.5 justify-center">
              {CHOICES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => play(c.id)}
                  disabled={playing}
                  className="flex-1 min-w-0 flex flex-col items-center gap-0.5 px-2 py-1.5 rounded border border-primary/30 bg-primary/10 hover:bg-primary/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95"
                >
                  <span className="text-lg">{c.emoji}</span>
                  <span className="text-[9px] font-heading text-foreground truncate w-full text-center">{c.label}</span>
                </button>
              ))}
            </div>
            {result && (
              <p className="text-[10px] font-heading text-center text-mutedForeground">
                You: {result.your_choice} vs Computer: {result.computer_choice} — {result.result}
              </p>
            )}
          </>
        ) : (
          <p className="text-[10px] font-heading text-mutedForeground text-center">
            {nextAt ? `Next play in ${nextAt}` : 'No plays left'}
          </p>
        )}
      </div>
    </div>
  );
}
