import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Users, Building2, DollarSign, TrendingUp, LogOut, Swords, Trophy, Shield, Skull, X, Crosshair, RefreshCw } from 'lucide-react';
import api, { refreshUser } from '../utils/api';
import { toast } from 'sonner';

function formatMoney(n) {
  const num = Number(n ?? 0);
  if (Number.isNaN(num)) return '$0';
  return `$${Math.trunc(num).toLocaleString()}`;
}

function formatTimeLeft(isoUntil) {
  if (!isoUntil) return null;
  try {
    const until = new Date(isoUntil);
    const now = new Date();
    const sec = Math.max(0, Math.floor((until - now) / 1000));
    if (sec <= 0) return 'Ready';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  } catch {
    return null;
  }
}

function apiDetail(e) {
  const d = e.response?.data?.detail;
  return typeof d === 'string' ? d : Array.isArray(d) && d.length ? d.map((x) => x.msg || x.loc?.join('.')).join('; ') : 'Request failed';
}

const ROLE_LABELS = { boss: 'Boss', underboss: 'Underboss', consigliere: 'Consigliere', capo: 'Capo', soldier: 'Soldier', associate: 'Associate' };

function RaidTargetFamilyBlock({ target, attackLoading, onRaid }) {
  const rackets = target.rackets || [];
  const profileSlug = target.family_tag || target.family_id || '';
  return (
    <div className="bg-background/50 border border-border rounded-sm p-3">
      <p className="font-medium text-foreground text-sm">
        {target.family_name} [{target.family_tag}] · Treasury {formatMoney(target.treasury)}
        {profileSlug && (
          <Link to={`/families/${encodeURIComponent(profileSlug)}`} className="ml-2 text-xs text-primary hover:underline">
            View crew profile
          </Link>
        )}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {rackets.map((r) => {
          const key = `${target.family_id}-${r.racket_id}`;
          const loading = attackLoading === key;
          return (
            <div key={r.racket_id} className="inline-flex items-center gap-2 bg-secondary/50 rounded px-2 py-1.5">
              <span className="text-xs text-mutedForeground">{r.racket_name} Lv.{r.level}</span>
              <span className="text-xs font-mono text-primary">{formatMoney(r.potential_take)} · {r.success_chance_pct}%</span>
              <button
                type="button"
                onClick={() => onRaid(target.family_id, r.racket_id)}
                disabled={loading}
                className="bg-primary text-primaryForeground px-2 py-1 rounded text-xs font-semibold hover:opacity-90 disabled:opacity-50"
              >
                {loading ? '...' : 'Raid'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function FamilyPage() {
  const [families, setFamilies] = useState([]);
  const [myFamily, setMyFamily] = useState(null);
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [createName, setCreateName] = useState('');
  const [createTag, setCreateTag] = useState('');
  const [joinId, setJoinId] = useState('');
  const [depositAmount, setDepositAmount] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [assignUserId, setAssignUserId] = useState('');
  const [assignRole, setAssignRole] = useState('associate');
  const [warStats, setWarStats] = useState(null);
  const [warHistory, setWarHistory] = useState([]);
  const [showWarModal, setShowWarModal] = useState(false);
  const [selectedWarIndex, setSelectedWarIndex] = useState(0);
  const [event, setEvent] = useState(null);
  const [eventsEnabled, setEventsEnabled] = useState(false);
  const [tick, setTick] = useState(0);
  const [racketAttackTargets, setRacketAttackTargets] = useState([]);
  const [racketAttackLoading, setRacketAttackLoading] = useState(null); // 'familyId-racketId'
  const [targetsRefreshing, setTargetsRefreshing] = useState(false);
  const [dbSnapshot, setDbSnapshot] = useState(null);

  const fetchData = useCallback(async () => {
    try {
      const [listRes, myRes, configRes, historyRes, eventsRes] = await Promise.all([
        api.get('/families'),
        api.get('/families/my'),
        api.get('/families/config').catch(() => ({ data: {} })),
        api.get('/families/wars/history').catch(() => ({ data: { wars: [] } })),
        api.get('/events/active').catch(() => ({ data: { event: null, events_enabled: false } })),
      ]);
      setFamilies(listRes.data || []);
      setMyFamily(myRes.data);
      setConfig(configRes.data);
      setWarHistory(historyRes.data?.wars || []);
      setEvent(eventsRes.data?.event ?? null);
      setEventsEnabled(!!eventsRes.data?.events_enabled);
      if (myRes.data?.family) {
        const [statsRes, targetsRes] = await Promise.all([
          api.get('/families/war/stats').catch(() => ({ data: { wars: [] } })),
          api.get('/families/racket-attack-targets', { params: { _: Date.now() } }).catch((err) => {
            console.warn('Racket attack targets failed:', err?.response?.data || err.message);
            return { data: { targets: [] } };
          }),
        ]);
        setWarStats(statsRes.data);
        const targets = targetsRes.data?.targets ?? [];
        setRacketAttackTargets(targets);
        if (targets.length === 0 && targetsRes.data?._debug) {
          setDbSnapshot(targetsRes.data._debug);
        }
      } else {
        setWarStats(null);
        setRacketAttackTargets([]);
      }
    } catch (e) {
      toast.error(apiDetail(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const fetchRacketAttackTargets = useCallback(async () => {
    if (!myFamily?.family) return;
    setTargetsRefreshing(true);
    try {
      const res = await api.get('/families/racket-attack-targets', { params: { _: Date.now() } });
      const targets = res.data?.targets ?? [];
      setRacketAttackTargets(targets);
      if (targets.length === 0 && res.data?._debug) {
        setDbSnapshot(res.data._debug);
      } else if (targets.length > 0) {
        setDbSnapshot(null);
      }
    } catch (e) {
      console.warn('Racket attack targets:', e?.response?.data || e.message);
      setRacketAttackTargets([]);
    } finally {
      setTargetsRefreshing(false);
    }
  }, [myFamily?.family]);

  const checkDatabase = useCallback(async () => {
    try {
      const res = await api.get('/families/racket-attack-targets', { params: { debug: true } });
      setDbSnapshot(res.data?._debug ?? null);
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Could not load database snapshot');
    }
  }, []);

  const attackFamilyRacket = async (familyId, racketId) => {
    const key = `${familyId}-${racketId}`;
    setRacketAttackLoading(key);
    try {
      const res = await api.post('/families/attack-racket', { family_id: familyId, racket_id: racketId });
      const data = res.data || {};
      if (data.success) {
        toast.success(data.message || `Took ${formatMoney(data.amount)}!`);
      } else {
        toast.error(data.message || 'Raid failed.');
      }
      fetchRacketAttackTargets();
      fetchData();
    } catch (e) {
      toast.error(apiDetail(e));
    } finally {
      setRacketAttackLoading(null);
    }
  };

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Refetch war stats when opening the war modal so kills show up immediately
  useEffect(() => {
    if (!showWarModal || !myFamily?.family) return;
    api.get('/families/war/stats')
      .then((res) => setWarStats(res.data))
      .catch(() => {});
  }, [showWarModal, myFamily?.family]);

  const activeWars = warStats?.wars ?? [];

  const handleCreate = async (e) => {
    e.preventDefault();
    const name = createName.trim();
    const tag = createTag.trim().toUpperCase();
    if (!name || !tag) {
      toast.error('Name and tag required');
      return;
    }
    try {
      await api.post('/families', { name, tag });
      toast.success('Family created. You are the Boss.');
      setCreateName('');
      setCreateTag('');
      refreshUser();
      fetchData();
    } catch (e) {
      toast.error(apiDetail(e));
    }
  };

  const handleJoin = async (e) => {
    e.preventDefault();
    if (!joinId) {
      toast.error('Select a family');
      return;
    }
    try {
      await api.post('/families/join', { family_id: joinId });
      toast.success('Joined family.');
      setJoinId('');
      refreshUser();
      fetchData();
    } catch (e) {
      toast.error(apiDetail(e));
    }
  };

  const handleLeave = async () => {
    if (!window.confirm('Leave this family?')) return;
    try {
      await api.post('/families/leave');
      toast.success('Left family.');
      refreshUser();
      fetchData();
    } catch (e) {
      toast.error(apiDetail(e));
    }
  };

  const handleKick = async (userId) => {
    if (!window.confirm('Kick this member?')) return;
    try {
      await api.post('/families/kick', { user_id: userId });
      toast.success('Member kicked.');
      fetchData();
    } catch (e) {
      toast.error(apiDetail(e));
    }
  };

  const handleAssignRole = async (e) => {
    e.preventDefault();
    if (!assignUserId || !assignRole) return;
    try {
      await api.post('/families/assign-role', { user_id: assignUserId, role: assignRole });
      toast.success(`Role set to ${ROLE_LABELS[assignRole]}.`);
      setAssignUserId('');
      setAssignRole('associate');
      fetchData();
    } catch (e) {
      toast.error(apiDetail(e));
    }
  };

  const handleDeposit = async (e) => {
    e.preventDefault();
    const amount = parseInt(String(depositAmount).replace(/\D/g, ''), 10);
    if (!amount || amount <= 0) {
      toast.error('Enter a valid amount');
      return;
    }
    try {
      await api.post('/families/deposit', { amount });
      toast.success('Deposited to treasury.');
      setDepositAmount('');
      refreshUser();
      fetchData();
    } catch (e) {
      toast.error(apiDetail(e));
    }
  };

  const handleWithdraw = async (e) => {
    e.preventDefault();
    const amount = parseInt(String(withdrawAmount).replace(/\D/g, ''), 10);
    if (!amount || amount <= 0) {
      toast.error('Enter a valid amount');
      return;
    }
    try {
      await api.post('/families/withdraw', { amount });
      toast.success('Withdrew from treasury.');
      setWithdrawAmount('');
      refreshUser();
      fetchData();
    } catch (e) {
      toast.error(apiDetail(e));
    }
  };

  const collectRacket = async (racketId) => {
    try {
      const res = await api.post(`/families/rackets/${racketId}/collect`);
      toast.success(res.data?.message || 'Collected.');
      fetchData();
    } catch (e) {
      toast.error(apiDetail(e));
    }
  };

  const upgradeRacket = async (racketId) => {
    try {
      const res = await api.post(`/families/rackets/${racketId}/upgrade`);
      toast.success(res.data?.message || 'Upgraded.');
      fetchData();
    } catch (e) {
      toast.error(apiDetail(e));
    }
  };

  const handleOfferTruce = async () => {
    const entry = activeWars[selectedWarIndex];
    if (!entry?.war?.id) return;
    try {
      await api.post('/families/war/truce/offer', { war_id: entry.war.id });
      toast.success('Truce offered. The other family can accept.');
      fetchData();
      setShowWarModal(false);
    } catch (e) {
      toast.error(apiDetail(e));
    }
  };

  const handleAcceptTruce = async () => {
    const entry = activeWars[selectedWarIndex];
    if (!entry?.war?.id) return;
    try {
      await api.post('/families/war/truce/accept', { war_id: entry.war.id });
      toast.success('Truce accepted. War ended.');
      fetchData();
      setShowWarModal(false);
    } catch (e) {
      toast.error(apiDetail(e));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-primary text-xl font-heading">Loading...</div>
      </div>
    );
  }

  const family = myFamily?.family;
  const members = myFamily?.members || [];
  const rackets = myFamily?.rackets || [];
  const myRole = myFamily?.my_role;
  const canManage = myRole && ['boss', 'underboss'].includes(myRole);
  const canWithdraw = myRole && ['boss', 'underboss', 'consigliere'].includes(myRole);
  const canUpgradeRacket = myRole && ['boss', 'underboss', 'consigliere'].includes(myRole);

  return (
    <div className="space-y-6" data-testid="families-page">
      <div>
        <h1 className="text-3xl md:text-4xl font-heading font-bold text-primary mb-2 flex items-center gap-2">
          <Building2 size={32} />
          Mafia Families
        </h1>
        <p className="text-sm text-mutedForeground">
          1920s–30s structure: Boss, Underboss, Consigliere, Capos, Soldiers, Associates. Run rackets and grow the family treasury.
        </p>
      </div>

      {family ? (
        <>
          {activeWars.length > 0 && activeWars.map((entry, i) => (
            <button
              key={entry.war?.id}
              type="button"
              onClick={() => { setSelectedWarIndex(i); setShowWarModal(true); }}
              className="w-full bg-destructive/20 border-2 border-destructive rounded-sm p-4 text-left hover:bg-destructive/30 transition-colors flex items-center gap-3"
            >
              <Swords className="text-destructive shrink-0" size={28} />
              <div>
                <p className="font-heading font-bold text-destructive">Your family is at war</p>
                <p className="text-sm text-mutedForeground">
                  vs {entry.war?.other_family_name || 'Enemy'} [{entry.war?.other_family_tag || '?'}] — Click for details & stats
                </p>
              </div>
            </button>
          ))}

          <div className="bg-card border border-primary rounded-sm p-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-heading font-bold text-foreground">{family.name} [{family.tag}]</h2>
                <p className="text-sm text-mutedForeground">Your role: <span className="text-primary font-semibold">{ROLE_LABELS[myRole] || myRole}</span></p>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <p className="text-xs text-mutedForeground">Treasury</p>
                  <p className="text-lg font-mono font-bold text-primary">{formatMoney(family.treasury)}</p>
                </div>
                <button
                  type="button"
                  onClick={handleLeave}
                  className="flex items-center gap-2 px-3 py-2 rounded-sm border border-border bg-secondary text-mutedForeground hover:text-destructive transition-smooth text-sm"
                >
                  <LogOut size={16} /> Leave
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-card border border-border rounded-sm p-4">
              <h3 className="text-sm font-heading font-semibold text-foreground mb-3 flex items-center gap-2">
                <DollarSign size={18} /> Treasury
              </h3>
              <form onSubmit={handleDeposit} className="flex gap-2 mb-2">
                <input
                  type="text"
                  placeholder="Amount"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  className="flex-1 bg-background border border-border rounded-sm px-3 py-2 text-foreground font-mono text-sm"
                />
                <button type="submit" className="bg-primary text-primaryForeground px-4 py-2 rounded-sm text-sm font-semibold hover:opacity-90">
                  Deposit
                </button>
              </form>
              {canWithdraw && (
                <form onSubmit={handleWithdraw} className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Withdraw amount"
                    value={withdrawAmount}
                    onChange={(e) => setWithdrawAmount(e.target.value)}
                    className="flex-1 bg-background border border-border rounded-sm px-3 py-2 text-foreground font-mono text-sm"
                  />
                  <button type="submit" className="bg-secondary border border-border text-foreground px-4 py-2 rounded-sm text-sm font-semibold hover:bg-secondary/80">
                    Withdraw
                  </button>
                </form>
              )}
            </div>
          </div>

          <div className="bg-card border border-border rounded-sm p-4">
            <h3 className="text-sm font-heading font-semibold text-foreground mb-3 flex items-center gap-2">
              <TrendingUp size={18} /> Rackets
            </h3>
            <p className="text-xs text-mutedForeground mb-3">Collect income on cooldown. Upgrade with family treasury.</p>
            {eventsEnabled && event && (event.racket_payout !== 1 || event.racket_cooldown !== 1) && event.name && (
              <div className="mb-3 bg-primary/15 border border-primary rounded-sm p-3">
                <p className="text-sm font-semibold text-primary">Today&apos;s event: {event.name}</p>
                <p className="text-xs text-mutedForeground mt-1">{event.message}</p>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {rackets.map((r) => {
                const incomeDisplay = r.effective_income_per_collect != null ? r.effective_income_per_collect : r.income_per_collect;
                const cooldownDisplay = r.effective_cooldown_hours != null ? r.effective_cooldown_hours : r.cooldown_hours;
                const timeLeft = formatTimeLeft(r.next_collect_at);
                const onCooldown = timeLeft && timeLeft !== 'Ready';
                return (
                  <div key={r.id} className="bg-background/50 border border-border rounded-sm p-3">
                    <p className="font-medium text-foreground text-sm">{r.name}</p>
                    <p className="text-xs text-mutedForeground mb-1">{r.description}</p>
                    <p className="text-xs text-mutedForeground">
                      Level {r.level} · {formatMoney(incomeDisplay)} per collect · every {Number(cooldownDisplay) === cooldownDisplay ? cooldownDisplay : cooldownDisplay}h
                    </p>
                    {r.level > 0 && (
                      <p className="text-xs font-mono mt-1 text-primary">
                        {onCooldown ? `Collect in ${timeLeft}` : 'Ready to collect'}
                      </p>
                    )}
                    <div className="mt-2 flex gap-2">
                      {r.level > 0 && (
                        <button
                          type="button"
                          onClick={() => collectRacket(r.id)}
                          disabled={onCooldown}
                          className="bg-primary text-primaryForeground px-2 py-1 rounded text-xs font-semibold hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Collect
                        </button>
                      )}
                      {canUpgradeRacket && r.level < (config?.racket_max_level ?? 5) && (
                        <button
                          type="button"
                          onClick={() => upgradeRacket(r.id)}
                          className="bg-secondary border border-border px-2 py-1 rounded text-xs font-semibold text-foreground hover:bg-secondary/80"
                        >
                          Upgrade
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-mutedForeground mt-3">Upgrades improve defense when other families raid your rackets. If your family loses a war, you lose your rackets to the winner.</p>
            <a href="#raid-enemy-rackets" className="inline-flex items-center gap-1.5 mt-3 text-sm font-medium text-primary hover:underline">
              <Crosshair size={16} /> Raid enemy rackets →
            </a>
          </div>

          <div id="raid-enemy-rackets" className="bg-card border border-border rounded-sm p-4 scroll-mt-4">
            <div className="flex items-center justify-between gap-2 mb-3">
              <h3 className="text-sm font-heading font-semibold text-foreground flex items-center gap-2">
                <Crosshair size={18} /> Raid enemy rackets
              </h3>
              <button
                type="button"
                onClick={fetchRacketAttackTargets}
                disabled={targetsRefreshing}
                className="text-xs text-mutedForeground hover:text-foreground flex items-center gap-1 disabled:opacity-50"
                title="Refresh list"
              >
                <RefreshCw size={14} className={targetsRefreshing ? 'animate-spin' : ''} /> Refresh
              </button>
            </div>
            <p className="text-xs text-mutedForeground mb-3">
              Go to <strong className="text-foreground">Family</strong> (this page), scroll here. Click <strong className="text-foreground">Raid</strong> on an enemy family&apos;s racket to try to take 25% of one collect from their treasury. Success chance drops as their racket level goes up (70% at level 0 down to 10% min). 2h cooldown per racket.
            </p>
            {racketAttackTargets.length > 0 ? (
              <div className="space-y-4">
                {racketAttackTargets.map((t) => (
                  <RaidTargetFamilyBlock
                    key={t.family_id}
                    target={t}
                    attackLoading={racketAttackLoading}
                    onRaid={attackFamilyRacket}
                  />
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-mutedForeground italic">No enemy rackets to raid yet. Other families need at least one racket at level 1+ to appear here.</p>
                <button
                  type="button"
                  onClick={checkDatabase}
                  className="text-xs text-primary hover:underline"
                >
                  Check database — which families have rackets?
                </button>
                {dbSnapshot && (
                  <div className="mt-3 p-3 bg-muted/50 rounded border border-border text-xs font-mono space-y-2">
                    <p className="text-foreground font-semibold">Why no targets? ({dbSnapshot.total_families} families in DB)</p>
                    <p className="text-mutedForeground">Your family id/tag: {dbSnapshot.my_family_id || '—'}</p>
                    {(dbSnapshot.other_families || dbSnapshot.db_snapshot || []).map((f, i) => {
                      const hasRackets = f.levels ? Object.values(f.levels).some((l) => l >= 1) : (Object.values(f.racket_levels || {}).some((l) => l >= 1));
                      const levels = f.levels || f.racket_levels || {};
                      const skipped = f.skipped === true;
                      return (
                        <div key={f.id || i} className="text-foreground">
                          {f.name} [{f.tag || f.id}]
                          {skipped && <span className="text-amber-600"> (your family — skipped)</span>}
                          {!skipped && hasRackets && <span className="text-primary"> — included as target</span>}
                          {!skipped && !hasRackets && <span className="text-mutedForeground"> — no rackets L1+</span>}
                          {' '}levels: {JSON.stringify(levels)}
                        </div>
                      );
                    })}
                    {dbSnapshot.reason && <p className="text-amber-600">{dbSnapshot.reason} {dbSnapshot.hint || ''}</p>}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="bg-card border border-border rounded-sm p-4">
            <h3 className="text-sm font-heading font-semibold text-foreground mb-3 flex items-center gap-2">
              <Users size={18} /> Roster
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-secondary/30">
                    <th className="text-left py-2 px-2 font-semibold text-foreground">Member</th>
                    <th className="text-left py-2 px-2 font-semibold text-foreground">Role</th>
                    <th className="text-left py-2 px-2 font-semibold text-foreground">Rank</th>
                    {canManage && <th className="text-right py-2 px-2 font-semibold text-foreground">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => (
                    <tr key={m.user_id} className="border-b border-border last:border-0">
                      <td className="py-2 px-2 font-medium text-foreground">{m.username}</td>
                      <td className="py-2 px-2">
                        <span className={m.role === 'boss' ? 'text-primary font-semibold' : 'text-mutedForeground'}>
                          {ROLE_LABELS[m.role] || m.role}
                        </span>
                      </td>
                      <td className="py-2 px-2 text-mutedForeground">{m.rank_name}</td>
                      {canManage && (
                        <td className="py-2 px-2 text-right">
                          {m.role !== 'boss' && (
                            <button
                              type="button"
                              onClick={() => handleKick(m.user_id)}
                              className="text-destructive hover:underline text-xs"
                            >
                              Kick
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {myRole === 'boss' && (
              <form onSubmit={handleAssignRole} className="mt-3 flex flex-wrap items-center gap-2">
                <select
                  value={assignRole}
                  onChange={(e) => setAssignRole(e.target.value)}
                  className="bg-background border border-border rounded px-2 py-1 text-sm"
                >
                  {(config?.roles || []).filter((r) => r !== 'boss').map((role) => (
                    <option key={role} value={role}>{ROLE_LABELS[role]}</option>
                  ))}
                </select>
                <select
                  value={assignUserId}
                  onChange={(e) => setAssignUserId(e.target.value)}
                  className="bg-background border border-border rounded px-2 py-1 text-sm"
                >
                  <option value="">Select member</option>
                  {members.filter((m) => m.role !== 'boss').map((m) => (
                    <option key={m.user_id} value={m.user_id}>{m.username}</option>
                  ))}
                </select>
                <button type="submit" className="bg-primary text-primaryForeground px-3 py-1 rounded text-sm font-semibold hover:opacity-90">
                  Assign role
                </button>
              </form>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="bg-card border border-border rounded-sm p-4">
            <h3 className="text-sm font-heading font-semibold text-foreground mb-3">Create a family</h3>
            <form onSubmit={handleCreate} className="flex flex-wrap gap-3 items-end">
              <div>
                <label className="block text-xs text-mutedForeground mb-1">Family name (2–30 chars)</label>
                <input
                  type="text"
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  placeholder="e.g. Five Families"
                  maxLength={30}
                  className="bg-background border border-border rounded-sm px-3 py-2 text-foreground w-48"
                />
              </div>
              <div>
                <label className="block text-xs text-mutedForeground mb-1">Tag (2–4 chars)</label>
                <input
                  type="text"
                  value={createTag}
                  onChange={(e) => setCreateTag(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                  placeholder="e.g. FF"
                  maxLength={4}
                  className="bg-background border border-border rounded-sm px-3 py-2 text-foreground w-20 font-mono uppercase"
                />
              </div>
              <button type="submit" className="bg-primary text-primaryForeground px-4 py-2 rounded-sm font-semibold hover:opacity-90">
                Create family
              </button>
            </form>
            <p className="text-xs text-mutedForeground mt-2">Max {config?.max_families ?? 10} families. You become Boss.</p>
          </div>

          <div className="bg-card border border-border rounded-sm p-4">
            <h3 className="text-sm font-heading font-semibold text-foreground mb-3">Join a family</h3>
            <form onSubmit={handleJoin} className="flex flex-wrap gap-3 items-end">
              <div className="flex-1 min-w-[200px]">
                <label className="block text-xs text-mutedForeground mb-1">Family</label>
                <select
                  value={joinId}
                  onChange={(e) => setJoinId(e.target.value)}
                  className="w-full bg-background border border-border rounded-sm px-3 py-2 text-foreground"
                >
                  <option value="">Select family</option>
                  {families.map((f) => (
                    <option key={f.id} value={f.id}>{f.name} [{f.tag}] — {f.member_count} members</option>
                  ))}
                </select>
              </div>
              <button type="submit" className="bg-secondary border border-primary text-primary px-4 py-2 rounded-sm font-semibold hover:bg-primary hover:text-primaryForeground transition-smooth">
                Join as Associate
              </button>
            </form>
          </div>
        </>
      )}

      <div className="bg-card border border-border rounded-sm p-4">
        <h3 className="text-sm font-heading font-semibold text-foreground mb-3">All families</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/30">
                <th className="text-left py-2 px-2 font-semibold text-foreground">Name</th>
                <th className="text-left py-2 px-2 font-semibold text-foreground">Tag</th>
                <th className="text-right py-2 px-2 font-semibold text-foreground">Members</th>
                <th className="text-right py-2 px-2 font-semibold text-foreground">Treasury</th>
              </tr>
            </thead>
            <tbody>
              {families.length === 0 ? (
                <tr><td colSpan={4} className="py-4 text-center text-mutedForeground">No families yet.</td></tr>
              ) : (
                families.map((f) => (
                  <tr key={f.id} className="border-b border-border last:border-0">
                    <td className="py-2 px-2">
                      <Link to={`/families/${encodeURIComponent(f.tag || f.id)}`} className="font-medium text-foreground hover:text-primary hover:underline">
                        {f.name}
                      </Link>
                    </td>
                    <td className="py-2 px-2 font-mono text-primary">[{f.tag}]</td>
                    <td className="py-2 px-2 text-right text-mutedForeground">{f.member_count}</td>
                    <td className="py-2 px-2 text-right font-mono text-foreground">{formatMoney(f.treasury)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-card border border-border rounded-sm p-4">
        <h3 className="text-sm font-heading font-semibold text-foreground mb-3 flex items-center gap-2">
          <Trophy size={18} /> Last 10 family wars
        </h3>
        {warHistory.length === 0 ? (
          <p className="text-sm text-mutedForeground">No war history yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary/30">
                  <th className="text-left py-2 px-2 font-semibold text-foreground">Sides</th>
                  <th className="text-left py-2 px-2 font-semibold text-foreground">Result</th>
                  <th className="text-left py-2 px-2 font-semibold text-foreground">Winner gained</th>
                  <th className="text-right py-2 px-2 font-semibold text-foreground">Ended</th>
                </tr>
              </thead>
              <tbody>
                {warHistory.map((w) => (
                  <tr key={w.id} className="border-b border-border last:border-0">
                    <td className="py-2 px-2 text-foreground">
                      {w.family_a_name} [{w.family_a_tag}] vs {w.family_b_name} [{w.family_b_tag}]
                    </td>
                    <td className="py-2 px-2">
                      {w.status === 'truce' && <span className="text-mutedForeground">Truce</span>}
                      {w.status === 'family_a_wins' && (
                        <span><span className="text-primary font-semibold">{w.winner_family_name}</span> won</span>
                      )}
                      {w.status === 'family_b_wins' && (
                        <span><span className="text-primary font-semibold">{w.winner_family_name}</span> won</span>
                      )}
                      {(w.status === 'active' || w.status === 'truce_offered') && (
                        <span className="text-destructive">Active</span>
                      )}
                    </td>
                    <td className="py-2 px-2 text-mutedForeground">
                      {w.prize_exclusive_cars != null && (
                        <span>{w.prize_exclusive_cars} exclusive car(s)</span>
                      )}
                      {w.prize_rackets?.length > 0 && (
                        <span className="ml-1">
                          {w.prize_rackets.map((r) => `${r.name} (Lv.${r.level})`).join(', ')}
                        </span>
                      )}
                      {(!w.prize_exclusive_cars && (!w.prize_rackets || !w.prize_rackets.length)) && '—'}
                    </td>
                    <td className="py-2 px-2 text-right text-mutedForeground text-xs">
                      {w.ended_at ? new Date(w.ended_at).toLocaleDateString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showWarModal && activeWars[selectedWarIndex] && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={() => setShowWarModal(false)}>
          <div className="bg-card border border-border rounded-sm max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-border flex items-center justify-between">
              <h2 className="text-xl font-heading font-bold text-foreground flex items-center gap-2">
                <Swords size={24} className="text-destructive" /> War: vs {activeWars[selectedWarIndex].war.other_family_name} [{activeWars[selectedWarIndex].war.other_family_tag}]
              </h2>
              <button type="button" onClick={() => setShowWarModal(false)} className="p-1 rounded hover:bg-secondary">
                <X size={20} />
              </button>
            </div>
            <div className="p-4 space-y-4">
              {activeWars[selectedWarIndex].war.status === 'truce_offered' && (
                <p className="text-sm text-primary bg-primary/10 border border-primary rounded-sm p-2">
                  A truce has been offered. Boss or Underboss can accept to end the war.
                </p>
              )}

              {activeWars[selectedWarIndex].stats && (
                <>
                  <div>
                    <h3 className="text-sm font-heading font-semibold text-foreground mb-2 flex items-center gap-2">
                      <Shield size={16} /> Most bodyguard kills
                    </h3>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-border">
                            <th className="text-left py-1 px-2">#</th>
                            <th className="text-left py-1 px-2">Player</th>
                            <th className="text-left py-1 px-2">Family</th>
                            <th className="text-right py-1 px-2">Kills</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(activeWars[selectedWarIndex].stats.top_bodyguard_killers || []).map((e, i) => (
                            <tr key={e.user_id} className="border-b border-border/50">
                              <td className="py-1 px-2 text-mutedForeground">{i + 1}</td>
                              <td className="py-1 px-2 font-medium">{e.username}</td>
                              <td className="py-1 px-2 text-mutedForeground">{e.family_name} [{e.family_tag}]</td>
                              <td className="py-1 px-2 text-right font-mono">{e.bodyguard_kills}</td>
                            </tr>
                          ))}
                          {(!activeWars[selectedWarIndex].stats.top_bodyguard_killers || !activeWars[selectedWarIndex].stats.top_bodyguard_killers.length) && (
                            <tr><td colSpan={4} className="py-2 text-center text-mutedForeground">No data yet.</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div>
                    <h3 className="text-sm font-heading font-semibold text-foreground mb-2 flex items-center gap-2">
                      <Skull size={16} /> Most bodyguards lost
                    </h3>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-border">
                            <th className="text-left py-1 px-2">#</th>
                            <th className="text-left py-1 px-2">Player</th>
                            <th className="text-left py-1 px-2">Family</th>
                            <th className="text-right py-1 px-2">Lost</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(activeWars[selectedWarIndex].stats.top_bodyguards_lost || []).map((e, i) => (
                            <tr key={e.user_id} className="border-b border-border/50">
                              <td className="py-1 px-2 text-mutedForeground">{i + 1}</td>
                              <td className="py-1 px-2 font-medium">{e.username}</td>
                              <td className="py-1 px-2 text-mutedForeground">{e.family_name} [{e.family_tag}]</td>
                              <td className="py-1 px-2 text-right font-mono">{e.bodyguards_lost}</td>
                            </tr>
                          ))}
                          {(!activeWars[selectedWarIndex].stats.top_bodyguards_lost || !activeWars[selectedWarIndex].stats.top_bodyguards_lost.length) && (
                            <tr><td colSpan={4} className="py-2 text-center text-mutedForeground">No data yet.</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div>
                    <h3 className="text-sm font-heading font-semibold text-foreground mb-2 flex items-center gap-2">
                      <Trophy size={16} /> MVP (kills + bodyguard kills)
                    </h3>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-border">
                            <th className="text-left py-1 px-2">#</th>
                            <th className="text-left py-1 px-2">Player</th>
                            <th className="text-left py-1 px-2">Family</th>
                            <th className="text-right py-1 px-2">Kills</th>
                            <th className="text-right py-1 px-2">BG kills</th>
                            <th className="text-right py-1 px-2">Impact</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(activeWars[selectedWarIndex].stats.mvp || []).map((e, i) => (
                            <tr key={e.user_id} className="border-b border-border/50">
                              <td className="py-1 px-2 text-mutedForeground">{i + 1}</td>
                              <td className="py-1 px-2 font-medium">{e.username}</td>
                              <td className="py-1 px-2 text-mutedForeground">{e.family_name} [{e.family_tag}]</td>
                              <td className="py-1 px-2 text-right font-mono">{e.kills}</td>
                              <td className="py-1 px-2 text-right font-mono">{e.bodyguard_kills}</td>
                              <td className="py-1 px-2 text-right font-mono font-semibold">{e.impact}</td>
                            </tr>
                          ))}
                          {(!activeWars[selectedWarIndex].stats.mvp || !activeWars[selectedWarIndex].stats.mvp.length) && (
                            <tr><td colSpan={6} className="py-2 text-center text-mutedForeground">No data yet.</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}

              {canManage && (
                <div className="flex gap-2 pt-2 border-t border-border">
                  {activeWars[selectedWarIndex].war.status === 'active' && (
                    <button type="button" onClick={handleOfferTruce} className="bg-secondary border border-border px-4 py-2 rounded-sm text-sm font-semibold hover:bg-secondary/80">
                      Offer truce
                    </button>
                  )}
                  {activeWars[selectedWarIndex].war.status === 'truce_offered' && activeWars[selectedWarIndex].war.truce_offered_by_family_id !== family?.id && (
                    <button type="button" onClick={handleAcceptTruce} className="bg-primary text-primaryForeground px-4 py-2 rounded-sm text-sm font-semibold hover:opacity-90">
                      Accept truce
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
