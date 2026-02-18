import { useState, useEffect, useCallback } from 'react';
import { Building2, Dice5, CircleDot, Spade, Trophy, Plane, Factory, Shield, Link as LinkIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import api from '../utils/api';
import { FormattedNumberInput } from '../components/FormattedNumberInput';
import { toast } from 'sonner';
import styles from '../styles/noir.module.css';

const MP_STYLES = `
  @keyframes mp-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .mp-fade-in { animation: mp-fade-in 0.4s ease-out both; }
  .mp-corner::before, .mp-corner::after {
    content: ''; position: absolute; width: 12px; height: 12px; border-color: rgba(var(--noir-primary-rgb), 0.2); pointer-events: none;
  }
  .mp-corner::before { top: 4px; left: 4px; border-top: 1px solid; border-left: 1px solid; }
  .mp-corner::after { bottom: 4px; right: 4px; border-bottom: 1px solid; border-right: 1px solid; }
  .mp-card { transition: all 0.3s ease; }
  .mp-card:hover { transform: translateY(-2px); box-shadow: 0 4px 16px rgba(0,0,0,0.3), 0 0 0 1px rgba(var(--noir-primary-rgb), 0.1); }
  .mp-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.15; }
`;

function formatMoney(n) {
  const num = Number(n ?? 0);
  if (Number.isNaN(num)) return '$0';
  return `$${Math.trunc(num).toLocaleString()}`;
}

const CASINO_NAMES = { dice: 'Dice', roulette: 'Roulette', blackjack: 'Blackjack', horseracing: 'Horse Racing' };
const CASINO_PATHS = { dice: '/casino/dice', roulette: '/casino/roulette', blackjack: '/casino/blackjack', horseracing: '/casino/horseracing' };

export default function MyProperties() {
  const [data, setData] = useState({ casino: null, property: null });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [casinoMaxBet, setCasinoMaxBet] = useState('');
  const [casinoBuyBack, setCasinoBuyBack] = useState('');
  const [casinoTransferUsername, setCasinoTransferUsername] = useState('');
  const [casinoSellPoints, setCasinoSellPoints] = useState('');
  const [airportPrice, setAirportPrice] = useState('');
  const [airportTransferUsername, setAirportTransferUsername] = useState('');
  const [airportSellPoints, setAirportSellPoints] = useState('');
  const [bulletPrice, setBulletPrice] = useState('');

  const fetchMyProperties = useCallback(async () => {
    try {
      const [res, bulletListRes] = await Promise.all([
        api.get('/my-properties'),
        api.get('/bullet-factory/list').catch(() => ({ data: { factories: [] } })),
      ]);
      const props = res.data;
      const casino = props?.casino ?? null;
      const property = props?.property ?? null;
      setData({ casino, property });
      if (casino?.max_bet != null) setCasinoMaxBet(String(casino.max_bet));
      if (casino?.buy_back_reward != null) setCasinoBuyBack(String(casino.buy_back_reward));
      if (property?.type === 'airport' && property?.price_per_travel != null)
        setAirportPrice(String(property.price_per_travel));
      if (property?.type === 'bullet_factory') {
        const list = bulletListRes.data?.factories ?? [];
        const f = list.find((x) => x.state === property.state);
        if (f?.price_per_bullet != null) setBulletPrice(String(f.price_per_bullet));
      }
    } catch {
      toast.error('Failed to load properties');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchMyProperties(); }, [fetchMyProperties]);

  useEffect(() => {
    const onRefresh = () => fetchMyProperties();
    window.addEventListener('app:refresh-user', onRefresh);
    return () => window.removeEventListener('app:refresh-user', onRefresh);
  }, [fetchMyProperties]);

  const handleCasinoSetMaxBet = async () => {
    const c = data.casino;
    if (!c || saving) return;
    const val = parseInt(String(casinoMaxBet).replace(/\D/g, ''), 10);
    if (!val || val < 1_000_000) { toast.error('Min $1,000,000'); return; }
    setSaving(true);
    try {
      await api.post(`/casino/${c.type}/set-max-bet`, { city: c.city, max_bet: val });
      toast.success('Max bet updated');
      fetchMyProperties();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    } finally {
      setSaving(false);
    }
  };

  const handleCasinoSetBuyBack = async () => {
    const c = data.casino;
    if (!c || saving || (c.type !== 'dice' && c.type !== 'blackjack')) return;
    const amount = parseInt(String(casinoBuyBack).replace(/\D/g, ''), 10);
    if (Number.isNaN(amount) || amount < 0) { toast.error('Enter 0 or more points'); return; }
    setSaving(true);
    try {
      await api.post(`/casino/${c.type}/set-buy-back-reward`, (c.type === 'dice' || c.type === 'blackjack') ? { city: c.city, amount } : { amount });
      toast.success('Buy-back reward updated');
      fetchMyProperties();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    } finally {
      setSaving(false);
    }
  };

  const handleCasinoTransfer = async () => {
    const c = data.casino;
    if (!c || saving) return;
    const username = (casinoTransferUsername || '').trim();
    if (!username) { toast.error('Enter a username'); return; }
    setSaving(true);
    try {
      await api.post(`/casino/${c.type}/send-to-user`, { city: c.city, target_username: username });
      toast.success('Casino transferred');
      setCasinoTransferUsername('');
      fetchMyProperties();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    } finally {
      setSaving(false);
    }
  };

  const handleCasinoSell = async () => {
    const c = data.casino;
    if (!c || saving) return;
    const pts = parseInt(String(casinoSellPoints).replace(/\D/g, ''), 10);
    if (Number.isNaN(pts) || pts < 0) { toast.error('Enter 0 or more points'); return; }
    setSaving(true);
    try {
      await api.post(`/casino/${c.type}/sell-on-trade`, { city: c.city, points: pts });
      toast.success('Casino listed on Quick Trade');
      setCasinoSellPoints('');
      fetchMyProperties();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    } finally {
      setSaving(false);
    }
  };

  const handleCasinoRelinquish = async () => {
    const c = data.casino;
    if (!c || saving || !window.confirm('Give up ownership of this casino?')) return;
    setSaving(true);
    try {
      await api.post(`/casino/${c.type}/relinquish`, { city: c.city });
      toast.success('Relinquished');
      fetchMyProperties();
      setCasinoMaxBet('');
      setCasinoBuyBack('');
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    } finally {
      setSaving(false);
    }
  };

  const handleAirportSetPrice = async () => {
    const p = data.property;
    if (!p || p.type !== 'airport' || saving) return;
    const val = parseInt(String(airportPrice).replace(/\D/g, ''), 10);
    if (Number.isNaN(val) || val < 10 || val > 30) { toast.error('Price 10–30 points'); return; }
    setSaving(true);
    try {
      await api.post('/airports/set-price', { state: p.state, slot: p.slot ?? 1, price_per_travel: val });
      toast.success('Airport price updated');
      fetchMyProperties();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    } finally {
      setSaving(false);
    }
  };

  const handleAirportTransfer = async () => {
    const p = data.property;
    if (!p || p.type !== 'airport' || saving) return;
    const username = (airportTransferUsername || '').trim();
    if (!username) { toast.error('Enter a username'); return; }
    setSaving(true);
    try {
      await api.post('/airports/transfer', { state: p.state, slot: p.slot ?? 1, target_username: username });
      toast.success('Airport transferred');
      setAirportTransferUsername('');
      fetchMyProperties();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    } finally {
      setSaving(false);
    }
  };

  const handleAirportSell = async () => {
    const p = data.property;
    if (!p || p.type !== 'airport' || saving) return;
    const pts = parseInt(String(airportSellPoints).replace(/\D/g, ''), 10);
    if (Number.isNaN(pts) || pts < 0) { toast.error('Enter 0 or more points'); return; }
    setSaving(true);
    try {
      await api.post('/airports/sell-on-trade', { state: p.state, slot: p.slot ?? 1, points: pts });
      toast.success('Airport listed on Quick Trade');
      setAirportSellPoints('');
      fetchMyProperties();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    } finally {
      setSaving(false);
    }
  };

  const handleBulletSetPrice = async () => {
    if (!data.property || data.property.type !== 'bullet_factory' || saving) return;
    const val = parseInt(String(bulletPrice).replace(/\D/g, ''), 10);
    if (Number.isNaN(val) || val < 1) { toast.error('Enter valid price'); return; }
    setSaving(true);
    try {
      await api.post('/bullet-factory/set-price', { price_per_bullet: val, state: data.property.state });
      toast.success('Price updated');
      fetchMyProperties();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    } finally {
      setSaving(false);
    }
  };

  const handleBulletCollect = async () => {
    if (!data.property || data.property.type !== 'bullet_factory' || saving) return;
    setSaving(true);
    try {
      await api.post('/bullet-factory/collect', { state: data.property.state });
      toast.success('Bullets collected');
      fetchMyProperties();
      window.dispatchEvent(new CustomEvent('app:refresh-user'));
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className={`space-y-4 ${styles.pageContent}`}>
        <style>{MP_STYLES}</style>
        <div className="flex flex-col items-center justify-center min-h-[40vh] gap-3">
          <Building2 size={28} className="text-primary/40 animate-pulse" />
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-primary text-[10px] font-heading uppercase tracking-[0.3em]">Loading...</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${styles.pageContent}`} data-testid="my-properties-page">
      <style>{MP_STYLES}</style>

      <div className="relative mp-fade-in">
        <p className="text-[9px] text-primary/40 font-heading uppercase tracking-[0.3em] mb-1">Your Holdings</p>
        <p className="text-[10px] text-zinc-500 font-heading italic">One casino and one property. Dice + Airport, Blackjack + Bullet Factory, or Roulette + Armory.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Casino slot */}
        <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mp-card mp-corner mp-fade-in`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between">
            <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">🎰 Casino</span>
          </div>
          <div className="p-3">
            {data.casino ? (
              <>
                <div className="flex items-center gap-2 mb-2">
                  {data.casino.type === 'dice' && <Dice5 size={18} className="text-primary" />}
                  {data.casino.type === 'roulette' && <CircleDot size={18} className="text-primary" />}
                  {data.casino.type === 'blackjack' && <Spade size={18} className="text-primary" />}
                  {data.casino.type === 'horseracing' && <Trophy size={18} className="text-primary" />}
                  <span className="font-heading font-bold text-foreground">{CASINO_NAMES[data.casino.type] || data.casino.type}</span>
                  <span className="text-mutedForeground text-sm">· {data.casino.city}</span>
                </div>
                <p className="text-[11px] text-mutedForeground mb-1">Max bet: {formatMoney(data.casino.max_bet)}</p>
                <p className="text-[11px] mb-2">
                  <span style={{ color: '#303030' }} className="font-heading">Profit: </span>
                  <span className={`font-heading font-bold ${(data.casino.profit ?? 0) >= 0 ? 'text-emerald-500' : 'text-red-400'}`}>
                    {(data.casino.profit ?? 0) >= 0 ? '' : '-'}{formatMoney(Math.abs(data.casino.profit ?? 0))}
                  </span>
                </p>
                <div className="flex flex-wrap gap-2 items-center mb-2">
                  <span className="text-[11px] text-mutedForeground w-16 shrink-0">Max bet</span>
                  <FormattedNumberInput
                    value={casinoMaxBet}
                    onChange={setCasinoMaxBet}
                    placeholder="e.g. 500,000,000"
                    className="flex-1 min-w-24 px-2 py-1 bg-zinc-900 border border-zinc-700 rounded text-sm"
                  />
                  <button type="button" onClick={handleCasinoSetMaxBet} disabled={saving} className="px-2 py-1 rounded bg-primary/20 border border-primary/50 text-primary text-xs font-heading uppercase disabled:opacity-50">
                    {saving ? '...' : 'Set'}
                  </button>
                </div>
                {(data.casino.type === 'dice' || data.casino.type === 'blackjack') && (
                  <div className="flex flex-wrap gap-2 items-center mb-2">
                    <span className="text-[11px] text-mutedForeground w-16 shrink-0">Buy-back (pts)</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={casinoBuyBack}
                      onChange={(e) => setCasinoBuyBack(e.target.value)}
                      placeholder="0"
                      className="flex-1 min-w-20 px-2 py-1 bg-zinc-900 border border-zinc-700 rounded text-sm"
                    />
                    <button type="button" onClick={handleCasinoSetBuyBack} disabled={saving} className="px-2 py-1 rounded bg-primary/20 border border-primary/50 text-primary text-xs font-heading uppercase disabled:opacity-50">
                      {saving ? '...' : 'Set'}
                    </button>
                  </div>
                )}
                <div className="flex flex-wrap gap-2 items-center mb-2">
                  <span className="text-[11px] text-mutedForeground w-16 shrink-0">Transfer</span>
                  <input
                    type="text"
                    value={casinoTransferUsername}
                    onChange={(e) => setCasinoTransferUsername(e.target.value)}
                    placeholder="Username"
                    className="flex-1 min-w-24 px-2 py-1 bg-zinc-900 border border-zinc-700 rounded text-sm"
                  />
                  <button type="button" onClick={handleCasinoTransfer} disabled={saving} className="px-2 py-1 rounded bg-primary/20 border border-primary/50 text-primary text-xs font-heading uppercase disabled:opacity-50">
                    {saving ? '...' : 'Send'}
                  </button>
                </div>
                <div className="flex flex-wrap gap-2 items-center mb-2">
                  <span className="text-[11px] text-mutedForeground w-16 shrink-0">Sell (pts)</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={casinoSellPoints}
                    onChange={(e) => setCasinoSellPoints(e.target.value)}
                    placeholder="Points"
                    className="flex-1 min-w-20 px-2 py-1 bg-zinc-900 border border-zinc-700 rounded text-sm"
                  />
                  <button type="button" onClick={handleCasinoSell} disabled={saving} className="px-2 py-1 rounded bg-primary/20 border border-primary/50 text-primary text-xs font-heading uppercase disabled:opacity-50">
                    {saving ? '...' : 'List'}
                  </button>
                </div>
                <div className="flex gap-2 flex-wrap pt-1 border-t border-zinc-700/30 mt-2">
                  <Link to={CASINO_PATHS[data.casino.type] || '/casino'} className="inline-flex items-center gap-1 px-2 py-1 rounded border border-primary/50 text-primary text-xs font-heading hover:bg-primary/10">
                    <LinkIcon size={12} /> Open table
                  </Link>
                  <button type="button" onClick={handleCasinoRelinquish} disabled={saving} className="px-2 py-1 rounded bg-red-500/20 border border-red-500/50 text-red-400 text-xs font-heading hover:bg-red-500/30 disabled:opacity-50">
                    Relinquish
                  </button>
                </div>
                <div className="mp-art-line text-primary mx-3 mt-3" />
              </>
            ) : (
              <p className="text-sm text-mutedForeground">
                None. Claim one from <Link to="/states" className="text-primary underline">States</Link> or <Link to="/casino" className="text-primary underline">Casino</Link> (Dice, Blackjack, Roulette, or Horse Racing).
              </p>
            )}
          </div>
        </div>

        {/* Property slot */}
        <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mp-card mp-corner mp-fade-in`} style={{ animationDelay: '0.05s' }}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between">
            <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">🏭 Property</span>
          </div>
          <div className="p-3">
            {data.property?.type === 'airport' ? (
              <>
                <div className="flex items-center gap-2 mb-2">
                  <Plane size={18} className="text-primary" />
                  <span className="font-heading font-bold text-foreground">Airport</span>
                  <span className="text-mutedForeground text-sm">· {data.property.state}</span>
                </div>
                <p className="text-[11px] text-mutedForeground mb-1">Price per travel: {data.property.price_per_travel ?? 10} pts</p>
                <p className="text-[11px] mb-2">
                  <span style={{ color: '#303030' }} className="font-heading">Profit: </span>
                  <span className={`font-heading font-bold ${(data.property.total_earnings ?? 0) >= 0 ? 'text-emerald-500' : 'text-red-400'}`}>
                    {(data.property.total_earnings ?? 0).toLocaleString()} pts
                  </span>
                </p>
                <div className="flex flex-wrap gap-2 items-center mb-2">
                  <span className="text-[11px] text-mutedForeground w-16 shrink-0">Set price</span>
                  <input
                    type="number"
                    min={10}
                    max={30}
                    value={airportPrice}
                    onChange={(e) => setAirportPrice(e.target.value)}
                    placeholder="10–30 pts"
                    className="flex-1 min-w-24 px-2 py-1 bg-zinc-900 border border-zinc-700 rounded text-sm"
                  />
                  <button type="button" onClick={handleAirportSetPrice} disabled={saving} className="px-2 py-1 rounded bg-primary/20 border border-primary/50 text-primary text-xs font-heading uppercase disabled:opacity-50">
                    {saving ? '...' : 'Set'}
                  </button>
                </div>
                <div className="flex flex-wrap gap-2 items-center mb-2">
                  <span className="text-[11px] text-mutedForeground w-16 shrink-0">Transfer</span>
                  <input
                    type="text"
                    value={airportTransferUsername}
                    onChange={(e) => setAirportTransferUsername(e.target.value)}
                    placeholder="Username"
                    className="flex-1 min-w-24 px-2 py-1 bg-zinc-900 border border-zinc-700 rounded text-sm"
                  />
                  <button type="button" onClick={handleAirportTransfer} disabled={saving} className="px-2 py-1 rounded bg-primary/20 border border-primary/50 text-primary text-xs font-heading uppercase disabled:opacity-50">
                    {saving ? '...' : 'Send'}
                  </button>
                </div>
                <div className="flex flex-wrap gap-2 items-center mb-2">
                  <span className="text-[11px] text-mutedForeground w-16 shrink-0">Sell (pts)</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={airportSellPoints}
                    onChange={(e) => setAirportSellPoints(e.target.value)}
                    placeholder="Points"
                    className="flex-1 min-w-20 px-2 py-1 bg-zinc-900 border border-zinc-700 rounded text-sm"
                  />
                  <button type="button" onClick={handleAirportSell} disabled={saving} className="px-2 py-1 rounded bg-primary/20 border border-primary/50 text-primary text-xs font-heading uppercase disabled:opacity-50">
                    {saving ? '...' : 'List'}
                  </button>
                </div>
                <div className="pt-1 border-t border-zinc-700/30 mt-2">
                  <Link to="/travel" className="inline-flex items-center gap-1 px-2 py-1 rounded border border-primary/50 text-primary text-xs font-heading hover:bg-primary/10">
                    <LinkIcon size={12} /> Travel
                  </Link>
                </div>
                <div className="mp-art-line text-primary mx-3 mt-3" />
              </>
            ) : data.property?.type === 'bullet_factory' ? (
              <>
                <div className="flex items-center gap-2 mb-2">
                  <Factory size={18} className="text-primary" />
                  <span className="font-heading font-bold text-foreground">Bullet Factory</span>
                  <span className="text-mutedForeground text-sm">· {data.property.state}</span>
                </div>
                <p className="text-[11px] text-mutedForeground mb-2">Set price per bullet and collect from the factory.</p>
                <div className="flex flex-wrap gap-2 items-center mb-2">
                  <input
                    type="text"
                    value={bulletPrice}
                    onChange={(e) => setBulletPrice(e.target.value)}
                    placeholder="Price per bullet $"
                    className="w-28 px-2 py-1 bg-zinc-900 border border-zinc-700 rounded text-sm"
                  />
                  <button type="button" onClick={handleBulletSetPrice} disabled={saving} className="px-2 py-1 rounded bg-primary/20 border border-primary/50 text-primary text-xs font-heading uppercase disabled:opacity-50">
                    {saving ? '...' : 'Set price'}
                  </button>
                  <button type="button" onClick={handleBulletCollect} disabled={saving} className="px-2 py-1 rounded bg-primary/20 border border-primary/50 text-primary text-xs font-heading uppercase disabled:opacity-50">
                    {saving ? '...' : 'Collect'}
                  </button>
                </div>
                <Link to="/armour-weapons" className="inline-flex items-center gap-1 px-2 py-1 rounded border border-primary/50 text-primary text-xs font-heading hover:bg-primary/10">
                  <LinkIcon size={12} /> Armour & Weapons (Bullet Factory)
                </Link>
                <div className="mp-art-line text-primary mx-3 mt-3" />
              </>
            ) : data.property?.type === 'armory' ? (
              <>
                <div className="flex items-center gap-2 mb-2">
                  <Shield size={18} className="text-primary" />
                  <span className="font-heading font-bold text-foreground">Armory</span>
                  {data.property.state && <span className="text-mutedForeground text-sm">· {data.property.state}</span>}
                </div>
                <p className="text-[11px] text-mutedForeground">Manage in Armory page (coming soon).</p>
                <div className="mp-art-line text-primary mx-3 mt-3" />
              </>
            ) : (
              <p className="text-sm text-mutedForeground">
                None. Claim an <Link to="/states" className="text-primary underline">Airport</Link>, <Link to="/armour-weapons" className="text-primary underline">Bullet Factory</Link>, or Armory from States (Armory coming soon).
              </p>
            )}
          </div>
        </div>
      </div>

      <div className={`relative ${styles.panel} rounded-lg border border-primary/20 mp-fade-in`} style={{ animationDelay: '0.08s' }}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20">
          <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">Rule</span>
        </div>
        <div className="p-3">
          <p className="text-[11px] text-mutedForeground">
            <strong className="text-foreground">Rule:</strong> You may own at most <strong>1 casino</strong> (one of: Dice, Blackjack, Roulette, Horse Racing) and <strong>1 property</strong> (one of: Airport, Bullet Factory, Armory). Not two casinos or two properties.
          </p>
        </div>
        <div className="mp-art-line text-primary mx-3" />
      </div>
    </div>
  );
}
