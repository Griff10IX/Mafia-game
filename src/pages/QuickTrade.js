import { useState, useEffect } from 'react';
import { Coins, ArrowLeftRight, Users, Building2, TrendingUp, TrendingDown, HelpCircle } from 'lucide-react';
import api, { refreshUser } from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

export default function QuickTrade() {
  const [loading, setLoading] = useState(true);
  const [sellOffers, setSellOffers] = useState([]);
  const [buyOffers, setBuyOffers] = useState([]);
  const [properties, setProperties] = useState([]);
  const [currentUserId, setCurrentUserId] = useState(null);
  
  // Create offer form
  const [sellPoints, setSellPoints] = useState('');
  const [sellCost, setSellCost] = useState('');
  const [buyPoints, setBuyPoints] = useState('');
  const [buyOffer, setBuyOffer] = useState('');
  const [hideNameSell, setHideNameSell] = useState(false);
  const [hideNameBuy, setHideNameBuy] = useState(false);

  useEffect(() => {
    fetchCurrentUser();
    fetchTrades();
  }, []);

  const fetchCurrentUser = async () => {
    try {
      const res = await api.get('/auth/me');
      setCurrentUserId(res.data.id);
    } catch (e) {
      console.error('Failed to fetch user');
    }
  };

  const fetchTrades = async () => {
    setLoading(true);
    try {
      const [sellRes, buyRes, propRes] = await Promise.all([
        api.get('/trade/sell-offers').catch(() => ({ data: [] })),
        api.get('/trade/buy-offers').catch(() => ({ data: [] })),
        api.get('/trade/properties').catch(() => ({ data: [] }))
      ]);
      
      setSellOffers(sellRes.data || []);
      setBuyOffers(buyRes.data || []);
      setProperties(propRes.data || []);
    } catch (e) {
      toast.error('Failed to load trades');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateSellOffer = async () => {
    if (!sellPoints || !sellCost) {
      toast.error('Enter points and cost');
      return;
    }
    try {
      await api.post('/trade/sell-offer', {
        points: parseInt(sellPoints),
        cost: parseInt(sellCost),
        hide_name: hideNameSell
      });
      toast.success('Sell offer created!');
      setSellPoints('');
      setSellCost('');
      fetchTrades();
      refreshUser();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to create offer');
    }
  };

  const handleCreateBuyOffer = async () => {
    if (!buyPoints || !buyOffer) {
      toast.error('Enter points and offer amount');
      return;
    }
    try {
      await api.post('/trade/buy-offer', {
        points: parseInt(buyPoints),
        offer: parseInt(buyOffer),
        hide_name: hideNameBuy
      });
      toast.success('Buy offer created!');
      setBuyPoints('');
      setBuyOffer('');
      fetchTrades();
      refreshUser();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to create offer');
    }
  };

  const handleAcceptOffer = async (offerId, type) => {
    try {
      await api.post(`/trade/${type}-offer/${offerId}/accept`);
      toast.success('Trade completed!');
      fetchTrades();
      refreshUser();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Trade failed');
    }
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

  const formatCurrency = (num) => {
    if (!num) return '0';
    const parsed = parseFloat(num);
    if (parsed % 1 === 0) return parsed.toLocaleString('en-US');
    return parsed.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  
  const formatNumber = (num) => {
    if (!num) return '0';
    return parseFloat(num).toLocaleString('en-US');
  };
  
  const sellPerPoint = sellPoints && sellCost ? (parseFloat(sellCost) / parseFloat(sellPoints)) : 0;
  const buyPerPoint = buyPoints && buyOffer ? (parseFloat(buyOffer) / parseFloat(buyPoints)) : 0;
  
  const calculateFee = (points) => Math.max(1, Math.floor(parseFloat(points) * 0.005));
  
  const sellFee = sellPoints ? calculateFee(sellPoints) : 0;
  const buyFee = buyPoints ? calculateFee(buyPoints) : 0;
  const sellAfterFee = sellPoints ? parseFloat(sellPoints) - sellFee : 0;
  const buyAfterFee = buyPoints ? parseFloat(buyPoints) - buyFee : 0;

  if (loading) {
    return (
      <div className={`${styles.pageContent} ${styles.page}`}>
        <div className="flex items-center justify-center min-h-[60vh]">
          <span className="text-primary font-heading text-xl font-bold">Loading...</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`${styles.pageContent} ${styles.page}`}>
      {/* Header */}
      <div className="mb-4 md:mb-6">
        <h1 className="text-2xl sm:text-3xl md:text-4xl font-heading font-bold text-primary mb-1 flex items-center gap-2">
          <ArrowLeftRight className="w-6 h-6 sm:w-7 sm:h-7" />
          Quick Trade
        </h1>
        <p className="text-[11px] md:text-xs text-mutedForeground">Trade points, money, and properties</p>
      </div>

      {/* Create Offers Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 md:gap-4 mb-4 md:mb-6">
        {/* Sell Points */}
        <div className="bg-card rounded-md border border-primary/20 p-3 md:p-4">
          <div className="flex items-center gap-2 mb-3">
            <TrendingDown size={16} className="text-primary" />
            <h2 className="text-[11px] md:text-sm font-heading font-bold text-primary uppercase tracking-wider">Sell Points</h2>
          </div>
          
          <div className="space-y-2.5">
            <div>
              <label className="block text-[9px] md:text-[10px] text-mutedForeground font-heading uppercase tracking-wider mb-1">
                Points
              </label>
              <input
                type="number"
                value={sellPoints}
                onChange={(e) => setSellPoints(e.target.value)}
                placeholder="Enter points"
                className="w-full bg-input border border-border rounded px-2.5 py-1.5 md:px-3 md:py-2 text-[11px] md:text-sm text-foreground focus:border-primary/50 focus:outline-none"
              />
            </div>
            
            <div>
              <label className="block text-[9px] md:text-[10px] text-mutedForeground font-heading uppercase tracking-wider mb-1">
                Cost ($)
              </label>
              <input
                type="number"
                value={sellCost}
                onChange={(e) => setSellCost(e.target.value)}
                placeholder="Price"
                className="w-full bg-input border border-border rounded px-2.5 py-1.5 md:px-3 md:py-2 text-[11px] md:text-sm text-foreground focus:border-primary/50 focus:outline-none"
              />
              {sellPoints && sellCost && (
                <p className="text-[10px] md:text-xs text-mutedForeground mt-1">
                  Per Point: <span className="text-primary font-bold">${formatCurrency(sellPerPoint)}</span>
                </p>
              )}
            </div>

            {/* Fee Info */}
            <div className="relative group">
              <div className="flex items-center gap-2 px-2.5 py-1.5 bg-secondary/20 border border-border rounded-sm">
                <span className="text-[10px] md:text-xs text-mutedForeground font-heading">Fee:</span>
                <span className="text-[10px] md:text-xs text-foreground font-heading font-bold">
                  {formatNumber(sellFee)} {sellFee === 1 ? 'pt' : 'pts'}
                </span>
                <HelpCircle size={12} className="md:w-[14px] md:h-[14px] text-primary/60 cursor-help ml-auto" />
              </div>
              
              <div className="absolute left-0 bottom-full mb-2 w-64 md:w-72 bg-background border border-primary/30 rounded-md p-2.5 shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
                <p className="text-[10px] md:text-xs text-foreground font-heading mb-1.5">
                  0.5% fee (1 pt min). Refunded if cancelled.
                </p>
                <div className="space-y-0.5 text-[9px] md:text-[10px] text-mutedForeground font-heading">
                  <p>Sell <span className="text-foreground">50</span> → offer <span className="text-primary font-bold">49</span></p>
                  <p>Sell <span className="text-foreground">5,000</span> → offer <span className="text-primary font-bold">4,975</span></p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="hideNameSell"
                checked={hideNameSell}
                onChange={(e) => setHideNameSell(e.target.checked)}
                className="w-3.5 h-3.5 rounded"
              />
              <label htmlFor="hideNameSell" className="text-[10px] md:text-xs text-mutedForeground font-heading cursor-pointer">
                Hide name
              </label>
            </div>

            <button
              onClick={handleCreateSellOffer}
              disabled={!sellPoints || !sellCost}
              className="w-full bg-gradient-to-r from-primary via-yellow-600 to-primary hover:from-yellow-500 hover:via-yellow-600 hover:to-yellow-500 text-black rounded-lg font-heading font-bold uppercase tracking-wide px-4 py-2 text-[11px] md:text-sm border-2 border-yellow-600/50 shadow-lg shadow-primary/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-95"
            >
              Add ${sellCost ? formatNumber(sellCost) : '0'}
              {sellPoints && <span className="text-[10px] ml-1">({formatNumber(sellAfterFee)} after fee)</span>}
            </button>
          </div>
        </div>

        {/* Buy Points */}
        <div className="bg-card rounded-md border border-primary/20 p-3 md:p-4">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp size={16} className="text-primary" />
            <h2 className="text-[11px] md:text-sm font-heading font-bold text-primary uppercase tracking-wider">Buy Points</h2>
          </div>
          
          <div className="space-y-2.5">
            <div>
              <label className="block text-[9px] md:text-[10px] text-mutedForeground font-heading uppercase tracking-wider mb-1">
                Points
              </label>
              <input
                type="number"
                value={buyPoints}
                onChange={(e) => setBuyPoints(e.target.value)}
                placeholder="Points wanted"
                className="w-full bg-input border border-border rounded px-2.5 py-1.5 md:px-3 md:py-2 text-[11px] md:text-sm text-foreground focus:border-primary/50 focus:outline-none"
              />
            </div>
            
            <div>
              <label className="block text-[9px] md:text-[10px] text-mutedForeground font-heading uppercase tracking-wider mb-1">
                Offer ($)
              </label>
              <input
                type="number"
                value={buyOffer}
                onChange={(e) => setBuyOffer(e.target.value)}
                placeholder="Your offer"
                className="w-full bg-input border border-border rounded px-2.5 py-1.5 md:px-3 md:py-2 text-[11px] md:text-sm text-foreground focus:border-primary/50 focus:outline-none"
              />
              {buyPoints && buyOffer && (
                <p className="text-[10px] md:text-xs text-mutedForeground mt-1">
                  Per Point: <span className="text-primary font-bold">${formatCurrency(buyPerPoint)}</span>
                </p>
              )}
            </div>

            <div className="relative group">
              <div className="flex items-center gap-2 px-2.5 py-1.5 bg-secondary/20 border border-border rounded-sm">
                <span className="text-[10px] md:text-xs text-mutedForeground font-heading">Fee:</span>
                <span className="text-[10px] md:text-xs text-foreground font-heading font-bold">
                  {formatNumber(buyFee)} {buyFee === 1 ? 'pt' : 'pts'}
                </span>
                <HelpCircle size={12} className="md:w-[14px] md:h-[14px] text-primary/60 cursor-help ml-auto" />
              </div>
              
              <div className="absolute left-0 bottom-full mb-2 w-64 md:w-72 bg-background border border-primary/30 rounded-md p-2.5 shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
                <p className="text-[10px] md:text-xs text-foreground font-heading mb-1.5">
                  0.5% fee (1 pt min). Refunded if cancelled.
                </p>
                <div className="space-y-0.5 text-[9px] md:text-[10px] text-mutedForeground font-heading">
                  <p>Buy <span className="text-foreground">50</span> → offer <span className="text-primary font-bold">49</span></p>
                  <p>Buy <span className="text-foreground">5,000</span> → offer <span className="text-primary font-bold">4,975</span></p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="hideNameBuy"
                checked={hideNameBuy}
                onChange={(e) => setHideNameBuy(e.target.checked)}
                className="w-3.5 h-3.5 rounded"
              />
              <label htmlFor="hideNameBuy" className="text-[10px] md:text-xs text-mutedForeground font-heading cursor-pointer">
                Hide name
              </label>
            </div>

            <button
              onClick={handleCreateBuyOffer}
              disabled={!buyPoints || !buyOffer}
              className="w-full bg-gradient-to-r from-primary via-yellow-600 to-primary hover:from-yellow-500 hover:via-yellow-600 hover:to-yellow-500 text-black rounded-lg font-heading font-bold uppercase tracking-wide px-4 py-2 text-[11px] md:text-sm border-2 border-yellow-600/50 shadow-lg shadow-primary/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-95"
            >
              Add ${buyOffer ? formatNumber(buyOffer) : '0'}
              {buyPoints && <span className="text-[10px] ml-1">({formatNumber(buyAfterFee)} after fee)</span>}
            </button>
          </div>
        </div>
      </div>

      {/* Offers Lists */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 md:gap-4 mb-4 md:mb-6">
        {/* Sell Points Offers */}
        <div className="bg-card rounded-md border border-primary/20 overflow-hidden">
          <div className="px-3 py-2 bg-primary/10 border-b border-primary/30">
            <h3 className="text-[11px] md:text-sm font-heading font-bold text-primary uppercase tracking-wider">Sell Offers</h3>
          </div>
          
          <div className="divide-y divide-border max-h-96 overflow-y-auto">
            {sellOffers.length === 0 ? (
              <div className="p-6 text-center">
                <Coins size={28} className="mx-auto text-primary/30 mb-2" />
                <p className="text-[10px] md:text-xs text-mutedForeground font-heading">No sell offers</p>
              </div>
            ) : (
              (() => {
                const groupedOffers = sellOffers.reduce((acc, offer) => {
                  const key = offer.user_id;
                  if (!acc[key]) acc[key] = [];
                  acc[key].push(offer);
                  return acc;
                }, {});
                
                return Object.values(groupedOffers).map((userOffers, groupIdx) => {
                  const firstOffer = userOffers[0];
                  const isMyOffer = firstOffer.user_id === currentUserId;
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
                  
                  return (
                    <div key={groupIdx} className={`px-3 py-2 hover:bg-secondary/30 transition-colors ${isMyOffer ? 'bg-primary/5' : ''}`}>
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <div className="flex items-center gap-1.5">
                          <Users size={12} className="text-primary" />
                          <span className="text-[10px] md:text-xs font-heading font-bold text-foreground">
                            {isMyOffer ? 'You' : (firstOffer.hide_name ? '[Anon]' : firstOffer.username)}
                          </span>
                          {totalOffers > 1 && (
                            <span className="text-[9px] bg-primary/20 text-primary px-1 py-0.5 rounded font-heading font-bold">
                              {totalOffers}
                            </span>
                          )}
                        </div>
                      </div>
                      
                      <div className="space-y-1.5">
                        {Object.values(stackedOffers).map((offer, offerIdx) => (
                          <div key={offerIdx} className="flex items-center justify-between gap-2 pl-3 border-l-2 border-primary/20">
                            <div className="flex-1 text-[10px] text-mutedForeground space-y-0.5">
                              <div>Pts: <span className="text-primary font-bold">{formatNumber(offer.points)}</span></div>
                              <div>$: <span className="text-foreground font-bold">{formatNumber(offer.money)}</span></div>
                              <div>Per: <span className="text-mutedForeground">${formatCurrency((offer.money || 0) / (offer.points || 1))}</span> {offer.count > 1 && <span className="text-primary font-bold">x{offer.count}</span>}</div>
                            </div>
                            <div className="flex flex-col gap-1">
                              {offer.ids.map((id, idIdx) => (
                                isMyOffer ? (
                                  <button
                                    key={idIdx}
                                    onClick={() => handleCancelOffer(id, 'sell')}
                                    className="px-2.5 py-1 bg-red-900/20 border border-red-700/30 text-red-400 text-[9px] md:text-[10px] font-heading font-bold rounded-sm hover:bg-red-900/30 transition-all active:scale-95"
                                  >
                                    Cancel
                                  </button>
                                ) : (
                                  <button
                                    key={idIdx}
                                    onClick={() => handleAcceptOffer(id, 'sell')}
                                    className="px-2.5 py-1 bg-primary/10 border border-primary/30 text-primary text-[9px] md:text-[10px] font-heading font-bold rounded-sm hover:bg-primary/20 transition-all active:scale-95"
                                  >
                                    Accept
                                  </button>
                                )
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                });
              })()
            )}
          </div>
        </div>

        {/* Buy Points Offers */}
        <div className="bg-card rounded-md border border-primary/20 overflow-hidden">
          <div className="px-3 py-2 bg-primary/10 border-b border-primary/30">
            <h3 className="text-[11px] md:text-sm font-heading font-bold text-primary uppercase tracking-wider">Buy Offers</h3>
          </div>
          
          <div className="divide-y divide-border max-h-96 overflow-y-auto">
            {buyOffers.length === 0 ? (
              <div className="p-6 text-center">
                <Coins size={28} className="mx-auto text-primary/30 mb-2" />
                <p className="text-[10px] md:text-xs text-mutedForeground font-heading">No buy offers</p>
              </div>
            ) : (
              (() => {
                const groupedOffers = buyOffers.reduce((acc, offer) => {
                  const key = offer.user_id;
                  if (!acc[key]) acc[key] = [];
                  acc[key].push(offer);
                  return acc;
                }, {});
                
                return Object.values(groupedOffers).map((userOffers, groupIdx) => {
                  const firstOffer = userOffers[0];
                  const isMyOffer = firstOffer.user_id === currentUserId;
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
                  
                  return (
                    <div key={groupIdx} className={`px-3 py-2 hover:bg-secondary/30 transition-colors ${isMyOffer ? 'bg-primary/5' : ''}`}>
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <div className="flex items-center gap-1.5">
                          <Users size={12} className="text-primary" />
                          <span className="text-[10px] md:text-xs font-heading font-bold text-foreground">
                            {isMyOffer ? 'You' : (firstOffer.hide_name ? '[Anon]' : firstOffer.username)}
                          </span>
                          {totalOffers > 1 && (
                            <span className="text-[9px] bg-primary/20 text-primary px-1 py-0.5 rounded font-heading font-bold">
                              {totalOffers}
                            </span>
                          )}
                        </div>
                      </div>
                      
                      <div className="space-y-1.5">
                        {Object.values(stackedOffers).map((offer, offerIdx) => (
                          <div key={offerIdx} className="flex items-center justify-between gap-2 pl-3 border-l-2 border-primary/20">
                            <div className="flex-1 text-[10px] text-mutedForeground space-y-0.5">
                              <div>Pts: <span className="text-primary font-bold">{formatNumber(offer.points)}</span></div>
                              <div>Cost: <span className="text-foreground font-bold">${formatNumber(offer.cost)}</span></div>
                              <div>Per: <span className="text-mutedForeground">${formatCurrency((offer.cost || 0) / (offer.points || 1))}</span> {offer.count > 1 && <span className="text-primary font-bold">x{offer.count}</span>}</div>
                            </div>
                            <div className="flex flex-col gap-1">
                              {offer.ids.map((id, idIdx) => (
                                isMyOffer ? (
                                  <button
                                    key={idIdx}
                                    onClick={() => handleCancelOffer(id, 'buy')}
                                    className="px-2.5 py-1 bg-red-900/20 border border-red-700/30 text-red-400 text-[9px] md:text-[10px] font-heading font-bold rounded-sm hover:bg-red-900/30 transition-all active:scale-95"
                                  >
                                    Cancel
                                  </button>
                                ) : (
                                  <button
                                    key={idIdx}
                                    onClick={() => handleAcceptOffer(id, 'buy')}
                                    className="px-2.5 py-1 bg-primary/10 border border-primary/30 text-primary text-[9px] md:text-[10px] font-heading font-bold rounded-sm hover:bg-primary/20 transition-all active:scale-95"
                                  >
                                    Accept
                                  </button>
                                )
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                });
              })()
            )}
          </div>
        </div>
      </div>

      {/* Properties for Sale - Mobile Optimized */}
      <div className="bg-card rounded-md border border-primary/20 overflow-hidden">
        <div className="px-3 py-2 bg-primary/10 border-b border-primary/30">
          <h3 className="text-[11px] md:text-sm font-heading font-bold text-primary uppercase tracking-wider flex items-center gap-1.5">
            <Building2 size={14} className="md:w-4 md:h-4" />
            Properties for Sale
          </h3>
        </div>
        
        {/* Desktop Table View */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-secondary/30 border-b border-border">
                <th className="px-3 py-2 text-left font-heading text-[10px] text-mutedForeground uppercase tracking-wider">Location</th>
                <th className="px-3 py-2 text-left font-heading text-[10px] text-mutedForeground uppercase tracking-wider">Property</th>
                <th className="px-3 py-2 text-left font-heading text-[10px] text-mutedForeground uppercase tracking-wider">Owner</th>
                <th className="px-3 py-2 text-right font-heading text-[10px] text-mutedForeground uppercase tracking-wider">Points</th>
                <th className="px-3 py-2 text-center font-heading text-[10px] text-mutedForeground uppercase tracking-wider">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {properties.length === 0 ? (
                <tr>
                  <td colSpan="5" className="px-3 py-6 text-center">
                    <Building2 size={28} className="mx-auto text-primary/30 mb-2" />
                    <p className="text-xs text-mutedForeground font-heading">No properties for sale</p>
                  </td>
                </tr>
              ) : (
                properties.map((prop, idx) => (
                  <tr key={idx} className="hover:bg-secondary/30 transition-colors">
                    <td className="px-3 py-2 font-heading text-[11px] text-foreground">{prop.location}</td>
                    <td className="px-3 py-2 font-heading text-[11px] text-foreground">{prop.property_name}</td>
                    <td className="px-3 py-2 font-heading text-[11px] text-foreground">{prop.owner}</td>
                    <td className="px-3 py-2 text-right font-heading text-[11px] text-primary font-bold">
                      {prop.points?.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <button
                        onClick={() => handleAcceptOffer(prop.id, 'property')}
                        className="px-2.5 py-1 bg-primary/10 border border-primary/30 text-primary text-[10px] font-heading font-bold rounded-sm hover:bg-primary/20 transition-all active:scale-95"
                      >
                        Buy
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile Card View */}
        <div className="md:hidden divide-y divide-border">
          {properties.length === 0 ? (
            <div className="p-6 text-center">
              <Building2 size={28} className="mx-auto text-primary/30 mb-2" />
              <p className="text-[10px] text-mutedForeground font-heading">No properties for sale</p>
            </div>
          ) : (
            properties.map((prop, idx) => (
              <div key={idx} className="p-3 hover:bg-secondary/20 transition-colors">
                <div className="space-y-1.5">
                  <div className="flex justify-between items-start gap-2">
                    <span className="text-[11px] font-heading font-bold text-foreground">{prop.property_name}</span>
                    <span className="text-[11px] font-heading text-primary font-bold">{prop.points?.toLocaleString()} pts</span>
                  </div>
                  <div className="text-[10px] text-mutedForeground space-y-0.5">
                    <div>Location: <span className="text-foreground">{prop.location}</span></div>
                    <div>Owner: <span className="text-foreground">{prop.owner}</span></div>
                  </div>
                  <button
                    onClick={() => handleAcceptOffer(prop.id, 'property')}
                    className="w-full mt-2 px-3 py-1.5 bg-primary/10 border border-primary/30 text-primary text-[10px] font-heading font-bold rounded-sm hover:bg-primary/20 transition-all active:scale-95"
                  >
                    Buy Property
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
