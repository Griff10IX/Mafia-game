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

export default function WitnessStatements() {
  const [loading, setLoading] = useState(true);
  const [listings, setListings] = useState([]);
  const [balance, setBalance] = useState(0);
  const [cash, setCash] = useState(0);
  const [listQty, setListQty] = useState('');
  const [listPrice, setListPrice] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [meRes, listRes] = await Promise.all([api.get('/auth/me'), api.get('/witness-statements/listings')]);
      setBalance(Number(meRes.data?.witness_statements ?? 0));
      setCash(Number(meRes.data?.money ?? 0));
      setListings(Array.isArray(listRes.data) ? listRes.data : []);
    } catch (e) {
      toast.error(getApiErrorMessage(e, 'Failed to load'));
      setListings([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleList = async () => {
    const qty = parseInt(String(listQty).replace(/\D/g, ''), 10) || 0;
    const price = parseInt(String(listPrice).replace(/\D/g, ''), 10) || 0;
    if (qty < 1 || price < 1) {
      toast.error('Enter quantity (1+) and total cash price (1+).');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/witness-statements/list', { quantity: qty, price_cash: price });
      toast.success('Listed on the market.');
      setListQty('');
      setListPrice('');
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
    if (!window.confirm(`Buy ${row.quantity} statement(s) for ${money(row.price_cash)} total?`)) return;
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
            List stacks for <strong className="text-foreground">cash</strong> (total price for the lot) or buy from other players.
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
          <p className="text-[9px] text-mutedForeground">Up to 5 active listings. Statements are held in escrow until sold or cancelled.</p>
          <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
            <div className="flex-1 space-y-1">
              <label className="text-[9px] text-mutedForeground font-heading uppercase">Quantity</label>
              <FormattedNumberInput value={listQty} onChange={setListQty} placeholder="e.g. 10" className="w-full bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1.5 text-xs" />
            </div>
            <div className="flex-1 space-y-1">
              <label className="text-[9px] text-mutedForeground font-heading uppercase">Total cash ($)</label>
              <FormattedNumberInput value={listPrice} onChange={setListPrice} placeholder="Price for whole lot" className="w-full bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1.5 text-xs" />
            </div>
            <button
              type="button"
              onClick={handleList}
              disabled={submitting || loading}
              className="px-4 py-2 rounded border border-primary/40 bg-primary/20 text-primary text-[10px] font-heading font-bold uppercase hover:bg-primary/30 disabled:opacity-50 shrink-0"
            >
              List
            </button>
          </div>
        </div>
        <div className="ws-art-line text-primary mx-3" />
      </div>

      <div className={`${styles.panel} rounded-lg border border-primary/20 overflow-hidden`}>
        <div className="px-3 py-2 bg-primary/10 border-b border-primary/20">
          <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-wider">Market</span>
        </div>
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
                  <th className="px-3 py-2 tabular-nums">Total</th>
                  <th className="px-3 py-2 w-32"> </th>
                </tr>
              </thead>
              <tbody>
                {listings.map((row) => (
                  <tr key={row.id} className="border-b border-zinc-800/50 hover:bg-zinc-900/30">
                    <td className="px-3 py-2">
                      {row.is_own ? (
                        <span className="text-primary font-heading font-bold">You</span>
                      ) : (
                        <Link to={`/profile/${encodeURIComponent(row.seller_username)}`} className="text-foreground hover:text-primary font-medium">
                          {row.seller_username}
                        </Link>
                      )}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-foreground">{row.quantity.toLocaleString()}</td>
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
