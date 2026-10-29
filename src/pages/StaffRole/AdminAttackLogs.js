import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Crosshair, RefreshCw } from 'lucide-react';
import api from '../../utils/api';
import { formatAdminDateTime } from '../../utils/adminDateTime';
import { toast } from 'sonner';
import AttackLogsPanel from '../../components/staff/AttackLogsPanel';
import { formatBodyguardHireDetail } from '../../utils/attackLogDisplay';
import {
  AdminPage, Button, Card, DataTable, ErrorBlock, KpiGrid, KpiTile, LoadingBlock, fmtNum, touchClass,
} from './kit/AdminKit';

function formatAuditTimelineRow(row) {
  if (!row || typeof row !== 'object') return '—';
  const at = row.at || row.data?.created_at || '—';
  const kind = row.kind || row.data?.type || row.data?.action || '—';
  const src = row.source || '—';
  const d = row.data || {};
  let detail = '';
  if (src === 'attack_attempts' || kind === 'bodyguard_kill_attempt') {
    detail = `${d.attacker_username || '?'} → ${d.target_username || '?'}`;
    if (d.outcome) detail += ` (${d.outcome})`;
    if (d.bodyguard_owner_username) detail += ` · owner ${d.bodyguard_owner_username}`;
  } else if (kind === 'bodyguard_hire' || kind === 'bodyguard_drop') {
    detail =
      formatBodyguardHireDetail(d.details) ||
      (typeof d.message === 'string' ? d.message : '') ||
      kind;
  } else if (d.guard_username || d.guard_id) {
    detail = [d.guard_username, d.owner_username].filter(Boolean).join(' · ');
  } else if (d.event_type) {
    detail = d.event_type;
  } else if (d.type) {
    detail = String(d.type);
  }
  return { at, src, kind, detail: detail || '—' };
}

const pretty = (s) => String(s || '—').replace(/_/g, ' ');

export default function AdminAttackLogs() {
  const navigate = useNavigate();
  const [accessChecked, setAccessChecked] = useState(false);
  const [analytics, setAnalytics] = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [analyticsError, setAnalyticsError] = useState(null);
  const [bodyguardData, setBodyguardData] = useState(null);
  const [bodyguardLoading, setBodyguardLoading] = useState(false);
  const [bodyguardError, setBodyguardError] = useState(null);
  const [timelineOpen, setTimelineOpen] = useState(false);

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
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const fetchAnalytics = useCallback(async () => {
    if (!accessChecked) return;
    setAnalyticsLoading(true);
    setAnalyticsError(null);
    try {
      const res = await api.get('/admin/attacks/analytics/summary', { params: { days: 7, limit: 100 } });
      setAnalytics(res.data || null);
    } catch (e) {
      const msg = e.response?.data?.detail || e.message || 'Failed to load';
      setAnalyticsError(msg);
      setAnalytics(null);
      if (e.response?.status === 403) {
        toast.error('Admin or moderator access required');
        navigate('/dashboard', { replace: true });
      }
    } finally {
      setAnalyticsLoading(false);
    }
  }, [accessChecked, navigate]);

  useEffect(() => {
    if (accessChecked) fetchAnalytics();
  }, [accessChecked, fetchAnalytics]);

  const onAttackLogsLoaded = useCallback(async (username) => {
    if (!username) return;
    setBodyguardLoading(true);
    setBodyguardError(null);
    setTimelineOpen(false);
    try {
      const res = await api.get('/admin/bodyguards/audit', {
        params: { username, limit: 500 },
      });
      setBodyguardData(res.data || null);
    } catch (e) {
      const msg = e.response?.data?.detail || e.message || 'Failed to load bodyguard audit';
      setBodyguardError(msg);
      setBodyguardData(null);
    } finally {
      setBodyguardLoading(false);
    }
  }, []);

  const pageProps = {
    title: 'Attack logs',
    subtitle: 'Raw attack attempts per player, their bodyguard roster, and the merged hire, kill and payout timeline.',
    icon: Crosshair,
  };

  if (!accessChecked || (analyticsLoading && !analytics && !analyticsError)) {
    return <div data-testid="admin-attack-logs-page"><AdminPage {...pageProps}><LoadingBlock label="Loading attack tools…" /></AdminPage></div>;
  }

  const g = analytics?.global;
  const owned = Array.isArray(bodyguardData?.owned_bodyguards) ? bodyguardData.owned_bodyguards : [];
  const filledSlots = owned.filter((b) => b.bodyguard_username || b.is_robot).length;
  const u = bodyguardData?.user || {};
  const merged = Array.isArray(bodyguardData?.merged_timeline) ? bodyguardData.merged_timeline : [];

  return (
    <div data-testid="admin-attack-logs-page">
      <AdminPage
        {...pageProps}
        actions={<Button icon={RefreshCw} loading={analyticsLoading} onClick={() => fetchAnalytics()} className={touchClass}>Refresh stats</Button>}
      >
        {analyticsError && <ErrorBlock message={analyticsError} onRetry={fetchAnalytics} />}

        <KpiGrid cols={4}>
          <KpiTile label="Attempts (7 days)" value={fmtNum(g?.attempts)} hint="Sample" />
          <KpiTile label="Kills (7 days)" value={fmtNum(g?.kills)} hint="Sample" />
          <KpiTile label="Kill rate" value={g?.kill_rate != null ? `${(Number(g.kill_rate) * 100).toFixed(1)}%` : '—'} />
          <KpiTile label="Avg bullets per attempt" value={g?.avg_bullets_per_attempt != null ? Number(g.avg_bullets_per_attempt).toFixed(1) : '—'} />
        </KpiGrid>
        <p className="text-xs leading-relaxed text-zinc-500">
          Analytics snapshot: {formatAdminDateTime(analytics?.generated_at)}. For <span className="font-mono text-zinc-400">execute_token</span> failure
          correlation and search header audits, use <span className="text-zinc-300">Admin → Cheat detection → Kill / attack, UA spoof telemetry → Load spoof report</span>.
        </p>

        <Card title="Attack attempts" subtitle="Search a player or target, filter by bodyguard activity and day range.">
          <div className="admin-skin min-w-0">
            <AttackLogsPanel
              introText="Filters: bodyguard blocks/kills, protectee, target victim, guard name, day range. Enter a username or target victim — Attack narrative shows guard kills, blocks, failed hits, then the kill (e.g. Moey). Group duplicate rows to collapse spam."
              tableMaxHeightClass="max-h-[min(70vh,560px)]"
              onLogsLoaded={onAttackLogsLoaded}
              showGlobalIntel
            />
          </div>
        </Card>

        {(bodyguardLoading || bodyguardError || bodyguardData) && (
          <Card title="Bodyguard snapshot and timeline" subtitle={u.username ? `For ${u.username}` : undefined}>
            {bodyguardLoading && <LoadingBlock label="Loading bodyguard audit…" />}
            {bodyguardError && !bodyguardLoading && <ErrorBlock message={bodyguardError} />}
            {bodyguardData && !bodyguardLoading && (
              <div className="space-y-4">
                <KpiGrid cols={4}>
                  <KpiTile label="Player" value={u.username ?? '—'} />
                  <KpiTile label="Filled / slots" value={`${filledSlots} / ${u.bodyguard_slots != null ? Number(u.bodyguard_slots) : owned.length || '—'}`} />
                  <KpiTile label="Inflation level" value={u.bodyguard_inflation_level ?? '—'} />
                  <KpiTile label="Merged timeline rows" value={fmtNum(merged.length)} />
                </KpiGrid>
                {u.is_bodyguard && (
                  <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-amber-200">
                    This account is flagged as a bodyguard NPC/player
                    {u.bodyguard_owner_id ? ` (owner id: ${u.bodyguard_owner_id})` : ''}.
                  </p>
                )}
                {bodyguardData.employed_as_guard && (
                  <p className="text-sm text-zinc-400">Employed as guard for another player (slot data in audit payload).</p>
                )}
                <div className="space-y-3">
                  <Button onClick={() => setTimelineOpen((v) => !v)} className={touchClass}>
                    {timelineOpen ? 'Hide' : 'Show'} merged timeline (first 40)
                  </Button>
                  {timelineOpen && (
                    <div className="max-h-[420px] overflow-y-auto rounded-lg border border-zinc-800">
                      <DataTable
                        rows={merged.slice(0, 40).map(formatAuditTimelineRow)}
                        pageSize={40}
                        empty="No merged rows."
                        columns={[
                          { key: 'at', label: 'Time', render: (r) => <span className="whitespace-nowrap font-mono text-xs text-zinc-400">{formatAdminDateTime(r.at)}</span> },
                          { key: 'src', label: 'Source', render: (r) => <span className="text-zinc-400">{pretty(r.src)}</span> },
                          { key: 'kind', label: 'Kind', render: (r) => pretty(r.kind) },
                          { key: 'detail', label: 'Detail', sortable: false, render: (r) => <span className="whitespace-normal break-words">{r.detail}</span> },
                        ]}
                      />
                    </div>
                  )}
                </div>
              </div>
            )}
          </Card>
        )}
      </AdminPage>
    </div>
  );
}
