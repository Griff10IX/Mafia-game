import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { Star, TrendingUp, Shield, Car, Crosshair, ChevronRight, Lock, Check } from 'lucide-react';
import api from '../utils/api';
import PrestigeBadge from '../components/PrestigeBadge';
import styles from '../styles/noir.module.css';
import { useUser } from '../context/UserContext';

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
  { key: 'crime_mult',    icon: Shield,    label: 'Crime payout',        fmt: v => `+${Math.round((v - 1) * 100)}%` },
  { key: 'oc_mult',       icon: TrendingUp, label: 'OC payout',           fmt: v => `+${Math.round((v - 1) * 100)}%` },
  { key: 'gta_rare_boost',icon: Car,        label: 'GTA rare car weight',  fmt: v => `+${v}× rare` },
  { key: 'npc_mult',      icon: Crosshair,  label: 'NPC hitlist rewards',  fmt: v => `+${Math.round((v - 1) * 100)}%` },
];

export default function Prestige() {
  const { refreshUser } = useUser();
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activating, setActivating] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const fetchInfo = useCallback(async () => {
    try {
      const res = await api.get('/prestige/info');
      setInfo(res.data);
    } catch (e) {
      toast.error('Failed to load prestige info');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchInfo(); }, [fetchInfo]);

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

  const level = info.prestige_level;
  const color = PRESTIGE_COLORS[level] || PRESTIGE_COLORS[0];
  const nextColor = PRESTIGE_COLORS[level + 1] || PRESTIGE_COLORS[5];
  const godReq = info.godfather_req;
  const effectiveRp = info.effective_rank_points;

  return (
    <div className={`space-y-4 ${styles.pageContent}`}>
      <style>{`
        @keyframes prestige-glow { 0%, 100% { opacity: 0.4; } 50% { opacity: 0.85; } }
        .prestige-glow { animation: prestige-glow 3s ease-in-out infinite; }
        @keyframes prestige-fade { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        .prestige-fade { animation: prestige-fade 0.4s ease-out both; }
      `}</style>

      {/* Header */}
      <div className={`relative ${styles.panel} rounded-xl overflow-hidden prestige-fade`} style={{ borderColor: `${color}30`, borderWidth: 1, borderStyle: 'solid' }}>
        <div className="h-0.5" style={{ background: `linear-gradient(90deg, transparent, ${color}80, transparent)` }} />
        <div className="absolute top-0 left-0 w-40 h-40 rounded-full blur-3xl pointer-events-none prestige-glow" style={{ backgroundColor: `${color}08` }} />
        <div className="px-5 py-5 flex flex-wrap items-center gap-4">
          <div>
            {level > 0
              ? <PrestigeBadge level={level} size="lg" showLabel />
              : <span className="inline-flex items-center gap-1.5 text-zinc-600 text-xs font-heading"><Star size={14} /> No Prestige Yet</span>
            }
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[9px] text-zinc-600 font-heading uppercase tracking-[0.25em] mb-0.5">La Cosa Nostra — Prestige</p>
            <h1 className="text-xl font-heading font-bold uppercase tracking-wider" style={{ color }}>
              {level > 0 ? info.prestige_name : 'Begin Your Legacy'}
            </h1>
            {level > 0 && <p className="text-[10px] text-zinc-500 font-heading mt-0.5">Prestige Level {level} of 5</p>}
          </div>
          {info.can_prestige && (
            <button
              onClick={() => setShowConfirm(true)}
              disabled={activating}
              className="px-4 py-2.5 rounded-lg text-xs font-heading font-bold uppercase tracking-widest transition-all"
              style={{ background: `${nextColor}20`, border: `1px solid ${nextColor}50`, color: nextColor, boxShadow: `0 0 12px ${nextColor}25` }}
            >
              {activating ? 'Prestiging...' : `Prestige → Level ${level + 1}`}
            </button>
          )}
          {info.at_max_prestige && (
            <span className="px-3 py-2 rounded-lg text-[10px] font-heading font-bold uppercase tracking-widest border" style={{ borderColor: `${color}40`, color, backgroundColor: `${color}10` }}>
              MAX PRESTIGE
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Progress to next prestige */}
        <div className={`${styles.panel} rounded-xl overflow-hidden prestige-fade`} style={{ animationDelay: '0.05s' }}>
          <div className="px-4 py-3 border-b border-zinc-700/30 flex items-center gap-2">
            <TrendingUp size={14} style={{ color: nextColor }} />
            <span className="text-xs font-heading font-bold uppercase tracking-widest" style={{ color: nextColor }}>
              {info.at_max_prestige ? 'Maximum Reached' : `Path to Prestige ${level + 1}`}
            </span>
          </div>
          <div className="p-4 space-y-3">
            {info.at_max_prestige ? (
              <div className="text-center py-4">
                <Star size={28} className="mx-auto mb-2" style={{ color }} />
                <p className="text-xs font-heading" style={{ color }}>You have reached the pinnacle.</p>
                <p className="text-[10px] text-zinc-600 font-heading mt-1 italic">Godfather Legacy — feared by all.</p>
              </div>
            ) : (
              <>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] font-heading text-zinc-500">Rank Progress</span>
                    <span className="text-[10px] font-heading font-bold" style={{ color: nextColor }}>
                      {effectiveRp.toLocaleString()} / {godReq?.toLocaleString()}
                    </span>
                  </div>
                  <ProgressBar value={effectiveRp} max={godReq} color={nextColor} />
                  <p className="text-[9px] text-zinc-600 font-heading mt-1">
                    Reach Godfather rank ({(400000).toLocaleString()} base points × {info.all_levels?.find(l => l.level === level + 1)?.godfather_req / 400000 || 1}x) to unlock prestige
                  </p>
                </div>
                <div className="space-y-1 text-[10px] font-heading text-zinc-500">
                  <div className="flex justify-between">
                    <span>Current rank points</span>
                    <span className="text-foreground">{info.rank_points.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Effective rank points</span>
                    <span className="text-foreground">{effectiveRp.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Current rank</span>
                    <span className="text-primary font-bold">{info.rank_name}</span>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Active benefits */}
        <div className={`${styles.panel} rounded-xl overflow-hidden prestige-fade`} style={{ animationDelay: '0.1s' }}>
          <div className="px-4 py-3 border-b border-zinc-700/30 flex items-center gap-2">
            <Star size={14} style={{ color }} />
            <span className="text-xs font-heading font-bold uppercase tracking-widest" style={{ color }}>
              {level > 0 ? 'Your Active Benefits' : 'Benefits Await'}
            </span>
          </div>
          <div className="p-4 space-y-2">
            {level === 0 ? (
              <p className="text-[10px] text-zinc-500 font-heading italic">Reach Godfather rank and prestige to unlock passive bonuses on all activities.</p>
            ) : (
              BENEFIT_ROWS.map(({ key, icon: Icon, label, fmt }) => {
                const val = info.current_benefits?.[key] ?? (key === 'gta_rare_boost' ? 0 : 1);
                return (
                  <div key={key} className="flex items-center justify-between px-3 py-2 rounded-lg" style={{ backgroundColor: `${color}08`, border: `1px solid ${color}15` }}>
                    <div className="flex items-center gap-2">
                      <Icon size={12} style={{ color }} />
                      <span className="text-[10px] font-heading text-zinc-400">{label}</span>
                    </div>
                    <span className="text-[10px] font-heading font-bold" style={{ color }}>{fmt(val)}</span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* All prestige levels table */}
      <div className={`${styles.panel} rounded-xl overflow-hidden prestige-fade`} style={{ animationDelay: '0.15s' }}>
        <div className="px-4 py-3 border-b border-zinc-700/30 flex items-center gap-2">
          <Shield size={14} className="text-zinc-400" />
          <span className="text-xs font-heading font-bold text-zinc-400 uppercase tracking-widest">All Prestige Levels</span>
        </div>
        <div className="overflow-x-auto">
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
                const isCurrent = row.level === level;
                const isUnlocked = row.level <= level;
                const rowColor = PRESTIGE_COLORS[row.level];
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
                        {isCurrent && <span className="text-[8px] font-bold uppercase tracking-widest" style={{ color: rowColor }}>YOU</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2.5" style={{ color: isUnlocked ? rowColor : '#52525b' }}>{row.name}</td>
                    <td className="px-3 py-2.5 text-center text-zinc-500">{(row.godfather_req || 0).toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-center" style={{ color: isUnlocked ? rowColor : '#52525b' }}>+{Math.round((row.crime_mult - 1) * 100)}%</td>
                    <td className="px-3 py-2.5 text-center" style={{ color: isUnlocked ? rowColor : '#52525b' }}>+{Math.round((row.oc_mult - 1) * 100)}%</td>
                    <td className="px-3 py-2.5 text-center" style={{ color: isUnlocked ? rowColor : '#52525b' }}>+{row.gta_rare_boost}×</td>
                    <td className="px-3 py-2.5 text-center" style={{ color: isUnlocked ? rowColor : '#52525b' }}>+{Math.round((row.npc_mult - 1) * 100)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Confirm modal */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-sm" onClick={() => setShowConfirm(false)}>
          <div className={`relative w-full max-w-sm ${styles.panel} rounded-xl overflow-hidden shadow-2xl`}
            style={{ border: `1px solid ${nextColor}40` }}
            onClick={e => e.stopPropagation()}
          >
            <div className="h-0.5" style={{ background: `linear-gradient(90deg, transparent, ${nextColor}80, transparent)` }} />
            <div className="p-5 space-y-4">
              <div className="text-center">
                <PrestigeBadge level={level + 1} size="lg" showLabel />
                <h2 className="text-base font-heading font-bold mt-3 uppercase tracking-wider" style={{ color: nextColor }}>
                  Prestige to Level {level + 1}
                </h2>
              </div>
              <div className="space-y-2 text-[10px] font-heading text-zinc-400">
                <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-500/5 border border-red-500/15">
                  <span className="text-red-400 mt-0.5">⚠</span>
                  <span>Your rank will reset to <strong className="text-red-400">Rat</strong> and rank points will return to 0. This cannot be undone.</span>
                </div>
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/5 border border-emerald-500/15">
                  <Check size={10} className="text-emerald-400 shrink-0" />
                  <span>Money, cars, bullets, family and casino ownership are <strong className="text-emerald-400">kept</strong>.</span>
                </div>
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ backgroundColor: `${nextColor}08`, border: `1px solid ${nextColor}20` }}>
                  <Star size={10} style={{ color: nextColor }} className="shrink-0" />
                  <span style={{ color: nextColor }}>You will gain all Prestige {level + 1} benefits (stacking on current).</span>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowConfirm(false)}
                  className="flex-1 py-2.5 rounded-lg text-xs font-heading font-bold uppercase tracking-wider border border-zinc-600/40 text-zinc-400 hover:border-zinc-500 transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={handlePrestige}
                  disabled={activating}
                  className="flex-1 py-2.5 rounded-lg text-xs font-heading font-bold uppercase tracking-wider transition-all"
                  style={{ background: `${nextColor}20`, border: `1px solid ${nextColor}60`, color: nextColor }}
                >
                  {activating ? 'Activating...' : 'Confirm Prestige'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
