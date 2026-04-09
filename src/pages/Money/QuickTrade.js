import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Coins, ArrowLeftRight, Users, Building2, TrendingUp, TrendingDown, HelpCircle, Zap } from 'lucide-react';
import api, { refreshUser } from '../../utils/api';
import { toast } from 'sonner';
import { FormattedNumberInput } from '../../components/FormattedNumberInput';
import styles from '../../styles/noir.module.css';

const QT_STYLES = `
  .qt-fade-in { animation: qt-fade-in 0.4s ease-out both; }
  @keyframes qt-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .qt-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.15; }
`;

/** Scroll regions can steal taps on mobile; keep actions above row hit targets. */
const qtActionBtn = 'relative z-[2] touch-manipulation';

export default function QuickTrade() {
  const [hasLoaded, setHasLoaded] = useState(false);
  const [sellOffers, setSellOffers] = useState([]);
  const [buyOffers, setBuyOffers] = useState([]);
  const [tokenOffers, setTokenOffers] = useState([]);
  const [properties, setProperties] = useState([]);
  const [tokenBalances, setTokenBalances] = useState({});

  const TOKEN_TYPES = ['xp_crimes', 'xp_gta', 'melt', 'oc_reduced', 'booze', 'racket', 'travel', 'properties', 'jailbust_bonus'];
  const formatTokenName = (t) => t.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  
  // Create offer form
  const [sellPoints, setSellPoints] = useState('');
  const [sellCost, setSellCost] = useState('');
  const [buyPoints, setBuyPoints] = useState('');
  const [buyOffer, setBuyOffer] = useState('');
  const [hideNameSell, setHideNameSell] = useState(false);
  const [hideNameBuy, setHideNameBuy] = useState(false);
  const [sellOfferCount, setSellOfferCount] = useState(1);
  const [buyOfferCount, setBuyOfferCount] = useState(1);
  const [creatingOffers, setCreatingOffers] = useState(false);
  const [tokenType, setTokenType] = useState('xp_crimes');
  const [tokenQuantity, setTokenQuantity] = useState('1');
  const [tokenPrice, setTokenPrice] = useState('');
  /** 'points' | 'money' — cash listings require min $250k per token (server-enforced). */
  const [tokenPriceCurrency, setTokenPriceCurrency] = useState('points');
  const [creatingToken, setCreatingToken] = useState(false);

  const TOKEN_MIN_CASH_PER_TOKEN = 250_000;

  useEffect(() => {
    fetchTrades();
  }, []);

  /** Server masks anon listings as "[Anonymous]" for normal players; admins get the real username in `username`. */
  const isMaskedQtUsername = (u) => !u || u === 'Anonymous' || u === '[Anonymous]';

  const renderQtTraderLabel = (offer, isOwn) => {
    if (isOwn) return 'You';
    const u = offer.username;
    const hidePublic = offer.hide_name && isMaskedQtUsername(u);
    if (hidePublic) return '[Anon]';
    const isPlaceholder = isMaskedQtUsername(u);
    if (!isPlaceholder) {
      return (
        <span className="inline-flex items-center flex-wrap gap-x-1">
          <Link to={`/profile/${encodeURIComponent(u)}`} className="text-primary hover:underline">
            {u}
          </Link>
          {offer.hide_name ? (
            <span className="text-[9px] font-normal text-mutedForeground normal-case tracking-normal">(listed anon)</span>
          ) : null}
        </span>
      );
    }
    return u || '[Unknown]';
  };

  const fetchTrades = async () => {
    try {
      const [sellRes, buyRes, tokenRes, propRes, balancesRes] = await Promise.all([
        api.get('/trade/sell-offers'),
        api.get('/trade/buy-offers'),
        api.get('/trade/token-offers'),
        api.get('/trade/properties'),
        api.get('/trade/my-token-balances'),
      ]);
      setSellOffers(sellRes.data || []);
      setBuyOffers(buyRes.data || []);
      setTokenOffers(tokenRes.data || []);
      setProperties(propRes.data || []);
      setTokenBalances(balancesRes.data || {});
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load trades');
    } finally { setHasLoaded(true); }
  };

  // Auto-fill offer/cost from existing offers: buy = highest + 1, sell = lowest - 1 (only when field is empty)
  const didAutoFill = useRef({ buy: false, sell: false });
  useEffect(() => {
    if (buyOffers.length && !didAutoFill.current.buy) {
      const rates = buyOffers.map((o) => (Number(o.cost) || 0) / (Number(o.points) || 1)).filter((r) => r > 0);
      if (rates.length) { setBuyOffer(String(Math.round(Math.max(...rates) + 1))); didAutoFill.current.buy = true; }
    }
    if (sellOffers.length && !didAutoFill.current.sell) {
      const rates = sellOffers.map((o) => (Number(o.money) || 0) / (Number(o.points) || 1)).filter((r) => r > 0);
      if (rates.length) { setSellCost(String(Math.max(1, Math.round(Math.min(...rates) - 1)))); didAutoFill.current.sell = true; }
    }
  }, [buyOffers, sellOffers]);

  const handleCreateSellOffer = async () => {
    if (!sellPoints || !sellCost) {
      toast.error('Enter points and cost');
      return;
    }
    const parsedSellPoints = parseInt(String(sellPoints).replace(/,/g, ''), 10) || 0;
    if (parsedSellPoints < 2) {
      toast.error('Minimum 2 points (1 point fee leaves 0 listed).');
      return;
    }
    const perPoint = parseFloat(sellCost) || 0;
    if (perPoint < 50000) {
      toast.error('Minimum price is $50,000 per point.');
      return;
    }
    const count = Math.max(1, Math.min(10, parseInt(String(sellOfferCount), 10) || 1));
    setCreatingOffers(true);
    let created = 0;
    try {
      for (let i = 0; i < count; i++) {
        await api.post('/trade/sell-offer', {
          points: parsedSellPoints,
          cost: sellTotal,
          hide_name: hideNameSell
        });
        created++;
      }
      toast.success(created === 1 ? 'Sell offer created!' : `${created} sell offers created!`);
      setSellPoints('');
      setSellCost('');
      fetchTrades();
      refreshUser();
    } catch (e) {
      if (created > 0) {
        toast.success(`${created} offer(s) created. ${e.response?.data?.detail || 'Stopped.'}`);
        fetchTrades();
        refreshUser();
      } else {
        toast.error(e.response?.data?.detail || 'Failed to create offer');
      }
    } finally {
      setCreatingOffers(false);
    }
  };

  const handleCreateBuyOffer = async () => {
    if (!buyPoints || !buyOffer) {
      toast.error('Enter points and offer amount');
      return;
    }
    const parsedBuyPoints = parseInt(String(buyPoints).replace(/,/g, ''), 10) || 0;
    if (parsedBuyPoints < 2) {
      toast.error('Minimum 2 points (1 point fee leaves 0 listed).');
      return;
    }
    const perPoint = parseFloat(buyOffer) || 0;
    if (perPoint < 50000) {
      toast.error('Minimum price is $50,000 per point.');
      return;
    }
    const count = Math.max(1, Math.min(10, parseInt(String(buyOfferCount), 10) || 1));
    setCreatingOffers(true);
    let created = 0;
    try {
      for (let i = 0; i < count; i++) {
        await api.post('/trade/buy-offer', {
          points: parsedBuyPoints,
          offer: buyTotal,
          hide_name: hideNameBuy
        });
        created++;
      }
      toast.success(created === 1 ? 'Buy offer created!' : `${created} buy offers created!`);
      setBuyPoints('');
      setBuyOffer('');
      fetchTrades();
      refreshUser();
    } catch (e) {
      if (created > 0) {
        toast.success(`${created} offer(s) created. ${e.response?.data?.detail || 'Stopped.'}`);
        fetchTrades();
        refreshUser();
      } else {
        toast.error(e.response?.data?.detail || 'Failed to create offer');
      }
    } finally {
      setCreatingOffers(false);
    }
  };

  const handleAcceptOffer = async (offerId, type) => {
    try {
      const url = type === 'property'
        ? `/trade/property/${offerId}/accept`
        : `/trade/${type}-offer/${offerId}/accept`;
      await api.post(url);
      toast.success('Trade completed!');
      fetchTrades();
      refreshUser();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Trade failed');
    }
  };

  const handleAcceptBatch = async (offerIds, type) => {
    if (!offerIds.length) return;
    let completed = 0;
    try {
      for (const id of offerIds) {
        await api.post(`/trade/${type}-offer/${id}/accept`);
        completed++;
      }
      toast.success(completed === 1 ? 'Trade completed!' : `${completed} trades completed!`);
    } catch (e) {
      if (completed > 0) {
        toast.success(`${completed} of ${offerIds.length} trades completed. ${e.response?.data?.detail || 'Remaining failed.'}`);
      } else {
        toast.error(e.response?.data?.detail || 'Trade failed');
      }
    }
    fetchTrades();
    refreshUser();
  };

  const handleCancelOffer = async (offerId, type) => {
    if (!window.confirm('Cancel this offer? The fee will be refunded.')) return;
    try {
      await api.delete(`/trade/${type}-offer/${offerId}`);
      toast.success('Offer cancelled and refunded!');
      fetchTrades();
      refreshUser();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to cancel offer');
    }
  };

  const handleCreateTokenOffer = async () => {
    let qty = Math.max(1, parseInt(String(tokenQuantity).replace(/,/g, ''), 10) || 1);
    const sellable = tokenBalances[tokenType]?.sellable;
    if (sellable != null && qty > sellable) qty = Math.max(0, sellable);
    if (qty < 1) {
      toast.error(
        'No tradable tokens to list. Referral, entertainer, and some Founding Member bonus tokens cannot be sold on Quick Trade.',
      );
      return;
    }
    const minCash = TOKEN_MIN_CASH_PER_TOKEN * qty;
    let body;
    if (tokenPriceCurrency === 'points') {
      const price = Math.max(1, parseInt(String(tokenPrice).replace(/,/g, ''), 10) || 0);
      if (!price) {
        toast.error('Enter price in points');
        return;
      }
      body = { token_type: tokenType, quantity: qty, price_currency: 'points', price_points: price, price_money: 0 };
    } else {
      const cash = Math.round(parseFloat(String(tokenPrice).replace(/,/g, '')) || 0);
      if (!cash || cash < minCash) {
        toast.error(`Minimum cash for ${qty} token(s) is $${formatNumber(minCash)} ($${formatNumber(TOKEN_MIN_CASH_PER_TOKEN)} per token)`);
        return;
      }
      body = { token_type: tokenType, quantity: qty, price_currency: 'money', price_points: 0, price_money: cash };
    }
    setCreatingToken(true);
    try {
      await api.post('/trade/token-offer', body);
      toast.success('Token offer created!');
      setTokenQuantity('1');
      setTokenPrice('');
      fetchTrades();
      refreshUser();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to create token offer');
    } finally {
      setCreatingToken(false);
    }
  };

  const handleAcceptTokenOffer = async (offerId) => {
    try {
      await api.post(`/trade/token-offer/${offerId}/accept`);
      toast.success('Token trade completed!');
      fetchTrades();
      refreshUser();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Trade failed');
    }
  };

  const handleCancelTokenOffer = async (offerId) => {
    if (!window.confirm('Cancel this token offer? Tokens will be returned.')) return;
    try {
      await api.post(`/trade/token-offer/${offerId}/cancel`);
      toast.success('Token offer cancelled.');
      fetchTrades();
      refreshUser();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to cancel');
    }
  };

  const handleCancelPropertyListing = async (propertyId) => {
    if (!window.confirm('Cancel this property listing?')) return;
    try {
      await api.post(`/trade/property/${propertyId}/cancel`);
      toast.success('Property listing cancelled.');
      fetchTrades();
      refreshUser();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to cancel property listing');
    }
  };

  const handleCancelAllOffers = async (type, ids) => {
    if (!ids.length) return;
    if (!window.confirm(`Cancel all ${ids.length} offer(s)? Fees will be refunded.`)) return;
    try {
      for (const id of ids) {
        await api.delete(`/trade/${type}-offer/${id}`);
      }
      toast.success(`All ${ids.length} offer(s) cancelled and refunded!`);
      fetchTrades();
      refreshUser();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to cancel some offers');
    }
  };

  const formatCurrency = (num) => {
    if (!num) return '0';
    return Math.round(parseFloat(num)).toLocaleString('en-US');
  };
  
  const formatNumber = (num) => {
    if (!num) return '0';
    return parseFloat(num).toLocaleString('en-US');
  };
  
  const sellTotal = sellPoints && sellCost ? Math.round(parseFloat(sellPoints) * parseFloat(sellCost)) : 0;
  const buyTotal = buyPoints && buyOffer ? Math.round(parseFloat(buyPoints) * parseFloat(buyOffer)) : 0;
  
  const calculateFee = (points) => Math.max(1, Math.floor(parseFloat(points) * 0.005));
  
  const sellFee = sellPoints ? calculateFee(sellPoints) : 0;
  const buyFee = buyPoints ? calculateFee(buyPoints) : 0;
  const sellAfterFee = sellPoints ? parseFloat(sellPoints) - sellFee : 0;
  const buyAfterFee = buyPoints ? parseFloat(buyPoints) - buyFee : 0;

  const sellTokBal = tokenBalances[tokenType];
  const sellFoundingRaw = sellTokBal ? Number(sellTokBal.founding || 0) : 0;
  const sellFoundingLock =
    sellTokBal && sellTokBal.founding_locks_trade != null
      ? Number(sellTokBal.founding_locks_trade)
      : sellFoundingRaw;

  if (!hasLoaded) {
    return (
      <div className={`space-y-6 ${styles.pageContent} mobile-page-root`}>
        <style>{QT_STYLES}</style>
      </div>
    );
  }

  return (
    <div className={`space-y-6 ${styles.pageContent} mobile-page-root`} data-testid="quicktrade-page">
      <style>{QT_STYLES}</style>
      <div className="relative qt-fade-in">
        <p className="text-[10px] text-zinc-500 font-heading italic">Trade points, money, and properties</p>
      </div>

      {/* Create Offers Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Sell Points */}
        <section className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <div className="px-4 py-2.5 bg-primary/8 border-b border-primary/20">
            <div className="flex items-center gap-2">
              <TrendingDown className="w-5 h-5 text-primary" />
              <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">Sell Points</h2>
            </div>
          </div>
          <div className="p-4 space-y-2.5">
            <div>
              <label className="block text-[10px] text-mutedForeground font-heading uppercase tracking-wider mb-1">Points</label>
              <FormattedNumberInput
                value={sellPoints}
                onChange={setSellPoints}
                placeholder="e.g. 50,000"
                className="w-full bg-zinc-900/50 border border-zinc-700/50 rounded px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[10px] text-mutedForeground font-heading uppercase tracking-wider mb-1">Price per point ($)</label>
              <FormattedNumberInput
                value={sellCost}
                onChange={setSellCost}
                allowDecimals
                placeholder="e.g. 2,500"
                className="w-full bg-zinc-900/50 border border-zinc-700/50 rounded px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none"
              />
              {sellTotal > 0 && (
                <p className="text-[10px] text-mutedForeground mt-1">Total you&apos;ll receive: <span className="text-primary font-bold">${formatNumber(sellTotal)}</span></p>
              )}
            </div>
            <div className="relative group">
              <div className="flex items-center gap-2 px-3 py-2 bg-zinc-800/30 border border-zinc-700/30 rounded-md">
                <span className="text-[10px] text-mutedForeground font-heading">Fee:</span>
                <span className="text-[10px] text-foreground font-heading font-bold">{formatNumber(sellFee)} {sellFee === 1 ? 'pt' : 'pts'}</span>
                <HelpCircle size={12} className="text-primary/60 cursor-help ml-auto" />
              </div>
              <div className="absolute left-0 bottom-full mb-2 w-64 bg-zinc-900 border border-primary/30 rounded-md p-2.5 shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
                <p className="text-[10px] text-foreground font-heading mb-1.5">0.5% fee (1 pt min). Refunded if cancelled.</p>
                <div className="space-y-0.5 text-[10px] text-mutedForeground font-heading">
                  <p>Sell <span className="text-foreground">50</span> → offer <span className="text-primary font-bold">49</span></p>
                  <p>Sell <span className="text-foreground">5,000</span> → offer <span className="text-primary font-bold">4,975</span></p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="hideNameSell" checked={hideNameSell} onChange={(e) => setHideNameSell(e.target.checked)} className="rounded border-zinc-600" />
              <label htmlFor="hideNameSell" className="text-[10px] text-mutedForeground font-heading cursor-pointer">Hide name</label>
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="sellOfferCount" className="text-[10px] text-mutedForeground font-heading whitespace-nowrap">Number of offers</label>
              <input
                id="sellOfferCount"
                type="number"
                min={1}
                max={10}
                value={sellOfferCount}
                onChange={(e) => setSellOfferCount(Math.max(1, Math.min(10, parseInt(e.target.value, 10) || 1)))}
                className="w-16 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-sm text-foreground font-heading text-center"
              />
              <span className="text-[10px] text-mutedForeground font-heading">(x{sellOfferCount})</span>
            </div>
            <button
              onClick={handleCreateSellOffer}
              disabled={!sellPoints || !sellCost || creatingOffers}
              className="w-full px-4 py-2 rounded bg-primary/20 text-primary text-xs font-heading font-bold border border-primary/40 hover:bg-primary/30 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {creatingOffers ? `Adding ${sellOfferCount}…` : `Add ${sellOfferCount > 1 ? `x${sellOfferCount} ` : ''}$${sellTotal ? formatNumber(sellTotal) : '0'}`}
              {!creatingOffers && sellPoints && sellOfferCount === 1 && <span className="text-[10px] opacity-90 ml-1">({formatNumber(sellAfterFee)} after fee)</span>}
            </button>
          </div>
          <div className="qt-art-line text-primary mx-3" />
        </section>

        {/* Buy Points */}
        <section className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <div className="px-4 py-2.5 bg-primary/8 border-b border-primary/20">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-primary" />
              <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">Buy Points</h2>
            </div>
          </div>
          <div className="p-4 space-y-2.5">
            <div>
              <label className="block text-[10px] text-mutedForeground font-heading uppercase tracking-wider mb-1">Points</label>
              <FormattedNumberInput
                value={buyPoints}
                onChange={setBuyPoints}
                placeholder="e.g. 50,000"
                className="w-full bg-zinc-900/50 border border-zinc-700/50 rounded px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[10px] text-mutedForeground font-heading uppercase tracking-wider mb-1">Price per point ($)</label>
              <FormattedNumberInput
                value={buyOffer}
                onChange={setBuyOffer}
                allowDecimals
                placeholder="e.g. 2,500"
                className="w-full bg-zinc-900/50 border border-zinc-700/50 rounded px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none"
              />
              {buyTotal > 0 && (
                <p className="text-[10px] text-mutedForeground mt-1">Total you&apos;ll pay: <span className="text-primary font-bold">${formatNumber(buyTotal)}</span></p>
              )}
            </div>
            <div className="relative group">
              <div className="flex items-center gap-2 px-3 py-2 bg-zinc-800/30 border border-zinc-700/30 rounded-md">
                <span className="text-[10px] text-mutedForeground font-heading">Fee:</span>
                <span className="text-[10px] text-foreground font-heading font-bold">{formatNumber(buyFee)} {buyFee === 1 ? 'pt' : 'pts'}</span>
                <HelpCircle size={12} className="text-primary/60 cursor-help ml-auto" />
              </div>
              <div className="absolute left-0 bottom-full mb-2 w-64 bg-zinc-900 border border-primary/30 rounded-md p-2.5 shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
                <p className="text-[10px] text-foreground font-heading mb-1.5">0.5% fee (1 pt min). Refunded if cancelled.</p>
                <div className="space-y-0.5 text-[10px] text-mutedForeground font-heading">
                  <p>Buy <span className="text-foreground">50</span> → offer <span className="text-primary font-bold">49</span></p>
                  <p>Buy <span className="text-foreground">5,000</span> → offer <span className="text-primary font-bold">4,975</span></p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="hideNameBuy" checked={hideNameBuy} onChange={(e) => setHideNameBuy(e.target.checked)} className="rounded border-zinc-600" />
              <label htmlFor="hideNameBuy" className="text-[10px] text-mutedForeground font-heading cursor-pointer">Hide name</label>
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="buyOfferCount" className="text-[10px] text-mutedForeground font-heading whitespace-nowrap">Number of offers</label>
              <input
                id="buyOfferCount"
                type="number"
                min={1}
                max={10}
                value={buyOfferCount}
                onChange={(e) => setBuyOfferCount(Math.max(1, Math.min(10, parseInt(e.target.value, 10) || 1)))}
                className="w-16 bg-zinc-900/50 border border-zinc-700/50 rounded px-2 py-1 text-sm text-foreground font-heading text-center"
              />
              <span className="text-[10px] text-mutedForeground font-heading">(x{buyOfferCount})</span>
            </div>
            <button
              onClick={handleCreateBuyOffer}
              disabled={!buyPoints || !buyOffer || creatingOffers}
              className="w-full px-4 py-2 rounded bg-primary/20 text-primary text-xs font-heading font-bold border border-primary/40 hover:bg-primary/30 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {creatingOffers ? `Adding ${buyOfferCount}…` : `Add ${buyOfferCount > 1 ? `x${buyOfferCount} ` : ''}$${buyTotal ? formatNumber(buyTotal) : '0'}`}
              {!creatingOffers && buyPoints && buyOfferCount === 1 && <span className="text-[10px] opacity-90 ml-1">({formatNumber(buyAfterFee)} after fee)</span>}
            </button>
          </div>
          <div className="qt-art-line text-primary mx-3" />
        </section>
      </div>

      {/* Offers Lists */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Sell Points Offers */}
        <section className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <div className="px-4 py-2.5 bg-primary/8 border-b border-primary/20">
            <h3 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">Sell Offers</h3>
          </div>
          <div className="divide-y divide-zinc-700/30 max-h-96 overflow-y-auto">
            {sellOffers.length === 0 ? (
              <div className="p-6 text-center">
                <Coins size={28} className="mx-auto text-primary/30 mb-2" />
                <p className="text-xs text-mutedForeground font-heading">No sell offers</p>
              </div>
            ) : (
              (() => {
                const groupedOffers = sellOffers.reduce((acc, offer) => {
                  const key = offer.group_key;
                  if (!acc[key]) acc[key] = [];
                  acc[key].push(offer);
                  return acc;
                }, {});
                
                return Object.values(groupedOffers).map((userOffers, groupIdx) => {
                  const firstOffer = userOffers[0];
                  const isMyOffer = firstOffer.is_own;
                  const totalOffers = userOffers.length;
                  
                  const stackedOffers = userOffers.reduce((acc, offer) => {
                    const key = `${offer.points}-${offer.money}`;
                    if (!acc[key]) {
                      acc[key] = { ...offer, ids: [], count: 0 };
                    }
                    acc[key].ids.push(offer.id);
                    acc[key].count++;
                    return acc;
                  }, {});
                  
                  const mySellIds = isMyOffer ? userOffers.map((o) => o.id) : [];
                  return (
                    <div key={groupIdx} className={`px-4 py-2 hover:bg-zinc-800/30 transition-colors ${isMyOffer ? 'bg-primary/5' : ''}`}>
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <div className="flex items-center gap-1.5">
                          <Users size={12} className="text-primary" />
                          <span className="text-xs font-heading font-bold text-foreground">
                            {renderQtTraderLabel(firstOffer, isMyOffer)}
                          </span>
                          {totalOffers > 1 && (
                            <span className="text-[9px] bg-primary/20 text-primary px-1 py-0.5 rounded font-heading font-bold">{totalOffers}</span>
                          )}
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        {Object.values(stackedOffers).map((offer, offerIdx) => (
                          <div key={offerIdx} className="flex items-start justify-between gap-3 pl-3 border-l-2 border-primary/20">
                            <div className="flex-1 min-w-0 text-[10px] text-mutedForeground space-y-0.5">
                              <div>Pts: <span className="text-primary font-bold">{formatNumber(offer.points)}</span></div>
                              <div>$: <span className="text-foreground font-bold">{formatNumber(offer.money)}</span></div>
                              <div>Per: <span className="text-mutedForeground">${formatCurrency((offer.money || 0) / (offer.points || 1))}</span> {offer.count > 1 && <span className="text-primary font-bold">x{offer.count}</span>}</div>
                            </div>
                            <div className="flex flex-col gap-1 shrink-0 items-stretch">
                              {isMyOffer ? (
                                <button
                                  type="button"
                                  onClick={() => offer.ids.length === 1 ? handleCancelOffer(offer.ids[0], 'sell') : handleCancelAllOffers('sell', offer.ids)}
                                  className={`px-2.5 py-1 bg-red-900/20 border border-red-700/30 text-red-400 text-[10px] font-heading font-bold rounded hover:bg-red-900/30 whitespace-nowrap min-h-[36px] sm:min-h-0 ${qtActionBtn}`}
                                >
                                  Cancel{offer.ids.length > 1 ? ` (${offer.ids.length})` : ''}
                                </button>
                              ) : (
                                <>
                                  <button type="button" onClick={() => handleAcceptOffer(offer.ids[0], 'sell')} className={`px-2.5 py-1 rounded bg-primary/20 text-primary text-[10px] font-heading font-bold border border-primary/40 hover:bg-primary/30 whitespace-nowrap min-h-[36px] sm:min-h-0 ${qtActionBtn}`}>
                                    Accept
                                  </button>
                                  {offer.ids.length > 1 && (
                                    <button type="button" onClick={() => handleAcceptBatch(offer.ids, 'sell')} className={`px-2.5 py-1 rounded bg-primary/20 text-primary text-[10px] font-heading font-bold border border-primary/40 hover:bg-primary/30 whitespace-nowrap min-h-[36px] sm:min-h-0 ${qtActionBtn}`}>
                                      Accept all ({offer.ids.length})
                                    </button>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                      {isMyOffer && mySellIds.length > 1 && (
                        <div className="mt-2 pt-2 border-t border-zinc-700/30">
                          <button type="button" onClick={() => handleCancelAllOffers('sell', mySellIds)} className={`text-[10px] font-heading text-red-400/90 hover:text-red-400 border border-red-700/30 hover:border-red-700/50 px-2 py-2 sm:py-1 rounded min-h-[40px] sm:min-h-0 ${qtActionBtn}`}>
                            Cancel all
                          </button>
                        </div>
                      )}
                    </div>
                  );
                });
              })()
            )}
          </div>
          <div className="qt-art-line text-primary mx-3" />
        </section>

        {/* Buy Points Offers */}
        <section className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <div className="px-4 py-2.5 bg-primary/8 border-b border-primary/20">
            <h3 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">Buy Offers</h3>
          </div>
          <div className="divide-y divide-zinc-700/30 max-h-96 overflow-y-auto">
            {buyOffers.length === 0 ? (
              <div className="p-6 text-center">
                <Coins size={28} className="mx-auto text-primary/30 mb-2" />
                <p className="text-xs text-mutedForeground font-heading">No buy offers</p>
              </div>
            ) : (
              (() => {
                const groupedOffers = buyOffers.reduce((acc, offer) => {
                  const key = offer.group_key;
                  if (!acc[key]) acc[key] = [];
                  acc[key].push(offer);
                  return acc;
                }, {});
                
                return Object.values(groupedOffers).map((userOffers, groupIdx) => {
                  const firstOffer = userOffers[0];
                  const isMyOffer = firstOffer.is_own;
                  const totalOffers = userOffers.length;
                  
                  const stackedOffers = userOffers.reduce((acc, offer) => {
                    const key = `${offer.points}-${offer.cost}`;
                    if (!acc[key]) {
                      acc[key] = { ...offer, ids: [], count: 0 };
                    }
                    acc[key].ids.push(offer.id);
                    acc[key].count++;
                    return acc;
                  }, {});
                  
                  const myBuyIds = isMyOffer ? userOffers.map((o) => o.id) : [];
                  return (
                    <div key={groupIdx} className={`px-4 py-2 hover:bg-zinc-800/30 transition-colors ${isMyOffer ? 'bg-primary/5' : ''}`}>
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <div className="flex items-center gap-1.5">
                          <Users size={12} className="text-primary" />
                          <span className="text-xs font-heading font-bold text-foreground">
                            {renderQtTraderLabel(firstOffer, isMyOffer)}
                          </span>
                          {totalOffers > 1 && (
                            <span className="text-[9px] bg-primary/20 text-primary px-1 py-0.5 rounded font-heading font-bold">{totalOffers}</span>
                          )}
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        {Object.values(stackedOffers).map((offer, offerIdx) => (
                          <div key={offerIdx} className="flex items-start justify-between gap-3 pl-3 border-l-2 border-primary/20">
                            <div className="flex-1 min-w-0 text-[10px] text-mutedForeground space-y-0.5">
                              <div>Pts: <span className="text-primary font-bold">{formatNumber(offer.points)}</span></div>
                              <div>Cost: <span className="text-foreground font-bold">${formatNumber(offer.cost)}</span></div>
                              <div>Per: <span className="text-mutedForeground">${formatCurrency((offer.cost || 0) / (offer.points || 1))}</span> {offer.count > 1 && <span className="text-primary font-bold">x{offer.count}</span>}</div>
                            </div>
                            <div className="flex flex-col gap-1 shrink-0 items-stretch">
                              {isMyOffer ? (
                                <button
                                  type="button"
                                  onClick={() => offer.ids.length === 1 ? handleCancelOffer(offer.ids[0], 'buy') : handleCancelAllOffers('buy', offer.ids)}
                                  className={`px-2.5 py-1 bg-red-900/20 border border-red-700/30 text-red-400 text-[10px] font-heading font-bold rounded hover:bg-red-900/30 whitespace-nowrap min-h-[36px] sm:min-h-0 ${qtActionBtn}`}
                                >
                                  Cancel{offer.ids.length > 1 ? ` (${offer.ids.length})` : ''}
                                </button>
                              ) : (
                                <>
                                  <button type="button" onClick={() => handleAcceptOffer(offer.ids[0], 'buy')} className={`px-2.5 py-1 rounded bg-primary/20 text-primary text-[10px] font-heading font-bold border border-primary/40 hover:bg-primary/30 whitespace-nowrap min-h-[36px] sm:min-h-0 ${qtActionBtn}`}>
                                    Accept
                                  </button>
                                  {offer.ids.length > 1 && (
                                    <button type="button" onClick={() => handleAcceptBatch(offer.ids, 'buy')} className={`px-2.5 py-1 rounded bg-primary/20 text-primary text-[10px] font-heading font-bold border border-primary/40 hover:bg-primary/30 whitespace-nowrap min-h-[36px] sm:min-h-0 ${qtActionBtn}`}>
                                      Accept all ({offer.ids.length})
                                    </button>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                      {isMyOffer && myBuyIds.length > 1 && (
                        <div className="mt-2 pt-2 border-t border-zinc-700/30">
                          <button type="button" onClick={() => handleCancelAllOffers('buy', myBuyIds)} className={`text-[10px] font-heading text-red-400/90 hover:text-red-400 border border-red-700/30 hover:border-red-700/50 px-2 py-2 sm:py-1 rounded min-h-[40px] sm:min-h-0 ${qtActionBtn}`}>
                            Cancel all
                          </button>
                        </div>
                      )}
                    </div>
                  );
                });
              })()
            )}
          </div>
          <div className="qt-art-line text-primary mx-3" />
        </section>
      </div>

      {/* Token offers: sell for points or cash */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <div className="px-4 py-2.5 bg-primary/8 border-b border-primary/20">
            <div className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-primary" />
              <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">Sell tokens (points or cash)</h2>
            </div>
          </div>
          <div className="p-4 space-y-2.5">
            <div>
              <label className="block text-[10px] text-mutedForeground font-heading uppercase tracking-wider mb-1">Token type</label>
              <select
                value={tokenType}
                onChange={(e) => setTokenType(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-700/50 rounded px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none cursor-pointer capitalize"
              >
                {TOKEN_TYPES.map((t) => {
                  const b = tokenBalances?.[t];
                  const held = b?.total;
                  const tradable = b?.sellable;
                  const label =
                    held != null && tradable != null
                      ? `${formatTokenName(t)} (${held} held · ${tradable} tradable)`
                      : formatTokenName(t);
                  return (
                    <option key={t} value={t} className="bg-zinc-900 text-foreground py-2">
                      {label}
                    </option>
                  );
                })}
              </select>
            </div>
            {sellTokBal != null && (
              <div className="flex flex-col gap-1 rounded-md px-3 py-2 bg-zinc-800/40 border border-zinc-700/30 text-[10px] font-heading">
                <span className="text-mutedForeground">Your balance: <span className="text-foreground font-bold">{sellTokBal.total}</span> total</span>
                <span className="text-mutedForeground">Referral: <span className="text-foreground font-bold">{sellTokBal.referral}</span> (cannot be sold)</span>
                {Number(sellTokBal.entertainer || 0) > 0 && (
                  <span className="text-mutedForeground">Entertainer: <span className="text-foreground font-bold">{sellTokBal.entertainer}</span> (cannot be sold)</span>
                )}
                {sellFoundingRaw > 0 && (
                  <span className="text-mutedForeground">
                    Founding Member drops: <span className="text-foreground font-bold">{sellFoundingRaw}</span>
                    {sellFoundingLock > 0
                      ? ' (cannot be sold on Quick Trade)'
                      : ' (this type can still be sold — same pool as Game Pass / store)'}
                  </span>
                )}
                <span className="text-primary font-bold">Tradable on Quick Trade: {sellTokBal.sellable}</span>
              </div>
            )}
            <div>
              <label className="block text-[10px] text-mutedForeground font-heading uppercase tracking-wider mb-1">Quantity{tokenBalances[tokenType]?.sellable != null ? ` (max ${tokenBalances[tokenType].sellable})` : ''}</label>
              <FormattedNumberInput
                value={tokenQuantity}
                onChange={setTokenQuantity}
                placeholder="1"
                className="w-full bg-zinc-900/50 border border-zinc-700/50 rounded px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none"
              />
            </div>
            <div>
              <span className="block text-[10px] text-mutedForeground font-heading uppercase tracking-wider mb-1.5">Price in</span>
              <div className="flex flex-wrap gap-3 mb-2">
                <label className="flex items-center gap-2 cursor-pointer text-xs font-heading text-foreground">
                  <input
                    type="radio"
                    name="tokenPriceCurrency"
                    checked={tokenPriceCurrency === 'points'}
                    onChange={() => setTokenPriceCurrency('points')}
                    className="rounded border-zinc-600"
                  />
                  Points
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-xs font-heading text-foreground">
                  <input
                    type="radio"
                    name="tokenPriceCurrency"
                    checked={tokenPriceCurrency === 'money'}
                    onChange={() => setTokenPriceCurrency('money')}
                    className="rounded border-zinc-600"
                  />
                  Cash ($)
                </label>
              </div>
              <label className="block text-[10px] text-mutedForeground font-heading uppercase tracking-wider mb-1">
                {tokenPriceCurrency === 'points' ? 'Price (points)' : 'Price (total $ for this listing)'}
              </label>
              {tokenPriceCurrency === 'points' ? (
                <FormattedNumberInput
                  value={tokenPrice}
                  onChange={setTokenPrice}
                  placeholder="e.g. 100"
                  className="w-full bg-zinc-900/50 border border-zinc-700/50 rounded px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none"
                />
              ) : (
                <FormattedNumberInput
                  value={tokenPrice}
                  onChange={setTokenPrice}
                  allowDecimals
                  placeholder={`min ${formatNumber(TOKEN_MIN_CASH_PER_TOKEN)} per token`}
                  className="w-full bg-zinc-900/50 border border-zinc-700/50 rounded px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none"
                />
              )}
              {tokenPriceCurrency === 'money' && (
                <p className="text-[9px] text-mutedForeground font-heading mt-1">
                  Minimum <span className="text-primary font-bold">${formatNumber(TOKEN_MIN_CASH_PER_TOKEN)}</span> per token
                  (e.g. {tokenQuantity || '1'} token(s) → min ${formatNumber(TOKEN_MIN_CASH_PER_TOKEN * Math.max(1, parseInt(String(tokenQuantity).replace(/,/g, ''), 10) || 1))}).
                </p>
              )}
            </div>
            <button
              onClick={handleCreateTokenOffer}
              disabled={!tokenPrice || creatingToken}
              className="w-full px-4 py-2 rounded bg-primary/20 text-primary text-xs font-heading font-bold border border-primary/40 hover:bg-primary/30 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {creatingToken
                ? 'Creating…'
                : tokenPriceCurrency === 'points'
                  ? `List ${tokenQuantity || '0'} ${formatTokenName(tokenType)} for ${tokenPrice ? formatNumber(tokenPrice) : '0'} pts`
                  : `List ${tokenQuantity || '0'} ${formatTokenName(tokenType)} for $${tokenPrice ? formatNumber(tokenPrice) : '0'}`}
            </button>
          </div>
          <div className="qt-art-line text-primary mx-3" />
        </section>
        <section className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <div className="px-4 py-2.5 bg-primary/8 border-b border-primary/20">
            <h3 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">Token offers</h3>
          </div>
          <div className="divide-y divide-zinc-700/30 max-h-96 overflow-y-auto">
            {tokenOffers.length === 0 ? (
              <div className="p-6 text-center">
                <Zap size={28} className="mx-auto text-primary/30 mb-2" />
                <p className="text-xs text-mutedForeground font-heading">No token offers</p>
              </div>
            ) : (
              tokenOffers.map((offer) => (
                <div key={offer.id} className={`px-4 py-2.5 flex items-center justify-between gap-3 hover:bg-zinc-800/30 ${offer.is_own ? 'bg-primary/5' : ''}`}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-heading font-bold text-foreground">
                        {renderQtTraderLabel(offer, offer.is_own)}
                      </span>
                    </div>
                    <div className="text-[10px] text-mutedForeground mt-0.5">
                      <span className="text-primary font-bold">{offer.quantity}</span> {formatTokenName(offer.token_type || '')} ·{' '}
                      {(offer.price_currency || 'points') === 'money' ? (
                        <>
                          <span className="text-foreground font-bold">${formatNumber(offer.price_money || 0)}</span> cash
                        </>
                      ) : (
                        <>
                          <span className="text-foreground font-bold">{formatNumber(offer.price_points)}</span> pts
                        </>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0">
                    {offer.is_own ? (
                      <button
                        type="button"
                        onClick={() => handleCancelTokenOffer(offer.id)}
                        className={`px-2.5 py-1 bg-red-900/20 border border-red-700/30 text-red-400 text-[10px] font-heading font-bold rounded hover:bg-red-900/30 min-h-[36px] sm:min-h-0 ${qtActionBtn}`}
                      >
                        Cancel
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleAcceptTokenOffer(offer.id)}
                        className={`px-2.5 py-1 rounded bg-primary/20 text-primary text-[10px] font-heading font-bold border border-primary/40 hover:bg-primary/30 min-h-[36px] sm:min-h-0 ${qtActionBtn}`}
                      >
                        Accept
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="qt-art-line text-primary mx-3" />
        </section>
      </div>

      {/* Properties for Sale */}
      <section className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mobile-panel`}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-4 py-2.5 bg-primary/8 border-b border-primary/20">
          <div className="flex items-center gap-2">
            <Building2 className="w-5 h-5 text-primary" />
            <h3 className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">Properties for Sale</h3>
          </div>
        </div>
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-zinc-800/30 border-b border-zinc-700/30">
                <th className="px-4 py-2 text-left font-heading text-[10px] text-mutedForeground uppercase tracking-wider">Location</th>
                <th className="px-4 py-2 text-left font-heading text-[10px] text-mutedForeground uppercase tracking-wider">Property</th>
                <th className="px-4 py-2 text-left font-heading text-[10px] text-mutedForeground uppercase tracking-wider">Owner</th>
                <th className="px-4 py-2 text-right font-heading text-[10px] text-mutedForeground uppercase tracking-wider">Points</th>
                <th className="px-4 py-2 text-center font-heading text-[10px] text-mutedForeground uppercase tracking-wider">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-700/30">
              {properties.length === 0 ? (
                <tr>
                  <td colSpan="5" className="px-4 py-6 text-center">
                    <Building2 size={28} className="mx-auto text-primary/30 mb-2" />
                    <p className="text-xs text-mutedForeground font-heading">No properties for sale</p>
                  </td>
                </tr>
              ) : (
                properties.map((prop, idx) => (
                  <tr key={idx} className="hover:bg-zinc-800/30 transition-colors">
                    <td className="px-4 py-2 font-heading text-xs text-foreground">{prop.location}</td>
                    <td className="px-4 py-2 font-heading text-xs text-foreground">{prop.property_name}</td>
                    <td className="px-4 py-2 font-heading text-xs text-foreground">{prop.owner}</td>
                    <td className="px-4 py-2 text-right font-heading text-xs text-primary font-bold">{formatNumber(prop.points)}</td>
                    <td className="px-4 py-2 text-center">
                      {prop.is_own ? (
                        <button type="button" onClick={() => handleCancelPropertyListing(prop.id)} className={`px-2.5 py-1 bg-red-900/20 border border-red-700/30 text-red-400 text-[10px] font-heading font-bold rounded hover:bg-red-900/30 min-h-[36px] sm:min-h-0 ${qtActionBtn}`}>
                          Cancel
                        </button>
                      ) : (
                        <button type="button" onClick={() => handleAcceptOffer(prop.id, 'property')} className={`px-2.5 py-1 rounded bg-primary/20 text-primary text-[10px] font-heading font-bold border border-primary/40 hover:bg-primary/30 min-h-[36px] sm:min-h-0 ${qtActionBtn}`}>
                          Buy
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="md:hidden divide-y divide-zinc-700/30">
          {properties.length === 0 ? (
            <div className="p-6 text-center">
              <Building2 size={28} className="mx-auto text-primary/30 mb-2" />
              <p className="text-[10px] text-mutedForeground font-heading">No properties for sale</p>
            </div>
          ) : (
            properties.map((prop, idx) => (
              <div key={idx} className="p-4 hover:bg-zinc-800/30 transition-colors">
                <div className="space-y-1.5">
                  <div className="flex justify-between items-start gap-2">
                    <span className="text-xs font-heading font-bold text-foreground">{prop.property_name}</span>
                    <span className="text-xs font-heading text-primary font-bold">{formatNumber(prop.points)} pts</span>
                  </div>
                  <div className="text-[10px] text-mutedForeground space-y-0.5">
                    <div>Location: <span className="text-foreground">{prop.location}</span></div>
                    <div>Owner: <span className="text-foreground">{prop.owner}</span></div>
                  </div>
                  {prop.is_own ? (
                    <button type="button" onClick={() => handleCancelPropertyListing(prop.id)} className={`w-full mt-2 px-3 py-2.5 sm:py-1.5 bg-red-900/20 border border-red-700/30 text-red-400 text-[10px] font-heading font-bold rounded hover:bg-red-900/30 min-h-[44px] sm:min-h-0 ${qtActionBtn}`}>
                      Cancel Listing
                    </button>
                  ) : (
                    <button type="button" onClick={() => handleAcceptOffer(prop.id, 'property')} className={`w-full mt-2 px-3 py-2.5 sm:py-1.5 rounded bg-primary/20 text-primary text-[10px] font-heading font-bold border border-primary/40 hover:bg-primary/30 min-h-[44px] sm:min-h-0 ${qtActionBtn}`}>
                      Buy Property
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
        <div className="qt-art-line text-primary mx-3" />
      </section>
    </div>
  );
}
