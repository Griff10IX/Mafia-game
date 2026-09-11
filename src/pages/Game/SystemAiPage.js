import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bot, Send, ShieldAlert, Fingerprint, Eye, AlertTriangle } from 'lucide-react';
import api, { getApiErrorMessage } from '../../utils/api';
import { toast } from 'sonner';
import styles from '../../styles/noir.module.css';
import { SYSTEM_AI_AVATAR, SYSTEM_AI_PROFILE_PATH } from '../../components/SystemAiInboxMessage';
import { formatGameDateTime as formatDateTime } from '../../utils/gameDateTime';

const PAGE_CSS = `
  @keyframes sai-fade { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
  .sai-fade { animation: sai-fade 0.35s ease-out both; }
`;

const STATUS_TONE = {
  open: 'text-amber-300',
  investigating: 'text-sky-300',
  closed: 'text-zinc-500',
};

export default function SystemAiPage() {
  const [meta, setMeta] = useState(null);
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState('bot_check');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [target, setTarget] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      const [m, r] = await Promise.all([
        api.get('/system-ai/meta'),
        api.get('/system-ai/my-reports'),
      ]);
      setMeta(m.data);
      setReports(r.data?.reports || []);
      const cats = m.data?.categories || [];
      if (cats.length && !cats.some((c) => c.id === category)) {
        setCategory(cats[0].id);
      }
    } catch (e) {
      toast.error(getApiErrorMessage(e) || 'Failed to load System AI');
    } finally {
      setLoading(false);
    }
  }, [category]);

  useEffect(() => {
    load();
  }, [load]);

  const remaining = meta?.remaining_today ?? 0;

  const onSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      await api.post('/system-ai/reports', {
        category,
        subject: subject.trim(),
        body: body.trim(),
        target_username: target.trim() || null,
      });
      toast.success('Report filed with System AI');
      setSubject('');
      setBody('');
      setTarget('');
      await load();
    } catch (err) {
      toast.error(getApiErrorMessage(err) || 'Could not file report');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={`${styles.page} max-w-3xl mx-auto px-3 sm:px-4 pb-24 sm:pb-10`}>
      <style>{PAGE_CSS}</style>

      <div className="sai-fade relative overflow-hidden rounded-xl border border-amber-400/30 bg-gradient-to-br from-zinc-950 via-zinc-900 to-amber-950/40 mb-4 sm:mb-6">
        <div className="absolute inset-0 opacity-30 pointer-events-none bg-[radial-gradient(ellipse_at_top_right,rgba(251,191,36,0.25),transparent_55%)]" />
        <div className="relative flex flex-col sm:flex-row gap-4 p-4 sm:p-6 items-start sm:items-center">
          <Link to={SYSTEM_AI_PROFILE_PATH} className="shrink-0">
            <img
              src={SYSTEM_AI_AVATAR}
              alt="System AI"
              className="w-16 h-16 sm:w-20 sm:h-20 rounded-lg object-cover border-2 border-amber-400/50 shadow-[0_0_24px_rgba(251,191,36,0.25)]"
            />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-heading font-bold uppercase tracking-[0.22em] text-amber-300/90">
              House intelligence
            </p>
            <h1 className="text-xl sm:text-2xl font-heading font-bold text-amber-200 mt-0.5">
              System AI
            </h1>
            <p className="text-[12px] sm:text-[13px] text-zinc-300 mt-2 leading-relaxed">
              File bot checks, dupe checks, and suspicious activity here. I read the logs. I investigate alone.
            </p>
          </div>
        </div>
      </div>

      <div className="sai-fade rounded-xl border border-amber-500/25 bg-amber-950/20 p-3 sm:p-4 mb-4 space-y-2">
        <div className="flex items-start gap-2">
          <Eye className="w-4 h-4 text-amber-300 shrink-0 mt-0.5" aria-hidden />
          <p className="text-[11px] sm:text-[12px] text-amber-100/90 leading-relaxed">
            <span className="font-heading font-bold text-amber-200 uppercase tracking-wide text-[10px]">
              AI only
            </span>
            <br />
            {meta?.blurb ||
              'Reports are investigated by System AI only — not Help Desk, not human mods. Replies come from System AI in your inbox.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-[10px] font-heading uppercase tracking-wide">
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded border border-amber-400/30 bg-black/30 text-amber-200">
            <Bot className="w-3 h-3" /> Bot checks
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded border border-amber-400/30 bg-black/30 text-amber-200">
            <Fingerprint className="w-3 h-3" /> Dupe checks
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded border border-amber-400/30 bg-black/30 text-amber-200">
            <ShieldAlert className="w-3 h-3" /> Suspicious play
          </span>
        </div>
        <p className="text-[11px] text-zinc-400">
          Daily limit:{' '}
          <span className="text-foreground font-semibold tabular-nums">
            {remaining}/{meta?.daily_limit ?? 3}
          </span>{' '}
          remaining today
        </p>
      </div>

      <form
        onSubmit={onSubmit}
        className="sai-fade rounded-xl border border-border bg-card/80 p-3 sm:p-4 space-y-3 mb-6"
      >
        <h2 className="text-[11px] font-heading font-bold uppercase tracking-[0.16em] text-mutedForeground">
          File a report
        </h2>

        <div>
          <label className="block text-[10px] font-heading uppercase text-mutedForeground mb-1">
            Category
          </label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground"
          >
            {(meta?.categories || [
              { id: 'bot_check', label: 'Bot check' },
              { id: 'dupe_check', label: 'Dupe / multi check' },
              { id: 'suspicious', label: 'Suspicious activity' },
              { id: 'other', label: 'Other' },
            ]).map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[10px] font-heading uppercase text-mutedForeground mb-1">
            Subject
          </label>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            maxLength={120}
            required
            placeholder="Short summary"
            className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-mutedForeground"
          />
        </div>

        <div>
          <label className="block text-[10px] font-heading uppercase text-mutedForeground mb-1">
            Target username <span className="normal-case text-zinc-500">(optional)</span>
          </label>
          <input
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            maxLength={40}
            placeholder="Who should I look at?"
            className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-mutedForeground"
          />
        </div>

        <div>
          <label className="block text-[10px] font-heading uppercase text-mutedForeground mb-1">
            Details
          </label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={4000}
            required
            rows={5}
            placeholder="Times, usernames, what you saw. I already watch the logs — context helps."
            className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-mutedForeground resize-y min-h-[120px]"
          />
        </div>

        <button
          type="submit"
          disabled={submitting || remaining <= 0 || loading}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-3 sm:py-2.5 rounded-lg bg-amber-500/90 hover:bg-amber-400 text-black font-heading font-bold text-[11px] uppercase tracking-wide disabled:opacity-50"
        >
          <Send className="w-4 h-4" />
          {remaining <= 0 ? 'Daily limit reached' : submitting ? 'Sending…' : 'Send to System AI'}
        </button>
      </form>

      <section className="sai-fade space-y-3">
        <h2 className="text-[11px] font-heading font-bold uppercase tracking-[0.16em] text-mutedForeground flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5" /> Your reports
        </h2>
        {loading ? (
          <p className="text-[12px] text-mutedForeground">Loading…</p>
        ) : reports.length === 0 ? (
          <p className="text-[12px] text-mutedForeground rounded-lg border border-border/60 bg-card/40 px-3 py-4">
            No reports yet. When you file one, it shows here with any System AI replies.
          </p>
        ) : (
          <ul className="space-y-3">
            {reports.map((r) => (
              <li
                key={r.id}
                className="rounded-xl border border-border bg-card/70 p-3 sm:p-4 space-y-2"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-heading font-semibold text-foreground">{r.subject}</p>
                  <span className={`text-[10px] font-heading uppercase ${STATUS_TONE[r.status] || 'text-zinc-400'}`}>
                    {r.status}
                  </span>
                </div>
                <p className="text-[10px] text-mutedForeground">
                  {r.category_label}
                  {r.target_username ? ` · target: ${r.target_username}` : ''}
                  {r.created_at ? ` · ${formatDateTime(r.created_at)}` : ''}
                </p>
                <p className="text-[12px] text-zinc-300 whitespace-pre-wrap break-words">{r.body}</p>
                {(r.replies || []).length > 0 && (
                  <div className="mt-2 space-y-2 border-t border-border/50 pt-2">
                    {(r.replies || []).map((rep) => (
                      <div
                        key={rep.id}
                        className="rounded-lg border border-amber-400/25 bg-amber-950/20 p-2.5"
                      >
                        <p className="text-[9px] font-heading uppercase tracking-wide text-amber-300 mb-1">
                          System AI
                        </p>
                        <p className="text-[12px] text-zinc-200 whitespace-pre-wrap break-words">{rep.body}</p>
                        {rep.created_at && (
                          <p className="text-[9px] text-mutedForeground mt-1">{formatDateTime(rep.created_at)}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
