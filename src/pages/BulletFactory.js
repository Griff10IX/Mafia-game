import { useState, useEffect, useCallback } from 'react';
import { Factory, Package, User, DollarSign, ShoppingCart } from 'lucide-react';
import api, { refreshUser } from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

const formatMoney = (n) => `$${Number(n ?? 0).toLocaleString()}`;

export default function BulletFactory({ me }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [settingPrice, setSettingPrice] = useState(false);
  const [buying, setBuying] = useState(false);
  const [priceInput, setPriceInput] = useState('');
  const [buyAmount, setBuyAmount] = useState('');

  const fetchData = useCallback(async () => {
    try {
      const res = await api.get('/bullet-factory');
      setData(res.data);
    } catch {
      toast.error('Failed to load bullet factory');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const claim = async () => {
    setClaiming(true);
    try {
      await api.post('/bullet-factory/claim');
      toast.success('You now own the Bullet Factory!');
      refreshUser();
      fetchData();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to claim factory');
    } finally {
      setClaiming(false);
    }
  };

  const collect = async () => {
    setCollecting(true);
    try {
      const res = await api.post('/bullet-factory/collect');
      toast.success(res.data?.message || 'Bullets collected');
      refreshUser();
      fetchData();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to collect bullets');
    } finally {
      setCollecting(false);
    }
  };

  const setPrice = async (e) => {
    e.preventDefault();
    const p = parseInt(priceInput, 10);
    if (!Number.isInteger(p) || p < (data?.price_min ?? 1) || p > (data?.price_max ?? 100000)) {
      toast.error(`Enter a price between ${data?.price_min ?? 1} and ${(data?.price_max ?? 100000).toLocaleString()}`);
      return;
    }
    setSettingPrice(true);
    try {
      await api.post('/bullet-factory/set-price', { price_per_bullet: p });
      toast.success('Price updated');
      setPriceInput('');
      fetchData();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to set price');
    } finally {
      setSettingPrice(false);
    }
  };

  const buyBullets = async (e) => {
    e.preventDefault();
    const amount = parseInt(buyAmount, 10);
    if (!Number.isInteger(amount) || amount <= 0) {
      toast.error('Enter a valid amount');
      return;
    }
    setBuying(true);
    try {
      const res = await api.post('/bullet-factory/buy', { amount });
      toast.success(res.data?.message || 'Bullets purchased');
      refreshUser();
      setBuyAmount('');
      fetchData();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to buy bullets');
    } finally {
      setBuying(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-primary font-heading">Loading...</div>
      </div>
    );
  }

  const hasOwner = !!data?.owner_id;
  const isOwner = data?.is_owner ?? false;
  const canCollect = data?.can_collect ?? false;
  const canBuy = data?.can_buy ?? false;
  const accumulated = data?.accumulated_bullets ?? 0;
  const production = data?.production_per_hour ?? 3000;
  const claimCost = data?.claim_cost ?? 0;
  const pricePerBullet = data?.price_per_bullet ?? null;
  const priceMin = data?.price_min ?? 1;
  const priceMax = data?.price_max ?? 100000;
  const userMoney = Number(me?.money ?? 0);
  const canAffordClaim = userMoney >= claimCost;
  const buyAmountNum = parseInt(buyAmount, 10) || 0;
  const buyTotal = buyAmountNum > 0 && pricePerBullet != null ? buyAmountNum * pricePerBullet : 0;
  const canAffordBuy = buyTotal > 0 && userMoney >= buyTotal;

  return (
    <div className="space-y-4" data-testid="bullet-factory-tab">
      <div className={`${styles.panel} rounded-md overflow-hidden border border-primary/20`}>
        <div className="px-3 py-2 bg-primary/10 border-b border-primary/30 flex items-center gap-2">
          <Factory size={18} className="text-primary" />
          <span className="text-xs font-heading font-bold text-primary uppercase tracking-widest">
            Bullet Factory
          </span>
        </div>
        <div className="p-4 space-y-4">
          <p className="text-xs text-mutedForeground font-heading">
            Produces <strong className="text-foreground">{production.toLocaleString()}</strong> bullets per hour.
            {!hasOwner && claimCost > 0 && (
              <span> Pay <strong className="text-primary">${claimCost.toLocaleString()}</strong> to claim and become owner.</span>
            )}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex items-center gap-2 px-3 py-2 bg-zinc-800/30 rounded border border-zinc-700/50">
              <User size={16} className="text-primary shrink-0" />
              <div>
                <div className="text-[10px] text-mutedForeground uppercase font-heading">Owner</div>
                <div className="text-sm font-heading font-bold text-foreground">
                  {hasOwner ? data.owner_username : 'Unclaimed'}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 px-3 py-2 bg-zinc-800/30 rounded border border-zinc-700/50">
              <Package size={16} className="text-primary shrink-0" />
              <div>
                <div className="text-[10px] text-mutedForeground uppercase font-heading">Ready to collect</div>
                <div className="text-sm font-heading font-bold text-foreground">
                  {hasOwner ? accumulated.toLocaleString() : '—'}
                </div>
              </div>
            </div>
          </div>

          {!hasOwner && (
            <button
              type="button"
              onClick={claim}
              disabled={claiming || !canAffordClaim}
              className={`w-full flex items-center justify-center gap-2 px-4 py-3 font-heading font-bold uppercase tracking-wider rounded border ${
                canAffordClaim
                  ? 'bg-primary/20 border-primary/50 text-primary hover:bg-primary/30'
                  : 'bg-zinc-800/50 border-zinc-600/50 text-zinc-500 cursor-not-allowed opacity-70'
              } disabled:opacity-50`}
            >
              {claiming ? '...' : canAffordClaim ? `Claim Factory — $${claimCost.toLocaleString()}` : `Claim — need $${claimCost.toLocaleString()}`}
            </button>
          )}

          {canCollect && (
            <button
              type="button"
              onClick={collect}
              disabled={collecting}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-b from-primary to-yellow-700 text-primaryForeground font-heading font-bold uppercase tracking-wider rounded hover:opacity-90 disabled:opacity-50 border border-yellow-600/50"
            >
              <Package size={18} />
              {collecting ? '...' : `Collect ${accumulated.toLocaleString()} Bullets`}
            </button>
          )}

          {hasOwner && !canCollect && accumulated === 0 && (
            <p className="text-[10px] text-mutedForeground font-heading">
              Bullets are produced every hour. Check back later to collect.
            </p>
          )}

          {/* Owner: set price */}
          {isOwner && (
            <div className="pt-3 border-t border-primary/10">
              <div className="text-[10px] text-mutedForeground font-heading uppercase mb-2">Sell price (others buy at this; you get the cash)</div>
              <form onSubmit={setPrice} className="flex flex-wrap items-center gap-2">
                <input
                  type="number"
                  min={priceMin}
                  max={priceMax}
                  placeholder={pricePerBullet != null ? String(pricePerBullet) : 'Set $ per bullet'}
                  value={priceInput}
                  onChange={(e) => setPriceInput(e.target.value)}
                  className="w-28 px-2 py-1.5 bg-zinc-800/50 border border-zinc-600/50 rounded text-foreground font-heading text-sm"
                />
                <span className="text-xs text-mutedForeground">per bullet</span>
                <button
                  type="submit"
                  disabled={settingPrice}
                  className="px-3 py-1.5 bg-primary/20 border border-primary/50 text-primary font-heading font-bold text-xs uppercase rounded hover:bg-primary/30 disabled:opacity-50"
                >
                  {settingPrice ? '...' : 'Set price'}
                </button>
              </form>
              {pricePerBullet != null && (
                <p className="text-[10px] text-mutedForeground mt-1">Current: {formatMoney(pricePerBullet)}/bullet</p>
              )}
            </div>
          )}

          {/* Non-owner: buy bullets */}
          {canBuy && pricePerBullet != null && (
            <div className="pt-3 border-t border-primary/10">
              <div className="text-[10px] text-mutedForeground font-heading uppercase mb-2 flex items-center gap-1">
                <ShoppingCart size={12} />
                Buy from factory — owner gets the profit
              </div>
              <form onSubmit={buyBullets} className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={accumulated}
                    placeholder="Amount"
                    value={buyAmount}
                    onChange={(e) => setBuyAmount(e.target.value)}
                    className="w-28 px-2 py-1.5 bg-zinc-800/50 border border-zinc-600/50 rounded text-foreground font-heading text-sm"
                  />
                  <span className="text-xs text-mutedForeground">bullets × {formatMoney(pricePerBullet)} = {formatMoney(buyTotal)}</span>
                </div>
                <button
                  type="submit"
                  disabled={buying || buyAmountNum <= 0 || !canAffordBuy || buyAmountNum > accumulated}
                  className={`px-3 py-2 font-heading font-bold text-xs uppercase rounded border ${
                    canAffordBuy && buyAmountNum > 0 && buyAmountNum <= accumulated
                      ? 'bg-primary/20 border-primary/50 text-primary hover:bg-primary/30'
                      : 'bg-zinc-800/50 border-zinc-600/50 text-zinc-500 cursor-not-allowed'
                  } disabled:opacity-50`}
                >
                  {buying ? '...' : `Buy ${buyAmountNum > 0 ? buyAmountNum.toLocaleString() : ''} bullets`}
                </button>
              </form>
              <p className="text-[10px] text-mutedForeground mt-1">{accumulated.toLocaleString()} available</p>
            </div>
          )}

          {hasOwner && !isOwner && (pricePerBullet == null || accumulated === 0) && (
            <p className="pt-2 border-t border-primary/10 text-[10px] text-mutedForeground font-heading">
              {pricePerBullet == null ? 'Owner has not set a price yet.' : 'No bullets in stock right now.'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
