import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, RefreshCw, Send, Unlock } from 'lucide-react';
import api from '../../utils/api';
import { formatAdminDateTime } from '../../utils/adminDateTime';
import { toast } from 'sonner';
import {
  AdminPage, Button, Card, EmptyState, KpiGrid, KpiTile, LoadingBlock, fmtNum, touchClass,
} from './kit/AdminKit';

function MessageBlock({ label, tone, text, at }) {
  const toneClass = { them: 'text-zinc-400', staff: 'text-sky-300', reply: 'text-emerald-300' }[tone];
  return (
    <div className="space-y-1">
      <div className={`text-xs font-medium ${toneClass}`}>{label}</div>
      <p className="whitespace-pre-wrap text-sm text-zinc-100">{text}</p>
      {at && <p className="text-xs text-zinc-500">{formatAdminDateTime(at)}</p>}
    </div>
  );
}

export default function AdminLocked() {
  const navigate = useNavigate();
  const [lockedAccounts, setLockedAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lockedMessageByUser, setLockedMessageByUser] = useState({});
  const [sendingMessageTo, setSendingMessageTo] = useState(null);
  const [accessChecked, setAccessChecked] = useState(false);

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
    return () => { cancelled = true; };
  }, [navigate]);

  const fetchLockedAccounts = async () => {
    if (!accessChecked) return;
    setLoading(true);
    try {
      const res = await api.get('/admin/locked-accounts');
      setLockedAccounts(res.data?.locked || []);
    } catch (e) {
      if (e.response?.status === 403) {
        toast.error('Admin access required');
        navigate('/dashboard', { replace: true });
        return;
      }
      setLockedAccounts([]);
      toast.error('Failed to load locked accounts');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (accessChecked) fetchLockedAccounts();
  }, [accessChecked]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleUnlockAccount = async (username) => {
    try {
      await api.post(`/admin/unlock-account?target_username=${encodeURIComponent(username)}`);
      toast.success('Account unlocked');
      fetchLockedAccounts();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to unlock');
    }
  };

  const handleSendMessage = async (username) => {
    const message = (lockedMessageByUser[username] || '').trim();
    if (!message) {
      toast.error('Enter a message');
      return;
    }
    setSendingMessageTo(username);
    try {
      await api.post('/admin/locked-account-message', { target_username: username, message });
      toast.success('Message sent');
      setLockedMessageByUser((prev) => ({ ...prev, [username]: '' }));
      fetchLockedAccounts();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to send');
    } finally {
      setSendingMessageTo(null);
    }
  };

  const pageProps = {
    title: 'Locked accounts',
    subtitle: 'See who is locked, leave them a message and read their replies. Locked players can only open the locked page and reply once to your message.',
    icon: Lock,
  };

  if (!accessChecked || (loading && lockedAccounts.length === 0)) {
    return <AdminPage {...pageProps}><LoadingBlock /></AdminPage>;
  }

  const withComment = lockedAccounts.filter((u) => u.account_locked_comment).length;
  const replied = lockedAccounts.filter((u) => u.account_locked_user_reply).length;

  return (
    <AdminPage
      {...pageProps}
      actions={<Button icon={RefreshCw} loading={loading} onClick={fetchLockedAccounts} className={touchClass}>{loading ? 'Loading…' : 'Refresh'}</Button>}
    >
      <KpiGrid cols={3}>
        <KpiTile label="Locked accounts" value={fmtNum(lockedAccounts.length)} tone={lockedAccounts.length ? 'warn' : 'default'} />
        <KpiTile label="Left a message" value={fmtNum(withComment)} />
        <KpiTile label="Replied to staff" value={fmtNum(replied)} />
      </KpiGrid>

      {lockedAccounts.length === 0 ? (
        <Card><EmptyState>No accounts are currently locked.</EmptyState></Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {lockedAccounts.map((u) => {
            const draft = lockedMessageByUser[u.username] ?? '';
            const sending = sendingMessageTo === u.username;
            return (
              <Card
                key={u.username}
                title={<span className="text-base text-amber-300">{u.username}</span>}
                subtitle={u.account_locked_at ? (
                  <>
                    Locked {formatAdminDateTime(u.account_locked_at)}
                    {u.account_locked_until && <> · Test lock until {formatAdminDateTime(u.account_locked_until)}</>}
                  </>
                ) : undefined}
                actions={(
                  <Button icon={Unlock} onClick={() => handleUnlockAccount(u.username)} className={touchClass}>
                    Unlock
                  </Button>
                )}
              >
                <div className="space-y-4">
                  {u.account_locked_comment ? (
                    <MessageBlock label="Their message" tone="them" text={u.account_locked_comment} at={u.account_locked_comment_at} />
                  ) : (
                    <div className="space-y-1">
                      <div className="text-xs font-medium text-zinc-400">Their message</div>
                      <p className="text-sm italic text-zinc-500">No message yet.</p>
                    </div>
                  )}
                  {u.account_locked_admin_message && (
                    <div className="border-t border-zinc-800 pt-3">
                      <MessageBlock label="Your message" tone="staff" text={u.account_locked_admin_message} at={u.account_locked_admin_message_at} />
                    </div>
                  )}
                  {u.account_locked_user_reply && (
                    <MessageBlock label="Their reply" tone="reply" text={u.account_locked_user_reply} at={u.account_locked_user_reply_at} />
                  )}
                  <div className="space-y-2 border-t border-zinc-800 pt-3">
                    <label htmlFor={`locked-msg-${u.username}`} className="block text-sm text-zinc-400">
                      Leave a message (they can reply once)
                    </label>
                    <textarea
                      id={`locked-msg-${u.username}`}
                      value={draft}
                      onChange={(e) => setLockedMessageByUser((prev) => ({ ...prev, [u.username]: e.target.value }))}
                      placeholder="Type your message…"
                      rows={3}
                      maxLength={2000}
                      disabled={sending}
                      className="w-full resize-y rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-base text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-500 focus:outline-none disabled:opacity-50 sm:text-sm"
                    />
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs tabular-nums text-zinc-500">{draft.length} / 2000</span>
                      <Button
                        variant="primary"
                        icon={Send}
                        loading={sending}
                        disabled={!draft.trim()}
                        onClick={() => handleSendMessage(u.username)}
                        className={touchClass}
                      >
                        {sending ? 'Sending…' : 'Send message'}
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </AdminPage>
  );
}
