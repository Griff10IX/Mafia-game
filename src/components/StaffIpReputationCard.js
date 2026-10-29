import { ShieldAlert } from 'lucide-react';

function maskIp(ip) {
  const s = String(ip || '').trim();
  if (!s) return '—';
  if (s.includes(':')) {
    const parts = s.split(':').filter(Boolean);
    if (parts.length <= 2) return `${parts[0] || '****'}:****`;
    return `${parts.slice(0, 2).join(':')}:****:****`;
  }
  const parts = s.split('.');
  if (parts.length === 4) return `${parts[0]}.${parts[1]}.xxx.xxx`;
  return s.length > 8 ? `${s.slice(0, 4)}…${s.slice(-2)}` : '***';
}

function valueOrDash(value) {
  const s = value == null ? '' : String(value).trim();
  return s || '—';
}

function locationLine(geo = {}) {
  const city = valueOrDash(geo.city);
  const country = valueOrDash(geo.country);
  if (city !== '—' && country !== '—') return `${city}, ${country}`;
  return country !== '—' ? country : valueOrDash(geo.countryCode);
}

function riskBadges(geo = {}) {
  const badges = [];
  if (geo.proxy) badges.push({ label: 'Proxy/VPN', cls: 'border-rose-500/40 bg-rose-500/10 text-rose-300' });
  if (geo.hosting) badges.push({ label: 'Hosting', cls: 'border-violet-500/40 bg-violet-500/10 text-violet-300' });
  if (geo.mobile) badges.push({ label: 'Mobile', cls: 'border-sky-500/40 bg-sky-500/10 text-sky-300' });
  if (!badges.length && geo.geo_ok !== false) badges.push({ label: 'Residential/ISP', cls: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' });
  return badges;
}

export default function StaffIpReputationCard({
  ip,
  geo,
  blurIp = false,
  accountCount,
  className = '',
  compact = false,
}) {
  const g = geo || {};
  const shownIp = blurIp ? maskIp(ip) : valueOrDash(ip);
  const badges = riskBadges(g);
  const asValue = valueOrDash(g.as_field || g.asname);

  return (
    <div className={`rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="break-all font-mono text-sm text-zinc-100">{shownIp}</span>
            {badges.map((b) => (
              <span key={b.label} className={`rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${b.cls}`}>
                {b.label}
              </span>
            ))}
          </div>
          {g.geo_ok === false ? (
            <div className="mt-1 text-xs text-amber-300">Lookup failed: {valueOrDash(g.geo_error)}</div>
          ) : (
            <div className={`${compact ? 'mt-1.5' : 'mt-2'} grid grid-cols-1 gap-x-4 gap-y-0.5 text-xs text-zinc-400 sm:grid-cols-2`}>
              <div><span className="text-zinc-500">Location:</span> <span className="text-zinc-300">{locationLine(g)}</span></div>
              <div><span className="text-zinc-500">Region:</span> <span className="text-zinc-300">{valueOrDash(g.regionName)}</span></div>
              <div><span className="text-zinc-500">ISP:</span> <span className="text-zinc-300">{valueOrDash(g.isp || g.network)}</span></div>
              <div className="break-words"><span className="text-zinc-500">AS:</span> <span className="text-zinc-300">{asValue}</span></div>
            </div>
          )}
        </div>
        {accountCount != null ? (
          <div className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs text-amber-200">
            <ShieldAlert size={12} />
            {accountCount} account(s)
          </div>
        ) : null}
      </div>
    </div>
  );
}

export { maskIp };
