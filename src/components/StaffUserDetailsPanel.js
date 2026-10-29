import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  Shield,
  Lock,
  Unlock,
  Skull,
  Zap,
  Coins,
  Car,
  Gift,
  Award,
  Mail,
  LogOut,
  Copy,
  Eraser,
  HeartPulse,
  KeyRound,
  Radio,
  MessageSquareOff,
  UserRound,
  ScrollText,
  Timer,
  Fingerprint,
} from 'lucide-react';
import api, { getApiErrorMessage } from '../utils/api';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from './ui/sheet';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';
import { formatGameDateTime as formatDateTime } from '../utils/gameDateTime';
import './staffUserDetails.css';

const TOKEN_OPTIONS = [
  { value: 'xp_crimes', label: 'Crime XP' },
  { value: 'xp_gta', label: 'GTA XP' },
  { value: 'melt', label: 'Melt' },
  { value: 'oc_reduced', label: 'OC Reduced' },
  { value: 'booze', label: 'Booze' },
  { value: 'racket', label: 'Racket' },
  { value: 'travel', label: 'Travel' },
  { value: 'properties', label: 'Properties' },
  { value: 'jailbust_bonus', label: 'Jailbust Bonus' },
];

const num = (v) => (v != null ? Number(v).toLocaleString() : null);

function compact(v) {
  if (v == null) return '—';
  const n = Number(v) || 0;
  const a = Math.abs(n);
  if (a >= 1e12) return `${+(n / 1e12).toFixed(1)}T`;
  if (a >= 1e9) return `${+(n / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${+(n / 1e6).toFixed(1)}M`;
  if (a >= 1e5) return `${Math.round(n / 1e3)}K`;
  return n.toLocaleString();
}

function copyText(text, label) {
  if (!text) return;
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(String(text)).then(() => toast.success(`${label} copied`)).catch(() => toast.error('Copy failed'));
  } else {
    toast.error('Copy not supported');
  }
}

function Card({ title, icon: Icon, hint, danger, children }) {
  return (
    <section className={`sd-card ${danger ? 'danger' : ''}`}>
      <h3>{Icon && <Icon size={14} />}{title}</h3>
      {hint && <p className="sd-hint">{hint}</p>}
      {children}
    </section>
  );
}

function Item({ label, value, mono, tone, copy }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={`${mono ? 'mono' : ''} ${tone || ''}`}>
        <span className="v" title={value != null ? String(value) : undefined}>{value ?? '—'}</span>
        {copy && value ? (
          <button type="button" className="sd-copy" onClick={() => copyText(value, label)} aria-label={`Copy ${label}`}><Copy size={13} /></button>
        ) : null}
      </dd>
    </div>
  );
}

function Tool({ label, children }) {
  return (
    <div className="sd-tool">
      <label>{label}</label>
      <div className="sd-tool-ctrl">{children}</div>
    </div>
  );
}

const TABS = [
  { id: 'overview', label: 'Overview', staff: false },
  { id: 'actions', label: 'Actions', staff: true },
  { id: 'give', label: 'Give & set', admin: true },
  { id: 'logs', label: 'Logs', staff: true },
];

export default function StaffUserDetailsPanel({
  username,
  open,
  onOpenChange,
  isAdmin = false,
  isModerator = false,
  onActionDone,
}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [actionLoading, setActionLoading] = useState({});
  const [ranks, setRanks] = useState([]);
  const [cars, setCars] = useState([]);
  const [registrationInfo, setRegistrationInfo] = useState(null);
  const [registrationLoading, setRegistrationLoading] = useState(false);
  const [sessions, setSessions] = useState(null);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [tab, setTab] = useState('overview');

  const [dossierMoneyAmount, setDossierMoneyAmount] = useState(0);
  const [dossierPoints, setDossierPoints] = useState(100);
  const [dossierBullets, setDossierBullets] = useState(5000);
  const [dossierLootPieces, setDossierLootPieces] = useState(100);
  const [dossierSearchMinutes, setDossierSearchMinutes] = useState(1);
  const [dossierNewRank, setDossierNewRank] = useState('');
  const [dossierPrestigeLevel, setDossierPrestigeLevel] = useState(0);
  const [dossierTokenType, setDossierTokenType] = useState('xp_crimes');
  const [dossierTokenAmount, setDossierTokenAmount] = useState(5);
  const [dossierCarId, setDossierCarId] = useState('car1');
  const [dossierNewEmail, setDossierNewEmail] = useState('');
  const [dossierNewUsername, setDossierNewUsername] = useState('');
  const [dossierNewPassword, setDossierNewPassword] = useState('');

  const refetch = useCallback(() => {
    if (!username) return Promise.resolve();
    return api
      .get(`/users/${encodeURIComponent(username)}/staff-stats`)
      .then((res) => {
        setData(res.data);
        setError(null);
      })
      .catch((e) => {
        setError(getApiErrorMessage(e) || 'Failed to load');
      });
  }, [username]);

  useEffect(() => {
    setTab('overview');
  }, [username]);

  useEffect(() => {
    if (!open || !username) {
      if (!open) {
        setData(null);
        setError(null);
        setRegistrationInfo(null);
        setSessions(null);
      }
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .get(`/users/${encodeURIComponent(username)}/staff-stats`)
      .then((res) => {
        if (!cancelled) {
          setData(res.data);
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setData(null);
          setError(getApiErrorMessage(e) || 'Failed to load user details');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, username]);

  useEffect(() => {
    if (!open || !isAdmin) return;
    let cancelled = false;
    Promise.all([api.get('/meta/ranks'), api.get('/meta/cars')])
      .then(([ranksRes, carsRes]) => {
        if (!cancelled) {
          setRanks(Array.isArray(ranksRes.data?.ranks) ? ranksRes.data.ranks : []);
          setCars(Array.isArray(carsRes.data?.cars) ? carsRes.data.cars : []);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRanks([]);
          setCars([]);
        }
      });
    return () => { cancelled = true; };
  }, [open, isAdmin]);

  const runAction = useCallback(
    async (key, fn) => {
      setActionLoading((prev) => ({ ...prev, [key]: true }));
      try {
        await fn();
        onActionDone?.();
        refetch();
      } finally {
        setActionLoading((prev) => ({ ...prev, [key]: false }));
      }
    },
    [onActionDone, refetch]
  );

  const isStaff = isAdmin || isModerator;
  const enc = encodeURIComponent(username || '');

  /** POST then toast the server message (or a fallback). */
  const post = (url, fallback, body = undefined, config = undefined) => async () => {
    const res = await api.post(url, body, config);
    toast.success(res.data?.message || fallback);
  };

  /** One action button: confirm (optional), then run through runAction with a busy state. */
  const ActionBtn = ({ k, label, run, icon: Icon, danger, good, confirm, disabled, className = '' }) => (
    <button
      type="button"
      className={`sd-btn ${danger ? 'danger' : ''} ${good ? 'good' : ''} ${className}`}
      disabled={!!actionLoading[k] || disabled}
      onClick={() => {
        if (confirm && !window.confirm(confirm)) return;
        runAction(k, run);
      }}
    >
      {Icon && <Icon size={15} />}
      {actionLoading[k] ? '…' : label}
    </button>
  );

  const killWipe = () => {
    const reason = window.prompt(`Modkill (wipe) ${username}? Enter a short Topic of Shame reason.`);
    if (reason == null) return;
    const trimmed = String(reason).trim();
    if (!trimmed) {
      toast.error('Enter a short reason for Topic of Shame');
      return;
    }
    if (!window.confirm(`Wipe ${username}? Honours, cash, points, Game Pass stripped. Rat. No £10 revive.`)) return;
    runAction('killWipe', post('/admin/kill-player', undefined, null, { params: { target_username: username, wipe: true, reason: trimmed } }));
  };

  const changeUsername = () => {
    const next = dossierNewUsername.trim();
    if (next.length > 20) {
      toast.error('Username must be 20 characters or fewer');
      return;
    }
    if (!window.confirm(`Rename ${username} to "${next}"?`)) return;
    runAction('changeUsername', async () => {
      const res = await api.post('/admin/change-username', { new_username: next }, { params: { target_username: username } });
      toast.success(res.data?.message || 'Username updated');
      setDossierNewUsername('');
      onActionDone?.();
    });
  };

  const changeRank = () => runAction('changeRank', async () => {
    const rank = parseInt(dossierNewRank, 10);
    const maxRank = ranks.length > 0 ? Math.max(...ranks.map((r) => r.id)) : 11;
    if (Number.isNaN(rank) || rank < 1 || rank > maxRank) {
      toast.error(`Select rank 1–${maxRank}`);
      return;
    }
    const res = await api.post(`/admin/change-rank?target_username=${enc}&new_rank=${rank}&prestige_level=${dossierPrestigeLevel}`);
    toast.success(res.data?.message);
  });

  const viewRegistration = async () => {
    setRegistrationLoading(true);
    setRegistrationInfo(null);
    try {
      const res = await api.get('/admin/user-registration', { params: { target_username: username } });
      setRegistrationInfo(res.data?.user ?? null);
      if (!res.data?.user) toast.info('No registration data');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    } finally {
      setRegistrationLoading(false);
    }
  };

  const viewSessions = async () => {
    setSessionsLoading(true);
    setSessions(null);
    try {
      const res = await api.get('/admin/user-sessions', { params: { target_username: username } });
      setSessions(res.data?.sessions ?? []);
      toast.success((res.data?.sessions?.length || 0) ? `${res.data.sessions.length} session(s)` : 'No sessions');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
      setSessions([]);
    } finally {
      setSessionsLoading(false);
    }
  };

  const revokeSession = (s) => {
    if (!window.confirm('Revoke this session?')) return;
    api
      .post('/admin/sessions/revoke', { target_username: username, session_id: s.id })
      .then(() => {
        toast.success('Revoked');
        setSessions((prev) => prev.filter((x) => x.id !== s.id));
        onActionDone?.();
      })
      .catch((e) => toast.error(e.response?.data?.detail || 'Failed'));
  };

  const tabs = TABS.filter((t) => (t.admin ? isAdmin : t.staff ? isStaff : true));
  const d = data;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className={`sd flex flex-col h-full max-h-[100dvh] w-full sm:max-w-2xl md:max-w-3xl overflow-hidden p-4 sm:p-6 ${styles.panel} border-primary/30 bg-[var(--noir-surface)] shadow-[0_0_24px_rgba(var(--noir-primary-rgb),0.08)]`}
      >
        <SheetHeader className="shrink-0 text-left space-y-0">
          <div className="sd-head">
            <span className="sd-avatar">{(d?.username || username || '?').slice(0, 1).toUpperCase()}</span>
            <div className="min-w-0">
              <span className="sd-kicker"><Shield size={12} />User dossier</span>
              <SheetTitle className="sd-name">{d?.username || username}</SheetTitle>
              {d && (
                <div className="sd-sub">
                  {d.rank_name != null ? `${d.rank_name} · P${d.prestige_level ?? 0}` : 'Unranked'}
                  {d.family_name ? ` · ${d.family_name}` : ''}
                  {d.current_state ? ` · ${d.current_state}` : ''}
                </div>
              )}
            </div>
          </div>
          {d && (
            <>
              <div className="sd-badges">
                {d.is_dead ? <span className="sd-badge bad"><Skull size={12} />Dead</span> : <span className="sd-badge good"><HeartPulse size={12} />Alive</span>}
                {d.in_jail && <span className="sd-badge warn">In jail</span>}
                {d.account_locked && <span className="sd-badge bad"><Lock size={12} />Locked</span>}
                {d.last_seen && <span className="sd-badge">Seen {formatDateTime(d.last_seen)}</span>}
              </div>
              {isStaff && (
                <div className="sd-links">
                  <Link className="sd-link" to={`/tjjeujr3wa/player?u=${enc}`}><UserRound size={13} />Player page</Link>
                  {isAdmin && <Link className="sd-link" to={`/tjjeujr3wa/log-explorer?u=${enc}`}><ScrollText size={13} />Full log timeline</Link>}
                  <Link className="sd-link" to={`/tjjeujr3wa/safety-center?tab=multi&u=${enc}`}><Fingerprint size={13} />Linked accounts</Link>
                </div>
              )}
              <div className="sd-kpis">
                <div className="sd-kpi"><span>Money</span><b title={d.money != null ? `$${num(d.money)}` : undefined}>{d.money != null ? `$${compact(d.money)}` : '—'}</b></div>
                <div className="sd-kpi"><span>Points</span><b title={num(d.points) || undefined}>{compact(d.points)}</b></div>
                <div className="sd-kpi"><span>Bullets</span><b title={num(d.bullets) || undefined}>{compact(d.bullets)}</b></div>
                <div className="sd-kpi"><span>Kills</span><b>{num(d.total_kills) ?? '—'}</b></div>
                <div className="sd-kpi"><span>Rank pts</span><b title={num(d.rank_points) || undefined}>{compact(d.rank_points)}</b></div>
              </div>
            </>
          )}
        </SheetHeader>

        <div className="sd-scroll mt-4 flex-1 min-h-0 overflow-y-auto space-y-3 pb-[env(safe-area-inset-bottom)]">
          {loading && (
            <div className="sd-state"><Activity className="w-4 h-4 animate-pulse" />Loading…</div>
          )}

          {error && (
            <div className="sd-error">
              <p className="m-0">{error}</p>
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setLoading(true);
                  refetch().finally(() => setLoading(false));
                }}
              >
                Retry
              </button>
            </div>
          )}

          {d && !loading && (
            <>
              {tabs.length > 1 && (
                <div className="sd-tabs" role="tablist">
                  {tabs.map((t) => (
                    <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>{t.label}</button>
                  ))}
                </div>
              )}

              {tab === 'overview' && (
                <div className="sd-grid">
                  <Card title="Identity" icon={UserRound}>
                    <dl className="sd-dl">
                      <Item label="User ID" value={d.id} mono copy />
                      <Item label="Email" value={d.email} copy />
                      {d.staff_email?.email_before_freed ? <Item label="Original email" value={d.staff_email.email_before_freed} tone="hl" copy /> : null}
                      {d.staff_email?.replacement_account?.username ? (
                        <Item
                          label="Email now on"
                          value={`${d.staff_email.replacement_account.username}${d.staff_email.replacement_account.email ? ` (${d.staff_email.replacement_account.email})` : ''}`}
                        />
                      ) : null}
                      <Item label="Created" value={formatDateTime(d.created_at)} />
                      <Item label="Last seen" value={formatDateTime(d.last_seen)} />
                    </dl>
                  </Card>
                  <Card title="Rank & wealth" icon={Award}>
                    <dl className="sd-dl">
                      <Item label="Rank" value={d.rank_name != null ? `${d.rank_name} (P${d.prestige_level ?? 0})` : null} tone="hl" />
                      <Item label="Crew" value={d.family_name} />
                      <Item label="Rank points" value={num(d.rank_points)} />
                      <Item label="Money" value={d.money != null ? `$${num(d.money)}` : null} />
                      <Item label="Points" value={num(d.points)} />
                      <Item label="Bullets" value={num(d.bullets)} />
                      <Item label="Armour" value={d.armour_level} />
                      <Item label="State" value={d.current_state} />
                    </dl>
                  </Card>
                  <Card title="Stats" icon={Activity}>
                    <dl className="sd-dl">
                      <Item label="Kills" value={num(d.total_kills)} />
                      <Item label="Deaths" value={num(d.total_deaths)} />
                      <Item label="Crimes" value={num(d.total_crimes)} />
                      <Item label="GTA" value={num(d.total_gta)} />
                      <Item label="Jail busts" value={num(d.jail_busts)} />
                    </dl>
                  </Card>
                  <Card title="Status & network" icon={Shield}>
                    <dl className="sd-dl">
                      <Item label="In jail" value={d.in_jail ? 'Yes' : 'No'} tone={d.in_jail ? 'bad' : ''} />
                      <Item label="Dead" value={d.is_dead ? 'Yes' : 'No'} tone={d.is_dead ? 'bad' : ''} />
                      <Item
                        label="Account locked"
                        value={d.account_locked ? `Yes${d.account_locked_at ? ` (${formatDateTime(d.account_locked_at)})` : ''}` : 'No'}
                        tone={d.account_locked ? 'bad' : ''}
                      />
                      <Item label="Registration IP" value={d.registration_ip} mono copy />
                      <Item label="Last login IP" value={d.last_login_ip} mono copy />
                    </dl>
                  </Card>
                </div>
              )}

              {tab === 'actions' && isStaff && (
                <>
                  <Card title="Account access" icon={KeyRound}>
                    <div className="sd-actions">
                      <ActionBtn k="lock" label="Lock" icon={Lock} danger run={post(`/admin/lock-player?target_username=${enc}`)} />
                      <ActionBtn k="unlock" label="Unlock" icon={Unlock} run={post(`/admin/unlock-account?target_username=${enc}`)} />
                      {isAdmin && (
                        <ActionBtn k="logout" label="Log out" icon={LogOut} confirm={`Log out ${username}? All sessions will be invalidated.`} run={post(`/admin/log-out-user?target_username=${enc}`, 'User logged out')} />
                      )}
                      {isAdmin && (
                        <ActionBtn k="clearLockout" label="Clear lockout" icon={KeyRound} run={post(`/admin/clear-login-lockout?target_username=${enc}`, 'Lockout cleared')} />
                      )}
                      <ActionBtn k="forumUnmute" label="Forum unmute" icon={MessageSquareOff} run={post(`/admin/forum-unmute?target_username=${enc}`, 'Unmuted')} />
                      <ActionBtn k="forceOnline" label="Force online 1h" icon={Radio} run={post('/admin/force-online-user', 'Done', null, { params: { target_username: username, hours: 1 } })} />
                    </div>
                  </Card>
                  {isAdmin && (
                    <Card title="Danger zone" icon={Skull} danger hint="Kill sends them to the dead screen. Wipe also strips honours, cash, points and Game Pass, resets to Rat and posts to the Topic of Shame.">
                      <div className="sd-actions">
                        <ActionBtn k="kill" label="Kill" icon={Skull} danger run={post(`/admin/kill-player?target_username=${enc}`)} />
                        <button type="button" className="sd-btn danger" disabled={!!actionLoading.killWipe} onClick={killWipe}>
                          <Eraser size={15} />{actionLoading.killWipe ? '…' : 'Kill & wipe'}
                        </button>
                        <ActionBtn k="revive" label="Revive" icon={HeartPulse} good run={post(`/admin/revive-player?target_username=${enc}`)} />
                      </div>
                    </Card>
                  )}
                </>
              )}

              {tab === 'give' && isAdmin && (
                <>
                  <Card title="Rewards & items" icon={Gift}>
                    <div className="sd-tools">
                      <Tool label="Adjust money">
                        <input type="number" inputMode="numeric" value={dossierMoneyAmount} onChange={(e) => setDossierMoneyAmount(parseInt(e.target.value, 10) || 0)} className="sd-input" placeholder="e.g. -50000" />
                        <ActionBtn
                          k="adjustMoney"
                          label={dossierMoneyAmount < 0 ? 'Remove' : 'Add'}
                          icon={Coins}
                          danger={dossierMoneyAmount < 0}
                          disabled={dossierMoneyAmount === 0}
                          confirm={dossierMoneyAmount < 0
                            ? `Remove $${Math.abs(dossierMoneyAmount).toLocaleString()} from ${username}?`
                            : `Add $${dossierMoneyAmount.toLocaleString()} to ${username}?`}
                          run={post(`/admin/adjust-money?target_username=${enc}&amount=${dossierMoneyAmount}`)}
                        />
                      </Tool>
                      <Tool label="Add points">
                        <input type="number" inputMode="numeric" min="1" value={dossierPoints} onChange={(e) => setDossierPoints(parseInt(e.target.value, 10) || 0)} className="sd-input" />
                        <ActionBtn k="addPoints" label="Add" run={post(`/admin/add-points?target_username=${enc}&points=${dossierPoints}`)} />
                      </Tool>
                      <Tool label="Give bullets">
                        <input type="number" inputMode="numeric" min="1" value={dossierBullets} onChange={(e) => setDossierBullets(parseInt(e.target.value, 10) || 0)} className="sd-input" />
                        <ActionBtn k="addBullets" label="Give" run={post(`/admin/add-bullets?target_username=${enc}&bullets=${dossierBullets}`)} />
                      </Tool>
                      <Tool label="Add tokens">
                        <select value={dossierTokenType} onChange={(e) => setDossierTokenType(e.target.value)} className="sd-input">
                          {TOKEN_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                        <input type="number" inputMode="numeric" min="1" value={dossierTokenAmount} onChange={(e) => setDossierTokenAmount(parseInt(e.target.value, 10) || 1)} className="sd-input narrow" />
                        <ActionBtn k="addTokens" label="Give" run={post(`/admin/add-tokens?target_username=${enc}&token_type=${dossierTokenType}&amount=${dossierTokenAmount}`)} />
                      </Tool>
                      <Tool label="Loot pieces">
                        <input type="number" inputMode="numeric" min="0" value={dossierLootPieces} onChange={(e) => setDossierLootPieces(parseInt(e.target.value, 10) || 0)} className="sd-input" />
                        <ActionBtn k="lootPieces" label="Give" run={post(`/admin/add-loot-pieces?target_username=${enc}&pieces=${dossierLootPieces}`)} />
                      </Tool>
                      <Tool label="Add car">
                        <select value={dossierCarId} onChange={(e) => setDossierCarId(e.target.value)} className="sd-input">
                          {cars.length > 0
                            ? cars.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)
                            : Array.from({ length: 20 }, (_, i) => <option key={i} value={`car${i + 1}`}>Car {i + 1}</option>)}
                        </select>
                        <ActionBtn k="addCar" label="Add" icon={Car} run={post(`/admin/add-car?target_username=${enc}&car_id=${dossierCarId}`)} />
                      </Tool>
                      <Tool label="Founding Member">
                        <ActionBtn k="foundingGrant" label="Grant" good run={post(`/admin/set-founding-member?target_username=${enc}&is_founding=true`)} />
                        <ActionBtn k="foundingRemove" label="Remove" danger run={post(`/admin/set-founding-member?target_username=${enc}&is_founding=false`)} />
                      </Tool>
                      <Tool label="Auto Rank">
                        <ActionBtn k="autoRankGive" label="Give" good icon={Zap} run={post(`/admin/give-auto-rank?target_username=${enc}`, 'Auto rank given')} />
                        <ActionBtn k="autoRankRemove" label="Remove" danger run={post(`/admin/remove-auto-rank?target_username=${enc}`, 'Auto rank removed')} />
                      </Tool>
                    </div>
                  </Card>

                  <Card title="Rank & timers" icon={Timer}>
                    <div className="sd-tools">
                      <Tool label="Change rank">
                        <select value={dossierNewRank} onChange={(e) => setDossierNewRank(e.target.value)} className="sd-input">
                          <option value="">Pick a rank</option>
                          {ranks.map((r) => <option key={r.id} value={String(r.id)}>{r.name}</option>)}
                        </select>
                        <input type="number" inputMode="numeric" min="0" max="5" value={dossierPrestigeLevel} onChange={(e) => setDossierPrestigeLevel(parseInt(e.target.value, 10) || 0)} className="sd-input narrow" title="Prestige 0–5" aria-label="Prestige 0–5" />
                        <button
                          type="button"
                          className="sd-btn"
                          disabled={actionLoading.changeRank || !dossierNewRank || dossierPrestigeLevel < 0 || dossierPrestigeLevel > 5}
                          onClick={changeRank}
                        >
                          {actionLoading.changeRank ? '…' : 'Set'}
                        </button>
                      </Tool>
                      <Tool label="Search time (min)">
                        <input type="number" inputMode="numeric" min="0" value={dossierSearchMinutes} onChange={(e) => setDossierSearchMinutes(parseInt(e.target.value, 10) || 0)} className="sd-input" />
                        <ActionBtn k="setSearchTime" label="Set" run={post(`/admin/set-search-time?target_username=${enc}&search_minutes=${dossierSearchMinutes}`)} />
                      </Tool>
                      <Tool label="Daily rewards timer">
                        <ActionBtn k="resetDailyRewards" label="Reset" run={post(`/admin/daily-rewards/reset-timer?target_username=${enc}`, 'Reset')} />
                      </Tool>
                      <Tool label="Bodyguards">
                        <ActionBtn k="clearBodyguards" label="Clear all" danger run={post(`/admin/bodyguards/clear?target_username=${enc}`, 'Cleared')} />
                      </Tool>
                    </div>
                  </Card>

                  <Card title="Account details" icon={Mail}>
                    <div className="sd-tools">
                      <Tool label="Change email">
                        <input type="email" inputMode="email" autoCapitalize="none" value={dossierNewEmail} onChange={(e) => setDossierNewEmail(e.target.value)} placeholder="new@email.com" className="sd-input" />
                        <ActionBtn
                          k="changeEmail"
                          label="Set"
                          disabled={!dossierNewEmail.trim()}
                          run={async () => {
                            const res = await api.post('/admin/change-email', { new_email: dossierNewEmail.trim() }, { params: { target_username: username } });
                            toast.success(res.data?.message || 'Email updated');
                            setDossierNewEmail('');
                          }}
                        />
                      </Tool>
                      <Tool label="Change username">
                        <input type="text" autoCapitalize="none" spellCheck={false} value={dossierNewUsername} onChange={(e) => setDossierNewUsername(e.target.value)} placeholder="max 20 chars" maxLength={20} className="sd-input" />
                        <button type="button" className="sd-btn" disabled={actionLoading.changeUsername || !dossierNewUsername.trim()} onClick={changeUsername}>
                          {actionLoading.changeUsername ? '…' : 'Rename'}
                        </button>
                      </Tool>
                      <Tool label="Set password">
                        <input type="password" autoComplete="new-password" value={dossierNewPassword} onChange={(e) => setDossierNewPassword(e.target.value)} placeholder="min 6 chars" className="sd-input" />
                        <ActionBtn
                          k="setPassword"
                          label="Set"
                          disabled={dossierNewPassword.length < 6}
                          confirm={`Set password for ${username}? They will be logged out.`}
                          run={async () => {
                            const res = await api.post('/admin/set-password', { new_password: dossierNewPassword }, { params: { target_username: username } });
                            toast.success(res.data?.message || 'Password set');
                            setDossierNewPassword('');
                          }}
                        />
                      </Tool>
                    </div>
                  </Card>
                </>
              )}

              {tab === 'logs' && isStaff && (
                <>
                  <Card title="Registration & sessions" icon={Fingerprint}>
                    <div className="sd-actions">
                      <button type="button" className="sd-btn" disabled={registrationLoading} onClick={viewRegistration}>
                        {registrationLoading ? '…' : 'View registration'}
                      </button>
                      <button type="button" className="sd-btn" disabled={sessionsLoading} onClick={viewSessions}>
                        {sessionsLoading ? '…' : 'View sessions'}
                      </button>
                    </div>
                    {registrationInfo && (
                      <div className="sd-reg">
                        <div>IP: {registrationInfo.registration_ip ?? '—'}</div>
                        <div>UA: {(registrationInfo.registration_ua || '').slice(0, 120)}</div>
                        {registrationInfo.registered_at && <div>At: {formatDateTime(registrationInfo.registered_at)}</div>}
                      </div>
                    )}
                    {sessions && (
                      <div className="sd-sessions">
                        {sessions.length === 0 ? (
                          <p className="sd-hint m-0">No sessions</p>
                        ) : (
                          sessions.map((s) => (
                            <div key={s.id} className="sd-session">
                              <span>{s.ip || '—'} · {s.device || '—'} · {s.last_used_at ? formatDateTime(s.last_used_at) : '—'}</span>
                              <button type="button" onClick={() => revokeSession(s)}>Revoke</button>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </Card>
                  <Card title="Logs" icon={ScrollText}>
                    <div className="sd-actions">
                      {isAdmin && <Link className="sd-btn" to={`/tjjeujr3wa/log-explorer?u=${enc}`}>Full log timeline</Link>}
                      <Link className="sd-btn" to="/tjjeujr3wa/overview" state={{ activityLogUsername: username }}>Activity log</Link>
                      <Link className="sd-btn" to="/tjjeujr3wa/overview" state={{ gamblingLogUsername: username }}>Gambling log</Link>
                    </div>
                  </Card>
                </>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
