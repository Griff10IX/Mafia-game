import { useState, useEffect } from 'react';
import { Users, Banknote, Star, Clock, AlertCircle, XCircle, UserCheck } from 'lucide-react';
import api from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

const ROLE_IDS = ['driver', 'weapons', 'explosives', 'hacker'];

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

export default function OrganisedCrime() {
  const [config, setConfig] = useState({ jobs: [], roles: [] });
  const [status, setStatus] = useState(null);
  const [selectedJobId, setSelectedJobId] = useState('');
  const [slots, setSlots] = useState({ driver: 'self', weapons: 'npc', explosives: 'npc', hacker: 'npc' });
  const [inviteInputs, setInviteInputs] = useState({ driver: '', weapons: '', explosives: '', hacker: '' });
  const [pcts, setPcts] = useState({ driver: 25, weapons: 25, explosives: 25, hacker: 25 });
  const [executing, setExecuting] = useState(false);
  const [sendInviteLoading, setSendInviteLoading] = useState(false);
  const [, setTick] = useState(0);
  const [pendingSlotEdit, setPendingSlotEdit] = useState({ role: null, value: '' });

  const ocBorder = '#303030';
  const ocMuted = '#a1a1aa';
  const ocText = '#f5f5f5';

  const fetchData = async () => {
    try {
      const [configRes, statusRes] = await Promise.all([
        api.get('/oc/config'),
        api.get('/oc/status'),
      ]);
      if (configRes.data) setConfig({ jobs: configRes.data.jobs || [], roles: configRes.data.roles || [] });
      if (statusRes.data) setStatus(statusRes.data);
      if (configRes.data?.jobs?.length && !selectedJobId) setSelectedJobId(configRes.data.jobs[0].id);
    } catch (e) {
      toast.error('Failed to load Organised Crime data');
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (!status?.cooldown_until) return;
    const id = setInterval(() => {
      const until = new Date(status.cooldown_until);
      if (until <= new Date()) fetchData();
      setTick((t) => t + 1);
    }, 1000);
    return () => clearInterval(id);
  }, [status?.cooldown_until]);

  const getSlotValue = (roleId) => {
    const s = slots[roleId];
    if (s === 'invite') return inviteInputs[roleId]?.trim() || '';
    return s;
  };

  const setSlot = (roleId, value) => {
    setSlots((prev) => ({ ...prev, [roleId]: value }));
    if (value !== 'invite') setInviteInputs((prev) => ({ ...prev, [roleId]: '' }));
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

  return (
    <div className={`space-y-6 ${styles.pageContent}`} data-testid="organised-crime-page">
      <div>
        <div className="flex items-center gap-4 mb-3">
          <div className="h-px flex-1" style={{ background: `linear-gradient(to right, transparent, ${ocBorder})` }} />
          <h1 className="text-2xl md:text-3xl font-heading font-bold tracking-wider uppercase flex items-center gap-3" style={{ color: ocText }}>
            <Users size={24} style={{ color: ocMuted }} />
            Organised Crime
          </h1>
          <div className="h-px flex-1" style={{ background: `linear-gradient(to left, transparent, ${ocBorder})` }} />
        </div>
        <p className="text-center text-sm font-heading tracking-wide" style={{ color: ocMuted }}>
          Team of 4: Driver, Weapons, Explosives, Hacker. Fill empty slots with NPCs for lower payouts. Once every {status?.cooldown_hours ?? 6}h.
        </p>
      </div>

      {status?.cooldown_until && (
        <div className={`${styles.panel} rounded-md overflow-hidden max-w-2xl mx-auto border`} style={{ borderColor: ocBorder }}>
          <div className="px-4 py-2 border-b flex items-center justify-between" style={{ borderColor: ocBorder, color: ocMuted }}>
            <span className="text-xs font-heading font-bold uppercase tracking-widest">Cooldown</span>
            <Clock size={18} style={{ color: ocMuted }} />
          </div>
          <div className="p-4 flex items-center justify-between">
            <span className="text-sm text-mutedForeground font-heading">
              {onCooldown ? `Next heist in ${cooldownStr}` : 'Ready for a heist'}
            </span>
            {status.has_timer_upgrade && (
              <span className="text-xs font-heading" style={{ color: ocMuted }}>4h timer (upgrade active)</span>
            )}
          </div>
        </div>
      )}

      {status?.pending_heist && (
        <div className="rounded-md overflow-hidden max-w-2xl mx-auto border" style={{ backgroundColor: 'var(--gm-bg-top)', borderColor: ocBorder }}>
          <div className="px-4 py-2 border-b flex items-center justify-between" style={{ borderColor: ocBorder, color: ocMuted }}>
            <span className="text-xs font-heading font-bold uppercase tracking-widest">Pending heist — invites sent</span>
            <UserCheck size={18} style={{ color: ocMuted }} />
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
                <div key={roleId} className="flex flex-wrap items-center gap-2">
                  <span className="w-24 text-xs font-heading font-bold capitalize shrink-0" style={{ color: ocMuted }}>{roleId}</span>
                  <span className="text-xs font-heading" style={{ color: ocText }}>{displayVal}</span>
                  {inv && <span className="text-xs font-heading" style={{ color: statusStr === 'accepted' ? 'var(--gm-profit)' : ocMuted }}>({statusStr})</span>}
                  {canClear && (
                    <button type="button" onClick={() => cancelInvite(inv.invite_id)} className="flex items-center gap-1 text-xs font-heading hover:underline" style={{ color: ocMuted }} title="Clear slot">
                      <XCircle size={14} /> Clear
                    </button>
                  )}
                  {isEmpty && (
                    <>
                      {!editing ? (
                        <button type="button" onClick={() => setPendingSlotEdit({ role: roleId, value: '' })} className="text-xs font-heading hover:underline" style={{ color: ocText }}>Set NPC or invite</button>
                      ) : (
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            placeholder="npc or username"
                            value={pendingSlotEdit.value}
                            onChange={(e) => setPendingSlotEdit((p) => ({ ...p, value: e.target.value }))}
                            className="rounded px-2 py-1 text-xs font-heading w-32"
                            style={{ backgroundColor: 'var(--gm-card)', border: `1px solid ${ocBorder}`, color: ocText }}
                          />
                          <button type="button" onClick={() => { setPendingSlot(pendingSlotEdit.role, pendingSlotEdit.value); setPendingSlotEdit({ role: null, value: '' }); }} className="text-xs font-heading font-bold" style={{ color: ocText }}>Set</button>
                          <button type="button" onClick={() => setPendingSlotEdit({ role: null, value: '' })} className="text-xs text-mutedForeground">Cancel</button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
            <div className="pt-2">
              <button type="button" onClick={runFromPending} disabled={executing || onCooldown || (status.pending_invites || []).some((i) => i.status === 'pending') || ROLE_IDS.some((r) => status.pending_heist[r] == null || status.pending_heist[r] === '')} className="rounded-sm font-heading font-bold uppercase tracking-widest px-4 py-2 text-sm border disabled:opacity-50" style={{ backgroundColor: 'var(--gm-card)', borderColor: ocBorder, color: ocText }}>
                {executing ? 'Running...' : 'Run heist'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-4xl mx-auto space-y-4">
        <h3 className="text-sm font-heading font-bold uppercase tracking-widest" style={{ color: ocMuted }}>Choose job</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {(config.jobs || []).map((job) => (
            <button
              key={job.id}
              type="button"
              onClick={() => setSelectedJobId(job.id)}
              className={`${styles.panel} rounded-md p-4 text-left border transition-smooth ${
                selectedJobId === job.id ? 'hover:opacity-95' : ''
              }`}
              style={{
                borderColor: selectedJobId === job.id ? ocBorder : ocBorder,
                backgroundColor: selectedJobId === job.id ? 'var(--gm-card-hover)' : 'var(--gm-card)',
              }}
            >
              <div className="font-heading font-bold text-foreground">{job.name}</div>
              <div className="mt-1 flex items-center gap-2 text-xs text-mutedForeground">
                <span>{(job.success_rate * 100).toFixed(0)}% success</span>
              </div>
              <div className="mt-2 flex items-center gap-3 text-xs">
                <span className="flex items-center gap-1" style={{ color: ocMuted }}>
                  <Banknote size={12} /> ${(job.cash || 0).toLocaleString()}
                </span>
                <span className="flex items-center gap-1" style={{ color: ocMuted }}>
                  <Star size={12} /> {job.rp || 0} RP
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-md overflow-hidden max-w-2xl mx-auto border" style={{ backgroundColor: 'var(--gm-bg-top)', borderColor: ocBorder }}>
        <div className="px-4 py-2 border-b flex items-center justify-between" style={{ borderColor: ocBorder, color: ocMuted }}>
          <span className="text-xs font-heading font-bold uppercase tracking-widest">Team (4 slots)</span>
          <Users size={18} style={{ color: ocMuted }} />
        </div>
        <div className="p-4 space-y-3">
          {ROLE_IDS.map((roleId) => (
            <div key={roleId} className="flex flex-wrap items-center gap-2">
              <span className="w-24 text-xs font-heading font-bold capitalize shrink-0" style={{ color: ocMuted }}>{roleId}</span>
              <div className="flex flex-wrap items-center gap-2">
                {['self', 'npc', 'invite'].map((opt) => (
                  <label key={opt} className="flex items-center gap-1.5 cursor-pointer" style={{ color: ocText }}>
                    <input
                      type="radio"
                      name={`slot-${roleId}`}
                      checked={slots[roleId] === opt}
                      onChange={() => setSlot(roleId, opt)}
                      className="accent-[#404040]"
                      style={{ accentColor: '#404040' }}
                    />
                    <span className="text-xs font-heading">
                      {opt === 'self' ? 'You' : opt === 'npc' ? 'NPC' : 'Invite'}
                    </span>
                  </label>
                ))}
                {slots[roleId] === 'invite' && (
                  <input
                    type="text"
                    placeholder="Username"
                    value={inviteInputs[roleId]}
                    onChange={(e) => setInviteInputs((p) => ({ ...p, [roleId]: e.target.value }))}
                    className="rounded px-2 py-1 text-xs font-heading w-32"
                    style={{ backgroundColor: 'var(--gm-card)', border: `1px solid ${ocBorder}`, color: ocText }}
                  />
                )}
              </div>
            </div>
          ))}
          {selfCount !== 1 && (
            <p className="text-xs font-heading flex items-center gap-1" style={{ color: ocMuted }}>
              <AlertCircle size={12} /> Exactly one slot must be &quot;You&quot;.
            </p>
          )}
          {hasInviteSlot() && (
            <div className="pt-1">
              <button
                type="button"
                onClick={sendInvitesOnly}
                disabled={sendInviteLoading || selfCount !== 1 || pctTotal !== 100}
                className="rounded px-3 py-1.5 text-xs font-heading font-bold uppercase tracking-wider border disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ backgroundColor: 'var(--gm-card)', borderColor: ocBorder, color: ocText }}
              >
                {sendInviteLoading ? 'Sending…' : 'Send invite'}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="rounded-md overflow-hidden max-w-2xl mx-auto border" style={{ backgroundColor: 'var(--gm-bg-top)', borderColor: ocBorder }}>
        <div className="px-4 py-2 border-b flex items-center justify-between" style={{ borderColor: ocBorder, color: ocMuted }}>
          <span className="text-xs font-heading font-bold uppercase tracking-widest">Cut per role (%) — creator decides</span>
          <span className="text-xs font-heading font-bold" style={{ color: pctTotal === 100 ? ocText : ocMuted }}>Total: {pctTotal}%</span>
        </div>
        <div className="p-4 flex flex-wrap items-center gap-4">
          {ROLE_IDS.map((roleId) => (
            <div key={roleId} className="flex items-center gap-2">
              <span className="text-xs font-heading capitalize w-20" style={{ color: ocMuted }}>{roleId}</span>
              <input
                type="number"
                min={0}
                max={100}
                value={pcts[roleId] ?? 25}
                onChange={(e) => setPct(roleId, e.target.value)}
                className="w-14 rounded px-2 py-1 text-xs font-heading text-right"
                style={{ backgroundColor: 'var(--gm-card)', border: `1px solid ${ocBorder}`, color: ocText }}
              />
              <span className="text-xs font-heading" style={{ color: ocMuted }}>%</span>
            </div>
          ))}
        </div>
        {pctTotal !== 100 && (
          <p className="px-4 pb-3 text-xs font-heading" style={{ color: ocMuted }}>Percentages must sum to 100.</p>
        )}
      </div>

      {!status?.pending_heist && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={execute}
            disabled={!canExecute || onCooldown || executing}
            className={`${styles.panel} px-6 py-3 font-heading font-bold uppercase tracking-wider border transition-smooth ${!canExecute || onCooldown || executing ? 'opacity-60 cursor-not-allowed' : ''}`}
            style={{ borderColor: ocBorder, backgroundColor: 'var(--gm-card)', color: ocText }}
          >
            {executing ? 'Running...' : onCooldown ? `Cooldown ${cooldownStr}` : hasInviteSlot() ? 'Send invites' : 'Run heist'}
          </button>
        </div>
      )}

      <div className={`${styles.panel} rounded-md p-4 max-w-2xl mx-auto border`} style={{ borderColor: ocBorder }}>
        <h3 className="text-sm font-heading font-bold uppercase tracking-widest mb-2" style={{ color: ocMuted }}>Rules</h3>
        <ul className="space-y-1 text-xs text-mutedForeground font-heading">
          <li>• Team of 4: Driver, Weapons, Explosives, Hacker. You must fill one slot (You).</li>
          <li>• The creator sets each role&apos;s cut (%). Must sum to 100. NPC slots get nothing.</li>
          <li>• Empty slots can be filled with NPCs for lower total pool (35% share per NPC).</li>
          <li>• Harder jobs = better cash &amp; RP but lower success chance.</li>
          <li>• Cooldown: {status?.cooldown_hours ?? 6} hours. Buy &quot;Reduce OC timer&quot; on the Points/Store page for 4h.</li>
        </ul>
      </div>
    </div>
  );
}
