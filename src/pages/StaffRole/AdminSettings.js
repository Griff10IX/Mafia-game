import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, RefreshCw, Settings2 } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../utils/api';
import { AdminPage, Badge, Button, Card, ErrorBlock, LoadingBlock, Segmented, Tabs, fmtNum } from './kit/AdminKit';

const ADMIN_BASE = '/tjjeujr3wa';

/**
 * Settings saved through PATCH /admin/settings, split into pages. Each page only sends the fields you changed.
 * type: bool | int | float | text | color | datetime | select | lines
 */
const SECTIONS = [
  {
    id: 'checks',
    label: 'Bot & login checks',
    groups: [
      {
        title: 'Login and sign-up',
        fields: [
          { key: 'require_email_verification', label: 'Require email verification', type: 'bool' },
          { key: 'block_proxy_vpn_login', label: 'Block proxy / VPN logins', type: 'bool' },
          { key: 'block_script_user_agent_login', label: 'Block script-like browsers on login and minigames', type: 'bool' },
          { key: 'login_turnstile_enabled', label: 'Cloudflare check on login', type: 'bool' },
        ],
      },
      {
        title: 'Game actions',
        fields: [
          { key: 'block_script_user_agent_game_actions', label: 'Block script-like browsers on crimes, GTA, jail, OC, bodyguards, attack', type: 'bool' },
          { key: 'game_actions_client_strict', label: 'Strict browser headers on game actions', type: 'bool' },
          { key: 'game_actions_turnstile_enabled', label: 'Cloudflare check on GTA melt and booze sell', type: 'bool' },
          { key: 'ent_join_turnstile_enabled', label: 'Cloudflare check on E-Game joins', type: 'bool' },
          { key: 'minigame_turnstile_enabled', label: 'Cloudflare check before minigame runs', type: 'bool' },
          { key: 'minigame_turnstile_site_key', label: 'Cloudflare site key (public)', type: 'text' },
        ],
      },
      {
        title: 'Attack page check',
        fields: [
          { key: 'attack_turnstile_enabled', label: 'Cloudflare check on the attack page', type: 'bool' },
          { key: 'attack_turnstile_master_disabled', label: 'Emergency off switch', type: 'bool' },
          { key: 'attack_turnstile_mode', label: 'When to check', type: 'select', options: [{ value: 'execute_only', label: 'On attack only' }, { value: 'search_and_execute', label: 'Search and attack' }, { value: 'risk_based', label: 'Risk based' }] },
          { key: 'attack_turnstile_enforce', label: 'What happens on fail', type: 'select', options: [{ value: 'off', label: 'Nothing' }, { value: 'log_only', label: 'Log only' }, { value: 'enforce', label: 'Block' }] },
          { key: 'attack_turnstile_target_usernames', label: 'Only these players (one per line, empty = everyone)', type: 'lines' },
        ],
      },
      {
        title: 'Request rate cap',
        fields: [
          { key: 'user_request_pace_enabled', label: 'Cap requests per player per second', type: 'bool' },
          { key: 'user_request_pace_limit', label: 'Requests per second', type: 'int', min: 5, max: 100 },
        ],
      },
    ],
  },
  {
    id: 'pacing',
    label: 'Page pacing',
    intro: 'Slows players who hammer a page too fast in a row. Each switch covers one area of the game.',
    groups: [
      {
        title: 'Attack pacing',
        fields: [
          { key: 'sustained_page_rl_kill_enabled', label: 'Attack / kill requests', type: 'bool' },
          { key: 'sustained_page_rl_kill_max_gap_ms', label: 'Max gap between attacks in a chain (ms)', type: 'float', min: 50, max: 2000 },
          { key: 'sustained_page_rl_kill_sustain_sec', label: 'Seconds of chain before cooldown', type: 'float', min: 3, max: 120 },
        ],
      },
      { title: 'Areas', dynamic: (s) => Object.keys(s).filter((k) => /^sustained_page_rl_.+_enabled$/.test(k) && k !== 'sustained_page_rl_kill_enabled').sort() },
    ],
  },
  {
    id: 'economy',
    label: 'Economy limits',
    groups: [
      {
        title: 'Limits',
        fields: [
          { key: 'stock_market_max_points', label: 'Stock market: max points', type: 'int', min: 1 },
          { key: 'sports_bet_max_total_open_stake', label: 'Sports betting: max open stake per player ($)', type: 'int', min: 1 },
          { key: 'vip_pass_car_purchase_limit', label: 'VIP Pass cars for sale, game-wide', type: 'int', min: 0 },
        ],
      },
      {
        title: 'Bank',
        fields: [
          { key: 'bank_swiss_default_limit', label: 'Swiss bank default limit ($)', type: 'int', min: 1000 },
          { key: 'bank_interest_max_unclaimed_principal', label: 'Interest bank: max unclaimed deposits per player ($)', type: 'int', min: 1 },
        ],
        note: 'Interest rates and terms, and applying the Swiss limit to everyone, are in the classic Live Ops hub.',
      },
    ],
  },
  {
    id: 'store',
    label: 'Store',
    groups: [
      {
        title: 'Points purchases',
        fields: [
          { key: 'store_points_auto_credit', label: 'Credit points automatically after payment', type: 'bool' },
          { key: 'store_points_manual_credit_eta', label: 'When manual credits will arrive (shown to players)', type: 'datetime' },
          { key: 'store_points_event_enabled', label: 'Points sale bonus', type: 'bool' },
          { key: 'preorder_points_release_date', label: 'Pre-order points release date', type: 'datetime' },
        ],
        note: 'Store item rollout switches stay in the classic Commerce hub.',
      },
    ],
  },
  {
    id: 'features',
    label: 'Features & staff',
    groups: [
      {
        title: 'Features',
        fields: [
          { key: 'game_help_chat_enabled', label: 'Game Guide chatbot for all players', type: 'bool' },
          { key: 'spotify_feature_enabled', label: 'Spotify', type: 'bool' },
        ],
      },
      {
        title: 'Staff display',
        fields: [
          { key: 'admin_online_color', label: 'Admin name colour (online list)', type: 'color' },
          { key: 'mod_default_online_color', label: 'Moderator default name colour', type: 'color' },
        ],
        note: 'Which tools moderators can see is set in the classic Staff hub.',
      },
    ],
  },
];

const FIELD_INDEX = Object.fromEntries(SECTIONS.flatMap((s) => s.groups.flatMap((g) => (g.fields || []).map((f) => [f.key, f]))));

const pacingLabel = (key) => key.replace(/^sustained_page_rl_/, '').replace(/_enabled$/, '').replace(/_/g, ' ');

function fieldFor(key) {
  return FIELD_INDEX[key] || { key, label: pacingLabel(key), type: 'bool' };
}

function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

/** Server value -> form value. */
function toForm(f, v) {
  if (f.type === 'bool') return !!v;
  if (f.type === 'lines') return Array.isArray(v) ? v.join('\n') : '';
  if (f.type === 'datetime') return toLocalInput(v);
  if (f.type === 'int' || f.type === 'float') return v == null ? '' : String(v);
  return v ?? '';
}

/** Form value -> request value. Empty datetime sends '' so the server clears it. */
function toRequest(f, v) {
  if (f.type === 'bool') return !!v;
  if (f.type === 'lines') return String(v || '').split(/[\s,;|]+/).map((x) => x.trim()).filter(Boolean).slice(0, 200);
  if (f.type === 'datetime') return v ? new Date(v).toISOString() : '';
  if (f.type === 'int' || f.type === 'float') {
    let n = f.type === 'int' ? parseInt(String(v).replace(/[^\d-]/g, ''), 10) : parseFloat(String(v).replace(/,/g, '.'));
    if (!Number.isFinite(n)) n = f.min ?? 0;
    if (f.min != null) n = Math.max(f.min, n);
    if (f.max != null) n = Math.min(f.max, n);
    return n;
  }
  return String(v ?? '').trim();
}

function display(f, v) {
  if (f.type === 'bool') return v ? 'on' : 'off';
  if (f.type === 'int' && v !== '') return fmtNum(v);
  if (v === '' || v == null) return '(empty)';
  return String(v).length > 40 ? `${String(v).slice(0, 40)}…` : String(v);
}

const inputClass = 'h-9 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-500 focus:outline-none';

function FieldInput({ f, value, onChange }) {
  if (f.type === 'bool') {
    return <Segmented size="sm" value={value ? 'on' : 'off'} onChange={(v) => onChange(v === 'on')} options={[{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }]} />;
  }
  if (f.type === 'select') {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} className={`${inputClass} sm:w-56`}>
        {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  }
  if (f.type === 'lines') {
    return <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={3} className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-zinc-500 focus:outline-none sm:w-72" />;
  }
  if (f.type === 'color') {
    return (
      <div className="flex items-center gap-2">
        <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'} onChange={(e) => onChange(e.target.value)} className="h-9 w-12 cursor-pointer rounded border border-zinc-700 bg-zinc-950" />
        <input value={value} onChange={(e) => onChange(e.target.value)} className={`${inputClass} w-28 font-mono`} />
      </div>
    );
  }
  if (f.type === 'datetime') {
    return <input type="datetime-local" value={value} onChange={(e) => onChange(e.target.value)} className={`${inputClass} sm:w-56`} />;
  }
  const numeric = f.type === 'int' || f.type === 'float';
  const shown = f.type === 'int' && value !== '' ? Number(String(value).replace(/[^\d-]/g, '') || 0).toLocaleString() : value;
  return (
    <input
      value={shown}
      onChange={(e) => onChange(f.type === 'int' ? e.target.value.replace(/[^\d-]/g, '') : e.target.value)}
      inputMode={numeric ? 'decimal' : undefined}
      className={`${inputClass} ${numeric ? 'tabular-nums sm:w-56' : 'sm:w-72'}`}
    />
  );
}

function SectionView({ section, settings, onSaved }) {
  const keys = useMemo(
    () => section.groups.flatMap((g) => (g.dynamic ? g.dynamic(settings) : g.fields.map((f) => f.key))).filter((k) => k in settings),
    [section, settings],
  );
  const initial = useMemo(() => Object.fromEntries(keys.map((k) => [k, toForm(fieldFor(k), settings[k])])), [keys, settings]);
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setForm(initial); }, [initial]);

  const changed = keys.filter((k) => JSON.stringify(form[k]) !== JSON.stringify(initial[k]));

  const save = async () => {
    if (!changed.length) return;
    const lines = changed.map((k) => `• ${fieldFor(k).label}: ${display(fieldFor(k), initial[k])} → ${display(fieldFor(k), form[k])}`);
    if (!window.confirm(`Save ${changed.length} change${changed.length === 1 ? '' : 's'}?\n\n${lines.join('\n')}`)) return;
    setBusy(true);
    try {
      const body = Object.fromEntries(changed.map((k) => [k, toRequest(fieldFor(k), form[k])]));
      await api.patch('/admin/settings', body);
      toast.success(`Saved ${changed.length} setting${changed.length === 1 ? '' : 's'}`);
      onSaved();
    } catch (e) {
      const d = e?.response?.data?.detail;
      toast.error(typeof d === 'string' ? d : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {section.intro && <p className="text-sm text-zinc-400">{section.intro}</p>}
      <div className="grid gap-4 xl:grid-cols-2">
        {section.groups.map((g) => {
          const groupKeys = (g.dynamic ? g.dynamic(settings) : g.fields.map((f) => f.key)).filter((k) => k in settings);
          if (!groupKeys.length) return null;
          return (
            <Card key={g.title} title={g.title} subtitle={g.note}>
              <div className={g.dynamic ? 'grid gap-x-6 gap-y-2 sm:grid-cols-2' : 'grid gap-3'}>
                {groupKeys.map((k) => {
                  const f = fieldFor(k);
                  const dirty = changed.includes(k);
                  return (
                    <div key={k} className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                      <span className={`text-sm ${dirty ? 'text-amber-200' : 'text-zinc-300'} ${g.dynamic ? 'capitalize' : ''}`}>
                        {f.label}{f.min != null || f.max != null ? <span className="text-zinc-500"> ({[f.min, f.max].filter((x) => x != null).map((x) => fmtNum(x)).join('–')})</span> : null}
                      </span>
                      <FieldInput f={f} value={form[k]} onChange={(v) => setForm((p) => ({ ...p, [k]: v }))} />
                    </div>
                  );
                })}
              </div>
            </Card>
          );
        })}
      </div>
      <div className="sticky bottom-3 z-10 flex items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900/95 px-4 py-3 backdrop-blur">
        <span className="text-sm text-zinc-400">{changed.length ? <Badge tone="warn">{changed.length} unsaved</Badge> : 'No changes'}</span>
        <div className="flex gap-2">
          <Button variant="ghost" disabled={!changed.length || busy} onClick={() => setForm(initial)}>Discard</Button>
          <Button variant="primary" disabled={!changed.length} loading={busy} onClick={save}>Save changes</Button>
        </div>
      </div>
    </div>
  );
}

export default function AdminSettings() {
  const [tab, setTab] = useState(SECTIONS[0].id);
  const [state, setState] = useState({ loading: true, settings: null, error: null });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const { data } = await api.get('/admin/settings');
      setState({ loading: false, settings: data, error: null });
    } catch (e) {
      const d = e?.response?.data?.detail;
      setState({ loading: false, settings: null, error: typeof d === 'string' ? d : 'Could not load settings' });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const section = SECTIONS.find((s) => s.id === tab);
  return (
    <AdminPage
      title="Settings"
      subtitle="Game-wide switches and limits, one area at a time. Only what you change is saved."
      icon={Settings2}
      actions={(
        <>
          <Link to={`${ADMIN_BASE}/live-ops`}><Button size="sm" icon={ExternalLink}>Casino limits, banners & locks are in Live Ops</Button></Link>
          <Button size="sm" icon={RefreshCw} loading={state.loading} onClick={load}>Reload</Button>
        </>
      )}
    >
      <Tabs tabs={SECTIONS.map((s) => ({ id: s.id, label: s.label }))} value={tab} onChange={setTab} />
      {state.error ? <ErrorBlock message={state.error} onRetry={load} />
        : !state.settings ? <LoadingBlock />
          : <SectionView key={tab} section={section} settings={state.settings} onSaved={load} />}
    </AdminPage>
  );
}
