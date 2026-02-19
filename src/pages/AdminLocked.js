import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, RefreshCw, MessageSquare, Unlock } from 'lucide-react';
import api from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

export default function AdminLocked() {
  const navigate = useNavigate();
  const [lockedAccounts, setLockedAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lockedMessageByUser, setLockedMessageByUser] = useState({});
  const [sendingMessageTo, setSendingMessageTo] = useState(null);

  const fetchLockedAccounts = async () => {
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
    fetchLockedAccounts();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  if (loading && lockedAccounts.length === 0) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-4 pb-24">
      <div className={`rounded-lg overflow-hidden border ${styles.panel} border-primary/20`}>
        <div className="px-4 py-3 border-b border-primary/20 flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Lock size={18} className="text-amber-400" />
            <h1 className="text-sm font-heading font-bold uppercase tracking-wider text-foreground">
              Locked accounts
            </h1>
          </div>
          <button
            type="button"
            onClick={fetchLockedAccounts}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[10px] font-heading font-bold uppercase border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
        <div className="p-4 space-y-4">
          <p className="text-[11px] text-zinc-400 font-heading">
            View status, leave messages for locked users, and see their replies. They can only access the locked page and reply once to your message.
          </p>
          {lockedAccounts.length === 0 ? (
            <div className="text-center py-8 text-zinc-500 text-sm font-heading">
              No accounts are currently locked.
            </div>
          ) : (
            <div className="space-y-4">
              {lockedAccounts.map((u) => (
                <div
                  key={u.username}
                  className="rounded-lg border border-zinc-600/50 bg-zinc-800/30 p-4 text-[11px] font-heading"
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                    <span className="font-bold text-amber-400 text-sm">{u.username}</span>
                    <button
                      type="button"
                      onClick={() => handleUnlockAccount(u.username)}
                      className="flex items-center gap-1 px-2.5 py-1 rounded text-[10px] font-heading font-bold uppercase border border-emerald-500/40 bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30"
                    >
                      <Unlock size={12} />
                      Unlock
                    </button>
                  </div>
                  {u.account_locked_at && (
                    <div className="text-zinc-500 text-[10px] mb-2">
                      Locked: {new Date(u.account_locked_at).toLocaleString()}
                      {u.account_locked_until && (
                        <span className="ml-2"> · Test lock until {new Date(u.account_locked_until).toLocaleString()}</span>
                      )}
                    </div>
                  )}
                  <div className="mb-2">
                    <span className="text-zinc-500 uppercase tracking-wider text-[9px]">Their message</span>
                    {u.account_locked_comment ? (
                      <>
                        <p className="text-foreground whitespace-pre-wrap mt-0.5">{u.account_locked_comment}</p>
                        {u.account_locked_comment_at && (
                          <p className="text-zinc-500 text-[9px] mt-0.5">{new Date(u.account_locked_comment_at).toLocaleString()}</p>
                        )}
                      </>
                    ) : (
                      <p className="text-zinc-500 italic mt-0.5">No message yet.</p>
                    )}
                  </div>
                  {u.account_locked_admin_message && (
                    <div className="mb-2 pt-2 border-t border-zinc-600/50">
                      <span className="text-primary font-bold uppercase tracking-wider text-[9px]">Your message</span>
                      <p className="text-foreground whitespace-pre-wrap mt-0.5">{u.account_locked_admin_message}</p>
                      {u.account_locked_admin_message_at && (
                        <p className="text-zinc-500 text-[9px] mt-0.5">{new Date(u.account_locked_admin_message_at).toLocaleString()}</p>
                      )}
                    </div>
                  )}
                  {u.account_locked_user_reply && (
                    <div className="mb-2">
                      <span className="text-emerald-400 font-bold uppercase tracking-wider text-[9px]">Their reply</span>
                      <p className="text-foreground whitespace-pre-wrap mt-0.5">{u.account_locked_user_reply}</p>
                      {u.account_locked_user_reply_at && (
                        <p className="text-zinc-500 text-[9px] mt-0.5">{new Date(u.account_locked_user_reply_at).toLocaleString()}</p>
                      )}
                    </div>
                  )}
                  <div className="pt-3 border-t border-zinc-600/50 mt-2">
                    <label className="block text-zinc-400 uppercase tracking-wider text-[9px] mb-1">
                      <MessageSquare size={10} className="inline mr-0.5" />
                      Leave message (they can reply once)
                    </label>
                    <textarea
                      value={lockedMessageByUser[u.username] ?? ''}
                      onChange={(e) => setLockedMessageByUser((prev) => ({ ...prev, [u.username]: e.target.value }))}
                      placeholder="Type your message..."
                      rows={3}
                      className="w-full px-3 py-2 rounded border border-zinc-600 bg-zinc-800/50 text-foreground text-sm font-heading placeholder:text-zinc-500 focus:border-primary/50 focus:outline-none resize-y"
                      maxLength={2000}
                      disabled={sendingMessageTo === u.username}
                    />
                    <div className="flex justify-between items-center mt-1">
                      <span className="text-[9px] text-zinc-500">{(lockedMessageByUser[u.username] ?? '').length} / 2000</span>
                      <button
                        type="button"
                        onClick={() => handleSendMessage(u.username)}
                        disabled={sendingMessageTo === u.username || !(lockedMessageByUser[u.username] || '').trim()}
                        className="px-3 py-1.5 rounded text-[10px] font-heading font-bold uppercase border border-primary/40 bg-primary/20 text-primary hover:bg-primary/30 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {sendingMessageTo === u.username ? 'Sending...' : 'Send message'}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
