import { useState, useEffect } from 'react';
import {
  BookOpen, X, Crown, Clock, Lock, CheckCircle, Banknote,
  MapPin, ChevronRight, Skull, Star, AlertCircle, Coins
} from 'lucide-react';
import api, { refreshUser } from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────

const STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400;1,600&family=Crimson+Text:ital,wght@0,400;0,600;1,400&display=swap');

  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(14px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes slideIn {
    from { opacity: 0; transform: translateX(-12px); }
    to   { opacity: 1; transform: translateX(0); }
  }
  @keyframes scaleIn {
    from { opacity: 0; transform: scale(0.94); }
    to   { opacity: 1; transform: scale(1); }
  }
  @keyframes shimmer {
    0%   { background-position: -200% center; }
    100% { background-position: 200% center; }
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes sealPop {
    0%   { transform: scale(0) rotate(-20deg); opacity: 0; }
    65%  { transform: scale(1.15) rotate(3deg); }
    100% { transform: scale(1) rotate(0); opacity: 1; }
  }
  @keyframes pulseBorder {
    0%,100% { border-color: rgba(234,179,8,0.4); }
    50%     { border-color: rgba(234,179,8,0.8); }
  }
  @keyframes progressFill {
    from { width: 0%; }
    to   { width: var(--target-w); }
  }

  .m-fadeUp  { animation: fadeUp 0.4s cubic-bezier(0.22,1,0.36,1) both; }
  .m-slideIn { animation: slideIn 0.35s cubic-bezier(0.22,1,0.36,1) both; }
  .m-scaleIn { animation: scaleIn 0.35s cubic-bezier(0.22,1,0.36,1) both; }
  .m-sealPop { animation: sealPop 0.5s cubic-bezier(0.22,1,0.36,1) both; }
  .m-boss-pulse { animation: pulseBorder 2s ease-in-out infinite; }

  .shimmer-gold {
    background: linear-gradient(90deg,#92650a 0%,#eab308 40%,#fef08a 55%,#eab308 70%,#92650a 100%);
    background-size: 200% auto;
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    animation: shimmer 2.8s linear infinite;
  }

  .mission-card {
    transition: border-color 0.2s ease, background 0.2s ease, transform 0.15s ease;
  }
  .mission-card:active { transform: scale(0.99); }

  .progress-bar-fill {
    animation: progressFill 0.7s cubic-bezier(0.22,1,0.36,1) both;
    animation-delay: 0.3s;
  }

  /* Cormorant for headings */
  .font-ledger { font-family: 'Cormorant Garamond', serif; }
  .font-body   { font-family: 'Crimson Text', serif; }
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

function StatusChip({ completed, requirementsMet, isBoss }) {
  if (completed) return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      padding: '2px 7px', borderRadius: 20,
      background: 'rgba(74,222,128,0.12)', border: '1px solid rgba(74,222,128,0.4)',
      color: '#4ade80', fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.05em',
      textTransform: 'uppercase',
    }}>
      <CheckCircle size={9} /> Done
    </span>
  );
  if (!requirementsMet) return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      padding: '2px 7px', borderRadius: 20,
      background: 'rgba(63,63,70,0.4)', border: '1px solid rgba(63,63,70,0.6)',
      color: '#71717a', fontSize: '0.68rem', fontWeight: 600, letterSpacing: '0.05em',
      textTransform: 'uppercase',
    }}>
      <Lock size={9} /> Locked
    </span>
  );
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      padding: '2px 7px', borderRadius: 20,
      background: isBoss ? 'rgba(234,179,8,0.15)' : 'rgba(234,179,8,0.08)',
      border: `1px solid ${isBoss ? 'rgba(234,179,8,0.7)' : 'rgba(234,179,8,0.4)'}`,
      color: '#eab308', fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.05em',
      textTransform: 'uppercase',
    }}>
      <Star size={9} fill="currentColor" /> Ready
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MISSION CARD (area list item)
// ─────────────────────────────────────────────────────────────────────────────

function MissionCard({ mission, onClick, delay = 0 }) {
  const { completed, requirements_met, is_boss, progress, difficulty, title, type, reward_money, reward_points } = mission;

  const borderColor = completed
    ? 'rgba(74,222,128,0.3)'
    : requirements_met && is_boss
    ? 'rgba(234,179,8,0.6)'
    : requirements_met
    ? 'rgba(234,179,8,0.25)'
    : 'rgba(39,39,42,0.8)';

  const bg = completed
    ? 'rgba(74,222,128,0.04)'
    : is_boss && requirements_met
    ? 'rgba(234,179,8,0.06)'
    : 'rgba(24,24,27,0.5)';

  const pct = progress?.target > 0
    ? Math.min(100, Math.round((progress.current / progress.target) * 100))
    : completed ? 100 : 0;

  return (
    <div
      className={`mission-card m-slideIn ${is_boss && requirements_met && !completed ? 'm-boss-pulse' : ''}`}
      style={{
        animationDelay: `${delay}s`,
        padding: '10px 12px',
        borderRadius: 8,
        border: `1px solid ${borderColor}`,
        background: bg,
        cursor: 'pointer',
        position: 'relative',
        overflow: 'hidden',
      }}
      onClick={() => onClick(mission)}
      onMouseEnter={e => {
        if (!completed) e.currentTarget.style.borderColor = is_boss ? 'rgba(234,179,8,0.8)' : 'rgba(234,179,8,0.4)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = borderColor;
      }}
    >
      {/* Boss indicator strip */}
      {is_boss && (
        <div style={{
          position: 'absolute', top: 0, left: 0, bottom: 0, width: 3,
          background: completed ? '#4ade80' : 'linear-gradient(to bottom, #eab308, #92650a)',
        }} />
      )}

      <div style={{ paddingLeft: is_boss ? 8 : 0 }}>
        {/* Top row */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 5 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: '0.88rem', fontWeight: 700, lineHeight: 1.3,
              fontFamily: "'Cormorant Garamond', serif",
              color: completed ? '#4ade80' : requirements_met ? '#f4f4f5' : '#71717a',
              display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap',
            }}>
              {is_boss && !completed && <Skull size={12} style={{ color: '#eab308', flexShrink: 0 }} />}
              {completed && <CheckCircle size={11} style={{ color: '#4ade80', flexShrink: 0 }} />}
              <span>{title}</span>
            </div>
            <div style={{
              fontSize: '0.7rem', color: '#52525b', marginTop: 1,
              fontFamily: "'Crimson Text', serif", fontStyle: 'italic',
            }}>
              {missionTypeLabel(type)}
              {is_boss && ' · Boss Mission'}
            </div>
          </div>
          <StatusChip completed={completed} requirementsMet={requirements_met} isBoss={is_boss} />
        </div>

        {/* Progress bar */}
        {!completed && progress?.target > 0 && (
          <div style={{ marginBottom: 6 }}>
            <ProgressBar current={progress.current} target={progress.target} />
            <div style={{ fontSize: '0.65rem', color: '#52525b', marginTop: 2, textAlign: 'right' }}>
              {progress.description}
            </div>
          </div>
        )}
        {completed && (
          <div style={{ marginBottom: 6 }}>
            <ProgressBar current={1} target={1} color="#4ade80" />
          </div>
        )}

        {/* Rewards row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {reward_money > 0 && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: '0.7rem', color: '#4ade80' }}>
              <Coins size={10} /> {fmt(reward_money)}
            </span>
          )}
          {reward_points > 0 && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: '0.7rem', color: '#eab308' }}>
              <Star size={10} /> {reward_points} RP
            </span>
          )}
          {mission.unlocks_city && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: '0.7rem', color: '#a78bfa' }}>
              <MapPin size={10} /> Unlocks {mission.unlocks_city}
            </span>
          )}
          <span style={{ marginLeft: 'auto' }}>
            <DifficultyStars difficulty={difficulty} size={10} />
          </span>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AREA SECTION
// ─────────────────────────────────────────────────────────────────────────────

function AreaSection({ areaName, missions, onMissionClick, delay = 0, isBossArea = false }) {
  const completed = missions.filter(m => m.completed).length;
  const total = missions.length;
  const allDone = completed === total && total > 0;
  const anyReady = missions.some(m => m.requirements_met && !m.completed);

  return (
    <div
      className="m-fadeUp"
      style={{
        animationDelay: `${delay}s`,
        marginBottom: 12,
      }}
    >
      {/* Area header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '5px 0 7px',
        borderBottom: `1px solid ${isBossArea ? 'rgba(234,179,8,0.35)' : 'rgba(63,63,70,0.5)'}`,
        marginBottom: 8,
      }}>
        {isBossArea
          ? <Skull size={13} style={{ color: '#eab308', flexShrink: 0 }} />
          : <MapPin size={12} style={{ color: allDone ? '#4ade80' : '#eab308', flexShrink: 0, opacity: 0.8 }} />
        }
        <span style={{
          fontFamily: "'Cormorant Garamond', serif",
          fontSize: '0.9rem', fontWeight: 700,
          color: allDone ? '#4ade80' : isBossArea ? '#eab308' : '#d4d4d8',
          letterSpacing: '0.04em',
          flex: 1,
        }}>
          {areaName}
          {isBossArea && <span style={{ fontWeight: 400, fontStyle: 'italic', marginLeft: 6, fontSize: '0.8rem', color: '#a16207' }}>Final Job</span>}
        </span>
        <span style={{
          fontSize: '0.68rem', fontWeight: 700,
          color: allDone ? '#4ade80' : anyReady ? '#eab308' : '#52525b',
          letterSpacing: '0.06em',
        }}>
          {completed}/{total}
        </span>
        {allDone && (
          <span className="m-sealPop" style={{
            width: 18, height: 18, borderRadius: '50%',
            background: '#16a34a', display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <CheckCircle size={10} color="#fff" />
          </span>
        )}
      </div>

      {/* Missions */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {missions.map((m, i) => (
          <MissionCard key={m.id} mission={m} onClick={onMissionClick} delay={delay + i * 0.04} />
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MISSION DETAIL MODAL
// ─────────────────────────────────────────────────────────────────────────────

function MissionModal({ mission, onClose, onComplete, completing }) {
  if (!mission) return null;
  const { completed, requirements_met, is_boss, progress, difficulty } = mission;
  const canComplete = !completed && requirements_met;
  const stars = difficultyStars(difficulty);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 60,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(6px)',
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        className={`m-scaleIn ${styles.panel}`}
        style={{
          width: '100%', maxWidth: 480, maxHeight: '88vh', overflowY: 'auto',
          borderRadius: 10,
          border: `1px solid ${is_boss ? 'rgba(234,179,8,0.5)' : 'rgba(63,63,70,0.8)'}`,
          boxShadow: is_boss
            ? '0 0 40px rgba(234,179,8,0.12), 0 20px 60px rgba(0,0,0,0.6)'
            : '0 20px 60px rgba(0,0,0,0.5)',
        }}
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
              {!requirements_met && is_boss && (
                <div style={{
                  display: 'flex', alignItems: 'flex-start', gap: 6, marginTop: 8,
                  padding: '7px 9px', borderRadius: 5,
                  background: 'rgba(234,179,8,0.06)', border: '1px solid rgba(234,179,8,0.2)',
                }}>
                  <AlertCircle size={13} style={{ color: '#eab308', flexShrink: 0, marginTop: 1 }} />
                  <span style={{ fontSize: '0.75rem', color: '#a16207', fontFamily: "'Crimson Text', serif", lineHeight: 1.4 }}>
                    Complete the district missions first. The boss doesn't see just anyone.
                  </span>
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
              {mission.reward_points > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
                  <span style={{ color: '#71717a', display: 'flex', alignItems: 'center', gap: 5 }}>
                    <Star size={12} /> Rank points
                  </span>
                  <span style={{ color: '#eab308', fontWeight: 700 }}>+{mission.reward_points} RP</span>
                </div>
              )}
              {mission.reward_bullets > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
                  <span style={{ color: '#71717a' }}>Ammo</span>
                  <span style={{ color: '#f87171', fontWeight: 700 }}>+{mission.reward_bullets} bullets</span>
                </div>
              )}
              {mission.reward_car_id && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
                  <span style={{ color: '#71717a' }}>Vehicle</span>
                  <span style={{ color: '#60a5fa', fontWeight: 700 }}>Car reward</span>
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
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              padding: '9px',  borderRadius: 7,
              background: 'rgba(39,39,42,0.4)', border: '1px solid rgba(63,63,70,0.5)',
              color: '#52525b', fontSize: '0.8rem',
            }}>
              <Lock size={13} /> Requirements not yet met
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

function TributeBanner({ bank, onCollect, collecting }) {
  const hasBank = bank > 0;
  return (
    <div
      className="m-fadeUp"
      style={{
        animationDelay: '0.05s',
        padding: '10px 14px',
        borderRadius: 8,
        border: `1px solid ${hasBank ? 'rgba(74,222,128,0.4)' : 'rgba(63,63,70,0.5)'}`,
        background: hasBank ? 'rgba(74,222,128,0.04)' : 'rgba(24,24,27,0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        flexWrap: 'wrap',
        marginBottom: 10,
        borderLeft: `3px solid ${hasBank ? '#4ade80' : 'rgba(63,63,70,0.5)'}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Banknote size={18} style={{ color: hasBank ? '#4ade80' : '#52525b' }} />
        <div>
          <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#52525b', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
            Tribute Bank
          </div>
          <div style={{
            fontSize: '1rem', fontWeight: 700,
            fontFamily: "'Cormorant Garamond', serif",
            color: hasBank ? '#4ade80' : '#71717a',
          }}>
            {fmt(bank)}
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={onCollect}
        disabled={!hasBank || collecting}
        style={{
          padding: '6px 14px', borderRadius: 6,
          background: hasBank ? 'rgba(74,222,128,0.12)' : 'rgba(39,39,42,0.4)',
          border: `1px solid ${hasBank ? 'rgba(74,222,128,0.4)' : 'rgba(63,63,70,0.5)'}`,
          color: hasBank ? '#4ade80' : '#52525b',
          fontWeight: 700, fontSize: '0.78rem',
          cursor: hasBank && !collecting ? 'pointer' : 'not-allowed',
          opacity: collecting ? 0.6 : 1,
          transition: 'all 0.2s',
          letterSpacing: '0.04em',
        }}
        onMouseEnter={e => { if (hasBank && !collecting) e.currentTarget.style.background = 'rgba(74,222,128,0.2)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = hasBank ? 'rgba(74,222,128,0.12)' : 'rgba(39,39,42,0.4)'; }}
      >
        {collecting ? 'Collecting…' : 'Collect'}
      </button>
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
        if (res.data.reward_money > 0) parts.push(`+${fmt(res.data.reward_money)} tribute`);
        if (res.data.reward_points > 0) parts.push(`+${res.data.reward_points} RP`);
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
    if (bank <= 0) return;
    setCollecting(true);
    try {
      const res = await api.post('/missions/collect-tribute');
      if ((res.data?.collected ?? 0) > 0) {
        toast.success(`Collected ${fmt(res.data.collected)} cash`);
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

  // ── Loading ────────────────────────────────────────────────
  if (loading || !data) {
    return (
      <div className={styles.pageContent} style={{
        minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16,
      }}>
        <style>{STYLES}</style>
        <BookOpen size={32} style={{ color: '#eab308', opacity: 0.5 }} />
        <div style={{
          width: 32, height: 32,
          border: '2px solid rgba(234,179,8,0.2)',
          borderTopColor: '#eab308',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  const unlocked = data.unlocked_cities || ['Chicago'];
  const cityMissions = missions.filter(m => m.city === city);

  // Separate boss missions from regular missions
  const normalMissions = cityMissions.filter(m => !m.is_boss);
  const bossMissions   = cityMissions.filter(m => m.is_boss);

  // Group normal missions by area
  const areaMap = {};
  normalMissions.forEach(m => {
    if (!areaMap[m.area]) areaMap[m.area] = [];
    areaMap[m.area].push(m);
  });
  // Sort areas by the minimum order of their missions
  const areaNames = Object.keys(areaMap).sort((a, b) => {
    const minA = Math.min(...areaMap[a].map(m => m.order));
    const minB = Math.min(...areaMap[b].map(m => m.order));
    return minA - minB;
  });

  // Stats
  const totalMissions   = cityMissions.length;
  const completedCount  = cityMissions.filter(m => m.completed).length;
  const readyCount      = cityMissions.filter(m => m.requirements_met && !m.completed).length;
  const tributeBank     = data.tribute_bank ?? 0;

  // Determine boss mission requirement info for contextual hint
  const bossM = bossMissions[0];
  const bossReqCount  = bossM?.progress?.target ?? null;
  const bossDoneCount = bossM?.progress?.current ?? 0;
  const normalCompleted = normalMissions.filter(m => m.completed).length;

  return (
    <div className={styles.pageContent} style={{ padding: '12px 14px', maxWidth: 700, margin: '0 auto' }}>
      <style>{STYLES}</style>

      {/* ── Page header ─────────────────────────────────────── */}
      <div className="m-fadeUp" style={{ marginBottom: 12 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3,
        }}>
          <BookOpen size={18} style={{ color: '#eab308' }} />
          <h1 style={{
            fontFamily: "'Cormorant Garamond', serif",
            fontSize: '1.3rem', fontWeight: 700, color: '#f4f4f5',
            margin: 0, letterSpacing: '0.04em',
          }}>
            Missions
          </h1>
        </div>
        <p style={{ fontFamily: "'Crimson Text', serif", fontStyle: 'italic', fontSize: '0.82rem', color: '#52525b', margin: 0 }}>
          Complete jobs in each district. Earn tribute. Report to the boss when the city is yours.
        </p>
      </div>

      {/* ── Tribute bank ────────────────────────────────────── */}
      <TributeBanner bank={tributeBank} onCollect={handleCollect} collecting={collecting} />

      {/* ── City tabs ───────────────────────────────────────── */}
      {unlocked.length > 1 && (
        <div className="m-fadeUp" style={{
          display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10, animationDelay: '0.08s',
        }}>
          {unlocked.map(c => (
            <button
              key={c}
              onClick={() => setCity(c)}
              style={{
                padding: '5px 13px', borderRadius: 20,
                border: `1px solid ${city === c ? '#eab308' : 'rgba(63,63,70,0.6)'}`,
                background: city === c ? 'rgba(234,179,8,0.12)' : 'rgba(24,24,27,0.5)',
                color: city === c ? '#eab308' : '#71717a',
                fontFamily: "'Cormorant Garamond', serif",
                fontSize: '0.82rem', fontWeight: 700,
                cursor: 'pointer', transition: 'all 0.15s',
                boxShadow: city === c ? '0 0 10px rgba(234,179,8,0.1)' : 'none',
              }}
              onMouseEnter={e => { if (city !== c) e.currentTarget.style.color = '#eab308'; }}
              onMouseLeave={e => { if (city !== c) e.currentTarget.style.color = '#71717a'; }}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {/* ── City summary strip ──────────────────────────────── */}
      <div className="m-fadeUp" style={{
        animationDelay: '0.1s',
        display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12,
      }}>
        {[
          { label: 'Done', value: `${completedCount}/${totalMissions}`, color: '#4ade80' },
          { label: 'Ready', value: readyCount, color: readyCount > 0 ? '#eab308' : '#52525b' },
          { label: 'City', value: city, color: '#d4d4d8' },
        ].map(({ label, value, color }) => (
          <div key={label} style={{
            flex: '1 1 90px', padding: '7px 10px', borderRadius: 7,
            border: '1px solid rgba(39,39,42,0.8)',
            background: 'rgba(24,24,27,0.5)',
          }}>
            <div style={{ fontSize: '0.62rem', fontWeight: 700, color: '#52525b', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 2 }}>
              {label}
            </div>
            <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: '1rem', fontWeight: 700, color }}>
              {value}
            </div>
          </div>
        ))}
      </div>

      {/* ── Parallel missions note ──────────────────────────── */}
      {readyCount > 1 && (
        <div className="m-fadeUp" style={{
          animationDelay: '0.12s', marginBottom: 10,
          padding: '7px 10px', borderRadius: 7,
          background: 'rgba(234,179,8,0.04)', border: '1px solid rgba(234,179,8,0.15)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <Star size={12} style={{ color: '#eab308', flexShrink: 0 }} />
          <span style={{ fontFamily: "'Crimson Text', serif", fontSize: '0.78rem', color: '#a16207', fontStyle: 'italic' }}>
            {readyCount} missions ready — district jobs can be completed in any order.
          </span>
        </div>
      )}

      {/* ── Boss mission progress hint ──────────────────────── */}
      {bossM && !bossM.completed && bossReqCount !== null && (
        <div className="m-fadeUp" style={{
          animationDelay: '0.14s', marginBottom: 10,
          padding: '7px 10px', borderRadius: 7,
          background: bossM.requirements_met ? 'rgba(234,179,8,0.08)' : 'rgba(39,39,42,0.4)',
          border: `1px solid ${bossM.requirements_met ? 'rgba(234,179,8,0.4)' : 'rgba(63,63,70,0.5)'}`,
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <Skull size={12} style={{ color: bossM.requirements_met ? '#eab308' : '#52525b', flexShrink: 0 }} />
          <span style={{ fontFamily: "'Crimson Text', serif", fontSize: '0.78rem', color: bossM.requirements_met ? '#eab308' : '#71717a', fontStyle: 'italic' }}>
            {bossM.requirements_met
              ? `All requirements met — report to ${bossM.title}.`
              : `${bossDoneCount}/${bossReqCount} district missions done. Complete more to unlock "${bossM.title}".`
            }
          </span>
        </div>
      )}

      {/* ── District missions ───────────────────────────────── */}
      {areaNames.map((area, i) => (
        <AreaSection
          key={area}
          areaName={area}
          missions={areaMap[area].sort((a, b) => a.order - b.order)}
          onMissionClick={setSelected}
          delay={0.15 + i * 0.05}
          isBossArea={false}
        />
      ))}

      {/* ── Boss missions (always last) ─────────────────────── */}
      {bossMissions.length > 0 && (
        <>
          {/* Divider */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            margin: '16px 0 12px',
          }}>
            <div style={{ flex: 1, height: 1, background: 'linear-gradient(to right, transparent, rgba(234,179,8,0.3))' }} />
            <span style={{
              fontFamily: "'Cormorant Garamond', serif",
              fontSize: '0.75rem', fontWeight: 700, color: '#a16207',
              textTransform: 'uppercase', letterSpacing: '0.1em',
              display: 'flex', alignItems: 'center', gap: 5,
            }}>
              <Skull size={11} /> Final Jobs
            </span>
            <div style={{ flex: 1, height: 1, background: 'linear-gradient(to left, transparent, rgba(234,179,8,0.3))' }} />
          </div>
          {bossMissions.map((m, i) => (
            <MissionCard
              key={m.id}
              mission={m}
              onClick={setSelected}
              delay={0.15 + (areaNames.length + i) * 0.05}
            />
          ))}
        </>
      )}

      {/* ── Empty state ─────────────────────────────────────── */}
      {cityMissions.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: '#52525b' }}>
          <BookOpen size={32} style={{ opacity: 0.3, marginBottom: 10 }} />
          <p style={{ fontFamily: "'Crimson Text', serif", fontStyle: 'italic' }}>No missions available in {city}.</p>
        </div>
      )}

      {/* ── Mission detail modal ─────────────────────────────── */}
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
