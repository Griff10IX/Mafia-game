import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { Star, TrendingUp, Shield, Car, Crosshair, Lock, Check, ChevronRight } from 'lucide-react';
import api, { refreshUser } from '../utils/api';
import PrestigeBadge from '../components/PrestigeBadge';
import styles from '../styles/noir.module.css';

const PRESTIGE_COLORS = {
  0: '#71717a',
  1: '#cd7f32',
  2: '#a8a9ad',
  3: '#ffd700',
  4: '#b9f2ff',
  5: '#dc2626',
};

const ROMAN = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV', 5: 'V' };

function ProgressBar({ value, max, color }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="relative h-2 rounded-full bg-zinc-800/60 overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-700"
        style={{ width: `${pct}%`, backgroundColor: color, boxShadow: pct > 0 ? `0 0 8px ${color}60` : undefined }}
      />
    </div>
  );
}

const BENEFIT_ROWS = [
  { key: 'crime_mult',     icon: Shield,     label: 'Crime Payout',       fmt: v => `+${Math.round((v - 1) * 100)}%` },
  { key: 'oc_mult',        icon: TrendingUp, label: 'OC Payout',          fmt: v => `+${Math.round((v - 1) * 100)}%` },
  { key: 'gta_rare_boost', icon: Car,        label: 'GTA Rare Cars',      fmt: v => `+${v}×` },
  { key: 'npc_mult',       icon: Crosshair,  label: 'NPC Rewards',        fmt: v => `+${Math.round((v - 1) * 100)}%` },
];

// Horizontally scrollable level card for mobile levels section
function LevelCard({ row, isCurrent, isUnlocked }) {
  const color = PRESTIGE_COLORS[row.level];
  return (
    <div
      className="flex-shrink-0 flex flex-col gap-1.5 rounded-xl p-3 border transition-all"
      style={{
        width: 120,
        borderColor: isCurrent ? color : isUnlocked ? `${color}40` : 'rgba(63,63,70,0.5)',
        backgroundColor: isCurrent ? `${color}0a` : isUnlocked ? `${color}05` : 'transparent',
        boxShadow: isCurrent ? `0 0 0 1px ${color}` : undefined,
      }}
    >
      {/* Badge */}
      <div className="flex items-center gap-2">
        {isUnlocked ? (
          <PrestigeBadge level={row.level} size="sm" />
        ) : (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-bold text-zinc-700 border border-zinc-700/50 font-heading">
            <Lock size={7} /> {ROMAN[row.level]}
          </span>
        )}
        {isCurrent && (
          <span
            className="text-[7px] font-heading font-black uppercase tracking-widest px-1.5 py-0.5 rounded"
            style={{ color, backgroundColor: `${color}20` }}
          >
            YOU
          </span>
        )}
      </div>

      {/* Name */}
      <div
        className="text-[9px] font-heading font-bold uppercase tracking-wide leading-tight"
        style={{ color: isUnlocked ? color : '#52525b' }}
      >
        {row.name}
      </div>

      {/* Req */}
      <div className="text-[8px] font-heading text-zinc-600 tabular-nums">
        {(row.godfather_req || 0).toLocaleString()} RP
      </div>

      {/* Stats */}
      <div className="flex flex-col gap-1 mt-0.5 pt-2 border-t border-zinc-800/60">
        {[
          ['Crime', `+${Math.round((row.crime_mult - 1) * 100)}%`],
          ['OC',    `+${Math.round((row.oc_mult    - 1) * 100)}%`],
          ['GTA',   `+${row.gta_rare_boost}×`],
          ['NPC',   `+${Math.round((row.npc_mult   - 1) * 100)}%`],
        ].map(([label, val]) => (
          <div key={label} className="flex justify-between items-center text-[8px] font-heading">
            <span className="text-zinc-600">{label}</span>
            <span style={{ color: isUnlocked ? color : '#52525b' }} className="font-bold tabular-nums">{val}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Prestige() {
  const [info, setInfo]           = useState(null);
  const [loading, setLoading]     = useState(true);
  const [activating, setActivating] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const levelsScrollRef = useRef(null);

  const fetchInfo = useCallback(async () => {
    try {
      const res = await api.get('/prestige/info');
      setInfo(res.data);
    } catch {
      toast.error('Failed to load prestige info');
    } finally {
      setLoading(false);
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
      await refreshUser();
      await fetchInfo();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Failed to prestige');
    } finally {
      setActivating(false);
    }
  };

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <span className="text-primary text-[10px] font-heading uppercase tracking-[0.3em]">Loading...</span>
    </div>
  );

  if (!info) return (
    <div className="text-center py-20 text-zinc-600 text-xs font-heading">Failed to load prestige data.</div>
  );

  const level     = info.prestige_level;
  const color     = PRESTIGE_COLORS[level]     || PRESTIGE_COLORS[0];
  const nextColor = PRESTIGE_COLORS[level + 1] || PRESTIGE_COLORS[5];
  const godReq    = info.godfather_req;
  const effectiveRp = info.effective_rank_points;

  return (
    <div className={`space-y-3 md:space-y-4 ${styles.pageContent}`}>
      <style>{`
        @keyframes prestige-glow { 0%, 100% { opacity: 0.4; } 50% { opacity: 0.85; } }
        .prestige-glow { animation: prestige-glow 3s ease-in-out infinite; }
        @keyframes prestige-fade { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        .prestige-fade { animation: prestige-fade 0.4s ease-out both; }
        .levels-scroll::-webkit-scrollbar { display: none; }
        .levels-scroll { scrollbar-width: none; -webkit-overflow-scrolling: touch; }
      `}</style>

      {/* ── HERO CARD ──────────────────────────────────────────────────── */}
      <div
        className={`relative ${styles.panel} rounded-xl overflow-hidden prestige-fade`}
        style={{ borderColor: `${color}30`, borderWidth: 1, borderStyle: 'solid' }}
      >
        <div className="h-0.5" style={{ background: `linear-gradient(90deg, transparent, ${color}80, transparent)` }} />

        <div className="px-4 py-4 md:px-5 md:py-5">
          {/* Badge + name row — compact on mobile */}
          <div className="flex items-center gap-3 mb-3">
            <div className="shrink-0">
              {level > 0
                ? <PrestigeBadge level={level} size="lg" showLabel />
                : <span className="inline-flex items-center gap-1.5 text-zinc-600 text-xs font-heading"><Star size={14} /> No Prestige Yet</span>
              }
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[9px] text-zinc-600 font-heading uppercase tracking-[0.2em] mb-0.5 hidden sm:block">
                La Cosa Nostra — Prestige
              </p>
              <h1
                className="text-lg md:text-xl font-heading font-bold uppercase tracking-wider leading-tight"
                style={{ color }}
              >
                {level > 0 ? info.prestige_name : 'Begin Your Legacy'}
              </h1>
              {level > 0 && (
                <p className="text-[10px] text-zinc-500 font-heading mt-0.5">Level {level} of 5</p>
              )}
            </div>
            {/* MAX badge on desktop — on mobile moves below */}
            {info.at_max_prestige && (
              <span
                className="hidden sm:inline px-3 py-2 rounded-lg text-[10px] font-heading font-bold uppercase tracking-widest border shrink-0"
                style={{ borderColor: `${color}40`, color, backgroundColor: `${color}10` }}
              >
                MAX
              </span>
            )}
          </div>

          {/* ── MOBILE: benefit chips row ─────────────────────────────── */}
          {level > 0 && (
            <div className="flex gap-2 mb-3 md:hidden">
              {BENEFIT_ROWS.map(({ key, label, fmt }) => {
                const val = info.current_benefits?.[key] ?? (key === 'gta_rare_boost' ? 0 : 1);
                // short label for chips
                const short = label.split(' ')[0];
                return (
                  <div
                    key={key}
                    className="flex-1 flex flex-col items-center py-1.5 px-1 rounded-lg border"
                    style={{ borderColor: `${color}22`, backgroundColor: `${color}07` }}
                  >
                    <span className="text-[7px] font-heading text-zinc-600 uppercase tracking-wider mb-0.5">{short}</span>
                    <span className="text-[11px] font-heading font-bold tabular-nums" style={{ color }}>{fmt(val)}</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── CTA button: full-width on mobile, inline on desktop ───── */}
          {info.can_prestige && (
            <button
              onClick={() => setShowConfirm(true)}
              disabled={activating}
              className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-xs font-heading font-bold uppercase tracking-widest transition-all active:scale-[0.98] touch-manipulation"
              style={{
                background: `${nextColor}18`,
                border: `1px solid ${nextColor}50`,
                color: nextColor,
                boxShadow: `0 0 16px ${nextColor}20`,
              }}
            >
              <Star size={13} />
              {activating ? 'Prestiging…' : `Prestige → Level ${level + 1}`}
            </button>
          )}

          {/* MAX badge on mobile */}
          {info.at_max_prestige && (
            <div
              className="sm:hidden mt-1 w-full flex items-center justify-center py-2.5 rounded-xl border text-[11px] font-heading font-bold uppercase tracking-widest"
              style={{ borderColor: `${color}40`, color, backgroundColor: `${color}10` }}
            >
              MAX PRESTIGE
            </div>
          )}
        </div>
      </div>

      {/* ── PROGRESS — full-width on mobile ────────────────────────────── */}
      {!info.at_max_prestige && (
        <div
          className={`${styles.panel} rounded-xl overflow-hidden prestige-fade`}
          style={{ animationDelay: '0.05s' }}
        >
          <div className="px-4 py-3 border-b border-zinc-800/40 flex items-center gap-2">
            <TrendingUp size={14} style={{ color: nextColor }} />
            <span className="text-xs font-heading font-bold uppercase tracking-widest" style={{ color: nextColor }}>
              Path to Prestige {level + 1}
            </span>
          </div>
          <div className="p-4 space-y-3">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-heading text-zinc-500">Rank Points</span>
                <span className="text-[10px] font-heading font-bold tabular-nums" style={{ color: nextColor }}>
                  {effectiveRp.toLocaleString()} / {godReq?.toLocaleString()}
                </span>
              </div>
              <ProgressBar value={effectiveRp} max={godReq} color={nextColor} />
              <p className="text-[9px] text-zinc-600 font-heading mt-1.5">
                Reach Godfather ({(400_000).toLocaleString()} base pts ×{' '}
                {info.all_levels?.find(l => l.level === level + 1)?.godfather_req / 400_000 || 1}×) to unlock
              </p>
            </div>

            {/* Stat rows */}
            <div className="flex flex-col gap-1.5 pt-1">
              {[
                ['Current rank',   info.rank_name, 'primary'],
                ['Rank points',    info.rank_points.toLocaleString(), 'fg'],
                ['Effective RP',   effectiveRp.toLocaleString(), 'fg'],
              ].map(([label, val, tone]) => (
                <div key={label} className="flex justify-between items-center text-[10px] font-heading">
                  <span className="text-zinc-500">{label}</span>
                  <span
                    className={`font-bold tabular-nums ${tone === 'primary' ? 'text-primary' : 'text-foreground'}`}
                  >
                    {val}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* MAX PRESTIGE reached */}
      {info.at_max_prestige && (
        <div
          className={`${styles.panel} rounded-xl overflow-hidden prestige-fade`}
          style={{ animationDelay: '0.05s' }}
        >
          <div className="px-4 py-3 border-b border-zinc-800/40 flex items-center gap-2">
            <TrendingUp size={14} style={{ color }} />
            <span className="text-xs font-heading font-bold uppercase tracking-widest" style={{ color }}>Maximum Reached</span>
          </div>
          <div className="p-6 text-center">
            <Star size={28} className="mx-auto mb-2" style={{ color }} />
            <p className="text-xs font-heading" style={{ color }}>You have reached the pinnacle.</p>
            <p className="text-[10px] text-zinc-600 font-heading mt-1 italic">Godfather Legacy — feared by all.</p>
          </div>
        </div>
      )}

      {/* ── BENEFITS — 2×2 grid on mobile, list on desktop ─────────────── */}
      <div
        className={`${styles.panel} rounded-xl overflow-hidden prestige-fade`}
        style={{ animationDelay: '0.1s' }}
      >
        <div className="px-4 py-3 border-b border-zinc-800/40 flex items-center gap-2">
          <Star size={14} style={{ color }} />
          <span className="text-xs font-heading font-bold uppercase tracking-widest" style={{ color }}>
            {level > 0 ? 'Active Benefits' : 'Benefits Await'}
          </span>
        </div>

        {level === 0 ? (
          <div className="p-4">
            <p className="text-[10px] text-zinc-500 font-heading italic">
              Reach Godfather rank and prestige to unlock passive bonuses on all activities.
            </p>
          </div>
        ) : (
          /* 2×2 grid on mobile; single-col list on md+ */
          <div className="grid grid-cols-2 md:grid-cols-1 gap-2 p-3 md:p-4">
            {BENEFIT_ROWS.map(({ key, icon: Icon, label, fmt }) => {
              const val = info.current_benefits?.[key] ?? (key === 'gta_rare_boost' ? 0 : 1);
              return (
                <div
                  key={key}
                  className="flex flex-col md:flex-row md:items-center md:justify-between gap-1 md:gap-2 px-3 py-3 md:py-2 rounded-xl"
                  style={{ backgroundColor: `${color}08`, border: `1px solid ${color}15` }}
                >
                  {/* Icon + label */}
                  <div className="flex items-center gap-2">
                    <Icon size={12} style={{ color }} className="shrink-0" />
                    <span className="text-[9px] md:text-[10px] font-heading text-zinc-400 leading-tight">{label}</span>
                  </div>
                  {/* Value — large on mobile for scannability */}
                  <span
                    className="text-base md:text-[10px] font-heading font-bold tabular-nums leading-none"
                    style={{ color }}
                  >
                    {fmt(val)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── ALL LEVELS ─────────────────────────────────────────────────────
           Mobile: horizontal scroll cards
           Desktop: traditional table
      ─────────────────────────────────────────────────────────────────── */}
      <div
        className={`${styles.panel} rounded-xl overflow-hidden prestige-fade`}
        style={{ animationDelay: '0.15s' }}
      >
        <div className="px-4 py-3 border-b border-zinc-800/40 flex items-center gap-2">
          <Shield size={14} className="text-zinc-400" />
          <span className="text-xs font-heading font-bold text-zinc-400 uppercase tracking-widest">
            All Prestige Levels
          </span>
          {/* Scroll hint on mobile */}
          <span className="ml-auto text-[8px] font-heading text-zinc-700 uppercase tracking-wider md:hidden">
            ← swipe →
          </span>
        </div>

        {/* ── MOBILE: horizontal card scroll ── */}
        <div
          ref={levelsScrollRef}
          className="levels-scroll md:hidden flex gap-2.5 overflow-x-auto px-3 py-3"
        >
          {(info.all_levels || []).map((row) => (
            <div key={row.level} data-level={row.level}>
              <LevelCard
                row={row}
                isCurrent={row.level === level}
                isUnlocked={row.level <= level}
              />
            </div>
          ))}
        </div>

        {/* ── DESKTOP: table (unchanged) ── */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-[10px] font-heading">
            <thead>
              <tr className="border-b border-zinc-800/60">
                <th className="text-left px-4 py-2 text-zinc-600 font-bold uppercase tracking-widest">Level</th>
                <th className="text-left px-3 py-2 text-zinc-600 font-bold uppercase tracking-widest">Title</th>
                <th className="text-center px-3 py-2 text-zinc-600 font-bold uppercase tracking-widest">Req. RP</th>
                <th className="text-center px-3 py-2 text-zinc-600 font-bold uppercase tracking-widest">Crime</th>
                <th className="text-center px-3 py-2 text-zinc-600 font-bold uppercase tracking-widest">OC</th>
                <th className="text-center px-3 py-2 text-zinc-600 font-bold uppercase tracking-widest">GTA Rare</th>
                <th className="text-center px-3 py-2 text-zinc-600 font-bold uppercase tracking-widest">NPC</th>
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
                    <td className="px-4 py-2.5">
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
                    <td className="px-3 py-2.5" style={{ color: isUnlocked ? rowColor : '#52525b' }}>{row.name}</td>
                    <td className="px-3 py-2.5 text-center text-zinc-500 tabular-nums">{(row.godfather_req || 0).toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-center tabular-nums" style={{ color: isUnlocked ? rowColor : '#52525b' }}>+{Math.round((row.crime_mult - 1) * 100)}%</td>
                    <td className="px-3 py-2.5 text-center tabular-nums" style={{ color: isUnlocked ? rowColor : '#52525b' }}>+{Math.round((row.oc_mult    - 1) * 100)}%</td>
                    <td className="px-3 py-2.5 text-center tabular-nums" style={{ color: isUnlocked ? rowColor : '#52525b' }}>+{row.gta_rare_boost}×</td>
                    <td className="px-3 py-2.5 text-center tabular-nums" style={{ color: isUnlocked ? rowColor : '#52525b' }}>+{Math.round((row.npc_mult   - 1) * 100)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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
                  <span>Money, cars, bullets, family and casino ownership are <strong className="text-emerald-400">kept</strong>.</span>
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
                  onClick={() => setShowConfirm(false)}
                  className="flex-1 py-3 rounded-xl text-xs font-heading font-bold uppercase tracking-wider border border-zinc-600/40 text-zinc-400 hover:border-zinc-500 transition-all touch-manipulation"
                >
                  Cancel
                </button>
                <button
                  onClick={handlePrestige}
                  disabled={activating}
                  className="flex-1 py-3 rounded-xl text-xs font-heading font-bold uppercase tracking-wider transition-all active:scale-[0.98] touch-manipulation"
                  style={{
                    background: `${nextColor}20`,
                    border: `1px solid ${nextColor}60`,
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
