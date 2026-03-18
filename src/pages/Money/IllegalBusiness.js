import { useState, useEffect, useCallback } from 'react';
import { Shield, ListChecks, Crosshair, TrendingUp, Lock, UserPlus, Star, AlertTriangle, ChevronRight, ChevronDown } from 'lucide-react';
import api, { refreshUser, getApiErrorMessage } from '../../utils/api';
import { toast } from 'sonner';
import styles from '../../styles/noir.module.css';
import ActiveTokenBadge from '../../components/ActiveTokenBadge';

function formatMoney(n) {
  const num = Number(n ?? 0);
  if (Number.isNaN(num)) return '$0';
  return `$${Math.trunc(num).toLocaleString()}`;
}

function formatMissionRewards(rewards) {
  if (!rewards || typeof rewards !== 'object') return null;
  const parts = [];
  if (rewards.vault_cash) parts.push(`${formatMoney(rewards.vault_cash)} to vault`);
  if (rewards.guard_slots) parts.push(`+${rewards.guard_slots} guard slot${rewards.guard_slots > 1 ? 's' : ''}`);
  if (rewards.income_mult) {
    const pct = Math.round((Number(rewards.income_mult) - 1) * 100);
    if (pct) parts.push(`+${pct}% income`);
  }
  if (rewards.guard_weapon_max) parts.push('Weapon tier +1');
  if (rewards.jailbust_tokens) parts.push(`${rewards.jailbust_tokens} Jailbust token`);
  if (rewards.xp_crimes_tokens) parts.push(`${rewards.xp_crimes_tokens} XP Crimes token`);
  return parts.length ? parts.join(' · ') : null;
}

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
  .kill-reward-card { border-left: 3px solid rgba(var(--noir-primary-rgb),.45); background: rgba(var(--noir-primary-rgb),.04); }
  .raid-win  { border-left: 3px solid #34d399; background: rgba(52,211,153,.06); }
  .raid-fail { border-left: 3px solid #f87171; background: rgba(248,113,113,.06); }
`;

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

function Collapsible({ label, count, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-zinc-800/50 rounded-md overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 text-[10px] font-heading uppercase tracking-widest text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/30 transition-all"
      >
        <span>{label}{count != null ? ` (${count})` : ''}</span>
        <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="border-t border-zinc-800/50">{children}</div>}
    </div>
  );
}

function StartScreen({ types, saving, onStart }) {
  const [typeId, setTypeId] = useState('speakeasy');
  const [name, setName] = useState('');

  const fallback = [
    { id: 'stolen_goods_fence', name: 'Stolen Goods Fence' },
    { id: 'booze_making', name: 'Booze Making' },
    { id: 'speakeasy', name: 'Speakeasy' },
    { id: 'numbers_racket', name: 'Numbers Racket' },
    { id: 'protection_racket', name: 'Protection Racket' },
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
      <div className={`${styles.panel} r-card border border-primary/20 rounded-md overflow-hidden mobile-panel`}>
        <CardHead icon={TrendingUp} title="Choose Your Operation" />
        <div className="p-4 space-y-4">
          <div>
            <label className="block text-[10px] font-heading uppercase tracking-widest text-mutedForeground mb-2">Business Type</label>
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
              type="text" value={name} onChange={(e) => setName(e.target.value)}
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

let _cachedBizData = null;
let _cachedBizTypes = [];
let _bizLastFetch = 0;
const BIZ_REFRESH = 30_000;

export default function IllegalBusiness() {
  const [data, setData] = useState(_cachedBizData);
  const [types, setTypes] = useState(_cachedBizTypes);
  const [loading, setLoading] = useState(!_cachedBizData);
  const [saving, setSaving] = useState(false);
  const [raidTarget, setRaidTarget] = useState('');
  const [raidState, setRaidState] = useState('');
  const [raidResult, setRaidResult] = useState(null);
  const [user, setUser] = useState(null);
  const [withdrawAmount, setWithdrawAmount] = useState('');

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [res, typesRes] = await Promise.all([
        api.get('/illegal-business').catch((e) => ({ ...e, response: e.response })),
        api.get('/illegal-business/types').catch(() => ({ data: { types: [] } })),
      ]);
      if (typesRes?.data?.types) {
        _cachedBizTypes = typesRes.data.types;
        setTypes(typesRes.data.types);
      }
      if (res.response?.status === 404) {
        _cachedBizData = { noBusiness: true };
        setData({ noBusiness: true });
      } else if (res.data) {
        _cachedBizData = res.data;
        _bizLastFetch = Date.now();
        setData(res.data);
      } else if (!silent) {
        toast.error(getApiErrorMessage(res));
      }
    } catch (e) {
      if (e.response?.status === 404) { _cachedBizData = { noBusiness: true }; setData({ noBusiness: true }); }
      else if (!silent) toast.error(getApiErrorMessage(e));
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const stale = Date.now() - _bizLastFetch > BIZ_REFRESH;
    if (!_cachedBizData) fetchData(false);
    else if (stale) fetchData(true);
    const id = setInterval(() => fetchData(true), BIZ_REFRESH);
    api.get('/auth/me').then((r) => setUser(r.data)).catch(() => {});
    return () => clearInterval(id);
  }, [fetchData]);

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
    toast.success(res.data?.message || 'Collected to vault.');
    fetchData();
  });
  const handleWithdraw = withSave(async () => {
    const amt = parseInt(withdrawAmount, 10);
    if (!amt || amt <= 0) return;
    const res = await api.post('/illegal-business/withdraw', { amount: amt });
    toast.success(res.data?.message || 'Withdrawn.');
    setWithdrawAmount('');
    refreshUser(); fetchData();
  });
  const handleWithdrawAll = withSave(async () => {
    const vault = parseInt(data?.business?.vault ?? 0, 10);
    if (vault <= 0) return;
    const res = await api.post('/illegal-business/withdraw', { amount: vault });
    toast.success(res.data?.message || 'Withdrawn.');
    setWithdrawAmount('');
    refreshUser(); fetchData();
  });
  const handleHireGuard = withSave(async (slotNumber, armourLevel = 0, weaponLevel = 0) => {
    await api.post('/illegal-business/guards/hire', { slot_number: slotNumber, armour_level: armourLevel, weapon_level: weaponLevel });
    toast.success('Another pair of hands on the door.');
    fetchData();
  });
  const handleBuyGuardSlot = withSave(async () => {
    await api.post('/illegal-business/guards/buy-slot');
    toast.success('Another slot on the door.');
    fetchData();
  });
  const handleUpgradeSecurity = withSave(async (upgradeId) => {
    await api.post(`/illegal-business/security/upgrade/${upgradeId}`);
    toast.success('Upgrade installed.');
    fetchData();
  });
  const handleCompleteMission = withSave(async (missionId) => {
    const res = await api.post(`/illegal-business/missions/${missionId}/complete`);
    toast.success(res.data?.message || 'Mission complete.');
    fetchData();
  });
  const handleRaid = withSave(async () => {
    if (!raidTarget.trim()) return;
    setRaidResult(null);
    const res = await api.post('/illegal-business/raid', { target_username: raidTarget.trim(), state: raidState || undefined });
    setRaidResult(res.data);
    toast.success(res.data?.message);
    if (res.data?.loot_cash) refreshUser();
    fetchData();
  });
  const handleRaidRandom = withSave(async () => {
    setRaidResult(null);
    const res = await api.post('/illegal-business/raid/random');
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

  if (loading && !data) {
    return (
      <div className={`${styles.pageContent} mobile-page-root`}>
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
      <div className={`${styles.pageContent} mobile-page-root`}>
        <style>{RACKET_STYLES}</style>
        <StartScreen types={types} saving={saving} onStart={handleStart} />
      </div>
    );
  }

  const business = data?.business;
  const guards = data?.guards || [];
  const typeInfo = data?.type_info || {};
  const pendingRewards = data?.pending_kill_rewards || [];
  const securityList = data?.security_upgrades_list || [];
  const guardSlots = business?.guard_slots ?? 2;
  const nextGuardSlotCostCash = data?.next_guard_slot_cost_cash ?? null;
  const guardHireCost = data?.guard_hire_cost ?? 2500;
  const vault = parseInt(business?.vault ?? 0, 10);
  const upgradesDone = business?.security_upgrades || [];
  const nextUpgradeIdx = upgradesDone.length;
  const nextUpgrade = nextUpgradeIdx < securityList.length ? securityList[nextUpgradeIdx] : null;
  const totalUpgrades = securityList.length;
  const missions = Array.isArray(data?.missions) ? data.missions : [];
  const completedMissions = missions.filter(m => m.completed);
  const activeMission = missions.find(m => !m.completed);

  return (
    <div className={`${styles.pageContent} racket-page mobile-page-root`}>
      <style>{RACKET_STYLES}</style>
      <div className="space-y-3">

        {/* ── Header ── */}
        <div className="flex flex-wrap items-end justify-between gap-3 pb-3 border-b border-primary/15">
          <div className="min-w-0">
            <div className="text-[9px] font-heading tracking-[.28em] text-mutedForeground uppercase mb-1">Illegal Business</div>
            <h1 className="text-xl sm:text-2xl font-heading font-bold text-primary tracking-wider leading-none truncate">
              {business?.name || typeInfo?.name || 'Racket'}
            </h1>
            <div className="flex flex-wrap items-center gap-2 mt-1.5">
              <span className="text-xs font-body italic text-mutedForeground">{typeInfo?.name}</span>
              {business?.state && <span className="text-[10px] text-zinc-600">· {business.state}</span>}
            </div>
            <div className="text-[10px] text-zinc-500 mt-1 font-heading">
              Level {business?.level ?? 1} · Security {nextUpgradeIdx}/{totalUpgrades} · {guards.length}/{guardSlots} guards
            </div>
          </div>
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

        {user?.racket_until && (
          <ActiveTokenBadge tokenType="racket" untilIso={user.racket_until} />
        )}

        {/* ── Kill rewards ── */}
        {pendingRewards.length > 0 && (
          <div className={`${styles.panel} r-card border border-primary/25 rounded-md overflow-hidden mobile-panel`}>
            <CardHead icon={Star} title="Claim Your Reward" />
            <div className="p-3 space-y-2">
              {pendingRewards.map((p) => (
                <div key={p.victim_id} className="kill-reward-card flex flex-wrap items-center gap-3 p-3 rounded">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-heading font-bold text-foreground">{p.victim_username}</div>
                    <div className="text-[10px] text-mutedForeground">had {formatMoney(p.total_spent)} invested</div>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <button onClick={() => handleClaimKillReward(p.victim_id, 'cash')} disabled={saving}
                      className="px-3 py-1.5 bg-primary/15 text-primary border border-primary/35 rounded text-[10px] font-heading font-bold uppercase tracking-wider hover:bg-primary/25 disabled:opacity-40 transition-all">
                      Take Cash
                    </button>
                    {p.moderately_upgraded && (
                      <button onClick={() => handleClaimKillReward(p.victim_id, 'income_boost')} disabled={saving}
                        className="px-3 py-1.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/28 rounded text-[10px] font-heading font-bold uppercase tracking-wider hover:bg-emerald-500/18 disabled:opacity-40 transition-all">
                        +2% Income
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Vault ── */}
        <div className={`${styles.panel} r-card border border-primary/25 rounded-md overflow-hidden mobile-panel`}>
          <CardHead icon={TrendingUp} title="Vault"
            right={<span className="text-[9px] font-heading text-zinc-500">All spending comes from here</span>}
          />
          <div className="p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="text-[10px] font-heading uppercase tracking-widest text-mutedForeground mb-0.5">Vault Balance</div>
                <div className="text-3xl font-heading font-bold text-primary leading-none">
                  {formatMoney(vault)}
                </div>
              </div>
              <button onClick={handleCollect} disabled={saving}
                className="collect-btn px-6 py-3 bg-primary/20 text-primary font-heading font-bold uppercase tracking-widest text-xs rounded border border-primary/40 hover:bg-primary/30 disabled:opacity-40 transition-all">
                {saving ? 'Collecting…' : '⚑  Collect the Take'}
              </button>
            </div>
            {vault > 0 && (
              <div className="flex flex-wrap items-end gap-2 pt-2 border-t border-primary/10">
                <div className="flex-1 min-w-[100px]">
                  <label className="block text-[9px] font-heading uppercase tracking-widest text-mutedForeground mb-1">Pocket Cash</label>
                  <input type="number" value={withdrawAmount} onChange={(e) => setWithdrawAmount(e.target.value)}
                    placeholder={`Max ${formatMoney(vault)}`} min="1" max={vault}
                    className="w-full px-3 py-2 bg-zinc-900/60 border border-zinc-700/50 rounded text-sm text-foreground placeholder:text-zinc-600 focus:border-primary/50 focus:outline-none" />
                </div>
                <button onClick={handleWithdraw} disabled={saving || !withdrawAmount || parseInt(withdrawAmount, 10) <= 0}
                  className="px-4 py-2 bg-primary/15 text-primary font-heading font-bold uppercase tracking-wider text-[10px] rounded border border-primary/35 hover:bg-primary/25 disabled:opacity-40 transition-all whitespace-nowrap">
                  Withdraw
                </button>
                <button onClick={handleWithdrawAll} disabled={saving}
                  className="px-4 py-2 bg-primary/10 text-primary font-heading font-bold uppercase tracking-wider text-[10px] rounded border border-primary/30 hover:bg-primary/20 disabled:opacity-40 transition-all whitespace-nowrap">
                  Withdraw All
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ── Current Mission ── */}
        {activeMission && (() => {
          const { mission, current, target } = activeMission;
          const requirementsMet = target && Object.keys(target).every((k) => (Number(current?.[k]) ?? 0) >= (Number(target[k]) ?? 0));
          return (
            <div className={`${styles.panel} r-card border border-primary/20 rounded-md overflow-hidden mobile-panel`}>
              <CardHead icon={ListChecks} title={`Mission ${mission.order ?? ''}/${missions.length}`}
                right={completedMissions.length > 0 && (
                  <span className="text-[9px] font-heading text-zinc-500">{completedMissions.length} completed</span>
                )}
              />
              <div className="p-4">
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center shrink-0 mt-0.5">
                    <span className="text-[9px] font-heading font-bold text-primary">{mission.order ?? '?'}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-heading font-bold text-foreground block">{mission.title}</span>
                    {mission.story && <p className="text-[11px] text-mutedForeground italic mt-1">{mission.story}</p>}
                    {mission.how_to_complete && <p className="text-[11px] text-mutedForeground mt-1.5">{mission.how_to_complete}</p>}

                    {/* Progress bars per requirement */}
                    {target && typeof current === 'object' && current !== null && (
                      <div className="mt-2.5 space-y-2">
                        {Object.entries(target).map(([key, need]) => {
                          const cur = Number(current[key]) ?? 0;
                          const n = Number(need) ?? 1;
                          const pct = Math.min(100, Math.round((cur / n) * 100));
                          const fmt = (x) => Number(x).toLocaleString();
                          const label = key.replace(/_/g, ' ');
                          return (
                            <div key={key}>
                              <div className="flex items-baseline justify-between mb-0.5">
                                <span className="text-[9px] font-heading uppercase tracking-wider text-zinc-500 capitalize">{label}</span>
                                <span className="text-[10px] font-heading text-primary">{fmt(cur)} / {fmt(n)}</span>
                              </div>
                              <div className="h-1 rounded-full bg-zinc-800">
                                <div className={`r-bar-fill h-full rounded-full ${pct >= 100 ? 'bg-emerald-500' : 'bg-gradient-to-r from-primary/55 to-primary'}`} style={{ width: `${pct}%` }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {mission.rewards && formatMissionRewards(mission.rewards) && (
                      <p className="text-[10px] text-primary/80 font-heading mt-2">
                        Rewards: {formatMissionRewards(mission.rewards)}
                      </p>
                    )}
                  </div>
                  {requirementsMet && (
                    <button onClick={() => handleCompleteMission(mission.id)} disabled={saving}
                      className="flex items-center gap-0.5 shrink-0 text-[9px] font-heading font-bold uppercase tracking-wider text-primary border border-primary/30 px-2.5 py-1.5 rounded hover:bg-primary/10 disabled:opacity-40 transition-all">
                      <ChevronRight size={9} /> Complete
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

        {/* ── Security & Guards ── */}
        <div className={`${styles.panel} r-card border border-primary/20 rounded-md overflow-hidden mobile-panel`}>
          <CardHead icon={Lock} title="Defences" />
          <div className="p-4 space-y-4">

            {/* Security progress + next upgrade */}
            <div>
              <div className="flex items-baseline justify-between mb-1">
                <span className="text-[10px] font-heading uppercase tracking-widest text-mutedForeground">Security Upgrades</span>
                <span className="font-heading font-bold text-primary text-sm">{nextUpgradeIdx} / {totalUpgrades}</span>
              </div>
              <div className="h-1.5 rounded-full bg-zinc-800">
                <div className="r-bar-fill h-full rounded-full bg-gradient-to-r from-primary/55 to-primary"
                  style={{ width: `${totalUpgrades ? Math.round((nextUpgradeIdx / totalUpgrades) * 100) : 0}%` }} />
              </div>

              {nextUpgrade ? (
                <div className="mt-3 flex items-center gap-3 p-2.5 rounded border border-primary/25 bg-primary/5">
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-heading font-bold text-foreground block">{nextUpgrade.name}</span>
                    <span className="text-[10px] text-mutedForeground font-heading">{formatMoney(nextUpgrade.cost_cash)}</span>
                  </div>
                  <button onClick={() => handleUpgradeSecurity(nextUpgrade.id)} disabled={saving}
                    className="px-3 py-1.5 bg-primary/15 text-primary border border-primary/35 rounded text-[9px] font-heading font-bold uppercase tracking-wider hover:bg-primary/25 disabled:opacity-40 transition-all shrink-0">
                    Install
                  </button>
                </div>
              ) : totalUpgrades > 0 ? (
                <p className="text-[10px] text-emerald-400 font-heading uppercase tracking-widest text-center mt-2">Fully fortified</p>
              ) : null}
            </div>

            {/* Guards compact */}
            <div>
              <div className="flex items-baseline justify-between mb-2">
                <span className="text-[10px] font-heading uppercase tracking-widest text-mutedForeground">Muscle</span>
                <span className="font-heading font-bold text-primary text-sm">{guards.length} / {guardSlots}</span>
              </div>

              {guards.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {guards.map((g, i) => (
                    <div key={g.id} className="flex items-center gap-1.5 px-2 py-1 rounded bg-primary/5 border border-primary/12">
                      <span className="text-[9px] font-heading font-bold text-primary">#{i + 1}</span>
                      <span className="text-[9px] text-zinc-500">A{g.armour_level} W{g.weapon_level}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                {guards.length < guardSlots && (
                  <button onClick={() => handleHireGuard(guards.length + 1)} disabled={saving}
                    className="flex items-center gap-1 text-[9px] font-heading font-bold uppercase tracking-wider text-primary border border-primary/30 px-2.5 py-1.5 rounded hover:bg-primary/10 disabled:opacity-40 transition-all">
                    <UserPlus size={9} /> Hire Guard — {formatMoney(guardHireCost)}
                  </button>
                )}
                {guards.length >= guardSlots && nextGuardSlotCostCash != null && (
                  <button onClick={handleBuyGuardSlot} disabled={saving}
                    className="flex items-center gap-1 text-[9px] font-heading font-bold uppercase tracking-wider text-primary border border-primary/30 px-2.5 py-1.5 rounded hover:bg-primary/10 disabled:opacity-40 transition-all">
                    <UserPlus size={9} /> Add Slot — {formatMoney(nextGuardSlotCostCash)}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Raid ── */}
        <div className={`${styles.panel} r-card border border-primary/20 rounded-md overflow-hidden mobile-panel`}>
          <CardHead icon={Crosshair} title="Hit a Joint" />
          <div className="p-4">
            <p className="text-[11px] text-mutedForeground font-body italic mb-3">
              Send your crew to knock over a rival&apos;s operation. Come back with their green — or come back with nothing.
            </p>
            <div className="flex flex-wrap gap-2 items-end">
              <div className="flex-1 min-w-[120px]">
                <label className="block text-[9px] font-heading uppercase tracking-widest text-mutedForeground mb-1">Target</label>
                <input type="text" value={raidTarget} onChange={(e) => setRaidTarget(e.target.value)}
                  placeholder="Username…"
                  className="w-full px-3 py-2 bg-zinc-900/60 border border-zinc-700/50 rounded text-sm text-foreground placeholder:text-zinc-600 focus:border-primary/50 focus:outline-none" />
              </div>
              <div className="w-28">
                <label className="block text-[9px] font-heading uppercase tracking-widest text-mutedForeground mb-1">State</label>
                <input type="text" value={raidState} onChange={(e) => setRaidState(e.target.value)}
                  placeholder="Optional…"
                  className="w-full px-3 py-2 bg-zinc-900/60 border border-zinc-700/50 rounded text-sm text-foreground placeholder:text-zinc-600 focus:border-primary/50 focus:outline-none" />
              </div>
              <button onClick={handleRaid} disabled={saving || !raidTarget.trim()}
                className="px-4 py-2 bg-primary/20 text-primary font-heading font-bold uppercase tracking-wider text-[10px] rounded border border-primary/40 hover:bg-primary/30 disabled:opacity-40 transition-all whitespace-nowrap">
                {saving ? 'Sending…' : 'Raid'}
              </button>
              <button onClick={handleRaidRandom} disabled={saving}
                className="px-4 py-2 bg-primary/10 text-primary font-heading font-bold uppercase tracking-wider text-[10px] rounded border border-primary/30 hover:bg-primary/20 disabled:opacity-40 transition-all whitespace-nowrap">
                Random
              </button>
            </div>

            {raidResult && (
              <div className={`mt-3 p-3 rounded ${raidResult.success ? 'raid-win' : 'raid-fail'}`}>
                <div className="flex items-center gap-2 mb-1">
                  <AlertTriangle size={11} className={raidResult.success ? 'text-emerald-400' : 'text-red-400'} />
                  <span className={`text-[10px] font-heading font-bold uppercase tracking-wider ${raidResult.success ? 'text-emerald-400' : 'text-red-400'}`}>
                    {raidResult.success ? 'Success' : 'Failed'}
                  </span>
                  {raidResult.loot_cash > 0 && (
                    <span className="text-[10px] text-emerald-400 font-heading">· {formatMoney(raidResult.loot_cash)} taken</span>
                  )}
                </div>
                {raidResult.target_username && (
                  <p className="text-[10px] text-mutedForeground font-heading mb-0.5">You hit {raidResult.target_username}&apos;s joint.</p>
                )}
                <p className="text-xs text-foreground">{raidResult.message}</p>
              </div>
            )}
          </div>
        </div>

        {/* ── Collapsible sections ── */}
        {completedMissions.length > 0 && (
          <Collapsible label="Mission Log" count={completedMissions.length}>
            <div className="p-3 space-y-2">
              {completedMissions.map(({ mission }) => (
                <div key={mission.id} className="flex items-center gap-2.5 px-2 py-1.5">
                  <div className="w-2 h-2 rounded-full bg-primary shrink-0" style={{ boxShadow: '0 0 5px rgba(var(--noir-primary-rgb),.45)' }} />
                  <div className="flex-1 min-w-0">
                    <span className="text-[11px] font-heading text-zinc-500 line-through block">{mission.title}</span>
                    {mission.rewards && formatMissionRewards(mission.rewards) && (
                      <span className="text-[9px] text-zinc-600 font-heading">{formatMissionRewards(mission.rewards)}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Collapsible>
        )}

        {totalUpgrades > 0 && nextUpgradeIdx > 0 && (
          <Collapsible label="All Security Upgrades" count={`${nextUpgradeIdx}/${totalUpgrades}`}>
            <div className="p-3 space-y-1">
              {securityList.map((upg, idx) => {
                const done = idx < nextUpgradeIdx;
                const isNext = idx === nextUpgradeIdx;
                return (
                  <div key={upg.id} className={`flex items-center gap-2 px-2 py-1 rounded text-[11px] ${
                    done ? 'text-zinc-600' : isNext ? 'text-foreground bg-primary/5' : 'text-zinc-700'
                  }`}>
                    <span className={`w-3 h-3 rounded border flex items-center justify-center shrink-0 text-[8px] ${
                      done ? 'bg-primary/20 border-primary/40 text-primary' : isNext ? 'border-primary/30' : 'border-zinc-800'
                    }`}>
                      {done ? '✓' : ''}
                    </span>
                    <span className={`flex-1 ${done ? 'line-through' : ''}`}>{upg.name}</span>
                    {!done && <span className="text-[9px] text-zinc-600 font-heading shrink-0">{formatMoney(upg.cost_cash)}</span>}
                  </div>
                );
              })}
            </div>
          </Collapsible>
        )}

      </div>
    </div>
  );
}
