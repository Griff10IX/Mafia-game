import { useState, useEffect, useCallback } from 'react';
import { Shield, ListChecks, Crosshair, TrendingUp, Lock, UserPlus, Star, AlertTriangle, ChevronRight } from 'lucide-react';
import api, { refreshUser, getApiErrorMessage } from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatMoney(n) {
  const num = Number(n ?? 0);
  if (Number.isNaN(num)) return '$0';
  return `$${Math.trunc(num).toLocaleString()}`;
}

// ─── Injected styles ──────────────────────────────────────────────────────────

const RACKET_STYLES = `
  @keyframes incomeGlow {
    0%,100% { box-shadow: 0 0 10px rgba(var(--noir-primary-rgb),.12); }
    50%      { box-shadow: 0 0 24px rgba(var(--noir-primary-rgb),.32); }
  }
  @keyframes rReveal {
    from { opacity:0; transform:translateY(8px); }
    to   { opacity:1; transform:translateY(0); }
  }
  @keyframes shimmer {
    0%   { left: -100%; }
    100% { left:  200%; }
  }
  @keyframes collectPulse {
    0%,100% { box-shadow: 0 0 0 0 rgba(var(--noir-primary-rgb),.0); }
    50%     { box-shadow: 0 0 0 5px rgba(var(--noir-primary-rgb),.08); }
  }

  .racket-page { animation: rReveal .3s ease both; }
  .income-glow { animation: incomeGlow 3s ease-in-out infinite; }

  .r-card { transition: border-color .2s, transform .15s; }
  .r-card:hover { border-color: rgba(var(--noir-primary-rgb),.32) !important; transform: translateY(-1px); }

  .collect-btn { position: relative; overflow: hidden; animation: collectPulse 2.5s ease-in-out infinite; }
  .collect-btn::after {
    content: '';
    position: absolute; top: 0; left: -100%;
    width: 55%; height: 100%;
    background: linear-gradient(90deg, transparent, rgba(var(--noir-primary-rgb),.10), transparent);
    animation: shimmer 2.8s ease-in-out infinite;
  }

  .r-bar-fill { transition: width .6s cubic-bezier(.4,0,.2,1); }

  .guard-empty { border-style: dashed !important; opacity: .45; }

  .dot-pip { width:7px; height:7px; border-radius:50%; display:inline-block; }
  .dot-on  { background: var(--noir-primary); box-shadow: 0 0 4px rgba(var(--noir-primary-rgb),.6); }
  .dot-off { background: transparent; border: 1px solid rgba(var(--noir-primary-rgb),.22); }

  .kill-reward-card { border-left: 3px solid rgba(var(--noir-primary-rgb),.45); background: rgba(var(--noir-primary-rgb),.04); }
  .raid-win  { border-left: 3px solid #34d399; background: rgba(52,211,153,.06); }
  .raid-fail { border-left: 3px solid #f87171; background: rgba(248,113,113,.06); }
  .mission-dot-done { background: var(--noir-primary); border-color: var(--noir-primary); box-shadow: 0 0 5px rgba(var(--noir-primary-rgb),.45); }
`;

// ─── Tiny reusables ───────────────────────────────────────────────────────────

function CardHead({ icon: Icon, title, right }) {
  return (
    <div className="px-4 py-2.5 bg-primary/8 border-b border-primary/15 flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        {Icon && <Icon size={13} className="text-primary shrink-0" />}
        <span className="font-heading font-bold text-primary uppercase tracking-[.13em] text-[10px]">{title}</span>
      </div>
      {right}
    </div>
  );
}

function BarStat({ label, value, max = 10, display }) {
  const pct = Math.min(100, Math.round((Number(value) / max) * 100));
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] font-heading uppercase tracking-widest text-mutedForeground">{label}</span>
        <span className="font-heading font-bold text-primary text-sm">{display ?? value}</span>
      </div>
      <div className="h-1 rounded-full bg-primary/10">
        <div className="r-bar-fill h-full rounded-full bg-gradient-to-r from-primary/55 to-primary" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function PipRow({ label, filled, total = 3 }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[9px] font-heading text-zinc-600 uppercase tracking-wider w-12 shrink-0">{label}</span>
      <div className="flex gap-1">
        {Array.from({ length: total }).map((_, i) => (
          <span key={i} className={`dot-pip ${i < filled ? 'dot-on' : 'dot-off'}`} />
        ))}
      </div>
    </div>
  );
}

function Tag({ children, variant = 'amber' }) {
  const c = {
    amber: 'bg-primary/15 text-primary border-primary/30',
    red:   'bg-red-500/12 text-red-400 border-red-500/28',
    green: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/28',
    zinc:  'bg-zinc-700/35 text-zinc-400 border-zinc-600/30',
  };
  return (
    <span className={`inline-block border px-2 py-0.5 rounded text-[9px] font-heading font-bold uppercase tracking-wider ${c[variant]}`}>
      {children}
    </span>
  );
}

// ─── Start-business screen ────────────────────────────────────────────────────

function StartScreen({ types, saving, onStart }) {
  const [typeId, setTypeId] = useState('speakeasy');
  const [name,   setName]   = useState('');

  const fallback = [
    { id: 'stolen_goods_fence', name: 'Stolen Goods Fence' },
    { id: 'booze_making',       name: 'Booze Making'       },
    { id: 'speakeasy',          name: 'Speakeasy'          },
    { id: 'numbers_racket',     name: 'Numbers Racket'     },
    { id: 'protection_racket',  name: 'Protection Racket'  },
  ];
  const list = types.length ? types : fallback;

  return (
    <div className="racket-page max-w-lg mx-auto space-y-5 py-2">
      <div className="text-center pb-4 border-b border-primary/15">
        <div className="text-[9px] font-heading tracking-[.28em] text-mutedForeground uppercase mb-2">Illegal Business</div>
        <h1 className="text-2xl font-heading font-bold text-primary tracking-wider">Open a Racket</h1>
        <p className="text-sm text-mutedForeground mt-2 font-body italic">
          Only a Capo or higher can run an operation. Choose your trade and stake your claim.
        </p>
      </div>

      <div className={`${styles.panel} r-card border border-primary/20 rounded-md overflow-hidden`}>
        <CardHead icon={TrendingUp} title="Choose Your Operation" />
        <div className="p-4 space-y-4">
          <div>
            <label className="block text-[10px] font-heading uppercase tracking-widest text-mutedForeground mb-2">
              Business Type
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {list.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTypeId(t.id)}
                  className={`px-3 py-2.5 rounded border text-left text-xs font-heading transition-all ${
                    typeId === t.id
                      ? 'bg-primary/15 border-primary/50 text-primary'
                      : 'border-zinc-700/50 text-mutedForeground hover:border-primary/30 hover:text-foreground'
                  }`}
                >
                  {t.name}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-heading uppercase tracking-widest text-mutedForeground mb-2">
              Name <span className="normal-case tracking-normal opacity-55">(optional)</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. The Hideaway…"
              className="w-full px-3 py-2.5 bg-zinc-900/60 border border-zinc-700/50 rounded text-sm text-foreground placeholder:text-zinc-600 focus:border-primary/50 focus:outline-none"
            />
          </div>
          <button
            onClick={() => onStart(typeId, name)}
            disabled={saving || !typeId}
            className="collect-btn w-full py-3 bg-primary/20 text-primary font-heading font-bold uppercase tracking-widest text-xs rounded border border-primary/40 hover:bg-primary/30 disabled:opacity-40 transition-all"
          >
            {saving ? 'Taking over…' : 'Open the Operation'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function IllegalBusiness() {
  const [data,       setData]       = useState(null);
  const [types,      setTypes]      = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [saving,     setSaving]     = useState(false);
  const [raidTarget, setRaidTarget] = useState('');
  const [raidState,  setRaidState]  = useState('');
  const [raidResult, setRaidResult] = useState(null);

  // ── Fetch ──────────────────────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [res, typesRes] = await Promise.all([
        api.get('/illegal-business').catch((e) => ({ ...e, response: e.response })),
        api.get('/illegal-business/types').catch(() => ({ data: { types: [] } })),
      ]);
      if (typesRes?.data?.types) setTypes(typesRes.data.types);
      if (res.response?.status === 404) {
        setData({ noBusiness: true });
      } else if (res.data) {
        setData(res.data);
      } else {
        toast.error(getApiErrorMessage(res));
      }
    } catch (e) {
      if (e.response?.status === 404) setData({ noBusiness: true });
      else toast.error(getApiErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Actions ────────────────────────────────────────────────────────────────

  const withSave = (fn) => async (...args) => {
    if (saving) return;
    setSaving(true);
    try { await fn(...args); }
    catch (e) { toast.error(getApiErrorMessage(e)); }
    finally { setSaving(false); }
  };

  const handleStart = withSave(async (typeId, name) => {
    await api.post('/illegal-business/start', { type_id: typeId, name: name || undefined });
    toast.success("You've taken over a joint.");
    refreshUser(); fetchData();
  });

  const handleCollect = withSave(async () => {
    const res = await api.post('/illegal-business/collect');
    toast.success(res.data?.message || 'Collected.');
    if (res.data?.cash != null) refreshUser();
    fetchData();
  });

  const handleHireGuard = withSave(async (slotNumber, armourLevel = 0, weaponLevel = 0) => {
    await api.post('/illegal-business/guards/hire', { slot_number: slotNumber, armour_level: armourLevel, weapon_level: weaponLevel });
    toast.success('Another pair of hands on the door.');
    refreshUser(); fetchData();
  });

  const handleUpgradeSecurity = withSave(async (upgradeId) => {
    await api.post(`/illegal-business/security/upgrade/${upgradeId}`);
    toast.success('Upgrade installed.');
    refreshUser(); fetchData();
  });

  const handleCompleteMission = withSave(async (missionId) => {
    const res = await api.post(`/illegal-business/missions/${missionId}/complete`);
    toast.success(res.data?.message || 'Mission complete.');
    fetchData();
  });

  const handleRaid = withSave(async () => {
    if (!raidTarget.trim()) return;
    setRaidResult(null);
    const res = await api.post('/illegal-business/raid', {
      target_username: raidTarget.trim(),
      state: raidState || undefined,
    });
    setRaidResult(res.data);
    toast.success(res.data?.message);
    if (res.data?.loot_cash) refreshUser();
    fetchData();
  });

  const handleClaimKillReward = withSave(async (victimId, choice) => {
    const res = await api.post('/illegal-business/claim-kill-reward', { victim_id: victimId, choice });
    toast.success(res.data?.message);
    if (res.data?.cash) refreshUser();
    fetchData();
  });

  // ── Loading ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className={styles.pageContent}>
        <div className="flex items-center justify-center min-h-[200px]">
          <div className="flex flex-col items-center gap-3">
            <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            <span className="text-[10px] font-heading text-mutedForeground tracking-widest uppercase">Loading…</span>
          </div>
        </div>
      </div>
    );
  }

  if (data?.noBusiness) {
    return (
      <div className={styles.pageContent}>
        <style>{RACKET_STYLES}</style>
        <StartScreen types={types} saving={saving} onStart={handleStart} />
      </div>
    );
  }

  // ── Derived ────────────────────────────────────────────────────────────────

  const business       = data?.business;
  const guards         = data?.guards || [];
  const typeInfo       = data?.type_info || {};
  const pendingRewards = data?.pending_kill_rewards || [];
  const securityList   = data?.security_upgrades_list || [];
  const guardSlots     = business?.guard_slots ?? 2;
  const upgradesDone   = business?.security_upgrades || [];
  const nextUpgradeIdx = upgradesDone.length;
  const nextUpgrade    = nextUpgradeIdx < securityList.length ? securityList[nextUpgradeIdx] : null;
  const missions       = Array.isArray(data?.missions) ? data.missions : [];

  const heatLevel   = business?.heat_level ?? 0;
  const heatVariant = heatLevel > 6 ? 'red' : heatLevel > 3 ? 'amber' : 'green';
  const heatLabel   = heatLevel > 6 ? 'High Heat' : heatLevel > 3 ? 'Moderate' : 'Running Cold';

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className={`${styles.pageContent} racket-page`}>
      <style>{RACKET_STYLES}</style>

      <div className="space-y-4">

        {/* ── Header ──────────────────────────────────────────── */}
        <div className="flex flex-wrap items-end justify-between gap-3 pb-3 border-b border-primary/15">
          <div>
            <div className="text-[9px] font-heading tracking-[.28em] text-mutedForeground uppercase mb-1">Illegal Business</div>
            <h1 className="text-xl sm:text-2xl font-heading font-bold text-primary tracking-wider leading-none">
              {business?.name || typeInfo?.name || 'Racket'}
            </h1>
            <div className="flex flex-wrap items-center gap-2 mt-1.5">
              <span className="text-xs font-body italic text-mutedForeground">{typeInfo?.name}</span>
              {business?.state && <span className="text-[10px] text-zinc-600">· {business.state}</span>}
              <Tag variant={heatVariant}>{heatLabel}</Tag>
            </div>
          </div>

          {/* Income badge */}
          <div className="income-glow border border-primary/25 rounded-md px-4 py-2.5 text-right bg-primary/5 shrink-0">
            <div className="text-[9px] font-heading tracking-[.2em] text-mutedForeground uppercase">Per Hour</div>
            <div className="text-2xl font-heading font-bold text-primary leading-none mt-0.5">
              {formatMoney(business?.income_per_hour)}
            </div>
            {business?.type_id === 'booze_making' && business?.booze_per_hour != null && (
              <div className="text-[10px] text-mutedForeground mt-0.5">{business.booze_per_hour} booze/hr</div>
            )}
          </div>
        </div>

        {/* ── Kill rewards ─────────────────────────────────────── */}
        {pendingRewards.length > 0 && (
          <div className={`${styles.panel} r-card border border-primary/25 rounded-md overflow-hidden`}>
            <CardHead icon={Star} title="Claim Your Reward" />
            <div className="p-4 space-y-2.5">
              {pendingRewards.map((p) => (
                <div key={p.victim_id} className="kill-reward-card flex flex-wrap items-center gap-3 p-3 rounded">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-heading font-bold text-foreground">{p.victim_username}</div>
                    <div className="text-[10px] text-mutedForeground">had {formatMoney(p.total_spent)} invested</div>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <button
                      onClick={() => handleClaimKillReward(p.victim_id, 'cash')}
                      disabled={saving}
                      className="px-3 py-1.5 bg-primary/15 text-primary border border-primary/35 rounded text-[10px] font-heading font-bold uppercase tracking-wider hover:bg-primary/25 disabled:opacity-40 transition-all"
                    >
                      Take Cash
                    </button>
                    {p.moderately_upgraded && (
                      <button
                        onClick={() => handleClaimKillReward(p.victim_id, 'income_boost')}
                        disabled={saving}
                        className="px-3 py-1.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/28 rounded text-[10px] font-heading font-bold uppercase tracking-wider hover:bg-emerald-500/18 disabled:opacity-40 transition-all"
                      >
                        +2% Income
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Collect banner ───────────────────────────────────── */}
        <div className={`${styles.panel} r-card border border-primary/25 rounded-md overflow-hidden`}>
          <CardHead icon={TrendingUp} title="Cash on the Table" />
          <div className="p-4 flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-[10px] font-heading uppercase tracking-widest text-mutedForeground mb-0.5">Awaiting Collection</div>
              <div className="text-3xl font-heading font-bold text-primary leading-none">
                {formatMoney(business?.pending_cash ?? 0)}
              </div>
              <div className="text-[10px] text-zinc-500 mt-1 font-heading">
                Level {business?.level ?? 1} &nbsp;·&nbsp; Security {business?.security_level ?? 0} &nbsp;·&nbsp; {guards.length}/{guardSlots} guards
              </div>
            </div>
            <button
              onClick={handleCollect}
              disabled={saving}
              className="collect-btn px-6 py-3 bg-primary/20 text-primary font-heading font-bold uppercase tracking-widest text-xs rounded border border-primary/40 hover:bg-primary/30 disabled:opacity-40 transition-all"
            >
              {saving ? 'Collecting…' : '⚑  Collect the Take'}
            </button>
          </div>
        </div>

        {/* ── Two-column grid ──────────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

          {/* Status */}
          <div className={`${styles.panel} r-card border border-primary/20 rounded-md overflow-hidden`}>
            <CardHead icon={TrendingUp} title="Operation Status" />
            <div className="p-4 space-y-4">
              <BarStat label="Level"    value={business?.level ?? 1}          max={10} />
              <BarStat label="Security" value={business?.security_level ?? 0} max={10} />
              <BarStat
                label="Guards"
                value={guards.length}
                max={guardSlots}
                display={`${guards.length} / ${guardSlots}`}
              />
            </div>
          </div>

          {/* Guards */}
          <div className={`${styles.panel} r-card border border-primary/20 rounded-md overflow-hidden`}>
            <CardHead
              icon={Shield}
              title="Muscle"
              right={
                guards.length < guardSlots ? (
                  <button
                    onClick={() => handleHireGuard(guards.length + 1)}
                    disabled={saving}
                    className="flex items-center gap-1 text-[9px] font-heading font-bold uppercase tracking-wider text-primary border border-primary/30 px-2 py-1 rounded hover:bg-primary/10 disabled:opacity-40 transition-all"
                  >
                    <UserPlus size={9} /> Hire
                  </button>
                ) : null
              }
            />
            <div className="p-4 space-y-2">
              {Array.from({ length: guardSlots }).map((_, i) => {
                const g = guards[i];
                return g ? (
                  <div key={g.id} className="flex items-start gap-3 p-2.5 rounded bg-primary/5 border border-primary/12">
                    <div className="w-7 h-7 rounded-full bg-primary/15 border border-primary/25 flex items-center justify-center shrink-0">
                      <span className="text-[10px] font-heading font-bold text-primary">{i + 1}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] font-heading text-zinc-500 mb-1.5">Slot {g.slot_number}</div>
                      <div className="space-y-1">
                        <PipRow label="Armour" filled={g.armour_level} total={3} />
                        <PipRow label="Weapon" filled={g.weapon_level} total={3} />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div key={i} className="guard-empty flex items-center gap-3 p-2.5 rounded border border-primary/12">
                    <div className="w-7 h-7 rounded-full border border-primary/12 flex items-center justify-center shrink-0">
                      <span className="text-[10px] font-heading text-zinc-700">{i + 1}</span>
                    </div>
                    <span className="text-xs font-body italic text-zinc-600">Slot vacant</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Security */}
          <div className={`${styles.panel} r-card border border-primary/20 rounded-md overflow-hidden`}>
            <CardHead icon={Lock} title="Security" />
            <div className="p-4 space-y-2">
              {securityList.length === 0 ? (
                <p className="text-xs text-mutedForeground italic">No upgrades available.</p>
              ) : (
                securityList.map((upg, idx) => {
                  const done   = idx < nextUpgradeIdx;
                  const isNext = idx === nextUpgradeIdx;
                  return (
                    <div
                      key={upg.id}
                      className={`flex items-center gap-3 p-2.5 rounded border transition-all ${
                        done   ? 'border-primary/10 opacity-45' :
                        isNext ? 'border-primary/25 bg-primary/5' :
                                 'border-zinc-800/50 opacity-35'
                      }`}
                    >
                      <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 text-[9px] ${
                        done ? 'bg-primary/20 border-primary/40 text-primary' : 'border-zinc-700/55'
                      }`}>
                        {done ? '✓' : ''}
                      </div>
                      <span className={`flex-1 text-xs ${done ? 'line-through text-zinc-600' : 'text-foreground'}`}>
                        {upg.name}
                      </span>
                      {!done && isNext && (
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[10px] text-mutedForeground font-heading">{formatMoney(upg.cost_cash)}</span>
                          <button
                            onClick={() => handleUpgradeSecurity(upg.id)}
                            disabled={saving}
                            className="px-2.5 py-1 bg-primary/15 text-primary border border-primary/35 rounded text-[9px] font-heading font-bold uppercase tracking-wider hover:bg-primary/25 disabled:opacity-40 transition-all"
                          >
                            Install
                          </button>
                        </div>
                      )}
                      {!done && !isNext && (
                        <span className="text-[9px] text-zinc-700 font-heading shrink-0">{formatMoney(upg.cost_cash)}</span>
                      )}
                    </div>
                  );
                })
              )}
              {nextUpgrade === null && securityList.length > 0 && (
                <p className="text-[10px] text-mutedForeground font-heading uppercase tracking-widest text-center pt-1">
                  Fully upgraded
                </p>
              )}
            </div>
          </div>

          {/* Missions */}
          {missions.length > 0 && (
            <div className={`${styles.panel} r-card border border-primary/20 rounded-md overflow-hidden`}>
              <CardHead icon={ListChecks} title="Missions" />
              <div className="p-4 space-y-1.5">
                {missions.map(({ mission, completed, target }) => (
                  <div key={mission.id} className="flex items-center gap-3 py-1.5 border-b border-zinc-800/40 last:border-b-0">
                    <div className={`w-2 h-2 rounded-full border shrink-0 ${completed ? 'mission-dot-done border-primary' : 'border-zinc-600'}`} />
                    <span className={`flex-1 text-xs leading-snug ${completed ? 'line-through text-zinc-600' : 'text-foreground'}`}>
                      {mission.title}
                    </span>
                    {!completed && target && (
                      <button
                        onClick={() => handleCompleteMission(mission.id)}
                        disabled={saving}
                        className="flex items-center gap-0.5 shrink-0 text-[9px] font-heading font-bold uppercase tracking-wider text-primary border border-primary/30 px-2 py-1 rounded hover:bg-primary/10 disabled:opacity-40 transition-all"
                      >
                        <ChevronRight size={9} /> Complete
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Raid — full width ────────────────────────────────── */}
        <div className={`${styles.panel} r-card border border-primary/20 rounded-md overflow-hidden`}>
          <CardHead icon={Crosshair} title="Hit a Joint" />
          <div className="p-4">
            <p className="text-xs text-mutedForeground font-body italic mb-4 leading-relaxed">
              Send your crew to knock over a rival's operation. Come back with their green — or come back with nothing.
            </p>
            <div className="flex flex-wrap gap-3 items-end">
              <div className="flex-1 min-w-[140px]">
                <label className="block text-[10px] font-heading uppercase tracking-widest text-mutedForeground mb-1.5">
                  Target Username
                </label>
                <input
                  type="text"
                  value={raidTarget}
                  onChange={(e) => setRaidTarget(e.target.value)}
                  placeholder="Who's gettin' hit…"
                  className="w-full px-3 py-2.5 bg-zinc-900/60 border border-zinc-700/50 rounded text-sm text-foreground placeholder:text-zinc-600 focus:border-primary/50 focus:outline-none"
                />
              </div>
              <div className="w-36">
                <label className="block text-[10px] font-heading uppercase tracking-widest text-mutedForeground mb-1.5">
                  State
                </label>
                <input
                  type="text"
                  value={raidState}
                  onChange={(e) => setRaidState(e.target.value)}
                  placeholder="Chicago…"
                  className="w-full px-3 py-2.5 bg-zinc-900/60 border border-zinc-700/50 rounded text-sm text-foreground placeholder:text-zinc-600 focus:border-primary/50 focus:outline-none"
                />
              </div>
              <button
                onClick={handleRaid}
                disabled={saving || !raidTarget.trim()}
                className="px-5 py-2.5 bg-primary/20 text-primary font-heading font-bold uppercase tracking-wider text-xs rounded border border-primary/40 hover:bg-primary/30 disabled:opacity-40 transition-all whitespace-nowrap"
              >
                {saving ? 'Sending crew…' : 'Execute Raid'}
              </button>
            </div>

            {raidResult && (
              <div className={`mt-4 p-3 rounded ${raidResult.success ? 'raid-win' : 'raid-fail'}`}>
                <div className="flex items-center gap-2 mb-1">
                  <AlertTriangle size={11} className={raidResult.success ? 'text-emerald-400' : 'text-red-400'} />
                  <span className={`text-[10px] font-heading font-bold uppercase tracking-wider ${raidResult.success ? 'text-emerald-400' : 'text-red-400'}`}>
                    {raidResult.success ? 'Success' : 'Failed'}
                  </span>
                  {raidResult.loot_cash > 0 && (
                    <span className="text-[10px] text-emerald-400 font-heading">
                      · {formatMoney(raidResult.loot_cash)} taken
                    </span>
                  )}
                </div>
                <p className="text-xs text-foreground">{raidResult.message}</p>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
