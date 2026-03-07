import { useState, useEffect, useCallback } from 'react';
import { HelpCircle, Send, MessageSquare, X, ChevronRight, VolumeX } from 'lucide-react';
import api from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

const HD_STYLES = `
  @keyframes hd-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .hd-fade-in { animation: hd-fade-in 0.4s ease-out both; }
  .hd-row:hover { background: rgba(var(--noir-primary-rgb), 0.06); }
  .hd-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.15; }
`;

function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const ROLE_LABELS = { user: 'User', admin: 'Admin', mod: 'Mod', hdo: 'HDO' };

export default function HelpDesk() {
  const [canManage, setCanManage] = useState(false);
  const [canApproveMute, setCanApproveMute] = useState(false);
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState(''); // '', 'open', 'closed'
  const [selectedId, setSelectedId] = useState(null);
  const [ticketDetail, setTicketDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createSubject, setCreateSubject] = useState('');
  const [createBody, setCreateBody] = useState('');
  const [creating, setCreating] = useState(false);
  const [replyBody, setReplyBody] = useState('');
  const [replying, setReplying] = useState(false);
  const [closing, setClosing] = useState(false);
  const [forumMutes, setForumMutes] = useState([]);
  const [forumMutesLoading, setForumMutesLoading] = useState(false);
  const [muteUsername, setMuteUsername] = useState('');
  const [muteHours, setMuteHours] = useState('');
  const [muteDays, setMuteDays] = useState('');
  const [mutePermanent, setMutePermanent] = useState(false);
  const [muteReason, setMuteReason] = useState('');
  const [muting, setMuting] = useState(false);

  const fetchCheck = useCallback(async () => {
    try {
      const r = await api.get('/help-desk/check');
      setCanManage(!!r.data?.can_manage);
      setCanApproveMute(!!r.data?.can_approve_mute);
    } catch (_) {
      setCanManage(false);
      setCanApproveMute(false);
    }
  }, []);

  const fetchTickets = useCallback(async () => {
    setLoading(true);
    try {
      const params = statusFilter ? { status_filter: statusFilter } : {};
      const r = await api.get('/help-desk/tickets', { params });
      setTickets(r.data?.tickets || []);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load tickets');
      setTickets([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  const fetchForumMutes = useCallback(async () => {
    if (!canManage) return;
    setForumMutesLoading(true);
    try {
      const r = await api.get('/admin/forum-mutes');
      setForumMutes(r.data?.mutes || []);
    } catch (_) {
      setForumMutes([]);
    } finally {
      setForumMutesLoading(false);
    }
  }, [canManage]);

  useEffect(() => { fetchCheck(); }, [fetchCheck]);
  useEffect(() => { fetchTickets(); }, [fetchTickets]);
  useEffect(() => { fetchForumMutes(); }, [fetchForumMutes]);

  const fetchTicketDetail = useCallback(async (id) => {
    if (!id) { setTicketDetail(null); return; }
    setDetailLoading(true);
    try {
      const r = await api.get(`/help-desk/tickets/${id}`);
      setTicketDetail(r.data);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load ticket');
      setTicketDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedId) fetchTicketDetail(selectedId);
    else setTicketDetail(null);
  }, [selectedId, fetchTicketDetail]);

  const handleCreate = async (e) => {
    e.preventDefault();
    const sub = (createSubject || '').trim();
    const body = (createBody || '').trim();
    if (!sub || !body) {
      toast.error('Subject and message are required');
      return;
    }
    setCreating(true);
    try {
      await api.post('/help-desk/tickets', { subject: sub, body });
      toast.success('Ticket created');
      setCreateOpen(false);
      setCreateSubject('');
      setCreateBody('');
      fetchTickets();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to create ticket');
    } finally {
      setCreating(false);
    }
  };

  const handleReply = async (e) => {
    e.preventDefault();
    const body = (replyBody || '').trim();
    if (!body || !selectedId) return;
    setReplying(true);
    try {
      const r = await api.post(`/help-desk/tickets/${selectedId}/reply`, { body });
      setTicketDetail(r.data?.ticket || null);
      setReplyBody('');
      toast.success('Reply sent');
      fetchTickets();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to send reply');
    } finally {
      setReplying(false);
    }
  };

  const handleClose = async () => {
    if (!selectedId || !window.confirm('Close this ticket?')) return;
    setClosing(true);
    try {
      const r = await api.post(`/help-desk/tickets/${selectedId}/close`);
      setTicketDetail(r.data?.ticket || null);
      toast.success('Ticket closed');
      fetchTickets();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to close ticket');
    } finally {
      setClosing(false);
    }
  };

  const handleMute = async (e) => {
    e.preventDefault();
    const username = (muteUsername || '').trim();
    if (!username) { toast.error('Enter username'); return; }
    const hours = muteHours.trim() ? parseInt(muteHours, 10) : null;
    const days = muteDays.trim() ? parseInt(muteDays, 10) : null;
    if (!mutePermanent && (hours == null || hours <= 0) && (days == null || days <= 0)) {
      toast.error('Set hours, days, or permanent');
      return;
    }
    setMuting(true);
    try {
      await api.post('/admin/forum-mute', {
        target_username: username,
        duration_hours: hours > 0 ? hours : undefined,
        duration_days: days > 0 ? days : undefined,
        permanent: mutePermanent,
        reason: (muteReason || '').trim() || undefined,
      });
      toast.success('User muted from forum');
      setMuteUsername('');
      setMuteHours('');
      setMuteDays('');
      setMutePermanent(false);
      setMuteReason('');
      fetchForumMutes();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to mute');
    } finally {
      setMuting(false);
    }
  };

  const handleUnmute = async (username) => {
    try {
      await api.post('/admin/forum-unmute', null, { params: { target_username: username } });
      toast.success('User unmuted');
      fetchForumMutes();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to unmute');
    }
  };

  const handleApproveMute = async (muteId) => {
    try {
      await api.post('/admin/forum-mute-approve', null, { params: { mute_id: muteId } });
      toast.success('Permanent mute approved');
      fetchForumMutes();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to approve');
    }
  };

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <style>{HD_STYLES}</style>
      <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
        <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between gap-2 flex-wrap">
          <h1 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.12em] flex items-center gap-1.5">
            <HelpCircle size={14} />
            Help Desk
          </h1>
          <div className="flex items-center gap-1.5">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-secondary border border-primary/20 rounded px-2 py-1 text-[10px] font-heading text-foreground"
            >
              <option value="">All</option>
              <option value="open">Open</option>
              <option value="closed">Closed</option>
            </select>
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded text-[9px] font-heading font-bold uppercase border border-primary/50 bg-primary/20 text-primary hover:bg-primary/30"
            >
              <MessageSquare size={12} />
              New ticket
            </button>
          </div>
        </div>
        <p className="px-2.5 py-1.5 text-[9px] text-mutedForeground font-heading">
          Report bugs, ask questions, or get support.
          {canManage && ' As staff (admin, mod, or HDO) you can reply, close tickets, and handle crew name changes when requested.'}
        </p>
        <div className="hd-art-line text-primary mx-2.5" />
      </div>

      {createOpen && (
        <div className={`relative ${styles.panel} rounded-md border border-primary/20 hd-fade-in`}>
          <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between">
            <span className="text-[9px] font-heading font-bold text-primary uppercase">New ticket</span>
            <button type="button" onClick={() => setCreateOpen(false)} className="p-1 rounded hover:bg-primary/20 text-primary">
              <X size={14} />
            </button>
          </div>
          <form onSubmit={handleCreate} className="p-2.5 space-y-2">
            <input
              type="text"
              value={createSubject}
              onChange={(e) => setCreateSubject(e.target.value)}
              placeholder="Subject"
              maxLength={200}
              className="w-full px-2 py-1.5 bg-secondary border border-primary/20 rounded text-[11px] font-heading"
            />
            <textarea
              value={createBody}
              onChange={(e) => setCreateBody(e.target.value)}
              placeholder="Describe your issue or question..."
              rows={4}
              maxLength={10000}
              className="w-full px-2 py-1.5 bg-secondary border border-primary/20 rounded text-[11px] font-heading resize-y"
            />
            <div className="flex gap-2">
              <button type="submit" disabled={creating} className="px-2.5 py-1 rounded text-[9px] font-heading font-bold uppercase border border-primary/50 bg-primary/20 text-primary hover:bg-primary/30 disabled:opacity-50">
                {creating ? 'Creating…' : 'Create ticket'}
              </button>
              <button type="button" onClick={() => setCreateOpen(false)} className="px-2.5 py-1 rounded text-[9px] font-heading uppercase border border-primary/30 text-mutedForeground hover:text-foreground">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
        <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20">
          <span className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em]">Tickets</span>
        </div>
        {loading ? (
          <div className="p-4 text-center text-mutedForeground text-[11px] font-heading">Loading…</div>
        ) : tickets.length === 0 ? (
          <div className="p-4 text-center text-mutedForeground text-[11px] font-heading">No tickets yet. Create one above.</div>
        ) : (
          <ul className="divide-y divide-primary/10">
            {tickets.map((t) => (
              <li
                key={t.id}
                className={`hd-row px-2.5 py-2 flex items-center justify-between gap-2 cursor-pointer ${selectedId === t.id ? 'bg-primary/10' : ''}`}
                onClick={() => setSelectedId(t.id)}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[11px] font-heading font-bold text-foreground truncate">{t.subject}</span>
                    <span className={`text-[9px] font-heading uppercase px-1 py-0.5 rounded ${t.status === 'open' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-zinc-600/30 text-mutedForeground'}`}>
                      {t.status}
                    </span>
                    {canManage && <span className="text-[9px] text-mutedForeground">by {t.username}</span>}
                  </div>
                  <div className="text-[9px] text-mutedForeground mt-0.5">{formatDateTime(t.updated_at)}</div>
                </div>
                <ChevronRight size={14} className="text-primary shrink-0" />
              </li>
            ))}
          </ul>
        )}
        <div className="hd-art-line text-primary mx-2.5" />
      </div>

      {selectedId && (
        <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 hd-fade-in`}>
          <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between gap-2 flex-wrap">
            <span className="text-[9px] font-heading font-bold text-primary uppercase">Ticket</span>
            <button type="button" onClick={() => setSelectedId(null)} className="p-1 rounded hover:bg-primary/20 text-primary">
              <X size={14} />
            </button>
          </div>
          {detailLoading ? (
            <div className="p-4 text-center text-mutedForeground text-[11px]">Loading…</div>
          ) : ticketDetail ? (
            <div className="p-2.5 space-y-3">
              <div>
                <h2 className="text-[11px] font-heading font-bold text-foreground">{ticketDetail.subject}</h2>
                <div className="text-[9px] text-mutedForeground mt-0.5">
                  {ticketDetail.username} · {formatDateTime(ticketDetail.created_at)} · {ticketDetail.status}
                  {canManage && (
                    <span className="ml-1">
                      · <button type="button" onClick={handleClose} disabled={ticketDetail.status === 'closed' || closing} className="underline hover:text-foreground disabled:opacity-50">Close ticket</button>
                    </span>
                  )}
                </div>
              </div>
              <div className="px-2 py-1.5 bg-secondary/80 rounded border border-primary/10 text-[11px] font-heading whitespace-pre-wrap">
                {ticketDetail.body}
              </div>
              {ticketDetail.replies?.length > 0 && (
                <div className="space-y-2">
                  <span className="text-[9px] font-heading font-bold text-primary uppercase">Replies</span>
                  {ticketDetail.replies.map((r, i) => (
                    <div key={i} className="pl-2 border-l-2 border-primary/30 py-1">
                      <div className="text-[9px] text-mutedForeground">
                        {r.author_username} <span className="text-primary/80">({ROLE_LABELS[r.author_role] || r.author_role})</span> · {formatDateTime(r.created_at)}
                      </div>
                      <div className="text-[11px] font-heading whitespace-pre-wrap mt-0.5">{r.body}</div>
                    </div>
                  ))}
                </div>
              )}
              {ticketDetail.status === 'open' && (
                <form onSubmit={handleReply} className="space-y-2 pt-2 border-t border-primary/10">
                  <textarea
                    value={replyBody}
                    onChange={(e) => setReplyBody(e.target.value)}
                    placeholder="Your reply..."
                    rows={3}
                    maxLength={10000}
                    className="w-full px-2 py-1.5 bg-secondary border border-primary/20 rounded text-[11px] font-heading resize-y"
                  />
                  <button type="submit" disabled={replying || !replyBody.trim()} className="px-2.5 py-1 rounded text-[9px] font-heading font-bold uppercase border border-primary/50 bg-primary/20 text-primary hover:bg-primary/30 disabled:opacity-50 inline-flex items-center gap-1">
                    <Send size={12} />
                    {replying ? 'Sending…' : 'Send reply'}
                  </button>
                </form>
              )}
            </div>
          ) : null}
          <div className="hd-art-line text-primary mx-2.5" />
        </div>
      )}

      {canManage && (
        <div className={`relative ${styles.panel} rounded-md overflow-hidden border border-primary/20 hd-fade-in`}>
          <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20 flex items-center gap-1.5">
            <VolumeX size={14} className="text-primary" />
            <span className="text-[9px] font-heading font-bold text-primary uppercase tracking-[0.12em]">Forum mutes</span>
          </div>
          <p className="px-2.5 py-1.5 text-[9px] text-mutedForeground font-heading">
            Muted users cannot post on the forum. Hours or days, or permanent (permanent by HDO needs admin/mod review). You can unmute; admin/mod can approve permanent mutes.
          </p>
          <form onSubmit={handleMute} className="px-2.5 py-2 space-y-2 border-t border-primary/10">
            <div className="flex flex-wrap gap-2 items-end">
              <input
                type="text"
                value={muteUsername}
                onChange={(e) => setMuteUsername(e.target.value)}
                placeholder="Username"
                className="w-28 px-2 py-1 bg-secondary border border-primary/20 rounded text-[11px] font-heading"
              />
              <input
                type="number"
                min="0"
                value={muteHours}
                onChange={(e) => setMuteHours(e.target.value)}
                placeholder="Hours"
                className="w-16 px-2 py-1 bg-secondary border border-primary/20 rounded text-[11px] font-heading"
              />
              <input
                type="number"
                min="0"
                value={muteDays}
                onChange={(e) => setMuteDays(e.target.value)}
                placeholder="Days"
                className="w-16 px-2 py-1 bg-secondary border border-primary/20 rounded text-[11px] font-heading"
              />
              <label className="flex items-center gap-1 text-[10px] font-heading">
                <input type="checkbox" checked={mutePermanent} onChange={(e) => setMutePermanent(e.target.checked)} className="rounded" />
                Permanent
              </label>
              <input
                type="text"
                value={muteReason}
                onChange={(e) => setMuteReason(e.target.value)}
                placeholder="Reason (optional)"
                className="flex-1 min-w-[100px] px-2 py-1 bg-secondary border border-primary/20 rounded text-[11px] font-heading"
              />
              <button type="submit" disabled={muting} className="px-2.5 py-1 rounded text-[9px] font-heading font-bold uppercase border border-primary/50 bg-primary/20 text-primary hover:bg-primary/30 disabled:opacity-50">
                {muting ? 'Muting…' : 'Mute'}
              </button>
            </div>
          </form>
          <div className="px-2.5 py-2 border-t border-primary/10">
            <div className="text-[9px] font-heading font-bold text-primary uppercase mb-1.5">Active mutes</div>
            {forumMutesLoading ? (
              <p className="text-[10px] text-mutedForeground">Loading…</p>
            ) : forumMutes.length === 0 ? (
              <p className="text-[10px] text-mutedForeground font-heading">None.</p>
            ) : (
              <ul className="space-y-1.5">
                {forumMutes.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5 px-2 rounded bg-secondary/50 border border-primary/10 text-[11px] font-heading">
                    <span className="font-bold text-foreground">{m.username}</span>
                    <span className="text-mutedForeground">
                      {m.status === 'pending_review' ? 'Permanent (pending review)' : m.expires_at ? `until ${formatDateTime(m.expires_at)}` : 'Permanent'}
                    </span>
                    {m.reason && <span className="text-mutedForeground text-[10px]">· {m.reason}</span>}
                    <div className="flex gap-1">
                      {m.status === 'pending_review' && canApproveMute && (
                        <button type="button" onClick={() => handleApproveMute(m.id)} className="px-2 py-0.5 rounded text-[9px] font-heading uppercase border border-emerald-500/50 text-emerald-400 hover:bg-emerald-500/10">
                          Approve
                        </button>
                      )}
                      <button type="button" onClick={() => handleUnmute(m.username)} className="px-2 py-0.5 rounded text-[9px] font-heading uppercase border border-primary/50 text-primary hover:bg-primary/20">
                        Unmute
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="hd-art-line text-primary mx-2.5" />
        </div>
      )}
    </div>
  );
}
