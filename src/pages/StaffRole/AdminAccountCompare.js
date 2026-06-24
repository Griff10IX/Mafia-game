import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeftRight, Car, Coins, EyeOff, Fingerprint, Link2, RefreshCw, Search, ShieldAlert, Users, Wifi } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../utils/api';
import { formatAdminDateTime } from '../../utils/adminDateTime';
import styles from '../../styles/noir.module.css';
import StaffIpReputationCard, { maskIp } from '../../components/StaffIpReputationCard';

function fmtNum(n) {
  const num = Number(n || 0);
  return Number.isFinite(num) ? num.toLocaleString() : '0';
}

function fmtMoney(n) {
  return `$${fmtNum(n)}`;
}

function safeVal(v) {
  return v === null || v === undefined || v === '' ? '—' : v;
}

function userLabel(user) {
  if (!user) return '—';
  return `${user.username || '?'} (${user.id || 'no id'})`;
}

function severityClass(sev) {
  if (sev === 'critical') return 'border-red-500/45 bg-red-500/10 text-red-100';
  if (sev === 'warn') return 'border-amber-500/45 bg-amber-500/10 text-amber-100';
  return 'border-zinc-700/50 bg-zinc-900/60 text-zinc-200';
}

const ACCOUNT_A_STYLE = {
  badge: 'bg-sky-500/20 text-sky-100 border-sky-500/45',
  border: 'border-sky-500/35 bg-sky-500/5',
  dot: 'bg-sky-400',
  text: 'text-sky-100',
};

const ACCOUNT_B_STYLE = {
  badge: 'bg-amber-500/20 text-amber-100 border-amber-500/45',
  border: 'border-amber-500/35 bg-amber-500/5',
  dot: 'bg-amber-400',
  text: 'text-amber-100',
};

const IP_SOURCE_LABELS = {
  registration: 'Registered from this IP',
  last_login: 'Last login from this IP',
  last_request: 'Last request from this IP',
  login_ips: 'Saved login IP',
  login_history: 'Login history',
  session: 'Session IP',
  attack_attacker: 'Attacked someone from this IP',
  attack_target: 'Was attacked on this IP',
};

function accountSideStyle(side) {
  return side === 'a' ? ACCOUNT_A_STYLE : ACCOUNT_B_STYLE;
}

function accountSideLabel(side, user) {
  const name = user?.username || (side === 'a' ? 'Account A' : 'Account B');
  return side === 'a' ? `Account A — ${name}` : `Account B — ${name}`;
}

function formatIpSources(sources) {
  return (sources || []).map((source) => IP_SOURCE_LABELS[source] || source.replace(/_/g, ' '));
}

function AccountCompareLegend({ userA, userB }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 font-heading">
      {[
        { side: 'a', user: userA },
        { side: 'b', user: userB },
      ].map(({ side, user }) => {
        const style = accountSideStyle(side);
        return (
          <div key={side} className={`rounded-lg border px-3 py-2 ${style.border}`}>
            <div className="flex items-center gap-2 min-w-0">
              <span className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${style.dot}`} />
              <div className="min-w-0">
                <div className={`text-[10px] font-bold uppercase tracking-wider ${style.text}`}>
                  {accountSideLabel(side, user)}
                </div>
                <div className="text-[9px] text-mutedForeground truncate">{user?.email || '—'}</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AccountCard({ side, user, blurIps }) {
  if (!user) return null;
  const style = accountSideStyle(side);
  return (
    <div className={`rounded-lg border p-3 font-heading ${style.border}`}>
      <div className="flex items-center gap-2 mb-2 min-w-0">
        <span className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${style.dot}`} />
        <div className={`text-[9px] uppercase tracking-wider font-bold truncate ${style.text}`}>
          {accountSideLabel(side, user)}
        </div>
      </div>
      <div className="text-sm text-foreground font-bold truncate">{user.username}</div>
      <div className="font-mono text-[9px] text-mutedForeground break-all">{user.id}</div>
      <div className="grid grid-cols-2 gap-2 mt-3 text-[10px]">
        <div>
          <span className="block text-mutedForeground">Email</span>
          <span className="text-foreground break-all">{safeVal(user.email)}</span>
        </div>
        <div>
          <span className="block text-mutedForeground">Created</span>
          <span className="text-foreground">{formatAdminDateTime(user.created_at)}</span>
        </div>
        <div>
          <span className="block text-mutedForeground">Registration IP</span>
          <span className="font-mono text-primary break-all">{blurIps ? maskIp(user.registration_ip) : safeVal(user.registration_ip)}</span>
        </div>
        <div>
          <span className="block text-mutedForeground">Last login IP</span>
          <span className="font-mono text-primary break-all">{blurIps ? maskIp(user.last_login_ip) : safeVal(user.last_login_ip)}</span>
        </div>
        <div>
          <span className="block text-mutedForeground">Device</span>
          <span className="text-foreground">{safeVal(user.last_device_type)}</span>
        </div>
        <div>
          <span className="block text-mutedForeground">Sessions</span>
          <span className="text-foreground">{fmtNum(user.sessions_count)}</span>
        </div>
      </div>
    </div>
  );
}

function SummaryCards({ summary, userA, userB }) {
  if (!summary) return null;
  const cards = [
    { label: 'Shared IPs', value: fmtNum(summary.shared_ip_count), sub: summary.shared_registration_ip ? 'Registration IP matches' : 'Exact address overlap' },
    { label: 'Shared ISPs', value: fmtNum(summary.shared_isp_count), sub: 'Same internet provider, even on different IPs' },
    { label: 'Possible links', value: fmtNum(summary.account_link_count), sub: 'Family, referral, kills, transfers, etc.' },
    { label: 'Cash moved', value: fmtMoney(summary.cash_moved_total), sub: `${fmtMoney(summary.cash_by_direction?.a_to_b)} ${userA?.username || 'A'} -> ${userB?.username || 'B'}` },
    { label: 'Points moved', value: fmtNum(summary.points_moved_total), sub: `${fmtNum(summary.points_by_direction?.a_to_b)} ${userA?.username || 'A'} -> ${userB?.username || 'B'}` },
    { label: 'Quick Trade rows', value: fmtNum(summary.quicktrade_transfer_count), sub: 'Cash/points rows marked as QT' },
  ];
  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-2">
      {cards.map((c) => (
        <div key={c.label} className="rounded-lg border border-primary/20 bg-zinc-950/55 p-3 font-heading">
          <div className="text-[9px] text-mutedForeground uppercase tracking-wider">{c.label}</div>
          <div className="text-lg text-primary font-bold tabular-nums">{c.value}</div>
          <div className="text-[9px] text-zinc-500 truncate">{c.sub}</div>
        </div>
      ))}
    </div>
  );
}

function PossibleLinksSection({ links }) {
  if (!links?.length) {
    return (
      <p className="text-[10px] text-mutedForeground font-heading">
        No direct relationship signals found between these accounts in the selected window.
      </p>
    );
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
      {links.map((link, idx) => (
        <div key={`${link.code}-${idx}`} className={`rounded border px-3 py-2 text-[10px] font-heading ${severityClass(link.severity)}`}>
          <div className="flex items-start gap-2">
            <Link2 size={14} className="shrink-0 mt-0.5 opacity-80" />
            <div>
              <div className="font-bold text-foreground">{link.title || link.code}</div>
              <div className="text-mutedForeground mt-0.5 leading-snug">{link.detail}</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ProviderIpList({ ips, blurIps, style }) {
  if (!ips?.length) return <span className="text-mutedForeground">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {ips.map((ip) => (
        <span key={ip} className={`font-mono text-[8px] rounded px-1 py-0.5 border ${style.border} ${style.text}`}>
          {blurIps ? maskIp(ip) : ip}
        </span>
      ))}
    </div>
  );
}

function SharedProvidersSection({ data, blurIps, userA, userB }) {
  const isps = data?.shared_isps || [];
  const asns = data?.shared_asns || [];
  if (!isps.length && !asns.length) {
    return (
      <p className="text-[10px] text-mutedForeground font-heading">
        No shared internet provider or ASN overlap found from the looked-up IP history.
      </p>
    );
  }

  const renderRow = (row, idx) => {
    const label = row.isp || row.asname || row.as_field || 'Unknown provider';
    const badges = [];
    if (row.same_exact_ip) badges.push('Same IP');
    else if (row.different_ips_same_provider) badges.push('Different IPs, same provider');
    if (row.mobile) badges.push('Mobile');
    if (row.hosting) badges.push('Hosting');
    if (row.proxy) badges.push('Proxy/VPN');

    return (
      <div key={`${label}-${idx}`} className="rounded-lg border border-zinc-700/45 bg-zinc-950/55 p-3 space-y-2 font-heading">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="text-[11px] font-bold text-foreground">{label}</div>
            {row.as_field ? (
              <div className="text-[9px] text-mutedForeground mt-0.5">{row.as_field}{row.asname ? ` · ${row.asname}` : ''}</div>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-1">
            {badges.map((badge) => (
              <span key={badge} className="rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[8px] text-primary uppercase tracking-wide">
                {badge}
              </span>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div className={`rounded border px-2 py-1.5 ${ACCOUNT_A_STYLE.border}`}>
            <div className={`text-[9px] font-bold uppercase mb-1 ${ACCOUNT_A_STYLE.text}`}>
              {userA?.username || 'Account A'}
            </div>
            <ProviderIpList ips={row.user_a_ips} blurIps={blurIps} style={ACCOUNT_A_STYLE} />
          </div>
          <div className={`rounded border px-2 py-1.5 ${ACCOUNT_B_STYLE.border}`}>
            <div className={`text-[9px] font-bold uppercase mb-1 ${ACCOUNT_B_STYLE.text}`}>
              {userB?.username || 'Account B'}
            </div>
            <ProviderIpList ips={row.user_b_ips} blurIps={blurIps} style={ACCOUNT_B_STYLE} />
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-3">
      {data?.lookup_truncated ? (
        <div className="text-[10px] text-amber-300 font-heading rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1">
          Provider lookup capped at {fmtNum(data.lookups_performed)} IP(s). Some provider overlap may be missing.
        </div>
      ) : null}
      {isps.length ? (
        <div className="space-y-2">
          <div className="text-[10px] text-mutedForeground uppercase tracking-wider">Shared internet providers (ISP)</div>
          {isps.map(renderRow)}
        </div>
      ) : null}
      {asns.length ? (
        <div className="space-y-2">
          <div className="text-[10px] text-mutedForeground uppercase tracking-wider">Shared carrier / ASN networks</div>
          {asns.map(renderRow)}
        </div>
      ) : null}
    </div>
  );
}

function SharedIpSection({ rows, blurIps, truncated, userA, userB }) {
  if (!rows?.length) {
    return <p className="text-[10px] text-mutedForeground font-heading">No shared IPs found.</p>;
  }

  const renderAccountEvidence = (side, user, sources) => {
    const style = accountSideStyle(side);
    const labels = formatIpSources(sources);
    return (
      <div className={`rounded border px-2 py-1.5 ${style.border}`}>
        <div className={`text-[9px] font-bold uppercase tracking-wide mb-1 flex items-center gap-1 ${style.text}`}>
          <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${style.dot}`} />
          <span className="truncate">{user?.username || (side === 'a' ? 'Account A' : 'Account B')}</span>
        </div>
        {labels.length ? (
          <ul className="space-y-0.5 text-[9px] text-mutedForeground leading-snug">
            {labels.map((label) => (
              <li key={label} className="flex items-start gap-1">
                <span className="text-primary shrink-0">•</span>
                <span>{label}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-[9px] text-mutedForeground">No linked activity on this IP</div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-2">
      {truncated ? (
        <div className="text-[10px] text-amber-300 font-heading rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1">
          Shared IP list was capped for geodata lookups. Narrow the window if needed.
        </div>
      ) : null}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
        {rows.map((row) => (
          <div key={row.ip} className="space-y-1.5">
            <StaffIpReputationCard ip={row.ip} geo={row} blurIp={blurIps} compact />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {renderAccountEvidence('a', userA, row.user_a_sources)}
              {renderAccountEvidence('b', userB, row.user_b_sources)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DevicesSection({ data, userA, userB }) {
  if (!data) return null;
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-[10px] font-heading">
      <div className={`rounded border p-2 ${data.same_device_fingerprint ? 'border-red-500/40 bg-red-500/10' : 'border-zinc-700/45 bg-zinc-950/55'}`}>
        <div className="text-[9px] text-mutedForeground uppercase tracking-wider flex items-center gap-1"><Fingerprint size={11} /> Fingerprint</div>
        <div className="text-foreground mt-1 break-all">{data.same_device_fingerprint ? 'Exact match' : 'No exact match'}</div>
        <div className="text-[8px] text-mutedForeground mt-1 break-all">{userA?.username || 'A'}: {safeVal(data.device_fingerprint_a)}</div>
        <div className="text-[8px] text-mutedForeground break-all">{userB?.username || 'B'}: {safeVal(data.device_fingerprint_b)}</div>
      </div>
      <div className="rounded border border-zinc-700/45 bg-zinc-950/55 p-2">
        <div className="text-[9px] text-mutedForeground uppercase tracking-wider">Shared device types</div>
        <div className="text-foreground mt-1">{(data.shared_device_types || []).join(', ') || '—'}</div>
      </div>
      <div className="rounded border border-zinc-700/45 bg-zinc-950/55 p-2">
        <div className="text-[9px] text-mutedForeground uppercase tracking-wider">Shared user agents</div>
        <div className="text-foreground mt-1">{(data.shared_user_agents || []).length ? `${data.shared_user_agents.length} exact UA match(es)` : '—'}</div>
      </div>
    </div>
  );
}

function TransactionTable({ title, icon, rows, kind, userA, userB }) {
  const Icon = icon;
  return (
    <div className="rounded-lg border border-zinc-700/45 bg-zinc-950/55 overflow-hidden">
      <div className="px-3 py-2 border-b border-zinc-800/70 flex items-center justify-between gap-2">
        <div className="text-[10px] text-primary font-heading font-bold uppercase tracking-wider flex items-center gap-1.5">
          {Icon ? <Icon size={13} /> : null}
          {title}
        </div>
        <div className="text-[9px] text-mutedForeground font-heading">{rows?.length || 0} row(s)</div>
      </div>
      {!rows?.length ? (
        <p className="p-3 text-[10px] text-mutedForeground font-heading">No rows found.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[9px] font-heading">
            <thead className="bg-zinc-900/80 text-mutedForeground uppercase">
              <tr>
                <th className="px-2 py-1.5">When</th>
                <th className="px-2 py-1.5">From</th>
                <th className="px-2 py-1.5">To</th>
                <th className="px-2 py-1.5">Amount / Asset</th>
                <th className="px-2 py-1.5">Kind</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => {
                const fromName = r.from_username || r.actor_username || r.from_user_id || r.actor_user_id || '—';
                const toName = r.to_username || r.target_username || r.to_user_id || r.target_user_id || '—';
                const amount = kind === 'money'
                  ? fmtMoney(r.amount)
                  : kind === 'points'
                    ? `${fmtNum(r.amount)} pts`
                    : kind === 'vault'
                      ? [r.cash_delta ? fmtMoney(r.cash_delta) : null, r.points_delta ? `${fmtNum(r.points_delta)} pts` : null, r.bullets_delta ? `${fmtNum(r.bullets_delta)} bullets` : null, r.loot_delta ? `${fmtNum(r.loot_delta)} loot` : null].filter(Boolean).join(', ') || '—'
                      : r.car_name || r.car_id || r.user_car_id || r.event_type || '—';
                const directionTitle = `${userLabel(userA)} <-> ${userLabel(userB)}`;
                return (
                  <tr key={r.id || `${kind}-${idx}`} className="border-t border-zinc-800/70">
                    <td className="px-2 py-1.5 whitespace-nowrap text-mutedForeground">{formatAdminDateTime(r.created_at || r.at)}</td>
                    <td className="px-2 py-1.5 text-foreground">{fromName}</td>
                    <td className="px-2 py-1.5 text-foreground">{toName}</td>
                    <td className="px-2 py-1.5 text-primary font-bold tabular-nums" title={directionTitle}>{amount}</td>
                    <td className="px-2 py-1.5 text-mutedForeground">{r.transfer_kind || r.transfer_type || r.kind || r.event_type || 'direct'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function AdminAccountCompare() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [accessChecked, setAccessChecked] = useState(false);
  const [userA, setUserA] = useState(searchParams.get('a') || '');
  const [userB, setUserB] = useState(searchParams.get('b') || '');
  const [days, setDays] = useState(Number(searchParams.get('days') || 90));
  const [blurIps, setBlurIps] = useState(false);
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get('/admin/check');
        if (cancelled) return;
        if (!res.data?.is_admin && !res.data?.is_moderator) {
          navigate('/dashboard', { replace: true });
          return;
        }
        setAccessChecked(true);
      } catch {
        if (!cancelled) navigate('/dashboard', { replace: true });
      }
    })();
    return () => { cancelled = true; };
  }, [navigate]);

  const loadCompare = useCallback(async () => {
    const a = userA.trim();
    const b = userB.trim();
    if (!a || !b) {
      toast.error('Enter both usernames or user ids');
      return;
    }
    setLoading(true);
    setReport(null);
    try {
      const windowDays = Math.max(1, Math.min(365, Number(days) || 90));
      const res = await api.get('/admin/investigate/account-compare', {
        params: { user_a: a, user_b: b, days: windowDays },
      });
      setReport(res.data || null);
      setSearchParams({ a, b, days: String(windowDays) });
      toast.success('Account comparison loaded');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to compare accounts');
    } finally {
      setLoading(false);
    }
  }, [userA, userB, days, setSearchParams]);

  useEffect(() => {
    if (!accessChecked) return;
    const a = searchParams.get('a');
    const b = searchParams.get('b');
    if (a && b && !report && !loading) {
      loadCompare();
    }
  }, [accessChecked, searchParams, report, loading, loadCompare]);

  const userObjA = report?.users?.a;
  const userObjB = report?.users?.b;
  const tx = useMemo(() => report?.transactions || {}, [report?.transactions]);
  const hasReport = !!report;
  const totalTxRows = useMemo(() => (
    (tx.money_transfers?.length || 0)
    + (tx.points_transfers?.length || 0)
    + (tx.family_vault_transactions?.length || 0)
    + (tx.exclusive_car_events?.length || 0)
  ), [tx]);

  if (!accessChecked) {
    return (
      <div className={`${styles.pageContent} mobile-page-root`} style={{ padding: 16 }}>
        <div className={`${styles.panel} rounded p-4 text-sm text-mutedForeground`}>Checking staff access...</div>
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${styles.pageContent} mobile-page-root min-w-0 overflow-x-hidden`} style={{ padding: '12px 14px', maxWidth: 1400, margin: '0 auto' }} data-testid="admin-account-compare-page">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-sm font-heading font-bold text-primary uppercase tracking-wider flex items-center gap-2">
            <ArrowLeftRight size={16} /> Account Compare
          </h1>
          <p className="text-[10px] text-mutedForeground font-heading">Compare two accounts for shared providers, IPs, device signals, kill activity, and direct value movement.</p>
        </div>
        <button
          type="button"
          onClick={() => setBlurIps((v) => !v)}
          className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-[10px] font-heading font-bold uppercase ${blurIps ? 'border-sky-500/50 bg-sky-500/20 text-sky-200' : 'border-zinc-600/50 bg-zinc-800/50 text-mutedForeground hover:bg-zinc-700/50'}`}
        >
          <EyeOff size={12} /> {blurIps ? 'IPs blurred' : 'Blur IPs'}
        </button>
      </div>

      <div className={`${styles.panel} rounded-lg p-3 space-y-3`}>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_120px_auto] gap-2">
          <input
            value={userA}
            onChange={(e) => setUserA(e.target.value)}
            placeholder="Account A username or id"
            className="bg-zinc-950/70 border border-zinc-700/60 rounded px-3 py-2 text-xs text-foreground font-heading focus:outline-none focus:border-primary/60"
          />
          <input
            value={userB}
            onChange={(e) => setUserB(e.target.value)}
            placeholder="Account B username or id"
            className="bg-zinc-950/70 border border-zinc-700/60 rounded px-3 py-2 text-xs text-foreground font-heading focus:outline-none focus:border-primary/60"
          />
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="bg-zinc-950/70 border border-zinc-700/60 rounded px-3 py-2 text-xs text-foreground font-heading focus:outline-none focus:border-primary/60"
          >
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
            <option value={180}>180 days</option>
            <option value={365}>365 days</option>
          </select>
          <button
            type="button"
            onClick={loadCompare}
            disabled={loading}
            className="inline-flex items-center justify-center gap-1 rounded border border-primary/45 bg-primary/20 px-4 py-2 text-xs text-primary font-heading font-bold uppercase tracking-wider hover:bg-primary/30 disabled:opacity-50"
          >
            {loading ? <RefreshCw size={13} className="animate-spin" /> : <Search size={13} />}
            Compare
          </button>
        </div>
      </div>

      {hasReport ? (
        <>
          <AccountCompareLegend userA={userObjA} userB={userObjB} />
          <SummaryCards summary={report.summary} userA={userObjA} userB={userObjB} />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <AccountCard side="a" user={userObjA} blurIps={blurIps} />
            <AccountCard side="b" user={userObjB} blurIps={blurIps} />
          </div>

          <section className={`${styles.panel} rounded-lg p-3 space-y-2`}>
            <h2 className="text-[11px] text-primary font-heading font-bold uppercase tracking-wider flex items-center gap-1">
              <Link2 size={13} /> Possible Links Between Accounts
            </h2>
            <PossibleLinksSection links={report.account_links || []} />
          </section>

          <section className={`${styles.panel} rounded-lg p-3 space-y-2`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-[11px] text-primary font-heading font-bold uppercase tracking-wider flex items-center gap-1">
                <Wifi size={13} /> Shared Internet Providers
              </h2>
              <div className="flex flex-wrap items-center gap-3 text-[9px] font-heading">
                <span className="inline-flex items-center gap-1 text-sky-200">
                  <span className="inline-block w-2 h-2 rounded-full bg-sky-400" />
                  {userObjA?.username || 'Account A'}
                </span>
                <span className="inline-flex items-center gap-1 text-amber-200">
                  <span className="inline-block w-2 h-2 rounded-full bg-amber-400" />
                  {userObjB?.username || 'Account B'}
                </span>
              </div>
            </div>
            <SharedProvidersSection
              data={report.shared_network_providers}
              blurIps={blurIps}
              userA={userObjA}
              userB={userObjB}
            />
          </section>

          <section className={`${styles.panel} rounded-lg p-3 space-y-2`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-[11px] text-primary font-heading font-bold uppercase tracking-wider flex items-center gap-1">
                <Users size={13} /> Shared IP Evidence
              </h2>
              <div className="flex flex-wrap items-center gap-3 text-[9px] font-heading">
                <span className="inline-flex items-center gap-1 text-sky-200">
                  <span className="inline-block w-2 h-2 rounded-full bg-sky-400" />
                  {userObjA?.username || 'Account A'}
                </span>
                <span className="inline-flex items-center gap-1 text-amber-200">
                  <span className="inline-block w-2 h-2 rounded-full bg-amber-400" />
                  {userObjB?.username || 'Account B'}
                </span>
              </div>
            </div>
            <SharedIpSection
              rows={report.shared_ips || []}
              blurIps={blurIps}
              truncated={report.shared_ip_truncated}
              userA={userObjA}
              userB={userObjB}
            />
          </section>

          <section className={`${styles.panel} rounded-lg p-3 space-y-2`}>
            <h2 className="text-[11px] text-primary font-heading font-bold uppercase tracking-wider flex items-center gap-1">
              <Fingerprint size={13} /> Shared Device Evidence
            </h2>
            <DevicesSection data={report.shared_devices} userA={userObjA} userB={userObjB} />
          </section>

          <section className={`${styles.panel} rounded-lg p-3 space-y-3`}>
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-[11px] text-primary font-heading font-bold uppercase tracking-wider flex items-center gap-1">
                <Coins size={13} /> Direct Transactions
              </h2>
              <span className="text-[9px] text-mutedForeground font-heading">{totalTxRows} total row(s) in {report.window_days} day window</span>
            </div>
            <TransactionTable title="Cash transfers" icon={Coins} rows={tx.money_transfers || []} kind="money" userA={userObjA} userB={userObjB} />
            <TransactionTable title="Points transfers" icon={ArrowLeftRight} rows={tx.points_transfers || []} kind="points" userA={userObjA} userB={userObjB} />
            <TransactionTable title="Family vault rows" icon={ShieldAlert} rows={tx.family_vault_transactions || []} kind="vault" userA={userObjA} userB={userObjB} />
            <TransactionTable title="Exclusive car events" icon={Car} rows={tx.exclusive_car_events || []} kind="cars" userA={userObjA} userB={userObjB} />
          </section>

          <div className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[10px] text-amber-100 font-heading flex gap-2">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <span>This tool surfaces evidence only. Shared access or transfers do not automatically prove account ownership or cheating.</span>
          </div>
        </>
      ) : (
        <div className={`${styles.panel} rounded-lg p-10 text-center text-mutedForeground font-heading`}>
          Enter two accounts to compare IPs, device signals, and direct value movement.
        </div>
      )}
    </div>
  );
}
