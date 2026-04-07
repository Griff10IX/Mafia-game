import { useState, useEffect, useCallback } from 'react';
import { ListChecks, Calendar, CalendarDays, CalendarRange, CheckCircle2, Circle, Gift, BarChart3, ChevronDown, ChevronUp, AlertTriangle, ThumbsUp, ThumbsDown, Trophy } from 'lucide-react';
import api, { refreshUser } from '../../utils/api';
import { readSessionJson, writeSessionJson } from '../../utils/sessionPageCache';
import AutoRefreshNote from '../../components/AutoRefreshNote';
import { toast } from 'sonner';
import styles from '../../styles/noir.module.css';

const OBJ_CACHE_KEY = 'mafia_objectives_v1';

const OBJ_STYLES = `
  @keyframes obj-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .obj-fade-in { animation: obj-fade-in 0.4s ease-out both; }
  @keyframes obj-scale-in { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }
  .obj-scale-in { animation: obj-scale-in 0.35s ease-out both; }
  @keyframes obj-glow { 0%, 100% { opacity: 0.3; } 50% { opacity: 0.7; } }
  .obj-glow { animation: obj-glow 4s ease-in-out infinite; }
  .obj-card { transition: all 0.3s ease; }
  .obj-card:hover { transform: translateY(-2px); box-shadow: 0 4px 16px rgba(0,0,0,0.3), 0 0 0 1px rgba(var(--noir-primary-rgb), 0.1); }
  .obj-row { transition: all 0.2s ease; }
  .obj-row:hover { background-color: rgba(var(--noir-primary-rgb), 0.04); }
  .obj-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.15; }
`;

function formatReward(reward) {
  if (!reward) return '';
  const parts = [];
  if (reward.rank_points) parts.push(`${Number(reward.rank_points).toLocaleString()} RP`);
  if (reward.money) parts.push(`$${Number(reward.money).toLocaleString()}`);
  if (reward.points) parts.push(`${Number(reward.points).toLocaleString()} pts`);
  if (reward.respect_points) parts.push(`${Number(reward.respect_points).toLocaleString()} respect`);
  if (reward.bullets) parts.push(`${Number(reward.bullets).toLocaleString()} bullets`);
  return parts.join(', ') || '—';
}

const LIFETIME_PERK_LABELS = {
  completed_it_bullet_reduction: '65% fewer bullets needed when attacking anyone',
  completed_it_armour_bonus: 'Enemies need 2x bullets to attack you AND your bodyguards',
  completed_it_booze_capacity: '2x booze carrying capacity (stacks with upgrades)',
  completed_it_daily_tokens: '5 of each token type automatically added daily (crimes, GTA, melt, OC, booze, racket, travel, properties, jailbust)',
};

const ObjectiveRow = ({ obj, delay = 0 }) => {
  const progressPct = obj.target > 0 ? Math.min(100, (obj.current / obj.target) * 100) : 0;
  return (
    <div
      className={`obj-row flex flex-wrap items-center gap-x-2 gap-y-1.5 px-2.5 py-1.5 rounded border obj-fade-in ${
        obj.done ? 'bg-primary/10 border-primary/30' : 'bg-zinc-800/20 border-zinc-700/30'
      }`}
      style={{ animationDelay: `${delay}s` }}
    >
      <span className="shrink-0 self-start sm:self-center pt-0.5 sm:pt-0">
        {obj.done ? <CheckCircle2 className="w-4 h-4 text-primary" /> : <Circle className="w-4 h-4 text-mutedForeground" />}
      </span>
      <p className="text-[11px] font-heading text-foreground min-w-0 flex-1 break-words line-clamp-3">{obj.label}</p>
      <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-2 w-full sm:w-auto shrink-0 min-w-0">
        <div className="flex items-center gap-2 shrink-0">
          <div className="relative w-14 sm:w-16 h-1.5 bg-secondary rounded-full overflow-hidden border border-primary/20 shrink-0">
            <div
              className="absolute top-0 left-0 h-full rounded-full transition-all duration-300"
              style={{
                width: `${progressPct}%`,
                minWidth: progressPct > 0 ? 2 : 0,
                background: 'linear-gradient(to right, var(--noir-accent-line), var(--noir-accent-line-dark))',
              }}
              role="progressbar"
              aria-valuenow={obj.current}
              aria-valuemin={0}
              aria-valuemax={obj.target}
            />
          </div>
          <span className="text-[10px] font-heading font-bold text-primary tabular-nums shrink-0 text-right">
            {Number(obj.current).toLocaleString()}/{Number(obj.target).toLocaleString()}
          </span>
        </div>
        {obj.reward && (
          <span className="text-[9px] text-mutedForeground font-heading break-words min-w-0" title={formatReward(obj.reward)}>
            {formatReward(obj.reward)}
          </span>
        )}
      </div>
    </div>
  );
};

export default function Objectives() {
  const [data, setData] = useState(() => readSessionJson(OBJ_CACHE_KEY));

  const [claiming, setClaiming] = useState(null);
  const [showAdminStats, setShowAdminStats] = useState(false);

  const fetchObjectives = useCallback(async (opts = {}) => {
    const silent = opts.silent === true;
    try {
      const res = await api.get('/objectives');
      setData(res.data);
      writeSessionJson(OBJ_CACHE_KEY, res.data);
    } catch (e) {
      if (!silent) toast.error(e.response?.data?.detail || 'Failed to load objectives');
    }
  }, []);

  const handleClaim = async (type) => {
    setClaiming(type);
    try {
      const res = await api.post('/objectives/claim', { type });
      if (res.data?.claimed && res.data?.reward) {
        toast.success(`Rewards claimed! ${formatReward(res.data.reward)}`);
        refreshUser();
      }
      await fetchObjectives({ silent: true });
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to claim');
    } finally {
      setClaiming(null);
    }
  };

  useEffect(() => {
    const c = readSessionJson(OBJ_CACHE_KEY);
    if (c != null) {
      setData(c);
      fetchObjectives({ silent: true });
    } else {
      fetchObjectives({ silent: false });
    }
  }, [fetchObjectives]);

  useEffect(() => {
    const id = setInterval(() => fetchObjectives({ silent: true }), 60_000);
    return () => clearInterval(id);
  }, [fetchObjectives]);

  if (!data) {
    return (
      <div className={`space-y-2 ${styles.pageContent} mobile-page-root`}>
        <style>{OBJ_STYLES}</style>
      </div>
    );
  }

  const daily = data?.daily ?? {};
  const weekly = data?.weekly ?? {};
  const monthly = data?.monthly ?? {};
  const lifetime = data?.lifetime ?? {};
  const adminStats = data?.admin_stats;

  const getAssessmentLabel = (a) => {
    if (!a) return '';
    const map = { too_easy: 'Too easy', too_hard: 'Too hard', about_right: 'About right', low_sample: 'Low sample' };
    return map[a] || a;
  };
  const getAssessmentColor = (a) => {
    if (a === 'too_easy') return 'text-amber-400';
    if (a === 'too_hard') return 'text-red-400';
    if (a === 'about_right') return 'text-emerald-400';
    return 'text-zinc-500';
  };
  const getAssessmentIcon = (a) => {
    if (a === 'too_easy') return <ThumbsDown className="w-3.5 h-3.5" />;
    if (a === 'too_hard') return <AlertTriangle className="w-3.5 h-3.5" />;
    if (a === 'about_right') return <ThumbsUp className="w-3.5 h-3.5" />;
    return null;
  };

  const formatMonthStart = (str) => {
    if (!str) return '—';
    try {
      const [y, m] = str.split('-');
      const d = new Date(parseInt(y, 10), parseInt(m, 10) - 1, 1);
      return d.toLocaleString(undefined, { month: 'long', year: 'numeric' });
    } catch { return str; }
  };

  return (
    <div className={`space-y-2 ${styles.pageContent} mobile-page-root`} data-testid="objectives-page">
      <style>{OBJ_STYLES}</style>

      <p className="text-[11px] text-zinc-500 font-heading italic break-words">Complete daily, weekly, and monthly goals for extra rewards. New objectives each period.</p>
      <AutoRefreshNote seconds={60} />

      {adminStats && (
        <div className={`${styles.panel} rounded-lg border border-primary/20 overflow-hidden mobile-panel`}>
          <button
            type="button"
            onClick={() => setShowAdminStats(!showAdminStats)}
            className="w-full px-3 py-2 flex items-center justify-between gap-2 bg-primary/8 border-b border-primary/20 hover:bg-primary/12"
          >
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-primary" />
              <span className="text-[11px] font-heading font-bold text-primary uppercase tracking-wider">Admin: Completion stats</span>
            </div>
            {showAdminStats ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {showAdminStats && (
            <div className="p-3 space-y-2 text-[11px] font-heading">
              <p className="text-zinc-500 mb-2">Eligible = users with this period active. Claimed = completed & claimed rewards.</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {['daily', 'weekly', 'monthly'].map((period) => {
                  const s = adminStats[period] || {};
                  const label = period === 'daily' ? 'Daily' : period === 'weekly' ? 'Weekly' : 'Monthly';
                  return (
                    <div key={period} className="p-2 rounded bg-zinc-800/50 border border-zinc-700/30">
                      <div className="font-bold text-primary mb-1">{label}</div>
                      <div className="text-zinc-400">
                        {s.claimed ?? 0} / {s.eligible ?? 0} claimed ({s.completion_pct ?? 0}%)
                      </div>
                      <div className={`mt-1 flex items-center gap-1 ${getAssessmentColor(s.assessment)}`}>
                        {getAssessmentIcon(s.assessment)}
                        <span>{getAssessmentLabel(s.assessment)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="text-[9px] text-zinc-600 mt-2">
                &gt;75% = too easy · &lt;15% = too hard · 15–75% = about right · &lt;5 eligible = low sample
              </p>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 min-w-0">
        {/* Today */}
        <section className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 flex flex-col min-w-0 obj-card obj-fade-in mobile-panel`} style={{ animationDelay: '0s' }}>
          <div className="absolute top-0 left-0 w-20 h-20 bg-primary/5 rounded-full blur-2xl pointer-events-none obj-glow" />
          <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <div className="px-3 py-2 bg-primary/8 border-b border-primary/20 shrink-0 min-w-0">
            <div className="flex items-center justify-between gap-2 min-w-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <Calendar className="w-4 h-4 text-primary shrink-0" />
                <h2 className="text-[11px] font-heading font-bold text-primary uppercase tracking-wider truncate">Today</h2>
              </div>
              <span className="text-[10px] text-mutedForeground font-heading shrink-0">{daily.date ?? '—'}</span>
            </div>
            <p className="text-[10px] text-mutedForeground font-heading mt-1 break-words">Resets midnight UTC · New objectives & rewards each day</p>
          </div>
          <div className="px-3 py-2 space-y-1 flex-1 min-h-0 overflow-auto min-w-0">
            {daily.claimed && (
              <div className="flex items-center gap-1.5 px-3 py-2 rounded bg-primary/20 border border-primary/30 text-[12px] font-heading text-primary obj-fade-in min-w-0">
                <Gift className="w-4 h-4 shrink-0" />
                <span className="break-words min-w-0">All daily objectives complete. Rewards claimed.</span>
              </div>
            )}
            {!daily.claimed && daily.all_complete && daily.claim_reward && Object.keys(daily.claim_reward).length > 0 && (
              <div className="flex flex-wrap items-center gap-2 px-3 py-2 rounded bg-primary/10 border border-primary/30 obj-fade-in min-w-0">
                <span className="text-[11px] font-heading text-foreground break-words min-w-0">Reward: {formatReward(daily.claim_reward)}</span>
                <button
                  type="button"
                  onClick={() => handleClaim('daily')}
                  disabled={claiming === 'daily'}
                  className="px-3 py-1 rounded bg-primary text-primary-foreground text-[10px] font-heading font-bold hover:bg-primary/90 disabled:opacity-50 border border-primary/30"
                >
                  {claiming === 'daily' ? 'Claiming...' : 'Claim'}
                </button>
              </div>
            )}
            {daily.objectives?.length ? (
              daily.objectives.map((obj, i) => <ObjectiveRow key={obj.id + obj.label} obj={obj} delay={i * 0.04} />)
            ) : (
              <p className="text-[12px] text-mutedForeground">No objectives for today.</p>
            )}
          </div>
          <div className="obj-art-line text-primary mx-3" />
        </section>

        {/* This week */}
        <section className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 flex flex-col min-w-0 obj-card obj-fade-in mobile-panel`} style={{ animationDelay: '0.05s' }}>
          <div className="absolute top-0 left-0 w-20 h-20 bg-primary/5 rounded-full blur-2xl pointer-events-none obj-glow" />
          <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <div className="px-3 py-2 bg-primary/8 border-b border-primary/20 shrink-0 min-w-0">
            <div className="flex items-center justify-between gap-2 min-w-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <CalendarDays className="w-4 h-4 text-primary shrink-0" />
                <h2 className="text-[11px] font-heading font-bold text-primary uppercase tracking-wider truncate">This week</h2>
              </div>
              <span className="text-[10px] text-mutedForeground font-heading shrink-0">Week of {weekly.week_start ?? '—'}</span>
            </div>
            <p className="text-[10px] text-mutedForeground font-heading mt-1 break-words">Resets Monday 00:00 UTC · New objectives & rewards each week</p>
          </div>
          <div className="px-3 py-2 space-y-1 flex-1 min-h-0 overflow-auto min-w-0">
            {weekly.claimed && (
              <div className="flex items-center gap-1.5 px-3 py-2 rounded bg-primary/20 border border-primary/30 text-[12px] font-heading text-primary obj-fade-in min-w-0">
                <Gift className="w-4 h-4 shrink-0" />
                <span className="break-words min-w-0">All weekly objectives complete. Rewards claimed.</span>
              </div>
            )}
            {!weekly.claimed && weekly.all_complete && weekly.claim_reward && Object.keys(weekly.claim_reward).length > 0 && (
              <div className="flex flex-wrap items-center gap-2 px-3 py-2 rounded bg-primary/10 border border-primary/30 obj-fade-in min-w-0">
                <span className="text-[11px] font-heading text-foreground break-words min-w-0">Reward: {formatReward(weekly.claim_reward)} <span className="text-primary font-bold">×5</span></span>
                <button
                  type="button"
                  onClick={() => handleClaim('weekly')}
                  disabled={claiming === 'weekly'}
                  className="px-3 py-1 rounded bg-primary text-primary-foreground text-[10px] font-heading font-bold hover:bg-primary/90 disabled:opacity-50 border border-primary/30"
                >
                  {claiming === 'weekly' ? 'Claiming...' : 'Claim'}
                </button>
              </div>
            )}
            {weekly.objectives?.length ? (
              weekly.objectives.map((obj, i) => <ObjectiveRow key={obj.id + obj.label} obj={obj} delay={i * 0.04} />)
            ) : (
              <p className="text-[12px] text-mutedForeground">No objectives for this week.</p>
            )}
          </div>
          <div className="obj-art-line text-primary mx-3" />
        </section>

        {/* This month - full width below Today & Week */}
        <section className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 flex flex-col min-w-0 md:col-span-2 obj-card obj-fade-in mobile-panel`} style={{ animationDelay: '0.1s' }}>
          <div className="absolute top-0 left-0 w-20 h-20 bg-primary/5 rounded-full blur-2xl pointer-events-none obj-glow" />
          <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <div className="px-3 py-2 bg-primary/8 border-b border-primary/20 shrink-0 min-w-0">
            <div className="flex items-center justify-between gap-2 min-w-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <CalendarRange className="w-4 h-4 text-primary shrink-0" />
                <h2 className="text-[11px] font-heading font-bold text-primary uppercase tracking-wider truncate">This month</h2>
              </div>
              <span className="text-[10px] text-mutedForeground font-heading shrink-0">{formatMonthStart(monthly.month_start)}</span>
            </div>
            <p className="text-[10px] text-mutedForeground font-heading mt-1 break-words">Resets 1st of month 00:00 UTC · New objectives & rewards each month</p>
          </div>
          <div className="px-3 py-2 space-y-1 flex-1 min-h-0 overflow-auto min-w-0">
            {monthly.claimed && (
              <div className="flex items-center gap-1.5 px-3 py-2 rounded bg-primary/20 border border-primary/30 text-[12px] font-heading text-primary obj-fade-in min-w-0">
                <Gift className="w-4 h-4 shrink-0" />
                <span className="break-words min-w-0">All monthly objectives complete. Rewards claimed.</span>
              </div>
            )}
            {!monthly.claimed && monthly.all_complete && monthly.claim_reward && Object.keys(monthly.claim_reward).length > 0 && (
              <div className="flex flex-wrap items-center gap-2 px-3 py-2 rounded bg-primary/10 border border-primary/30 obj-fade-in min-w-0">
                <span className="text-[11px] font-heading text-foreground break-words min-w-0">Reward: {formatReward(monthly.claim_reward)}</span>
                <button
                  type="button"
                  onClick={() => handleClaim('monthly')}
                  disabled={claiming === 'monthly'}
                  className="px-3 py-1 rounded bg-primary text-primary-foreground text-[10px] font-heading font-bold hover:bg-primary/90 disabled:opacity-50 border border-primary/30"
                >
                  {claiming === 'monthly' ? 'Claiming...' : 'Claim'}
                </button>
              </div>
            )}
            {monthly.objectives?.length ? (
              monthly.objectives.map((obj, i) => <ObjectiveRow key={obj.id + obj.label} obj={obj} delay={i * 0.04} />)
            ) : (
              <p className="text-[12px] text-mutedForeground">No objectives for this month.</p>
            )}
          </div>
          <div className="obj-art-line text-primary mx-3" />
        </section>

        {/* Lifetime: "Completed it" - one-time end-game achievement */}
        <section className={`relative ${styles.panel} rounded-md overflow-hidden border border-amber-500/30 flex flex-col min-w-0 md:col-span-2 obj-card obj-fade-in mobile-panel`} style={{ animationDelay: '0.15s' }}>
          <div className="absolute top-0 left-0 w-24 h-24 bg-amber-500/10 rounded-full blur-3xl pointer-events-none obj-glow" />
          <div className="h-px bg-gradient-to-r from-transparent via-amber-500/50 to-transparent" />
          <div className="px-3 py-2 bg-amber-500/10 border-b border-amber-500/20 shrink-0 min-w-0">
            <div className="flex items-center justify-between gap-2 min-w-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <Trophy className="w-4 h-4 text-amber-400 shrink-0" />
                <h2 className="text-[11px] font-heading font-bold text-amber-400 uppercase tracking-wider truncate">{lifetime.name || 'Completed it'}</h2>
              </div>
              <span className="text-[10px] text-amber-400/70 font-heading shrink-0">Lifetime Achievement</span>
            </div>
            <p className="text-[10px] text-amber-400/60 font-heading mt-1 break-words">Complete all 10 objectives to unlock permanent perks and massive rewards. One-time only.</p>
          </div>
          <div className="px-3 py-2 space-y-1.5 flex-1 min-h-0 overflow-auto min-w-0">
            {lifetime.claimed && (
              <div className="flex items-center gap-1.5 px-3 py-2 rounded bg-amber-500/20 border border-amber-500/30 text-[12px] font-heading text-amber-400 obj-fade-in min-w-0">
                <Trophy className="w-4 h-4 shrink-0" />
                <span className="break-words min-w-0">All lifetime objectives complete! Perks and rewards claimed.</span>
              </div>
            )}
            {!lifetime.claimed && lifetime.all_complete && lifetime.claim_reward && (
              <div className="flex flex-col gap-3 px-3 py-2.5 rounded bg-amber-500/15 border border-amber-500/30 obj-fade-in min-w-0">
                <div className="text-[11px] font-heading text-amber-300 font-bold">Ready to Claim!</div>
                <div className="text-[10px] text-foreground space-y-1">
                  <div className="text-amber-400 font-bold mb-1.5">One-Time Rewards:</div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5 ml-2">
                    {lifetime.claim_reward.money && (
                      <div className="bg-green-900/20 border border-green-700/30 rounded px-2 py-1">
                        <span className="text-green-400 font-bold">${Number(lifetime.claim_reward.money).toLocaleString()}</span>
                        <span className="text-mutedForeground ml-1">cash</span>
                      </div>
                    )}
                    {lifetime.claim_reward.points && (
                      <div className="bg-blue-900/20 border border-blue-700/30 rounded px-2 py-1">
                        <span className="text-blue-400 font-bold">{Number(lifetime.claim_reward.points).toLocaleString()}</span>
                        <span className="text-mutedForeground ml-1">points</span>
                      </div>
                    )}
                    {lifetime.claim_reward.bullets && (
                      <div className="bg-red-900/20 border border-red-700/30 rounded px-2 py-1">
                        <span className="text-red-400 font-bold">{Number(lifetime.claim_reward.bullets).toLocaleString()}</span>
                        <span className="text-mutedForeground ml-1">bullets</span>
                      </div>
                    )}
                  </div>
                </div>
                {lifetime.claim_reward.perks?.length > 0 && (
                  <div className="text-[10px] text-foreground">
                    <div className="text-amber-400 font-bold mb-1.5">Permanent Perks (forever):</div>
                    <div className="space-y-1.5 ml-2">
                      {lifetime.claim_reward.perks.map(p => (
                        <div key={p} className="bg-amber-900/20 border border-amber-700/30 rounded px-2 py-1.5">
                          <span className="text-amber-300">{LIFETIME_PERK_LABELS[p] || p}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => handleClaim('lifetime')}
                  disabled={claiming === 'lifetime'}
                  className="mt-1 px-4 py-1.5 rounded bg-amber-500 text-black text-[11px] font-heading font-bold hover:bg-amber-400 disabled:opacity-50 border border-amber-400/50 self-start"
                >
                  {claiming === 'lifetime' ? 'Claiming...' : 'Claim Lifetime Rewards'}
                </button>
              </div>
            )}
            {!lifetime.claimed && !lifetime.all_complete && lifetime.claim_reward && (
              <div className="px-3 py-2.5 rounded bg-zinc-800/30 border border-zinc-700/30 text-[10px] font-heading min-w-0 space-y-2">
                <div className="text-amber-400 font-bold">Rewards on completion:</div>
                <div className="text-[9px] text-mutedForeground/70 italic border-l-2 border-amber-500/30 pl-2">
                  Note: Rewards may be adjusted based on the current game economy at the time your account is close to completion.
                </div>
                <div className="text-foreground space-y-1">
                  <div className="text-mutedForeground font-bold text-[9px] uppercase tracking-wide">One-Time Rewards:</div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5 ml-2">
                    {lifetime.claim_reward.money && (
                      <div className="bg-green-900/10 border border-green-700/20 rounded px-2 py-1">
                        <span className="text-green-400/80 font-bold">${Number(lifetime.claim_reward.money).toLocaleString()}</span>
                        <span className="text-mutedForeground ml-1">cash</span>
                      </div>
                    )}
                    {lifetime.claim_reward.points && (
                      <div className="bg-blue-900/10 border border-blue-700/20 rounded px-2 py-1">
                        <span className="text-blue-400/80 font-bold">{Number(lifetime.claim_reward.points).toLocaleString()}</span>
                        <span className="text-mutedForeground ml-1">points</span>
                      </div>
                    )}
                    {lifetime.claim_reward.bullets && (
                      <div className="bg-red-900/10 border border-red-700/20 rounded px-2 py-1">
                        <span className="text-red-400/80 font-bold">{Number(lifetime.claim_reward.bullets).toLocaleString()}</span>
                        <span className="text-mutedForeground ml-1">bullets</span>
                      </div>
                    )}
                  </div>
                </div>
                {lifetime.claim_reward.perks?.length > 0 && (
                  <div className="text-foreground space-y-1">
                    <div className="text-mutedForeground font-bold text-[9px] uppercase tracking-wide">Permanent Perks (forever):</div>
                    <div className="space-y-1 ml-2">
                      {lifetime.claim_reward.perks.map(p => (
                        <div key={p} className="bg-amber-900/10 border border-amber-700/20 rounded px-2 py-1.5 text-mutedForeground">
                          {LIFETIME_PERK_LABELS[p] || p}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            {lifetime.objectives?.length ? (
              lifetime.objectives.map((obj, i) => <ObjectiveRow key={obj.id + obj.label} obj={obj} delay={i * 0.04} />)
            ) : (
              <p className="text-[12px] text-mutedForeground">Loading lifetime objectives...</p>
            )}
          </div>
          <div className="obj-art-line text-amber-500 mx-3" />
        </section>
      </div>
    </div>
  );
}
