import { useState, useEffect, useCallback } from 'react';
import { Users, Banknote, Star, Clock, AlertCircle, XCircle, UserCheck, ChevronDown, ChevronRight } from 'lucide-react';
import api from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

const ROLE_IDS = ['driver', 'weapons', 'explosives', 'hacker'];
const ROLE_ICONS = { driver: '🚗', weapons: '🔫', explosives: '💣', hacker: '💻' };
const TICK_INTERVAL = 1000;
const COLLAPSED_KEY = 'oc_sections_collapsed';

// Utility functions
function formatCooldown(isoUntil) {
  if (!isoUntil) return null;
  const until = new Date(isoUntil);
  const now = new Date();
  const secs = Math.max(0, Math.floor((until - now) / 1000));
  if (secs <= 0) return null;
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return mm ? `${h}h ${mm}m` : `${h}h`;
  }
  return s ? `${m}m ${s}s` : `${m}m`;
}

// Custom hook for cooldown ticker
const useCooldownTicker = (cooldownUntil, onCooldownExpired) => {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!cooldownUntil) return;

    let hasRefetched = false;
    const intervalId = setInterval(() => {
      const until = new Date(cooldownUntil);
      
      if (until <= new Date() && !hasRefetched) {
        hasRefetched = true;
        onCooldownExpired();
      }
      
      setTick((prev) => prev + 1);
    }, TICK_INTERVAL);

    return () => clearInterval(intervalId);
  }, [cooldownUntil, onCooldownExpired]);

  return tick;
};

// Subcomponents
const LoadingSpinner = () => (
  <div className="flex items-center justify-center min-h-[60vh]">
    <div className="text-primary text-xl font-heading font-bold">Loading...</div>
  </div>
);

const PageHeader = ({ cooldownHours, status }) => {
  const onCooldown = status?.cooldown_until && new Date(status.cooldown_until) > new Date();
  const cooldownStr = formatCooldown(status?.cooldown_until);

  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl sm:text-3xl font-heading font-bold text-primary mb-1 flex items-center gap-2">
          <Users className="w-6 h-6 sm:w-7 sm:h-7" />
          Organised Crime
        </h1>
        <p className="text-xs text-mutedForeground">
          Team of 4 — Once every {cooldownHours ?? 6}h
        </p>
      </div>
      
      {/* Status */}
      <div className="flex items-center gap-2 text-xs font-heading">
        <Clock size={14} className="text-primary" />
        {onCooldown ? (
          <span className="text-mutedForeground">Next in <span className="text-primary font-bold">{cooldownStr}</span></span>
        ) : (
          <span className="text-emerald-400 font-bold">✓ Ready</span>
        )}
        {status?.has_timer_upgrade && <span className="text-primary/60">(4h)</span>}
      </div>
    </div>
  );
};

// Job card for grid layout
const JobCard = ({ job, selected, onSelect }) => (
  <button
    type="button"
    onClick={() => onSelect(job.id)}
    className={`flex flex-col p-3 rounded-lg transition-all text-left ${
      selected 
        ? 'bg-primary/15 border-2 border-primary/50 shadow-lg shadow-primary/10' 
        : 'bg-zinc-800/30 border border-zinc-700/50 hover:border-primary/30 hover:bg-zinc-800/50'
    }`}
  >
    <div className="flex items-center gap-2 mb-2">
      <span className={`w-3 h-3 rounded-full border-2 flex items-center justify-center shrink-0 ${
        selected ? 'border-primary bg-primary' : 'border-zinc-600'
      }`}>
        {selected && <span className="w-1 h-1 rounded-full bg-primaryForeground" />}
      </span>
      <span className="text-sm font-heading font-bold text-foreground truncate">{job.name}</span>
    </div>
    <div className="flex items-center justify-between gap-2 text-xs font-heading">
      <span className={`${selected ? 'text-foreground' : 'text-mutedForeground'}`}>
        {(job.success_rate * 100).toFixed(0)}%
      </span>
      <span className="text-primary font-bold">${(job.cash || 0).toLocaleString()}</span>
    </div>
    <div className="text-xs font-heading text-primary/80 mt-1">
      +{job.rp || 0} RP
    </div>
  </button>
);

// Styled toggle button group for role assignment
const RoleToggleGroup = ({ roleId, value, onValueChange }) => {
  const options = [
    { id: 'self', label: 'You', color: 'emerald' },
    { id: 'npc', label: 'NPC', color: 'zinc' },
    { id: 'invite', label: 'Invite', color: 'blue' },
  ];

  return (
    <div className="flex rounded-md overflow-hidden border border-zinc-700/50">
      {options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          onClick={() => onValueChange(opt.id)}
          className={`px-3 py-1.5 text-[10px] font-heading font-bold uppercase transition-all ${
            value === opt.id
              ? opt.id === 'self'
                ? 'bg-emerald-500/20 text-emerald-400 border-r border-emerald-500/30'
                : opt.id === 'npc'
                ? 'bg-zinc-600/30 text-zinc-300 border-r border-zinc-600/50'
                : 'bg-blue-500/20 text-blue-400'
              : 'bg-zinc-800/50 text-mutedForeground hover:bg-zinc-700/50 border-r border-zinc-700/50 last:border-r-0'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
};

// Compact role slot row
const RoleSlotRow = ({ roleId, value, onValueChange, inviteInput, onInviteChange, pct, onPctChange, isNpc }) => (
  <div className="flex items-center gap-3 px-3 py-2 rounded-md bg-zinc-800/20 border border-transparent hover:border-primary/10">
    {/* Role name */}
    <div className="w-24 flex items-center gap-1.5">
      <span className="text-sm">{ROLE_ICONS[roleId]}</span>
      <span className="text-xs font-heading font-bold text-primary capitalize">{roleId}</span>
    </div>

    {/* Toggle buttons */}
    <RoleToggleGroup roleId={roleId} value={value} onValueChange={onValueChange} />

    {/* Invite input */}
    {value === 'invite' && (
      <input
        type="text"
        placeholder="Username"
        value={inviteInput}
        onChange={(e) => onInviteChange(e.target.value)}
        className="w-28 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-xs text-foreground focus:border-primary/50 focus:outline-none"
      />
    )}

    {/* Percentage */}
    <div className="flex items-center gap-1 ml-auto">
      <input
        type="number"
        min={0}
        max={100}
        value={pct}
        onChange={(e) => onPctChange(e.target.value)}
        readOnly={isNpc}
        className={`w-12 border rounded px-2 py-1 text-xs text-right focus:outline-none ${
          isNpc 
            ? 'bg-zinc-800/50 border-zinc-700/50 text-mutedForeground cursor-default' 
            : 'bg-zinc-900/50 border-zinc-700/50 text-foreground focus:border-primary/50'
        }`}
      />
      <span className="text-[10px] text-mutedForeground">%</span>
    </div>
  </div>
);

// Pending heist section
const PendingHeistSection = ({ status, executing, onCooldown, onRun, onCancel, pendingSlotEdit, setPendingSlotEdit, setPendingSlot }) => {
  if (!status?.pending_heist) return null;

  return (
    <div className={`${styles.panel} rounded-md overflow-hidden border border-amber-500/30`}>
      <div className="px-3 py-2 bg-amber-500/10 border-b border-amber-500/30 flex items-center justify-between">
        <span className="text-xs font-heading font-bold text-amber-400 uppercase tracking-widest flex items-center gap-2">
          <UserCheck size={14} />
          Pending Heist
        </span>
      </div>
      <div className="p-3 space-y-2">
        {ROLE_IDS.map((roleId) => {
          const val = status.pending_heist[roleId];
          const inv = (status.pending_invites || []).find((i) => i.role === roleId);
          const isEmpty = val == null || val === '';
          const displayVal = isEmpty ? '—' : (val === 'self' ? 'You' : val === 'npc' ? 'NPC' : val);
          const statusStr = inv?.status;
          const canClear = inv && (statusStr === 'pending' || statusStr === 'expired');
          const editing = pendingSlotEdit.role === roleId;
          
          return (
            <div key={roleId} className="flex items-center gap-2 px-2 py-1.5 rounded bg-zinc-800/30 text-xs">
              <span className="w-20 font-heading font-bold text-primary capitalize flex items-center gap-1">
                <span>{ROLE_ICONS[roleId]}</span> {roleId}
              </span>
              <span className="font-heading text-foreground">{displayVal}</span>
              {inv && (
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                  statusStr === 'accepted' 
                    ? 'bg-emerald-500/20 text-emerald-400' 
                    : statusStr === 'pending'
                    ? 'bg-amber-500/20 text-amber-400'
                    : 'bg-zinc-700/50 text-mutedForeground'
                }`}>
                  {statusStr}
                </span>
              )}
              {canClear && (
                <button type="button" onClick={() => onCancel(inv.invite_id)} className="text-mutedForeground hover:text-red-400 ml-auto">
                  <XCircle size={14} />
                </button>
              )}
              {isEmpty && !editing && (
                <button
                  type="button"
                  onClick={() => setPendingSlotEdit({ role: roleId, value: '' })}
                  className="text-[10px] font-heading text-primary hover:underline ml-auto"
                >
                  Set
                </button>
              )}
              {isEmpty && editing && (
                <div className="flex items-center gap-1 ml-auto">
                  <input
                    type="text"
                    placeholder="npc / username"
                    value={pendingSlotEdit.value}
                    onChange={(e) => setPendingSlotEdit((p) => ({ ...p, value: e.target.value }))}
                    className="bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-0.5 text-[10px] w-24 text-foreground focus:border-primary/50 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => { setPendingSlot(pendingSlotEdit.role, pendingSlotEdit.value); setPendingSlotEdit({ role: null, value: '' }); }}
                    className="text-[10px] font-bold text-primary"
                  >
                    ✓
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingSlotEdit({ role: null, value: '' })}
                    className="text-[10px] text-mutedForeground"
                  >
                    ✕
                  </button>
                </div>
              )}
            </div>
          );
        })}
        
        <button
          type="button"
          onClick={onRun}
          disabled={
            executing || onCooldown ||
            (status.pending_invites || []).some((i) => i.status === 'pending') ||
            ROLE_IDS.some((r) => status.pending_heist[r] == null || status.pending_heist[r] === '')
          }
          className="w-full mt-2 bg-gradient-to-b from-primary to-yellow-700 hover:from-yellow-500 hover:to-yellow-600 text-primaryForeground rounded px-4 py-2 text-xs font-bold uppercase tracking-wide shadow shadow-primary/20 disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation border border-yellow-600/50"
        >
          {executing ? 'Running...' : '🎯 Run Heist'}
        </button>
      </div>
    </div>
  );
};

const InfoSection = ({ cooldownHours, isCollapsed, onToggle }) => (
  <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
    <button
      type="button"
      onClick={onToggle}
      className="w-full px-3 py-2 bg-primary/10 border-b border-primary/30 flex items-center justify-between hover:bg-primary/15 transition-colors"
    >
      <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">
        ℹ️ Rules
      </span>
      <span className="text-primary/80">
        {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
      </span>
    </button>
    {!isCollapsed && (
      <div className="p-3">
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-mutedForeground font-heading">
          <li className="flex items-start gap-1.5">
            <span className="text-primary shrink-0">•</span>
            <span>Team of 4: Driver, Weapons, Explosives, Hacker</span>
          </li>
          <li className="flex items-start gap-1.5">
            <span className="text-primary shrink-0">•</span>
            <span>Exactly one slot must be "You"</span>
          </li>
          <li className="flex items-start gap-1.5">
            <span className="text-primary shrink-0">•</span>
            <span>Cut % must sum to 100. NPCs auto-assigned</span>
          </li>
          <li className="flex items-start gap-1.5">
            <span className="text-primary shrink-0">•</span>
            <span>Cooldown: {cooldownHours ?? 6}h (4h with upgrade)</span>
          </li>
        </ul>
      </div>
    )}
  </div>
);

// Main component
export default function OrganisedCrime() {
  const [config, setConfig] = useState({ jobs: [], roles: [] });
  const [status, setStatus] = useState(null);
  const [selectedJobId, setSelectedJobId] = useState('');
  const [slots, setSlots] = useState({ driver: 'self', weapons: 'npc', explosives: 'npc', hacker: 'npc' });
  const [inviteInputs, setInviteInputs] = useState({ driver: '', weapons: '', explosives: '', hacker: '' });
  const [pcts, setPcts] = useState({ driver: 25, weapons: 25, explosives: 25, hacker: 25 });
  const [executing, setExecuting] = useState(false);
  const [sendInviteLoading, setSendInviteLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pendingSlotEdit, setPendingSlotEdit] = useState({ role: null, value: '' });
  const [rulesCollapsed, setRulesCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSED_KEY) === 'true'; } catch { return true; }
  });

  const toggleRules = () => {
    setRulesCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem(COLLAPSED_KEY, String(next)); } catch {}
      return next;
    });
  };

  const fetchData = useCallback(async () => {
    try {
      const [configRes, statusRes] = await Promise.all([
        api.get('/oc/config'),
        api.get('/oc/status'),
      ]);
      
      if (configRes.data) {
        setConfig({ jobs: configRes.data.jobs || [], roles: configRes.data.roles || [] });
      }
      
      if (statusRes.data) {
        setStatus(statusRes.data);
      }
      
      if (configRes.data?.jobs?.length && !selectedJobId) {
        setSelectedJobId(configRes.data.jobs[0].id);
      }
    } catch (e) {
      toast.error('Failed to load Organised Crime data');
    } finally {
      setLoading(false);
    }
  }, [selectedJobId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const tick = useCooldownTicker(status?.cooldown_until, fetchData);

  const getSlotValue = (roleId) => {
    const s = slots[roleId];
    if (s === 'invite') return inviteInputs[roleId]?.trim() || '';
    return s;
  };

  const setSlot = (roleId, value) => {
    setSlots((prev) => ({ ...prev, [roleId]: value }));
    if (value !== 'invite') {
      setInviteInputs((prev) => ({ ...prev, [roleId]: '' }));
    }
    if (value === 'npc') {
      setPcts((prev) => {
        const npcSlots = [roleId, ...ROLE_IDS.filter((r) => r !== roleId && slots[r] === 'npc')];
        const selfRole = ROLE_IDS.find((r) => slots[r] === 'self');
        const next = { ...prev };

        if (npcSlots.length === 3) {
          next[selfRole] = 20;
          next[npcSlots[0]] = 27;
          next[npcSlots[1]] = 27;
          next[npcSlots[2]] = 26;
          return next;
        }

        const NPC_SHARE = 35;
        const selfCurrent = selfRole ? (prev[selfRole] || 0) : 0;
        const sumOthers = ROLE_IDS.filter((r) => r !== roleId).reduce((s, r) => s + (prev[r] || 0), 0);
        const room = 100 - sumOthers;
        const assign = Math.min(NPC_SHARE, room, (prev[roleId] || 0) + selfCurrent);
        next[roleId] = assign;
        if (selfRole) {
          next[selfRole] = selfCurrent - (assign - (prev[roleId] || 0));
        }
        return next;
      });
    }
  };

  const selfCount = ROLE_IDS.filter((r) => slots[r] === 'self').length;
  const pctTotal = ROLE_IDS.reduce((s, r) => s + (pcts[r] || 0), 0);
  const canExecute = selfCount === 1 && config.jobs.length > 0 && selectedJobId && pctTotal === 100;

  const setPct = (roleId, val) => {
    const n = Math.max(0, Math.min(100, parseInt(val, 10) || 0));
    setPcts((prev) => ({ ...prev, [roleId]: n }));
  };

  const hasInviteSlot = () => {
    for (const r of ROLE_IDS) {
      const v = getSlotValue(r);
      if (v && v.toLowerCase() !== 'self' && v.toLowerCase() !== 'npc') return true;
    }
    return false;
  };

  const sendInvitesOnly = async () => {
    if (!hasInviteSlot() || sendInviteLoading || pctTotal !== 100 || selfCount !== 1) {
      if (pctTotal !== 100) toast.error('Cut % must sum to 100 first.');
      else if (selfCount !== 1) toast.error('Exactly one slot must be You.');
      return;
    }
    
    const payload = {
      job_id: selectedJobId,
      driver: getSlotValue('driver') || 'npc',
      weapons: getSlotValue('weapons') || 'npc',
      explosives: getSlotValue('explosives') || 'npc',
      hacker: getSlotValue('hacker') || 'npc',
      driver_pct: pcts.driver,
      weapons_pct: pcts.weapons,
      explosives_pct: pcts.explosives,
      hacker_pct: pcts.hacker,
    };
    
    setSendInviteLoading(true);
    try {
      const sendRes = await api.post('/oc/send-invites', payload);
      toast.success(sendRes.data?.message || 'Invites sent.');
      fetchData();
    } catch (err) {
      const msg = err.response?.data?.detail || err.message;
      toast.error(typeof msg === 'string' ? msg : 'Failed to send invites');
      fetchData();
    } finally {
      setSendInviteLoading(false);
    }
  };

  const execute = async () => {
    if (!canExecute || executing) return;
    if (pctTotal !== 100) { toast.error('Cut % must sum to 100'); return; }
    
    const payload = {
      job_id: selectedJobId,
      driver: getSlotValue('driver') || 'npc',
      weapons: getSlotValue('weapons') || 'npc',
      explosives: getSlotValue('explosives') || 'npc',
      hacker: getSlotValue('hacker') || 'npc',
      driver_pct: pcts.driver,
      weapons_pct: pcts.weapons,
      explosives_pct: pcts.explosives,
      hacker_pct: pcts.hacker,
    };
    
    if (payload.driver === 'npc' && payload.weapons === 'npc' && payload.explosives === 'npc' && payload.hacker === 'npc') {
      toast.error('At least one slot must be you (Self)');
      return;
    }
    
    setExecuting(true);
    try {
      if (hasInviteSlot()) {
        const sendRes = await api.post('/oc/send-invites', payload);
        toast.success(sendRes.data?.message || 'Invites sent.');
        fetchData();
        return;
      }
      
      const res = await api.post('/oc/execute', payload);
      if (res.data.success) {
        toast.success(res.data.message, {
          description: res.data.cash_earned != null && (
            <span className="text-xs">+${res.data.cash_earned?.toLocaleString()} cash, +{res.data.rp_earned} RP</span>
          ),
        });
      } else {
        toast.error(res.data.message || 'Heist failed');
      }
      fetchData();
    } catch (err) {
      const msg = err.response?.data?.detail || err.message;
      toast.error(typeof msg === 'string' ? msg : 'Heist request failed');
      fetchData();
    } finally {
      setExecuting(false);
    }
  };

  const runFromPending = async () => {
    const onCooldown = status?.cooldown_until && new Date(status.cooldown_until) > new Date();
    if (!status?.pending_heist?.id || executing || onCooldown) return;
    
    const hasEmpty = ROLE_IDS.some((r) => {
      const v = status.pending_heist[r];
      return v == null || v === '';
    });
    
    if (hasEmpty) { toast.error('Fill all slots first.'); return; }
    
    setExecuting(true);
    try {
      const res = await api.post('/oc/execute', {
        job_id: status.pending_heist.job_id,
        driver: status.pending_heist.driver || 'npc',
        weapons: status.pending_heist.weapons || 'npc',
        explosives: status.pending_heist.explosives || 'npc',
        hacker: status.pending_heist.hacker || 'npc',
        driver_pct: status.pending_heist.driver_pct,
        weapons_pct: status.pending_heist.weapons_pct,
        explosives_pct: status.pending_heist.explosives_pct,
        hacker_pct: status.pending_heist.hacker_pct,
        pending_heist_id: status.pending_heist.id,
      });
      
      if (res.data.success) {
        toast.success(res.data.message, {
          description: res.data.cash_earned != null && (
            <span className="text-xs">+${res.data.cash_earned?.toLocaleString()} cash, +{res.data.rp_earned} RP</span>
          ),
        });
      } else {
        toast.error(res.data.message || 'Heist failed');
      }
      fetchData();
    } catch (err) {
      const msg = err.response?.data?.detail || err.message;
      toast.error(typeof msg === 'string' ? msg : 'Run failed');
      fetchData();
    } finally {
      setExecuting(false);
    }
  };

  const cancelInvite = async (inviteId) => {
    try {
      await api.post(`/oc/invite/${inviteId}/cancel`);
      toast.success('Slot cleared.');
      fetchData();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to clear');
    }
  };

  const setPendingSlot = async (role, value) => {
    if (!value?.trim()) return;
    try {
      await api.post('/oc/pending/set-slot', { role, value: value.trim() });
      toast.success(value.toLowerCase() === 'npc' ? 'Set to NPC' : 'Invite sent.');
      fetchData();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    }
  };

  const onCooldown = status?.cooldown_until && new Date(status.cooldown_until) > new Date();
  const cooldownStr = formatCooldown(status?.cooldown_until);

  if (loading) return <LoadingSpinner />;

  return (
    <div className={`space-y-4 ${styles.pageContent}`} data-testid="organised-crime-page">
      <PageHeader cooldownHours={status?.cooldown_hours} status={status} />

      {/* Pending Heist */}
      <PendingHeistSection
        status={status}
        executing={executing}
        onCooldown={onCooldown}
        onRun={runFromPending}
        onCancel={cancelInvite}
        pendingSlotEdit={pendingSlotEdit}
        setPendingSlotEdit={setPendingSlotEdit}
        setPendingSlot={setPendingSlot}
      />

      {/* Job Selection */}
      <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
        <div className="px-3 py-2 bg-primary/10 border-b border-primary/30">
          <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">
            Select Job
          </span>
        </div>
        <div className="p-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {(config.jobs || []).map((job) => (
              <JobCard key={job.id} job={job} selected={selectedJobId === job.id} onSelect={setSelectedJobId} />
            ))}
          </div>
        </div>
      </div>

      {/* Team Slots */}
      <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
        <div className="px-3 py-2 bg-primary/10 border-b border-primary/30 flex items-center justify-between">
          <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">
            Team & Cut %
          </span>
          <span className={`text-xs font-heading font-bold ${pctTotal === 100 ? 'text-emerald-400' : 'text-red-400'}`}>
            {pctTotal}%
          </span>
        </div>
        <div className="p-2 space-y-1">
          {ROLE_IDS.map((roleId) => (
            <RoleSlotRow
              key={roleId}
              roleId={roleId}
              value={slots[roleId]}
              onValueChange={(val) => setSlot(roleId, val)}
              inviteInput={inviteInputs[roleId]}
              onInviteChange={(val) => setInviteInputs((p) => ({ ...p, [roleId]: val }))}
              pct={pcts[roleId]}
              onPctChange={(val) => setPct(roleId, val)}
              isNpc={slots[roleId] === 'npc'}
            />
          ))}
        </div>
        
        {selfCount !== 1 && (
          <div className="px-3 pb-2">
            <p className="text-[10px] font-heading flex items-center gap-1 text-amber-400">
              <AlertCircle size={12} /> Exactly one slot must be "You"
            </p>
          </div>
        )}
        {pctTotal !== 100 && (
          <div className="px-3 pb-2">
            <p className="text-[10px] font-heading text-mutedForeground">
              Percentages must sum to 100
            </p>
          </div>
        )}
      </div>

      {/* Execute Button */}
      {!status?.pending_heist && (
        <button
          type="button"
          onClick={execute}
          disabled={!canExecute || onCooldown || executing}
          className={`w-full py-3 font-heading font-bold uppercase tracking-wider text-sm transition-all touch-manipulation rounded-md ${
            !canExecute || onCooldown || executing
              ? 'opacity-50 cursor-not-allowed bg-zinc-800 text-mutedForeground border border-zinc-700'
              : 'bg-gradient-to-b from-primary to-yellow-700 hover:from-yellow-500 hover:to-yellow-600 text-primaryForeground shadow-lg shadow-primary/20 border border-yellow-600/50'
          }`}
        >
          {executing ? 'Running...' : onCooldown ? `Cooldown ${cooldownStr}` : hasInviteSlot() ? '📨 Send Invites' : '🎯 Run Heist'}
        </button>
      )}

      <InfoSection cooldownHours={status?.cooldown_hours} isCollapsed={rulesCollapsed} onToggle={toggleRules} />
    </div>
  );
}
