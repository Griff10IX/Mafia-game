import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText, RefreshCw } from 'lucide-react';
import api, { refreshUser, getApiErrorMessage } from '../../utils/api';
import { toast } from 'sonner';
import { FormattedNumberInput } from '../../components/FormattedNumberInput';
import styles from '../../styles/noir.module.css';

const WS_STYLES = `
  @keyframes ws-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .ws-fade-in { animation: ws-fade-in 0.4s ease-out both; }
  .ws-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.15; }
`;

function money(n) {
  return `$${Math.trunc(Number(n || 0)).toLocaleString()}`;
}

function formatLogTime(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' });
  } catch (_) {
    return String(iso);
  }
}

function previewSnippet(text, maxLen = 140) {
  const s = (text || '').replace(/\s+/g, ' ').trim();
  if (!s) return '—';
  return s.length > maxLen ? `${s.slice(0, maxLen - 1)}…` : s;
}

export default function WitnessStatements() {
  const [loading, setLoading] = useState(true);
  const [listings, setListings] = useState([]);
  const [recentLog, setRecentLog] = useState([]);
  const [balance, setBalance] = useState(0);
  const [cash, setCash] = useState(0);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [listPrice, setListPrice] = useState('');
  const [listSellerAnonymous, setListSellerAnonymous] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [meRes, listRes, recentRes] = await Promise.all([
        api.get('/auth/me'),
        api.get('/witness-statements/listings'),
        api.get('/witness-statements/recent'),
      ]);
      setBalance(Number(meRes.data?.witness_statements ?? 0));
      setCash(Number(meRes.data?.money ?? 0));
      setListings(Array.isArray(listRes.data) ? listRes.data : []);
      const items = Array.isArray(recentRes.data?.items) ? recentRes.data.items : [];
      setRecentLog(items);
      setSelectedIds((prev) => {
        const next = new Set();
        const available = new Set(items.filter((r) => !r.listed_listing_id).map((r) => r.id));
        prev.forEach((id) => {
          if (available.has(id)) next.add(id);
        });
        return next;
      });
    } catch (e) {
      toast.error(getApiErrorMessage(e, 'Failed to load'));
      setListings([]);
      setRecentLog([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggleSelect = (row) => {
    if (row.listed_listing_id) return;
    const id = row.id;
    if (!id) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleList = async () => {
    const ids = [...selectedIds];
    const price = parseInt(String(listPrice).replace(/\D/g, ''), 10) || 0;
    if (ids.length < 1 || price < 1) {
      toast.error('Select at least one statement from the log and enter a total cash price (1+).');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/witness-statements/list', {
        notification_ids: ids,
        price_cash: price,
        seller_anonymous: listSellerAnonymous,
      });
      toast.success('Listed on the market.');
      setSelectedIds(new Set());
      setListPrice('');
      setListSellerAnonymous(false);
      await load();
      refreshUser();
    } catch (e) {
      toast.error(getApiErrorMessage(e, 'Failed to list'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async (listingId) => {
    if (!window.confirm('Cancel this listing? Statements return to you.')) return;
    setSubmitting(true);
    try {
      await api.post('/witness-statements/cancel', { listing_id: listingId });
      toast.success('Listing cancelled.');
      await load();
      refreshUser();
    } catch (e) {
      toast.error(getApiErrorMessage(e, 'Failed'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleBuy = async (row) => {
    const lines = Array.isArray(row.previews) && row.previews.length > 0
      ? row.previews.map((p, i) => `${i + 1}. ${previewSnippet(p, 200)}`).join('\n')
      : `${row.quantity} statement(s)`;
    if (!window.confirm(`Buy ${row.quantity} statement(s) for ${money(row.price_cash)} total?\n\n${lines}`)) return;
    setSubmitting(true);
    try {
      await api.post('/witness-statements/buy', { listing_id: row.id });
      toast.success('Purchase complete.');
      await load();
      refreshUser();
    } catch (e) {
      toast.error(getApiErrorMessage(e, 'Failed'));
    } finally {
      setSubmitting(false);
    }
  };

  const nSelected = selectedIds.size;

  return (
    <div className={`space-y-4 ${styles.pageContent} mobile-page-root ws-fade-in`}>
      <style>{WS_STYLES}</style>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <FileText size={18} className="text-primary shrink-0" />
            <h1 className="text-sm font-heading font-bold text-primary uppercase tracking-[0.12em]">Witness statements</h1>
          </div>
          <p className="text-[10px] text-mutedForeground mt-1 max-w-xl leading-relaxed">
            When you receive a <strong className="text-foreground">Witness statement</strong> notification from a kill, you gain one tradable statement here.
            Choose specific lines from your log to list for <strong className="text-foreground">cash</strong> (total price for the lot). Other players see the text with the <strong className="text-foreground">killer hidden</strong> until they buy. You can <strong className="text-foreground">hide your name</strong> as seller on the market.
          </p>
        </div>
        <button
          type="button"
          onClick={() => load()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded border border-primary/40 bg-primary/10 px-2.5 py-1.5 text-[10px] font-heading font-bold uppercase text-primary hover:bg-primary/20 disabled:opacity-50"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      <div className={`${styles.panel} rounded-lg border border-primary/20 overflow-hidden`}>
        <div className="px-3 py-2 bg-primary/10 border-b border-primary/20 flex flex-wrap gap-3 text-xs font-heading">
          <span className="text-mutedForeground">
            Your statements: <span className="text-primary font-bold tabular-nums">{balance.toLocaleString()}</span>
          </span>
          <span className="text-mutedForeground">
            Cash on hand: <span className="text-emerald-400 font-bold tabular-nums">{money(cash)}</span>
          </span>
        </div>
        <div className="p-3 space-y-3">
          <div className="text-[10px] font-heading font-bold text-primary uppercase tracking-wider">Create listing</div>
          <p className="text-[9px] text-mutedForeground">
            Up to 5 active listings. Tick rows in the witness log below, then set one price for the whole lot. Listed lines stay in your log but are held in escrow until sold or cancelled.
          </p>
          <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
            <div className="flex-1 space-y-1">
              <label className="text-[9px] text-mutedForeground font-heading uppercase">Selected</label>
              <div className="w-full bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1.5 text-xs text-foreground tabular-nums">
                {nSelected < 1 ? '—' : `${nSelected} statement${nSelected === 1 ? '' : 's'}`}
              </div>
            </div>
            <div className="flex-1 space-y-1">
              <label className="text-[9px] text-mutedForeground font-heading uppercase">Total cash ($)</label>
              <FormattedNumberInput value={listPrice} onChange={setListPrice} placeholder="Price for whole lot" className="w-full bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1.5 text-xs" />
            </div>
            <button
              type="button"
              onClick={handleList}
              disabled={submitting || loading || nSelected < 1}
              className="px-4 py-2 rounded border border-primary/40 bg-primary/20 text-primary text-[10px] font-heading font-bold uppercase hover:bg-primary/30 disabled:opacity-50 shrink-0"
            >
              List
            </button>
          </div>
          <label className="flex items-center gap-2 cursor-pointer select-none text-[9px] text-mutedForeground font-heading">
            <input
              type="checkbox"
              className="rounded border-zinc-600 accent-primary"
              checked={listSellerAnonymous}
              onChange={(e) => setListSellerAnonymous(e.target.checked)}
            />
            <span>List as <strong className="text-foreground">Anonymous</strong> (others won&apos;t see your username or profile link)</span>
          </label>
        </div>
        <div className="ws-art-line text-primary mx-3" />
      </div>

      <div className={`${styles.panel} rounded-lg border border-primary/20 overflow-hidden`}>
        <div className="px-3 py-2 bg-primary/10 border-b border-primary/20">
          <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-wider">Witness log</span>
        </div>
        {loading ? (
          <div className="p-6 text-center text-xs text-mutedForeground font-heading">Loading…</div>
        ) : recentLog.length === 0 ? (
          <div className="p-6 text-center text-xs text-mutedForeground leading-relaxed">
            No witness lines yet. When you are online during a kill you witness, the same text appears here and in{' '}
            <Link to="/social/inbox" className="text-primary hover:underline font-heading">
              Inbox
            </Link>
            .
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11px]">
              <thead>
                <tr className="border-b border-zinc-700/50 text-[9px] font-heading uppercase text-mutedForeground">
                  <th className="px-2 py-2 w-10 whitespace-nowrap"> </th>
                  <th className="px-3 py-2 whitespace-nowrap w-36">Time</th>
                  <th className="px-3 py-2">Details</th>
                </tr>
              </thead>
              <tbody>
                {recentLog.map((row) => {
                  const locked = !!row.listed_listing_id;
                  const checked = row.id && selectedIds.has(row.id);
                  return (
                    <tr
                      key={row.id || row.created_at}
                      className={`border-b border-zinc-800/50 align-top hover:bg-zinc-900/30 ${locked ? 'opacity-60' : ''}`}
                    >
                      <td className="px-2 py-2 text-center">
                        <input
                          type="checkbox"
                          className="rounded border-zinc-600 accent-primary cursor-pointer disabled:cursor-not-allowed"
                          checked={checked}
                          disabled={!row.id || locked}
                          onChange={() => toggleSelect(row)}
                          title={locked ? 'Already in an active listing' : 'Include in next listing'}
                        />
                      </td>
                      <td className="px-3 py-2 text-mutedForeground tabular-nums whitespace-nowrap">
                        {formatLogTime(row.created_at)}
                        {locked && (
                          <span className="block text-[8px] text-amber-500/90 font-heading uppercase mt-0.5">Listed</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-foreground whitespace-pre-wrap break-words">{row.message || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className={`${styles.panel} rounded-lg border border-primary/20 overflow-hidden`}>
        <div className="px-3 py-2 bg-primary/10 border-b border-primary/20">
          <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-wider">Market</span>
        </div>
        <p className="px-3 pt-2 text-[9px] text-mutedForeground font-heading">
          Previews hide the killer&apos;s name until purchase. Sellers who list anonymously appear as &quot;Anonymous&quot; (no profile link). Your own listings always show full preview text to you.
        </p>
        {loading ? (
          <div className="p-8 text-center text-xs text-mutedForeground font-heading">Loading…</div>
        ) : listings.length === 0 ? (
          <div className="p-8 text-center text-xs text-mutedForeground">No listings yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11px]">
              <thead>
                <tr className="border-b border-zinc-700/50 text-[9px] font-heading uppercase text-mutedForeground">
                  <th className="px-3 py-2">Seller</th>
                  <th className="px-3 py-2 tabular-nums">Qty</th>
                  <th className="px-3 py-2 min-w-[200px]">Preview</th>
                  <th className="px-3 py-2 tabular-nums">Total</th>
                  <th className="px-3 py-2 w-32"> </th>
                </tr>
              </thead>
              <tbody>
                {listings.map((row) => (
                  <tr key={row.id} className="border-b border-zinc-800/50 hover:bg-zinc-900/30 align-top">
                    <td className="px-3 py-2">
                      {row.is_own ? (
                        <div className="flex flex-col gap-0.5">
                          <span className="text-primary font-heading font-bold">You</span>
                          {row.seller_anonymous && (
                            <span className="text-[8px] text-mutedForeground font-heading uppercase tracking-wide">Anonymous to others</span>
                          )}
                        </div>
                      ) : row.seller_profile_hidden ? (
                        <span className="text-mutedForeground font-heading font-medium">Anonymous</span>
                      ) : (
                        <Link to={`/profile/${encodeURIComponent(row.seller_username)}`} className="text-foreground hover:text-primary font-medium">
                          {row.seller_username}
                        </Link>
                      )}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-foreground">{row.quantity.toLocaleString()}</td>
                    <td className="px-3 py-2 text-mutedForeground space-y-1">
                      {Array.isArray(row.previews) && row.previews.length > 0 ? (
                        row.previews.map((p, i) => (
                          <div key={i} className="text-[10px] leading-snug border-l-2 border-primary/25 pl-2">
                            {previewSnippet(p, 220)}
                          </div>
                        ))
                      ) : (
                        <span className="text-[10px] italic">No preview (legacy listing)</span>
                      )}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-emerald-400 font-heading">{money(row.price_cash)}</td>
                    <td className="px-3 py-2">
                      {row.is_own ? (
                        <button
                          type="button"
                          onClick={() => handleCancel(row.id)}
                          disabled={submitting}
                          className="text-[9px] font-heading uppercase text-amber-400 hover:text-amber-300 disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleBuy(row)}
                          disabled={submitting}
                          className="text-[9px] font-heading uppercase px-2 py-1 rounded border border-primary/40 bg-primary/15 text-primary hover:bg-primary/25 disabled:opacity-50"
                        >
                          Buy
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
