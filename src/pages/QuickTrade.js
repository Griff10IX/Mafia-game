import { useState, useEffect } from 'react';
import { Coins, ArrowLeftRight, Users, Building2, TrendingUp, TrendingDown, HelpCircle } from 'lucide-react';
import api from '../utils/api';
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
      // Placeholder - you'll need to create these endpoints
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
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to create offer');
    }
  };

  const handleAcceptOffer = async (offerId, type) => {
    try {
      await api.post(`/trade/${type}-offer/${offerId}/accept`);
      toast.success('Trade completed!');
      fetchTrades();
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
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to cancel offer');
    }
  };

  // Calculate per-point prices and fees (0.5% fee, minimum 1 point)
  const formatCurrency = (num) => {
    return parseFloat(num).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  
  const sellPerPoint = sellPoints && sellCost ? formatCurrency(parseFloat(sellCost) / parseFloat(sellPoints)) : '0.00';
  const buyPerPoint = buyPoints && buyOffer ? formatCurrency(parseFloat(buyOffer) / parseFloat(buyPoints)) : '0.00';
  
  const calculateFee = (points) => {
    const fee = Math.max(1, Math.floor(parseFloat(points) * 0.005));
    return fee;
  };
  
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
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-heading font-bold text-primary mb-1 flex items-center gap-2">
          <ArrowLeftRight className="w-6 h-6 sm:w-7 sm:h-7" />
          Quick Trade
        </h1>
        <p className="text-xs text-mutedForeground">Trade points, money, and properties with other players</p>
      </div>

      {/* Create Offers Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        {/* Sell Points */}
        <div className={`${styles.panel} rounded-md border border-primary/20 p-4`}>
          <div className="flex items-center gap-2 mb-4">
            <TrendingDown size={18} className="text-primary" />
            <h2 className="text-sm font-heading font-bold text-primary uppercase tracking-wider">Sell Points</h2>
          </div>
          
          <div className="space-y-3">
            <div>
              <label className="block text-[10px] text-mutedForeground font-heading uppercase tracking-wider mb-1">
                Points...
              </label>
              <input
                type="number"
                value={sellPoints}
                onChange={(e) => setSellPoints(e.target.value)}
                placeholder="Enter points to sell"
                className="w-full bg-input border border-border rounded px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none"
              />
            </div>
            
            <div>
              <label className="block text-[10px] text-mutedForeground font-heading uppercase tracking-wider mb-1">
                Cost ($)
              </label>
              <input
                type="number"
                value={sellCost}
                onChange={(e) => setSellCost(e.target.value)}
                placeholder="Price in cash"
                className="w-full bg-input border border-border rounded px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none"
              />
              {sellPoints && sellCost && (
                <p className="text-xs text-mutedForeground mt-1">
                  Per Point: <span className="text-primary font-bold">${sellPerPoint}</span>
                </p>
              )}
            </div>

            {/* Fee Info */}
            <div className="relative group">
              <div className="flex items-center gap-2 px-3 py-2 bg-secondary/20 border border-border rounded-sm">
                <span className="text-xs text-mutedForeground font-heading">Fee:</span>
                <span className="text-xs text-foreground font-heading font-bold">
                  {sellFee} {sellFee === 1 ? 'point' : 'points'}
                </span>
                <HelpCircle size={14} className="text-primary/60 cursor-help ml-auto" />
              </div>
              
              {/* Tooltip */}
              <div className="absolute left-0 bottom-full mb-2 w-72 bg-background border border-primary/30 rounded-md p-3 shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
                <p className="text-xs text-foreground font-heading mb-2">
                  A 0.5% fee (1 point minimum) will be deducted from your offer. 
                  It will be refunded if you cancel the offer.
                </p>
                <div className="space-y-1 text-[10px] text-mutedForeground font-heading">
                  <p>E.g.) You offer to sell 50 - offer is for <span className="text-primary font-bold">49</span></p>
                  <p>E.g.) You offer to sell 5,000 - offer is for <span className="text-primary font-bold">4,975</span></p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="hideNameSell"
                checked={hideNameSell}
                onChange={(e) => setHideNameSell(e.target.checked)}
                className="rounded"
              />
              <label htmlFor="hideNameSell" className="text-xs text-mutedForeground font-heading cursor-pointer">
                Hide name
              </label>
            </div>

            <button
              onClick={handleCreateSellOffer}
              disabled={!sellPoints || !sellCost}
              className={`w-full ${styles.raisedHover} bg-primary/10 border border-primary/30 text-primary font-heading font-bold py-2.5 rounded-sm hover:bg-primary/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              Add Offer - ${sellCost ? parseInt(sellCost).toLocaleString() : '0'}
              {sellPoints && <span className="text-xs ml-1">({sellAfterFee.toLocaleString()} after fee)</span>}
            </button>
          </div>
        </div>

        {/* Buy Points */}
        <div className={`${styles.panel} rounded-md border border-primary/20 p-4`}>
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp size={18} className="text-primary" />
            <h2 className="text-sm font-heading font-bold text-primary uppercase tracking-wider">Buy Points</h2>
          </div>
          
          <div className="space-y-3">
            <div>
              <label className="block text-[10px] text-mutedForeground font-heading uppercase tracking-wider mb-1">
                Points...
              </label>
              <input
                type="number"
                value={buyPoints}
                onChange={(e) => setBuyPoints(e.target.value)}
                placeholder="Points you want to buy"
                className="w-full bg-input border border-border rounded px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none"
              />
            </div>
            
            <div>
              <label className="block text-[10px] text-mutedForeground font-heading uppercase tracking-wider mb-1">
                Offer ($)
              </label>
              <input
                type="number"
                value={buyOffer}
                onChange={(e) => setBuyOffer(e.target.value)}
                placeholder="How much you'll pay"
                className="w-full bg-input border border-border rounded px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none"
              />
              {buyPoints && buyOffer && (
                <p className="text-xs text-mutedForeground mt-1">
                  Per Point: <span className="text-primary font-bold">${buyPerPoint}</span>
                </p>
              )}
            </div>

            {/* Fee Info */}
            <div className="relative group">
              <div className="flex items-center gap-2 px-3 py-2 bg-secondary/20 border border-border rounded-sm">
                <span className="text-xs text-mutedForeground font-heading">Fee:</span>
                <span className="text-xs text-foreground font-heading font-bold">
                  {buyFee} {buyFee === 1 ? 'point' : 'points'}
                </span>
                <HelpCircle size={14} className="text-primary/60 cursor-help ml-auto" />
              </div>
              
              {/* Tooltip */}
              <div className="absolute left-0 bottom-full mb-2 w-72 bg-background border border-primary/30 rounded-md p-3 shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
                <p className="text-xs text-foreground font-heading mb-2">
                  A 0.5% fee (1 point minimum) will be deducted from your offer. 
                  It will be refunded if you cancel the offer.
                </p>
                <div className="space-y-1 text-[10px] text-mutedForeground font-heading">
                  <p>E.g.) You offer to buy 50 - offer is for <span className="text-primary font-bold">49</span></p>
                  <p>E.g.) You offer to buy 5,000 - offer is for <span className="text-primary font-bold">4,975</span></p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="hideNameBuy"
                checked={hideNameBuy}
                onChange={(e) => setHideNameBuy(e.target.checked)}
                className="rounded"
              />
              <label htmlFor="hideNameBuy" className="text-xs text-mutedForeground font-heading cursor-pointer">
                Hide name
              </label>
            </div>

            <button
              onClick={handleCreateBuyOffer}
              disabled={!buyPoints || !buyOffer}
              className={`w-full ${styles.raisedHover} bg-primary/10 border border-primary/30 text-primary font-heading font-bold py-2.5 rounded-sm hover:bg-primary/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              Add Offer - ${buyOffer ? parseInt(buyOffer).toLocaleString() : '0'}
              {buyPoints && <span className="text-xs ml-1">({buyAfterFee.toLocaleString()} after fee)</span>}
            </button>
          </div>
        </div>
      </div>

      {/* Offers Lists */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        {/* Buy Points Offers */}
        <div className={`${styles.panel} rounded-md border border-primary/20 overflow-hidden`}>
          <div className="px-4 py-3 bg-primary/10 border-b border-primary/30">
            <h3 className="text-sm font-heading font-bold text-primary uppercase tracking-wider">Buy Points Offers</h3>
            <p className="text-[10px] text-mutedForeground mt-0.5">Accept offers - $0</p>
          </div>
          
          <div className="divide-y divide-border">
            {buyOffers.length === 0 ? (
              <div className="p-8 text-center">
                <Coins size={32} className="mx-auto text-primary/30 mb-2" />
                <p className="text-xs text-mutedForeground font-heading">No buy offers available</p>
              </div>
            ) : (
              buyOffers.map((offer, idx) => {
                const isMyOffer = offer.user_id === currentUserId;
                return (
                  <div key={idx} className={`px-4 py-3 hover:bg-secondary/30 transition-colors ${isMyOffer ? 'bg-primary/5' : ''}`}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <Users size={14} className="text-primary" />
                          <span className="text-xs font-heading font-bold text-foreground">
                            {isMyOffer ? 'Your Offer' : (offer.hide_name ? '[Anonymous]' : offer.username)}
                          </span>
                        </div>
                        <div className="text-[11px] text-mutedForeground space-y-0.5">
                          <div>Points: <span className="text-primary font-bold">{offer.points?.toLocaleString()}</span></div>
                          <div>Cost: <span className="text-foreground font-bold">${offer.cost?.toLocaleString()}</span></div>
                          <div>Per Point: <span className="text-mutedForeground">${formatCurrency((offer.cost || 0) / (offer.points || 1))}</span></div>
                        </div>
                      </div>
                      {isMyOffer ? (
                        <button
                          onClick={() => handleCancelOffer(offer.id, 'buy')}
                          className={`${styles.raisedHover} px-4 py-2 bg-red-900/20 border border-red-700/30 text-red-400 text-xs font-heading font-bold rounded-sm hover:bg-red-900/30 transition-all`}
                        >
                          Cancel
                        </button>
                      ) : (
                        <button
                          onClick={() => handleAcceptOffer(offer.id, 'buy')}
                          className={`${styles.raisedHover} px-4 py-2 bg-primary/10 border border-primary/30 text-primary text-xs font-heading font-bold rounded-sm hover:bg-primary/20 transition-all`}
                        >
                          Accept
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Sell Points Offers */}
        <div className={`${styles.panel} rounded-md border border-primary/20 overflow-hidden`}>
          <div className="px-4 py-3 bg-primary/10 border-b border-primary/30">
            <h3 className="text-sm font-heading font-bold text-primary uppercase tracking-wider">Sell Points Offers</h3>
            <p className="text-[10px] text-mutedForeground mt-0.5">Accept offers - $0</p>
          </div>
          
          <div className="divide-y divide-border">
            {sellOffers.length === 0 ? (
              <div className="p-8 text-center">
                <Coins size={32} className="mx-auto text-primary/30 mb-2" />
                <p className="text-xs text-mutedForeground font-heading">No sell offers available</p>
              </div>
            ) : (
              sellOffers.map((offer, idx) => {
                const isMyOffer = offer.user_id === currentUserId;
                return (
                  <div key={idx} className={`px-4 py-3 hover:bg-secondary/30 transition-colors ${isMyOffer ? 'bg-primary/5' : ''}`}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <Users size={14} className="text-primary" />
                          <span className="text-xs font-heading font-bold text-foreground">
                            {isMyOffer ? 'Your Offer' : (offer.hide_name ? '[Anonymous]' : offer.username)}
                          </span>
                        </div>
                        <div className="text-[11px] text-mutedForeground space-y-0.5">
                          <div>Points: <span className="text-primary font-bold">{offer.points?.toLocaleString()}</span></div>
                          <div>Money: <span className="text-foreground font-bold">${offer.money?.toLocaleString()}</span></div>
                          <div>Per Point: <span className="text-mutedForeground">${formatCurrency((offer.money || 0) / (offer.points || 1))}</span></div>
                        </div>
                      </div>
                      {isMyOffer ? (
                        <button
                          onClick={() => handleCancelOffer(offer.id, 'sell')}
                          className={`${styles.raisedHover} px-4 py-2 bg-red-900/20 border border-red-700/30 text-red-400 text-xs font-heading font-bold rounded-sm hover:bg-red-900/30 transition-all`}
                        >
                          Cancel
                        </button>
                      ) : (
                        <button
                          onClick={() => handleAcceptOffer(offer.id, 'sell')}
                          className={`${styles.raisedHover} px-4 py-2 bg-primary/10 border border-primary/30 text-primary text-xs font-heading font-bold rounded-sm hover:bg-primary/20 transition-all`}
                        >
                          Accept
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Properties for Sale */}
      <div className={`${styles.panel} rounded-md border border-primary/20 overflow-hidden`}>
        <div className="px-4 py-3 bg-primary/10 border-b border-primary/30">
          <h3 className="text-sm font-heading font-bold text-primary uppercase tracking-wider flex items-center gap-2">
            <Building2 size={16} />
            Properties for Sale
          </h3>
          <p className="text-[10px] text-mutedForeground mt-0.5">?</p>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-secondary/30 border-b border-border">
                <th className="px-4 py-2 text-left font-heading text-mutedForeground uppercase tracking-wider">Location</th>
                <th className="px-4 py-2 text-left font-heading text-mutedForeground uppercase tracking-wider">Property</th>
                <th className="px-4 py-2 text-left font-heading text-mutedForeground uppercase tracking-wider">Owner</th>
                <th className="px-4 py-2 text-right font-heading text-mutedForeground uppercase tracking-wider">Points</th>
                <th className="px-4 py-2 text-center font-heading text-mutedForeground uppercase tracking-wider">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {properties.length === 0 ? (
                <tr>
                  <td colSpan="5" className="px-4 py-8 text-center">
                    <Building2 size={32} className="mx-auto text-primary/30 mb-2" />
                    <p className="text-xs text-mutedForeground font-heading">No properties for sale</p>
                  </td>
                </tr>
              ) : (
                properties.map((prop, idx) => (
                  <tr key={idx} className="hover:bg-secondary/30 transition-colors">
                    <td className="px-4 py-3 font-heading text-foreground">{prop.location}</td>
                    <td className="px-4 py-3 font-heading text-foreground">{prop.property_name}</td>
                    <td className="px-4 py-3 font-heading text-foreground">{prop.owner}</td>
                    <td className="px-4 py-3 text-right font-heading text-primary font-bold">
                      {prop.points?.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => handleAcceptOffer(prop.id, 'property')}
                        className={`${styles.raisedHover} px-3 py-1 bg-primary/10 border border-primary/30 text-primary text-[10px] font-heading font-bold rounded-sm hover:bg-primary/20 transition-all`}
                      >
                        Buy Property
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Coming Soon Notice */}
      <div className={`${styles.panel} rounded-md border border-primary/20 p-4 mt-6`}>
        <div className="flex items-center gap-3">
          <Coins size={24} className="text-primary" />
          <div>
            <h3 className="text-sm font-heading font-bold text-primary">Quick Trade System</h3>
            <p className="text-xs text-mutedForeground mt-1">
              Backend endpoints needed: <code className="text-primary">/api/trade/sell-offer</code>, <code className="text-primary">/api/trade/buy-offer</code>, <code className="text-primary">/api/trade/properties</code>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
