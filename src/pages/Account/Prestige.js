import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { Star, TrendingUp, Shield, Car, Crosshair, Lock, Check, Briefcase, Target, Layers } from 'lucide-react';
import api, { refreshUser } from '../../utils/api';
import PrestigeBadge from '../../components/PrestigeBadge';
import { clearDashboardSessionRankProgress } from '../../utils/dashboardSessionCache';
import styles from '../../styles/noir.module.css';

const PRESTIGE_COLORS = {
  0: '#71717a',
  1: '#cd7f32',
  2: '#a8a9ad',
  3: '#ffd700',
  4: '#b9f2ff',
  5: '#dc2626',
};

const ROMAN = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV', 5: 'V' };

const PRESTIGE_CRIME_INFO = {
  1: { name: 'The Syndicate Run',     dropType: '30% Rare Drop',    rewards: ['Cash', 'Respect', 'Booze'] },
  2: { name: 'Contraband Courier',    dropType: '30% Rare Drop',    rewards: ['Booze', 'Bullets'] },
  3: { name: 'Black Market Deal',     dropType: '30% Rare Drop',    rewards: ['Booze', 'Bullets', 'Points'] },
  4: { name: "The Commission's Work", dropType: 'Guaranteed ×0.5',  rewards: ['Cash', 'Respect', 'Booze', 'Bullets', 'Points'] },
  5: { name: "Godfather's Orders",    dropType: 'Guaranteed ×1',    rewards: ['Cash', 'Respect', 'Booze', 'Bullets', 'Points'] },
};

const PRESTIGE_PAGE_STYLES = `
  @keyframes prestige-glow { 0%, 100% { opacity: 0.4; } 50% { opacity: 0.85; } }
  .prestige-glow { animation: prestige-glow 3s ease-in-out infinite; }
  @keyframes prestige-fade { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .prestige-fade { animation: prestige-fade 0.4s ease-out both; }
  .pr-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.15; }
  .pr-progress-track { height: 8px; background: #333333; border-radius: 9999px; overflow: hidden; }

  @media (max-width: 767px) {
    .pr-row {
      display: grid !important;
      grid-template-columns: minmax(0, 1fr) auto;
      grid-template-areas:
        "name action"
        "meta action";
      column-gap: 8px;
      row-gap: 3px;
      align-items: center;
      padding: 7px 8px !important;
    }
    .pr-row-name { grid-area: name; min-width: 0; }
    .pr-row-meta { grid-area: meta; display: flex; align-items: center; gap: 6px; min-width: 0; flex-wrap: wrap; }
    .pr-row-action { grid-area: action; align-self: center; width: auto !important; justify-content: flex-end; }
    .pr-row-name .pr-name-text {
      white-space: normal;
      overflow: visible;
      text-overflow: clip;
      line-height: 1.25;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }
    .pr-col-head { display: none !important; }
  }
`;

const PR_ACTION_IDLE =
  'pr-action-btn bg-zinc-700/50 text-mutedForeground rounded px-2.5 py-1.5 min-h-9 text-[9px] font-bold uppercase border border-zinc-600/50 cursor-not-allowed font-heading';
const PR_ACTION_GO =
  'pr-action-btn tap-feedback rounded px-2.5 py-1.5 min-h-9 text-[9px] font-bold uppercase tracking-wide border transition-all touch-manipulation active:scale-[0.97] font-heading';

function ProgressBar({ value, max, color }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-1.5">
      <div className="pr-progress-track flex-1 min-w-[64px]">
        <div
          className="h-full rounded-full"
          style={{
            width: `${pct}%`,
            minWidth: pct > 0 ? 4 : 0,
            backgroundColor: color,
            boxShadow: pct > 0 ? `0 0 8px ${color}60` : undefined,
            transition: 'width 0.3s ease',
          }}
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
      <span className="text-[9px] sm:text-[10px] font-heading tabular-nums shrink-0 w-7" style={{ color }}>
        {pct}%
      </span>
    </div>
  );
}

const BENEFIT_ROWS = [
  { key: 'crime_mult',             icon: Shield,     label: 'Crime payouts',          fmt: v => `+${Math.round((v - 1) * 100)}%` },
  { key: 'oc_mult',                icon: TrendingUp, label: 'OC payouts',             fmt: v => `+${Math.round((v - 1) * 100)}%` },
  { key: 'gta_rare_boost',         icon: Car,        label: 'GTA rare cars',          fmt: v => `+${v}×` },
  { key: 'npc_mult',               icon: Crosshair,  label: 'NPC rewards',            fmt: v => `+${Math.round((v - 1) * 100)}%` },
  { key: 'mission_reward_mult',    icon: Target,     label: 'Mission rewards',        fmt: v => `×${Number(v).toFixed(Number(v) % 1 ? 1 : 0)}` },
  { key: 'illegal_business_mult',  icon: Briefcase,  label: 'Illegal business',       fmt: v => `+${Math.round((v - 1) * 100)}%` },
  { key: 'rank_threshold_mult',    icon: Layers,     label: 'Rank tier thresholds',   fmt: v => `×${Number(v).toFixed(Number(v) % 1 ? 1 : 0)}` },
];

function benefitDefault(key) {
  if (key === 'gta_rare_boost') return 0;
  return 1;
}

function LevelRow({ row, isCurrent, isUnlocked }) {
  const color = PRESTIGE_COLORS[row.level];
  return (
    <div
      data-level={row.level}
      className="pr-row flex items-center justify-between gap-3 px-2 py-1.5 rounded-md transition-all"
      style={isCurrent ? { backgroundColor: `${color}10`, border: `1px solid ${color}40` } : undefined}
    >
      <div className="pr-row-name flex items-center gap-1.5 min-w-0 flex-1">
        {isUnlocked ? (
          <PrestigeBadge level={row.level} size="sm" />
        ) : (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-bold text-zinc-700 border border-zinc-700/50 font-heading">
            <Lock size={7} /> {ROMAN[row.level]}
          </span>
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-1">
            <span className="pr-name-text text-xs font-heading font-bold truncate" style={{ color: isUnlocked ? color : '#52525b' }}>
              {row.name}
            </span>
            {isCurrent && (
              <span className="px-1 py-0.5 rounded text-[8px] font-bold uppercase" style={{ color, backgroundColor: `${color}20` }}>
                You
              </span>
            )}
          </div>
          <div className="text-[9px] text-mutedForeground truncate hidden sm:block mt-0.5 tabular-nums">
            {(row.godfather_req || 0).toLocaleString()} RP
            {(row.points_reward || 0) > 0 ? ` · +${Number(row.points_reward).toLocaleString()} pts` : ''}
          </div>
        </div>
      </div>
      <div className="pr-row-meta flex items-center gap-2 shrink-0 text-[10px] font-heading font-bold tabular-nums" style={{ color: isUnlocked ? color : '#52525b' }}>
        <span className="sm:hidden">{(row.godfather_req || 0).toLocaleString()} RP</span>
        <span className="hidden sm:inline w-16 text-right">+{Number(row.points_reward ?? 0).toLocaleString()}</span>
        <span className="hidden sm:inline w-12 text-right">+{Math.round(((row.crime_mult ?? 1) - 1) * 100)}%</span>
        <span className="hidden sm:inline w-12 text-right">+{Math.round(((row.oc_mult ?? 1) - 1) * 100)}%</span>
      </div>
      <div className="pr-row-action shrink-0 w-[60px] flex justify-end">
        {isCurrent ? (
          <span className="text-[9px] font-heading font-bold uppercase" style={{ color }}>You</span>
        ) : isUnlocked ? (
          <span className="text-[9px] text-mutedForeground font-heading uppercase">On</span>
        ) : (
          <button type="button" disabled className={PR_ACTION_IDLE}>Locked</button>
        )}
      </div>
    </div>
  );
}

// Session cache + once-per-session entrance animation, so revisits don't blank the
// page with a loader and replay the fade like a full reload.
let _cachedPrestigeInfo = null;
let _prestigeIntroPlayed = false;

export default function Prestige() {
  const animateIn = useRef(!_prestigeIntroPlayed).current;
  useEffect(() => { _prestigeIntroPlayed = true; }, []);
  const [info, setInfo]           = useState(_cachedPrestigeInfo);
  const [hasLoaded, setHasLoaded] = useState(_cachedPrestigeInfo != null);
  const [activating, setActivating] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const levelsScrollRef = useRef(null);

  const fetchInfo = useCallback(async () => {
    try {
      const res = await api.get('/prestige/info');
      _cachedPrestigeInfo = res.data;
      setInfo(res.data);
    } catch {
      // Keep showing cached info on a failed silent refresh.
      if (!_cachedPrestigeInfo) {
        toast.error('Failed to load prestige info');
        setInfo(null);
      }
    } finally {
      setHasLoaded(true);
    }
  }, []);

  useEffect(() => { fetchInfo(); }, [fetchInfo]);

  // Scroll current level into view on load
  useEffect(() => {
    if (!info || !levelsScrollRef.current) return;
    const level = info.prestige_level;
    const card = levelsScrollRef.current.querySelector(`[data-level="${level}"]`);
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [info]);

  const handlePrestige = async () => {
    setActivating(true);
    setShowConfirm(false);
    try {
      const res = await api.post('/prestige/activate');
      toast.success(res.data?.message || 'Prestiged!');
      try { clearDashboardSessionRankProgress(); } catch (_) { /* ignore */ }
      await refreshUser();
      await fetchInfo();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Failed to prestige');
    } finally {
      setActivating(false);
    }
  };

  if (!hasLoaded) {
    return (
      <div className={`space-y-2 ${styles.pageContent} mobile-page-root flex items-center justify-center min-h-[40vh]`}>
        <span className="text-[9px] font-heading uppercase tracking-wider text-mutedForeground">Loading prestige…</span>
      </div>
    );
  }

  if (!info) return (
    <div className="text-center py-20 text-zinc-600 text-xs font-heading">Failed to load prestige data.</div>
  );

  const level     = info.prestige_level;
  const color     = PRESTIGE_COLORS[level]     || PRESTIGE_COLORS[0];
  const nextColor = PRESTIGE_COLORS[level + 1] || PRESTIGE_COLORS[5];
  const godReq    = info.godfather_req;
  const effectiveRp = info.effective_rank_points;
  const godReqNum = Number(godReq) || 0;
  const effRpNum = Number(effectiveRp) || 0;
  // Real climb: max(Godfather effective ladder, prestige RP gate) — not the smaller gate alone (e.g. 510k vs 1.02M).
  const pathTargetNum = Number(info.prestige_path_target_effective ?? godReqNum) || 0;
  const prestigePathMet = pathTargetNum > 0 && effRpNum >= pathTargetNum;
  const fadeClass = animateIn ? 'prestige-fade' : '';

  return (
    <div className={`space-y-2 ${styles.pageContent} mobile-page-root`} data-testid="prestige-page">
      <style>{PRESTIGE_PAGE_STYLES}</style>

      <p className={`relative ${fadeClass} text-[9px] text-zinc-500 font-heading italic inline-flex items-center gap-1.5 flex-wrap leading-none`}>
        <span>Reach Godfather, then prestige. Rank resets. Bonuses stack.</span>
      </p>

      <div
        className={`relative ${styles.panel} rounded-md overflow-hidden ${fadeClass} mobile-panel`}
        style={{ borderColor: `${color}30`, borderWidth: 1, borderStyle: 'solid' }}
      >
        <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between">
          <span className="text-[9px] font-heading font-bold uppercase tracking-[0.12em] flex items-center gap-1" style={{ color }}>
            <Star size={10} />
            {level > 0 ? info.prestige_name : 'Begin Your Legacy'}
          </span>
          <span className="text-[10px] font-heading font-bold tabular-nums" style={{ color }}>
            {info.at_max_prestige ? 'MAX' : `${level}/5`}
          </span>
        </div>
        <div className="p-2 flex items-center gap-2">
          <div className="shrink-0">
            {level > 0
              ? <PrestigeBadge level={level} size="lg" showLabel />
              : <span className="inline-flex items-center gap-1.5 text-zinc-600 text-[10px] font-heading"><Star size={12} /> No Prestige Yet</span>
            }
          </div>
          <div className="flex-1 min-w-0">
            {level > 0 && (
              <p className="text-[9px] text-mutedForeground font-heading">Level {level} of 5</p>
            )}
            {info.can_prestige && (
              <button
                type="button"
                onClick={() => setShowConfirm(true)}
                disabled={activating}
                className={`${PR_ACTION_GO} mt-1.5`}
                style={{
                  background: `${nextColor}18`,
                  borderColor: `${nextColor}50`,
                  color: nextColor,
                }}
              >
                {activating ? '...' : `Prestige → ${level + 1}`}
              </button>
            )}
          </div>
        </div>
        <div className="pr-art-line text-primary mx-2.5" />
      </div>

      {!info.at_max_prestige && (
        <div
          className={`relative ${styles.panel} rounded-md overflow-hidden ${fadeClass} mobile-panel`}
          style={{ animationDelay: '0.05s' }}
        >
          <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between">
            <span className="text-[9px] font-heading font-bold uppercase tracking-[0.12em] flex items-center gap-1" style={{ color: nextColor }}>
              <TrendingUp size={10} />
              Path to Prestige {level + 1}
            </span>
            <span className="text-[10px] font-heading font-bold tabular-nums" style={{ color: nextColor }}>
              {prestigePathMet ? '100%' : `${effRpNum.toLocaleString()} / ${pathTargetNum.toLocaleString()}`}
            </span>
          </div>
          <div className="p-2 space-y-2">
            <ProgressBar value={effRpNum} max={pathTargetNum || 1} color={nextColor} />
            {!prestigePathMet && (
              <p className="text-[9px] text-mutedForeground font-heading">
                Target {pathTargetNum.toLocaleString()} RP (Godfather tier is{' '}
                {(info.godfather_effective_threshold ?? 0).toLocaleString()}
                {godReqNum > (info.godfather_effective_threshold ?? 0)
                  ? `; prestige gate ${godReqNum.toLocaleString()}`
                  : ''}
                ). Higher prestige makes each street rank (Rat→Godfather) require more RP than the last prestige.
              </p>
            )}
            <div className="flex flex-col gap-1">
              {[
                ['Current rank',   info.rank_name, 'primary'],
                ['Rank points',    info.rank_points.toLocaleString(), 'fg'],
                ['Effective RP',   effectiveRp.toLocaleString(), 'fg'],
              ].map(([label, val, tone]) => (
                <div key={label} className="flex justify-between items-center text-[10px] font-heading">
                  <span className="text-mutedForeground">{label}</span>
                  <span className={`font-bold tabular-nums ${tone === 'primary' ? 'text-primary' : 'text-foreground'}`}>
                    {val}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="pr-art-line text-primary mx-2.5" />
        </div>
      )}

      {info.at_max_prestige && (
        <div
          className={`relative ${styles.panel} rounded-md overflow-hidden ${fadeClass} mobile-panel`}
          style={{ animationDelay: '0.05s' }}
        >
          <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20">
            <span className="text-[9px] font-heading font-bold uppercase tracking-[0.12em] flex items-center gap-1" style={{ color }}>
              <TrendingUp size={10} />
              Maximum Reached
            </span>
          </div>
          <div className="px-3 py-4 text-center">
            <p className="text-[10px] font-heading" style={{ color }}>You have reached the pinnacle.</p>
            <p className="text-[9px] text-mutedForeground font-heading mt-1 italic">Godfather Legacy — feared by all.</p>
          </div>
          <div className="pr-art-line text-primary mx-2.5" />
        </div>
      )}

      <div
        className={`relative ${styles.panel} rounded-md overflow-hidden ${fadeClass} mobile-panel`}
        style={{ animationDelay: '0.1s' }}
      >
        <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between">
          <span className="text-[9px] font-heading font-bold uppercase tracking-[0.12em] flex items-center gap-1" style={{ color }}>
            <Star size={10} />
            {level > 0 ? 'Active Benefits' : 'Benefits Await'}
          </span>
          {level > 0 && (
            <span className="text-[9px] font-heading font-bold uppercase" style={{ color }}>
              Live
            </span>
          )}
        </div>

        {level === 0 ? (
          <div className="p-2 space-y-1">
            <p className="text-[9px] text-mutedForeground font-heading italic">
              Reach Godfather rank and prestige to unlock passive bonuses on all activities.
            </p>
            <p className="text-[9px] text-mutedForeground font-heading">
              Badge effects (crime, GTA, jail, OC, booze, melt, hitlist, kills) gain a 0.5% boost per prestige level.
            </p>
          </div>
        ) : (
          <>
            <div className="pr-col-head hidden md:flex items-center gap-3 px-2 pt-1.5 pb-0.5">
              <span className="flex-1 min-w-0 text-[8px] font-heading font-bold uppercase tracking-[0.12em] text-mutedForeground">Benefit</span>
              <span className="w-16 text-right text-[8px] font-heading font-bold uppercase tracking-[0.12em] text-mutedForeground">Bonus</span>
            </div>
            <div className="p-1.5 space-y-0.5 sm:space-y-1">
              {BENEFIT_ROWS.map(({ key, icon: Icon, label, fmt }) => {
                const val = info.current_benefits?.[key] ?? benefitDefault(key);
                return (
                  <div key={key} className="flex items-center justify-between gap-3 px-2 py-1.5 rounded-md bg-zinc-800/30">
                    <div className="flex items-center gap-1 min-w-0 flex-1">
                      <Icon size={12} style={{ color }} className="shrink-0" />
                      <span className="text-xs font-heading font-bold text-foreground truncate">{label}</span>
                    </div>
                    <div className="shrink-0 w-16 text-right">
                      <span className="text-[10px] font-heading font-bold tabular-nums" style={{ color }}>{fmt(val)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="px-2.5 pb-2 text-[9px] font-heading text-mutedForeground">
              These bonuses apply automatically in-game (crime/OC/NPC cash, GTA rare weights, missions, illegal business, scaled rank ladder). Badge effects also gain a 0.5% boost per prestige level.
            </p>
          </>
        )}
        <div className="pr-art-line text-primary mx-2.5" />
      </div>

      <div
        className={`relative ${styles.panel} rounded-md overflow-hidden ${fadeClass} mobile-panel`}
        style={{ animationDelay: '0.12s' }}
      >
        <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between">
          <span className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em] flex items-center gap-1">
            <Star size={10} />
            Prestige Crimes
          </span>
          <span className="text-[9px] font-heading text-mutedForeground uppercase">Exclusive</span>
        </div>
        <div className="pr-col-head hidden md:flex items-center gap-3 px-2 pt-1.5 pb-0.5">
          <span className="flex-1 min-w-0 text-[8px] font-heading font-bold uppercase tracking-[0.12em] text-mutedForeground">Crime</span>
          <span className="w-28 text-right text-[8px] font-heading font-bold uppercase tracking-[0.12em] text-mutedForeground">Drop</span>
          <span className="w-[60px] shrink-0" aria-hidden />
        </div>
        <div className="p-1.5 space-y-0.5 sm:space-y-1">
          {[1, 2, 3, 4, 5].map((lvl) => {
            const crimeInfo = PRESTIGE_CRIME_INFO[lvl];
            const crimeColor = PRESTIGE_COLORS[lvl];
            const isUnlocked = lvl <= level;
            const isGuaranteed = lvl >= 4;
            return (
              <div
                key={lvl}
                className="pr-row flex items-center justify-between gap-3 px-2 py-1.5 rounded-md transition-all"
                style={isUnlocked ? { background: `${crimeColor}08` } : { background: 'rgba(39,39,42,0.3)' }}
              >
                <div className="pr-row-name flex items-center gap-1.5 min-w-0 flex-1">
                  {isUnlocked ? (
                    <PrestigeBadge level={lvl} size="sm" />
                  ) : (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-heading font-bold border text-zinc-600 border-zinc-700/50">
                      <Lock size={7} /> {ROMAN[lvl]}
                    </span>
                  )}
                  <div className="min-w-0">
                    <span
                      className="pr-name-text text-xs font-heading font-bold truncate block"
                      style={{ color: isUnlocked ? crimeColor : '#52525b' }}
                    >
                      {crimeInfo.name}
                    </span>
                    <div className="hidden sm:flex items-center gap-1 flex-wrap mt-0.5">
                      {crimeInfo.rewards.map((r) => (
                        <span
                          key={r}
                          className="text-[9px] font-heading px-1 py-0.5 rounded"
                          style={isUnlocked
                            ? { color: crimeColor, background: `${crimeColor}15` }
                            : { color: '#3f3f46', background: 'rgba(39,39,42,0.4)' }
                          }
                        >
                          {r}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="pr-row-meta shrink-0 w-28 text-right">
                  <span
                    className="text-[10px] font-heading font-bold uppercase"
                    style={isUnlocked
                      ? { color: isGuaranteed ? '#34d399' : '#fbbf24' }
                      : { color: '#52525b' }
                    }
                  >
                    {crimeInfo.dropType}
                  </span>
                  <div className="sm:hidden flex items-center gap-1 flex-wrap justify-end mt-0.5">
                    {crimeInfo.rewards.map((r) => (
                      <span key={r} className="text-[9px] font-heading text-mutedForeground">{r}</span>
                    ))}
                  </div>
                </div>
                <div className="pr-row-action shrink-0 w-[60px] flex justify-end">
                  {isUnlocked ? (
                    <span className="text-[9px] text-mutedForeground font-heading uppercase">On</span>
                  ) : (
                    <button type="button" disabled className={PR_ACTION_IDLE}>Locked</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="pr-art-line text-primary mx-2.5" />
      </div>

      <div
        className={`relative ${styles.panel} rounded-md overflow-hidden ${fadeClass} mobile-panel`}
        style={{ animationDelay: '0.15s' }}
      >
        <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20">
          <span className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em] flex items-center gap-1">
            <Shield size={10} />
            All Prestige Levels
          </span>
        </div>

        <div
          ref={levelsScrollRef}
          className="md:hidden p-1.5 space-y-0.5"
        >
          {(info.all_levels || []).map((row) => (
            <LevelRow
              key={row.level}
              row={row}
              isCurrent={row.level === level}
              isUnlocked={row.level <= level}
            />
          ))}
        </div>

        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-[10px] font-heading">
            <thead>
              <tr className="pr-col-head">
                <th className="text-left px-2 py-1.5 text-[8px] text-mutedForeground font-bold uppercase tracking-[0.12em]">Level</th>
                <th className="text-left px-2 py-1.5 text-[8px] text-mutedForeground font-bold uppercase tracking-[0.12em]">Title</th>
                <th className="text-center px-2 py-1.5 text-[8px] text-mutedForeground font-bold uppercase tracking-[0.12em]" title="Effective RP to prestige into this tier (not per street rank)">Prestige RP</th>
                <th className="text-center px-2 py-1.5 text-[8px] text-mutedForeground font-bold uppercase tracking-[0.12em]" title="Store points awarded when you reach this prestige">Points</th>
                <th className="text-center px-2 py-1.5 text-[8px] text-mutedForeground font-bold uppercase tracking-[0.12em]">Crime</th>
                <th className="text-center px-2 py-1.5 text-[8px] text-mutedForeground font-bold uppercase tracking-[0.12em]">OC</th>
                <th className="text-center px-2 py-1.5 text-[8px] text-mutedForeground font-bold uppercase tracking-[0.12em]">GTA</th>
                <th className="text-center px-2 py-1.5 text-[8px] text-mutedForeground font-bold uppercase tracking-[0.12em]">NPC</th>
                <th className="text-center px-2 py-1.5 text-[8px] text-mutedForeground font-bold uppercase tracking-[0.12em]">Missions</th>
                <th className="text-center px-2 py-1.5 text-[8px] text-mutedForeground font-bold uppercase tracking-[0.12em]">Business</th>
                <th className="text-center px-2 py-1.5 text-[8px] text-mutedForeground font-bold uppercase tracking-[0.12em]">Ranks</th>
              </tr>
            </thead>
            <tbody>
              {(info.all_levels || []).map((row) => {
                const isCurrent  = row.level === level;
                const isUnlocked = row.level <= level;
                const rowColor   = PRESTIGE_COLORS[row.level];
                return (
                  <tr
                    key={row.level}
                    className="border-b border-zinc-800/30 transition-colors"
                    style={isCurrent ? { backgroundColor: `${rowColor}10` } : undefined}
                  >
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-2">
                        {isUnlocked
                          ? <PrestigeBadge level={row.level} size="sm" />
                          : <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-bold text-zinc-700 border border-zinc-700/50">
                              <Lock size={7} /> {ROMAN[row.level]}
                            </span>
                        }
                        {isCurrent && (
                          <span className="text-[8px] font-bold uppercase tracking-widest" style={{ color: rowColor }}>YOU</span>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-1.5" style={{ color: isUnlocked ? rowColor : '#52525b' }}>{row.name}</td>
                    <td className="px-2 py-1.5 text-center text-zinc-500 tabular-nums">{(row.godfather_req ?? 0).toLocaleString()}</td>
                    <td className="px-2 py-1.5 text-center tabular-nums" style={{ color: isUnlocked ? rowColor : '#52525b' }}>+{(row.points_reward ?? 0).toLocaleString()}</td>
                    <td className="px-2 py-1.5 text-center tabular-nums" style={{ color: isUnlocked ? rowColor : '#52525b' }}>+{Math.round(((row.crime_mult ?? 1) - 1) * 100)}%</td>
                    <td className="px-2 py-1.5 text-center tabular-nums" style={{ color: isUnlocked ? rowColor : '#52525b' }}>+{Math.round(((row.oc_mult ?? 1) - 1) * 100)}%</td>
                    <td className="px-2 py-1.5 text-center tabular-nums" style={{ color: isUnlocked ? rowColor : '#52525b' }}>+{row.gta_rare_boost ?? 0}×</td>
                    <td className="px-2 py-1.5 text-center tabular-nums" style={{ color: isUnlocked ? rowColor : '#52525b' }}>+{Math.round(((row.npc_mult ?? 1) - 1) * 100)}%</td>
                    <td className="px-2 py-1.5 text-center tabular-nums" style={{ color: isUnlocked ? rowColor : '#52525b' }}>×{Number(row.mission_reward_mult ?? 1)}</td>
                    <td className="px-2 py-1.5 text-center tabular-nums" style={{ color: isUnlocked ? rowColor : '#52525b' }}>+{Math.round(((row.illegal_business_mult ?? 1) - 1) * 100)}%</td>
                    <td className="px-2 py-1.5 text-center tabular-nums" style={{ color: isUnlocked ? rowColor : '#52525b' }}>×{Number(row.rank_threshold_mult ?? 1)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="pr-art-line text-primary mx-2.5" />
      </div>

      {/* ── CONFIRM MODAL (unchanged logic, tightened mobile padding) ───── */}
      {showConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/90 backdrop-blur-sm"
          onClick={() => setShowConfirm(false)}
        >
          <div
            className={`relative w-full sm:max-w-sm ${styles.panel} rounded-t-2xl sm:rounded-xl overflow-hidden shadow-2xl`}
            style={{ border: `1px solid ${nextColor}40` }}
            onClick={e => e.stopPropagation()}
          >
            <div className="h-0.5" style={{ background: `linear-gradient(90deg, transparent, ${nextColor}80, transparent)` }} />

            {/* Drag handle on mobile */}
            <div className="flex justify-center pt-3 pb-1 sm:hidden">
              <div className="w-10 h-1 rounded-full bg-zinc-700" />
            </div>

            <div className="p-5 space-y-4">
              <div className="text-center">
                <PrestigeBadge level={level + 1} size="lg" showLabel />
                <h2
                  className="text-base font-heading font-bold mt-3 uppercase tracking-wider"
                  style={{ color: nextColor }}
                >
                  Prestige to Level {level + 1}
                </h2>
              </div>

              <div className="space-y-2 text-[10px] font-heading text-zinc-400">
                <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-red-500/5 border border-red-500/15">
                  <span className="text-red-400 mt-0.5 shrink-0">⚠</span>
                  <span>Your rank resets to <strong className="text-red-400">Rat</strong> and rank points return to 0. This cannot be undone.</span>
                </div>
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-emerald-500/5 border border-emerald-500/15">
                  <Check size={10} className="text-emerald-400 shrink-0" />
                  <span>Money, cars, bullets, family, casino ownership, <strong className="text-emerald-400">Game Pass</strong> tier progress, and <strong className="text-emerald-400">mission progress</strong> (map / story) are <strong className="text-emerald-400">kept</strong>.</span>
                </div>
                <div
                  className="flex items-center gap-2 px-3 py-2.5 rounded-xl"
                  style={{ backgroundColor: `${nextColor}08`, border: `1px solid ${nextColor}20` }}
                >
                  <Star size={10} style={{ color: nextColor }} className="shrink-0" />
                  <span style={{ color: nextColor }}>You gain all Prestige {level + 1} benefits (stacking on current).</span>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowConfirm(false)}
                  className={`flex-1 ${PR_ACTION_IDLE} !cursor-pointer hover:border-zinc-500`}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handlePrestige}
                  disabled={activating}
                  className={`flex-1 ${PR_ACTION_GO}`}
                  style={{
                    background: `${nextColor}20`,
                    borderColor: `${nextColor}60`,
                    color: nextColor,
                  }}
                >
                  {activating ? 'Activating…' : 'Confirm Prestige'}
                </button>
              </div>

              {/* Extra bottom padding for home indicator on iOS */}
              <div className="h-1 sm:hidden" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
