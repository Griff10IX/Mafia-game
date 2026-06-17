import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import api from '../../utils/api';
import { getApiErrorMessage } from '../../utils/api';
import { Headphones, RefreshCw, HelpCircle } from 'lucide-react';

const DEFAULT_HDO_COLOR = '#166534';

export default function HelpDeskHub() {
  const [dash, setDash] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState(null);
  const [hdoColor, setHdoColor] = useState(DEFAULT_HDO_COLOR);
  const [colorSaving, setColorSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadErr(null);
    try {
      const res = await api.get('/help-desk/hdo/dashboard');
      setDash(res.data);
    } catch (e) {
      const status = e?.response?.status;
      const msg = getApiErrorMessage(e);
      setLoadErr({ status, msg });
      setDash((prev) => (prev?.username ? prev : null));
      if (!dash?.username) toast.error(msg || 'Could not load Help Desk hub');
    } finally {
      setLoading(false);
    }
  }, [dash?.username]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api.get('/auth/me');
        if (!cancelled && r.data?.hdo_online_color) {
          setHdoColor((r.data.hdo_online_color || '').trim() || DEFAULT_HDO_COLOR);
        }
      } catch (_) {}
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const saveColor = async () => {
    const hex = (hdoColor || '').trim() || DEFAULT_HDO_COLOR;
    if (!/^#[0-9A-Fa-f]{3}([0-9A-Fa-f]{3})?$/.test(hex)) {
      toast.error('Enter a valid hex colour');
      return;
    }
    setColorSaving(true);
    try {
      await api.patch('/profile/hdo-online-color', { color: hex });
      toast.success('Help Desk online colour saved');
      const r = await api.get('/auth/me');
      if (r.data?.hdo_online_color) setHdoColor((r.data.hdo_online_color || '').trim() || DEFAULT_HDO_COLOR);
    } catch (e) {
      toast.error(e.response?.data?.detail ?? 'Failed to save');
    } finally {
      setColorSaving(false);
    }
  };

  if (loading) {
    return <div className="p-4 text-mutedForeground font-heading text-sm">Loading Help Desk hub…</div>;
  }

  if (!dash?.username) {
    return (
      <div className="p-4 max-w-lg mx-auto space-y-3">
        <p className="text-foreground font-heading">
          {loadErr?.status === 403
            ? 'You do not have Help Desk Operator access.'
            : 'Connection problem — the Help Desk dashboard could not be loaded.'}
        </p>
        {loadErr?.msg && loadErr?.status !== 403 ? (
          <p className="text-xs text-mutedForeground">{loadErr.msg}</p>
        ) : null}
        <button
          type="button"
          onClick={() => load()}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-heading font-bold uppercase rounded bg-primary/20 border border-primary/50 text-primary hover:bg-primary/30"
        >
          <RefreshCw size={14} /> Retry
        </button>
        <Link to="/account/dashboard" className="text-primary underline text-sm font-heading">
          Back to dashboard
        </Link>
      </div>
    );
  }

  const tile = (label, value, sub) => (
    <div className="rounded-lg border border-primary/25 bg-zinc-900/40 p-3">
      <div className="text-[10px] font-heading uppercase tracking-wider text-mutedForeground">{label}</div>
      <div className="text-xl font-heading font-bold text-primary mt-1 tabular-nums">{value}</div>
      {sub ? <div className="text-[10px] text-mutedForeground mt-1">{sub}</div> : null}
    </div>
  );

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Headphones className="text-primary" size={22} />
          <h1 className="text-lg font-heading font-bold text-foreground uppercase tracking-wide">Help Desk Hub</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => load()}
            className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-heading uppercase border border-primary/40 rounded text-primary hover:bg-primary/10"
          >
            <RefreshCw size={12} /> Refresh
          </button>
          <Link
            to="/game/help-desk"
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-heading font-bold uppercase rounded bg-primary/20 border border-primary/50 text-primary hover:bg-primary/30"
          >
            <HelpCircle size={14} /> Open Help Desk
          </Link>
        </div>
      </div>

      <p className="text-[11px] text-mutedForeground">
        You earn <strong className="text-foreground">{dash.points_per_close ?? 100} points</strong> for each ticket{' '}
        <strong className="text-foreground">you close</strong> (not per reply). Points are credited after an admin approves the
        request.
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {tile('Points earned (approved)', (dash.points_earned_approved ?? 0).toLocaleString(), 'From approved close rewards')}
        {tile('Pending approvals', (dash.pending_reward_count ?? 0).toLocaleString(), 'Awaiting admin')}
        {tile('Rejected', (dash.rejected_reward_count ?? 0).toLocaleString(), 'Not paid')}
        {tile('Tickets closed', (dash.tickets_closed ?? 0).toLocaleString(), 'As closer')}
        {tile('Users helped', (dash.users_helped ?? 0).toLocaleString(), 'Distinct players (excl. yourself)')}
        {tile('Staff replies', (dash.staff_replies_count ?? 0).toLocaleString(), 'All-time on tickets')}
      </div>

      <div className="rounded-lg border border-primary/25 bg-zinc-900/40 p-4 space-y-3">
        <div className="text-[10px] font-heading uppercase tracking-wider text-primary">Users online colour</div>
        <p className="text-[11px] text-mutedForeground">Pick how your name appears on the live roster (same as Entertainer hub).</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-[10px] text-mutedForeground font-heading uppercase">
            Hex
            <input
              value={hdoColor}
              onChange={(e) => setHdoColor(e.target.value)}
              className="w-36 px-2 py-1 rounded border border-input bg-transparent text-xs font-mono"
              maxLength={7}
            />
          </label>
          <input
            type="color"
            value={/^#[0-9A-Fa-f]{6}$/.test(hdoColor) ? hdoColor : DEFAULT_HDO_COLOR}
            onChange={(e) => setHdoColor(e.target.value)}
            className="h-9 w-14 cursor-pointer rounded border border-input bg-transparent p-0.5"
            aria-label="Colour picker"
          />
          <button
            type="button"
            disabled={colorSaving}
            onClick={saveColor}
            className="px-3 py-1.5 text-xs font-heading font-bold uppercase rounded bg-primary/20 border border-primary/50 text-primary hover:bg-primary/30 disabled:opacity-50"
          >
            {colorSaving ? 'Saving…' : 'Save colour'}
          </button>
        </div>
      </div>
    </div>
  );
}
