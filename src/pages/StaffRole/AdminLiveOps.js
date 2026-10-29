import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, RefreshCw, Radio } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../utils/api';
import {
  AdminPage, Badge, Button, Card, DataTable, ErrorBlock, KpiGrid, KpiTile, LoadingBlock, Segmented, Tabs,
  fmtCash, fmtDateTime, fmtNum,
} from './kit/AdminKit';
import { CASINO_GAME_TYPES, CLAIM_COST_FIELDS, PAGE_LOCK_PATHS } from './adminLiveOpsConfig';

const ADMIN_BASE = '/tjjeujr3wa';

function errText(e, fallback) {
  const d = e?.response?.data?.detail;
  if (typeof d === 'string') return d;
  if (Array.isArray(d) && d.length) return d.map((x) => x.msg).join('; ');
  return fallback;
}

const toInt = (v) => parseInt(String(v ?? '').replace(/[^\d]/g, ''), 10) || 0;
const withCommas = (v) => (v === '' || v == null ? '' : toInt(v).toLocaleString());

function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

const fromLocalInput = (v) => (v ? new Date(v).toISOString() : null);

const inputClass = 'h-9 rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-500 focus:outline-none';

function Field({ label, hint, children }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="text-zinc-400">{label}{hint && <span className="text-zinc-500"> · {hint}</span>}</span>
      {children}
    </label>
  );
}

function NumberInput({ value, onChange, ...rest }) {
  return <input value={withCommas(value)} onChange={(e) => onChange(toInt(e.target.value))} inputMode="numeric" className={`${inputClass} tabular-nums`} {...rest} />;
}

function Toggle({ on, onChange, disabled, labels = ['Off', 'On'] }) {
  return (
    <Segmented
      size="sm"
      value={on ? 'on' : 'off'}
      onChange={(v) => !disabled && onChange(v === 'on')}
      options={[{ value: 'off', label: labels[0] }, { value: 'on', label: labels[1] }]}
    />
  );
}

/* ---------- Events ---------- */

function EventsTab() {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const { data } = await api.get('/admin/events');
      setState({ loading: false, data, error: null });
    } catch (e) {
      setState({ loading: false, data: null, error: errText(e, 'Could not load events') });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggle = async () => {
    const next = !state.data?.events_enabled;
    if (!window.confirm(next ? 'Turn game events on?' : 'Turn game events off for everyone?')) return;
    setBusy(true);
    try {
      const { data } = await api.post('/admin/events/toggle', { enabled: next });
      toast.success(data?.message || 'Updated');
      load();
    } catch (e) {
      toast.error(errText(e, 'Failed'));
    } finally {
      setBusy(false);
    }
  };

  const rotate = async () => {
    if (!window.confirm('Roll new events now? The current ones end immediately.')) return;
    setBusy(true);
    try {
      const { data } = await api.post('/admin/events/force-rotate');
      toast.success(data?.message || 'New events rolled');
      load();
    } catch (e) {
      toast.error(errText(e, 'Failed'));
    } finally {
      setBusy(false);
    }
  };

  if (state.loading && !state.data) return <LoadingBlock />;
  if (state.error) return <ErrorBlock message={state.error} onRetry={load} />;
  const d = state.data;
  const active = new Set(d.active_event_ids || []);
  const activeNames = (d.pool || []).filter((e) => active.has(e.id)).map((e) => e.name);
  return (
    <div className="space-y-4">
      <KpiGrid cols={3}>
        <KpiTile label="Events" value={d.events_enabled ? 'On' : 'Off'} tone={d.events_enabled ? 'good' : 'bad'} />
        <KpiTile label="Running now" value={activeNames.length ? activeNames.join(' + ') : 'None'} />
        <KpiTile label="Ends" value={d.expires_at ? fmtDateTime(d.expires_at) : '—'} hint={d.duration_hours ? `${Number(d.duration_hours).toFixed(1)}h round` : undefined} />
      </KpiGrid>
      <Card
        title="Event rotation"
        subtitle="Events rotate on their own: one or two positive events at a time, lasting 1 to 24 hours."
        actions={(
          <>
            <Button size="sm" variant={d.events_enabled ? 'danger' : 'primary'} loading={busy} onClick={toggle}>{d.events_enabled ? 'Turn off' : 'Turn on'}</Button>
            <Button size="sm" disabled={!d.events_enabled} loading={busy} onClick={rotate}>Roll new events now</Button>
            <Button size="sm" icon={RefreshCw} onClick={load}>Refresh</Button>
          </>
        )}
        padded={false}
      >
        <DataTable
          rows={d.pool || []}
          pageSize={30}
          rowKey={(r) => r.id}
          columns={[
            { key: 'name', label: 'Event', render: (r) => <span className="text-zinc-100">{r.name}</span> },
            { key: 'message', label: 'What players see', sortable: false, render: (r) => <span className="text-xs text-zinc-400">{r.message || '—'}</span> },
            { key: 'active', label: '', sortValue: (r) => (active.has(r.id) ? 1 : 0), render: (r) => (active.has(r.id) ? <Badge tone="good">Running</Badge> : null) },
          ]}
        />
      </Card>
    </div>
  );
}

/* ---------- Casinos ---------- */

function GlobalCapsCard({ settings, onSaved }) {
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (settings) {
      setForm({
        casino_global_max_bet: settings.casino_global_max_bet ?? 1_000_000_000,
        casino_buyback_max_points: settings.casino_buyback_max_points ?? 15_000,
        mp_poker_max_blind: settings.mp_poker_max_blind ?? 2_500_000,
      });
    }
  }, [settings]);

  if (!form) return <Card title="Global caps"><LoadingBlock /></Card>;
  const save = async () => {
    setBusy(true);
    try {
      await api.patch('/admin/settings', {
        casino_global_max_bet: Math.max(50_000, toInt(form.casino_global_max_bet)),
        casino_buyback_max_points: Math.max(0, toInt(form.casino_buyback_max_points)),
        mp_poker_max_blind: Math.max(1_000, toInt(form.mp_poker_max_blind)),
      });
      toast.success('Casino caps saved');
      onSaved();
    } catch (e) {
      toast.error(errText(e, 'Save failed'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Global caps" subtitle="Owners can never set their casino above these.">
      <div className="grid gap-3">
        <Field label="Max bet, every casino ($)" hint="minimum $50,000"><NumberInput value={form.casino_global_max_bet} onChange={(v) => setForm({ ...form, casino_global_max_bet: v })} /></Field>
        <Field label="Casino buy-back, max points"><NumberInput value={form.casino_buyback_max_points} onChange={(v) => setForm({ ...form, casino_buyback_max_points: v })} /></Field>
        <Field label="Multiplayer poker, max blind ($)"><NumberInput value={form.mp_poker_max_blind} onChange={(v) => setForm({ ...form, mp_poker_max_blind: v })} /></Field>
        <div><Button variant="primary" loading={busy} onClick={save}>Save caps</Button></div>
      </div>
    </Card>
  );
}

function ClaimCostsCard() {
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/admin/claim-costs');
      setForm(Object.fromEntries(CLAIM_COST_FIELDS.map(({ key }) => [key, toInt(data?.[key])])));
    } catch (e) {
      toast.error(errText(e, 'Could not load claim costs'));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setBusy(true);
    try {
      const { data } = await api.patch('/admin/claim-costs', Object.fromEntries(CLAIM_COST_FIELDS.map(({ key }) => [key, toInt(form[key])])));
      setForm(Object.fromEntries(CLAIM_COST_FIELDS.map(({ key }) => [key, toInt(data?.[key])])));
      toast.success('Claim costs saved');
    } catch (e) {
      toast.error(errText(e, 'Save failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Claim costs" subtitle="What it costs to claim an unowned property. 0 = free.">
      {!form ? <LoadingBlock /> : (
        <div className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            {CLAIM_COST_FIELDS.map(({ key, label }) => (
              <Field key={key} label={label}><NumberInput value={form[key]} onChange={(v) => setForm({ ...form, [key]: v })} /></Field>
            ))}
          </div>
          <div className="flex gap-2">
            <Button variant="primary" loading={busy} onClick={save}>Save claim costs</Button>
            <Button variant="ghost" onClick={load}>Reload</Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function MaxBetsCard({ globalCap }) {
  const [rows, setRows] = useState(null);
  const [game, setGame] = useState('all');
  const [location, setLocation] = useState('');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('all');

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/admin/casino-max-bets');
      const flat = [];
      Object.entries(data || {}).forEach(([g, list]) => (list || []).forEach((r) => flat.push({ game: g, ...r })));
      setRows(flat);
    } catch (e) {
      toast.error(errText(e, 'Could not load max bets'));
      setRows([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const locations = useMemo(() => [...new Set((rows || []).map((r) => r.location).filter(Boolean))].sort(), [rows]);
  const gameLabel = (g) => CASINO_GAME_TYPES.find((x) => x.value === g)?.label || g;

  const submit = async () => {
    const n = toInt(value);
    if (n < 1) return;
    const where = location ? `in ${location}` : 'in every city';
    const what = game === 'all' ? 'every casino game' : `all ${gameLabel(game)} casinos`;
    if (!window.confirm(`Set max bet to $${n.toLocaleString()} for ${what} ${where}? This overrides what owners have set.`)) return;
    setBusy(true);
    try {
      const { data } = await api.post('/admin/set-casino-max-bet', { game_type: game, location: location || null, max_bet: n });
      toast.success(data?.message || 'Max bet updated');
      setValue('');
      load();
    } catch (e) {
      toast.error(errText(e, 'Failed'));
    } finally {
      setBusy(false);
    }
  };

  const shown = (rows || []).filter((r) => filter === 'all' || r.game === filter);
  return (
    <Card title="Max bet by game and city" subtitle="Overrides the max bet owners have set. The global cap still applies on top." padded={false}>
      <div className="flex flex-wrap items-end gap-2 border-b border-zinc-800 p-4">
        <Field label="Game">
          <select value={game} onChange={(e) => setGame(e.target.value)} className={inputClass}>
            <option value="all">All games</option>
            {CASINO_GAME_TYPES.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
          </select>
        </Field>
        <Field label="City / state">
          <select value={location} onChange={(e) => setLocation(e.target.value)} className={inputClass}>
            <option value="">Everywhere</option>
            {locations.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </Field>
        <Field label="New max bet ($)">
          <input value={withCommas(value)} onChange={(e) => setValue(e.target.value)} inputMode="numeric" placeholder="50,000,000" className={`${inputClass} w-40 tabular-nums`} />
        </Field>
        <Button variant="primary" disabled={toInt(value) < 1} loading={busy} onClick={submit}>Set max bet</Button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
        <Segmented size="sm" value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All' }, ...CASINO_GAME_TYPES]} />
        <Button size="sm" icon={RefreshCw} onClick={load}>Refresh</Button>
      </div>
      {!rows ? <LoadingBlock /> : (
        <DataTable
          rows={shown}
          pageSize={20}
          empty="No casinos."
          columns={[
            { key: 'game', label: 'Game', render: (r) => gameLabel(r.game) },
            { key: 'location', label: 'City / state' },
            { key: 'owner', label: 'Owner', render: (r) => (r.owner ? <Link to={`${ADMIN_BASE}/player?u=${encodeURIComponent(r.owner)}`} className="text-zinc-200 hover:underline">{r.owner}</Link> : <span className="text-zinc-500">Unowned</span>) },
            {
              key: 'max_bet',
              label: 'Max bet',
              align: 'right',
              sortValue: (r) => Number(r.max_bet || 0),
              render: (r) => (
                <span className="inline-flex items-center gap-1.5">
                  {globalCap && Number(r.max_bet) > globalCap && <Badge tone="warn">capped at {fmtCash(globalCap)}</Badge>}
                  {r.max_bet != null ? fmtCash(r.max_bet) : '—'}
                </span>
              ),
            },
          ]}
        />
      )}
    </Card>
  );
}

function CasinosTab({ settings, reloadSettings }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <GlobalCapsCard settings={settings} onSaved={reloadSettings} />
        <ClaimCostsCard />
      </div>
      <MaxBetsCard globalCap={settings?.casino_global_max_bet} />
    </div>
  );
}

/* ---------- Banners & locks ---------- */

function MaintenanceBannerCard() {
  const [d, setD] = useState(null);
  const [msg, setMsg] = useState('');
  const [mins, setMins] = useState(60);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/admin/maintenance-banner');
      setD(data || { enabled: false });
      if (data?.message) setMsg(data.message);
      if (data?.duration_minutes) setMins(data.duration_minutes);
    } catch (e) {
      toast.error(errText(e, 'Could not load maintenance banner'));
      setD({ enabled: false });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const set = async (enabled) => {
    setBusy(true);
    try {
      const { data } = await api.post('/admin/maintenance-banner', { enabled, message: msg.trim() || 'Scheduled maintenance in progress.', duration_minutes: Math.min(1440, Math.max(5, Number(mins) || 60)) });
      setD(data);
      toast.success(data?.message || 'Updated');
    } catch (e) {
      toast.error(errText(e, 'Failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Maintenance banner" subtitle="Shown to every player in the game with a countdown." actions={d && (d.enabled ? <Badge tone="warn">On</Badge> : <Badge>Off</Badge>)}>
      {!d ? <LoadingBlock /> : (
        <div className="grid gap-3">
          <Field label="Message"><input value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Scheduled maintenance in progress." className={inputClass} /></Field>
          <Field label="Countdown length (minutes)" hint="5 to 1,440"><input type="number" min={5} max={1440} value={mins} onChange={(e) => setMins(e.target.value)} className={`${inputClass} w-32`} /></Field>
          {d.enabled && d.set_by && <p className="text-xs text-zinc-500">Turned on by {d.set_by} · {fmtDateTime(d.set_at)}</p>}
          <div className="flex gap-2">
            <Button variant="primary" loading={busy} onClick={() => set(true)}>{d.enabled ? 'Update banner' : 'Show banner'}</Button>
            {d.enabled && <Button variant="danger" loading={busy} onClick={() => set(false)}>Hide banner</Button>}
          </div>
        </div>
      )}
    </Card>
  );
}

function LoginPageCard({ settings, onSaved }) {
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (settings) {
      setForm({
        landing_banner_enabled: !!settings.landing_banner_enabled,
        landing_banner_message: settings.landing_banner_message || '',
        login_lock_from: toLocalInput(settings.login_lock_from),
        login_lock_until: toLocalInput(settings.login_lock_until),
        login_lock_message: settings.login_lock_message || '',
        preregister_landing_banner_enabled: settings.preregister_landing_banner_enabled !== false,
        preregister_landing_banner_preview_open: !!settings.preregister_landing_banner_preview_open,
      });
    }
  }, [settings]);

  if (!form) return <Card title="Login page"><LoadingBlock /></Card>;
  const patch = async (body, okMsg) => {
    setBusy(true);
    try {
      await api.patch('/admin/settings', body);
      toast.success(okMsg);
      onSaved();
    } catch (e) {
      toast.error(errText(e, 'Save failed'));
    } finally {
      setBusy(false);
    }
  };
  const locked = !!(settings.login_lock_from || settings.login_lock_until);
  const now = Date.now();
  const fromMs = settings.login_lock_from ? Date.parse(settings.login_lock_from) : null;
  const untilMs = settings.login_lock_until ? Date.parse(settings.login_lock_until) : null;
  const lockBadge = !locked ? null
    : untilMs && untilMs <= now ? <Badge>Lock expired</Badge>
      : fromMs && fromMs > now ? <Badge tone="info">Lock scheduled</Badge>
        : <Badge tone="warn">Logins locked</Badge>;
  return (
    <Card title="Login page" subtitle="The banner and launch lock on the public login page." actions={lockBadge}>
      <div className="grid gap-5">
        <div className="grid gap-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-zinc-300">Beta / release banner</span>
            <Toggle on={form.landing_banner_enabled} onChange={(v) => setForm({ ...form, landing_banner_enabled: v })} />
          </div>
          <textarea
            value={form.landing_banner_message}
            onChange={(e) => setForm({ ...form, landing_banner_message: e.target.value })}
            rows={3}
            placeholder="Banner message (new lines allowed)"
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-500 focus:outline-none"
          />
          <div>
            <Button loading={busy} onClick={() => patch({ landing_banner_enabled: form.landing_banner_enabled, landing_banner_message: form.landing_banner_message }, 'Login banner saved')}>Save banner</Button>
          </div>
        </div>
        <div className="grid gap-3 border-t border-zinc-800 pt-4">
          <span className="text-sm text-zinc-300">Launch lock</span>
          <p className="text-xs text-zinc-500">Blocks player logins between these times. People can still register, and staff can use the staff login.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="From"><input type="datetime-local" value={form.login_lock_from} onChange={(e) => setForm({ ...form, login_lock_from: e.target.value })} className={inputClass} /></Field>
            <Field label="Until"><input type="datetime-local" value={form.login_lock_until} onChange={(e) => setForm({ ...form, login_lock_until: e.target.value })} className={inputClass} /></Field>
          </div>
          <Field label="Message on the login page"><input value={form.login_lock_message} onChange={(e) => setForm({ ...form, login_lock_message: e.target.value })} className={inputClass} /></Field>
          <div className="flex gap-2">
            <Button
              loading={busy}
              onClick={() => {
                if (!window.confirm('Save the launch lock? Players will not be able to log in during this window.')) return;
                patch({ login_lock_from: fromLocalInput(form.login_lock_from) || '', login_lock_until: fromLocalInput(form.login_lock_until) || '', login_lock_message: form.login_lock_message || '' }, 'Launch lock saved');
              }}
            >
              Save lock
            </Button>
            {locked && <Button variant="danger" loading={busy} onClick={() => patch({ login_lock_from: '', login_lock_until: '', login_lock_message: '' }, 'Launch lock cleared')}>Clear lock</Button>}
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-zinc-400">Pre-register strip during the lock (founding member, referral note, countdown)</span>
            <Toggle on={form.preregister_landing_banner_enabled} disabled={busy} onChange={(v) => patch({ preregister_landing_banner_enabled: v }, v ? 'Pre-register strip on' : 'Pre-register strip off')} />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-zinc-400">Also show the strip while logins are open (preview, no countdown)</span>
            <Toggle on={form.preregister_landing_banner_preview_open} disabled={busy || !form.preregister_landing_banner_enabled} onChange={(v) => patch({ preregister_landing_banner_preview_open: v }, v ? 'Preview on' : 'Preview off')} />
          </div>
        </div>
      </div>
    </Card>
  );
}

function PageLocksCard() {
  const [locks, setLocks] = useState(null);
  const [filter, setFilter] = useState('');
  const [message, setMessage] = useState('');
  const [until, setUntil] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/admin/page-locks');
      setLocks(data?.paths || {});
    } catch (e) {
      toast.error(errText(e, 'Could not load page locks'));
      setLocks({});
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const set = async (path, locked) => {
    setBusy(true);
    try {
      await api.patch('/admin/page-locks', { path, locked, message: message.trim() || 'Down for maintenance', unlock_at: locked ? fromLocalInput(until) : null });
      toast.success(locked ? `Locked ${path}` : `Unlocked ${path}`);
      load();
    } catch (e) {
      toast.error(errText(e, 'Failed'));
    } finally {
      setBusy(false);
    }
  };

  const allPaths = useMemo(() => [...new Set([...PAGE_LOCK_PATHS, ...Object.keys(locks || {})])], [locks]);
  const q = filter.trim().toLowerCase();
  const rows = allPaths
    .filter((p) => !q || p.includes(q))
    .map((p) => ({ path: p, lock: locks?.[p] || null }));
  const lockedCount = Object.keys(locks || {}).length;

  return (
    <Card
      title="Page locks"
      subtitle="Locked pages show your message to players. Staff can still open them."
      actions={lockedCount ? <Badge tone="warn">{lockedCount} locked</Badge> : <Badge>None locked</Badge>}
      padded={false}
    >
      <div className="grid gap-3 border-b border-zinc-800 p-4 sm:grid-cols-3">
        <Field label="Message for new locks"><input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Down for maintenance" className={inputClass} /></Field>
        <Field label="Unlock automatically at" hint="optional"><input type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} className={inputClass} /></Field>
        <Field label="Find a page"><input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="/casino" className={inputClass} /></Field>
      </div>
      {!locks ? <LoadingBlock /> : (
        <DataTable
          rows={rows}
          rowKey={(r) => r.path}
          pageSize={15}
          initialSort={{ key: 'status', dir: 'desc' }}
          columns={[
            { key: 'path', label: 'Page', render: (r) => <span className="font-mono text-xs">{r.path}</span> },
            { key: 'status', label: 'Status', sortValue: (r) => (r.lock ? 1 : 0), render: (r) => (r.lock ? <Badge tone="warn">Locked</Badge> : <span className="text-xs text-zinc-500">Open</span>) },
            { key: 'message', label: 'Message', sortable: false, render: (r) => <span className="text-xs text-zinc-400">{r.lock?.message || ''}</span> },
            { key: 'unlock_at', label: 'Unlocks', sortable: false, render: (r) => (r.lock?.unlock_at ? fmtDateTime(r.lock.unlock_at) : '') },
            {
              key: 'action',
              label: '',
              sortable: false,
              render: (r) => (r.lock
                ? <Button size="sm" disabled={busy} onClick={() => set(r.path, false)}>Unlock</Button>
                : <Button size="sm" variant="ghost" disabled={busy} onClick={() => set(r.path, true)}>Lock</Button>),
            },
          ]}
        />
      )}
    </Card>
  );
}

function BannersTab({ settings, reloadSettings }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <MaintenanceBannerCard />
        <LoginPageCard settings={settings} onSaved={reloadSettings} />
      </div>
      <PageLocksCard />
    </div>
  );
}

/* ---------- Other ---------- */

const OTHER_TOOLS = [
  { to: 'last-man-standing', label: 'Last Man Standing' },
  { to: 'liveops', label: 'Lottery audit, booze run, Game Pass season, World Cup archive (classic)' },
  { to: 'commerce', label: 'Store rollout, pre-orders, redeem codes (classic)' },
  { to: 'revenue', label: 'Revenue' },
];

function OtherTab() {
  return (
    <Card title="More live tools" subtitle="Still in the classic hub while they are rebuilt.">
      <div className="flex flex-wrap gap-2">
        {OTHER_TOOLS.map((t) => (
          <Link key={t.to} to={`${ADMIN_BASE}/${t.to}`}><Button size="sm" icon={ExternalLink}>{t.label}</Button></Link>
        ))}
      </div>
    </Card>
  );
}

const TABS = [
  { id: 'events', label: 'Events' },
  { id: 'casinos', label: 'Casinos' },
  { id: 'banners', label: 'Banners & page locks' },
  { id: 'other', label: 'More' },
];

export default function AdminLiveOps() {
  const [tab, setTab] = useState('events');
  const [settings, setSettings] = useState(null);
  const [settingsError, setSettingsError] = useState(null);

  const loadSettings = useCallback(async () => {
    try {
      const { data } = await api.get('/admin/settings');
      setSettings(data);
      setSettingsError(null);
    } catch (e) {
      setSettingsError(errText(e, 'Could not load settings'));
    }
  }, []);

  useEffect(() => { loadSettings(); }, [loadSettings]);

  return (
    <AdminPage title="Live Ops" subtitle="Events, casino limits, banners and page locks." icon={Radio}>
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      {settingsError && (tab === 'casinos' || tab === 'banners') && <ErrorBlock message={settingsError} onRetry={loadSettings} />}
      {tab === 'events' && <EventsTab />}
      {tab === 'casinos' && <CasinosTab settings={settings} reloadSettings={loadSettings} />}
      {tab === 'banners' && <BannersTab settings={settings} reloadSettings={loadSettings} />}
      {tab === 'other' && <OtherTab />}
    </AdminPage>
  );
}
