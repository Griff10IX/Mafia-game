import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  BookOpen, X, Crown, Clock, Lock, CheckCircle, Banknote,
  MapPin, ChevronRight, Skull, Star, AlertCircle, Coins, ListChecks, ChevronUp, Zap
} from 'lucide-react';
import api, { refreshUser, apiRequestWith429Retry } from '../../utils/api';
import { toast } from 'sonner';
import styles from '../../styles/noir.module.css';
import { readSessionJson, writeSessionJson } from '../../utils/sessionPageCache';

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────

const MISSIONS_STYLES = `
  @keyframes m-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes m-scale-in { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }
  @keyframes shimmer { 0% { background-position: -200% center; } 100% { background-position: 200% center; } }
  @keyframes pulseBorder { 0%,100% { border-color: rgba(234,179,8,0.4); } 50% { border-color: rgba(234,179,8,0.8); } }
  @keyframes progressFill { from { width: 0%; } to { width: var(--target-w); } }
  .m-fade-in { animation: m-fade-in 0.4s ease-out both; }
  .m-scale-in { animation: m-scale-in 0.3s ease-out both; }
  .m-row:hover { background: rgba(var(--noir-primary-rgb), 0.06); }
  .m-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.15; }
  .m-boss-pulse { animation: pulseBorder 2s ease-in-out infinite; }
  .shimmer-gold { background: linear-gradient(90deg,#92650a 0%,#eab308 40%,#fef08a 55%,#eab308 70%,#92650a 100%); background-size: 200% auto; -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; animation: shimmer 2.8s linear infinite; }
  .progress-bar-fill { animation: progressFill 0.5s ease-out both; }
  .m-focus-card { transition: border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease; }
  .m-focus-card:hover { transform: translateY(-1px); }
`;

const fmt = (n) => `$${Number(n ?? 0).toLocaleString()}`;

// Must match backend `LOOT_BOX_PIECES_PER_OPEN` (routers/money/loot_box.py)
const LOOT_BOX_PIECES_PER_OPEN = 100;
const LOOT_BOX_PIECES_TOOLTIP = `Loot box pieces. Collect ${LOOT_BOX_PIECES_PER_OPEN} on the Loot Box page to open a box for random rewards (cash, points, bullets, respect, XP tokens, and more).`;
const MISSIONS_CACHE_KEY = 'mafia_missions_v1';
const TRIBUTE_BANK_TOKEN_TOOLTIP =
  'Tribute tokens stack here until you tap Collect. Each one becomes one random skill token (e.g. Crime XP, GTA XP, melt, travel — see token list in help).';

// Display name for city (avoid showing raw "Start")
function cityDisplayName(city) {
  return city === 'Start' ? 'Starting City' : (city || '—');
}

// Token type labels for display
const TOKEN_LABELS = {
  xp_crimes: 'Crime XP',
  xp_gta: 'GTA XP',
  melt: 'Melt',
  oc_reduced: 'OC Reduced',
  booze: 'Booze',
  racket: 'Racket',
  travel: 'Travel',
  properties: 'Properties',
  jailbust_bonus: 'Jailbust'
};

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function difficultyStars(d) {
  // 1 star ≤4, 2 stars ≤7, 3 stars 8+
  return d >= 8 ? 3 : d >= 5 ? 2 : 1;
}

function missionTypeLabel(type) {
  const map = {
    crime_count: 'Crimes',
    money_earned: 'Earnings',
    crime_profit: 'Crime Profit',
    hitlist_npc_kills: 'Hitlist Kills',
    gta_count: 'Car Theft',
    gta: 'Car Theft',
    jail_busts: 'Jail Busts',
    booze_sells: 'Booze Runs',
    rank: 'Rank',
    special: 'Final Job',
    starter: 'Intro',
  };
  return map[type] || type;
}

// ─────────────────────────────────────────────────────────────────────────────
// SMALL COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

function DifficultyStars({ difficulty, size = 11 }) {
  const filled = difficultyStars(difficulty);
  return (
    <span style={{ display: 'inline-flex', gap: 2 }}>
      {[0, 1, 2].map(i => (
        <Crown
          key={i}
          size={size}
          fill={i < filled ? '#eab308' : 'none'}
          color={i < filled ? '#eab308' : 'rgba(113,113,122,0.5)'}
        />
      ))}
    </span>
  );
}

function ProgressBar({ current, target, color = '#eab308', thick = false }) {
  const pct = target > 0 ? Math.min(100, (current / target) * 100) : 100;
  const h = thick ? 8 : 5;
  return (
    <div style={{
      width: '100%', height: h, borderRadius: thick ? 6 : 4,
      background: 'rgba(63,63,70,0.6)', overflow: 'hidden',
    }}>
      <div
        className="progress-bar-fill"
        style={{
          '--target-w': `${pct}%`,
          height: '100%', borderRadius: 4,
          background: pct >= 100
            ? 'linear-gradient(90deg,#16a34a,#4ade80)'
            : `linear-gradient(90deg, ${color}99, ${color})`,
          boxShadow: pct >= 100 ? '0 0 6px rgba(74,222,128,0.4)' : `0 0 5px ${color}55`,
          width: `${pct}%`,
        }}
      />
    </div>
  );
}

function StatusChip({ completed, requirementsMet, isBoss, unlocked, size = 'sm' }) {
  const isLg = size === 'lg';
  const chip = isLg ? 'px-2.5 py-1 text-[10px]' : 'px-1.5 py-0.5 text-[9px]';
  const icon = isLg ? 11 : 9;
  if (completed) return (
    <span className={`inline-flex items-center gap-1 rounded-full bg-green-500/10 border border-green-500/40 text-green-400 font-heading font-bold uppercase tracking-wide ${chip}`}>
      <CheckCircle size={icon} /> Done
    </span>
  );
  if (!unlocked) return (
    <span className={`inline-flex items-center gap-1 rounded-full bg-zinc-800/50 border border-zinc-600/50 text-mutedForeground font-heading font-bold uppercase tracking-wide ${chip}`}>
      <Lock size={icon} /> Locked
    </span>
  );
  if (!requirementsMet) return (
    <span className={`inline-flex items-center gap-1 rounded-full bg-zinc-800/50 border border-zinc-600/50 text-mutedForeground font-heading font-bold uppercase tracking-wide ${chip}`}>
      In progress
    </span>
  );
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border font-heading font-bold uppercase tracking-wide ${chip} ${isBoss ? 'bg-primary/15 border-primary/70 text-primary' : 'bg-primary/10 border-primary/40 text-primary'}`}>
      <Star size={icon} fill="currentColor" /> Ready
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FOCUS CARDS – current + next only (readable, spacious)
// ─────────────────────────────────────────────────────────────────────────────

function MissionFocusCard({ mission, role, missionIndex, missionTotal, onOpen, delay = 0 }) {
  const {
    completed, requirements_met, is_boss, progress, difficulty, title, type,
    reward_money, reward_points, reward_respect, reward_tribute,
    unlocked, previous_mission_title, area, description,
  } = mission;
  const isCurrent = role === 'current';
  const reqParts = progress?.description ? String(progress.description).split(' · ').filter(Boolean) : [];

  const borderCls = isCurrent
    ? 'border-primary/55 ring-1 ring-primary/20 shadow-[0_0_32px_rgba(234,179,8,0.07)]'
    : !unlocked
    ? 'border-zinc-600/45 opacity-95'
    : 'border-primary/25';

  const bgCls = isCurrent
    ? 'bg-gradient-to-b from-primary/[0.09] to-zinc-900/40'
    : !unlocked
    ? 'bg-zinc-900/35'
    : 'bg-zinc-800/40';

  return (
    <button
      type="button"
      className={`m-fade-in m-focus-card text-left w-full rounded-xl border px-4 py-4 md:px-5 md:py-5 min-h-[200px] flex flex-col ${borderCls} ${bgCls} cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950`}
      style={{ animationDelay: `${delay}s` }}
      onClick={() => onOpen(mission)}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 mb-1.5">
            {missionIndex != null && missionTotal != null && (
              <span className="text-[11px] md:text-xs font-heading font-bold text-primary/90 tabular-nums">
                {missionIndex}/{missionTotal}
              </span>
            )}
            {is_boss && <Skull size={16} className="text-primary shrink-0" />}
            {isCurrent && !completed && unlocked && (
              <span className="px-2 py-0.5 rounded-md bg-primary/20 border border-primary/45 text-[10px] font-heading font-bold text-primary uppercase tracking-wider">
                Current
              </span>
            )}
            {!isCurrent && (
              <span className="px-2 py-0.5 rounded-md bg-zinc-800/80 border border-zinc-600/60 text-[10px] font-heading font-bold text-mutedForeground uppercase tracking-wider">
                Up next
              </span>
            )}
          </div>
          <h3 className={`font-heading font-bold text-base md:text-lg leading-tight ${completed ? 'text-green-400' : unlocked ? 'text-foreground' : 'text-zinc-300'}`}>
            {title}
          </h3>
          <p className="text-[11px] md:text-xs text-mutedForeground mt-1">
            {area} · {missionTypeLabel(type)}{is_boss ? ' · Final job' : ''}
          </p>
        </div>
        <div className="shrink-0">
          <StatusChip completed={completed} requirementsMet={requirements_met} isBoss={is_boss} unlocked={unlocked} size="lg" />
        </div>
      </div>

      {!unlocked && previous_mission_title && (
        <div className="flex items-start gap-2 text-[11px] text-amber-200/85 mb-3">
          <Lock size={14} className="shrink-0 mt-0.5" />
          <span>Complete &quot;{previous_mission_title}&quot; to unlock.</span>
        </div>
      )}

      {unlocked && !completed && progress?.target > 0 && (
        <div className="mb-3 min-w-0 rounded-lg border border-zinc-700/50 bg-zinc-800/80 p-1">
          <ProgressBar current={progress.current} target={progress.target} thick />
        </div>
      )}

      {reqParts.length > 0 && !completed && unlocked && (
        <ul className="mb-3 space-y-1.5 text-[11px] md:text-xs text-zinc-300 flex-1">
          {reqParts.map((line, i) => (
            <li key={i} className="flex gap-2.5 leading-snug">
              <span className="text-primary/60 shrink-0 font-bold">·</span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      )}

      {isCurrent && description && (
        <p className="text-[11px] md:text-xs text-mutedForeground italic leading-relaxed mb-3 line-clamp-4">
          {description}
        </p>
      )}

      <div className="mt-auto pt-3 border-t border-zinc-700/40 flex flex-wrap items-center gap-x-3 gap-y-2 text-[11px] md:text-xs">
        {reward_money > 0 && (
          <span className="inline-flex items-center gap-1 text-green-400 font-medium">
            <Coins size={13} /> {fmt(reward_money)}
          </span>
        )}
        {reward_points > 0 && (
          <span className="inline-flex items-center gap-1 text-primary font-medium">
            <Star size={13} /> {reward_points} RP
          </span>
        )}
        {reward_respect > 0 && (
          <span className="inline-flex items-center gap-1 text-fuchsia-400 font-medium">
            +{reward_respect} resp
          </span>
        )}
        {reward_tribute > 0 && (
          <span className="inline-flex items-center gap-1 text-green-500/95 font-medium">
            +{fmt(reward_tribute)} tribute
          </span>
        )}
        {(mission.reward_tribute_daily > 0) && (
          <span className="inline-flex items-center gap-1 text-green-400/90 font-medium">{fmt(mission.reward_tribute_daily)}/day</span>
        )}
        {(mission.reward_respect_daily > 0) && (
          <span className="inline-flex items-center gap-1 text-fuchsia-400/90 font-medium">+{mission.reward_respect_daily} resp/day</span>
        )}
        {mission.unlocks_city && (
          <span className="inline-flex items-center gap-1 text-violet-400 font-medium">
            <MapPin size={13} /> Unlocks {mission.unlocks_city}
          </span>
        )}
        <span className="ml-auto">
          <DifficultyStars difficulty={difficulty} size={14} />
        </span>
      </div>
    </button>
  );
}

function MissionFocusSection({
  cityLabel,
  currentMission,
  nextMission,
  missionIdToIndex,
  orderedTotal,
  completedCount,
  onOpen,
}) {
  const allDone = !currentMission && orderedTotal > 0 && completedCount >= orderedTotal;

  return (
    <div className={`relative ${styles.panel} rounded-xl overflow-hidden border border-primary/25 m-fade-in mobile-panel shadow-lg shadow-black/20`}>
      <div className="h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
      <div className="px-4 py-3 md:px-5 md:py-3.5 bg-gradient-to-r from-primary/[0.12] to-transparent border-b border-primary/20 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Zap size={16} className="text-primary shrink-0" />
          <span className="text-[11px] md:text-xs font-heading font-bold text-primary uppercase tracking-[0.14em]">
            Mission ladder
          </span>
          <span className="text-mutedForeground hidden sm:inline">·</span>
          <span className="text-[11px] text-mutedForeground truncate">{cityLabel}</span>
        </div>
        <span className="text-[11px] md:text-xs font-heading font-bold text-foreground tabular-nums">
          {currentMission && missionIdToIndex[currentMission.id]
            ? `Mission ${missionIdToIndex[currentMission.id].index} of ${orderedTotal}`
            : `Progress ${completedCount} / ${orderedTotal}`}
        </span>
      </div>

      <div className="p-4 md:p-5">
        {allDone ? (
          <div className="rounded-xl border border-green-500/35 bg-green-500/[0.06] px-5 py-8 text-center">
            <CheckCircle size={36} className="text-green-400 mx-auto mb-3 opacity-90" />
            <p className="font-heading font-bold text-green-400 text-lg">City cleared</p>
            <p className="text-sm text-mutedForeground mt-2">Every mission in {cityLabel} is complete.</p>
          </div>
        ) : (
          <div className={`grid gap-4 md:gap-5 ${nextMission ? 'md:grid-cols-2' : 'md:grid-cols-1 max-w-xl mx-auto'}`}>
            {currentMission && (
              <MissionFocusCard
                mission={currentMission}
                role="current"
                missionIndex={missionIdToIndex[currentMission.id]?.index}
                missionTotal={missionIdToIndex[currentMission.id]?.total}
                onOpen={onOpen}
                delay={0.05}
              />
            )}
            {nextMission && (
              <MissionFocusCard
                mission={nextMission}
                role="next"
                missionIndex={missionIdToIndex[nextMission.id]?.index}
                missionTotal={missionIdToIndex[nextMission.id]?.total}
                onOpen={onOpen}
                delay={0.1}
              />
            )}
          </div>
        )}
      </div>
      <div className="m-art-line text-primary mx-4 md:mx-5" />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MISSION DETAIL MODAL
// ─────────────────────────────────────────────────────────────────────────────

function MissionModal({ mission, onClose, onComplete, completing }) {
  if (!mission) return null;
  const { completed, requirements_met, is_boss, progress, difficulty, unlocked, previous_mission_title } = mission;
  const canComplete = !completed && requirements_met && unlocked;
  const stars = difficultyStars(difficulty);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className={`m-scale-in ${styles.panel} w-full max-w-[480px] max-h-[88vh] overflow-y-auto rounded-lg border ${is_boss ? 'border-primary/50' : 'border-primary/20'}`}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          padding: '12px 14px',
          background: is_boss ? 'rgba(234,179,8,0.08)' : 'rgba(234,179,8,0.05)',
          borderBottom: `1px solid ${is_boss ? 'rgba(234,179,8,0.3)' : 'rgba(63,63,70,0.5)'}`,
          display: 'flex', alignItems: 'flex-start', gap: 8,
        }}>
          <div style={{ flex: 1 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 2,
            }}>
              {is_boss && <Skull size={14} style={{ color: '#eab308' }} />}
              <span
                className={canComplete && is_boss ? 'shimmer-gold' : ''}
                style={{
                  fontFamily: "'Cormorant Garamond', serif",
                  fontSize: '1.1rem', fontWeight: 700,
                  color: completed ? '#4ade80' : '#f4f4f5',
                }}
              >
                {mission.title}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{
                fontFamily: "'Crimson Text', serif", fontStyle: 'italic',
                fontSize: '0.78rem', color: '#71717a',
              }}>
                {mission.area} · {mission.city}
                {is_boss && ' · Boss Mission'}
              </span>
              <DifficultyStars difficulty={difficulty} />
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              padding: 4, background: 'transparent', border: '1px solid rgba(63,63,70,0.6)',
              borderRadius: 5, color: '#71717a', cursor: 'pointer', lineHeight: 0,
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = '#eab308'; e.currentTarget.style.color = '#eab308'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(63,63,70,0.6)'; e.currentTarget.style.color = '#71717a'; }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '14px' }}>
          {/* Description */}
          <p style={{
            fontFamily: "'Crimson Text', serif",
            fontSize: '0.95rem', lineHeight: 1.6, color: '#a1a1aa',
            marginBottom: 14,
            paddingLeft: 10,
            borderLeft: `3px solid ${is_boss ? 'rgba(234,179,8,0.6)' : 'rgba(234,179,8,0.3)'}`,
            fontStyle: 'italic',
          }}>
            {mission.description}
          </p>

          {/* Progress */}
          {!completed && progress && (
            <div style={{
              padding: '10px 12px', borderRadius: 7,
              background: 'rgba(24,24,27,0.6)',
              border: '1px solid rgba(63,63,70,0.5)',
              marginBottom: 12,
            }}>
              <div style={{
                fontSize: '0.68rem', fontWeight: 700, color: '#eab308',
                textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6,
              }}>
                Progress
              </div>
              {progress.target > 0 && (
                <>
                  <ProgressBar current={progress.current} target={progress.target} />
                  <div style={{ fontSize: '0.75rem', color: '#a1a1aa', marginTop: 5, fontFamily: "'Crimson Text', serif" }}>
                    {progress.description}
                  </div>
                </>
              )}
              {!unlocked && previous_mission_title && (
                <div className="flex items-start gap-1.5 mt-2 p-2 rounded bg-amber-500/10 border border-amber-500/20">
                  <Lock size={12} className="text-amber-400 shrink-0 mt-0.5" />
                  <span className="text-[10px] text-amber-200/90">Complete &quot;{previous_mission_title}&quot; to unlock this mission.</span>
                </div>
              )}
              {unlocked && !requirements_met && is_boss && (
                <div className="flex items-start gap-1.5 mt-2 p-2 rounded bg-primary/10 border border-primary/20">
                  <AlertCircle size={12} className="text-primary shrink-0 mt-0.5" />
                  <span className="text-[10px] text-primary/90">Complete the district missions first. The boss doesn&apos;t see just anyone.</span>
                </div>
              )}
            </div>
          )}

          {/* Rewards */}
          <div style={{
            borderRadius: 7,
            border: '1px solid rgba(63,63,70,0.5)',
            overflow: 'hidden',
            marginBottom: 12,
          }}>
            <div style={{
              padding: '6px 12px',
              background: 'rgba(39,39,42,0.5)',
              borderBottom: '1px solid rgba(63,63,70,0.4)',
              fontSize: '0.68rem', fontWeight: 700, color: '#71717a',
              textTransform: 'uppercase', letterSpacing: '0.07em',
            }}>
              Rewards
            </div>
            <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 5 }}>
              {mission.reward_money > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
                  <span style={{ color: '#71717a', display: 'flex', alignItems: 'center', gap: 5 }}>
                    <Banknote size={12} /> Tribute bank
                  </span>
                  <span style={{ color: '#4ade80', fontWeight: 700 }}>{fmt(mission.reward_money)}</span>
                </div>
              )}
              {mission.reward_cash_immediate > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
                  <span style={{ color: '#71717a', display: 'flex', alignItems: 'center', gap: 5 }}>
                    <Banknote size={12} /> Cash (immediate)
                  </span>
                  <span style={{ color: '#4ade80', fontWeight: 700 }}>{fmt(mission.reward_cash_immediate)}</span>
                </div>
              )}
              {mission.reward_tribute_daily > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
                  <span style={{ color: '#71717a', display: 'flex', alignItems: 'center', gap: 5 }}>
                    <Banknote size={12} /> Tribute bank (daily)
                  </span>
                  <span style={{ color: '#4ade80', fontWeight: 700 }}>{fmt(mission.reward_tribute_daily)}/day</span>
                </div>
              )}
              {(mission.reward_respect_daily > 0) && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
                  <span style={{ color: '#71717a' }}>Respect (daily)</span>
                  <span style={{ color: '#c084fc', fontWeight: 700 }}>+{mission.reward_respect_daily}/day</span>
                </div>
              )}
              {mission.reward_points > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
                  <span style={{ color: '#71717a', display: 'flex', alignItems: 'center', gap: 5 }}>
                    <Star size={12} /> Rank points
                  </span>
                  <span style={{ color: '#eab308', fontWeight: 700 }}>+{mission.reward_points} RP</span>
                </div>
              )}
              {(mission.reward_respect > 0) && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
                  <span style={{ color: '#71717a' }}>Respect</span>
                  <span style={{ color: '#c084fc', fontWeight: 700 }}>+{mission.reward_respect}</span>
                </div>
              )}
              {(mission.reward_tribute > 0) && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
                  <span style={{ color: '#71717a', display: 'flex', alignItems: 'center', gap: 5 }}>
                    <Banknote size={12} /> Tribute (on complete)
                  </span>
                  <span style={{ color: '#4ade80', fontWeight: 700 }}>{fmt(mission.reward_tribute)}</span>
                </div>
              )}
              {mission.reward_bullets > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
                  <span style={{ color: '#71717a' }}>Ammo</span>
                  <span style={{ color: '#f87171', fontWeight: 700 }}>+{mission.reward_bullets} bullets</span>
                </div>
              )}
              {(mission.reward_car_id || (mission.reward_car_ids && mission.reward_car_ids.length > 0)) && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
                  <span style={{ color: '#71717a' }}>Vehicle{mission.reward_car_ids?.length > 1 ? 's' : ''}</span>
                  <span style={{ color: '#60a5fa', fontWeight: 700 }}>
                    {mission.reward_car_ids?.length ? `${mission.reward_car_ids.length} cars` : 'Car reward'}
                  </span>
                </div>
              )}
              {mission.reward_tribute_bullets_daily > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
                  <span style={{ color: '#71717a' }}>Tribute bullets (daily)</span>
                  <span style={{ color: '#f87171', fontWeight: 700 }}>+{mission.reward_tribute_bullets_daily}/day</span>
                </div>
              )}
              {mission.reward_loot_box_pieces > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
                  <span style={{ color: '#71717a' }}>Loot box pieces</span>
                  <span style={{ color: '#a78bfa', fontWeight: 700 }}>+{mission.reward_loot_box_pieces} <Link to="/loot-box" style={{ color: '#a78bfa', textDecoration: 'underline' }}>Loot Box</Link></span>
                </div>
              )}
              {mission.reward_booze && Object.keys(mission.reward_booze).length > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
                  <span style={{ color: '#71717a' }}>Booze</span>
                  <span style={{ color: '#c084fc', fontWeight: 700 }}>
                    {Object.entries(mission.reward_booze).map(([k, v]) => `${v}x ${k.replace(/_/g, ' ')}`).join(', ')}
                  </span>
                </div>
              )}
              {mission.unlocks_city && (
                <div style={{
                  display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem',
                  marginTop: 3, paddingTop: 6, borderTop: '1px solid rgba(63,63,70,0.4)',
                }}>
                  <span style={{ color: '#71717a', display: 'flex', alignItems: 'center', gap: 5 }}>
                    <MapPin size={12} /> Unlocks city
                  </span>
                  <span style={{ color: '#a78bfa', fontWeight: 700 }}>{mission.unlocks_city}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Action */}
        <div style={{ padding: '0 14px 14px' }}>
          {completed ? (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              padding: '9px', borderRadius: 7,
              background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.3)',
              color: '#4ade80', fontWeight: 700, fontSize: '0.85rem',
            }}>
              <CheckCircle size={14} /> Mission complete
            </div>
          ) : canComplete ? (
            <button
              onClick={() => onComplete(mission.id)}
              disabled={completing}
              style={{
                width: '100%', padding: '10px',
                background: is_boss
                  ? 'linear-gradient(135deg, rgba(234,179,8,0.2), rgba(161,98,7,0.2))'
                  : 'rgba(234,179,8,0.12)',
                border: `1px solid ${is_boss ? '#eab308' : 'rgba(234,179,8,0.5)'}`,
                borderRadius: 7,
                color: '#eab308', fontWeight: 700, fontSize: '0.88rem',
                fontFamily: "'Cormorant Garamond', serif",
                letterSpacing: '0.05em',
                cursor: completing ? 'not-allowed' : 'pointer',
                opacity: completing ? 0.65 : 1,
                transition: 'all 0.2s',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                boxShadow: is_boss ? '0 0 16px rgba(234,179,8,0.1)' : 'none',
              }}
              onMouseEnter={e => {
                if (!completing) e.currentTarget.style.background = is_boss
                  ? 'linear-gradient(135deg, rgba(234,179,8,0.28), rgba(161,98,7,0.28))'
                  : 'rgba(234,179,8,0.2)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = is_boss
                  ? 'linear-gradient(135deg, rgba(234,179,8,0.2), rgba(161,98,7,0.2))'
                  : 'rgba(234,179,8,0.12)';
              }}
            >
              {completing
                ? 'Completing…'
                : is_boss
                ? <><Skull size={14} /> Complete Final Job</>
                : 'Complete Mission'
              }
            </button>
          ) : (
            <div className="flex items-center justify-center gap-2 py-2 px-3 rounded-md bg-zinc-800/50 border border-zinc-600/50 text-mutedForeground text-[10px]">
              {!unlocked && previous_mission_title ? (
                <><Lock size={12} /> Complete &quot;{previous_mission_title}&quot; first</>
              ) : (
                <><Lock size={12} /> Requirements not yet met</>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TRIBUTE BANNER
// ─────────────────────────────────────────────────────────────────────────────

function formatTimeUntil(isoString) {
  if (!isoString) return null;
  const at = new Date(isoString);
  const now = new Date();
  const ms = at - now;
  if (ms <= 0) return 'soon';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `in ${d}d ${h % 24}h`;
  if (h > 0) return `in ${h}h ${m % 60}m`;
  if (m > 0) return `in ${m}m`;
  return 'in <1m';
}

function RewardBadge({ icon: Icon, value, label, color, bgColor, title }) {
  if (!value || value <= 0) return null;
  return (
    <span
      title={title || undefined}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded ${bgColor} border ${color} ${title ? 'cursor-help' : ''}`}
    >
      <Icon size={10} className={color.replace('border-', 'text-').replace('/30', '')} />
      <span className={`text-[10px] font-heading font-bold ${color.replace('border-', 'text-').replace('/30', '')}`}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </span>
      {label && <span className="text-[9px] text-mutedForeground">{label}</span>}
    </span>
  );
}

function TributeBanner({
  bank,
  tributeBullets = 0,
  tributeLootBoxPieces = 0,
  tributeRespect = 0,
  tributeTokens = 0,
  onCollect,
  collecting,
  tributeDepositDailyAt,
  nextTributeDepositAt,
  dailyCashBase = 500,
  dailyLootBase = 1,
  dailyTokensTotal = 0,
  dailyTributeCashTotal,
  dailyTributeBulletsTotal,
  dailyTributeRespectTotal,
  dailyTributeLootTotal,
  dailyTributeAutoRank2hTokens = 0,
  completedItDailyTokensPerk = false,
  hasMission1Bonus = false,
  dailyCashMission1 = 0,
  dailyBulletsMission1 = 0,
  dailyRespectMission1 = 0,
  hasMission2Bonus = false,
  dailyCashMission2 = 0,
  dailyBulletsMission2 = 0,
  dailyRespectMission2 = 0,
  dailyLootMission2 = 0,
  hasMission3Bonus = false,
  dailyCashMission3 = 0,
  dailyBulletsMission3 = 0,
  dailyRespectMission3 = 0,
  hasMission4Bonus = false,
  dailyCashMission4 = 0,
  dailyBulletsMission4 = 0,
  dailyRespectMission4 = 0,
}) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!nextTributeDepositAt) return;
    const id = setInterval(() => setTick((t) => t + 1), 60 * 1000);
    return () => clearInterval(id);
  }, [nextTributeDepositAt]);
  const hasBank = bank > 0;
  const hasBullets = (tributeBullets || 0) > 0;
  const hasLootPieces = (tributeLootBoxPieces || 0) > 0;
  const hasRespect = (tributeRespect || 0) > 0;
  const hasTokens = (tributeTokens || 0) > 0;
  const hasAny = hasBank || hasBullets || hasLootPieces || hasRespect || hasTokens;
  const nextIn = nextTributeDepositAt ? formatTimeUntil(nextTributeDepositAt) : null;
  const legacyDailyCash =
    dailyCashBase + (hasMission1Bonus ? dailyCashMission1 : 0) + (hasMission2Bonus ? dailyCashMission2 : 0) + (hasMission3Bonus ? dailyCashMission3 : 0) + (hasMission4Bonus ? dailyCashMission4 : 0);
  const legacyDailyBullets =
    (hasMission1Bonus ? dailyBulletsMission1 : 0) + (hasMission2Bonus ? dailyBulletsMission2 : 0) + (hasMission3Bonus ? dailyBulletsMission3 : 0) + (hasMission4Bonus ? dailyBulletsMission4 : 0);
  const legacyDailyRespect =
    (hasMission1Bonus ? dailyRespectMission1 : 0) + (hasMission2Bonus ? dailyRespectMission2 : 0) + (hasMission3Bonus ? dailyRespectMission3 : 0) + (hasMission4Bonus ? dailyRespectMission4 : 0);
  const legacyDailyLoot = dailyLootBase + (hasMission2Bonus ? dailyLootMission2 : 0);
  const dailyTotalCash = typeof dailyTributeCashTotal === 'number' ? dailyTributeCashTotal : legacyDailyCash;
  const dailyTotalBullets = typeof dailyTributeBulletsTotal === 'number' ? dailyTributeBulletsTotal : legacyDailyBullets;
  const dailyTotalRespect = typeof dailyTributeRespectTotal === 'number' ? dailyTributeRespectTotal : legacyDailyRespect;
  const dailyTotalLoot = typeof dailyTributeLootTotal === 'number' ? dailyTributeLootTotal : legacyDailyLoot;
  const missionHints = [
    { n: 2, has: hasMission2Bonus, cash: dailyCashMission2, bullets: dailyBulletsMission2, respect: dailyRespectMission2, loot: dailyLootMission2 },
    { n: 3, has: hasMission3Bonus, cash: dailyCashMission3, bullets: dailyBulletsMission3, respect: dailyRespectMission3 },
    { n: 4, has: hasMission4Bonus, cash: dailyCashMission4, bullets: dailyBulletsMission4, respect: dailyRespectMission4 },
  ].filter((m) => !m.has && (m.cash > 0 || m.bullets > 0 || m.respect > 0 || (m.loot || 0) > 0));

  return (
    <div className={`relative ${styles.panel} rounded-md overflow-hidden border m-fade-in mobile-panel ${hasAny ? 'border-green-500/30' : 'border-primary/20'}`} style={{ animationDelay: '0.05s' }}>
      <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      
      {/* Header */}
      <div className={`px-2.5 py-1.5 border-b flex items-center justify-between ${hasAny ? 'border-green-500/20 bg-green-500/8' : 'border-primary/20 bg-primary/8'}`}>
        <div className="flex items-center gap-2">
          <Banknote size={14} className={hasAny ? 'text-green-400' : 'text-primary'} />
          <span className={`text-[9px] font-heading font-bold uppercase tracking-[0.12em] ${hasAny ? 'text-green-400' : 'text-primary'}`}>
            Tribute Bank
          </span>
        </div>
        <button
          type="button"
          onClick={onCollect}
          disabled={!hasAny || collecting}
          className={`px-3 py-1 rounded text-[10px] font-heading font-bold uppercase border transition-all ${hasAny && !collecting ? 'bg-green-500/20 border-green-500/40 text-green-400 hover:bg-green-500/30 hover:scale-105 cursor-pointer' : 'bg-zinc-800/50 border-zinc-600 text-mutedForeground cursor-not-allowed'} ${collecting ? 'opacity-60' : ''}`}
        >
          {collecting ? 'Collecting…' : 'Collect'}
        </button>
      </div>

      <div className="p-2.5 space-y-3">
        {/* Current Balance */}
        <div className={`p-2 rounded-md border ${hasAny ? 'border-green-500/20 bg-green-500/5' : 'border-zinc-700/50 bg-zinc-800/30'}`}>
          <div className="text-[9px] font-heading text-mutedForeground uppercase tracking-wider mb-0.5">Available to Collect</div>
          <p className="text-[8px] text-mutedForeground/90 leading-snug mb-1.5">
            Stacked in the bank until you tap Collect — not added to cash, bullets, or respect until then.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <span
              title="Goes to your cash balance when you Collect."
              className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md ${hasBank ? 'bg-green-500/15 border border-green-500/30' : 'bg-zinc-800/50 border border-zinc-700/50'} ${hasBank ? 'cursor-help' : ''}`}
            >
              <Coins size={14} className={hasBank ? 'text-green-400' : 'text-zinc-500'} />
              <span className={`text-base font-heading font-bold ${hasBank ? 'text-green-400' : 'text-zinc-500'}`}>{fmt(bank)}</span>
            </span>
            {hasBullets && (
              <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-red-500/15 border border-red-500/30">
                <AlertCircle size={14} className="text-red-400" />
                <span className="text-base font-heading font-bold text-red-400">{tributeBullets.toLocaleString()}</span>
                <span className="text-[10px] text-red-400/80">bullets</span>
              </span>
            )}
            {hasRespect && (
              <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-fuchsia-500/15 border border-fuchsia-500/30">
                <Crown size={14} className="text-fuchsia-400" />
                <span className="text-base font-heading font-bold text-fuchsia-400">{tributeRespect}</span>
                <span className="text-[10px] text-fuchsia-400/80">respect</span>
              </span>
            )}
            {hasLootPieces && (
              <span
                title={LOOT_BOX_PIECES_TOOLTIP}
                className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-violet-500/15 border border-violet-500/30 cursor-help"
              >
                <Star size={14} className="text-violet-400" />
                <span className="text-base font-heading font-bold text-violet-400">{tributeLootBoxPieces}</span>
                <span className="text-[10px] text-violet-400/80 max-w-[7.5rem] leading-tight">
                  loot box pieces
                </span>
              </span>
            )}
            {hasTokens && (
              <span
                title={TRIBUTE_BANK_TOKEN_TOOLTIP}
                className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-amber-500/15 border border-amber-500/30 cursor-help"
              >
                <Zap size={14} className="text-amber-400" />
                <span className="text-base font-heading font-bold text-amber-400">{tributeTokens}</span>
                <span className="text-[10px] text-amber-400/80">random token rolls</span>
              </span>
            )}
            {!hasAny && (
              <span className="text-[10px] text-zinc-500 italic">Nothing to collect yet</span>
            )}
          </div>
        </div>

        {/* Daily Deposits Info */}
        <div className="p-2 rounded-md border border-primary/20 bg-primary/5">
          <div className="flex items-center justify-between gap-2 mb-1">
            <div className="text-[9px] font-heading text-primary uppercase tracking-wider flex items-center gap-1">
              <Clock size={10} />
              Your Next Daily Deposit
            </div>
            {tributeDepositDailyAt && (
              <span className="text-[9px] text-mutedForeground shrink-0">at {tributeDepositDailyAt}</span>
            )}
          </div>
          <p className="text-[8px] text-mutedForeground leading-snug mb-2">
            Totals below match every mission you&apos;ve completed — all of this is added into the tribute bank each day (same time UTC), then stacks until you Collect.
          </p>

          <div className="flex flex-wrap items-center gap-1.5">
            <RewardBadge icon={Coins} value={fmt(dailyTotalCash)} title="Cash into tribute bank daily" color="border-green-500/30" bgColor="bg-green-500/10" />
            {dailyTotalBullets > 0 && (
              <RewardBadge icon={AlertCircle} value={dailyTotalBullets} label="bullets" title="Bullets into tribute bank daily" color="border-red-500/30" bgColor="bg-red-500/10" />
            )}
            {dailyTotalRespect > 0 && (
              <RewardBadge icon={Crown} value={dailyTotalRespect} label="respect" title="Respect into tribute bank daily" color="border-fuchsia-500/30" bgColor="bg-fuchsia-500/10" />
            )}
            {dailyTotalLoot > 0 && (
              <RewardBadge
                icon={Star}
                value={dailyTotalLoot}
                label="loot box pcs"
                title={LOOT_BOX_PIECES_TOOLTIP}
                color="border-violet-500/30"
                bgColor="bg-violet-500/10"
              />
            )}
            {dailyTokensTotal > 0 && (
              <RewardBadge
                icon={Zap}
                value={dailyTokensTotal}
                label="random token rolls"
                title={TRIBUTE_BANK_TOKEN_TOOLTIP}
                color="border-amber-500/30"
                bgColor="bg-amber-500/10"
              />
            )}
          </div>
          {dailyTributeAutoRank2hTokens > 0 && (
            <p className="text-[8px] text-sky-400/95 mt-1.5 leading-snug">
              +{dailyTributeAutoRank2hTokens} auto-rank 2h token{dailyTributeAutoRank2hTokens === 1 ? '' : 's'}/day — credited straight to your Auto-rank 2h balance (not stored in tribute).
            </p>
          )}
          {completedItDailyTokensPerk && (
            <p className="text-[8px] text-emerald-400/90 mt-1 leading-snug">
              Completed It perk: +5 of each skill token type daily — added straight to your token balances (not tribute).
            </p>
          )}

          <div className="text-[8px] text-mutedForeground mt-1.5 italic flex items-center gap-1">
            <AlertCircle size={8} />
            Tribute bank rewards stack until you collect; direct perks bypass the bank.
          </div>
          {dailyTotalLoot > 0 && (
            <p className="text-[8px] text-violet-400/90 mt-1 leading-snug" title={LOOT_BOX_PIECES_TOOLTIP}>
              Loot box pieces stack here; spend {LOOT_BOX_PIECES_PER_OPEN} on the{' '}
              <Link to="/loot-box" className="text-violet-300 underline underline-offset-2 hover:text-violet-200">
                Loot Box
              </Link>{' '}
              page for a random drop.
            </p>
          )}
        </div>

        {/* Mission Unlock Hints */}
        {missionHints.length > 0 && (
          <div className="space-y-1">
            <div className="text-[9px] font-heading text-mutedForeground uppercase tracking-wider">Unlock More Rewards</div>
            {missionHints.map((m) => (
              <div key={m.n} className="flex items-center gap-2 p-1.5 rounded border border-zinc-700/50 bg-zinc-800/30">
                <span className="text-[9px] font-heading text-primary shrink-0">Mission {m.n}</span>
                <ChevronRight size={10} className="text-zinc-600" />
                <div className="flex flex-wrap items-center gap-1">
                  {m.cash > 0 && (
                    <span className="inline-flex items-center gap-0.5 text-[9px] text-green-400">
                      <Coins size={9} />+{fmt(m.cash)}
                    </span>
                  )}
                  {m.bullets > 0 && (
                    <span className="inline-flex items-center gap-0.5 text-[9px] text-red-400">
                      <AlertCircle size={9} />+{m.bullets}
                    </span>
                  )}
                  {m.respect > 0 && (
                    <span className="inline-flex items-center gap-0.5 text-[9px] text-fuchsia-400">
                      <Crown size={9} />+{m.respect}
                    </span>
                  )}
                  {(m.loot || 0) > 0 && (
                    <span
                      className="inline-flex items-center gap-0.5 text-[9px] text-violet-400 cursor-help"
                      title={LOOT_BOX_PIECES_TOOLTIP}
                    >
                      <Star size={9} />+{m.loot}{' '}
                      <span className="text-violet-400/85">loot box pcs</span>
                    </span>
                  )}
                  <span className="text-[8px] text-zinc-500">/day</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Next Deposit Timer */}
        {nextIn && (
          <div className="flex items-center justify-center gap-2 py-1.5 px-2 rounded border border-primary/20 bg-primary/5">
            <Clock size={12} className="text-primary" />
            <span className="text-[10px] font-heading text-primary">Next deposit: {nextIn}</span>
          </div>
        )}
      </div>
      
      <div className="m-art-line text-primary mx-2.5" />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export default function Missions() {
  const missionsBoot = readSessionJson(MISSIONS_CACHE_KEY);
  const [data,       setData]       = useState(missionsBoot?.data ?? null);
  const [missions,   setMissions]   = useState(missionsBoot?.missions ?? []);
  const [city,       setCity]       = useState(missionsBoot?.city ?? null);
  const [selected,   setSelected]   = useState(null);   // selected mission object
  const [completing, setCompleting] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false); // toggle completed missions view

  const load = useCallback(async ({ silentError = false } = {}) => {
    try {
      const [mapRes, listRes] = await Promise.all([
        apiRequestWith429Retry(() => api.get('/missions/map')),
        apiRequestWith429Retry(() => api.get('/missions')),
      ]);
      const nextData = mapRes.data;
      const nextMissions = listRes.data?.missions || [];
      const nextCity = city || nextData?.current_city || nextData?.unlocked_cities?.[0] || 'Start';
      setData(nextData);
      setMissions(nextMissions);
      if (!city) setCity(nextCity);
      writeSessionJson(MISSIONS_CACHE_KEY, {
        data: nextData,
        missions: nextMissions,
        city: nextCity,
      });
    } catch {
      if (!silentError) toast.error('Failed to load missions');
    }
  }, [city]);

  useEffect(() => { load({ silentError: false }); }, [load]);

  useEffect(() => {
    const id = setInterval(() => {
      load({ silentError: true });
    }, 60_000);
    return () => clearInterval(id);
  }, [load]);

  const handleComplete = async (missionId) => {
    setCompleting(true);
    try {
      const res = await api.post('/missions/complete', { mission_id: missionId });
      if (res.data?.completed) {
        const parts = [];
        const tributeTotal = (res.data.reward_money || 0) + (res.data.reward_tribute || 0);
        if (tributeTotal > 0) parts.push(`+${fmt(tributeTotal)} tribute`);
        if (res.data.reward_cash_immediate > 0) parts.push(`+${fmt(res.data.reward_cash_immediate)} cash`);
        if (res.data.reward_respect > 0) parts.push(`+${res.data.reward_respect} respect`);
        if (res.data.reward_bullets > 0) parts.push(`+${res.data.reward_bullets} bullets`);
        const carNames = Array.isArray(res.data.reward_car_names) ? res.data.reward_car_names.filter(Boolean) : [];
        if (carNames.length === 1) parts.push(carNames[0]);
        else if (carNames.length > 1) parts.push(carNames.join(', '));
        else {
          if (res.data.reward_car_id) parts.push('1 car');
          if (res.data.reward_car_ids?.length) parts.push(`${res.data.reward_car_ids.length} cars`);
        }
        if (res.data.reward_loot_box_pieces > 0) parts.push(`+${res.data.reward_loot_box_pieces} Loot Box Piece(s)`);
        if (res.data.unlocked_city) parts.push(`${res.data.unlocked_city} unlocked!`);
        toast.success(parts.join(' · ') || 'Mission complete');
        refreshUser();
        await load();
        if (res.data.unlocked_city) {
          setCity(res.data.unlocked_city);
          setSelected(null);
        } else {
          // Refresh the selected mission object from the new missions list
          setSelected(null);
        }
      }
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to complete mission');
    } finally {
      setCompleting(false);
    }
  };

  const handleCollect = async () => {
    const bank = data?.tribute_bank ?? 0;
    const bullets = data?.tribute_bullets ?? 0;
    const lootPieces = data?.tribute_loot_box_pieces ?? 0;
    const respect = data?.tribute_respect ?? 0;
    const tokens = data?.tribute_tokens ?? 0;
    if (bank <= 0 && bullets <= 0 && lootPieces <= 0 && respect <= 0 && tokens <= 0) return;
    setCollecting(true);
    try {
      const res = await api.post('/missions/collect-tribute');
      const collectedCash = res.data?.collected ?? 0;
      const collectedBullets = res.data?.collected_bullets ?? 0;
      const collectedLoot = res.data?.collected_loot_box_pieces ?? 0;
      const collectedRespect = res.data?.collected_respect ?? 0;
      const collectedTokens = res.data?.collected_tokens ?? 0;
      const tokensAwarded = res.data?.tokens_awarded ?? {};
      if (collectedCash > 0 || collectedBullets > 0 || collectedLoot > 0 || collectedRespect > 0 || collectedTokens > 0) {
        const parts = [];
        if (collectedCash > 0) parts.push(`${fmt(collectedCash)} cash`);
        if (collectedBullets > 0) parts.push(`${collectedBullets.toLocaleString()} bullets`);
        if (collectedLoot > 0) parts.push(`${collectedLoot} loot box piece(s)`);
        if (collectedRespect > 0) parts.push(`${collectedRespect} respect`);
        if (collectedTokens > 0) {
          const tokenParts = Object.entries(tokensAwarded)
            .filter(([, count]) => count > 0)
            .map(([type, count]) => `${count} ${TOKEN_LABELS[type] || type}`);
          if (tokenParts.length > 0) {
            parts.push(`${tokenParts.join(', ')} token(s)`);
          } else {
            parts.push(`${collectedTokens} token(s)`);
          }
        }
        toast.success(`Collected ${parts.join(' and ')}`);
        refreshUser();
        const mapRes = await apiRequestWith429Retry(() => api.get('/missions/map'));
        setData(mapRes.data);
      }
    } catch {
      toast.error('Failed to collect tribute');
    } finally {
      setCollecting(false);
    }
  };

  if (!data) {
    return (
      <div className={`space-y-3 ${styles.pageContent} mobile-page-root`} style={{ padding: '12px 14px', maxWidth: 900, margin: '0 auto' }}>
        <style>{MISSIONS_STYLES}</style>
      </div>
    );
  }

  const unlocked = data.unlocked_cities || ['Start'];
  const cityMissions = missions.filter(m => m.city === city);
  const orderedCityMissions = [...cityMissions].sort((a, b) => (a.is_boss ? 1 : 0) - (b.is_boss ? 1 : 0) || a.order - b.order);
  const currentMission = orderedCityMissions.find(m => !m.completed && m.unlocked) ?? null;
  const currentIdx = currentMission
    ? orderedCityMissions.findIndex(m => m.id === currentMission.id)
    : -1;
  const nextMission =
    currentIdx >= 0 && currentIdx + 1 < orderedCityMissions.length
      ? orderedCityMissions[currentIdx + 1]
      : null;
  const missionIdToIndex = {};
  orderedCityMissions.forEach((m, i) => {
    missionIdToIndex[m.id] = { index: i + 1, total: orderedCityMissions.length };
  });

  const bossMissions   = cityMissions.filter(m => m.is_boss);
  const completedMissions = cityMissions.filter(m => m.completed).sort((a, b) => {
    const atA = a.completed_at ? new Date(a.completed_at).getTime() : null;
    const atB = b.completed_at ? new Date(b.completed_at).getTime() : null;
    if (atA != null && atB != null) return atA - atB;
    if (atA != null) return 1;
    if (atB != null) return -1;
    return (a.order ?? 0) - (b.order ?? 0);
  });
  const totalMissions   = cityMissions.length;
  const completedCount  = cityMissions.filter(m => m.completed).length;
  const readyCount      = cityMissions.filter(m => m.requirements_met && !m.completed).length;
  const tributeBank     = data.tribute_bank ?? 0;
  const bossM = bossMissions[0];
  const bossReqCount  = bossM?.progress?.target ?? null;
  const bossDoneCount = bossM?.progress?.current ?? 0;

  // Completed missions view (separate screen to keep main list short)
  if (showCompleted) {
    return (
      <div className={`space-y-3 ${styles.pageContent} mobile-page-root`} style={{ padding: '12px 14px', maxWidth: 900, margin: '0 auto' }}>
        <style>{MISSIONS_STYLES}</style>
        <button
          type="button"
          onClick={() => setShowCompleted(false)}
          className="flex items-center gap-1.5 text-[10px] font-heading text-primary hover:underline"
        >
          <ChevronUp size={14} className="rotate-90" />
          Back to missions
        </button>
        <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-green-500/20 mobile-panel`}>
          <div className="h-px bg-gradient-to-r from-transparent via-green-500/40 to-transparent" />
          <div className="px-2.5 py-1.5 border-b border-green-500/20 flex items-center gap-2 bg-green-500/8">
            <CheckCircle size={12} className="text-green-400" />
            <span className="text-[9px] font-heading font-bold text-green-400 uppercase tracking-[0.1em]">
              Completed missions ({completedMissions.length})
            </span>
          </div>
          <div className="p-2.5 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 gap-2.5 max-h-[70vh] overflow-y-auto">
            {completedMissions.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between gap-2 py-1.5 px-2 rounded border border-green-500/20 bg-green-500/5 cursor-pointer hover:bg-green-500/10 transition-colors"
                onClick={() => { setSelected(m); setShowCompleted(false); }}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-heading font-bold text-green-400 truncate">{m.title}</div>
                  <div className="text-[9px] text-mutedForeground">{m.area}{m.is_boss ? ' · Boss' : ''}</div>
                </div>
                <ChevronRight size={12} className="text-green-400/70 shrink-0" />
              </div>
            ))}
          </div>
          <div className="m-art-line text-primary mx-2.5" />
        </div>
        {selected && (
          <MissionModal
            mission={selected}
            onClose={() => setSelected(null)}
            onComplete={handleComplete}
            completing={completing}
          />
        )}
      </div>
    );
  }

  return (
    <div className={`space-y-3 ${styles.pageContent} mobile-page-root`} style={{ padding: '12px 14px', maxWidth: 900, margin: '0 auto' }}>
      <style>{MISSIONS_STYLES}</style>

      <p className="text-[10px] text-mutedForeground italic">Prove yourself: commit 15 crimes and bust 1 NPC from jail. Earn tribute and claim your reward.</p>

      <TributeBanner
        bank={tributeBank}
        tributeBullets={data?.tribute_bullets ?? 0}
        tributeLootBoxPieces={data?.tribute_loot_box_pieces ?? 0}
        tributeRespect={data?.tribute_respect ?? 0}
        tributeTokens={data?.tribute_tokens ?? 0}
        onCollect={handleCollect}
        collecting={collecting}
        tributeDepositDailyAt={data?.tribute_deposit_daily_at}
        nextTributeDepositAt={data?.next_tribute_deposit_at}
        dailyCashBase={data?.daily_tribute_cash_base ?? 500}
        dailyLootBase={data?.daily_tribute_loot_box_pieces_base ?? 1}
        dailyTokensTotal={data?.daily_tribute_tokens_total ?? 0}
        dailyTributeCashTotal={data?.daily_tribute_cash_total}
        dailyTributeBulletsTotal={data?.daily_tribute_bullets_total}
        dailyTributeRespectTotal={data?.daily_tribute_respect_total}
        dailyTributeLootTotal={data?.daily_tribute_loot_box_pieces_total}
        dailyTributeAutoRank2hTokens={data?.daily_tribute_auto_rank_2h_tokens_total ?? 0}
        completedItDailyTokensPerk={!!data?.completed_it_daily_tokens_perk}
        hasMission1Bonus={!!data?.has_mission_1_bonus}
        dailyCashMission1={data?.daily_tribute_cash_mission1 ?? 0}
        dailyBulletsMission1={data?.daily_tribute_bullets_mission1 ?? 0}
        dailyRespectMission1={data?.daily_respect_mission1 ?? 0}
        hasMission2Bonus={!!data?.has_mission_2_bonus}
        dailyCashMission2={data?.daily_tribute_cash_mission2 ?? 0}
        dailyBulletsMission2={data?.daily_tribute_bullets_mission2 ?? 0}
        dailyRespectMission2={data?.daily_respect_mission2 ?? 0}
        dailyLootMission2={data?.daily_tribute_loot_box_pieces_mission2 ?? 0}
        hasMission3Bonus={!!data?.has_mission_3_bonus}
        dailyCashMission3={data?.daily_tribute_cash_mission3 ?? 0}
        dailyBulletsMission3={data?.daily_tribute_bullets_mission3 ?? 0}
        dailyRespectMission3={data?.daily_respect_mission3 ?? 0}
        hasMission4Bonus={!!data?.has_mission_4_bonus}
        dailyCashMission4={data?.daily_tribute_cash_mission4 ?? 0}
        dailyBulletsMission4={data?.daily_tribute_bullets_mission4 ?? 0}
        dailyRespectMission4={data?.daily_respect_mission4 ?? 0}
      />

      {/* City tabs */}
      {unlocked.length > 1 && (
        <div className="flex gap-1.5 flex-wrap">
          {unlocked.map(c => (
            <button
              key={c}
              onClick={() => setCity(c)}
              className={`px-2.5 py-1 rounded text-[10px] font-heading font-bold uppercase border transition-colors ${city === c ? 'bg-primary/20 border-primary text-primary' : 'bg-zinc-800/30 border-zinc-600 text-mutedForeground hover:text-primary'}`}
            >
              {cityDisplayName(c)}
            </button>
          ))}
        </div>
      )}

      {/* Stats panel */}
      <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 mobile-panel`}>
        <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20">
          <span className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em]">Progress</span>
        </div>
        <div className="p-2.5 flex gap-3 flex-wrap">
          {[
            { label: 'Done', value: `${completedCount}/${totalMissions}`, cls: 'text-green-400' },
            { label: 'Ready', value: readyCount, cls: readyCount > 0 ? 'text-primary' : 'text-mutedForeground' },
            { label: 'City', value: cityDisplayName(city), cls: 'text-foreground' },
          ].map(({ label, value, cls }) => (
            <div key={label} className="flex-1 min-w-[80px]">
              <div className="text-[9px] font-heading text-mutedForeground uppercase">{label}</div>
              <div className={`text-sm font-heading font-bold ${cls}`}>{value}</div>
            </div>
          ))}
        </div>
        <div className="m-art-line text-primary mx-2.5" />
      </div>

      {/* Completed missions link */}
      {completedMissions.length > 0 && !showCompleted && (
        <button
          type="button"
          onClick={() => setShowCompleted(true)}
          className="w-full flex items-center justify-center gap-2 py-2 rounded-md border border-zinc-600/60 bg-zinc-800/30 text-mutedForeground hover:bg-zinc-800/50 hover:text-foreground text-[10px] font-heading transition-colors"
        >
          <ListChecks size={14} />
          <span>Completed missions ({completedMissions.length})</span>
          <ChevronRight size={12} />
        </button>
      )}

      {/* Boss progress hint */}
      {bossM && !bossM.completed && bossReqCount !== null && (
        <div className={`relative p-2 ${styles.panel} border rounded-md m-fade-in mobile-panel ${bossM.requirements_met ? 'border-primary/40 bg-primary/8' : 'border-primary/20'}`}>
          <div className="flex items-center gap-2">
            <Skull size={11} className={bossM.requirements_met ? 'text-primary' : 'text-mutedForeground'} />
            <span className="text-[10px] text-mutedForeground italic">
              {bossM.requirements_met ? `All requirements met — report to ${bossM.title}.` : `${bossDoneCount}/${bossReqCount} requirements met. Complete more to unlock "${bossM.title}".`}
            </span>
          </div>
        </div>
      )}

      {orderedCityMissions.length > 0 && (
        <MissionFocusSection
          cityLabel={cityDisplayName(city)}
          currentMission={currentMission}
          nextMission={nextMission}
          missionIdToIndex={missionIdToIndex}
          orderedTotal={orderedCityMissions.length}
          completedCount={completedCount}
          onOpen={setSelected}
        />
      )}

      {cityMissions.length === 0 && (
        <div className="text-center py-10 text-mutedForeground">
          <BookOpen size={28} className="opacity-40 mx-auto mb-2" />
          <p className="text-[10px] italic">No missions available in {cityDisplayName(city)}.</p>
        </div>
      )}

      {selected && (
        <MissionModal
          mission={selected}
          onClose={() => setSelected(null)}
          onComplete={handleComplete}
          completing={completing}
        />
      )}
    </div>
  );
}
