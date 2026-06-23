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
  if (geo.proxy) badges.push({ label: 'Proxy/VPN', cls: 'border-red-500/50 bg-red-500/20 text-red-200' });
  if (geo.hosting) badges.push({ label: 'Hosting', cls: 'border-violet-500/50 bg-violet-500/20 text-violet-200' });
  if (geo.mobile) badges.push({ label: 'Mobile', cls: 'border-sky-500/50 bg-sky-500/20 text-sky-200' });
  if (!badges.length && geo.geo_ok !== false) badges.push({ label: 'Residential/ISP', cls: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200' });
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
    <div className={`rounded border border-zinc-700/50 bg-zinc-950/55 p-2 font-heading ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-[11px] text-foreground break-all">{shownIp}</span>
            {badges.map((b) => (
              <span key={b.label} className={`rounded px-1.5 py-0.5 border text-[8px] font-bold uppercase tracking-wide ${b.cls}`}>
                {b.label}
              </span>
            ))}
          </div>
          {g.geo_ok === false ? (
            <div className="mt-1 text-[9px] text-amber-300">Lookup failed: {valueOrDash(g.geo_error)}</div>
          ) : (
            <div className={`${compact ? 'mt-1' : 'mt-2'} grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5 text-[10px] text-mutedForeground`}>
              <div><span className="text-foreground">Location:</span> {locationLine(g)}</div>
              <div><span className="text-foreground">Region:</span> {valueOrDash(g.regionName)}</div>
              <div><span className="text-foreground">ISP:</span> {valueOrDash(g.isp || g.network)}</div>
              <div><span className="text-foreground">AS:</span> {asValue}</div>
            </div>
          )}
        </div>
        {accountCount != null ? (
          <div className="inline-flex items-center gap-1 rounded border border-amber-500/35 bg-amber-500/10 px-2 py-1 text-[9px] text-amber-200">
            <ShieldAlert size={11} />
            {accountCount} account(s)
          </div>
        ) : null}
      </div>
    </div>
  );
}

export { maskIp };
