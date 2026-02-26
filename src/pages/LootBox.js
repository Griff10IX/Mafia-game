import { useState, useEffect } from 'react';
import { Gift, X, Package, Swords, Car, Shield, Building2, Coins, Zap } from 'lucide-react';
import { Link } from 'react-router-dom';
import api, { refreshUser } from '../utils/api';
import { toast } from 'sonner';

const CAP = 3;

function rewardLabel(reward) {
  if (!reward) return '—';
  switch (reward.type) {
    case 'weapon':
      return reward.name || 'Exclusive weapon';
    case 'car':
      return reward.name || 'Exclusive car';
    case 'armour':
      return reward.name || 'Exclusive armour';
    case 'property':
      return reward.name || 'Speakeasy';
    case 'points':
      return `${reward.amount ?? 0} points`;
    case 'rank_points':
      return `${reward.amount ?? 0} rank points`;
    case 'cash':
      return `$${Number(reward.amount ?? 0).toLocaleString()}`;
    case 'cars':
      return `${reward.count ?? 0} cars`;
    case 'bullets':
      return `${reward.amount ?? 0} bullets`;
    case 'perk':
      return reward.name || 'Perk';
    default:
      return JSON.stringify(reward);
  }
}

export default function LootBox() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [result, setResult] = useState(null);

  const loadStatus = async () => {
    try {
      const res = await api.get('/loot-box/status');
      setStatus(res.data);
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to load loot box status');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStatus();
  }, []);

  const handleOpen = async () => {
    if ((status?.loot_box_pieces ?? 0) < 100) return;
    setOpening(true);
    setResult(null);
    try {
      const res = await api.post('/loot-box/open', { tier: 'standard' });
      setResult(res.data);
      await refreshUser();
      await loadStatus();
      toast.success('Loot box opened!');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to open loot box');
    } finally {
      setOpening(false);
    }
  };

  const closeModal = () => setResult(null);

  const pieces = status?.loot_box_pieces ?? 0;
  const claimed = status?.claimed_counts ?? { weapon: 0, car: 0, armour: 0, property: 0 };
  const canOpen = pieces >= 100;

  if (loading) {
    return (
      <div className="p-4 text-foreground font-heading">
        <p className="text-sm">Loading...</p>
      </div>
    );
  }

  return (
    <div className="p-4 max-w-lg mx-auto">
      <h1 className="text-xl font-heading font-bold text-foreground mb-2 flex items-center gap-2">
        <Gift className="text-amber-500" />
        Loot Box
      </h1>
      <p className="text-sm text-muted-foreground mb-4">
        Earn pieces from <Link to="/missions" className="text-primary underline">Missions</Link>. 100 pieces = 1 box. Exclusives are very rare.
      </p>

      <div className="rounded-lg border border-border bg-card p-4 mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-muted-foreground">Pieces</span>
          <span className="text-lg font-bold text-amber-500">{pieces}</span>
        </div>
        <button
          type="button"
          onClick={handleOpen}
          disabled={!canOpen || opening}
          className="w-full py-2 px-4 rounded-md bg-amber-600 hover:bg-amber-700 disabled:opacity-50 disabled:pointer-events-none text-white font-heading flex items-center justify-center gap-2"
        >
          <Package size={18} />
          {opening ? 'Opening...' : `Open (100 pieces)`}
        </button>
        {pieces > 0 && pieces < 100 && (
          <p className="text-xs text-muted-foreground mt-2 text-center">
            {100 - pieces} more to open a box
          </p>
        )}
      </div>

      <div className="rounded-lg border border-border bg-card p-4 mb-4">
        <h2 className="text-sm font-heading font-semibold text-foreground mb-2">Exclusive scarcity (max {CAP} each)</h2>
        <ul className="space-y-1 text-sm">
          <li className="flex items-center gap-2">
            <Swords size={14} className="text-muted-foreground" />
            Weapon: {claimed.weapon}/{CAP} claimed
          </li>
          <li className="flex items-center gap-2">
            <Car size={14} className="text-muted-foreground" />
            Car: {claimed.car}/{CAP} claimed
          </li>
          <li className="flex items-center gap-2">
            <Shield size={14} className="text-muted-foreground" />
            Armour: {claimed.armour}/{CAP} claimed
          </li>
          <li className="flex items-center gap-2">
            <Building2 size={14} className="text-muted-foreground" />
            Speakeasy: {claimed.property}/{CAP} claimed
          </li>
        </ul>
      </div>

      {result && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={closeModal}>
          <div
            className="rounded-lg border border-border bg-card p-6 max-w-sm w-full shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-heading font-bold text-foreground">You got</h3>
              <button type="button" onClick={closeModal} className="p-1 rounded hover:bg-muted">
                <X size={20} />
              </button>
            </div>
            <div className="flex items-center gap-3 py-3 text-foreground">
              {result.reward?.type === 'cash' && <Coins className="text-amber-500" size={32} />}
              {result.reward?.type === 'perk' && <Zap className="text-amber-500" size={32} />}
              <span className="text-xl font-heading">{rewardLabel(result.reward)}</span>
            </div>
            <p className="text-sm text-muted-foreground">
              Pieces left: {result.new_pieces ?? 0}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
