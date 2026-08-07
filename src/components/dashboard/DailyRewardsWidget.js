import { useState, useEffect, useCallback } from 'react';
import { Gift } from 'lucide-react';
import api, { getApiErrorMessage } from '../../utils/api';
import { getDashboardWidget, setDashboardWidget } from '../../utils/dashboardWidgetCache';
import { toast } from 'sonner';
import dash from '../../styles/dashboard.module.css';
import { DashPanel, DashHeader, DashBody, DashLoading } from './dashChrome';

const CHOICES = [
  { id: 'rock', label: 'Rock', emoji: '✊' },
  { id: 'paper', label: 'Paper', emoji: '✋' },
  { id: 'scissors', label: 'Scissors', emoji: '✌️' },
];

function formatMoney(n) {
  return `$${Math.trunc(Number(n ?? 0)).toLocaleString()}`;
}

function formatWinRewards(data) {
  const parts = [`You win! ${formatMoney(data.money_won)}`];
  if (data.cars_won?.length) parts.push(data.cars_won.join(', '));
  if (Number(data.loot_box_pieces) > 0) {
    parts.push(`${Number(data.loot_box_pieces).toLocaleString()} loot pieces`);
  }
  return parts.join(' — ');
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

const WIDGET_KEY = 'daily_rewards';

export default function DailyRewardsWidget({ onRefresh, userId }) {
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [result, setResult] = useState(null);

  const fetchInfo = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await api.get('/daily-rewards/info');
      const d = res.data ?? null;
      setInfo(d);
      if (d) setDashboardWidget(userId, WIDGET_KEY, d);
    } catch {
      // keep cached snapshot on failure
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      setInfo(null);
      setLoading(true);
      return;
    }
    const cached = getDashboardWidget(userId, WIDGET_KEY);
    if (cached) {
      setInfo(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }
    fetchInfo();
  }, [userId, fetchInfo]);

  const play = async (choice) => {
    if (!info || info.plays_left <= 0 || playing) return;
    setPlaying(true);
    setResult(null);
    try {
      const res = await api.post('/daily-rewards/play', { choice });
      setResult(res.data);
      setInfo((prev) => {
        const next = prev
          ? { ...prev, plays_left: res.data.plays_left, next_play_at: res.data.next_play_at }
          : null;
        if (next && userId) setDashboardWidget(userId, WIDGET_KEY, next);
        return next;
      });
      if (res.data.result === 'win') {
        toast.success(formatWinRewards(res.data));
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
    return <DashLoading icon={Gift} />;
  }

  const playsLeft = info?.plays_left ?? 0;
  const nextAt = formatNextPlay(info?.next_play_at);

  return (
    <DashPanel>
      <DashHeader title="Daily Rewards" icon={Gift} actionTo="/game/daily-rewards" actionLabel="Full" />
      <DashBody className="space-y-2">
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
                  className={`${dash.choiceBtn} font-heading`}
                >
                  <span className="text-lg">{c.emoji}</span>
                  <span className="text-[9px] text-foreground truncate w-full text-center">{c.label}</span>
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
      </DashBody>
    </DashPanel>
  );
}
