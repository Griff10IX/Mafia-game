import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Shield, ListChecks, Crosshair, TrendingUp, Lock, UserPlus, Star, AlertTriangle, ChevronRight, ChevronDown, Award } from 'lucide-react';
import api, { refreshUser, getApiErrorMessage } from '../../utils/api';
import { readSessionJson, writeSessionJson } from '../../utils/sessionPageCache';
import { useAuthUser } from '../../context/AuthContext';
import AutoRefreshNote from '../../components/AutoRefreshNote';
import { toast } from 'sonner';
import styles from '../../styles/noir.module.css';
const BIZ_CACHE_PREFIX = 'mafia_illegal_biz_v1:';
const BIZ_REFRESH = 30_000;

function bizSessionKey(userId) {
  const id = (userId || '').trim();
  return id ? `${BIZ_CACHE_PREFIX}${id}` : '';
}

const LOOT_BOX_PIECES_HINT =
  'Loot box pieces stack in your account. On the Loot Box page, open a vault tier (50–1,000 pieces: Common, Uncommon, Rare, or Ultra Rare) for random rewards.';

/** Racket + distillery progression ladder (not city missions on /account/missions). */
const BUSINESS_PROGRESS_LABEL = 'Business progress';

const IBM_REQUIREMENT_LABELS = {
  crimes: 'Total crimes',
  rank_id: 'Rank',
  security_level: 'Security upgrades',
  crimes_in_state: 'Crimes in business state',
  collections: 'Collections',
  raids_won: 'Raids won',
  raids_attempted: 'Raid attempts',
  guards_hired: 'Guards hired',
  guard_slots_bought: 'Guard slots bought',
  vault_withdrawals: 'Vault withdrawals',
  hitlist_npc_kills: 'Hitlist practice NPC kills',
};

/** Matches backend server.RANKS (illegal business rank gates). */
const IBM_RANK_NAMES = {
  1: 'Rat',
  2: 'Street Thug',
  3: 'Hustler',
  4: 'Goon',
  5: 'Made Man',
  6: 'Capo',
  7: 'Underboss',
  8: 'Consigliere',
  9: 'Boss',
  10: 'Don',
  11: 'Capo di tutti capi',
  12: 'Boss of Bosses',
  13: 'Godfather',
};

const IBM_SEGMENTED_KEYS = new Set([
  'crimes_in_state',
  'collections',
  'raids_won',
  'raids_attempted',
  'guards_hired',
  'guard_slots_bought',
  'vault_withdrawals',
  'hitlist_npc_kills',
]);

function ibmRankLabel(rankId) {
  const n = Number(rankId);
  if (Number.isNaN(n)) return String(rankId);
  const name = IBM_RANK_NAMES[n];
  return name ? `${name} (${n})` : String(n);
}

function formatMoney(n) {
  const num = Number(n ?? 0);
  if (Number.isNaN(num)) return '$0';
  return `$${Math.trunc(num).toLocaleString()}`;
}

function formatTillDollars(n) {
  const num = Number(n ?? 0);
  if (Number.isNaN(num)) return '$0.00';
  return `$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function getMissionRewardParts(rewards) {
  if (!rewards || typeof rewards !== 'object') return [];
  const parts = [];
  if (rewards.vault_cash) parts.push(`${formatMoney(rewards.vault_cash)} to vault`);
  if (rewards.guard_slots) parts.push(`+${rewards.guard_slots} guard slot${rewards.guard_slots > 1 ? 's' : ''}`);
  if (rewards.income_mult) {
    const pct = Math.round((Number(rewards.income_mult) - 1) * 100);
    if (pct) parts.push(`+${pct}% income`);
  }
  if (rewards.income_per_hour_add) parts.push(`+${formatMoney(rewards.income_per_hour_add)}/h passive`);
  if (rewards.guard_weapon_max) parts.push('Weapon tier +1');
  if (rewards.guard_armour_max) parts.push('Armour tier +1');
  if (rewards.raid_daily_limit_add) parts.push(`+${rewards.raid_daily_limit_add} daily raid${Number(rewards.raid_daily_limit_add) > 1 ? 's' : ''} (max 10)`);
  if (rewards.income_cap_hours_add) parts.push(`+${rewards.income_cap_hours_add}h till cap`);
  if (rewards.defender_strength_bonus_add) parts.push(`+${rewards.defender_strength_bonus_add} joint defence`);
  if (rewards.raid_incoming_loot_mult_sub != null && Number(rewards.raid_incoming_loot_mult_sub) > 0) {
    const pct = Math.round(Number(rewards.raid_incoming_loot_mult_sub) * 100);
    parts.push(`−${pct}% cash lost when raided`);
  }
  if (rewards.jailbust_tokens) parts.push(`${rewards.jailbust_tokens} Jailbust token${Number(rewards.jailbust_tokens) > 1 ? 's' : ''}`);
  if (rewards.xp_crimes_tokens) parts.push(`${rewards.xp_crimes_tokens} XP Crimes token${Number(rewards.xp_crimes_tokens) > 1 ? 's' : ''}`);
  if (rewards.xp_gta_tokens) parts.push(`${rewards.xp_gta_tokens} XP GTA token${Number(rewards.xp_gta_tokens) > 1 ? 's' : ''}`);
  if (rewards.racket_tokens) parts.push(`${rewards.racket_tokens} Racket token${Number(rewards.racket_tokens) > 1 ? 's' : ''}`);
  if (rewards.melt_tokens) parts.push(`${rewards.melt_tokens} Melt token${Number(rewards.melt_tokens) > 1 ? 's' : ''}`);
  if (rewards.oc_reduced_tokens) parts.push(`${rewards.oc_reduced_tokens} OC Reduced token${Number(rewards.oc_reduced_tokens) > 1 ? 's' : ''}`);
  if (rewards.booze_tokens) parts.push(`${rewards.booze_tokens} Booze token${Number(rewards.booze_tokens) > 1 ? 's' : ''}`);
  if (rewards.travel_tokens) parts.push(`${rewards.travel_tokens} Travel token${Number(rewards.travel_tokens) > 1 ? 's' : ''}`);
  if (rewards.properties_tokens) parts.push(`${rewards.properties_tokens} Properties token${Number(rewards.properties_tokens) > 1 ? 's' : ''}`);
  if (rewards.auto_rank_2h_tokens) parts.push(`${rewards.auto_rank_2h_tokens} Auto Rank (2h) token${Number(rewards.auto_rank_2h_tokens) > 1 ? 's' : ''}`);
  if (rewards.rank_xp_pass_tokens) parts.push(`${rewards.rank_xp_pass_tokens} Rank XP pass token${Number(rewards.rank_xp_pass_tokens) > 1 ? 's' : ''}`);
  return parts;
}

function formatMissionRewards(rewards) {
  const parts = getMissionRewardParts(rewards);
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

function KillRewardsBlock({ pendingRewards, saving, onClaim }) {
  if (!pendingRewards?.length) return null;
  return (
    <div className={`${styles.panel} r-card border border-primary/25 rounded-md overflow-hidden mobile-panel`}>
      <CardHead icon={Star} title="Seized operation — choose" />
      <div className="p-3 space-y-3">
        <div className="text-[10px] text-mutedForeground font-heading leading-relaxed space-y-2 border-b border-primary/10 pb-3">
          <p className="font-bold text-foreground/90 uppercase tracking-wide text-[9px]">How it works</p>
          <ul className="list-none space-y-2 pl-0">
            <li className="flex gap-2">
              <span className="text-primary shrink-0 font-bold">1.</span>
              <span>
                <strong className="text-foreground/90">Their hourly payout was higher than yours</strong> — you may{' '}
                <strong className="text-emerald-400/90">take over</strong> the whole racket (Capo+), rename it, and keep +5%/hr on{' '}
                <em>that</em> business — or take cash only.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="text-primary shrink-0 font-bold">2.</span>
              <span>
                <strong className="text-foreground/90">Your hourly payout is already higher</strong> — either{' '}
                <strong className="text-violet-300/90">absorb</strong> (+5%/hr on <em>your</em> racket <span className="text-zinc-500">and</span> you get the cash shown), or{' '}
                <strong className="text-primary/90">cash out</strong> for money only (no +5% boost).
              </span>
            </li>
          </ul>
        </div>
        {pendingRewards.map((p) => (
          <KillRewardRow key={p.victim_id} p={p} saving={saving} onClaim={onClaim} />
        ))}
      </div>
    </div>
  );
}

function KillRewardScenarioBlurb({ p }) {
  const hasSnap = Boolean(p.has_snapshot);
  const canTakeover = Boolean(p.takeover_available);
  const canAbsorb = Boolean(p.absorb_available);
  if (hasSnap && canTakeover) {
    return (
      <div className="space-y-1 text-[10px]">
        <p className="text-foreground font-heading font-semibold leading-snug">Their operation paid more per hour than yours.</p>
        <p className="text-mutedForeground leading-snug">
          <strong className="text-emerald-400/95">Take over</strong> — run their whole racket under a new name (+5%/hr on that site).{' '}
          <strong className="text-primary/90">Cash out</strong> — take the money below; you don&apos;t keep their business.
        </p>
      </div>
    );
  }
  if (hasSnap && canAbsorb) {
    return (
      <div className="space-y-1 text-[10px]">
        <p className="text-foreground font-heading font-semibold leading-snug">Your operation already pays more per hour than theirs.</p>
        <p className="text-mutedForeground leading-snug">
          <strong className="text-violet-300/95">Absorb</strong> — add +5%/hr to <em>your</em> racket and take the cash shown below.{' '}
          <strong className="text-primary/90">Cash out only</strong> — same payout, no +5% on yours.
        </p>
      </div>
    );
  }
  if (hasSnap) {
    return (
      <p className="text-[10px] text-mutedForeground leading-snug">Pick one option below to settle this seizure.</p>
    );
  }
  return (
    <p className="text-[10px] text-mutedForeground leading-snug">Cash payout from their investment (older reward).</p>
  );
}

function KillRewardRow({ p, saving, onClaim }) {
  const [takeoverName, setTakeoverName] = useState('');
  const preview = Number(p.liquidation_preview ?? p.total_spent ?? 0);
  const hasSnap = Boolean(p.has_snapshot);
  const canTakeover = Boolean(p.takeover_available);
  const canAbsorb = Boolean(p.absorb_available);
  return (
    <div className="kill-reward-card flex flex-col gap-2 p-3 rounded">
      <div className="min-w-0">
        <div className="text-xs font-heading font-bold text-foreground">{p.victim_username}</div>
        <div className="mt-1.5">
          <KillRewardScenarioBlurb p={p} />
        </div>
        <div className="text-[10px] font-heading mt-2 pt-2 border-t border-zinc-700/35 tabular-nums flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
          <span className="text-zinc-500">Estimated cash value</span>
          <span className="text-foreground font-semibold">{formatMoney(preview)}</span>
          {canAbsorb && (
            <span className="text-zinc-600 text-[9px] w-full sm:w-auto">— same amount for absorb or cash-out</span>
          )}
          {canTakeover && !canAbsorb && (
            <span className="text-zinc-600 text-[9px] w-full sm:w-auto">— payout if you skip take over</span>
          )}
        </div>
      </div>
      {canTakeover && (
        <div>
          <label className="block text-[9px] font-heading uppercase tracking-widest text-mutedForeground mb-1">New name (optional)</label>
          <input
            type="text"
            value={takeoverName}
            onChange={(e) => setTakeoverName(e.target.value)}
            placeholder="Keep victim name if empty"
            className="w-full px-2 py-1.5 bg-zinc-900/60 border border-zinc-700/50 rounded text-xs text-foreground placeholder:text-zinc-600 focus:border-primary/50 focus:outline-none"
          />
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {canTakeover && (
          <button
            type="button"
            onClick={() => onClaim(p.victim_id, 'takeover', takeoverName.trim() || undefined)}
            disabled={saving}
            className="px-3 py-1.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/28 rounded text-[10px] font-heading font-bold uppercase tracking-wider hover:bg-emerald-500/18 disabled:opacity-40 transition-all"
          >
            Take over racket (+5%/hr there)
          </button>
        )}
        {canAbsorb && (
          <button
            type="button"
            onClick={() => onClaim(p.victim_id, 'absorb')}
            disabled={saving}
            className="px-3 py-1.5 bg-violet-500/10 text-violet-300 border border-violet-500/28 rounded text-[10px] font-heading font-bold uppercase tracking-wider hover:bg-violet-500/18 disabled:opacity-40 transition-all"
          >
            Absorb — +5%/hr on yours + {formatMoney(preview)}
          </button>
        )}
        <button
          type="button"
          onClick={() => onClaim(p.victim_id, 'liquidate')}
          disabled={saving}
          className="px-3 py-1.5 bg-primary/15 text-primary border border-primary/35 rounded text-[10px] font-heading font-bold uppercase tracking-wider hover:bg-primary/25 disabled:opacity-40 transition-all"
        >
          Cash out only · {formatMoney(preview)}
        </button>
      </div>
    </div>
  );
}

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

export default function IllegalBusiness() {
  const [data, setData] = useState(null);
  const [types, setTypes] = useState([]);
  const [saving, setSaving] = useState(false);
  const [raidTarget, setRaidTarget] = useState('');
  const [raidState, setRaidState] = useState('');
  const [raidResult, setRaidResult] = useState(null);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const authUser = useAuthUser();
  const [missionLogShowAll, setMissionLogShowAll] = useState(false);
  const [missionsFullLoaded, setMissionsFullLoaded] = useState(false);
  const [muscleOpen, setMuscleOpen] = useState(() => {
    try {
      const v = sessionStorage.getItem('illegal_biz_muscle_open');
      if (v === '1') return true;
      if (v === '0') return false;
    } catch (_) {}
    return false;
  });
  const toggleMuscleOpen = () => {
    setMuscleOpen((prev) => {
      const next = !prev;
      try { sessionStorage.setItem('illegal_biz_muscle_open', next ? '1' : '0'); } catch (_) {}
      return next;
    });
  };

  const fetchData = useCallback(async (silent = false, opts = {}) => {
    const cacheKey = bizSessionKey(authUser?.id);
    const slim = silent && !opts.full;
    try {
      const params = slim
        ? { missions: 'active', guards: 'summary', include_distillery: false }
        : undefined;
      const [res, typesRes] = await Promise.all([
        api.get('/illegal-business', params ? { params } : undefined).catch((e) => ({ ...e, response: e.response })),
        slim ? Promise.resolve(null) : api.get('/illegal-business/types').catch(() => ({ data: { types: [] } })),
      ]);
      const prevSnap = cacheKey ? readSessionJson(cacheKey) || {} : {};
      let nextTypes = prevSnap.types ?? [];
      if (typesRes?.data?.types) {
        nextTypes = typesRes.data.types;
        setTypes(nextTypes);
      }
      let nextData;
      if (res.response?.status === 404) {
        nextData = { noBusiness: true };
        setData(nextData);
        setMissionsFullLoaded(false);
      } else if (res.data) {
        const incoming = res.data;
        if (slim && prevSnap.data) {
          const prevMissions = Array.isArray(prevSnap.data.missions) ? prevSnap.data.missions : [];
          const prevGuards = Array.isArray(prevSnap.data.guards) ? prevSnap.data.guards : [];
          const activeMission = (incoming.missions || []).find((m) => !m.completed);
          const completed = prevMissions.filter((m) => m.completed);
          const mergedMissions = activeMission ? [...completed, activeMission] : completed;
          nextData = {
            ...prevSnap.data,
            ...incoming,
            guards: (incoming.guards || []).length ? incoming.guards : prevGuards,
            missions: mergedMissions.length ? mergedMissions : (incoming.missions || []),
            noBusiness: Boolean(incoming.no_business),
          };
        } else {
          nextData = { ...incoming, noBusiness: Boolean(incoming.no_business) };
          setMissionsFullLoaded(true);
        }
        setData(nextData);
      } else if (!silent) {
        toast.error(getApiErrorMessage(res));
      }
      if (nextData !== undefined && cacheKey) {
        writeSessionJson(cacheKey, { data: nextData, types: nextTypes, t: Date.now() });
      }
    } catch (e) {
      if (e.response?.status === 404) {
        const nextData = { noBusiness: true };
        setData(nextData);
        setMissionsFullLoaded(false);
        if (cacheKey) {
          const prevSnap = readSessionJson(cacheKey) || {};
          writeSessionJson(cacheKey, { data: nextData, types: prevSnap.types ?? [], t: Date.now() });
        }
      } else if (!silent) toast.error(getApiErrorMessage(e));
    }
  }, [authUser?.id]);

  const loadFullMissions = useCallback(async () => {
    if (missionsFullLoaded) return;
    try {
      const res = await api.get('/illegal-business/missions');
      const missions = res.data?.missions || [];
      setData((prev) => {
        if (!prev) return prev;
        const next = { ...prev, missions };
        const cacheKey = bizSessionKey(authUser?.id);
        if (cacheKey) {
          const snap = readSessionJson(cacheKey) || {};
          writeSessionJson(cacheKey, { ...snap, data: next, t: Date.now() });
        }
        return next;
      });
      setMissionsFullLoaded(true);
    } catch (e) {
      toast.error(getApiErrorMessage(e));
    }
  }, [authUser?.id, missionsFullLoaded]);

  const prevBizUserIdRef = useRef(null);
  useEffect(() => {
    const uid = authUser?.id;
    if (!uid) return undefined;
    if (prevBizUserIdRef.current && prevBizUserIdRef.current !== uid) {
      setData(null);
      setTypes([]);
      setMissionsFullLoaded(false);
    }
    prevBizUserIdRef.current = uid;
    const key = bizSessionKey(uid);
    const c = readSessionJson(key);
    const stale = !c?.t || Date.now() - c.t > BIZ_REFRESH;
    if (c?.data != null) {
      setData((prev) => prev ?? c.data);
      if (c.types?.length) setTypes((prev) => (prev.length ? prev : c.types));
      setMissionsFullLoaded(Array.isArray(c.data?.missions) && c.data.missions.length > 1);
    }
    if (c?.data == null) fetchData(false);
    else if (stale) fetchData(true);
    const id = setInterval(() => fetchData(true), BIZ_REFRESH);
    return () => clearInterval(id);
  }, [authUser?.id, fetchData]);

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
    toast.success('Guard slot bought — capacity +1.');
    fetchData();
  });
  const handleGuardGearUpgrade = withSave(async (guardId, { armour, weapon }) => {
    await api.post('/illegal-business/guards/upgrade', {
      guard_id: guardId,
      upgrade_armour: !!armour,
      upgrade_weapon: !!weapon,
    });
    toast.success('Gear upgraded.');
    fetchData();
  });
  const handleUpgradeSecurity = withSave(async (upgradeId) => {
    await api.post(`/illegal-business/security/upgrade/${upgradeId}`);
    toast.success('Upgrade installed.');
    fetchData();
  });
  const handleCompleteMission = withSave(async (missionId) => {
    const res = await api.post(`/illegal-business/missions/${missionId}/complete`);
    toast.success(res.data?.message || 'Progress step complete.');
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
  const handleClaimKillReward = withSave(async (victimId, choice, newName) => {
    const body = { victim_id: victimId, choice };
    if (newName) body.new_name = newName;
    const res = await api.post('/illegal-business/claim-kill-reward', body);
    toast.success(res.data?.message);
    refreshUser();
    fetchData();
  });

  if (!data) {
    return (
      <div className={`${styles.pageContent} mobile-page-root`}>
        <style>{RACKET_STYLES}</style>
      </div>
    );
  }

  if (data?.noBusiness) {
    const pendingNoBiz = data?.pending_kill_rewards || [];
    return (
      <div className={`${styles.pageContent} mobile-page-root`}>
        <style>{RACKET_STYLES}</style>
        <AutoRefreshNote seconds={30} className="mb-2" />
        <div className="space-y-4 max-w-lg mx-auto">
          <KillRewardsBlock pendingRewards={pendingNoBiz} saving={saving} onClaim={handleClaimKillReward} />
          <StartScreen types={types.length ? types : data?.available_types || []} saving={saving} onStart={handleStart} />
        </div>
      </div>
    );
  }

  const business = data?.business;
  const guards = data?.guards || [];
  const typeInfo = data?.type_info || {};
  const pendingRewards = data?.pending_kill_rewards || [];
  const securityList = data?.security_upgrades_list || [];
  const guardSlots = business?.guard_slots ?? data?.guard_slots ?? 2;
  const guardsCount = guards.length || Number(data?.guards_count) || 0;
  const nextGuardSlotCostCash = data?.next_guard_slot_cost_cash ?? null;
  const guardHireCost = data?.guard_hire_cost ?? 2500;
  const vault = parseInt(business?.vault ?? 0, 10);
  const minIbmCash = 100;
  const pendingTake = Number(data?.pending_take ?? 0);
  const racketPayoutMult = Number(data?.racket_payout_mult ?? 1);
  const safeMult = Number.isFinite(racketPayoutMult) && racketPayoutMult > 0 ? racketPayoutMult : 1;
  const tillAtCollect = Math.round(pendingTake * safeMult * 100) / 100;
  const canCollectTake = tillAtCollect >= minIbmCash;
  const canWithdrawFromVault = vault >= minIbmCash;
  const upgradesDone = business?.security_upgrades || [];
  const nextUpgradeIdx = upgradesDone.length;
  const nextUpgrade = nextUpgradeIdx < securityList.length ? securityList[nextUpgradeIdx] : null;
  const totalUpgrades = securityList.length;
  const missions = Array.isArray(data?.missions) ? data.missions : [];
  const missionsTotal = Number(data?.missions_total) || missions.length;
  const completedMissions = missions.filter(m => m.completed);
  const MISSION_LOG_PREVIEW = 18;
  const completedMissionsSorted = [...completedMissions].sort(
    (a, b) => (Number(b.mission?.order) || 0) - (Number(a.mission?.order) || 0),
  );
  const missionLogRows = missionLogShowAll
    ? completedMissionsSorted
    : completedMissionsSorted.slice(0, MISSION_LOG_PREVIEW);
  const missionLogHasMore = completedMissionsSorted.length > MISSION_LOG_PREVIEW;
  const activeMission = missions.find(m => !m.completed);
  const raidDailyLimit = Number(data?.raid_daily_limit) || 5;
  const raidsToday = Number(data?.raids_today) || 0;
  const incomeCapHours = Number(business?.income_cap_hours) || 24;
  const incomePerHourNum = Number(business?.income_per_hour) || 0;
  const maxTillAtCap = Math.round(incomePerHourNum * incomeCapHours);
  const weekTillCeiling = maxTillAtCap * 7;

  return (
    <div className={`${styles.pageContent} racket-page mobile-page-root`}>
      <style>{RACKET_STYLES}</style>
      <div className="space-y-3">
        <AutoRefreshNote seconds={30} />

        {/* ── Header ── */}
        <div className="flex flex-wrap items-end justify-between gap-3 pb-3 border-b border-primary/15">
          <div className="min-w-0">
            <div className="text-[9px] font-heading tracking-[.28em] text-mutedForeground uppercase mb-1">Racket</div>
            <h1 className="text-xl sm:text-2xl font-heading font-bold text-primary tracking-wider leading-none truncate">
              {business?.name || typeInfo?.name || 'Racket'}
            </h1>
            <div className="flex flex-wrap items-center gap-2 mt-1.5">
              <span className="text-xs font-body italic text-mutedForeground">{typeInfo?.name}</span>
              {business?.state && <span className="text-[10px] text-zinc-600">· {business.state}</span>}
              <Link to="/money/distillery" className="text-[10px] font-heading text-primary underline underline-offset-2">
                Open Distillery
              </Link>
            </div>
            <div className="text-[10px] text-zinc-500 mt-1 font-heading">
              Level {business?.level ?? 1} · Security {nextUpgradeIdx}/{totalUpgrades} · {guardsCount}/{guardSlots} guards
            </div>
          </div>
          <div className="income-glow border border-primary/25 rounded-md px-4 py-2.5 text-right bg-primary/5 shrink-0 max-w-[200px]">
            <div className="text-[9px] font-heading tracking-[.2em] text-mutedForeground uppercase">Per Hour</div>
            <div className="text-2xl font-heading font-bold text-primary leading-none mt-0.5">
              {formatMoney(business?.income_per_hour)}
            </div>
            <div className="text-[9px] text-zinc-500 font-heading mt-1 leading-snug">
              Max till {formatMoney(maxTillAtCap)} ({incomeCapHours}h cap)
              {Number(business?.defender_strength_bonus) > 0 && (
                <span className="text-zinc-600"> · +{Number(business.defender_strength_bonus)} defence</span>
              )}
              {business?.raid_incoming_loot_mult != null && Number(business.raid_incoming_loot_mult) < 1 && (
                <span className="text-zinc-600">
                  {' '}
                  · raiders take {Math.round(Number(business.raid_incoming_loot_mult) * 100)}% of usual loot
                </span>
              )}
            </div>
            <div className="text-[8px] text-zinc-600 font-heading mt-0.5 leading-snug">
              ~{formatMoney(weekTillCeiling)}/wk if you max the till daily — events &amp; boosts change real collects.
            </div>
            {business?.booze_per_hour != null && (
              <div className="text-[10px] text-mutedForeground mt-1">{business.booze_per_hour} booze/hr</div>
            )}
          </div>
        </div>

        <KillRewardsBlock pendingRewards={pendingRewards} saving={saving} onClaim={handleClaimKillReward} />

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
                <div className="text-[10px] text-zinc-500 font-heading mt-1">
                  {safeMult === 1 ? (
                    <>Till ready: {formatTillDollars(pendingTake)}</>
                  ) : (
                    <>
                      Till ready (base): {formatTillDollars(pendingTake)}
                      <span className="block text-[9px] text-zinc-400 mt-0.5">
                        World event ×{safeMult} at collect → ~{formatTillDollars(tillAtCollect)} to vault
                      </span>
                    </>
                  )}
                </div>
                {business?.booze_per_hour != null && (
                  <p className="text-[9px] text-amber-500/85 font-heading leading-snug mt-2 max-w-md">
                    Distillery: if heat stays critical, a collect — including <strong className="text-amber-400/95">auto-collect</strong> from the distillery — can trigger enforcement and remove part of this vault. See{' '}
                    <Link to="/money/distillery" className="text-amber-400/95 underline underline-offset-2 hover:text-amber-300/95">
                      Heat &amp; Enforcement
                    </Link>
                    {' '}on the distillery page; turn off auto-collect there to avoid background collects.
                  </p>
                )}
              </div>
              <button onClick={handleCollect} disabled={saving || !canCollectTake}
                className="collect-btn px-6 py-3 bg-primary/20 text-primary font-heading font-bold uppercase tracking-widest text-xs rounded border border-primary/40 hover:bg-primary/30 disabled:opacity-40 transition-all">
                {saving ? 'Collecting…' : '⚑  Collect the Take'}
              </button>
            </div>
            {!canCollectTake && pendingTake >= 0.01 && (
              <p className="text-[10px] text-mutedForeground font-heading">
                {safeMult === 1 ? (
                  <>
                    Collect unlocks at {formatMoney(minIbmCash)} in the till (currently {formatTillDollars(pendingTake)}).
                  </>
                ) : (
                  <>
                    Collect unlocks at {formatMoney(minIbmCash)} after the world event is applied (currently ~{formatTillDollars(tillAtCollect)} to vault).
                  </>
                )}
              </p>
            )}
            <p className="text-[9px] text-zinc-500 font-heading leading-snug pt-1 border-t border-primary/10" title={LOOT_BOX_PIECES_HINT}>
              Big collects can also roll random extras (respect, bullets, points, armoury tokens, or{' '}
              <span className="text-violet-400/90">loot box pieces</span>).{' '}
              <Link to="/loot-box" className="text-primary underline underline-offset-2 hover:text-primary/90">
                Loot Box
              </Link>
              : 50–200 pieces per open (by tier).
            </p>
            {vault > 0 && !canWithdrawFromVault && (
              <p className="text-[10px] text-mutedForeground font-heading pt-2 border-t border-primary/10">
                Pocket withdrawals unlock at {formatMoney(minIbmCash)} in the vault (stops spam). Collect more into the vault first.
              </p>
            )}
            {canWithdrawFromVault && (
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

        {/* ── Current progress step ── */}
        {activeMission && (() => {
          const { mission, current, target } = activeMission;
          const requirementsMet = target && Object.keys(target).every((k) => (Number(current?.[k]) ?? 0) >= (Number(target[k]) ?? 0));
          const reqKeys = target && typeof target === 'object' ? Object.keys(target) : [];
          const reqPcts = reqKeys.map((k) => {
            const cur = Number(current?.[k]) ?? 0;
            const n = Number(target[k]) ?? 1;
            if (n <= 0) return 100;
            return Math.min(100, Math.round((cur / n) * 100));
          });
          const bottleneckPct = reqPcts.length ? Math.min(...reqPcts) : 0;
          const rewardParts = mission.rewards ? getMissionRewardParts(mission.rewards) : [];
          const hasSegmented = reqKeys.some((k) => IBM_SEGMENTED_KEYS.has(k));
          return (
            <div className={`${styles.panel} r-card border border-primary/20 rounded-md overflow-hidden mobile-panel`}>
              <CardHead icon={ListChecks} title={`${BUSINESS_PROGRESS_LABEL} · ${mission.order ?? ''}/${missionsTotal}`}
                right={(
                  <div className="flex items-center gap-2 shrink-0">
                    {reqKeys.length > 0 && (
                      <span className="text-[9px] font-heading text-primary tabular-nums" title="Slowest requirement">
                        {bottleneckPct}%
                      </span>
                    )}
                    {completedMissions.length > 0 && (
                      <span className="text-[9px] font-heading text-zinc-500">{completedMissions.length} done</span>
                    )}
                  </div>
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
                    {reqKeys.includes('hitlist_npc_kills') && (
                      <p className="text-[10px] text-zinc-300 font-heading mt-2 rounded border border-primary/25 bg-primary/5 px-2.5 py-2 leading-snug">
                        <span className="text-primary font-bold uppercase tracking-wide text-[9px]">How to complete</span>
                        {' — '}
                        On{' '}
                        <Link to="/kill/hitlist" className="text-primary underline underline-offset-2 hover:text-primary/90">Hitlist</Link>
                        , tap <span className="text-foreground">Add NPC</span> (up to your on-board cap), then kill that target from{' '}
                        <Link to="/kill/attack" className="text-primary underline underline-offset-2 hover:text-primary/90">Attack</Link>
                        . Each successful kill adds one toward the bar above (only while this step is active — see note under the bars).
                      </p>
                    )}

                    {/* Progress bars per requirement */}
                    {target && typeof current === 'object' && current !== null && (
                      <div className="mt-2.5 space-y-2">
                        {Object.entries(target).map(([key, need]) => {
                          const cur = Number(current[key]) ?? 0;
                          const n = Number(need) ?? 1;
                          const pct = Math.min(100, Math.round((cur / n) * 100));
                          const fmt = (x) => Number(x).toLocaleString();
                          const label = IBM_REQUIREMENT_LABELS[key] || key.replace(/_/g, ' ');
                          const valueStr = key === 'rank_id'
                            ? `${ibmRankLabel(cur)} / ${ibmRankLabel(n)}`
                            : `${fmt(cur)} / ${fmt(n)}`;
                          return (
                            <div key={key}>
                              <div className="flex items-baseline justify-between mb-0.5 gap-2">
                                <span className="text-[9px] font-heading uppercase tracking-wider text-zinc-500">{label}</span>
                                <span className="text-[10px] font-heading text-primary text-right tabular-nums">{valueStr}</span>
                              </div>
                              <div className="h-1.5 rounded-full bg-zinc-800">
                                <div className={`r-bar-fill h-full rounded-full ${pct >= 100 ? 'bg-emerald-500' : 'bg-gradient-to-r from-primary/55 to-primary'}`} style={{ width: `${pct}%` }} />
                              </div>
                            </div>
                          );
                        })}
                        {hasSegmented && (
                          <p className="text-[9px] text-zinc-600 font-heading leading-snug pt-0.5">
                            Counts for collections, state crimes, raids, hires, slots, withdrawals, and hitlist practice NPC kills start from when this progress step began.
                          </p>
                        )}
                      </div>
                    )}

                    {rewardParts.length > 0 && (
                      <div className="mt-3 rounded-md border border-primary/10 bg-primary/5 px-3 py-2">
                        <div className="text-[8px] font-heading uppercase tracking-widest text-primary/70 mb-1.5">Rewards</div>
                        <div className="flex flex-wrap gap-1">
                          {rewardParts.map((line, i) => (
                            <span key={`rw-${i}-${line.slice(0, 24)}`} className="text-[9px] font-heading text-primary/90 px-2 py-0.5 rounded bg-primary/10 border border-primary/15">
                              {line}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  {requirementsMet && (
                    <button onClick={() => handleCompleteMission(mission.id)} disabled={saving}
                      className="flex items-center gap-0.5 shrink-0 text-[9px] font-heading font-bold uppercase tracking-wider text-primary bg-primary/15 border border-primary/40 px-2.5 py-1.5 rounded-md hover:bg-primary/25 disabled:opacity-40 transition-all shadow-sm">
                      <ChevronRight size={9} /> Complete
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

        {/* ── Ladder complete ── */}
        {!activeMission && missionsTotal > 0 && (
          <div className={`${styles.panel} r-card border border-emerald-500/25 rounded-md overflow-hidden mobile-panel`}>
            <CardHead icon={Award} title={`${BUSINESS_PROGRESS_LABEL} complete`}
              right={<span className="text-[9px] font-heading text-emerald-400/90">{missionsTotal} / {missionsTotal}</span>}
            />
            <div className="p-4">
              <p className="text-[11px] text-mutedForeground font-body">
                Your racket and distillery ladder is fully unlocked. Till, vault, guards, and raids keep running — keep collecting and defending the joint.
              </p>
            </div>
          </div>
        )}

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

            {/* Guards compact — collapsed by default (huge on mobile when many hired) */}
            <div>
              <button
                type="button"
                onClick={toggleMuscleOpen}
                className="w-full flex items-center justify-between gap-2 mb-2 text-left touch-manipulation"
                aria-expanded={muscleOpen}
              >
                <span className="text-[10px] font-heading uppercase tracking-widest text-mutedForeground">Muscle</span>
                <span className="flex items-center gap-2 shrink-0">
                  <span className="font-heading font-bold text-primary text-sm">{guardsCount} / {guardSlots}</span>
                  <span className="text-[9px] font-heading font-bold uppercase tracking-wider text-zinc-500">
                    {muscleOpen ? 'Hide' : 'Show'}
                  </span>
                  <ChevronDown size={14} className={`text-primary/70 transition-transform ${muscleOpen ? 'rotate-180' : ''}`} />
                </span>
              </button>

              {muscleOpen && guards.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {guards.map((g, i) => (
                    <div key={g.id} className="flex flex-wrap items-center gap-1 px-2 py-1 rounded bg-primary/5 border border-primary/12 max-w-full">
                      <span className="text-[9px] font-heading font-bold text-primary shrink-0">#{i + 1}</span>
                      <span className="text-[9px] text-zinc-500 shrink-0">A{g.armour_level} W{g.weapon_level}</span>
                      <div className="flex flex-wrap gap-1">
                        {g.next_armour_upgrade_cost != null && (
                          <button
                            type="button"
                            onClick={() => handleGuardGearUpgrade(g.id, { armour: true, weapon: false })}
                            disabled={saving || vault < g.next_armour_upgrade_cost}
                            title={`Vault: +1 armour — ${formatMoney(g.next_armour_upgrade_cost)}`}
                            className="text-[8px] font-heading font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border border-primary/25 text-primary hover:bg-primary/10 disabled:opacity-40"
                          >
                            +A {formatMoney(g.next_armour_upgrade_cost)}
                          </button>
                        )}
                        {g.next_weapon_upgrade_cost != null && (
                          <button
                            type="button"
                            onClick={() => handleGuardGearUpgrade(g.id, { armour: false, weapon: true })}
                            disabled={saving || vault < g.next_weapon_upgrade_cost}
                            title={`Vault: +1 weapon — ${formatMoney(g.next_weapon_upgrade_cost)}`}
                            className="text-[8px] font-heading font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border border-primary/25 text-primary hover:bg-primary/10 disabled:opacity-40"
                          >
                            +W {formatMoney(g.next_weapon_upgrade_cost)}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {!muscleOpen && guardsCount > 0 && (
                <p className="text-[9px] text-zinc-500 font-heading mb-2">
                  Guard list hidden — tap Muscle to upgrade armour / weapons.
                </p>
              )}

              <div className="flex flex-wrap gap-2">
                {guardsCount < guardSlots && (
                  <button onClick={() => handleHireGuard(guardsCount + 1)} disabled={saving}
                    className="flex items-center gap-1 text-[9px] font-heading font-bold uppercase tracking-wider text-primary border border-primary/30 px-2.5 py-1.5 rounded hover:bg-primary/10 disabled:opacity-40 transition-all">
                    <UserPlus size={9} /> Hire Guard — {formatMoney(guardHireCost)}
                  </button>
                )}
                {nextGuardSlotCostCash != null && (
                  <button onClick={handleBuyGuardSlot} disabled={saving}
                    className="flex items-center gap-1 text-[9px] font-heading font-bold uppercase tracking-wider text-primary border border-primary/30 px-2.5 py-1.5 rounded hover:bg-primary/10 disabled:opacity-40 transition-all">
                    <UserPlus size={9} /> Buy Guard Slot — {formatMoney(nextGuardSlotCostCash)}
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
              Send your crew to knock over a rival&apos;s operation. Successful hits pay $50,000–$2,000,000 straight into your racket vault.
            </p>
            <p className="text-[10px] font-heading text-zinc-500 mb-3">
              Raids today: <span className="text-primary font-bold">{raidsToday}</span>
              <span className="text-zinc-600"> / </span>
              <span className="text-foreground">{raidDailyLimit}</span>
              <span className="text-zinc-600 ml-1">(advance business progress to raise the cap up to 10 · max 20 hits on the same joint per day)</span>
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
                    <span className="text-[10px] text-emerald-400 font-heading">· {formatMoney(raidResult.loot_cash)} to vault</span>
                  )}
                </div>
                <p className="text-xs text-foreground">{raidResult.message}</p>
              </div>
            )}
          </div>
        </div>

        {/* ── Collapsible sections ── */}
        {completedMissions.length > 0 && (
          <Collapsible label="Progress history" count={completedMissions.length}>
            <div className="p-3 space-y-2">
              {missionLogRows.map(({ mission }) => (
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
              {missionLogHasMore && (
                <button
                  type="button"
                  onClick={() => {
                    setMissionLogShowAll((v) => {
                      const next = !v;
                      if (next) loadFullMissions();
                      return next;
                    });
                  }}
                  className="w-full text-center text-[9px] font-heading font-bold uppercase tracking-wider text-primary/90 py-2 rounded border border-primary/20 hover:bg-primary/5"
                >
                  {missionLogShowAll
                    ? `Show fewer (${MISSION_LOG_PREVIEW} recent)`
                    : `Show all ${completedMissionsSorted.length} completed`}
                </button>
              )}
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
