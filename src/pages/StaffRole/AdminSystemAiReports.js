import { useCallback, useEffect, useState } from 'react';
import { Bot, RefreshCw, Send } from 'lucide-react';
import api from '../../utils/api';
import { toast } from 'sonner';
import { formatGameDateTime as formatDateTime } from '../../utils/gameDateTime';

export default function AdminSystemAiReports() {
  const [status, setStatus] = useState('open');
  const [reports, setReports] = useState([]);
  const [openCount, setOpenCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = status ? { status } : {};
      const res = await api.get('/admin/system-ai/reports', { params });
      setReports(res.data?.reports || []);
      setOpenCount(Number(res.data?.open_count) || 0);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load reports');
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  const selectReport = async (id) => {
    try {
      const res = await api.get(`/admin/system-ai/reports/${id}`);
      setSelected(res.data?.report || null);
      setReply('');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to open report');
    }
  };

  const sendReply = async () => {
    if (!selected?.id || !reply.trim() || busy) return;
    setBusy(true);
    try {
      const res = await api.post(`/admin/system-ai/reports/${selected.id}/reply`, { body: reply.trim() });
      setSelected(res.data?.report || null);
      setReply('');
      toast.success('Sent as System AI');
      await load();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Reply failed');
    } finally {
      setBusy(false);
    }
  };

  const setReportStatus = async (st) => {
    if (!selected?.id || busy) return;
    setBusy(true);
    try {
      const res = await api.post(`/admin/system-ai/reports/${selected.id}/status`, { status: st });
      setSelected(res.data?.report || null);
      toast.success(`Marked ${st}`);
      await load();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Status update failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-2 sm:px-3 pb-16 text-zinc-100">
      <div className="mb-3 rounded-xl border border-amber-400/40 bg-amber-950/40 p-3">
        <h1 className="text-sm font-heading font-bold uppercase tracking-wide text-amber-200 flex items-center gap-2">
          <Bot className="w-4 h-4" /> System AI reports
        </h1>
        <p className="text-[10px] text-amber-100/80 mt-1">
          Admin only. Players believe AI investigates alone. Reply sends a System AI inbox.
          {' '}
          <span className="tabular-nums text-amber-200">{openCount} open</span>
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        {['open', 'investigating', 'closed', ''].map((s) => (
          <button
            key={s || 'all'}
            type="button"
            onClick={() => setStatus(s)}
            className={`px-2.5 py-1.5 rounded text-[10px] font-heading uppercase border ${
              status === s
                ? 'border-amber-400/50 bg-amber-500/15 text-amber-200'
                : 'border-zinc-700 text-zinc-400'
            }`}
          >
            {s || 'all'}
          </button>
        ))}
        <button
          type="button"
          onClick={load}
          className="ml-auto p-2 rounded border border-zinc-700 text-zinc-400 hover:text-zinc-100"
          title="Refresh"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="rounded-lg border border-zinc-700 bg-zinc-950/80 max-h-[70vh] overflow-y-auto">
          {loading && reports.length === 0 ? (
            <p className="p-3 text-[11px] text-zinc-400">Loading…</p>
          ) : reports.length === 0 ? (
            <p className="p-3 text-[11px] text-zinc-400">No reports in this filter.</p>
          ) : (
            <ul className="divide-y divide-zinc-800">
              {reports.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => selectReport(r.id)}
                    className={`w-full text-left px-3 py-2.5 hover:bg-amber-500/5 ${
                      selected?.id === r.id ? 'bg-amber-500/10' : ''
                    }`}
                  >
                    <div className="flex justify-between gap-2">
                      <span className="text-[12px] font-heading font-semibold text-zinc-100 truncate">
                        {r.subject}
                      </span>
                      <span className="text-[9px] uppercase text-zinc-500 shrink-0">{r.status}</span>
                    </div>
                    <p className="text-[10px] text-zinc-400 mt-0.5">
                      {r.username} · {r.category_label}
                      {r.target_username ? ` · → ${r.target_username}` : ''}
                    </p>
                    <p className="text-[9px] text-zinc-500">{r.created_at ? formatDateTime(r.created_at) : ''}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-lg border border-zinc-700 bg-zinc-950/80 p-3 min-h-[240px]">
          {!selected ? (
            <p className="text-[11px] text-zinc-400">Select a report.</p>
          ) : (
            <div className="space-y-3">
              <div>
                <h2 className="text-sm font-heading font-bold text-zinc-100">{selected.subject}</h2>
                <p className="text-[10px] text-zinc-400 mt-1">
                  From <span className="text-zinc-100">{selected.username}</span> · {selected.category_label}
                  {selected.target_username ? (
                    <>
                      {' '}
                      · target <span className="text-amber-200">{selected.target_username}</span>
                    </>
                  ) : null}
                </p>
                <p className="text-[9px] text-zinc-500 mt-0.5">
                  {selected.created_at ? formatDateTime(selected.created_at) : ''} · {selected.status}
                </p>
              </div>
              <p className="text-[12px] text-zinc-200 whitespace-pre-wrap break-words rounded border border-zinc-700 bg-black/40 p-2.5">
                {selected.body}
              </p>

              {(selected.replies || []).length > 0 && (
                <div className="space-y-2">
                  <p className="text-[9px] font-heading uppercase text-zinc-500">Thread</p>
                  {(selected.replies || []).map((rep) => (
                    <div key={rep.id} className="rounded border border-amber-400/20 bg-amber-950/15 p-2">
                      <p className="text-[9px] text-amber-300 uppercase mb-0.5">System AI</p>
                      <p className="text-[11px] whitespace-pre-wrap break-words">{rep.body}</p>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap gap-1.5">
                {['open', 'investigating', 'closed'].map((st) => (
                  <button
                    key={st}
                    type="button"
                    disabled={busy || selected.status === st}
                    onClick={() => setReportStatus(st)}
                    className="px-2 py-1 rounded border border-zinc-700 text-[9px] font-heading uppercase disabled:opacity-40"
                  >
                    {st}
                  </button>
                ))}
              </div>

              <div>
                <label className="block text-[9px] font-heading uppercase text-zinc-500 mb-1">
                  Reply as System AI
                </label>
                <textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  rows={4}
                  className="w-full rounded border border-zinc-700 bg-zinc-900 px-2.5 py-2 text-[12px] text-zinc-100 resize-y"
                  placeholder="Player sees this as System AI in inbox + thread"
                />
                <button
                  type="button"
                  disabled={busy || !reply.trim()}
                  onClick={sendReply}
                  className="mt-2 inline-flex items-center gap-1.5 px-3 py-2 rounded bg-amber-500/90 text-black text-[10px] font-heading font-bold uppercase disabled:opacity-50"
                >
                  <Send className="w-3.5 h-3.5" /> Send
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
