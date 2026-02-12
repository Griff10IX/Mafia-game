import { useState, useEffect } from 'react';
import { Users, Banknote, Star, Clock, AlertCircle } from 'lucide-react';
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
  const [, setTick] = useState(0);

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

  const onCooldown = status?.cooldown_until && new Date(status.cooldown_until) > new Date();
  const cooldownStr = formatCooldown(status?.cooldown_until);

  return (
    <div className={`space-y-6 ${styles.pageContent}`} data-testid="organised-crime-page">
      <div>
        <div className="flex items-center gap-4 mb-3">
          <div className="h-px flex-1 bg-gradient-to-r from-transparent via-primary/40 to-primary/60" />
          <h1 className="text-2xl md:text-3xl font-heading font-bold text-primary tracking-wider uppercase flex items-center gap-3">
            <Users size={24} className="text-primary/80" />
            Organised Crime
          </h1>
          <div className="h-px flex-1 bg-gradient-to-l from-transparent via-primary/40 to-primary/60" />
        </div>
        <p className="text-center text-sm text-mutedForeground font-heading tracking-wide">
          Team of 4: Driver, Weapons, Explosives, Hacker. Fill empty slots with NPCs for lower payouts. Once every {status?.cooldown_hours ?? 6}h.
        </p>
      </div>

      {status?.cooldown_until && (
        <div className={`${styles.panel} rounded-md overflow-hidden max-w-2xl mx-auto`}>
          <div className="px-4 py-2 bg-gradient-to-r from-primary/20 to-primary/10 border-b border-primary/30 flex items-center justify-between">
            <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">Cooldown</span>
            <Clock className="text-primary" size={18} />
          </div>
          <div className="p-4 flex items-center justify-between">
            <span className="text-sm text-mutedForeground font-heading">
              {onCooldown ? `Next heist in ${cooldownStr}` : 'Ready for a heist'}
            </span>
            {status.has_timer_upgrade && (
              <span className="text-xs text-primary font-heading">4h timer (upgrade active)</span>
            )}
          </div>
        </div>
      )}

      <div className="max-w-4xl mx-auto space-y-4">
        <h3 className="text-sm font-heading font-bold text-primary uppercase tracking-widest">Choose job</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {(config.jobs || []).map((job) => (
            <button
              key={job.id}
              type="button"
              onClick={() => setSelectedJobId(job.id)}
              className={`${styles.panel} rounded-md p-4 text-left border transition-smooth ${
                selectedJobId === job.id ? 'border-primary/60 bg-primary/10' : 'border-transparent hover:border-primary/30'
              }`}
            >
              <div className="font-heading font-bold text-foreground">{job.name}</div>
              <div className="mt-1 flex items-center gap-2 text-xs text-mutedForeground">
                <span>{(job.success_rate * 100).toFixed(0)}% success</span>
              </div>
              <div className="mt-2 flex items-center gap-3 text-xs">
                <span className="flex items-center gap-1 text-primary">
                  <Banknote size={12} /> ${(job.cash || 0).toLocaleString()}
                </span>
                <span className="flex items-center gap-1 text-primary">
                  <Star size={12} /> {job.rp || 0} RP
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className={`${styles.panel} rounded-md overflow-hidden max-w-2xl mx-auto`}>
        <div className="px-4 py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30 flex items-center justify-between">
          <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">Team (4 slots)</span>
          <Users className="text-primary" size={18} />
        </div>
        <div className="p-4 space-y-3">
          {ROLE_IDS.map((roleId) => (
            <div key={roleId} className="flex flex-wrap items-center gap-2">
              <span className="w-24 text-xs font-heading font-bold text-foreground capitalize shrink-0">{roleId}</span>
              <div className="flex flex-wrap items-center gap-2">
                {['self', 'npc', 'invite'].map((opt) => (
                  <label key={opt} className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name={`slot-${roleId}`}
                      checked={slots[roleId] === opt}
                      onChange={() => setSlot(roleId, opt)}
                      className="text-primary"
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
                    className="bg-background border border-primary/30 rounded px-2 py-1 text-xs font-heading w-32"
                  />
                )}
              </div>
            </div>
          ))}
          {selfCount !== 1 && (
            <p className="text-xs text-amber-600 dark:text-amber-400 font-heading flex items-center gap-1">
              <AlertCircle size={12} /> Exactly one slot must be &quot;You&quot;.
            </p>
          )}
        </div>
      </div>

      <div className={`${styles.panel} rounded-md overflow-hidden max-w-2xl mx-auto`}>
        <div className="px-4 py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30 flex items-center justify-between">
          <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">Cut per role (%) — creator decides</span>
          <span className={`text-xs font-heading font-bold ${pctTotal === 100 ? 'text-primary' : 'text-amber-600'}`}>Total: {pctTotal}%</span>
        </div>
        <div className="p-4 flex flex-wrap items-center gap-4">
          {ROLE_IDS.map((roleId) => (
            <div key={roleId} className="flex items-center gap-2">
              <span className="text-xs font-heading text-foreground capitalize w-20">{roleId}</span>
              <input
                type="number"
                min={0}
                max={100}
                value={pcts[roleId] ?? 25}
                onChange={(e) => setPct(roleId, e.target.value)}
                className="w-14 bg-background border border-primary/30 rounded px-2 py-1 text-xs font-heading text-right"
              />
              <span className="text-xs text-mutedForeground">%</span>
            </div>
          ))}
        </div>
        {pctTotal !== 100 && (
          <p className="px-4 pb-3 text-xs text-amber-600 dark:text-amber-400 font-heading">Percentages must sum to 100.</p>
        )}
      </div>

      <div className="flex justify-center">
        <button
          type="button"
          onClick={execute}
          disabled={!canExecute || onCooldown || executing}
          className={`${styles.panel} px-6 py-3 font-heading font-bold uppercase tracking-wider border transition-smooth ${
            canExecute && !onCooldown && !executing
              ? 'bg-primary/20 text-primary border-primary/50 hover:bg-primary/30'
              : 'opacity-60 cursor-not-allowed border-primary/20'
          }`}
        >
          {executing ? 'Running...' : onCooldown ? `Cooldown ${cooldownStr}` : 'Run heist'}
        </button>
      </div>

      <div className={`${styles.panel} rounded-md p-4 max-w-2xl mx-auto`}>
        <h3 className="text-sm font-heading font-bold text-primary uppercase tracking-widest mb-2">Rules</h3>
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
