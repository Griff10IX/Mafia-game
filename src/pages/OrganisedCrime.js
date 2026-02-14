import { useState, useEffect } from 'react';
import { Users, Banknote, Star, Clock, AlertCircle, XCircle, UserCheck } from 'lucide-react';
import api from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

const ROLE_IDS = ['driver', 'weapons', 'explosives', 'hacker'];
const TICK_INTERVAL = 1000;

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

const PageHeader = ({ cooldownHours }) => (
  <div>
    <h1 className="text-2xl sm:text-4xl md:text-5xl font-heading font-bold text-primary mb-1 md:mb-2 flex items-center gap-3">
      <Users className="w-8 h-8 md:w-10 md:h-10" />
      Organised Crime
    </h1>
    <p className="text-sm text-mutedForeground">
      Team of 4: Driver, Weapons, Explosives, Hacker. Once every {cooldownHours ?? 6}h.
    </p>
  </div>
);

const CooldownBanner = ({ status }) => {
  const onCooldown = status?.cooldown_until && new Date(status.cooldown_until) > new Date();
  const cooldownStr = formatCooldown(status?.cooldown_until);

  if (!status?.cooldown_until) return null;

  return (
    <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
      <div className="px-4 py-2 bg-primary/10 border-b border-primary/30 flex items-center justify-between">
        <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest flex items-center gap-2">
          <Clock size={16} />
          Cooldown
        </span>
      </div>
      <div className="px-4 py-3">
        <p className="text-sm text-foreground font-heading">
          {onCooldown ? `Next heist in ${cooldownStr}` : '✓ Ready for a heist'}
        </p>
        {status.has_timer_upgrade && (
          <p className="text-xs text-primary/80 font-heading mt-1">
            4h timer (upgrade active)
          </p>
        )}
      </div>
    </div>
  );
};

const JobCard = ({ job, selected, onSelect }) => (
  <button
    type="button"
    onClick={() => onSelect(job.id)}
    className={`bg-card border rounded-md p-4 text-left transition-all ${
      selected 
        ? 'border-primary/60 bg-primary/10' 
        : 'border-border hover:border-primary/30'
    }`}
  >
    <div className="font-heading font-bold text-foreground text-base md:text-sm">
      {job.name}
    </div>
    <div className="mt-2 flex items-center gap-2 text-xs text-mutedForeground">
      <span>{(job.success_rate * 100).toFixed(0)}% success</span>
    </div>
    <div className="mt-3 flex items-center gap-3 text-sm md:text-xs">
      <span className="flex items-center gap-1.5 text-primary font-bold">
        <Banknote size={14} /> 
        ${(job.cash || 0).toLocaleString()}
      </span>
      <span className="flex items-center gap-1.5 text-primary font-bold">
        <Star size={14} /> 
        {job.rp || 0} RP
      </span>
    </div>
  </button>
);

const RoleSlotControl = ({ roleId, value, onValueChange, inviteInput, onInviteChange }) => {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="w-24 text-sm md:text-xs font-heading font-bold capitalize text-primary">
          {roleId}
        </span>
        <div className="flex items-center gap-3 flex-wrap">
          {['self', 'npc', 'invite'].map((opt) => (
            <label key={opt} className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name={`slot-${roleId}`}
                checked={value === opt}
                onChange={() => onValueChange(opt)}
                className="w-4 h-4 accent-primary cursor-pointer"
              />
              <span className="text-sm md:text-xs font-heading text-foreground">
                {opt === 'self' ? 'You' : opt === 'npc' ? 'NPC' : 'Invite'}
              </span>
            </label>
          ))}
        </div>
      </div>
      {value === 'invite' && (
        <input
          type="text"
          placeholder="Enter username"
          value={inviteInput}
          onChange={(e) => onInviteChange(e.target.value)}
          className="w-full md:w-48 bg-input border border-border rounded-md px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none"
        />
      )}
    </div>
  );
};

const NPC_SHARE = 35;
const PercentageControl = ({ roleId, value, onChange, isNpc }) => (
  <div className="flex items-center gap-2">
    <span className="text-sm md:text-xs font-heading capitalize w-24 text-primary/80">
      {roleId}
    </span>
    <input
      type="number"
      min={0}
      max={100}
      value={isNpc ? NPC_SHARE : (value ?? 25)}
      onChange={(e) => onChange(e.target.value)}
      readOnly={isNpc}
      className={`w-16 md:w-14 border rounded-md px-2 py-1.5 text-sm md:text-xs text-right text-foreground focus:outline-none ${
        isNpc ? 'bg-secondary/50 border-border text-mutedForeground cursor-default' : 'bg-input border-border focus:border-primary/50'
      }`}
    />
    <span className="text-sm md:text-xs text-mutedForeground">%</span>
  </div>
);

const InfoSection = ({ cooldownHours }) => (
  <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
    <div className="px-4 py-2 bg-primary/10 border-b border-primary/30">
      <h3 className="text-sm font-heading font-bold text-primary uppercase tracking-widest">
        Rules
      </h3>
    </div>
    <div className="p-4">
      <ul className="space-y-2 text-xs text-mutedForeground font-heading">
        <li className="flex items-start gap-2">
          <span className="text-primary shrink-0">▸</span>
          <span>Team of 4: Driver, Weapons, Explosives, Hacker. You must fill one slot (You).</span>
        </li>
        <li className="flex items-start gap-2">
          <span className="text-primary shrink-0">▸</span>
          <span>The creator sets each role's cut (%). Must sum to 100. NPC slots get nothing.</span>
        </li>
        <li className="flex items-start gap-2">
          <span className="text-primary shrink-0">▸</span>
          <span>Empty slots can be filled with NPCs for lower total pool (35% share per NPC).</span>
        </li>
        <li className="flex items-start gap-2">
          <span className="text-primary shrink-0">▸</span>
          <span>Harder jobs = better cash & RP but lower success chance.</span>
        </li>
        <li className="flex items-start gap-2">
          <span className="text-primary shrink-0">▸</span>
          <span>Cooldown: {cooldownHours ?? 6} hours. Buy "Reduce OC timer" on the Points/Store page for 4h.</span>
        </li>
      </ul>
    </div>
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

  const fetchData = async () => {
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
      console.error('Error fetching OC data:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

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
    // When NPC is picked, auto-assign 35% to that slot (take from self so total stays 100)
    if (value === 'npc') {
      const NPC_SHARE = 35;
      setPcts((prev) => {
        const selfRole = ROLE_IDS.find((r) => slots[r] === 'self');
        const selfCurrent = selfRole ? (prev[selfRole] || 0) : 0;
        const sumOthers = ROLE_IDS.filter((r) => r !== roleId).reduce((s, r) => s + (prev[r] || 0), 0);
        const room = 100 - sumOthers;
        const assign = Math.min(NPC_SHARE, room, (prev[roleId] || 0) + selfCurrent);
        const next = { ...prev, [roleId]: assign };
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
      toast.success(sendRes.data?.message || 'Invites sent. They must accept in their inbox.');
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
    if (pctTotal !== 100) {
      toast.error('Cut % must sum to 100');
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
    
    if (payload.driver === 'npc' && payload.weapons === 'npc' && payload.explosives === 'npc' && payload.hacker === 'npc') {
      toast.error('At least one slot must be you (Self)');
      return;
    }
    
    setExecuting(true);
    try {
      if (hasInviteSlot()) {
        const sendRes = await api.post('/oc/send-invites', payload);
        toast.success(sendRes.data?.message || 'Invites sent. They must accept in their inbox.');
        fetchData();
        return;
      }
      
      const res = await api.post('/oc/execute', payload);
      if (res.data.success) {
        toast.success(res.data.message, {
          description: res.data.cash_earned != null && (
            <span className="text-xs">
              +${res.data.cash_earned?.toLocaleString()} cash, +{res.data.rp_earned} RP
            </span>
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
    
    const allAccepted = (status.pending_invites || []).every((inv) => inv.status === 'accepted');
    const hasEmpty = ROLE_IDS.some((r) => {
      const v = status.pending_heist[r];
      return v == null || v === '';
    });
    
    if (hasEmpty) {
      toast.error('Fill all slots (set cleared slots to NPC or re-invite).');
      return;
    }
    
    if (!allAccepted && (status.pending_invites || []).length > 0) {
      toast.error('Wait for all invites to be accepted, or clear the slot.');
      return;
    }
    
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
            <span className="text-xs">
              +${res.data.cash_earned?.toLocaleString()} cash, +{res.data.rp_earned} RP
            </span>
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
      toast.success('Slot cleared. Set to NPC or invite someone else.');
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

  if (loading) {
    return <LoadingSpinner />;
  }

  return (
    <div className={`space-y-4 md:space-y-6 ${styles.pageContent}`} data-testid="organised-crime-page">
      <PageHeader cooldownHours={status?.cooldown_hours} />

      <CooldownBanner status={status} />

      {/* Pending Heist */}
      {status?.pending_heist && (
        <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
          <div className="px-4 py-2 bg-primary/10 border-b border-primary/30 flex items-center justify-between">
            <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest flex items-center gap-2">
              <UserCheck size={16} />
              Pending Heist — Invites Sent
            </span>
          </div>
          <div className="p-4 space-y-3">
            {ROLE_IDS.map((roleId) => {
              const val = status.pending_heist[roleId];
              const inv = (status.pending_invites || []).find((i) => i.role === roleId);
              const isEmpty = val == null || val === '';
              const displayVal = isEmpty ? '(empty)' : (val === 'self' ? 'You' : val === 'npc' ? 'NPC' : val);
              const statusStr = inv?.status;
              const canClear = inv && (statusStr === 'pending' || statusStr === 'expired');
              const editing = pendingSlotEdit.role === roleId;
              
              return (
                <div key={roleId} className="flex flex-wrap items-center gap-2 text-sm md:text-xs">
                  <span className="w-24 font-heading font-bold capitalize text-primary">
                    {roleId}
                  </span>
                  <span className="font-heading text-foreground">{displayVal}</span>
                  {inv && (
                    <span className={`font-heading ${
                      statusStr === 'accepted' ? 'text-green-500' : 'text-mutedForeground'
                    }`}>
                      ({statusStr})
                    </span>
                  )}
                  {canClear && (
                    <button
                      type="button"
                      onClick={() => cancelInvite(inv.invite_id)}
                      className="flex items-center gap-1 font-heading hover:underline text-mutedForeground"
                      title="Clear slot"
                    >
                      <XCircle size={14} /> Clear
                    </button>
                  )}
                  {isEmpty && !editing && (
                    <button
                      type="button"
                      onClick={() => setPendingSlotEdit({ role: roleId, value: '' })}
                      className="font-heading hover:underline text-primary"
                    >
                      Set NPC or invite
                    </button>
                  )}
                  {isEmpty && editing && (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder="npc or username"
                        value={pendingSlotEdit.value}
                        onChange={(e) => setPendingSlotEdit((p) => ({ ...p, value: e.target.value }))}
                        className="bg-input border border-border rounded-md px-2 py-1 text-xs w-32 text-foreground focus:border-primary/50 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setPendingSlot(pendingSlotEdit.role, pendingSlotEdit.value);
                          setPendingSlotEdit({ role: null, value: '' });
                        }}
                        className="text-xs font-heading font-bold text-primary"
                      >
                        Set
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingSlotEdit({ role: null, value: '' })}
                        className="text-xs text-mutedForeground"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
            <div className="pt-2">
              <button
                type="button"
                onClick={runFromPending}
                disabled={
                  executing ||
                  onCooldown ||
                  (status.pending_invites || []).some((i) => i.status === 'pending') ||
                  ROLE_IDS.some((r) => status.pending_heist[r] == null || status.pending_heist[r] === '')
                }
                className="bg-gradient-to-r from-primary via-yellow-600 to-primary hover:from-yellow-500 hover:via-yellow-600 hover:to-yellow-500 text-primaryForeground rounded-md px-6 py-3 text-sm font-bold uppercase tracking-wide shadow-lg shadow-primary/20 disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation border border-yellow-600/50"
              >
                {executing ? 'Running...' : '🎯 Run Heist'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Choose Job */}
      <div className="space-y-3">
        <h3 className="text-sm font-heading font-bold text-primary uppercase tracking-widest">
          Choose Job
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {(config.jobs || []).map((job) => (
            <JobCard
              key={job.id}
              job={job}
              selected={selectedJobId === job.id}
              onSelect={setSelectedJobId}
            />
          ))}
        </div>
      </div>

      {/* Team Slots */}
      <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
        <div className="px-4 py-2 bg-primary/10 border-b border-primary/30 flex items-center justify-between">
          <span className="text-sm font-heading font-bold text-primary uppercase tracking-widest flex items-center gap-2">
            <Users size={16} />
            Team (4 slots)
          </span>
        </div>
        <div className="p-4 space-y-4">
          {ROLE_IDS.map((roleId) => (
            <RoleSlotControl
              key={roleId}
              roleId={roleId}
              value={slots[roleId]}
              onValueChange={(val) => setSlot(roleId, val)}
              inviteInput={inviteInputs[roleId]}
              onInviteChange={(val) => setInviteInputs((p) => ({ ...p, [roleId]: val }))}
            />
          ))}
          
          {selfCount !== 1 && (
            <p className="text-sm md:text-xs font-heading flex items-center gap-1.5 text-mutedForeground pt-2">
              <AlertCircle size={14} /> 
              Exactly one slot must be "You".
            </p>
          )}
          
          {hasInviteSlot() && (
            <div className="pt-2">
              <button
                type="button"
                onClick={sendInvitesOnly}
                disabled={sendInviteLoading || selfCount !== 1 || pctTotal !== 100}
                className="bg-secondary text-foreground border border-primary/30 hover:bg-secondary/80 rounded-md px-4 py-2 text-sm font-bold uppercase tracking-wide disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation"
              >
                {sendInviteLoading ? 'Sending…' : '📨 Send Invites'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Cut Percentages */}
      <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
        <div className="px-4 py-2 bg-primary/10 border-b border-primary/30 flex items-center justify-between">
          <span className="text-sm md:text-xs font-heading font-bold text-primary uppercase tracking-widest">
            Cut per role (%)
          </span>
          <span className={`text-sm font-heading font-bold ${
            pctTotal === 100 ? 'text-primary' : 'text-mutedForeground'
          }`}>
            Total: {pctTotal}%
          </span>
        </div>
        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
          {ROLE_IDS.map((roleId) => (
            <PercentageControl
              key={roleId}
              roleId={roleId}
              value={pcts[roleId]}
              onChange={(val) => setPct(roleId, val)}
              isNpc={slots[roleId] === 'npc'}
            />
          ))}
        </div>
        {ROLE_IDS.some((r) => slots[r] === 'npc') && (
          <p className="px-4 pb-2 text-xs text-mutedForeground">
            NPC slots auto-assigned 35% each (pool reduced per NPC).
          </p>
        )}
        {pctTotal !== 100 && (
          <p className="px-4 pb-3 text-xs text-mutedForeground">
            Percentages must sum to 100.
          </p>
        )}
      </div>

      {/* Execute Button */}
      {!status?.pending_heist && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={execute}
            disabled={!canExecute || onCooldown || executing}
            className={`px-8 py-4 font-heading font-bold uppercase tracking-wider text-base md:text-sm transition-all touch-manipulation rounded-lg ${
              !canExecute || onCooldown || executing
                ? 'opacity-60 cursor-not-allowed bg-secondary text-mutedForeground border border-border'
                : 'bg-gradient-to-r from-primary via-yellow-600 to-primary hover:from-yellow-500 hover:via-yellow-600 hover:to-yellow-500 text-primaryForeground shadow-xl shadow-primary/20 hover:shadow-primary/30 border-2 border-yellow-600/50'
            }`}
          >
            {executing ? (
              'Running...'
            ) : onCooldown ? (
              `Cooldown ${cooldownStr}`
            ) : hasInviteSlot() ? (
              '📨 Send Invites'
            ) : (
              '🎯 Run Heist'
            )}
          </button>
        </div>
      )}

      <InfoSection cooldownHours={status?.cooldown_hours} />
    </div>
  );
}
