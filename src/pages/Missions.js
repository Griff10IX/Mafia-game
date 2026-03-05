import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  BookOpen, X, Crown, Clock, Lock, CheckCircle, Banknote,
  MapPin, ChevronRight, Skull, Star, AlertCircle, Coins, ListChecks, ChevronUp
} from 'lucide-react';
import api, { refreshUser } from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

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
`;

const fmt = (n) => `$${Number(n ?? 0).toLocaleString()}`;

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

function ProgressBar({ current, target, color = '#eab308' }) {
  const pct = target > 0 ? Math.min(100, (current / target) * 100) : 100;
  return (
    <div style={{
      width: '100%', height: 5, borderRadius: 4,
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

function StatusChip({ completed, requirementsMet, isBoss, unlocked }) {
  if (completed) return (
    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-green-500/10 border border-green-500/40 text-green-400 text-[9px] font-heading font-bold uppercase tracking-wide">
      <CheckCircle size={9} /> Done
    </span>
  );
  if (!unlocked) return (
    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-zinc-800/50 border border-zinc-600/50 text-mutedForeground text-[9px] font-heading font-bold uppercase tracking-wide">
      <Lock size={9} /> Locked
    </span>
  );
  if (!requirementsMet) return (
    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-zinc-800/50 border border-zinc-600/50 text-mutedForeground text-[9px] font-heading font-bold uppercase tracking-wide">
      In progress
    </span>
  );
  return (
    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full border text-[9px] font-heading font-bold uppercase tracking-wide ${isBoss ? 'bg-primary/15 border-primary/70 text-primary' : 'bg-primary/10 border-primary/40 text-primary'}`}>
      <Star size={9} fill="currentColor" /> Ready
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MISSION CARD (area list item) – theme aligned with Crimes/GTA
// ─────────────────────────────────────────────────────────────────────────────

function MissionCard({ mission, onClick, delay = 0, missionIndex, missionTotal, isCurrent }) {
  const { completed, requirements_met, is_boss, progress, difficulty, title, type, reward_money, reward_points, reward_respect, reward_tribute, unlocked, previous_mission_title } = mission;

  const borderCls = completed
    ? 'border-green-500/30'
    : !unlocked
    ? 'border-zinc-700/50'
    : is_boss && requirements_met
    ? 'border-primary/60 m-boss-pulse'
    : isCurrent
    ? 'border-primary/50'
    : 'border-primary/20';
  const bgCls = completed
    ? 'bg-green-500/5'
    : !unlocked
    ? 'bg-zinc-800/20 opacity-80'
    : is_boss && requirements_met
    ? 'bg-primary/8'
    : isCurrent
    ? 'bg-primary/6'
    : 'bg-zinc-800/30';

  return (
    <div
      className={`m-fade-in m-row relative rounded-md border px-2 py-1.5 transition-all ${borderCls} ${bgCls} ${unlocked && !completed ? 'cursor-pointer' : 'cursor-default'}`}
      style={{ animationDelay: `${delay}s` }}
      onClick={() => unlocked && onClick(mission)}
    >
      {is_boss && (
        <div className="absolute left-0 top-0 bottom-0 w-0.5 rounded-l-md bg-gradient-to-b from-primary to-primary/70" />
      )}
      <div className={is_boss ? 'pl-2' : ''}>
        <div className="flex items-start justify-between gap-2 mb-1">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              {missionIndex != null && missionTotal != null && (
                <span className="text-[9px] font-heading font-bold text-primary/80 shrink-0">
                  {missionIndex}/{missionTotal}
                </span>
              )}
              {is_boss && !completed && <Skull size={11} className="text-primary shrink-0" />}
              {completed && <CheckCircle size={11} className="text-green-400 shrink-0" />}
              {isCurrent && !completed && unlocked && (
                <span className="shrink-0 px-1 py-0.5 rounded bg-primary/20 border border-primary/40 text-[9px] font-heading font-bold text-primary uppercase">Current</span>
              )}
              <span className={`text-[11px] font-heading font-bold truncate ${completed ? 'text-green-400' : unlocked ? 'text-foreground' : 'text-mutedForeground'}`}>
                {title}
              </span>
            </div>
            <div className="text-[9px] text-mutedForeground mt-0.5 italic">
              {missionTypeLabel(type)}
              {is_boss && ' · Final Job'}
            </div>
            {!unlocked && previous_mission_title && (
              <div className="text-[9px] text-amber-200/80 mt-1 flex items-center gap-1">
                <Lock size={8} /> Complete &quot;{previous_mission_title}&quot; to unlock
              </div>
            )}
          </div>
          <StatusChip completed={completed} requirementsMet={requirements_met} isBoss={is_boss} unlocked={unlocked} />
        </div>

        {!completed && progress?.target > 0 && unlocked && (
          <div className="mb-1.5">
            <ProgressBar current={progress.current} target={progress.target} />
            <div className="text-[9px] text-mutedForeground mt-0.5 text-right">{progress.description}</div>
          </div>
        )}
        {completed && (
          <div className="mb-1.5">
            <ProgressBar current={1} target={1} color="#4ade80" />
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap text-[9px]">
          {reward_money > 0 && (
            <span className="inline-flex items-center gap-1 text-green-400">
              <Coins size={10} /> {fmt(reward_money)}
            </span>
          )}
          {reward_points > 0 && (
            <span className="inline-flex items-center gap-1 text-primary">
              <Star size={10} /> {reward_points} RP
            </span>
          )}
          {(reward_respect > 0) && (
            <span className="inline-flex items-center gap-1 text-fuchsia-400">
              +{reward_respect} resp
            </span>
          )}
          {(reward_tribute > 0) && (
            <span className="inline-flex items-center gap-1 text-green-500/90">
              +{fmt(reward_tribute)} tribute
            </span>
          )}
          {(mission.reward_tribute_daily > 0) && (
            <span className="inline-flex items-center gap-1 text-green-400/90">{fmt(mission.reward_tribute_daily)}/day</span>
          )}
          {(mission.reward_respect_daily > 0) && (
            <span className="inline-flex items-center gap-1 text-fuchsia-400/90">+{mission.reward_respect_daily} resp/day</span>
          )}
          {mission.unlocks_city && (
            <span className="inline-flex items-center gap-1 text-violet-400">
              <MapPin size={10} /> Unlocks {mission.unlocks_city}
            </span>
          )}
          <span className="ml-auto">
            <DifficultyStars difficulty={difficulty} size={10} />
          </span>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AREA SECTION – panel theme like Crimes/GTA
// ─────────────────────────────────────────────────────────────────────────────

function AreaSection({ areaName, missions, onMissionClick, delay = 0, isBossArea = false, missionIdToIndex, currentMissionId }) {
  const completed = missions.filter(m => m.completed).length;
  const total = missions.length;
  const allDone = completed === total && total > 0;
  const anyReady = missions.some(m => m.requirements_met && !m.completed);
  const sorted = [...missions].sort((a, b) => a.order - b.order);

  return (
    <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 m-fade-in mb-2`} style={{ animationDelay: `${delay}s` }}>
      <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      <div className={`px-2.5 py-1.5 border-b border-primary/20 flex items-center gap-2 ${isBossArea ? 'bg-primary/10' : 'bg-primary/8'}`}>
        {isBossArea ? <Skull size={12} className="text-primary shrink-0" /> : <MapPin size={11} className={allDone ? 'text-green-400' : 'text-primary/80'} />}
        <span className={`text-[9px] font-heading font-bold uppercase tracking-[0.1em] flex-1 ${allDone ? 'text-green-400' : isBossArea ? 'text-primary' : 'text-foreground'}`}>
          {areaName}
          {isBossArea && <span className="font-normal italic ml-1 text-primary/90">Final Job</span>}
        </span>
        <span className={`text-[9px] font-heading font-bold ${allDone ? 'text-green-400' : anyReady ? 'text-primary' : 'text-mutedForeground'}`}>
          {completed}/{total}
        </span>
        {allDone && (
          <span className="w-4 h-4 rounded-full bg-green-500 flex items-center justify-center shrink-0">
            <CheckCircle size={10} className="text-white" />
          </span>
        )}
      </div>
      <div className="p-1.5 space-y-1">
        {sorted.map((m, i) => {
          const info = missionIdToIndex?.[m.id] ?? {};
          return (
            <MissionCard
              key={m.id}
              mission={m}
              onClick={onMissionClick}
              delay={delay + i * 0.03}
              missionIndex={info.index}
              missionTotal={info.total}
              isCurrent={m.id === currentMissionId}
            />
          );
        })}
      </div>
      <div className="m-art-line text-primary mx-2.5" />
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

function TributeBanner({
  bank,
  tributeBullets = 0,
  tributeLootBoxPieces = 0,
  onCollect,
  collecting,
  tributeDepositDailyAt,
  nextTributeDepositAt,
  dailyCashBase = 500,
  dailyLootBase = 1,
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
  const hasAny = hasBank || hasBullets || hasLootPieces;
  const nextIn = nextTributeDepositAt ? formatTimeUntil(nextTributeDepositAt) : null;
  const dailyTotalCash = dailyCashBase + (hasMission1Bonus ? dailyCashMission1 : 0) + (hasMission2Bonus ? dailyCashMission2 : 0) + (hasMission3Bonus ? dailyCashMission3 : 0) + (hasMission4Bonus ? dailyCashMission4 : 0);
  const dailyTotalBullets = (hasMission1Bonus ? dailyBulletsMission1 : 0) + (hasMission2Bonus ? dailyBulletsMission2 : 0) + (hasMission3Bonus ? dailyBulletsMission3 : 0) + (hasMission4Bonus ? dailyBulletsMission4 : 0);
  const dailyTotalRespect = (hasMission1Bonus ? dailyRespectMission1 : 0) + (hasMission2Bonus ? dailyRespectMission2 : 0) + (hasMission3Bonus ? dailyRespectMission3 : 0) + (hasMission4Bonus ? dailyRespectMission4 : 0);
  const dailyTotalLoot = dailyLootBase + (hasMission2Bonus ? dailyLootMission2 : 0);
  const missionHints = [
    { n: 1, has: hasMission1Bonus, cash: dailyCashMission1, bullets: dailyBulletsMission1, respect: dailyRespectMission1 },
    { n: 2, has: hasMission2Bonus, cash: dailyCashMission2, bullets: dailyBulletsMission2, respect: dailyRespectMission2, loot: dailyLootMission2 },
    { n: 3, has: hasMission3Bonus, cash: dailyCashMission3, bullets: dailyBulletsMission3, respect: dailyRespectMission3 },
    { n: 4, has: hasMission4Bonus, cash: dailyCashMission4, bullets: dailyBulletsMission4, respect: dailyRespectMission4 },
  ].filter((m) => !m.has && (m.cash > 0 || m.bullets > 0 || m.respect > 0 || (m.loot || 0) > 0));
  return (
    <div className={`relative ${styles.panel} rounded-md overflow-hidden border m-fade-in ${hasAny ? 'border-green-500/30' : 'border-primary/20'}`} style={{ animationDelay: '0.05s' }}>
      <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      <div className={`px-2.5 py-2 flex items-center justify-between gap-3 flex-wrap border-l-2 ${hasAny ? 'border-green-500 bg-green-500/5' : 'border-zinc-600 bg-primary/5'}`}>
        <div className="flex items-center gap-2 flex-wrap">
          <Banknote size={16} className={hasBank ? 'text-green-400' : 'text-mutedForeground'} />
          <div>
            <div className="text-[9px] font-heading font-bold text-mutedForeground uppercase tracking-wider">Tribute Bank</div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-heading font-bold text-foreground">{fmt(bank)}</span>
              {(tributeBullets || 0) > 0 && (
                <span className="text-[10px] font-heading font-bold text-foreground">· {(tributeBullets || 0).toLocaleString()} bullets</span>
              )}
              {(tributeLootBoxPieces || 0) > 0 && (
                <span className="text-[10px] font-heading font-bold text-foreground">· {tributeLootBoxPieces} loot piece(s)</span>
              )}
            </div>
            {tributeDepositDailyAt && (
              <div className="flex items-center gap-1 mt-1 text-[9px] text-mutedForeground">
                <Clock size={9} />
                <span>Deposits daily at {tributeDepositDailyAt}</span>
              </div>
            )}
            <div className="text-[9px] text-mutedForeground mt-0.5">
              <span className="text-mutedForeground">Daily: </span>
              <span className="text-foreground font-semibold">{fmt(dailyTotalCash)}</span> cash
              {dailyTotalBullets > 0 && <><span className="text-mutedForeground"> · </span><span className="text-foreground font-semibold">{dailyTotalBullets}</span> bullets</>}
              {dailyTotalRespect > 0 && <><span className="text-mutedForeground"> · </span><span className="text-foreground font-semibold">{dailyTotalRespect}</span> respect</>}
              {dailyTotalLoot > 0 && <><span className="text-mutedForeground"> · </span><span className="text-foreground font-semibold">{dailyTotalLoot}</span> loot</>}
            </div>
            <div className="text-[8px] text-mutedForeground mt-0.5 italic">Cash and bullets stack daily until you collect.</div>
            {missionHints.length > 0 && (
              <div className="text-[9px] text-mutedForeground mt-1 space-y-0.5">
                {missionHints.map((m) => {
                  const parts = [];
                  if (m.cash > 0) parts.push(`+${fmt(m.cash)}`);
                  if (m.bullets > 0) parts.push(`+${m.bullets} bullets`);
                  if (m.respect > 0) parts.push(`+${m.respect} respect`);
                  if ((m.loot || 0) > 0) parts.push(`+${m.loot} loot`);
                  return <div key={m.n}>Complete Mission {m.n} for {parts.join(' ')}/day</div>;
                })}
              </div>
            )}
            {nextIn && (
              <div className="text-[9px] text-primary/80 mt-0.5">Next deposit: {nextIn}</div>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onCollect}
          disabled={!hasAny || collecting}
          className={`px-2.5 py-1 rounded text-[10px] font-heading font-bold uppercase border transition-colors ${hasAny && !collecting ? 'bg-green-500/20 border-green-500/40 text-green-400 hover:bg-green-500/30 cursor-pointer' : 'bg-zinc-800/50 border-zinc-600 text-mutedForeground cursor-not-allowed'} ${collecting ? 'opacity-60' : ''}`}
        >
          {collecting ? 'Collecting…' : 'Collect'}
        </button>
      </div>
      <div className="m-art-line text-primary mx-2.5" />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export default function Missions() {
  const [data,       setData]       = useState(null);
  const [missions,   setMissions]   = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [city,       setCity]       = useState(null);
  const [selected,   setSelected]   = useState(null);   // selected mission object
  const [completing, setCompleting] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false); // toggle completed missions view

  const load = async () => {
    try {
      const [mapRes, listRes] = await Promise.all([
        api.get('/missions/map'),
        api.get('/missions'),
      ]);
      setData(mapRes.data);
      setMissions(listRes.data?.missions || []);
      if (!city) setCity(mapRes.data?.current_city || mapRes.data?.unlocked_cities?.[0] || 'Chicago');
    } catch {
      toast.error('Failed to load missions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line

  const handleComplete = async (missionId) => {
    setCompleting(true);
    try {
      const res = await api.post('/missions/complete', { mission_id: missionId });
      if (res.data?.completed) {
        const parts = [];
        const tributeTotal = (res.data.reward_money || 0) + (res.data.reward_tribute || 0);
        if (tributeTotal > 0) parts.push(`+${fmt(tributeTotal)} tribute`);
        if (res.data.reward_cash_immediate > 0) parts.push(`+${fmt(res.data.reward_cash_immediate)} cash`);
        if (res.data.reward_points > 0) parts.push(`+${res.data.reward_points} RP`);
        if (res.data.reward_respect > 0) parts.push(`+${res.data.reward_respect} respect`);
        if (res.data.reward_bullets > 0) parts.push(`+${res.data.reward_bullets} bullets`);
        if (res.data.reward_car_id) parts.push('1 car');
        if (res.data.reward_car_ids?.length) parts.push(`${res.data.reward_car_ids.length} cars`);
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
    if (bank <= 0 && bullets <= 0 && lootPieces <= 0) return;
    setCollecting(true);
    try {
      const res = await api.post('/missions/collect-tribute');
      const collectedCash = res.data?.collected ?? 0;
      const collectedBullets = res.data?.collected_bullets ?? 0;
      const collectedLoot = res.data?.collected_loot_box_pieces ?? 0;
      if (collectedCash > 0 || collectedBullets > 0 || collectedLoot > 0) {
        const parts = [];
        if (collectedCash > 0) parts.push(`${fmt(collectedCash)} cash`);
        if (collectedBullets > 0) parts.push(`${collectedBullets.toLocaleString()} bullets`);
        if (collectedLoot > 0) parts.push(`${collectedLoot} loot piece(s)`);
        toast.success(`Collected ${parts.join(' and ')}`);
        refreshUser();
        const mapRes = await api.get('/missions/map');
        setData(mapRes.data);
      }
    } catch {
      toast.error('Failed to collect tribute');
    } finally {
      setCollecting(false);
    }
  };

  if (loading || !data) {
    return (
      <div className={`flex flex-col items-center justify-center min-h-[40vh] gap-2 ${styles.pageContent}`}>
        <style>{MISSIONS_STYLES}</style>
        <BookOpen size={22} className="text-primary/40 animate-pulse" />
        <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <span className="text-primary text-[9px] font-heading uppercase tracking-[0.2em]">Loading...</span>
      </div>
    );
  }

  const unlocked = data.unlocked_cities || ['Start'];
  const cityMissions = missions.filter(m => m.city === city);
  const orderedCityMissions = [...cityMissions].sort((a, b) => (a.is_boss ? 1 : 0) - (b.is_boss ? 1 : 0) || a.order - b.order);
  const currentMission = orderedCityMissions.find(m => !m.completed && m.unlocked) ?? null;
  const currentMissionId = currentMission?.id ?? null;
  const missionIdToIndex = {};
  orderedCityMissions.forEach((m, i) => {
    missionIdToIndex[m.id] = { index: i + 1, total: orderedCityMissions.length };
  });

  const normalMissions = cityMissions.filter(m => !m.is_boss);
  const bossMissions   = cityMissions.filter(m => m.is_boss);
  const activeNormal   = normalMissions.filter(m => !m.completed);
  const activeBoss     = bossMissions.filter(m => !m.completed);
  const completedMissions = cityMissions.filter(m => m.completed).sort((a, b) => (a.completed_at || a.order) - (b.completed_at || b.order));
  const areaMap = {};
  activeNormal.forEach(m => {
    if (!areaMap[m.area]) areaMap[m.area] = [];
    areaMap[m.area].push(m);
  });
  const areaNames = Object.keys(areaMap).sort((a, b) => {
    const minA = Math.min(...areaMap[a].map(m => m.order));
    const minB = Math.min(...areaMap[b].map(m => m.order));
    return minA - minB;
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
      <div className={`space-y-3 ${styles.pageContent}`} style={{ padding: '12px 14px', maxWidth: 700, margin: '0 auto' }}>
        <style>{MISSIONS_STYLES}</style>
        <button
          type="button"
          onClick={() => setShowCompleted(false)}
          className="flex items-center gap-1.5 text-[10px] font-heading text-primary hover:underline"
        >
          <ChevronUp size={14} className="rotate-90" />
          Back to missions
        </button>
        <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-green-500/20`}>
          <div className="h-px bg-gradient-to-r from-transparent via-green-500/40 to-transparent" />
          <div className="px-2.5 py-1.5 border-b border-green-500/20 flex items-center gap-2 bg-green-500/8">
            <CheckCircle size={12} className="text-green-400" />
            <span className="text-[9px] font-heading font-bold text-green-400 uppercase tracking-[0.1em]">
              Completed missions ({completedMissions.length})
            </span>
          </div>
          <div className="p-1.5 space-y-1 max-h-[70vh] overflow-y-auto">
            {completedMissions.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between gap-2 py-1.5 px-2 rounded border border-green-500/20 bg-green-500/5 cursor-pointer hover:bg-green-500/10 transition-colors"
                onClick={() => { setSelected(m); setShowCompleted(false); }}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-heading font-bold text-green-400 truncate">{m.title}</div>
                  <div className="text-[9px] text-mutedForeground">{m.area}{m.is_boss ? ' · Final Job' : ''}</div>
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
    <div className={`space-y-2 ${styles.pageContent}`} style={{ padding: '12px 14px', maxWidth: 700, margin: '0 auto' }}>
      <style>{MISSIONS_STYLES}</style>

      {/* Page header */}
      <div className="relative">
        <div className="flex items-center gap-2 mb-1">
          <BookOpen size={18} className="text-primary" />
          <h1 className="text-base font-heading font-bold text-foreground tracking-wide">Missions</h1>
        </div>
        <p className="text-[10px] text-mutedForeground italic">Prove yourself: commit 15 crimes and bust 1 NPC from jail. Earn tribute and claim your reward.</p>
      </div>

      {/* Current mission strip – Mission X of Y */}
      {orderedCityMissions.length > 0 && (
        <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 m-fade-in`}>
          <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between gap-2 flex-wrap">
            <span className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em]">
              {currentMissionId ? `Mission ${missionIdToIndex[currentMissionId]?.index ?? '—'} of ${orderedCityMissions.length}` : `${completedCount}/${totalMissions} completed`}
            </span>
            {currentMission && (
              <span className="text-[10px] font-heading font-bold text-foreground truncate">
                {currentMission.title}
              </span>
            )}
            {!currentMission && completedCount === totalMissions && totalMissions > 0 && (
              <span className="text-[10px] text-green-400 font-heading">All done in {city}</span>
            )}
          </div>
          <div className="m-art-line text-primary mx-2.5" />
        </div>
      )}

      <TributeBanner
        bank={tributeBank}
        tributeBullets={data?.tribute_bullets ?? 0}
        tributeLootBoxPieces={data?.tribute_loot_box_pieces ?? 0}
        onCollect={handleCollect}
        collecting={collecting}
        tributeDepositDailyAt={data?.tribute_deposit_daily_at}
        nextTributeDepositAt={data?.next_tribute_deposit_at}
        dailyCashBase={data?.daily_tribute_cash_base ?? 500}
        dailyLootBase={data?.daily_tribute_loot_box_pieces_base ?? 1}
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
              {c}
            </button>
          ))}
        </div>
      )}

      {/* Stats panel */}
      <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
        <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20">
          <span className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em]">Progress</span>
        </div>
        <div className="p-2 flex gap-2 flex-wrap">
          {[
            { label: 'Done', value: `${completedCount}/${totalMissions}`, cls: 'text-green-400' },
            { label: 'Ready', value: readyCount, cls: readyCount > 0 ? 'text-primary' : 'text-mutedForeground' },
            { label: 'City', value: city, cls: 'text-foreground' },
          ].map(({ label, value, cls }) => (
            <div key={label} className="flex-1 min-w-[70px]">
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
        <div className={`relative p-2 ${styles.panel} border rounded-md m-fade-in ${bossM.requirements_met ? 'border-primary/40 bg-primary/8' : 'border-primary/20'}`}>
          <div className="flex items-center gap-2">
            <Skull size={11} className={bossM.requirements_met ? 'text-primary' : 'text-mutedForeground'} />
            <span className="text-[10px] text-mutedForeground italic">
              {bossM.requirements_met ? `All requirements met — report to ${bossM.title}.` : `${bossDoneCount}/${bossReqCount} district missions done. Complete more to unlock "${bossM.title}".`}
            </span>
          </div>
        </div>
      )}

      {/* District missions */}
      {areaNames.map((area, i) => (
        <AreaSection
          key={area}
          areaName={area}
          missions={areaMap[area].sort((a, b) => a.order - b.order)}
          onMissionClick={setSelected}
          delay={0.1 + i * 0.04}
          isBossArea={false}
          missionIdToIndex={missionIdToIndex}
          currentMissionId={currentMissionId}
        />
      ))}

      {/* Boss section (only incomplete) */}
      {activeBoss.length > 0 && (
        <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 m-fade-in`}>
          <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <div className="px-2.5 py-1.5 bg-primary/10 border-b border-primary/20 flex items-center gap-2">
            <Skull size={12} className="text-primary" />
            <span className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.1em]">Final Jobs</span>
          </div>
          <div className="p-1.5 space-y-1">
            {activeBoss.map((m, i) => {
              const info = missionIdToIndex[m.id] ?? {};
              return (
                <MissionCard
                  key={m.id}
                  mission={m}
                  onClick={setSelected}
                  delay={0.1 + (areaNames.length + i) * 0.04}
                  missionIndex={info.index}
                  missionTotal={info.total}
                  isCurrent={m.id === currentMissionId}
                />
              );
            })}
          </div>
          <div className="m-art-line text-primary mx-2.5" />
        </div>
      )}

      {cityMissions.length === 0 && (
        <div className="text-center py-10 text-mutedForeground">
          <BookOpen size={28} className="opacity-40 mx-auto mb-2" />
          <p className="text-[10px] italic">No missions available in {city}.</p>
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
