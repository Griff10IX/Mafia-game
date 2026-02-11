import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Users, Building2, DollarSign, TrendingUp, LogOut, Swords, Trophy, Shield, Skull, X, Crosshair, RefreshCw } from 'lucide-react';
import api, { refreshUser } from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

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
    <div className={`${styles.surfaceMuted} border border-primary/20 rounded-sm p-3`}>
      <p className="font-heading font-medium text-foreground text-sm">
        {target.family_name} <span className="text-primary">[{target.family_tag}]</span> · Treasury {formatMoney(target.treasury)}
        {profileSlug && (
          <Link to={`/families/${encodeURIComponent(profileSlug)}`} className="ml-2 text-xs text-primary hover:underline">
            View crew
          </Link>
        )}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {rackets.map((r) => {
          const key = `${target.family_id}-${r.racket_id}`;
          const loading = attackLoading === key;
          return (
            <div key={r.racket_id} className={`inline-flex items-center gap-2 ${styles.surfaceMuted} border border-primary/10 rounded px-2 py-1.5`}>
              <span className="text-xs text-mutedForeground font-heading">{r.racket_name} Lv.{r.level}</span>
              <span className="text-xs font-heading text-primary">{formatMoney(r.potential_take)} · {r.success_chance_pct}%</span>
              <button
                type="button"
                onClick={() => onRaid(target.family_id, r.racket_id)}
                disabled={loading}
                className="bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground px-2 py-1 rounded text-xs font-heading font-bold uppercase tracking-wider hover:opacity-90 disabled:opacity-50 border border-yellow-600/50"
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
    <div className={`space-y-5 ${styles.pageContent}`} data-testid="families-page">
      {/* Art Deco Header */}
      <div>
        <div className="flex items-center gap-4 mb-3">
          <div className="h-px flex-1 bg-gradient-to-r from-transparent via-primary/40 to-primary/60" />
          <h1 className="text-3xl md:text-4xl font-heading font-bold text-primary tracking-wider uppercase flex items-center gap-3">
            <Building2 size={28} className="text-primary/80" />
            Mafia Families
          </h1>
          <div className="h-px flex-1 bg-gradient-to-l from-transparent via-primary/40 to-primary/60" />
        </div>
        <p className="text-center text-sm text-mutedForeground font-heading tracking-wide">
          Boss, Underboss, Consigliere, Capos, Soldiers, Associates — Run rackets and grow the treasury
        </p>
      </div>

      {family ? (
        <>
          {activeWars.length > 0 && activeWars.map((entry, i) => (
            <button
              key={entry.war?.id}
              type="button"
              onClick={() => { setSelectedWarIndex(i); setShowWarModal(true); }}
              className="w-full bg-gradient-to-r from-red-900/30 via-red-800/20 to-red-900/30 border-2 border-red-600/60 rounded-sm p-3 text-left hover:border-red-500 transition-colors flex items-center gap-3"
            >
              <Swords className="text-red-500 shrink-0" size={24} />
              <div>
                <p className="font-heading font-bold text-red-400 uppercase tracking-wider">Your Family Is At War</p>
                <p className="text-xs text-mutedForeground">
                  vs {entry.war?.other_family_name || 'Enemy'} [{entry.war?.other_family_tag || '?'}] — Click for details
                </p>
              </div>
            </button>
          ))}

          {/* Family Info Card */}
          <div className={`${styles.panel} border border-primary/40 rounded-sm overflow-hidden shadow-lg shadow-primary/5`}>
            <div className="px-4 py-3 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-heading font-bold text-primary tracking-wide">{family.name} <span className="text-primary/70">[{family.tag}]</span></h2>
                  <p className="text-xs text-mutedForeground font-heading">Your role: <span className="text-primary font-bold uppercase tracking-wider">{ROLE_LABELS[myRole] || myRole}</span></p>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="text-xs text-mutedForeground font-heading uppercase tracking-wider">Treasury</p>
                    <p className="text-lg font-heading font-bold text-primary">{formatMoney(family.treasury)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={handleLeave}
                    className={`flex items-center gap-2 px-3 py-2 rounded-sm border border-primary/30 ${styles.surface} text-mutedForeground hover:text-red-400 hover:border-red-500/50 transition-smooth text-xs font-heading uppercase tracking-wider`}
                  >
                    <LogOut size={14} /> Leave
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className={`${styles.panel} rounded-sm overflow-hidden`}>
              <div className="px-3 py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30">
                <h3 className="text-xs font-heading font-bold text-primary uppercase tracking-widest flex items-center gap-2">
                  <DollarSign size={14} /> Treasury
                </h3>
              </div>
              <div className="p-3 space-y-2">
                <form onSubmit={handleDeposit} className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Amount"
                    value={depositAmount}
                    onChange={(e) => setDepositAmount(e.target.value)}
                    className="flex-1 ${styles.input} border border-primary/20 rounded-sm px-3 py-2 font-heading text-sm focus:border-primary/50 focus:outline-none`}
                  />
                  <button type="submit" className="bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground px-3 py-2 rounded-sm text-xs font-heading font-bold uppercase tracking-wider hover:opacity-90 border border-yellow-600/50">
                    Deposit
                  </button>
                </form>
                {canWithdraw && (
                  <form onSubmit={handleWithdraw} className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Withdraw"
                      value={withdrawAmount}
                      onChange={(e) => setWithdrawAmount(e.target.value)}
                      className="flex-1 ${styles.input} border border-primary/20 rounded-sm px-3 py-2 font-heading text-sm focus:border-primary/50 focus:outline-none`}
                    />
                    <button type="submit" className={`${styles.surface} ${styles.raisedHover} border border-primary/30 text-foreground px-3 py-2 rounded-sm text-xs font-heading font-bold uppercase tracking-wider`}>
                      Withdraw
                    </button>
                  </form>
                )}
              </div>
            </div>
          </div>

          <div className={`${styles.panel} rounded-sm overflow-hidden`}>
            <div className="px-4 py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30">
              <div className="flex items-center gap-2">
                <div className="w-6 h-px bg-primary/50" />
                <h3 className="text-sm font-heading font-bold text-primary uppercase tracking-widest flex items-center gap-2">
                  <TrendingUp size={16} /> Rackets
                </h3>
                <div className="flex-1 h-px bg-primary/50" />
              </div>
            </div>
            <div className="p-4">
              <p className="text-xs text-mutedForeground mb-3 font-heading">Collect income on cooldown. Upgrade with family treasury.</p>
              {eventsEnabled && event && (event.racket_payout !== 1 || event.racket_cooldown !== 1) && event.name && (
                <div className="mb-3 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border border-primary/40 rounded-sm p-2">
                  <p className="text-xs font-heading font-bold text-primary uppercase tracking-wider">Event: {event.name}</p>
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
                    <div key={r.id} className={`${styles.surfaceMuted} border border-primary/20 rounded-sm p-3`}>
                      <p className="font-heading font-bold text-foreground text-sm">{r.name}</p>
                      <p className="text-xs text-mutedForeground mb-1">{r.description}</p>
                      <p className="text-xs text-mutedForeground font-heading">
                        Lv.{r.level} · {formatMoney(incomeDisplay)} · {cooldownDisplay}h
                      </p>
                      {r.level > 0 && (
                        <p className="text-xs font-heading mt-1 text-primary">
                          {onCooldown ? `${timeLeft}` : 'Ready'}
                        </p>
                      )}
                      <div className="mt-2 flex gap-2">
                        {r.level > 0 && (
                          <button
                            type="button"
                            onClick={() => collectRacket(r.id)}
                            disabled={onCooldown}
                            className="bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground px-2 py-1 rounded text-xs font-heading font-bold uppercase tracking-wider hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed border border-yellow-600/50"
                          >
                            Collect
                          </button>
                        )}
                        {canUpgradeRacket && r.level < (config?.racket_max_level ?? 5) && (
                          <button
                            type="button"
                            onClick={() => upgradeRacket(r.id)}
                            className={`${styles.surface} ${styles.raisedHover} border border-primary/30 px-2 py-1 rounded text-xs font-heading font-bold uppercase tracking-wider text-foreground`}
                          >
                            Upgrade
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-mutedForeground mt-3 font-heading italic">Upgrades improve defense. Lose a war = lose your rackets.</p>
              <a href="#raid-enemy-rackets" className="inline-flex items-center gap-1.5 mt-3 text-xs font-heading font-bold text-primary hover:underline uppercase tracking-wider">
                <Crosshair size={14} /> Raid Enemy Rackets →
              </a>
            </div>
          </div>

          <div id="raid-enemy-rackets" className={`${styles.panel} rounded-sm overflow-hidden scroll-mt-4`}>
            <div className="px-4 py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-px bg-primary/50" />
                  <h3 className="text-sm font-heading font-bold text-primary uppercase tracking-widest flex items-center gap-2">
                    <Crosshair size={16} /> Raid Enemy Rackets
                  </h3>
                  <div className="w-6 h-px bg-primary/50" />
                </div>
                <button
                  type="button"
                  onClick={fetchRacketAttackTargets}
                  disabled={targetsRefreshing}
                  className="text-xs text-mutedForeground hover:text-primary flex items-center gap-1 disabled:opacity-50 font-heading"
                  title="Refresh list"
                >
                  <RefreshCw size={12} className={targetsRefreshing ? 'animate-spin' : ''} /> Refresh
                </button>
              </div>
            </div>
            <div className="p-4">
              <p className="text-xs text-mutedForeground mb-3 font-heading">
                Click <span className="text-primary font-bold">Raid</span> to take 25% of one collect from their treasury. Success drops as level goes up. 2h cooldown.
              </p>
              {racketAttackTargets.length > 0 ? (
                <div className="space-y-3">
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
                  <p className="text-xs text-mutedForeground italic font-heading">No enemy rackets to raid. Other families need Lv.1+ rackets.</p>
                  <button
                    type="button"
                    onClick={checkDatabase}
                    className="text-xs text-primary hover:underline font-heading"
                  >
                    Check database
                  </button>
                  {dbSnapshot && (
                    <div className={`mt-3 p-3 ${styles.surfaceMuted} rounded border border-primary/20 text-xs font-mono space-y-2`}>
                      <p className="text-foreground font-semibold">Why no targets? ({dbSnapshot.total_families} families)</p>
                      <p className="text-mutedForeground">Your family: {dbSnapshot.my_family_id || '—'}</p>
                      {(dbSnapshot.other_families || dbSnapshot.db_snapshot || []).map((f, i) => {
                        const hasRackets = f.levels ? Object.values(f.levels).some((l) => l >= 1) : (Object.values(f.racket_levels || {}).some((l) => l >= 1));
                        const levels = f.levels || f.racket_levels || {};
                        const skipped = f.skipped === true;
                        return (
                          <div key={f.id || i} className="text-foreground">
                            {f.name} [{f.tag || f.id}]
                            {skipped && <span className="text-amber-500"> (yours — skipped)</span>}
                            {!skipped && hasRackets && <span className="text-primary"> — target</span>}
                            {!skipped && !hasRackets && <span className="text-mutedForeground"> — no Lv.1+</span>}
                            {' '}{JSON.stringify(levels)}
                          </div>
                        );
                      })}
                      {dbSnapshot.reason && <p className="text-amber-500">{dbSnapshot.reason} {dbSnapshot.hint || ''}</p>}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className={`${styles.panel} rounded-sm overflow-hidden`}>
            <div className="px-4 py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30">
              <div className="flex items-center gap-2">
                <div className="w-6 h-px bg-primary/50" />
                <h3 className="text-sm font-heading font-bold text-primary uppercase tracking-widest flex items-center gap-2">
                  <Users size={16} /> Roster
                </h3>
                <div className="flex-1 h-px bg-primary/50" />
              </div>
            </div>
            <div className="p-4">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className={`border-b border-primary/20 ${styles.surfaceMuted}`}>
                      <th className="text-left py-2 px-2 font-heading font-bold text-primary uppercase tracking-wider">Member</th>
                      <th className="text-left py-2 px-2 font-heading font-bold text-primary uppercase tracking-wider">Role</th>
                      <th className="text-left py-2 px-2 font-heading font-bold text-primary uppercase tracking-wider">Rank</th>
                      {canManage && <th className="text-right py-2 px-2 font-heading font-bold text-primary uppercase tracking-wider">Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((m) => (
                      <tr key={m.user_id} className="border-b border-primary/10 last:border-0">
                        <td className="py-2 px-2 font-heading font-medium text-foreground">{m.username}</td>
                        <td className="py-2 px-2">
                          <span className={m.role === 'boss' ? 'text-primary font-heading font-bold' : 'text-mutedForeground font-heading'}>
                            {ROLE_LABELS[m.role] || m.role}
                          </span>
                        </td>
                        <td className="py-2 px-2 text-mutedForeground font-heading">{m.rank_name}</td>
                        {canManage && (
                          <td className="py-2 px-2 text-right">
                            {m.role !== 'boss' && (
                              <button
                                type="button"
                                onClick={() => handleKick(m.user_id)}
                                className="text-red-400 hover:underline text-xs font-heading uppercase tracking-wider"
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
                    className={`${styles.surface} border border-primary/20 rounded px-2 py-1 text-sm font-heading focus:border-primary/50 focus:outline-none`}
                  >
                    {(config?.roles || []).filter((r) => r !== 'boss').map((role) => (
                      <option key={role} value={role}>{ROLE_LABELS[role]}</option>
                    ))}
                  </select>
                  <select
                    value={assignUserId}
                    onChange={(e) => setAssignUserId(e.target.value)}
                    className={`${styles.surface} border border-primary/20 rounded px-2 py-1 text-sm font-heading focus:border-primary/50 focus:outline-none`}
                  >
                    <option value="">Select member</option>
                    {members.filter((m) => m.role !== 'boss').map((m) => (
                      <option key={m.user_id} value={m.user_id}>{m.username}</option>
                    ))}
                  </select>
                  <button type="submit" className="bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground px-3 py-1 rounded text-xs font-heading font-bold uppercase tracking-wider hover:opacity-90 border border-yellow-600/50">
                    Assign
                  </button>
                </form>
              )}
            </div>
          </div>
        </>
      ) : (
        <>
          {/* Create Family */}
          <div className={`${styles.panel} rounded-sm overflow-hidden`}>
            <div className="px-4 py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30">
              <div className="flex items-center gap-2">
                <div className="w-6 h-px bg-primary/50" />
                <h3 className="text-sm font-heading font-bold text-primary uppercase tracking-widest">Create A Family</h3>
                <div className="flex-1 h-px bg-primary/50" />
              </div>
            </div>
            <div className="p-4">
              <form onSubmit={handleCreate} className="flex flex-wrap gap-3 items-end">
                <div>
                  <label className="block text-xs text-mutedForeground mb-1 font-heading uppercase tracking-wider">Name (2–30)</label>
                  <input
                    type="text"
                    value={createName}
                    onChange={(e) => setCreateName(e.target.value)}
                    placeholder="Five Families"
                    maxLength={30}
                    className={`${styles.input} border border-primary/20 rounded-sm px-3 py-2 w-48 font-heading focus:border-primary/50 focus:outline-none`}
                  />
                </div>
                <div>
                  <label className="block text-xs text-mutedForeground mb-1 font-heading uppercase tracking-wider">Tag (2–4)</label>
                  <input
                    type="text"
                    value={createTag}
                    onChange={(e) => setCreateTag(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                    placeholder="FF"
                    maxLength={4}
                    className={`${styles.input} border border-primary/20 rounded-sm px-3 py-2 w-20 font-heading uppercase focus:border-primary/50 focus:outline-none`}
                  />
                </div>
                <button type="submit" className="bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground px-4 py-2 rounded-sm font-heading font-bold uppercase tracking-wider hover:opacity-90 border border-yellow-600/50">
                  Create
                </button>
              </form>
              <p className="text-xs text-mutedForeground mt-2 font-heading">Max {config?.max_families ?? 10} families. You become Boss.</p>
            </div>
          </div>

          {/* Join Family */}
          <div className={`${styles.panel} rounded-sm overflow-hidden`}>
            <div className="px-4 py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30">
              <div className="flex items-center gap-2">
                <div className="w-6 h-px bg-primary/50" />
                <h3 className="text-sm font-heading font-bold text-primary uppercase tracking-widest">Join A Family</h3>
                <div className="flex-1 h-px bg-primary/50" />
              </div>
            </div>
            <div className="p-4">
              <form onSubmit={handleJoin} className="flex flex-wrap gap-3 items-end">
                <div className="flex-1 min-w-[200px]">
                  <label className="block text-xs text-mutedForeground mb-1 font-heading uppercase tracking-wider">Family</label>
                  <select
                    value={joinId}
                    onChange={(e) => setJoinId(e.target.value)}
                    className="w-full ${styles.input} border border-primary/20 rounded-sm px-3 py-2 font-heading focus:border-primary/50 focus:outline-none`}
                  >
                    <option value="">Select family</option>
                    {families.map((f) => (
                      <option key={f.id} value={f.id}>{f.name} [{f.tag}] — {f.member_count} members</option>
                    ))}
                  </select>
                </div>
                <button type="submit" className={`${styles.surface} ${styles.raisedHover} border border-primary/30 text-primary px-4 py-2 rounded-sm font-heading font-bold uppercase tracking-wider transition-smooth`}>
                  Join as Associate
                </button>
              </form>
            </div>
          </div>
        </>
      )}

      <div className={`${styles.panel} rounded-sm overflow-hidden`}>
        <div className="px-4 py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30">
          <div className="flex items-center gap-2">
            <div className="w-6 h-px bg-primary/50" />
            <h3 className="text-sm font-heading font-bold text-primary uppercase tracking-widest">All Families</h3>
            <div className="flex-1 h-px bg-primary/50" />
          </div>
        </div>
        <div className="p-4">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className={`border-b border-primary/20 ${styles.surfaceMuted}`}>
                  <th className="text-left py-2 px-2 font-heading font-bold text-primary uppercase tracking-wider">Name</th>
                  <th className="text-left py-2 px-2 font-heading font-bold text-primary uppercase tracking-wider">Tag</th>
                  <th className="text-right py-2 px-2 font-heading font-bold text-primary uppercase tracking-wider">Members</th>
                  <th className="text-right py-2 px-2 font-heading font-bold text-primary uppercase tracking-wider">Treasury</th>
                </tr>
              </thead>
              <tbody>
                {families.length === 0 ? (
                  <tr><td colSpan={4} className="py-4 text-center text-mutedForeground font-heading">No families yet.</td></tr>
                ) : (
                  families.map((f) => (
                    <tr key={f.id} className="border-b border-primary/10 last:border-0">
                      <td className="py-2 px-2">
                        <Link to={`/families/${encodeURIComponent(f.tag || f.id)}`} className="font-heading font-medium text-foreground hover:text-primary">
                          {f.name}
                        </Link>
                      </td>
                      <td className="py-2 px-2 font-heading text-primary">[{f.tag}]</td>
                      <td className="py-2 px-2 text-right text-mutedForeground font-heading">{f.member_count}</td>
                      <td className="py-2 px-2 text-right font-heading text-primary font-bold">{formatMoney(f.treasury)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className={`${styles.panel} rounded-sm overflow-hidden`}>
        <div className="px-4 py-2 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 border-b border-primary/30">
          <div className="flex items-center gap-2">
            <div className="w-6 h-px bg-primary/50" />
            <h3 className="text-sm font-heading font-bold text-primary uppercase tracking-widest flex items-center gap-2">
              <Trophy size={16} /> War History
            </h3>
            <div className="flex-1 h-px bg-primary/50" />
          </div>
        </div>
        <div className="p-4">
          {warHistory.length === 0 ? (
            <p className="text-xs text-mutedForeground font-heading italic">No war history yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className={`border-b border-primary/20 ${styles.surfaceMuted}`}>
                    <th className="text-left py-2 px-2 font-heading font-bold text-primary uppercase tracking-wider">Sides</th>
                    <th className="text-left py-2 px-2 font-heading font-bold text-primary uppercase tracking-wider">Result</th>
                    <th className="text-left py-2 px-2 font-heading font-bold text-primary uppercase tracking-wider">Prize</th>
                    <th className="text-right py-2 px-2 font-heading font-bold text-primary uppercase tracking-wider">Ended</th>
                  </tr>
                </thead>
                <tbody>
                  {warHistory.map((w) => (
                    <tr key={w.id} className="border-b border-primary/10 last:border-0">
                      <td className="py-2 px-2 text-foreground font-heading text-xs">
                        {w.family_a_name} <span className="text-primary">[{w.family_a_tag}]</span> vs {w.family_b_name} <span className="text-primary">[{w.family_b_tag}]</span>
                      </td>
                      <td className="py-2 px-2 font-heading">
                        {w.status === 'truce' && <span className="text-mutedForeground">Truce</span>}
                        {w.status === 'family_a_wins' && (
                          <span><span className="text-primary font-bold">{w.winner_family_name}</span> won</span>
                        )}
                        {w.status === 'family_b_wins' && (
                          <span><span className="text-primary font-bold">{w.winner_family_name}</span> won</span>
                        )}
                        {(w.status === 'active' || w.status === 'truce_offered') && (
                          <span className="text-red-400 font-bold uppercase">Active</span>
                        )}
                      </td>
                      <td className="py-2 px-2 text-mutedForeground font-heading">
                        {w.prize_exclusive_cars != null && (
                          <span>{w.prize_exclusive_cars} car(s)</span>
                        )}
                        {w.prize_rackets?.length > 0 && (
                          <span className="ml-1">
                            {w.prize_rackets.map((r) => `${r.name} Lv.${r.level}`).join(', ')}
                          </span>
                        )}
                        {(!w.prize_exclusive_cars && (!w.prize_rackets || !w.prize_rackets.length)) && '—'}
                      </td>
                      <td className="py-2 px-2 text-right text-mutedForeground font-heading">
                        {w.ended_at ? new Date(w.ended_at).toLocaleDateString() : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {showWarModal && activeWars[selectedWarIndex] && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80" onClick={() => setShowWarModal(false)}>
          <div className="bg-gradient-to-b from-zinc-900 to-black border border-red-600/50 rounded-sm max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl shadow-red-900/20" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-red-600/30 bg-gradient-to-r from-red-900/30 via-red-800/20 to-red-900/30 flex items-center justify-between">
              <h2 className="text-lg font-heading font-bold text-red-400 uppercase tracking-wider flex items-center gap-2">
                <Swords size={20} /> War: vs {activeWars[selectedWarIndex].war.other_family_name} [{activeWars[selectedWarIndex].war.other_family_tag}]
              </h2>
              <button type="button" onClick={() => setShowWarModal(false)} className="p-1 rounded hover:bg-zinc-800 text-mutedForeground hover:text-foreground">
                <X size={18} />
              </button>
            </div>
            <div className="p-4 space-y-4">
              {activeWars[selectedWarIndex].war.status === 'truce_offered' && (
                <p className="text-xs text-primary bg-primary/10 border border-primary/30 rounded-sm p-2 font-heading">
                  A truce has been offered. Boss or Underboss can accept.
                </p>
              )}

              {activeWars[selectedWarIndex].stats && (
                <>
                  <div className={`${styles.surfaceMuted} border border-primary/20 rounded-sm p-3`}>
                    <h3 className="text-xs font-heading font-bold text-primary uppercase tracking-widest mb-2 flex items-center gap-2">
                      <Shield size={14} /> Most Bodyguard Kills
                    </h3>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-primary/20">
                            <th className="text-left py-1 px-2 font-heading text-primary">#</th>
                            <th className="text-left py-1 px-2 font-heading text-primary">Player</th>
                            <th className="text-left py-1 px-2 font-heading text-primary">Family</th>
                            <th className="text-right py-1 px-2 font-heading text-primary">Kills</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(activeWars[selectedWarIndex].stats.top_bodyguard_killers || []).map((e, i) => (
                            <tr key={e.user_id} className="border-b border-primary/10">
                              <td className="py-1 px-2 text-mutedForeground font-heading">{i + 1}</td>
                              <td className="py-1 px-2 font-heading font-medium text-foreground">{e.username}</td>
                              <td className="py-1 px-2 text-mutedForeground font-heading">{e.family_name} <span className="text-primary">[{e.family_tag}]</span></td>
                              <td className="py-1 px-2 text-right font-heading font-bold text-primary">{e.bodyguard_kills}</td>
                            </tr>
                          ))}
                          {(!activeWars[selectedWarIndex].stats.top_bodyguard_killers || !activeWars[selectedWarIndex].stats.top_bodyguard_killers.length) && (
                            <tr><td colSpan={4} className="py-2 text-center text-mutedForeground font-heading italic">No data yet.</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className={`${styles.surfaceMuted} border border-primary/20 rounded-sm p-3`}>
                    <h3 className="text-xs font-heading font-bold text-primary uppercase tracking-widest mb-2 flex items-center gap-2">
                      <Skull size={14} /> Most Bodyguards Lost
                    </h3>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-primary/20">
                            <th className="text-left py-1 px-2 font-heading text-primary">#</th>
                            <th className="text-left py-1 px-2 font-heading text-primary">Player</th>
                            <th className="text-left py-1 px-2 font-heading text-primary">Family</th>
                            <th className="text-right py-1 px-2 font-heading text-primary">Lost</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(activeWars[selectedWarIndex].stats.top_bodyguards_lost || []).map((e, i) => (
                            <tr key={e.user_id} className="border-b border-primary/10">
                              <td className="py-1 px-2 text-mutedForeground font-heading">{i + 1}</td>
                              <td className="py-1 px-2 font-heading font-medium text-foreground">{e.username}</td>
                              <td className="py-1 px-2 text-mutedForeground font-heading">{e.family_name} <span className="text-primary">[{e.family_tag}]</span></td>
                              <td className="py-1 px-2 text-right font-heading font-bold text-red-400">{e.bodyguards_lost}</td>
                            </tr>
                          ))}
                          {(!activeWars[selectedWarIndex].stats.top_bodyguards_lost || !activeWars[selectedWarIndex].stats.top_bodyguards_lost.length) && (
                            <tr><td colSpan={4} className="py-2 text-center text-mutedForeground font-heading italic">No data yet.</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className={`${styles.surfaceMuted} border border-primary/20 rounded-sm p-3`}>
                    <h3 className="text-xs font-heading font-bold text-primary uppercase tracking-widest mb-2 flex items-center gap-2">
                      <Trophy size={14} /> MVP (Impact Score)
                    </h3>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-primary/20">
                            <th className="text-left py-1 px-2 font-heading text-primary">#</th>
                            <th className="text-left py-1 px-2 font-heading text-primary">Player</th>
                            <th className="text-left py-1 px-2 font-heading text-primary">Family</th>
                            <th className="text-right py-1 px-2 font-heading text-primary">Kills</th>
                            <th className="text-right py-1 px-2 font-heading text-primary">BG</th>
                            <th className="text-right py-1 px-2 font-heading text-primary">Impact</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(activeWars[selectedWarIndex].stats.mvp || []).map((e, i) => (
                            <tr key={e.user_id} className="border-b border-primary/10">
                              <td className="py-1 px-2 text-mutedForeground font-heading">{i + 1}</td>
                              <td className="py-1 px-2 font-heading font-medium text-foreground">{e.username}</td>
                              <td className="py-1 px-2 text-mutedForeground font-heading">{e.family_name} <span className="text-primary">[{e.family_tag}]</span></td>
                              <td className="py-1 px-2 text-right font-heading">{e.kills}</td>
                              <td className="py-1 px-2 text-right font-heading">{e.bodyguard_kills}</td>
                              <td className="py-1 px-2 text-right font-heading font-bold text-primary">{e.impact}</td>
                            </tr>
                          ))}
                          {(!activeWars[selectedWarIndex].stats.mvp || !activeWars[selectedWarIndex].stats.mvp.length) && (
                            <tr><td colSpan={6} className="py-2 text-center text-mutedForeground font-heading italic">No data yet.</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}

              {canManage && (
                <div className="flex gap-2 pt-3 border-t border-primary/20">
                  {activeWars[selectedWarIndex].war.status === 'active' && (
                    <button type="button" onClick={handleOfferTruce} className="bg-zinc-800 border border-primary/30 px-4 py-2 rounded-sm text-xs font-heading font-bold uppercase tracking-wider hover:bg-zinc-700">
                      Offer Truce
                    </button>
                  )}
                  {activeWars[selectedWarIndex].war.status === 'truce_offered' && activeWars[selectedWarIndex].war.truce_offered_by_family_id !== family?.id && (
                    <button type="button" onClick={handleAcceptTruce} className="bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground px-4 py-2 rounded-sm text-xs font-heading font-bold uppercase tracking-wider hover:opacity-90 border border-yellow-600/50">
                      Accept Truce
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
