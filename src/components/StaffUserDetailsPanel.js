import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  Shield,
  Lock,
  Unlock,
  Skull,
  Zap,
  Bot,
  Coins,
  Crosshair,
  Car,
  Gift,
  Award,
  Mail,
  LogOut,
  Users,
} from 'lucide-react';
import api, { getApiErrorMessage } from '../utils/api';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from './ui/sheet';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

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

function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function Section({ title, children }) {
  return (
    <div className="staff-details-section">
      <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent mb-2" />
      <h3 className="text-[9px] font-heading font-bold text-primary/90 uppercase tracking-[0.2em] mb-2">
        {title}
      </h3>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[10px] font-heading">
        {children}
      </div>
    </div>
  );
}

function Row({ label, value, mono, highlight }) {
  return (
    <div className="col-span-2 sm:col-span-1">
      <span className="text-mutedForeground block truncate">{label}</span>
      <span
        className={`block truncate ${mono ? 'font-mono text-[9px]' : ''} ${highlight ? 'text-primary font-semibold' : 'text-foreground'}`}
      >
        {value ?? '—'}
      </span>
    </div>
  );
}

function ToolRow({ label, children }) {
  return (
    <div className="flex flex-wrap items-center gap-2 py-1.5">
      <span className="text-mutedForeground text-[9px] font-heading uppercase tracking-wider w-full sm:w-28 shrink-0">
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-1.5 min-w-0">{children}</div>
    </div>
  );
}

const inputClass =
  'w-16 sm:w-20 bg-zinc-900/50 border border-zinc-700/50 rounded px-1.5 py-0.5 text-[10px] text-foreground focus:border-primary/50 focus:outline-none';
const btnClass =
  'px-2 py-0.5 rounded text-[9px] font-heading font-bold uppercase border border-primary/40 bg-primary/20 text-primary hover:bg-primary/30 disabled:opacity-50';
const btnDangerClass =
  'px-2 py-0.5 rounded text-[9px] font-heading font-bold uppercase border border-red-500/40 bg-red-500/20 text-red-400 hover:bg-red-500/30 disabled:opacity-50';

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
  const [dossierNewPassword, setDossierNewPassword] = useState('');

  const refetch = useCallback(() => {
    if (!username) return;
    api
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

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className={`flex flex-col h-full max-h-[100vh] w-full sm:max-w-2xl md:max-w-4xl overflow-hidden ${styles.panel} border-primary/30 bg-[var(--noir-surface)] shadow-[0_0_24px_rgba(var(--noir-primary-rgb),0.08)]`}
      >
        <SheetHeader className="pb-2 shrink-0">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-primary" />
            <SheetTitle className="text-sm font-heading font-bold text-primary uppercase tracking-wider">
              User dossier
            </SheetTitle>
          </div>
          {username && (
            <p className="text-[10px] text-mutedForeground font-heading">
              {username}
            </p>
          )}
        </SheetHeader>

        <div className="mt-4 space-y-4 flex-1 min-h-0 overflow-y-auto">
          {loading && (
            <div className="flex items-center gap-2 py-8 text-mutedForeground">
              <Activity className="w-4 h-4 animate-pulse" />
              <span className="text-[10px] font-heading uppercase tracking-wider">
                Loading…
              </span>
            </div>
          )}

          {error && (
            <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-[10px] font-heading">
              <p className="text-red-400">{error}</p>
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  if (username) {
                    setLoading(true);
                    api
                      .get(`/users/${encodeURIComponent(username)}/staff-stats`)
                      .then((res) => {
                        setData(res.data);
                        setError(null);
                      })
                      .catch((e) => {
                        setError(getApiErrorMessage(e) || 'Failed to load');
                      })
                      .finally(() => setLoading(false));
                  }
                }}
                className="mt-2 text-primary hover:underline font-bold"
              >
                Retry
              </button>
            </div>
          )}

          {data && !loading && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
                <Section title="Identity">
                  <Row label="User ID" value={data.id} mono />
                  <Row label="Username" value={data.username} />
                  <Row label="Email" value={data.email} />
                  <Row label="Created" value={formatDateTime(data.created_at)} />
                  <Row label="Last seen" value={formatDateTime(data.last_seen)} />
                </Section>

                <Section title="Rank & crew">
                <Row
                  label="Rank"
                  value={
                    data.rank_name != null
                      ? `${data.rank_name} (P${data.prestige_level ?? 0})`
                      : null
                  }
                />
                <Row label="Crew" value={data.family_name} />
                <Row
                  label="Rank points"
                  value={
                    data.rank_points != null
                      ? Number(data.rank_points).toLocaleString()
                      : null
                  }
                />
                <Row
                  label="Points"
                  value={
                    data.points != null
                      ? Number(data.points).toLocaleString()
                      : null
                  }
                />
              </Section>

              <Section title="Wealth & resources">
                <Row
                  label="Money"
                  value={
                    data.money != null
                      ? `$${Number(data.money).toLocaleString()}`
                      : null
                  }
                />
                <Row
                  label="Bullets"
                  value={
                    data.bullets != null
                      ? Number(data.bullets).toLocaleString()
                      : null
                  }
                />
                <Row label="Armour" value={data.armour_level} />
                <Row label="State" value={data.current_state} />
              </Section>

              <Section title="Stats">
                <Row
                  label="Kills"
                  value={
                    data.total_kills != null
                      ? Number(data.total_kills).toLocaleString()
                      : null
                  }
                />
                <Row
                  label="Deaths"
                  value={
                    data.total_deaths != null
                      ? Number(data.total_deaths).toLocaleString()
                      : null
                  }
                />
                <Row
                  label="Crimes"
                  value={
                    data.total_crimes != null
                      ? Number(data.total_crimes).toLocaleString()
                      : null
                  }
                />
                <Row
                  label="GTA"
                  value={
                    data.total_gta != null
                      ? Number(data.total_gta).toLocaleString()
                      : null
                  }
                />
                <Row
                  label="Jail busts"
                  value={
                    data.jail_busts != null
                      ? Number(data.jail_busts).toLocaleString()
                      : null
                  }
                />
              </Section>

              <Section title="Status">
                <Row
                  label="In jail"
                  value={data.in_jail ? 'Yes' : 'No'}
                  highlight={data.in_jail}
                />
                <Row
                  label="Dead"
                  value={data.is_dead ? 'Yes' : 'No'}
                  highlight={data.is_dead}
                />
                <Row
                  label="Account locked"
                  value={
                    data.account_locked
                      ? 'Yes' + (data.account_locked_at ? ' (' + formatDateTime(data.account_locked_at) + ')' : '')
                      : 'No'
                  }
                  highlight={data.account_locked}
                />
              </Section>

                <Section title="Network">
                  <div className="col-span-2">
                    <span className="text-mutedForeground block truncate">
                      Registration IP
                    </span>
                    <span className="font-mono text-[9px] text-foreground block break-all">
                      {data.registration_ip ?? '—'}
                    </span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-mutedForeground block truncate">
                      Last login IP
                    </span>
                    <span className="font-mono text-[9px] text-foreground block break-all">
                      {data.last_login_ip ?? '—'}
                    </span>
                  </div>
                </Section>
              </div>

              {isStaff && (
                <>
                  <Section title="Account actions">
                    <div className="col-span-2 space-y-1">
                      {(isAdmin || isModerator) && (
                        <>
                          <ToolRow label="Lock">
                            <button
                              type="button"
                              className={btnDangerClass}
                              disabled={actionLoading.lock}
                              onClick={() =>
                                runAction('lock', async () => {
                                  const res = await api.post(
                                    `/admin/lock-player?target_username=${encodeURIComponent(username)}`
                                  );
                                  toast.success(res.data?.message);
                                })
                              }
                            >
                              {actionLoading.lock ? '…' : 'Lock'}
                            </button>
                          </ToolRow>
                          <ToolRow label="Unlock">
                            <button
                              type="button"
                              className={btnClass}
                              disabled={actionLoading.unlock}
                              onClick={() =>
                                runAction('unlock', async () => {
                                  const res = await api.post(
                                    `/admin/unlock-account?target_username=${encodeURIComponent(username)}`
                                  );
                                  toast.success(res.data?.message);
                                })
                              }
                            >
                              {actionLoading.unlock ? '…' : 'Unlock'}
                            </button>
                          </ToolRow>
                        </>
                      )}
                      {isAdmin && (
                        <>
                          <ToolRow label="Kill">
                            <button
                              type="button"
                              className={btnDangerClass}
                              disabled={actionLoading.kill}
                              onClick={() =>
                                runAction('kill', async () => {
                                  const res = await api.post(
                                    `/admin/kill-player?target_username=${encodeURIComponent(username)}`
                                  );
                                  toast.success(res.data?.message);
                                })
                              }
                            >
                              {actionLoading.kill ? '…' : 'Kill'}
                            </button>
                          </ToolRow>
                          <ToolRow label="Revive">
                            <button
                              type="button"
                              className={btnClass}
                              disabled={actionLoading.revive}
                              onClick={() =>
                                runAction('revive', async () => {
                                  const res = await api.post(
                                    `/admin/revive-player?target_username=${encodeURIComponent(username)}`
                                  );
                                  toast.success(res.data?.message);
                                })
                              }
                            >
                              {actionLoading.revive ? '…' : 'Revive'}
                            </button>
                          </ToolRow>
                          <ToolRow label="Log out">
                            <button
                              type="button"
                              className={btnClass}
                              disabled={actionLoading.logout}
                              onClick={() => {
                                if (
                                  !window.confirm(
                                    `Log out ${username}? All sessions will be invalidated.`
                                  )
                                )
                                  return;
                                runAction('logout', async () => {
                                  const res = await api.post(
                                    `/admin/log-out-user?target_username=${encodeURIComponent(username)}`
                                  );
                                  toast.success(res.data?.message || 'User logged out');
                                });
                              }}
                            >
                              {actionLoading.logout ? '…' : 'Log out'}
                            </button>
                          </ToolRow>
                          <ToolRow label="Clear lockout">
                            <button
                              type="button"
                              className={btnClass}
                              disabled={actionLoading.clearLockout}
                              onClick={() =>
                                runAction('clearLockout', async () => {
                                  const res = await api.post(
                                    `/admin/clear-login-lockout?target_username=${encodeURIComponent(username)}`
                                  );
                                  toast.success(res.data?.message || 'Lockout cleared');
                                })
                              }
                            >
                              {actionLoading.clearLockout ? '…' : 'Clear'}
                            </button>
                          </ToolRow>
                        </>
                      )}
                      {(isAdmin || isModerator) && (
                        <>
                          <ToolRow label="Forum unmute">
                            <button
                              type="button"
                              className={btnClass}
                              disabled={actionLoading.forumUnmute}
                              onClick={() =>
                                runAction('forumUnmute', async () => {
                                  const res = await api.post(
                                    `/admin/forum-unmute?target_username=${encodeURIComponent(username)}`
                                  );
                                  toast.success(res.data?.message || 'Unmuted');
                                })
                              }
                            >
                              {actionLoading.forumUnmute ? '…' : 'Unmute'}
                            </button>
                          </ToolRow>
                          <ToolRow label="Force online 1h">
                            <button
                              type="button"
                              className={btnClass}
                              disabled={actionLoading.forceOnline}
                              onClick={() =>
                                runAction('forceOnline', async () => {
                                  const res = await api.post(
                                    '/admin/force-online-user',
                                    null,
                                    { params: { target_username: username, hours: 1 } }
                                  );
                                  toast.success(res.data?.message || 'Done');
                                })
                              }
                            >
                              {actionLoading.forceOnline ? '…' : 'Force online'}
                            </button>
                          </ToolRow>
                        </>
                      )}
                    </div>
                  </Section>

                  {isAdmin && (
                    <>
                      <Section title="Set account">
                        <div className="col-span-2 space-y-1">
                          <ToolRow label="Change email">
                            <input
                              type="email"
                              value={dossierNewEmail}
                              onChange={(e) => setDossierNewEmail(e.target.value)}
                              placeholder="new@email.com"
                              className={`${inputClass} w-32`}
                            />
                            <button
                              type="button"
                              className={btnClass}
                              disabled={actionLoading.changeEmail || !dossierNewEmail.trim()}
                              onClick={() =>
                                runAction('changeEmail', async () => {
                                  const res = await api.post(
                                    '/admin/change-email',
                                    { new_email: dossierNewEmail.trim() },
                                    { params: { target_username: username } }
                                  );
                                  toast.success(res.data?.message || 'Email updated');
                                  setDossierNewEmail('');
                                })
                              }
                            >
                              {actionLoading.changeEmail ? '…' : 'Set'}
                            </button>
                          </ToolRow>
                          <ToolRow label="Set password">
                            <input
                              type="password"
                              value={dossierNewPassword}
                              onChange={(e) => setDossierNewPassword(e.target.value)}
                              placeholder="min 6 chars"
                              className={`${inputClass} w-28`}
                            />
                            <button
                              type="button"
                              className={btnClass}
                              disabled={
                                actionLoading.setPassword || dossierNewPassword.length < 6
                              }
                              onClick={() => {
                                if (
                                  !window.confirm(
                                    `Set password for ${username}? They will be logged out.`
                                  )
                                )
                                  return;
                                runAction('setPassword', async () => {
                                  const res = await api.post(
                                    '/admin/set-password',
                                    { new_password: dossierNewPassword },
                                    { params: { target_username: username } }
                                  );
                                  toast.success(res.data?.message || 'Password set');
                                  setDossierNewPassword('');
                                });
                              }}
                            >
                              {actionLoading.setPassword ? '…' : 'Set'}
                            </button>
                          </ToolRow>
                        </div>
                      </Section>

                      <Section title="Rewards & items">
                        <div className="col-span-2 space-y-1">
                          <ToolRow label="Adjust money">
                            <input
                              type="number"
                              value={dossierMoneyAmount}
                              onChange={(e) =>
                                setDossierMoneyAmount(parseInt(e.target.value, 10) || 0)
                              }
                              className={`${inputClass} w-24`}
                              placeholder="e.g. -50000"
                            />
                            <button
                              type="button"
                              className={dossierMoneyAmount < 0 ? btnDangerClass : btnClass}
                              disabled={actionLoading.adjustMoney || dossierMoneyAmount === 0}
                              onClick={() =>
                                runAction('adjustMoney', async () => {
                                  const label = dossierMoneyAmount < 0
                                    ? `Remove $${Math.abs(dossierMoneyAmount).toLocaleString()} from ${username}?`
                                    : `Add $${dossierMoneyAmount.toLocaleString()} to ${username}?`;
                                  if (!window.confirm(label)) return;
                                  const res = await api.post(
                                    `/admin/adjust-money?target_username=${encodeURIComponent(username)}&amount=${dossierMoneyAmount}`
                                  );
                                  toast.success(res.data?.message);
                                  refetch();
                                })
                              }
                            >
                              {actionLoading.adjustMoney ? '…' : dossierMoneyAmount < 0 ? 'Remove' : 'Add'}
                            </button>
                          </ToolRow>
                          <ToolRow label="Add points">
                            <input
                              type="number"
                              min="1"
                              value={dossierPoints}
                              onChange={(e) =>
                                setDossierPoints(parseInt(e.target.value, 10) || 0)
                              }
                              className={inputClass}
                            />
                            <button
                              type="button"
                              className={btnClass}
                              disabled={actionLoading.addPoints}
                              onClick={() =>
                                runAction('addPoints', async () => {
                                  const res = await api.post(
                                    `/admin/add-points?target_username=${encodeURIComponent(username)}&points=${dossierPoints}`
                                  );
                                  toast.success(res.data?.message);
                                })
                              }
                            >
                              {actionLoading.addPoints ? '…' : 'Add'}
                            </button>
                          </ToolRow>
                          <ToolRow label="Give bullets">
                            <input
                              type="number"
                              min="1"
                              value={dossierBullets}
                              onChange={(e) =>
                                setDossierBullets(parseInt(e.target.value, 10) || 0)
                              }
                              className={inputClass}
                            />
                            <button
                              type="button"
                              className={btnClass}
                              disabled={actionLoading.addBullets}
                              onClick={() =>
                                runAction('addBullets', async () => {
                                  const res = await api.post(
                                    `/admin/add-bullets?target_username=${encodeURIComponent(username)}&bullets=${dossierBullets}`
                                  );
                                  toast.success(res.data?.message);
                                })
                              }
                            >
                              {actionLoading.addBullets ? '…' : 'Give'}
                            </button>
                          </ToolRow>
                          <ToolRow label="Add tokens">
                            <select
                              value={dossierTokenType}
                              onChange={(e) => setDossierTokenType(e.target.value)}
                              className={`${inputClass} w-24`}
                            >
                              {TOKEN_OPTIONS.map((o) => (
                                <option key={o.value} value={o.value}>
                                  {o.label}
                                </option>
                              ))}
                            </select>
                            <input
                              type="number"
                              min="1"
                              value={dossierTokenAmount}
                              onChange={(e) =>
                                setDossierTokenAmount(parseInt(e.target.value, 10) || 1)
                              }
                              className={inputClass}
                            />
                            <button
                              type="button"
                              className={btnClass}
                              disabled={actionLoading.addTokens}
                              onClick={() =>
                                runAction('addTokens', async () => {
                                  const res = await api.post(
                                    `/admin/add-tokens?target_username=${encodeURIComponent(username)}&token_type=${dossierTokenType}&amount=${dossierTokenAmount}`
                                  );
                                  toast.success(res.data?.message);
                                })
                              }
                            >
                              {actionLoading.addTokens ? '…' : 'Give'}
                            </button>
                          </ToolRow>
                          <ToolRow label="Founding Member">
                            <button
                              type="button"
                              className={btnClass}
                              disabled={actionLoading.foundingGrant}
                              onClick={() =>
                                runAction('foundingGrant', async () => {
                                  const res = await api.post(
                                    `/admin/set-founding-member?target_username=${encodeURIComponent(username)}&is_founding=true`
                                  );
                                  toast.success(res.data?.message);
                                })
                              }
                            >
                              {actionLoading.foundingGrant ? '…' : 'Grant'}
                            </button>
                            <button
                              type="button"
                              className={btnDangerClass}
                              disabled={actionLoading.foundingRemove}
                              onClick={() =>
                                runAction('foundingRemove', async () => {
                                  const res = await api.post(
                                    `/admin/set-founding-member?target_username=${encodeURIComponent(username)}&is_founding=false`
                                  );
                                  toast.success(res.data?.message);
                                })
                              }
                            >
                              {actionLoading.foundingRemove ? '…' : 'Remove'}
                            </button>
                          </ToolRow>
                          <ToolRow label="Add car">
                            <select
                              value={dossierCarId}
                              onChange={(e) => setDossierCarId(e.target.value)}
                              className={`${inputClass} w-28`}
                            >
                              {cars.length > 0
                                ? cars.map((c) => (
                                    <option key={c.id} value={c.id}>
                                      {c.name}
                                    </option>
                                  ))
                                : Array.from({ length: 20 }, (_, i) => (
                                    <option key={i} value={`car${i + 1}`}>
                                      Car {i + 1}
                                    </option>
                                  ))}
                            </select>
                            <button
                              type="button"
                              className={btnClass}
                              disabled={actionLoading.addCar}
                              onClick={() =>
                                runAction('addCar', async () => {
                                  const res = await api.post(
                                    `/admin/add-car?target_username=${encodeURIComponent(username)}&car_id=${dossierCarId}`
                                  );
                                  toast.success(res.data?.message);
                                })
                              }
                            >
                              {actionLoading.addCar ? '…' : 'Add'}
                            </button>
                          </ToolRow>
                          <ToolRow label="Loot pieces">
                            <input
                              type="number"
                              min="0"
                              value={dossierLootPieces}
                              onChange={(e) =>
                                setDossierLootPieces(parseInt(e.target.value, 10) || 0)
                              }
                              className={inputClass}
                            />
                            <button
                              type="button"
                              className={btnClass}
                              disabled={actionLoading.lootPieces}
                              onClick={() =>
                                runAction('lootPieces', async () => {
                                  const res = await api.post(
                                    `/admin/add-loot-pieces?target_username=${encodeURIComponent(username)}&pieces=${dossierLootPieces}`
                                  );
                                  toast.success(res.data?.message);
                                })
                              }
                            >
                              {actionLoading.lootPieces ? '…' : 'Give'}
                            </button>
                          </ToolRow>
                          <ToolRow label="Auto Rank">
                            <button
                              type="button"
                              className={btnClass}
                              disabled={actionLoading.autoRankGive}
                              onClick={() =>
                                runAction('autoRankGive', async () => {
                                  const res = await api.post(
                                    `/admin/give-auto-rank?target_username=${encodeURIComponent(username)}`
                                  );
                                  toast.success(res.data?.message || 'Auto rank given');
                                })
                              }
                            >
                              {actionLoading.autoRankGive ? '…' : 'Give'}
                            </button>
                            <button
                              type="button"
                              className={btnDangerClass}
                              disabled={actionLoading.autoRankRemove}
                              onClick={() =>
                                runAction('autoRankRemove', async () => {
                                  const res = await api.post(
                                    `/admin/remove-auto-rank?target_username=${encodeURIComponent(username)}`
                                  );
                                  toast.success(res.data?.message || 'Auto rank removed');
                                })
                              }
                            >
                              {actionLoading.autoRankRemove ? '…' : 'Remove'}
                            </button>
                          </ToolRow>
                        </div>
                      </Section>

                      <Section title="Rank & timers">
                        <div className="col-span-2 space-y-1">
                          <ToolRow label="Change rank">
                            <select
                              value={dossierNewRank}
                              onChange={(e) => setDossierNewRank(e.target.value)}
                              className={`${inputClass} w-28`}
                            >
                              <option value="">—</option>
                              {ranks.map((r) => (
                                <option key={r.id} value={String(r.id)}>
                                  {r.name}
                                </option>
                              ))}
                            </select>
                            <input
                              type="number"
                              min="0"
                              max="5"
                              value={dossierPrestigeLevel}
                              onChange={(e) =>
                                setDossierPrestigeLevel(parseInt(e.target.value, 10) || 0)
                              }
                              className={inputClass}
                              title="Prestige 0–5"
                            />
                            <button
                              type="button"
                              className={btnClass}
                              disabled={
                                actionLoading.changeRank ||
                                !dossierNewRank ||
                                dossierPrestigeLevel < 0 ||
                                dossierPrestigeLevel > 5
                              }
                              onClick={() =>
                                runAction('changeRank', async () => {
                                  const rank = parseInt(dossierNewRank, 10);
                                  const maxRank =
                                    ranks.length > 0
                                      ? Math.max(...ranks.map((r) => r.id))
                                      : 11;
                                  if (Number.isNaN(rank) || rank < 1 || rank > maxRank) {
                                    toast.error(`Select rank 1–${maxRank}`);
                                    return;
                                  }
                                  const res = await api.post(
                                    `/admin/change-rank?target_username=${encodeURIComponent(username)}&new_rank=${rank}&prestige_level=${dossierPrestigeLevel}`
                                  );
                                  toast.success(res.data?.message);
                                })
                              }
                            >
                              {actionLoading.changeRank ? '…' : 'Set'}
                            </button>
                          </ToolRow>
                          <ToolRow label="Set search time">
                            <input
                              type="number"
                              min="0"
                              value={dossierSearchMinutes}
                              onChange={(e) =>
                                setDossierSearchMinutes(parseInt(e.target.value, 10) || 0)
                              }
                              className={inputClass}
                            />
                            <button
                              type="button"
                              className={btnClass}
                              disabled={actionLoading.setSearchTime}
                              onClick={() =>
                                runAction('setSearchTime', async () => {
                                  const res = await api.post(
                                    `/admin/set-search-time?target_username=${encodeURIComponent(username)}&search_minutes=${dossierSearchMinutes}`
                                  );
                                  toast.success(res.data?.message);
                                })
                              }
                            >
                              {actionLoading.setSearchTime ? '…' : 'Set'}
                            </button>
                          </ToolRow>
                          <ToolRow label="Reset daily rewards">
                            <button
                              type="button"
                              className={btnClass}
                              disabled={actionLoading.resetDailyRewards}
                              onClick={() =>
                                runAction('resetDailyRewards', async () => {
                                  const res = await api.post(
                                    `/admin/daily-rewards/reset-timer?target_username=${encodeURIComponent(username)}`
                                  );
                                  toast.success(res.data?.message || 'Reset');
                                })
                              }
                            >
                              {actionLoading.resetDailyRewards ? '…' : 'Reset'}
                            </button>
                          </ToolRow>
                          <ToolRow label="Clear bodyguards">
                            <button
                              type="button"
                              className={btnClass}
                              disabled={actionLoading.clearBodyguards}
                              onClick={() =>
                                runAction('clearBodyguards', async () => {
                                  const res = await api.post(
                                    `/admin/bodyguards/clear?target_username=${encodeURIComponent(username)}`
                                  );
                                  toast.success(res.data?.message || 'Cleared');
                                })
                              }
                            >
                              {actionLoading.clearBodyguards ? '…' : 'Clear'}
                            </button>
                          </ToolRow>
                        </div>
                      </Section>
                    </>
                  )}

                  <Section title="Info & logs">
                    <div className="col-span-2 space-y-1">
                      <ToolRow label="View registration">
                        <button
                          type="button"
                          className={btnClass}
                          disabled={registrationLoading}
                          onClick={async () => {
                            setRegistrationLoading(true);
                            setRegistrationInfo(null);
                            try {
                              const res = await api.get('/admin/user-registration', {
                                params: { target_username: username },
                              });
                              setRegistrationInfo(res.data?.user ?? null);
                              if (!res.data?.user) toast.info('No registration data');
                            } catch (e) {
                              toast.error(e.response?.data?.detail || 'Failed');
                            } finally {
                              setRegistrationLoading(false);
                            }
                          }}
                        >
                          {registrationLoading ? '…' : 'View'}
                        </button>
                      </ToolRow>
                      {registrationInfo && (
                        <div className="col-span-2 py-2 px-2 rounded border border-zinc-700/50 bg-zinc-900/30 text-[9px] font-mono space-y-0.5">
                          <div>IP: {registrationInfo.registration_ip ?? '—'}</div>
                          <div>UA: {(registrationInfo.registration_ua || '').slice(0, 80)}…</div>
                          {registrationInfo.registered_at && (
                            <div>
                              At:{' '}
                              {formatDateTime(registrationInfo.registered_at)}
                            </div>
                          )}
                        </div>
                      )}
                      <ToolRow label="Sessions">
                        <button
                          type="button"
                          className={btnClass}
                          disabled={sessionsLoading}
                          onClick={async () => {
                            setSessionsLoading(true);
                            setSessions(null);
                            try {
                              const res = await api.get('/admin/user-sessions', {
                                params: { target_username: username },
                              });
                              setSessions(res.data?.sessions ?? []);
                              toast.success(
                                (res.data?.sessions?.length || 0)
                                  ? `${res.data.sessions.length} session(s)`
                                  : 'No sessions'
                              );
                            } catch (e) {
                              toast.error(e.response?.data?.detail || 'Failed');
                              setSessions([]);
                            } finally {
                              setSessionsLoading(false);
                            }
                          }}
                        >
                          {sessionsLoading ? '…' : 'View'}
                        </button>
                      </ToolRow>
                      {sessions && (
                        <div className="col-span-2 space-y-1">
                          {sessions.length === 0 ? (
                            <div className="text-[9px] text-mutedForeground">No sessions</div>
                          ) : (
                            sessions.map((s) => (
                              <div
                                key={s.id}
                                className="flex items-center justify-between gap-2 py-1 px-2 rounded border border-zinc-700/50 bg-zinc-900/30 text-[9px]"
                              >
                                <span className="truncate">
                                  {s.ip || '—'} · {s.device || '—'} ·{' '}
                                  {s.last_used_at
                                    ? formatDateTime(s.last_used_at)
                                    : '—'}
                                </span>
                                <button
                                  type="button"
                                  className="text-red-400 hover:underline text-[8px]"
                                  onClick={() => {
                                    if (
                                      !window.confirm('Revoke this session?')
                                    )
                                      return;
                                    api
                                      .post('/admin/sessions/revoke', {
                                        target_username: username,
                                        session_id: s.id,
                                      })
                                      .then(() => {
                                        toast.success('Revoked');
                                        setSessions((prev) =>
                                          prev.filter((x) => x.id !== s.id)
                                        );
                                        onActionDone?.();
                                      })
                                      .catch((e) =>
                                        toast.error(e.response?.data?.detail || 'Failed')
                                      );
                                  }}
                                >
                                  Revoke
                                </button>
                              </div>
                            ))
                          )}
                        </div>
                      )}
                      <ToolRow label="Activity log">
                        <Link
                          to="/admin"
                          state={{ activityLogUsername: username }}
                          className={btnClass}
                        >
                          Open in Admin
                        </Link>
                      </ToolRow>
                      <ToolRow label="Gambling log">
                        <Link
                          to="/admin"
                          state={{ gamblingLogUsername: username }}
                          className={btnClass}
                        >
                          Open in Admin
                        </Link>
                      </ToolRow>
                    </div>
                  </Section>
                </>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
