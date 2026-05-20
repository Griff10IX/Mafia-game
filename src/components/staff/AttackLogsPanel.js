import { useState, useEffect, useRef, useCallback } from 'react';
import { X } from 'lucide-react';
import api from '../../utils/api';
import { toast } from 'sonner';
import {
  formatAttackLogTime,
  formatAttackLogBotCell,
  formatAttackLogBotRationale,
  formatAttackLogIntegrityCell,
  formatAttackLogBodyguardCell,
  formatBlockingBodyguard,
  formatBodyguardSlot,
  formatAttackLogProtecteeOrOwner,
  formatBodyguardBlockSummary,
  parseAttackLogUA,
} from '../../utils/attackLogDisplay';

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

const EVENT_FILTER_OPTIONS = [
  { value: '', label: 'All events' },
  { value: 'block', label: 'Bodyguard blocks' },
  { value: 'kill', label: 'Bodyguard kills' },
  { value: 'any', label: 'Any bodyguard' },
  { value: 'outcome:killed', label: 'Kills (all)' },
  { value: 'outcome:failed', label: 'Failed' },
  { value: 'outcome:error', label: 'Errors' },
  { value: 'outcome:travel', label: 'Travel' },
];

const DAYS_OPTIONS = [
  { value: '', label: 'No day cap' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
];

/**
 * Staff attack log viewer: /admin/attacks/logs + optional live merge.
 */
export default function AttackLogsPanel({
  introText = "Leave username empty to load recent attempts for all players (newest first, up to your limit). Enter a username to filter to that player as attacker or target. Turn on Live to refresh every 5s and prepend new rows.",
  tableMaxHeightClass = 'max-h-[420px]',
  onCountChange,
  onLogsLoaded,
  showGlobalIntel = false,
}) {
  const [attackLogsUsername, setAttackLogsUsername] = useState('');
  const [attackLogsLimit, setAttackLogsLimit] = useState(200);
  const [attackLogsData, setAttackLogsData] = useState(null);
  const [attackLogsLoading, setAttackLogsLoading] = useState(false);
  const [attackLogsLive, setAttackLogsLive] = useState(false);
  const [attackLogsExcludeNpc, setAttackLogsExcludeNpc] = useState(false);
  const [eventFilter, setEventFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [protecteeFilter, setProtecteeFilter] = useState('');
  const [guardFilter, setGuardFilter] = useState('');
  const [daysFilter, setDaysFilter] = useState('30');
  const [bodyguardIntel, setBodyguardIntel] = useState(null);
  const [intelLoading, setIntelLoading] = useState(false);
  const [globalIntel, setGlobalIntel] = useState(null);
  const [globalIntelLoading, setGlobalIntelLoading] = useState(false);
  const attackLogsDataRef = useRef(null);
  attackLogsDataRef.current = attackLogsData;
  const [attackLogViewRow, setAttackLogViewRow] = useState(null);

  const buildLogParams = useCallback(
    (extra = {}, overrides = {}) => {
      const params = { limit: attackLogsLimit, ...extra };
      const un = (overrides.username !== undefined ? overrides.username : attackLogsUsername || '').trim();
      if (un) params.username = un;
      if (attackLogsExcludeNpc) params.exclude_target_npc = true;
      const days = overrides.daysFilter !== undefined ? overrides.daysFilter : daysFilter;
      if (days) params.days = parseInt(days, 10);
      const role = overrides.roleFilter !== undefined ? overrides.roleFilter : roleFilter;
      if (role) params.role = role;
      const prot = (overrides.protecteeFilter !== undefined ? overrides.protecteeFilter : protecteeFilter || '').trim();
      if (prot) params.protectee = prot;
      const guard = (overrides.guardFilter !== undefined ? overrides.guardFilter : guardFilter || '').trim();
      if (guard) params.guard_username = guard;
      const ef = overrides.eventFilter !== undefined ? overrides.eventFilter : eventFilter;
      if (ef === 'block' || ef === 'kill' || ef === 'any') {
        params.bodyguard_event = ef;
      } else if (ef && ef.startsWith('outcome:')) {
        params.outcome = ef.replace('outcome:', '');
      }
      return params;
    },
    [attackLogsLimit, attackLogsUsername, attackLogsExcludeNpc, daysFilter, roleFilter, protecteeFilter, guardFilter, eventFilter],
  );

  const fetchBodyguardIntel = useCallback(async (username) => {
    const un = (username || attackLogsUsername || '').trim();
    if (!un) {
      setBodyguardIntel(null);
      return;
    }
    setIntelLoading(true);
    try {
      const res = await api.get('/admin/attacks/bodyguard-intel', {
        params: { username: un, perspective: 'both', days: daysFilter ? parseInt(daysFilter, 10) : 30 },
      });
      setBodyguardIntel(res.data || null);
    } catch (e) {
      setBodyguardIntel(null);
      toast.error(e.response?.data?.detail || 'Failed to load bodyguard intel');
    } finally {
      setIntelLoading(false);
    }
  }, [attackLogsUsername, daysFilter]);

  const fetchGlobalIntel = useCallback(async () => {
    if (!showGlobalIntel) return;
    setGlobalIntelLoading(true);
    try {
      const res = await api.get('/admin/attacks/bodyguard-intel/global', {
        params: { days: daysFilter ? parseInt(daysFilter, 10) : 7, limit: 25 },
      });
      setGlobalIntel(res.data || null);
    } catch {
      setGlobalIntel(null);
    } finally {
      setGlobalIntelLoading(false);
    }
  }, [showGlobalIntel, daysFilter]);

  const reportCount = useCallback(
    (data) => {
      onCountChange?.(data?.logs != null ? data.logs.length : null);
    },
    [onCountChange],
  );

  useEffect(() => {
    reportCount(attackLogsData);
  }, [attackLogsData, reportCount]);

  useEffect(() => {
    if (showGlobalIntel && !(attackLogsUsername || '').trim()) {
      fetchGlobalIntel();
    }
  }, [showGlobalIntel, fetchGlobalIntel, attackLogsUsername]);

  const handleFetchAttackLogs = async (overrides = {}) => {
    if (overrides.eventFilter !== undefined) setEventFilter(overrides.eventFilter);
    if (overrides.roleFilter !== undefined) setRoleFilter(overrides.roleFilter);
    if (overrides.protecteeFilter !== undefined) setProtecteeFilter(overrides.protecteeFilter);
    if (overrides.guardFilter !== undefined) setGuardFilter(overrides.guardFilter);
    setAttackLogsLoading(true);
    setAttackLogsData(null);
    try {
      const res = await api.get('/admin/attacks/logs', { params: buildLogParams({}, overrides) });
      const payload = res.data || null;
      setAttackLogsData(payload);
      toast.success(`Loaded ${payload?.logs?.length ?? 0} attack log entries`);
      const un = (attackLogsUsername || '').trim();
      if (un) {
        onLogsLoaded?.(un);
        fetchBodyguardIntel(un);
      } else {
        onLogsLoaded?.(null);
        setBodyguardIntel(null);
        if (showGlobalIntel) fetchGlobalIntel();
      }
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load attack logs');
    } finally {
      setAttackLogsLoading(false);
    }
  };

  const filterByGuard = (guardName) => {
    handleFetchAttackLogs({ guardFilter: guardName, eventFilter: 'block' });
  };

  const filterByProtectee = (name) => {
    handleFetchAttackLogs({ protecteeFilter: name, eventFilter: 'block' });
  };

  useEffect(() => {
    if (!attackLogsLive) return;
    const limit = attackLogsLimit;
    const run = async () => {
      try {
        const prev = attackLogsDataRef.current;
        const since = prev?.logs?.length ? prev.logs[0].created_at : null;
        const params = buildLogParams({ limit: since ? 100 : limit });
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
  }, [attackLogsLive, buildLogParams, attackLogsLimit]);

  useEffect(() => {
    if (!attackLogViewRow?.id || !attackLogsData?.logs?.length) return;
    const found = attackLogsData.logs.find((l) => l.id === attackLogViewRow.id);
    if (found) setAttackLogViewRow(found);
  }, [attackLogsData, attackLogViewRow?.id]);

  const summary = attackLogsData?.summary;
  const intelUser = bodyguardIntel?.username || (attackLogsUsername || '').trim();

  return (
    <div className="space-y-3">
      {introText ? <p className="text-[10px] text-mutedForeground font-heading">{introText}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={attackLogsUsername}
          onChange={(e) => setAttackLogsUsername(e.target.value)}
          placeholder="Username (optional)"
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
        <select
          value={eventFilter}
          onChange={(e) => setEventFilter(e.target.value)}
          className="px-2 py-1 rounded border border-input bg-transparent text-[10px] font-heading max-w-[140px]"
          title="Event type filter"
        >
          {EVENT_FILTER_OPTIONS.map((o) => (
            <option key={o.value || 'all'} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          value={daysFilter}
          onChange={(e) => setDaysFilter(e.target.value)}
          className="px-2 py-1 rounded border border-input bg-transparent text-[10px] font-heading"
        >
          {DAYS_OPTIONS.map((o) => (
            <option key={o.value || 'none'} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {(attackLogsUsername || '').trim() ? (
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="px-2 py-1 rounded border border-input bg-transparent text-[10px] font-heading"
            title="Role when username set"
          >
            <option value="">As attacker or target</option>
            <option value="attacker">As attacker only</option>
            <option value="target">As target only</option>
          </select>
        ) : null}
        <input
          type="text"
          value={protecteeFilter}
          onChange={(e) => setProtecteeFilter(e.target.value)}
          placeholder="Protectee"
          className="w-28 px-2 py-1 rounded border border-input bg-transparent text-[10px] font-heading"
          title="Victim whose guard blocked (e.g. Moey)"
        />
        <input
          type="text"
          value={guardFilter}
          onChange={(e) => setGuardFilter(e.target.value)}
          placeholder="Guard name"
          className="w-32 px-2 py-1 rounded border border-input bg-transparent text-[10px] font-heading"
          title="Blocking bodyguard username"
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
        <label
          className="flex items-center gap-1.5 text-[10px] font-heading text-mutedForeground cursor-pointer"
          title="Hide hitlist and other NPC targets"
        >
          <input
            type="checkbox"
            checked={attackLogsExcludeNpc}
            onChange={(e) => setAttackLogsExcludeNpc(e.target.checked)}
            className="rounded border border-input"
          />
          Hide NPC / hitlist
        </label>
        {attackLogsLive && <span className="text-[9px] text-primary font-heading">Refreshing every 5s</span>}
      </div>
      {(attackLogsUsername || '').trim() ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() =>
              handleFetchAttackLogs({
                eventFilter: 'block',
                roleFilter: 'target',
                protecteeFilter: attackLogsUsername.trim(),
                guardFilter: '',
              })
            }
            className="text-[9px] uppercase tracking-wider text-primary border border-primary/40 rounded px-2 py-0.5 hover:bg-primary/10 font-heading"
          >
            Blocks protecting this user
          </button>
          <button
            type="button"
            onClick={() =>
              handleFetchAttackLogs({
                eventFilter: 'block',
                roleFilter: 'attacker',
                protecteeFilter: '',
                guardFilter: '',
              })
            }
            className="text-[9px] uppercase tracking-wider text-primary border border-primary/40 rounded px-2 py-0.5 hover:bg-primary/10 font-heading"
          >
            Blocks by this attacker
          </button>
        </div>
      ) : null}
      <p className="text-[9px] text-mutedForeground font-heading">
        Token-fail correlation: Admin → Cheat Detection → Kill / attack — execute_token failures → Load spoof report.
      </p>

      {(intelUser || showGlobalIntel) && (intelLoading || bodyguardIntel || globalIntelLoading || globalIntel) ? (
        <div className="rounded border border-amber-500/30 bg-amber-500/5 p-2 space-y-2">
          <div className="text-[10px] font-heading font-bold uppercase tracking-wider text-amber-200/90">Bodyguard intel</div>
          {intelLoading && <p className="text-[10px] text-mutedForeground">Loading intel…</p>}
          {bodyguardIntel && !intelLoading && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <div>
                <p className="text-[9px] uppercase text-mutedForeground mb-1">
                  Guards blocking for {intelUser} ({bodyguardIntel.days}d)
                </p>
                <div className="max-h-32 overflow-y-auto">
                  <table className="w-full text-[9px] font-heading">
                    <thead>
                      <tr className="text-mutedForeground">
                        <th className="text-left pr-2">Guard</th>
                        <th className="text-right pr-2">Blocks</th>
                        <th className="text-left">Attackers</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(bodyguardIntel.protectee || []).length === 0 ? (
                        <tr>
                          <td colSpan={3} className="text-mutedForeground">
                            No blocks
                          </td>
                        </tr>
                      ) : (
                        (bodyguardIntel.protectee || []).map((row, i) => (
                          <tr key={i} className="border-t border-zinc-700/30">
                            <td className="py-0.5 pr-2">
                              <button
                                type="button"
                                className="text-primary hover:underline text-left"
                                onClick={() => filterByGuard(row.guard_username)}
                              >
                                {row.guard_username}
                              </button>
                            </td>
                            <td className="py-0.5 pr-2 text-right tabular-nums">{row.block_count}</td>
                            <td className="py-0.5 text-mutedForeground truncate max-w-[200px]" title={(row.top_attackers || []).join(', ')}>
                              {(row.top_attackers || []).slice(0, 3).join(', ') || '—'}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
              <div>
                <p className="text-[9px] uppercase text-mutedForeground mb-1">
                  Targets/guards {intelUser} ran into ({bodyguardIntel.days}d)
                </p>
                <div className="max-h-32 overflow-y-auto">
                  <table className="w-full text-[9px] font-heading">
                    <thead>
                      <tr className="text-mutedForeground">
                        <th className="text-left pr-2">Protectee</th>
                        <th className="text-left pr-2">Guard</th>
                        <th className="text-right">Blocks</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(bodyguardIntel.attacker || []).length === 0 ? (
                        <tr>
                          <td colSpan={3} className="text-mutedForeground">
                            No blocks
                          </td>
                        </tr>
                      ) : (
                        (bodyguardIntel.attacker || []).map((row, i) => (
                          <tr key={i} className="border-t border-zinc-700/30">
                            <td className="py-0.5 pr-2">
                              <button
                                type="button"
                                className="text-primary hover:underline"
                                onClick={() => filterByProtectee(row.protectee_username)}
                              >
                                {row.protectee_username}
                              </button>
                            </td>
                            <td className="py-0.5 pr-2">
                              <button
                                type="button"
                                className="text-primary hover:underline"
                                onClick={() => filterByGuard(row.guard_username)}
                              >
                                {row.guard_username}
                              </button>
                            </td>
                            <td className="py-0.5 text-right tabular-nums">{row.block_count}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
          {showGlobalIntel && !attackLogsUsername.trim() && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 border-t border-zinc-700/40 pt-2">
              {globalIntelLoading && <p className="text-[10px] text-mutedForeground col-span-2">Loading global intel…</p>}
              {globalIntel && !globalIntelLoading && (
                <>
                  <div>
                    <p className="text-[9px] uppercase text-mutedForeground mb-1">Top attackers hitting bodyguards</p>
                    <ul className="text-[9px] space-y-0.5 max-h-28 overflow-y-auto">
                      {(globalIntel.top_attackers_by_blocks || []).slice(0, 15).map((r, i) => (
                        <li key={i}>
                          <span className="text-foreground">{r.attacker_username}</span>
                          <span className="text-mutedForeground"> — {r.block_count} blocks</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="text-[9px] uppercase text-mutedForeground mb-1">Top protectees (most blocks)</p>
                    <ul className="text-[9px] space-y-0.5 max-h-28 overflow-y-auto">
                      {(globalIntel.top_protectees_by_blocks || []).slice(0, 15).map((r, i) => (
                        <li key={i}>
                          <button
                            type="button"
                            className="text-primary hover:underline"
                            onClick={() => filterByProtectee(r.protectee_username)}
                          >
                            {r.protectee_username}
                          </button>
                          <span className="text-mutedForeground"> — {r.block_count} blocks</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      ) : null}

      {attackLogsData && (
        <div className={`overflow-x-auto overflow-y-auto ${tableMaxHeightClass}`}>
          <p className="text-[10px] font-heading text-primary mb-1">
            {attackLogsData.scope === 'all' || attackLogsData.username == null ? (
              <>
                Showing: <strong>All players</strong> (limit {attackLogsLimit}
                {attackLogsData.exclude_target_npc ? ', NPC excluded' : ''})
              </>
            ) : (
              <>
                Attack log for: <strong>{attackLogsData.username}</strong>
                {attackLogsData.exclude_target_npc ? ' (NPC excluded)' : ''}
              </>
            )}
            {summary ? (
              <span className="text-mutedForeground ml-2">
                — {summary.total} rows
                {summary.bodyguard_blocks > 0 ? ` · ${summary.bodyguard_blocks} BG blocks` : ''}
                {summary.bodyguard_kills > 0 ? ` · ${summary.bodyguard_kills} BG kills` : ''}
                {summary.errors > 0 ? ` · ${summary.errors} errors` : ''}
              </span>
            ) : null}
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
                  <th className="py-1 pr-1 font-bold text-mutedForeground uppercase">Guard</th>
                  <th className="py-1 pr-1 font-bold text-mutedForeground uppercase">Slot</th>
                  <th className="py-1 pr-1 font-bold text-mutedForeground uppercase" title="Protectee on block; guard owner on BG kill">
                    Protectee / owner
                  </th>
                  <th className="py-1 pr-1 font-bold text-mutedForeground uppercase">BG</th>
                  <th className="py-1 pr-1 font-bold text-mutedForeground uppercase max-w-[180px]">Message</th>
                  <th className="py-1 pr-1 font-bold text-mutedForeground uppercase">IP</th>
                  <th className="py-1 pr-1 font-bold text-mutedForeground uppercase">Device</th>
                  <th className="py-1 pr-1 font-bold text-mutedForeground uppercase">Bot?</th>
                  <th className="py-1 pr-1 font-bold text-mutedForeground uppercase">Flags</th>
                  <th className="py-1 pr-1 font-bold text-mutedForeground uppercase">Risk</th>
                  <th className="py-1 pr-1 font-bold text-mutedForeground uppercase">Bullets</th>
                  <th className="py-1 pr-1 font-bold text-mutedForeground uppercase">Loc</th>
                  <th className="py-1 pr-1 font-bold text-mutedForeground uppercase">Time</th>
                  <th className="py-1 font-bold text-mutedForeground uppercase">View</th>
                </tr>
              </thead>
              <tbody>
                {attackLogsData.logs.map((row, idx) => {
                  const { device } = parseAttackLogUA(row.user_agent);
                  const botCell = formatAttackLogBotCell(row);
                  const integCell = formatAttackLogIntegrityCell(row);
                  const bgCell = formatAttackLogBodyguardCell(row);
                  const isBgBlock = row.outcome === 'bodyguard';
                  const risk =
                    row.client_risk_score != null && row.client_risk_score !== ''
                      ? Number(row.client_risk_score)
                      : null;
                  return (
                    <tr
                      key={row.id || idx}
                      className={`border-b border-zinc-700/30 ${isBgBlock ? 'bg-amber-500/5' : ''}`}
                    >
                      <td className="py-1 pr-1 text-foreground">{row.attacker_username ?? '—'}</td>
                      <td className="py-1 pr-1 text-foreground">{row.target_username ?? '—'}</td>
                      <td className="py-1 pr-1">
                        {row.outcome === 'killed' && <span className="text-red-400">Killed</span>}
                        {row.outcome === 'failed' && <span className="text-amber-400">Failed</span>}
                        {row.outcome === 'bodyguard' && <span className="text-amber-500">Bodyguard</span>}
                        {row.outcome === 'error' && <span className="text-orange-400">Error</span>}
                        {row.outcome === 'travel' && <span className="text-sky-400">Travel</span>}
                        {!['killed', 'failed', 'bodyguard', 'error', 'travel'].includes(row.outcome) &&
                          (row.outcome ? <span className="text-mutedForeground">{row.outcome}</span> : '—')}
                      </td>
                      <td
                        className="py-1 pr-1 text-amber-200/90 max-w-[100px] truncate"
                        title={formatBodyguardBlockSummary(row)}
                      >
                        {formatBlockingBodyguard(row)}
                      </td>
                      <td className="py-1 pr-1 text-mutedForeground tabular-nums">{formatBodyguardSlot(row)}</td>
                      <td className="py-1 pr-1 text-mutedForeground max-w-[90px] truncate">
                        {formatAttackLogProtecteeOrOwner(row)}
                      </td>
                      <td className="py-1 pr-1">
                        {bgCell.text === '—' ? (
                          '—'
                        ) : (
                          <span className={bgCell.className} title={bgCell.title || undefined}>
                            {bgCell.text}
                          </span>
                        )}
                      </td>
                      <td
                        className="py-1 pr-1 max-w-[180px] text-mutedForeground break-words line-clamp-2 leading-snug"
                        title={row.player_message ?? ''}
                      >
                        {row.player_message ?? '—'}
                      </td>
                      <td className="py-1 pr-1 text-mutedForeground font-mono text-[8px]">{row.client_ip ?? '—'}</td>
                      <td className="py-1 pr-1 text-mutedForeground">{device}</td>
                      <td className="py-1 pr-1">
                        {botCell.text === '—' ? (
                          '—'
                        ) : (
                          <span className={botCell.className} title={botCell.title || undefined}>
                            {botCell.text}
                          </span>
                        )}
                      </td>
                      <td className="py-1 pr-1">
                        {integCell.text === '—' ? (
                          '—'
                        ) : (
                          <span className={integCell.className} title={integCell.title || undefined}>
                            {integCell.text}
                          </span>
                        )}
                      </td>
                      <td className="py-1 pr-1 font-mono tabular-nums">
                        {risk != null && !Number.isNaN(risk) ? (
                          <span className={risk >= 35 ? 'text-amber-400' : 'text-mutedForeground'}>{risk}</span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="py-1 pr-1">{row.bullets_used != null ? Number(row.bullets_used).toLocaleString() : '—'}</td>
                      <td className="py-1 pr-1 text-mutedForeground">{row.location_state ?? row.state ?? '—'}</td>
                      <td className="py-1 pr-1 text-mutedForeground font-mono whitespace-nowrap">
                        {formatAttackLogTime(row.created_at)}
                      </td>
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
              <button
                type="button"
                onClick={() => setAttackLogViewRow(null)}
                className="p-1 rounded border border-zinc-600 text-zinc-400 hover:bg-zinc-700 hover:text-foreground"
                aria-label="Close"
              >
                <X size={14} />
              </button>
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
                  <span className="text-mutedForeground">Outcome:</span>{' '}
                  {attackLogViewRow.outcome === 'travel' ? 'Traveled' : attackLogViewRow.outcome ?? '—'}
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
                {attackLogViewRow.attack_id && (
                  <div className="col-span-2">
                    <span className="text-mutedForeground">Attack id:</span>{' '}
                    <span className="font-mono text-[9px]">{attackLogViewRow.attack_id}</span>
                  </div>
                )}
                <div>
                  <span className="text-mutedForeground">Bot?</span>{' '}
                  {(() => {
                    const c = formatAttackLogBotCell(attackLogViewRow);
                    return c.text === '—' ? (
                      '—'
                    ) : (
                      <span className={c.className} title={c.title || undefined}>
                        {c.text}
                      </span>
                    );
                  })()}
                </div>
                {formatAttackLogBotRationale(attackLogViewRow) ? (
                  <div className="col-span-2">
                    <span className="text-mutedForeground font-bold uppercase tracking-wider text-[9px]">Bot / client rationale</span>
                    <p className="text-foreground/90 text-[9px] mt-1 leading-relaxed">{formatAttackLogBotRationale(attackLogViewRow)}</p>
                  </div>
                ) : null}
                {attackLogViewRow.integrity_violation && (
                  <div className="col-span-2 rounded border border-red-500/40 bg-red-500/10 px-2 py-1.5">
                    <span className="text-mutedForeground font-bold uppercase tracking-wider text-[9px]">Integrity</span>
                    <p className="text-red-200 text-[10px] mt-1">{String(attackLogViewRow.integrity_violation).replace(/_/g, ' ')}</p>
                  </div>
                )}
                <div>
                  <span className="text-mutedForeground">Time:</span> {formatAttackLogTime(attackLogViewRow.created_at)}
                </div>
              </div>
              {(attackLogViewRow.outcome === 'bodyguard' || attackLogViewRow.is_bodyguard_kill) && (
                <div className="rounded border border-amber-500/30 bg-amber-500/5 p-2 space-y-1">
                  <div className="text-mutedForeground font-bold uppercase tracking-wider text-[9px]">Bodyguard</div>
                  {attackLogViewRow.outcome === 'bodyguard' && (
                    <>
                      <p>
                        <span className="text-mutedForeground">Protectee:</span>{' '}
                        {attackLogViewRow.protected_username || attackLogViewRow.target_username || '—'}
                      </p>
                      <p>
                        <span className="text-mutedForeground">Blocking guard:</span>{' '}
                        <button
                          type="button"
                          className="text-primary hover:underline"
                          onClick={() => {
                            filterByGuard(formatBlockingBodyguard(attackLogViewRow));
                            setAttackLogViewRow(null);
                          }}
                        >
                          {formatBlockingBodyguard(attackLogViewRow)}
                        </button>
                      </p>
                      <p>
                        <span className="text-mutedForeground">Slot:</span> {formatBodyguardSlot(attackLogViewRow)}
                      </p>
                      {formatBodyguardBlockSummary(attackLogViewRow) && (
                        <p className="text-mutedForeground text-[9px]">{formatBodyguardBlockSummary(attackLogViewRow)}</p>
                      )}
                    </>
                  )}
                  {attackLogViewRow.is_bodyguard_kill && (
                    <p>
                      <span className="text-mutedForeground">Guard owner:</span>{' '}
                      {attackLogViewRow.bodyguard_owner_username || '—'}
                    </p>
                  )}
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
              {attackLogViewRow.client_header_snapshot && typeof attackLogViewRow.client_header_snapshot === 'object' && (
                <div>
                  <div className="text-mutedForeground font-bold uppercase tracking-wider border-b border-zinc-700/50 pb-0.5 mb-1">
                    Header snapshot
                  </div>
                  <pre className="text-foreground font-mono text-[9px] whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
                    {JSON.stringify(attackLogViewRow.client_header_snapshot, null, 2)}
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
