import { useState, useEffect, useRef, useCallback } from 'react';
import { X } from 'lucide-react';
import api from '../../utils/api';
import { toast } from 'sonner';
import { formatAttackLogTime, parseAttackLogUA } from '../../utils/attackLogDisplay';

function BtnPrimary({ children, ...props }) {
  return (
    <button
      {...props}
      type="button"
      className="bg-primary/20 text-primary rounded px-3 py-1 text-[10px] font-bold uppercase tracking-wide border border-primary/40 hover:bg-primary/30 hover:shadow-[0_0_12px_rgba(var(--noir-primary-rgb),0.15)] focus:shadow-[0_0_12px_rgba(var(--noir-primary-rgb),0.12)] transition-all disabled:opacity-50 touch-manipulation font-heading"
    >
      {children}
    </button>
  );
}

/**
 * Staff attack log viewer: /admin/attacks/logs + optional live merge.
 * Used from Admin.js (embedded) and AdminAttackLogs.js (standalone page section).
 */
export default function AttackLogsPanel({
  introText = "Search by username to load that user's attack attempts (as attacker or target). Full post data: who shot whom, outcome, bodyguard, bullets, location, etc.",
  tableMaxHeightClass = 'max-h-[420px]',
  onCountChange,
  onLogsLoaded,
}) {
  const [attackLogsUsername, setAttackLogsUsername] = useState('');
  const [attackLogsLimit, setAttackLogsLimit] = useState(200);
  const [attackLogsData, setAttackLogsData] = useState(null);
  const [attackLogsLoading, setAttackLogsLoading] = useState(false);
  const [attackLogsLive, setAttackLogsLive] = useState(false);
  const attackLogsDataRef = useRef(null);
  attackLogsDataRef.current = attackLogsData;
  const [attackLogViewRow, setAttackLogViewRow] = useState(null);

  const reportCount = useCallback(
    (data) => {
      onCountChange?.(data?.logs != null ? data.logs.length : null);
    },
    [onCountChange],
  );

  useEffect(() => {
    reportCount(attackLogsData);
  }, [attackLogsData, reportCount]);

  const handleFetchAttackLogs = async () => {
    const un = (attackLogsUsername || '').trim();
    if (!un) {
      toast.error('Enter a username');
      return;
    }
    setAttackLogsLoading(true);
    setAttackLogsData(null);
    try {
      const res = await api.get('/admin/attacks/logs', { params: { username: un, limit: attackLogsLimit } });
      const payload = res.data || null;
      setAttackLogsData(payload);
      toast.success(`Loaded ${payload?.logs?.length ?? 0} attack log entries`);
      if (payload) onLogsLoaded?.(un);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load attack logs');
    } finally {
      setAttackLogsLoading(false);
    }
  };

  useEffect(() => {
    if (!attackLogsLive || !(attackLogsUsername || '').trim()) return;
    const un = (attackLogsUsername || '').trim();
    const limit = attackLogsLimit;
    const run = async () => {
      try {
        const prev = attackLogsDataRef.current;
        const since = prev?.logs?.length ? prev.logs[0].created_at : null;
        const params = { username: un, limit: since ? 100 : limit };
        if (since) params.since = since;
        const res = await api.get('/admin/attacks/logs', { params });
        const data = res.data;
        if (!data) return;
        if (since && prev?.logs?.length && data.logs?.length) {
          const seen = new Set(prev.logs.map((l) => l.id));
          const added = data.logs.filter((l) => !seen.has(l.id));
          const merged = [...added, ...prev.logs]
            .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
            .slice(0, limit);
          setAttackLogsData({ ...data, logs: merged });
        } else {
          setAttackLogsData(data);
        }
      } catch {
        /* ignore */
      }
    };
    const t = setInterval(run, 5000);
    run();
    return () => clearInterval(t);
  }, [attackLogsLive, attackLogsUsername, attackLogsLimit]);

  useEffect(() => {
    if (!attackLogViewRow?.id || !attackLogsData?.logs?.length) return;
    const found = attackLogsData.logs.find((l) => l.id === attackLogViewRow.id);
    if (found) setAttackLogViewRow(found);
  }, [attackLogsData, attackLogViewRow?.id]);

  return (
    <div className="space-y-3">
      {introText ? <p className="text-[10px] text-mutedForeground font-heading">{introText}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={attackLogsUsername}
          onChange={(e) => setAttackLogsUsername(e.target.value)}
          placeholder="Username"
          className="w-40 px-2 py-1 rounded border border-input bg-transparent text-[11px] font-heading"
        />
        <span className="text-[10px] text-mutedForeground">Limit</span>
        <input
          type="number"
          min={1}
          max={1000}
          value={attackLogsLimit}
          onChange={(e) => setAttackLogsLimit(Math.max(1, Math.min(1000, parseInt(e.target.value, 10) || 500)))}
          className="w-20 px-2 py-1 rounded border border-input bg-transparent text-[11px] font-mono"
        />
        <BtnPrimary onClick={handleFetchAttackLogs} disabled={attackLogsLoading}>
          {attackLogsLoading ? 'Loading…' : 'Load attack logs'}
        </BtnPrimary>
        <label className="flex items-center gap-1.5 text-[10px] font-heading text-mutedForeground cursor-pointer">
          <input
            type="checkbox"
            checked={attackLogsLive}
            onChange={(e) => setAttackLogsLive(e.target.checked)}
            className="rounded border border-input"
          />
          Live
        </label>
        {attackLogsLive && (attackLogsUsername || '').trim() && (
          <span className="text-[9px] text-primary font-heading">Refreshing every 5s</span>
        )}
      </div>
      {attackLogsData && (
        <div className={`overflow-x-auto overflow-y-auto ${tableMaxHeightClass}`}>
          <p className="text-[10px] font-heading text-primary mb-1">
            Attack log for: <strong>{attackLogsData.username ?? '—'}</strong>
          </p>
          {!attackLogsData.logs || attackLogsData.logs.length === 0 ? (
            <p className="text-[10px] text-mutedForeground font-heading">No attack attempts found.</p>
          ) : (
            <table className="w-full text-left border-collapse text-[9px] font-heading">
              <thead className="sticky top-0 bg-zinc-900/95 z-10">
                <tr className="border-b border-zinc-700/50">
                  <th className="py-1 pr-1 font-bold text-mutedForeground uppercase">Attacker</th>
                  <th className="py-1 pr-1 font-bold text-mutedForeground uppercase">Target</th>
                  <th className="py-1 pr-1 font-bold text-mutedForeground uppercase">Outcome</th>
                  <th className="py-1 pr-1 font-bold text-mutedForeground uppercase">Player message</th>
                  <th className="py-1 pr-1 font-bold text-mutedForeground uppercase">IP</th>
                  <th className="py-1 pr-1 font-bold text-mutedForeground uppercase">User-Agent</th>
                  <th className="py-1 pr-1 font-bold text-mutedForeground uppercase">Device</th>
                  <th className="py-1 pr-1 font-bold text-mutedForeground uppercase">Bot?</th>
                  <th className="py-1 pr-1 font-bold text-mutedForeground uppercase">Bodyguard?</th>
                  <th className="py-1 pr-1 font-bold text-mutedForeground uppercase">Bullets</th>
                  <th className="py-1 pr-1 font-bold text-mutedForeground uppercase">Location</th>
                  <th className="py-1 pr-1 font-bold text-mutedForeground uppercase">Time</th>
                  <th className="py-1 font-bold text-mutedForeground uppercase">View</th>
                </tr>
              </thead>
              <tbody>
                {attackLogsData.logs.map((row, idx) => {
                  const { device, bot: uaBot } = parseAttackLogUA(row.user_agent);
                  const botLabel =
                    row.attacker_is_bot === true
                      ? row.attacker_bot_label
                        ? `Yes · ${row.attacker_bot_label}`
                        : 'Yes'
                      : row.attacker_is_bot === false
                        ? 'No'
                        : uaBot || '—';
                  return (
                    <tr key={row.id || idx} className="border-b border-zinc-700/30">
                      <td className="py-1 pr-1 text-foreground">{row.attacker_username ?? '—'}</td>
                      <td className="py-1 pr-1 text-foreground">{row.target_username ?? '—'}</td>
                      <td className="py-1 pr-1">
                        {row.outcome === 'killed' && <span className="text-red-400">Killed</span>}
                        {row.outcome === 'failed' && <span className="text-amber-400">Failed</span>}
                        {row.outcome === 'bodyguard' && <span className="text-amber-500">Bodyguard</span>}
                        {row.outcome === 'error' && <span className="text-orange-400">Error</span>}
                        {!['killed', 'failed', 'bodyguard', 'error'].includes(row.outcome) &&
                          (row.outcome ? <span className="text-mutedForeground">{row.outcome}</span> : '—')}
                      </td>
                      <td className="py-1 pr-1 max-w-[200px] truncate text-mutedForeground" title={row.player_message ?? ''}>
                        {row.player_message ?? '—'}
                      </td>
                      <td className="py-1 pr-1 text-mutedForeground font-mono text-[9px]">{row.client_ip ?? '—'}</td>
                      <td
                        className="py-1 pr-1 max-w-[140px] truncate text-mutedForeground font-mono text-[8px]"
                        title={row.user_agent ?? ''}
                      >
                        {row.user_agent ?? '—'}
                      </td>
                      <td className="py-1 pr-1 text-mutedForeground">{device}</td>
                      <td className="py-1 pr-1">
                        {botLabel ? <span className="text-amber-400 font-medium">{botLabel}</span> : '—'}
                      </td>
                      <td className="py-1 pr-1">
                        {row.is_bodyguard_kill ? 'Yes' : row.outcome === 'bodyguard' ? 'Blocked' : '—'}
                      </td>
                      <td className="py-1 pr-1">{row.bullets_used != null ? Number(row.bullets_used).toLocaleString() : '—'}</td>
                      <td className="py-1 pr-1 text-mutedForeground">{row.location_state ?? row.state ?? '—'}</td>
                      <td className="py-1 pr-1 text-mutedForeground font-mono">{formatAttackLogTime(row.created_at)}</td>
                      <td className="py-1">
                        <button
                          type="button"
                          onClick={() => setAttackLogViewRow(row)}
                          className="px-1.5 py-0.5 rounded border border-primary/40 bg-primary/10 text-primary text-[9px] font-heading hover:bg-primary/20"
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {attackLogViewRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70" onClick={() => setAttackLogViewRow(null)}>
          <div
            className="bg-zinc-900 border border-primary/30 rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-zinc-700/50 flex items-center justify-between shrink-0">
              <h3 className="text-sm font-heading font-bold text-primary">Attack log entry</h3>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 text-[10px] font-heading text-mutedForeground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={attackLogsLive}
                    onChange={(e) => setAttackLogsLive(e.target.checked)}
                    className="rounded border border-input"
                  />
                  Live
                </label>
                {attackLogsLive && (attackLogsUsername || '').trim() && (
                  <span className="text-[9px] text-primary font-heading">Refreshing every 5s</span>
                )}
                <button
                  type="button"
                  onClick={() => setAttackLogViewRow(null)}
                  className="p-1 rounded border border-zinc-600 text-zinc-400 hover:bg-zinc-700 hover:text-foreground"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
            <div className="p-4 overflow-y-auto flex-1 text-[10px] font-heading space-y-3">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                <div>
                  <span className="text-mutedForeground">Attacker:</span> {attackLogViewRow.attacker_username ?? '—'}
                </div>
                <div>
                  <span className="text-mutedForeground">Target:</span> {attackLogViewRow.target_username ?? '—'}
                </div>
                <div>
                  <span className="text-mutedForeground">Outcome:</span> {attackLogViewRow.outcome ?? '—'}
                </div>
                <div>
                  <span className="text-mutedForeground">Location:</span>{' '}
                  {attackLogViewRow.location_state ?? attackLogViewRow.state ?? '—'}
                </div>
                <div>
                  <span className="text-mutedForeground">IP:</span>{' '}
                  <span className="font-mono">{attackLogViewRow.client_ip ?? '—'}</span>
                </div>
                <div>
                  <span className="text-mutedForeground">Bullets used:</span>{' '}
                  {attackLogViewRow.bullets_used != null ? Number(attackLogViewRow.bullets_used).toLocaleString() : '—'}
                </div>
                <div>
                  <span className="text-mutedForeground">Bodyguard kill:</span>{' '}
                  {attackLogViewRow.is_bodyguard_kill ? 'Yes' : attackLogViewRow.outcome === 'bodyguard' ? 'Blocked' : '—'}
                </div>
                <div>
                  <span className="text-mutedForeground">Bot?</span>{' '}
                  {attackLogViewRow.attacker_is_bot === true ? 'Yes' : attackLogViewRow.attacker_is_bot === false ? 'No' : '—'}
                </div>
                {attackLogViewRow.attacker_bot_label && (
                  <div className="col-span-2">
                    <span className="text-mutedForeground">Bot type:</span>{' '}
                    <span className="text-amber-400 font-medium">{attackLogViewRow.attacker_bot_label}</span>
                  </div>
                )}
                <div>
                  <span className="text-mutedForeground">Time:</span> {formatAttackLogTime(attackLogViewRow.created_at)}
                </div>
              </div>
              {(attackLogViewRow.attacker_is_bot || attackLogViewRow.attacker_bot_label) && (
                <div>
                  <div className="text-mutedForeground font-bold uppercase tracking-wider border-b border-zinc-700/50 pb-0.5 mb-1">
                    Bot info
                  </div>
                  <p className="text-foreground text-[10px]">
                    {attackLogViewRow.attacker_bot_label && (
                      <>
                        <span className="text-amber-400 font-medium">Type/language: </span>
                        {attackLogViewRow.attacker_bot_label}
                      </>
                    )}
                  </p>
                </div>
              )}
              <div>
                <div className="text-mutedForeground font-bold uppercase tracking-wider border-b border-zinc-700/50 pb-0.5 mb-1">
                  Player message
                </div>
                <p className="text-foreground whitespace-pre-wrap break-words">{attackLogViewRow.player_message ?? '—'}</p>
              </div>
              <div>
                <div className="text-mutedForeground font-bold uppercase tracking-wider border-b border-zinc-700/50 pb-0.5 mb-1">
                  User-Agent
                </div>
                <p className="text-foreground font-mono text-[9px] break-all">{attackLogViewRow.user_agent ?? '—'}</p>
              </div>
              {attackLogViewRow.first_bodyguard && (
                <div>
                  <div className="text-mutedForeground font-bold uppercase tracking-wider border-b border-zinc-700/50 pb-0.5 mb-1">
                    First bodyguard
                  </div>
                  <pre className="text-foreground font-mono text-[9px] whitespace-pre-wrap break-words">
                    {JSON.stringify(attackLogViewRow.first_bodyguard, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
