import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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
  formatSlotDisplay,
  formatAttackLogProtecteeOrOwner,
  formatBodyguardBlockSummary,
  parseAttackLogUA,
  groupAttackLogsByEncounter,
} from '../../utils/attackLogDisplay';

function buildGuardRotationSteps(rotation) {
  if (!rotation) return [];
  const steps = [];
  for (const h of rotation.hires || []) {
    steps.push({
      kind: 'hire',
      at: h.at,
      guard: h.guard_username || '—',
      meta: [
        h.is_robot ? 'robot' : 'human',
        h.slot != null ? `slot ${formatSlotDisplay(h.slot) || h.slot}` : '',
        h.hire_cost ? `${Number(h.hire_cost).toLocaleString()} pts` : '',
      ]
        .filter(Boolean)
        .join(' · '),
    });
  }
  for (const g of rotation.guard_timeline || []) {
    steps.push({
      kind: 'blocks',
      at: g.first_at,
      guard: g.guard_username,
      meta: `${g.block_count} blocks · ${formatAttackLogTime(g.first_at)} → ${formatAttackLogTime(g.last_at)} · attackers: ${(g.top_attackers || []).slice(0, 3).join(', ') || '—'}`,
    });
  }
  for (const k of rotation.guard_kills || []) {
    steps.push({
      kind: 'kill',
      at: k.at,
      guard: k.guard_username || '—',
      meta: k.killer_username ? `killed by ${k.killer_username}` : '',
    });
  }
  steps.sort((a, b) => {
    const ta = a.at ? new Date(a.at).getTime() : 0;
    const tb = b.at ? new Date(b.at).getTime() : 0;
    return ta - tb;
  });
  return steps;
}

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
  const [targetFilter, setTargetFilter] = useState('');
  const [attackerFilter, setAttackerFilter] = useState('');
  const [daysFilter, setDaysFilter] = useState('30');
  const [bodyguardIntel, setBodyguardIntel] = useState(null);
  const [targetIntel, setTargetIntel] = useState(null);
  const [targetIntelLoading, setTargetIntelLoading] = useState(false);
  const [targetNarrative, setTargetNarrative] = useState(null);
  const [multiAttackerTargets, setMultiAttackerTargets] = useState(null);
  const [multiAttackerLoading, setMultiAttackerLoading] = useState(false);
  const [intelLoading, setIntelLoading] = useState(false);
  const [globalIntel, setGlobalIntel] = useState(null);
  const [globalIntelLoading, setGlobalIntelLoading] = useState(false);
  const [groupDuplicates, setGroupDuplicates] = useState(true);
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
      const tgt = (overrides.targetFilter !== undefined ? overrides.targetFilter : targetFilter || '').trim();
      if (tgt) params.target_username = tgt;
      const atk = (overrides.attackerFilter !== undefined ? overrides.attackerFilter : attackerFilter || '').trim();
      if (atk) params.attacker_username = atk;
      const ef = overrides.eventFilter !== undefined ? overrides.eventFilter : eventFilter;
      if (ef === 'block' || ef === 'kill' || ef === 'any') {
        params.bodyguard_event = ef;
      } else if (ef && ef.startsWith('outcome:')) {
        params.outcome = ef.replace('outcome:', '');
      }
      return params;
    },
    [attackLogsLimit, attackLogsUsername, attackLogsExcludeNpc, daysFilter, roleFilter, protecteeFilter, guardFilter, targetFilter, attackerFilter, eventFilter],
  );

  const resolveTargetIntelUsername = useCallback(
    (overrides = {}) => {
      const tgt = (overrides.targetFilter !== undefined ? overrides.targetFilter : targetFilter || '').trim();
      if (tgt) return tgt;
      const role = overrides.roleFilter !== undefined ? overrides.roleFilter : roleFilter;
      const un = (overrides.username !== undefined ? overrides.username : attackLogsUsername || '').trim();
      if (un && role === 'target') return un;
      return '';
    },
    [targetFilter, roleFilter, attackLogsUsername],
  );

  const fetchTargetIntel = useCallback(
    async (targetName) => {
      const name = (targetName || resolveTargetIntelUsername() || '').trim();
      if (!name) {
        setTargetIntel(null);
        setTargetNarrative(null);
        return;
      }
      setTargetIntelLoading(true);
      try {
        const params = {
          username: name,
          days: daysFilter ? parseInt(daysFilter, 10) : 30,
          exclude_target_npc: attackLogsExcludeNpc,
        };
        const [intelRes, narrativeRes] = await Promise.all([
          api.get('/admin/attacks/target-intel', { params }),
          api.get('/admin/attacks/target-narrative', { params }),
        ]);
        setTargetIntel(intelRes.data || null);
        setTargetNarrative(narrativeRes.data || null);
      } catch (e) {
        setTargetIntel(null);
        setTargetNarrative(null);
        toast.error(e.response?.data?.detail || 'Failed to load target intel');
      } finally {
        setTargetIntelLoading(false);
      }
    },
    [resolveTargetIntelUsername, daysFilter, attackLogsExcludeNpc],
  );

  const fetchMultiAttackerTargets = useCallback(async () => {
    setMultiAttackerLoading(true);
    setMultiAttackerTargets(null);
    try {
      const res = await api.get('/admin/attacks/multi-attacker-targets', {
        params: {
          days: daysFilter ? parseInt(daysFilter, 10) : 30,
          min_attackers: 2,
          limit: 50,
          exclude_target_npc: attackLogsExcludeNpc,
        },
      });
      setMultiAttackerTargets(res.data || null);
      toast.success(`Found ${res.data?.target_count ?? 0} multi-attacker victims`);
    } catch (e) {
      setMultiAttackerTargets(null);
      toast.error(e.response?.data?.detail || 'Failed to load multi-attacker targets');
    } finally {
      setMultiAttackerLoading(false);
    }
  }, [daysFilter, attackLogsExcludeNpc]);

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
    if (overrides.targetFilter !== undefined) setTargetFilter(overrides.targetFilter);
    if (overrides.attackerFilter !== undefined) setAttackerFilter(overrides.attackerFilter);
    setAttackLogsLoading(true);
    setAttackLogsData(null);
    try {
      const res = await api.get('/admin/attacks/logs', { params: buildLogParams({}, overrides) });
      const payload = res.data || null;
      setAttackLogsData(payload);
      toast.success(`Loaded ${payload?.logs?.length ?? 0} attack log entries`);
      const un = (attackLogsUsername || '').trim();
      const prot =
        (overrides.protecteeFilter !== undefined ? overrides.protecteeFilter : protecteeFilter || '').trim();
      const intelSubject = prot || un;
      const targetForIntel = resolveTargetIntelUsername(overrides) || prot || (un && roleFilter === 'target' ? un : '');
      if (targetForIntel) {
        fetchTargetIntel(targetForIntel);
      } else {
        setTargetIntel(null);
        setTargetNarrative(null);
      }
      if (intelSubject) {
        onLogsLoaded?.(intelSubject);
        fetchBodyguardIntel(intelSubject);
      } else if (un) {
        onLogsLoaded?.(un);
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

  const filterByTarget = (name) => {
    setAttackLogsUsername('');
    setRoleFilter('');
    handleFetchAttackLogs({
      username: '',
      targetFilter: name,
      eventFilter: '',
      protecteeFilter: '',
      guardFilter: '',
    });
  };

  const filterByAttackerOnTarget = (attackerName, targetName) => {
    handleFetchAttackLogs({
      targetFilter: targetName,
      attackerFilter: attackerName,
      username: '',
      roleFilter: '',
      eventFilter: '',
      protecteeFilter: '',
      guardFilter: '',
    });
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
  const intelUser =
    bodyguardIntel?.username || (protecteeFilter || '').trim() || (attackLogsUsername || '').trim();
  const guardRotation = bodyguardIntel?.protectee_guard_rotation;
  const guardRotationSteps = useMemo(() => buildGuardRotationSteps(guardRotation), [guardRotation]);
  const targetIntelUser =
    targetIntel?.target_username ||
    attackLogsData?.target_username ||
    (targetFilter || '').trim() ||
    (roleFilter === 'target' && (attackLogsUsername || '').trim() ? attackLogsUsername.trim() : '');
  const logGroups = useMemo(
    () => (groupDuplicates && attackLogsData?.logs?.length ? groupAttackLogsByEncounter(attackLogsData.logs) : null),
    [attackLogsData?.logs, groupDuplicates],
  );
  const displayRowCount = logGroups ? logGroups.length : attackLogsData?.logs?.length ?? 0;
  const attackerSummary = bodyguardIntel?.attacker_summary;
  const protecteeSummary = bodyguardIntel?.protectee_summary;

  const narrativeKindClass = (kind) => {
    if (kind === 'guard_killed') return 'text-rose-300';
    if (kind === 'guard_block') return 'text-amber-300';
    if (kind === 'attack_failed') return 'text-amber-400/90';
    if (kind === 'target_killed') return 'text-red-400 font-bold';
    return 'text-mutedForeground';
  };

  const renderLogRow = (row, idx, groupMeta = null) => {
    const { device } = parseAttackLogUA(row.user_agent);
    const botCell = formatAttackLogBotCell(row);
    const integCell = formatAttackLogIntegrityCell(row);
    const bgCell = formatAttackLogBodyguardCell(row);
    const isBgBlock = row.outcome === 'bodyguard';
    const risk =
      row.client_risk_score != null && row.client_risk_score !== ''
        ? Number(row.client_risk_score)
        : null;
    const dupCount = groupMeta?.count ?? 1;
    return (
      <tr
        key={groupMeta?.key || row.id || idx}
        className={`border-b border-zinc-700/30 ${isBgBlock ? 'bg-amber-500/5' : ''}`}
      >
        {groupDuplicates && logGroups ? (
          <td className="py-1 pr-1 tabular-nums">
            {dupCount > 1 ? (
              <span className="px-1 py-0.5 rounded bg-amber-500/20 text-amber-200 font-bold" title={`${dupCount} identical encounters`}>
                ×{dupCount.toLocaleString()}
              </span>
            ) : (
              <span className="text-mutedForeground">1</span>
            )}
          </td>
        ) : null}
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
        <td className="py-1 pr-1 text-amber-200/90 max-w-[100px] truncate" title={formatBodyguardBlockSummary(row)}>
          {formatBlockingBodyguard(row)}
        </td>
        <td className="py-1 pr-1 text-mutedForeground tabular-nums">{formatBodyguardSlot(row)}</td>
        <td className="py-1 pr-1 text-mutedForeground max-w-[90px] truncate">{formatAttackLogProtecteeOrOwner(row)}</td>
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
          {groupMeta && dupCount > 1 ? (
            <span title={`First: ${formatAttackLogTime(groupMeta.first_at)}`}>
              {formatAttackLogTime(groupMeta.last_at)}
              <span className="text-[8px] text-mutedForeground block">…{formatAttackLogTime(groupMeta.first_at)}</span>
            </span>
          ) : (
            formatAttackLogTime(row.created_at)
          )}
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
  };

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
          title="Bodyguard protectee (blocks only)"
        />
        <input
          type="text"
          value={targetFilter}
          onChange={(e) => setTargetFilter(e.target.value)}
          placeholder="Target victim"
          className="w-28 px-2 py-1 rounded border border-input bg-transparent text-[10px] font-heading"
          title="Victim of any attack (kills, fails, blocks, etc.)"
        />
        <input
          type="text"
          value={attackerFilter}
          onChange={(e) => setAttackerFilter(e.target.value)}
          placeholder="Attacker"
          className="w-28 px-2 py-1 rounded border border-input bg-transparent text-[10px] font-heading"
          title="Filter to a specific attacker (combine with target victim)"
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
        <label className="flex items-center gap-1.5 text-[10px] font-heading text-mutedForeground cursor-pointer" title="One row per attacker/target/guard combination">
          <input
            type="checkbox"
            checked={groupDuplicates}
            onChange={(e) => setGroupDuplicates(e.target.checked)}
            className="rounded border border-input"
          />
          Group duplicate rows
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
          <button
            type="button"
            onClick={() =>
              handleFetchAttackLogs({
                username: attackLogsUsername.trim(),
                roleFilter: 'target',
                eventFilter: '',
                protecteeFilter: '',
                guardFilter: '',
                targetFilter: '',
                attackerFilter: '',
              })
            }
            className="text-[9px] uppercase tracking-wider text-sky-300 border border-sky-500/40 rounded px-2 py-0.5 hover:bg-sky-500/10 font-heading"
          >
            All attacks on this user
          </button>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={fetchMultiAttackerTargets}
          disabled={multiAttackerLoading}
          className="text-[9px] uppercase tracking-wider text-red-300 border border-red-500/40 rounded px-2 py-0.5 hover:bg-red-500/10 font-heading disabled:opacity-50"
        >
          {multiAttackerLoading ? 'Scanning…' : 'Multi-attacker victims'}
        </button>
      </div>
      <p className="text-[9px] text-mutedForeground font-heading">
        Token-fail correlation: Admin → Cheat Detection → Kill / attack — execute_token failures → Load spoof report.
      </p>

      {(intelUser || showGlobalIntel) && (intelLoading || bodyguardIntel || globalIntelLoading || globalIntel) ? (
        <div className="rounded border border-amber-500/30 bg-amber-500/5 p-2 space-y-2">
          <div className="text-[10px] font-heading font-bold uppercase tracking-wider text-amber-200/90">Bodyguard intel</div>
          {(attackerSummary || protecteeSummary) && bodyguardIntel && !intelLoading && (
            <div className="text-[10px] text-zinc-200/95 space-y-1">
              {attackerSummary && attackerSummary.total_blocks > 0 ? (
                <p>
                  <span className="text-foreground font-medium">{intelUser}</span> ran into{' '}
                  <strong className="text-amber-200">{attackerSummary.distinct_protectees}</strong> protectee
                  {attackerSummary.distinct_protectees === 1 ? '' : 's'} across{' '}
                  <strong className="text-amber-200">{attackerSummary.distinct_guards}</strong> guard
                  {attackerSummary.distinct_guards === 1 ? '' : 's'} ({attackerSummary.encounter_pairs} unique pair
                  {attackerSummary.encounter_pairs === 1 ? '' : 's'}, {attackerSummary.total_blocks.toLocaleString()} total blocks in{' '}
                  {bodyguardIntel.days}d).
                  {attackerSummary.distinct_protectees > 1 || attackerSummary.distinct_guards > 1 ? (
                    <span className="text-amber-300/90"> Multiple bodyguards / protectees — use grouped view below.</span>
                  ) : null}
                </p>
              ) : null}
              {protecteeSummary && protecteeSummary.total_blocks > 0 ? (
                <p>
                  Guards blocking for <span className="text-foreground font-medium">{intelUser}</span>:{' '}
                  <strong className="text-amber-200">{protecteeSummary.distinct_guards}</strong> distinct guard
                  {protecteeSummary.distinct_guards === 1 ? '' : 's'} from{' '}
                  <strong className="text-amber-200">{protecteeSummary.distinct_attackers}</strong> attacker
                  {protecteeSummary.distinct_attackers === 1 ? '' : 's'} ({protecteeSummary.total_blocks.toLocaleString()} blocks in{' '}
                  {bodyguardIntel.days}d).
                  {protecteeSummary.distinct_guards > 1 ? (
                    <span className="text-amber-300/90"> See guard rotation timeline below.</span>
                  ) : null}
                </p>
              ) : null}
              {guardRotation?.rotation_alert?.likely_mid_fight_hires ? (
                <p className="text-amber-200/95 border border-amber-500/40 rounded px-2 py-1 bg-amber-500/10">
                  {guardRotation.rotation_alert.detail}
                </p>
              ) : null}
            </div>
          )}
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
                        <th className="text-left">First seen</th>
                        <th className="text-left">Attackers</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(bodyguardIntel.protectee || []).length === 0 ? (
                        <tr>
                          <td colSpan={4} className="text-mutedForeground">
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
                            <td className="py-0.5 pr-2 text-mutedForeground whitespace-nowrap">
                              {formatAttackLogTime(row.first_at)}
                            </td>
                            <td className="py-0.5 text-mutedForeground truncate max-w-[160px]" title={(row.top_attackers || []).join(', ')}>
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
          {bodyguardIntel && !intelLoading && guardRotation && (guardRotationSteps.length > 0 || guardRotation.rotation_alert) ? (
            <div className="border-t border-amber-500/25 pt-2 space-y-2">
              <p className="text-[9px] uppercase text-amber-200/80 font-bold tracking-wider">
                Guard rotation — {intelUser} (chronological)
              </p>
              <p className="text-[9px] text-mutedForeground">
                Hires from bodyguard ledger + first block time per guard name. Multiple robot names in a short window
                usually means buying new guards while under attack (e.g. TonyTheRat… then another after the first was
                killed).
              </p>
              {guardRotationSteps.length > 0 ? (
                <ol className="text-[9px] space-y-1 max-h-40 overflow-y-auto list-decimal list-inside font-heading">
                  {guardRotationSteps.map((step, i) => (
                    <li key={i} className="text-zinc-200/95">
                      <span className="text-mutedForeground tabular-nums">{formatAttackLogTime(step.at)}</span>
                      {' — '}
                      {step.kind === 'hire' ? (
                        <span>
                          <span className="text-emerald-300/90">Hired</span>{' '}
                          <button
                            type="button"
                            className="text-primary hover:underline"
                            onClick={() => filterByGuard(step.guard)}
                          >
                            {step.guard}
                          </button>
                          {step.meta ? <span className="text-mutedForeground"> ({step.meta})</span> : null}
                        </span>
                      ) : null}
                      {step.kind === 'blocks' ? (
                        <span>
                          <span className="text-amber-200/90">Blocks</span>{' '}
                          <button
                            type="button"
                            className="text-primary hover:underline"
                            onClick={() => filterByGuard(step.guard)}
                          >
                            {step.guard}
                          </button>
                          <span className="text-mutedForeground"> — {step.meta}</span>
                        </span>
                      ) : null}
                      {step.kind === 'kill' ? (
                        <span>
                          <span className="text-red-300/90">Guard killed</span>{' '}
                          <span className="text-foreground">{step.guard}</span>
                          {step.meta ? <span className="text-mutedForeground"> — {step.meta}</span> : null}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-[9px] text-mutedForeground">No hire/block events in range.</p>
              )}
              {(guardRotation.guard_timeline || []).length > 1 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-[9px] font-heading">
                    <thead>
                      <tr className="text-mutedForeground">
                        <th className="text-left pr-2">#</th>
                        <th className="text-left pr-2">Guard (order first block)</th>
                        <th className="text-right pr-2">Blocks</th>
                        <th className="text-left pr-2">First</th>
                        <th className="text-left">Last</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(guardRotation.guard_timeline || []).map((row, i) => (
                        <tr key={i} className="border-t border-zinc-700/30">
                          <td className="py-0.5 pr-2 text-mutedForeground">{i + 1}</td>
                          <td className="py-0.5 pr-2">
                            <button
                              type="button"
                              className="text-primary hover:underline"
                              onClick={() => filterByGuard(row.guard_username)}
                            >
                              {row.guard_username}
                            </button>
                          </td>
                          <td className="py-0.5 pr-2 text-right tabular-nums">{row.block_count}</td>
                          <td className="py-0.5 pr-2 whitespace-nowrap">{formatAttackLogTime(row.first_at)}</td>
                          <td className="py-0.5 whitespace-nowrap">{formatAttackLogTime(row.last_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          ) : null}
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

      {multiAttackerTargets && (
        <div className="rounded border border-red-500/30 bg-red-500/5 p-2 space-y-2">
          <div className="text-[10px] font-heading font-bold uppercase tracking-wider text-red-200/90">
            Multi-attacker victims ({multiAttackerTargets.days}d, ≥{multiAttackerTargets.min_attackers} attackers)
          </div>
          <p className="text-[10px] text-zinc-200/95">
            {multiAttackerTargets.target_count} target{multiAttackerTargets.target_count === 1 ? '' : 's'} hit by multiple
            players — possible pile-ons or coordinated hits.
          </p>
          <div className="max-h-40 overflow-y-auto">
            <table className="w-full text-[9px] font-heading">
              <thead>
                <tr className="text-mutedForeground">
                  <th className="text-left pr-2">Target</th>
                  <th className="text-right pr-2">Attackers</th>
                  <th className="text-right pr-2">Attempts</th>
                  <th className="text-right pr-2">Kills</th>
                  <th className="text-left">Who</th>
                </tr>
              </thead>
              <tbody>
                {(multiAttackerTargets.targets || []).map((row, i) => (
                  <tr key={i} className="border-t border-zinc-700/30">
                    <td className="py-0.5 pr-2">
                      <button
                        type="button"
                        className="text-primary hover:underline font-medium"
                        onClick={() => filterByTarget(row.target_username)}
                      >
                        {row.target_username}
                      </button>
                    </td>
                    <td className="py-0.5 pr-2 text-right tabular-nums text-red-200">{row.distinct_attackers}</td>
                    <td className="py-0.5 pr-2 text-right tabular-nums">{row.attempt_count}</td>
                    <td className="py-0.5 pr-2 text-right tabular-nums">{row.killed}</td>
                    <td className="py-0.5 text-mutedForeground truncate max-w-[280px]" title={(row.attackers || []).join(', ')}>
                      {(row.attackers || []).slice(0, 6).join(', ')}
                      {(row.attackers || []).length > 6 ? '…' : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {(targetIntelUser || targetIntelLoading) && (
        <div className="rounded border border-sky-500/30 bg-sky-500/5 p-2 space-y-2">
          <div className="text-[10px] font-heading font-bold uppercase tracking-wider text-sky-200/90">Target intel</div>
          {targetIntelLoading && <p className="text-[10px] text-mutedForeground">Loading target intel…</p>}
          {targetIntel && !targetIntelLoading && (
            <>
              <p className="text-[10px] text-zinc-200/95">
                <strong className="text-foreground">{targetIntel.target_username}</strong> —{' '}
                <strong className={targetIntel.summary?.likely_coordinated ? 'text-red-300' : 'text-sky-200'}>
                  {targetIntel.summary?.distinct_attackers ?? 0}
                </strong>{' '}
                distinct attacker{(targetIntel.summary?.distinct_attackers ?? 0) === 1 ? '' : 's'},{' '}
                {targetIntel.summary?.total_attempts?.toLocaleString() ?? 0} attempts in {targetIntel.days}d.
                {targetIntel.summary?.likely_coordinated ? (
                  <span className="text-red-300/90"> Multiple people attacking this target.</span>
                ) : null}
              </p>
              <div className="max-h-36 overflow-y-auto">
                <table className="w-full text-[9px] font-heading">
                  <thead>
                    <tr className="text-mutedForeground">
                      <th className="text-left pr-2">Attacker</th>
                      <th className="text-right pr-2">Attempts</th>
                      <th className="text-right pr-2">Kills</th>
                      <th className="text-right pr-2">BG</th>
                      <th className="text-right pr-2">Failed</th>
                      <th className="text-left">Last</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(targetIntel.attackers || []).length === 0 ? (
                      <tr>
                        <td colSpan={6} className="text-mutedForeground">
                          No attempts
                        </td>
                      </tr>
                    ) : (
                      (targetIntel.attackers || []).map((row, i) => (
                        <tr key={i} className="border-t border-zinc-700/30">
                          <td className="py-0.5 pr-2">
                            <button
                              type="button"
                              className="text-primary hover:underline text-left"
                              onClick={() => filterByAttackerOnTarget(row.attacker_username, targetIntel.target_username)}
                            >
                              {row.attacker_username}
                            </button>
                          </td>
                          <td className="py-0.5 pr-2 text-right tabular-nums">{row.attempt_count}</td>
                          <td className="py-0.5 pr-2 text-right tabular-nums">{row.killed}</td>
                          <td className="py-0.5 pr-2 text-right tabular-nums">{row.bodyguard}</td>
                          <td className="py-0.5 pr-2 text-right tabular-nums">{row.failed}</td>
                          <td className="py-0.5 text-mutedForeground font-mono text-[8px]">{formatAttackLogTime(row.last_at)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {(targetIntelUser || targetIntelLoading) && targetNarrative?.summary && !targetIntelLoading && (
        <div className="rounded border border-violet-500/35 bg-violet-500/5 p-2 space-y-2">
          <div className="text-[10px] font-heading font-bold uppercase tracking-wider text-violet-200/90">
            Attack narrative — {targetNarrative.target_username}
          </div>
          <p className="text-[10px] text-zinc-200/95 leading-relaxed">{targetNarrative.summary.story}</p>
          {(targetNarrative.summary?.story_steps?.length ?? 0) > 0 && (
            <ol className="list-decimal list-inside text-[10px] text-zinc-200/90 space-y-0.5 max-h-32 overflow-y-auto rounded border border-violet-500/20 bg-violet-500/5 px-2 py-1.5">
              {(targetNarrative.summary.story_steps || []).map((step, i) => (
                <li key={i} className="leading-snug">
                  {step}
                </li>
              ))}
            </ol>
          )}
          <div className="flex flex-wrap gap-2 text-[9px] font-heading">
            <span className="rounded border border-zinc-700/50 px-1.5 py-0.5">
              Attackers: <strong className="text-foreground">{targetNarrative.summary.distinct_attackers ?? 0}</strong>
            </span>
            <span className="rounded border border-violet-500/25 px-1.5 py-0.5 text-violet-200/80">
              Timeline steps: <strong>{targetNarrative.summary.timeline_steps ?? (targetNarrative.timeline || []).length}</strong>
            </span>
            <span className="rounded border border-rose-500/30 px-1.5 py-0.5 text-rose-200/90">
              Guard kills: <strong>{targetNarrative.summary.guards_killed_count ?? 0}</strong>
            </span>
            <span className="rounded border border-amber-500/30 px-1.5 py-0.5 text-amber-200/90">
              Blocks: <strong>{(targetNarrative.summary.total_blocks ?? 0).toLocaleString()}</strong>
            </span>
            <span className="rounded border border-amber-500/20 px-1.5 py-0.5">
              Failed on target: <strong>{(targetNarrative.summary.failed_on_target ?? 0).toLocaleString()}</strong>
            </span>
            <span className="rounded border border-red-500/30 px-1.5 py-0.5 text-red-200/90">
              Target kills: <strong>{targetNarrative.summary.target_kills ?? 0}</strong>
            </span>
          </div>
          {(targetNarrative.current_roster || []).length > 0 ? (
            <p className="text-[9px] text-mutedForeground">
              Current roster:{' '}
              {(targetNarrative.current_roster || [])
                .map((r) => {
                  const slot = formatSlotDisplay(r.slot) || '—';
                  return `slot ${slot}: ${r.guard_username || (r.is_robot ? 'Robot' : '—')}`;
                })
                .join(' · ')}
            </p>
          ) : null}
          <div className="max-h-56 overflow-y-auto rounded border border-zinc-700/40">
            <table className="w-full text-[9px] font-heading">
              <thead className="sticky top-0 bg-zinc-900/95">
                <tr className="text-mutedForeground border-b border-zinc-700/50">
                  <th className="text-left py-1 px-1 w-6">#</th>
                  <th className="text-left py-1 px-1">Time</th>
                  <th className="text-left py-1 px-1">Event</th>
                  <th className="text-left py-1 px-1">Attacker</th>
                  <th className="text-left py-1 px-1">Guard / victim</th>
                  <th className="text-right py-1 px-1">×</th>
                  <th className="text-right py-1 px-1">Bullets</th>
                </tr>
              </thead>
              <tbody>
                {((targetNarrative.timeline || targetNarrative.phases) || []).length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-2 px-1 text-mutedForeground">
                      No timeline in window.
                    </td>
                  </tr>
                ) : (
                  (targetNarrative.timeline || targetNarrative.phases || []).map((phase, i) => (
                    <tr
                      key={i}
                      className={`border-b border-zinc-700/30 ${
                        phase.kind === 'target_killed' ? 'bg-red-500/10' : phase.kind === 'guard_killed' ? 'bg-rose-500/8' : ''
                      }`}
                    >
                      <td className="py-1 px-1 text-mutedForeground tabular-nums">{i + 1}</td>
                      <td className="py-1 px-1 text-mutedForeground font-mono whitespace-nowrap">
                        {formatAttackLogTime(phase.first_at)}
                        {phase.last_at && phase.last_at !== phase.first_at ? (
                          <span className="block text-[8px] text-mutedForeground">…{formatAttackLogTime(phase.last_at)}</span>
                        ) : null}
                      </td>
                      <td className={`py-1 px-1 ${narrativeKindClass(phase.kind)}`}>{phase.label}</td>
                      <td className="py-1 px-1">
                        {phase.attacker_username && phase.attacker_username !== '?' ? (
                          <button
                            type="button"
                            className="text-primary hover:underline font-medium"
                            onClick={() =>
                              filterByAttackerOnTarget(phase.attacker_username, targetNarrative.target_username)
                            }
                          >
                            {phase.attacker_username}
                          </button>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="py-1 px-1 text-amber-200/80">
                        {phase.guard_username || (phase.kind === 'target_killed' ? targetNarrative.target_username : '—')}
                        {formatSlotDisplay(phase.slot) ? ` · slot ${formatSlotDisplay(phase.slot)}` : ''}
                      </td>
                      <td className="py-1 px-1 text-right tabular-nums">{(phase.count ?? 1).toLocaleString()}</td>
                      <td className="py-1 px-1 text-right tabular-nums text-mutedForeground">
                        {phase.bullets_total ? phase.bullets_total.toLocaleString() : '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <p className="text-[9px] text-mutedForeground">
            Steps in real time order (oldest first). Each guard kill and target kill is its own step — e.g. User1 kills a guard,
            then User2 kills another, then User1 kills the target. Repeated blocks/fails from the same attacker are collapsed (×N).
          </p>
        </div>
      )}

      {attackLogsData && (
        <div className={`overflow-x-auto overflow-y-auto ${tableMaxHeightClass}`}>
          <p className="text-[10px] font-heading text-primary mb-1">
            {attackLogsData.scope === 'all' || attackLogsData.username == null ? (
              <>
                Showing: <strong>All players</strong> (limit {attackLogsLimit}
                {attackLogsData.exclude_target_npc ? ', NPC excluded' : ''})
                {attackLogsData.target_username ? (
                  <>
                    {' '}
                    · target <strong>{attackLogsData.target_username}</strong>
                  </>
                ) : null}
                {attackerFilter ? (
                  <>
                    {' '}
                    · attacker <strong>{attackerFilter}</strong>
                  </>
                ) : null}
              </>
            ) : (
              <>
                Attack log for: <strong>{attackLogsData.username}</strong>
                {attackLogsData.exclude_target_npc ? ' (NPC excluded)' : ''}
                {attackLogsData.target_username ? (
                  <>
                    {' '}
                    · target <strong>{attackLogsData.target_username}</strong>
                  </>
                ) : null}
                {attackerFilter ? (
                  <>
                    {' '}
                    · attacker <strong>{attackerFilter}</strong>
                  </>
                ) : null}
              </>
            )}
            {summary ? (
              <span className="text-mutedForeground ml-2">
                — {summary.total} rows
                {groupDuplicates && logGroups && summary.total > displayRowCount ? (
                  <span> ({displayRowCount} grouped)</span>
                ) : null}
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
                  {groupDuplicates && logGroups ? (
                    <th className="py-1 pr-1 font-bold text-mutedForeground uppercase" title="Identical encounters collapsed">
                      ×
                    </th>
                  ) : null}
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
                {logGroups
                  ? logGroups.map((group, idx) => renderLogRow(group.representative, idx, group))
                  : attackLogsData.logs.map((row, idx) => renderLogRow(row, idx))}
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
