import { useEffect, useMemo, useState } from 'react';
import { Shield, DollarSign, Gem, CheckCircle2, Lock } from 'lucide-react';
import api from '../utils/api';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

function formatCost(opt) {
  if (opt.cost_points != null) return `${opt.cost_points} points`;
  if (opt.cost_money != null) return `$${Number(opt.cost_money).toLocaleString()}`;
  return '—';
}

export default function Armour() {
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState(null);
  const [data, setData] = useState({ current_level: 0, options: [] });
  const [buyingLevel, setBuyingLevel] = useState(null);
  const [equippingLevel, setEquippingLevel] = useState(null);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [meRes, optRes] = await Promise.all([api.get('/auth/me'), api.get('/armour/options')]);
      setMe(meRes.data);
      setData(optRes.data);
    } catch (e) {
      toast.error('Failed to load armour shop');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
  }, []);

  const rows = useMemo(() => {
    return (data.options || []).map((o) => {
      const status = o.equipped ? 'Equipped' : o.owned ? 'Owned' : o.affordable ? 'Available' : 'Locked';
      const canBuy = !o.owned && o.affordable;
      return { ...o, status, canBuy };
    });
  }, [data.options]);

  const buy = async (level) => {
    setBuyingLevel(level);
    try {
      const res = await api.post('/armour/buy', { level });
      toast.success(res.data.message || 'Purchased armour');
      await fetchAll();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to purchase armour');
    } finally {
      setBuyingLevel(null);
    }
  };

  const equip = async (level) => {
    setEquippingLevel(level);
    try {
      const res = await api.post('/armour/equip', { level });
      toast.success(res.data.message || 'Armour equipped');
      await fetchAll();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to equip armour');
    } finally {
      setEquippingLevel(null);
    }
  };

  const unequip = async () => {
    setEquippingLevel(0);
    try {
      const res = await api.post('/armour/unequip');
      toast.success(res.data.message || 'Armour unequipped');
      await fetchAll();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to unequip armour');
    } finally {
      setEquippingLevel(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-primary text-xl font-heading">Loading...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="armour-page">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-mutedForeground">Armour</div>
          <h1 className="text-3xl md:text-4xl font-heading font-bold text-primary mt-2">Armour Shop</h1>
        </div>
        <div className="hidden sm:flex items-center gap-3 text-xs text-mutedForeground">
          <span className="inline-flex items-center gap-1">
            <DollarSign size={14} className="text-primary" /> ${Number(me?.money ?? 0).toLocaleString()}
          </span>
          <span className="text-mutedForeground/60">|</span>
          <span className="inline-flex items-center gap-1">
            <Gem size={14} className="text-primary" /> {Number(me?.points ?? 0).toLocaleString()} pts
          </span>
        </div>
      </div>

      <div className="flex justify-center">
        <div className={`w-full max-w-3xl ${styles.panel} border border-border rounded-sm overflow-hidden`}>
          <div className="grid grid-cols-12 bg-secondary/40 text-xs uppercase tracking-wider text-mutedForeground px-4 py-3">
            <div className="col-span-6">Set</div>
            <div className="col-span-2 text-right">Level</div>
            <div className="col-span-2 text-right">Cost</div>
            <div className="col-span-2 text-right">Action</div>
          </div>

          {rows.map((o) => {
            const costIcon = o.cost_points != null ? Gem : DollarSign;
            const CostIcon = costIcon;
            const statusText = o.status;

            return (
              <div
                key={o.level}
                className="grid grid-cols-12 px-4 py-3 border-t border-border items-center transition-smooth bg-background/30 hover:bg-background/50"
                data-testid={`armour-row-${o.level}`}
              >
                <div className="col-span-6 min-w-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-foreground truncate">{o.name}</div>
                      <div className="text-xs text-mutedForeground truncate">{o.description}</div>
                    </div>
                    <Shield className="text-primary shrink-0" size={18} />
                  </div>
                </div>

                <div className="col-span-2 text-right text-sm font-mono text-foreground">Lv.{o.level}</div>

                <div className="col-span-2 text-right text-sm font-mono text-mutedForeground">
                  <span className="inline-flex items-center justify-end gap-1">
                    <CostIcon size={14} className="text-primary" />
                    <span>{formatCost(o)}</span>
                  </span>
                </div>

                <div className="col-span-2 text-right">
                  {o.equipped ? (
                    <button
                      type="button"
                      onClick={unequip}
                      disabled={equippingLevel != null}
                      className="bg-secondary border border-primary text-primary hover:bg-primary hover:text-primaryForeground rounded-sm px-3 py-1.5 text-xs font-bold uppercase tracking-widest transition-smooth disabled:opacity-50"
                      data-testid={`armour-unequip-${o.level}`}
                    >
                      {equippingLevel === 0 ? '...' : 'Unequip'}
                    </button>
                  ) : o.owned ? (
                    <button
                      type="button"
                      onClick={() => equip(o.level)}
                      disabled={equippingLevel != null}
                      className="bg-primary text-primaryForeground hover:opacity-90 rounded-sm px-3 py-1.5 text-xs font-bold uppercase tracking-widest transition-smooth gold-glow disabled:opacity-50"
                      data-testid={`armour-equip-${o.level}`}
                    >
                      {equippingLevel === o.level ? '...' : 'Equip'}
                    </button>
                  ) : o.canBuy ? (
                    <button
                      type="button"
                      onClick={() => buy(o.level)}
                      disabled={buyingLevel != null}
                      className="bg-primary text-primaryForeground hover:opacity-90 rounded-sm px-3 py-1.5 text-xs font-bold uppercase tracking-widest transition-smooth gold-glow disabled:opacity-50"
                      data-testid={`armour-buy-${o.level}`}
                    >
                      {buyingLevel === o.level ? '...' : 'Buy'}
                    </button>
                  ) : (
                    <span className="inline-flex items-center justify-end gap-1 text-xs text-mutedForeground font-mono">
                      <Lock size={14} className="text-mutedForeground" /> {statusText}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex justify-center">
        <div className={`w-full max-w-3xl ${styles.panel} border border-border rounded-sm p-6`}>
          <h3 className="text-xl font-heading font-semibold text-primary mb-3">Armour System</h3>
          <ul className="space-y-2 text-sm text-mutedForeground">
            <li>• Armour has 5 tiers (Lv.1 → Lv.5)</li>
            <li>• The first 3 tiers cost cash; the top 2 tiers cost points</li>
            <li>• Higher armour increases the bullets required to kill you</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

