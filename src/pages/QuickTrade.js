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
      <div className={`space-y-6 ${styles.pageContent}`}>
        <div className="flex items-center gap-3">
          <ArrowLeftRight className="w-8 h-8 text-primary shrink-0" />
          <h1 className="text-2xl sm:text-3xl font-heading font-bold text-primary">Quick Trade</h1>
        </div>
        <div className="text-primary font-heading">Loading...</div>
      </div>
    );
  }

  return (
    <div className={`space-y-6 ${styles.pageContent}`} data-testid="quicktrade-page">
      {/* Header - same as Objectives */}
      <div className="flex items-center gap-3">
        <ArrowLeftRight className="w-8 h-8 text-primary shrink-0" />
        <div>
          <h1 className="text-2xl sm:text-3xl font-heading font-bold text-primary">Quick Trade</h1>
          <p className="text-sm text-mutedForeground">Trade points, money, and properties</p>
        </div>
      </div>

      {/* Create Offers Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Sell Points */}
        <section className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
          <div className="px-4 py-3 bg-primary/10 border-b border-primary/30">
            <div className="flex items-center gap-2">
              <TrendingDown className="w-5 h-5 text-primary" />
              <h2 className="text-base font-heading font-bold text-primary uppercase tracking-wider">Sell Points</h2>
            </div>
          </div>
          <div className="p-4 space-y-2.5">
            <div>
              <label className="block text-[10px] text-mutedForeground font-heading uppercase tracking-wider mb-1">Points</label>
              <input
                type="number"
                value={sellPoints}
                onChange={(e) => setSellPoints(e.target.value)}
                placeholder="Enter points"
                className="w-full bg-zinc-900/50 border border-zinc-700/50 rounded px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[10px] text-mutedForeground font-heading uppercase tracking-wider mb-1">Cost ($)</label>
              <input
                type="number"
                value={sellCost}
                onChange={(e) => setSellCost(e.target.value)}
                placeholder="Price"
                className="w-full bg-zinc-900/50 border border-zinc-700/50 rounded px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none"
              />
              {sellPoints && sellCost && (
                <p className="text-[10px] text-mutedForeground mt-1">Per point: <span className="text-primary font-bold">${formatCurrency(sellPerPoint)}</span></p>
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
            <button
              onClick={handleCreateSellOffer}
              disabled={!sellPoints || !sellCost}
              className="w-full px-4 py-2 rounded bg-primary text-primaryForeground text-xs font-heading font-bold hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Add ${sellCost ? formatNumber(sellCost) : '0'}
              {sellPoints && <span className="text-[10px] opacity-90 ml-1">({formatNumber(sellAfterFee)} after fee)</span>}
            </button>
          </div>
        </section>

        {/* Buy Points */}
        <section className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
          <div className="px-4 py-3 bg-primary/10 border-b border-primary/30">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-primary" />
              <h2 className="text-base font-heading font-bold text-primary uppercase tracking-wider">Buy Points</h2>
            </div>
          </div>
          <div className="p-4 space-y-2.5">
            <div>
              <label className="block text-[10px] text-mutedForeground font-heading uppercase tracking-wider mb-1">Points</label>
              <input
                type="number"
                value={buyPoints}
                onChange={(e) => setBuyPoints(e.target.value)}
                placeholder="Points wanted"
                className="w-full bg-zinc-900/50 border border-zinc-700/50 rounded px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[10px] text-mutedForeground font-heading uppercase tracking-wider mb-1">Offer ($)</label>
              <input
                type="number"
                value={buyOffer}
                onChange={(e) => setBuyOffer(e.target.value)}
                placeholder="Your offer"
                className="w-full bg-zinc-900/50 border border-zinc-700/50 rounded px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none"
              />
              {buyPoints && buyOffer && (
                <p className="text-[10px] text-mutedForeground mt-1">Per point: <span className="text-primary font-bold">${formatCurrency(buyPerPoint)}</span></p>
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
            <button
              onClick={handleCreateBuyOffer}
              disabled={!buyPoints || !buyOffer}
              className="w-full px-4 py-2 rounded bg-primary text-primaryForeground text-xs font-heading font-bold hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Add ${buyOffer ? formatNumber(buyOffer) : '0'}
              {buyPoints && <span className="text-[10px] opacity-90 ml-1">({formatNumber(buyAfterFee)} after fee)</span>}
            </button>
          </div>
        </section>
      </div>

      {/* Offers Lists */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Sell Points Offers */}
        <section className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
          <div className="px-4 py-3 bg-primary/10 border-b border-primary/30">
            <h3 className="text-base font-heading font-bold text-primary uppercase tracking-wider">Sell Offers</h3>
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
                    <div key={groupIdx} className={`px-4 py-2 hover:bg-zinc-800/30 transition-colors ${isMyOffer ? 'bg-primary/5' : ''}`}>
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <div className="flex items-center gap-1.5">
                          <Users size={12} className="text-primary" />
                          <span className="text-xs font-heading font-bold text-foreground">
                            {isMyOffer ? 'You' : (firstOffer.hide_name ? '[Anon]' : firstOffer.username)}
                          </span>
                          {totalOffers > 1 && (
                            <span className="text-[9px] bg-primary/20 text-primary px-1 py-0.5 rounded font-heading font-bold">{totalOffers}</span>
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
                                  <button key={idIdx} onClick={() => handleCancelOffer(id, 'sell')} className="px-2.5 py-1 bg-red-900/20 border border-red-700/30 text-red-400 text-[10px] font-heading font-bold rounded hover:bg-red-900/30">
                                    Cancel
                                  </button>
                                ) : (
                                  <button key={idIdx} onClick={() => handleAcceptOffer(id, 'sell')} className="px-2.5 py-1 rounded bg-primary text-primaryForeground text-[10px] font-heading font-bold hover:bg-primary/90">
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
        </section>

        {/* Buy Points Offers */}
        <section className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
          <div className="px-4 py-3 bg-primary/10 border-b border-primary/30">
            <h3 className="text-base font-heading font-bold text-primary uppercase tracking-wider">Buy Offers</h3>
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
                    <div key={groupIdx} className={`px-4 py-2 hover:bg-zinc-800/30 transition-colors ${isMyOffer ? 'bg-primary/5' : ''}`}>
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <div className="flex items-center gap-1.5">
                          <Users size={12} className="text-primary" />
                          <span className="text-xs font-heading font-bold text-foreground">
                            {isMyOffer ? 'You' : (firstOffer.hide_name ? '[Anon]' : firstOffer.username)}
                          </span>
                          {totalOffers > 1 && (
                            <span className="text-[9px] bg-primary/20 text-primary px-1 py-0.5 rounded font-heading font-bold">{totalOffers}</span>
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
                                  <button key={idIdx} onClick={() => handleCancelOffer(id, 'buy')} className="px-2.5 py-1 bg-red-900/20 border border-red-700/30 text-red-400 text-[10px] font-heading font-bold rounded hover:bg-red-900/30">
                                    Cancel
                                  </button>
                                ) : (
                                  <button key={idIdx} onClick={() => handleAcceptOffer(id, 'buy')} className="px-2.5 py-1 rounded bg-primary text-primaryForeground text-[10px] font-heading font-bold hover:bg-primary/90">
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
        </section>
      </div>

      {/* Properties for Sale */}
      <section className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
        <div className="px-4 py-3 bg-primary/10 border-b border-primary/30">
          <div className="flex items-center gap-2">
            <Building2 className="w-5 h-5 text-primary" />
            <h3 className="text-base font-heading font-bold text-primary uppercase tracking-wider">Properties for Sale</h3>
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
                    <td className="px-4 py-2 text-right font-heading text-xs text-primary font-bold">{prop.points?.toLocaleString()}</td>
                    <td className="px-4 py-2 text-center">
                      <button onClick={() => handleAcceptOffer(prop.id, 'property')} className="px-2.5 py-1 rounded bg-primary text-primaryForeground text-[10px] font-heading font-bold hover:bg-primary/90">
                        Buy
                      </button>
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
                    <span className="text-xs font-heading text-primary font-bold">{prop.points?.toLocaleString()} pts</span>
                  </div>
                  <div className="text-[10px] text-mutedForeground space-y-0.5">
                    <div>Location: <span className="text-foreground">{prop.location}</span></div>
                    <div>Owner: <span className="text-foreground">{prop.owner}</span></div>
                  </div>
                  <button onClick={() => handleAcceptOffer(prop.id, 'property')} className="w-full mt-2 px-3 py-1.5 rounded bg-primary text-primaryForeground text-[10px] font-heading font-bold hover:bg-primary/90">
                    Buy Property
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
