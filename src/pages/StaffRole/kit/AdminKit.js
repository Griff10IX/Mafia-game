import { useMemo, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Loader2 } from 'lucide-react';

/* Shared building blocks for the admin panel: one dark, neutral, data-dense style. */

export function fmtNum(n) {
  const v = Number(n ?? 0);
  return Number.isFinite(v) ? Math.trunc(v).toLocaleString() : '0';
}

export function fmtCompact(n) {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return '0';
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(abs >= 1e13 ? 1 : 2)}T`;
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(abs >= 1e10 ? 1 : 2)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(abs >= 1e7 ? 1 : 2)}M`;
  if (abs >= 1e4) return `${sign}${(abs / 1e3).toFixed(1)}K`;
  return `${sign}${Math.trunc(abs).toLocaleString()}`;
}

export function fmtGBP(minor, { compact = false } = {}) {
  const pounds = Number(minor ?? 0) / 100;
  if (compact && Math.abs(pounds) >= 10000) return `£${fmtCompact(pounds)}`;
  return `£${pounds.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function fmtCash(n, { compact = true } = {}) {
  return `$${compact ? fmtCompact(n) : fmtNum(n)}`;
}

export function pctChange(current, previous) {
  const c = Number(current ?? 0);
  const p = Number(previous ?? 0);
  if (!p) return c ? null : 0;
  return ((c - p) / Math.abs(p)) * 100;
}

export function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function AdminPage({ title, subtitle, icon: Icon, actions, children }) {
  return (
    <div className="admin-kit mx-auto w-full max-w-[1400px] min-w-0 px-3 py-4 sm:px-5 sm:py-6 text-zinc-100">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            {Icon && (
              <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-300">
                <Icon size={18} />
              </span>
            )}
            <h1 className="truncate text-xl font-semibold tracking-tight text-zinc-50">{title}</h1>
          </div>
          {subtitle && <p className="mt-1.5 text-sm text-zinc-400">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

export function Card({ title, subtitle, actions, children, padded = true, className = '' }) {
  return (
    <section className={`min-w-0 rounded-xl border border-zinc-800 bg-zinc-900/60 ${className}`}>
      {(title || actions) && (
        <header className="flex flex-col gap-2 border-b border-zinc-800 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold text-zinc-100">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-zinc-500">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={padded ? 'p-4' : ''}>{children}</div>
    </section>
  );
}

export function KpiGrid({ children, cols = 4 }) {
  const colClass = { 2: 'lg:grid-cols-2', 3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4', 5: 'lg:grid-cols-5', 6: 'lg:grid-cols-6' }[cols] || 'lg:grid-cols-4';
  return <div className={`grid grid-cols-2 gap-3 ${colClass}`}>{children}</div>;
}

export function KpiTile({ label, value, delta, deltaLabel, hint, tone = 'default' }) {
  const toneClass = { default: 'text-zinc-50', good: 'text-emerald-400', bad: 'text-rose-400', warn: 'text-amber-300' }[tone] || 'text-zinc-50';
  const hasDelta = delta !== undefined && delta !== null && Number.isFinite(delta);
  const up = hasDelta && delta >= 0;
  return (
    <div className="min-w-0 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="text-xs font-medium text-zinc-400">{label}</div>
      <div className={`mt-1.5 truncate text-2xl font-semibold tabular-nums tracking-tight ${toneClass}`}>{value}</div>
      <div className="mt-1 flex min-h-[18px] flex-wrap items-center gap-x-2 text-xs">
        {hasDelta && (
          <span className={`inline-flex items-center gap-0.5 font-medium ${up ? 'text-emerald-400' : 'text-rose-400'}`}>
            {up ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
            {Math.abs(delta).toFixed(Math.abs(delta) >= 100 ? 0 : 1)}%
          </span>
        )}
        {hasDelta && deltaLabel && <span className="text-zinc-500">{deltaLabel}</span>}
        {hint && <span className="text-zinc-500">{hint}</span>}
      </div>
    </div>
  );
}

const BUTTON_VARIANTS = {
  primary: 'bg-zinc-100 text-zinc-900 hover:bg-white border-zinc-100',
  secondary: 'bg-zinc-900 text-zinc-200 hover:bg-zinc-800 border-zinc-700',
  danger: 'bg-rose-600/90 text-white hover:bg-rose-600 border-rose-500/60',
  ghost: 'bg-transparent text-zinc-300 hover:bg-zinc-800/70 border-transparent',
};

export function Button({ variant = 'secondary', size = 'md', loading = false, icon: Icon, children, className = '', disabled, ...rest }) {
  const sizeClass = size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-9 px-3.5 text-sm';
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${sizeClass} ${BUTTON_VARIANTS[variant] || BUTTON_VARIANTS.secondary} ${className}`}
      {...rest}
    >
      {loading ? <Loader2 size={size === 'sm' ? 12 : 14} className="animate-spin" /> : Icon ? <Icon size={size === 'sm' ? 12 : 14} /> : null}
      {children}
    </button>
  );
}

export function Badge({ tone = 'neutral', children }) {
  const toneClass = {
    neutral: 'border-zinc-700 bg-zinc-800/80 text-zinc-300',
    good: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
    bad: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
    warn: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
    info: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  }[tone] || '';
  return <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${toneClass}`}>{children}</span>;
}

export function Segmented({ options, value, onChange, size = 'md' }) {
  const pad = size === 'sm' ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm';
  return (
    <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-950 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded-md font-medium transition-colors ${pad} ${value === o.value ? 'bg-zinc-800 text-zinc-50' : 'text-zinc-400 hover:text-zinc-200'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const RANGE_OPTIONS = [
  { value: 7, label: '7d' },
  { value: 30, label: '30d' },
  { value: 90, label: '90d' },
  { value: 365, label: '1y' },
  { value: 0, label: 'All' },
];

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-zinc-800">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
            value === t.id ? 'border-zinc-100 text-zinc-50' : 'border-transparent text-zinc-400 hover:text-zinc-200'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function LoadingBlock({ label = 'Loading…' }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-zinc-400">
      <Loader2 size={16} className="animate-spin" />
      {label}
    </div>
  );
}

export function ErrorBlock({ message, onRetry }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-rose-500/30 bg-rose-500/5 py-8 text-sm text-rose-200">
      <span>{message || 'Something went wrong.'}</span>
      {onRetry && <Button size="sm" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

export function EmptyState({ children = 'Nothing to show yet.' }) {
  return <div className="py-8 text-center text-sm text-zinc-500">{children}</div>;
}

/**
 * columns: [{ key, label, align: 'left'|'right', render(row), sortValue(row), width }]
 */
export function DataTable({ columns, rows, rowKey, pageSize = 25, empty = 'No rows.', initialSort }) {
  const [sort, setSort] = useState(initialSort || null);
  const [page, setPage] = useState(0);
  const sorted = useMemo(() => {
    const list = Array.isArray(rows) ? [...rows] : [];
    if (!sort) return list;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return list;
    const get = col.sortValue || ((r) => r[col.key]);
    list.sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      if (va === vb) return 0;
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      return (va > vb ? 1 : -1) * (sort.dir === 'asc' ? 1 : -1);
    });
    return list;
  }, [rows, sort, columns]);
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const current = Math.min(page, pages - 1);
  const visible = sorted.slice(current * pageSize, current * pageSize + pageSize);

  const toggleSort = (col) => {
    if (col.sortable === false) return;
    setPage(0);
    setSort((s) => (s && s.key === col.key ? { key: col.key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key: col.key, dir: 'desc' }));
  };

  if (!sorted.length) return <EmptyState>{empty}</EmptyState>;
  return (
    <div className="min-w-0">
      <div className="overflow-x-auto">
        <table className="w-full min-w-max text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-xs text-zinc-400">
              {columns.map((c) => (
                <th
                  key={c.key}
                  onClick={() => toggleSort(c)}
                  style={c.width ? { width: c.width } : undefined}
                  className={`select-none px-3 py-2 font-medium ${c.align === 'right' ? 'text-right' : 'text-left'} ${c.sortable === false ? '' : 'cursor-pointer hover:text-zinc-200'}`}
                >
                  <span className="inline-flex items-center gap-1">
                    {c.label}
                    {sort?.key === c.key && (sort.dir === 'desc' ? <ChevronDown size={12} /> : <ChevronUp size={12} />)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((r, i) => (
              <tr key={rowKey ? rowKey(r, i) : i} className="border-b border-zinc-800/60 last:border-0 hover:bg-zinc-800/30">
                {columns.map((c) => (
                  <td key={c.key} className={`px-3 py-2 text-zinc-200 ${c.align === 'right' ? 'text-right tabular-nums' : ''}`}>
                    {c.render ? c.render(r) : r[c.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="flex items-center justify-between border-t border-zinc-800 px-3 py-2 text-xs text-zinc-400">
          <span>
            {current * pageSize + 1}–{Math.min(sorted.length, (current + 1) * pageSize)} of {sorted.length.toLocaleString()}
          </span>
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" icon={ChevronLeft} disabled={current === 0} onClick={() => setPage(current - 1)} />
            <Button size="sm" variant="ghost" icon={ChevronRight} disabled={current >= pages - 1} onClick={() => setPage(current + 1)} />
          </div>
        </div>
      )}
    </div>
  );
}
