import { useEffect, useState } from 'react';
import { Activity, Shield } from 'lucide-react';
import api, { getApiErrorMessage } from '../utils/api';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from './ui/sheet';
import styles from '../styles/noir.module.css';

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

export default function StaffUserDetailsPanel({ username, open, onOpenChange }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open || !username) {
      if (!open) {
        setData(null);
        setError(null);
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

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className={`w-full sm:max-w-md overflow-y-auto ${styles.panel} border-primary/30 bg-[var(--noir-surface)] shadow-[0_0_24px_rgba(var(--noir-primary-rgb),0.08)]`}
      >
        <SheetHeader className="pb-2">
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

        <div className="mt-4 space-y-4">
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
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
