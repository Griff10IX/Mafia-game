import { useState, useEffect, useCallback } from 'react';
import { Building2, Dice5, CircleDot, Spade, Trophy, Plane, Factory, Link as LinkIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import api, { refreshUser } from '../../utils/api';
import { removeCasinoBuyBack } from '../../utils/removeCasinoBuyBack';
import { FormattedNumberInput } from '../../components/FormattedNumberInput';
import { toast } from 'sonner';
import styles from '../../styles/noir.module.css';

const MP_STYLES = `
  @keyframes mp-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .mp-fade-in { animation: mp-fade-in 0.4s ease-out both; }
  .mp-card { transition: all 0.3s ease; }
  .mp-card:hover { transform: translateY(-2px); box-shadow: 0 4px 16px rgba(0,0,0,0.3), 0 0 0 1px rgba(var(--noir-primary-rgb), 0.1); }
  .mp-art-line { background: repeating-linear-gradient(90deg, transparent, transparent 4px, currentColor 4px, currentColor 8px, transparent 8px, transparent 16px); height: 1px; opacity: 0.15; }
`;

function formatMoney(n) {
  const num = Number(n ?? 0);
  if (Number.isNaN(num)) return '$0';
  return `$${Math.trunc(num).toLocaleString()}`;
}

const CASINO_NAMES = { dice: 'Dice', roulette: 'Roulette', blackjack: 'Blackjack', horseracing: 'Horse Racing', videopoker: 'Video Poker', slots: 'Slots' };
const CASINO_PATHS = { dice: '/casino/dice', roulette: '/casino/roulette', blackjack: '/casino/blackjack', horseracing: '/casino/horseracing', videopoker: '/casino/videopoker', slots: '/casino/slots' };
/** Casino types that support buy-back points (My Properties + game pages). */
const CASINO_TYPES_WITH_BUY_BACK = ['dice', 'blackjack', 'roulette', 'horseracing', 'videopoker', 'slots'];
const MY_PROPERTIES_CACHE_KEY = 'my_properties_bootstrap_v1';
const MY_PROPERTIES_CACHE_MAX_AGE_MS = 30_000;
const EMPTY_MY_PROPERTIES_DATA = { casinos: [], airport: null, armoury: null, points: 0 };

const VIDEO_POKER_ODDS_OPTIONS = [
  { id: 'tight', label: 'Tight (house)' },
  { id: 'normal', label: 'Normal' },
  { id: 'increased', label: 'Increased' },
  { id: 'enhanced', label: 'Enhanced' },
];

function normalizeVideoPokerOddsPreset(raw) {
  const s = String(raw || 'tight').trim().toLowerCase();
  return VIDEO_POKER_ODDS_OPTIONS.some((o) => o.id === s) ? s : 'tight';
}

const VIDEO_POKER_PAY_TABLE_KEY_ORDER = [
  'royal_flush',
  'straight_flush',
  'four_of_a_kind',
  'full_house',
  'flush',
  'straight',
  'three_of_a_kind',
  'two_pair',
  'jacks_or_better',
];

const VIDEO_POKER_FALLBACK_HAND_NAMES = {
  royal_flush: 'Royal Flush',
  straight_flush: 'Straight Flush',
  four_of_a_kind: 'Four of a Kind',
  full_house: 'Full House',
  flush: 'Flush',
  straight: 'Straight',
  three_of_a_kind: 'Three of a Kind',
  two_pair: 'Two Pair',
  jacks_or_better: 'Jacks or Better',
};

function formatVideoPokerMultiplier(m) {
  const n = Number(m);
  if (Number.isNaN(n)) return '—';
  const s = Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100).replace(/\.?0+$/, '');
  return `${s}x`;
}

function buildVideoPokerPayTableRows(config, presetId) {
  const presets = config?.pay_table_presets || {};
  const pid = presetId || 'tight';
  const t = presets[pid] || {};
  const names = config?.hand_names || VIDEO_POKER_FALLBACK_HAND_NAMES;
  return VIDEO_POKER_PAY_TABLE_KEY_ORDER.map((key) => ({
    key,
    name: names[key] || key,
    multiplier: t[key] ?? 0,
  }));
}

function normalizeMyPropertiesPayload(props) {
  const casinos = Array.isArray(props?.casinos) && props.casinos.length
    ? props.casinos
    : (props?.casino ? [props.casino] : []);
  const airport = props?.airport ?? (props?.property?.type === 'airport' ? props.property : null);
  const armoury = props?.armoury ?? (props?.property?.type === 'bullet_factory' ? props.property : null);
  const points = Number(props?.points ?? 0) || 0;
  return {
    data: { casinos, airport, armoury, points },
    armouryDetail: props?.armoury_detail || null,
  };
}

function readCachedMyProperties() {
  try {
    const raw = sessionStorage.getItem(MY_PROPERTIES_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.savedAt || Date.now() - parsed.savedAt > MY_PROPERTIES_CACHE_MAX_AGE_MS) return null;
    return normalizeMyPropertiesPayload(parsed.payload || {});
  } catch (_) {
    return null;
  }
}

function writeCachedMyProperties(payload) {
  try {
    sessionStorage.setItem(MY_PROPERTIES_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), payload }));
  } catch (_) {}
}

function casinoResetProfitPayload(casino) {
  if (!casino) return null;
  if (casino.type === 'slots') return { state: casino.city };
  return { city: casino.city };
}

function CasinoBlock({ casino, points, onRefresh, videoPokerConfig }) {
  const [saving, setSaving] = useState(false);
  const [casinoMaxBet, setCasinoMaxBet] = useState('');
  const [casinoBuyBack, setCasinoBuyBack] = useState('');
  const [casinoTransferUsername, setCasinoTransferUsername] = useState('');
  const [casinoSellPoints, setCasinoSellPoints] = useState('');

  useEffect(() => {
    if (casino?.max_bet != null) setCasinoMaxBet(String(casino.max_bet));
    else setCasinoMaxBet('');
    if (casino?.buy_back_reward != null) setCasinoBuyBack(String(casino.buy_back_reward));
    else setCasinoBuyBack('');
    setCasinoTransferUsername('');
    setCasinoSellPoints('');
  }, [casino.type, casino.city, casino.max_bet, casino.buy_back_reward]);

  const handleVideoPokerSetOdds = async (preset) => {
    if (!casino || casino.type !== 'videopoker' || saving) return;
    const next = normalizeVideoPokerOddsPreset(preset);
    if (next === normalizeVideoPokerOddsPreset(casino.odds_preset)) return;
    setSaving(true);
    try {
      await api.post('/casino/videopoker/set-odds-preset', { city: casino.city, odds_preset: next });
      toast.success('Pay table updated');
      onRefresh();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    } finally {
      setSaving(false);
    }
  };

  const handleCasinoSetMaxBet = async () => {
    if (!casino || saving) return;
    const val = parseInt(String(casinoMaxBet).replace(/\D/g, ''), 10);
    if (!val || val < 50_000) { toast.error('Min $50,000'); return; }
    setSaving(true);
    try {
      await api.post(`/casino/${casino.type}/set-max-bet`, { city: casino.city, max_bet: val });
      toast.success('Max bet updated');
      onRefresh();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    } finally {
      setSaving(false);
    }
  };

  const handleCasinoSetBuyBack = async () => {
    if (!casino || saving || !CASINO_TYPES_WITH_BUY_BACK.includes(casino.type)) return;
    const amount = parseInt(String(casinoBuyBack).replace(/\D/g, ''), 10);
    if (Number.isNaN(amount) || amount < 0) { toast.error('Enter 0 or more points'); return; }
    const bal = Number(points ?? 0) || 0;
    if (amount > bal) {
      toast.error(`Buy-back cannot exceed your points balance (${bal.toLocaleString()}).`);
      return;
    }
    const payload = casino.type === 'slots' ? { state: casino.city, amount } : { city: casino.city, amount };
    setSaving(true);
    try {
      await api.post(`/casino/${casino.type}/set-buy-back-reward`, payload);
      toast.success('Buy-back reward updated');
      onRefresh();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    } finally {
      setSaving(false);
    }
  };

  const handleCasinoRemoveBuyBack = async () => {
    if (!casino || saving || !CASINO_TYPES_WITH_BUY_BACK.includes(casino.type)) return;
    if (Number(casino.buy_back_reward ?? 0) <= 0) return;
    setSaving(true);
    try {
      await removeCasinoBuyBack(casino.type, casino.type === 'slots' ? { state: casino.city } : { city: casino.city });
      toast.success('Buy-back removed. Held points were returned to your balance.');
      setCasinoBuyBack('0');
      onRefresh();
      refreshUser();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    } finally {
      setSaving(false);
    }
  };

  const handleCasinoTransfer = async () => {
    if (!casino || saving) return;
    const username = (casinoTransferUsername || '').trim();
    if (!username) { toast.error('Enter a username'); return; }
    setSaving(true);
    try {
      await api.post(`/casino/${casino.type}/send-to-user`, { city: casino.city, target_username: username });
      toast.success('Casino transferred');
      setCasinoTransferUsername('');
      onRefresh();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    } finally {
      setSaving(false);
    }
  };

  const handleCasinoSell = async () => {
    if (!casino || saving) return;
    const pts = parseInt(String(casinoSellPoints).replace(/,/g, '').replace(/\D/g, ''), 10);
    if (Number.isNaN(pts) || pts < 0) { toast.error('Enter 0 or more points'); return; }
    setSaving(true);
    try {
      await api.post(`/casino/${casino.type}/sell-on-trade`, { city: casino.city, points: pts });
      toast.success('Casino listed on Quick Trade');
      setCasinoSellPoints('');
      onRefresh();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    } finally {
      setSaving(false);
    }
  };

  const handleCasinoRelinquish = async () => {
    if (!casino || saving || !window.confirm('Give up ownership of this casino?')) return;
    setSaving(true);
    try {
      await api.post(`/casino/${casino.type}/relinquish`, { city: casino.city });
      toast.success('Relinquished');
      onRefresh();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    } finally {
      setSaving(false);
    }
  };

  const handleCasinoResetProfit = async () => {
    if (!casino || saving) return;
    if (!window.confirm('Reset casino profit to zero?')) return;
    const payload = casinoResetProfitPayload(casino);
    if (!payload) return;
    setSaving(true);
    try {
      await api.post(`/casino/${casino.type}/reset-profit`, payload);
      toast.success('Profit reset to zero');
      onRefresh();
      window.dispatchEvent(new CustomEvent('app:refresh-user'));
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border-b border-zinc-700/30 pb-4 mb-4 last:border-0 last:pb-0 last:mb-0">
      <div className="flex items-center gap-2 mb-2">
        {casino.type === 'dice' && <Dice5 size={18} className="text-primary" />}
        {casino.type === 'roulette' && <CircleDot size={18} className="text-primary" />}
        {casino.type === 'blackjack' && <Spade size={18} className="text-primary" />}
        {casino.type === 'horseracing' && <Trophy size={18} className="text-primary" />}
        <span className="font-heading font-bold text-foreground">{CASINO_NAMES[casino.type] || casino.type}</span>
        <span className="text-mutedForeground text-sm">· {casino.city}</span>
      </div>
      <p className="text-[11px] text-mutedForeground mb-1">Max bet: {formatMoney(casino.max_bet)}</p>
      <p className="text-[11px] mb-2">
        <span style={{ color: '#303030' }} className="font-heading">Profit: </span>
        <span className={`font-heading font-bold ${(casino.profit ?? 0) >= 0 ? 'text-emerald-500' : 'text-red-400'}`}>
          {(casino.profit ?? 0) >= 0 ? '' : '-'}{formatMoney(Math.abs(casino.profit ?? 0))}
        </span>
      </p>
      {casino.type === 'videopoker' && (() => {
        const selectedPreset = normalizeVideoPokerOddsPreset(casino.odds_preset);
        const selectedLabel = (
          VIDEO_POKER_ODDS_OPTIONS.find((o) => o.id === selectedPreset)?.label
          || selectedPreset
        );
        const payTableRows = videoPokerConfig
          ? buildVideoPokerPayTableRows(videoPokerConfig, selectedPreset)
          : null;
        return (
          <div className="mb-2">
            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-[11px] text-mutedForeground w-16 shrink-0">Pay table</span>
              <select
                value={selectedPreset}
                onChange={(e) => handleVideoPokerSetOdds(e.target.value)}
                disabled={saving}
                className="flex-1 min-w-[140px] px-2 py-1 bg-zinc-900 border border-zinc-700 rounded text-sm text-foreground"
              >
                {VIDEO_POKER_ODDS_OPTIONS.map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
            </div>
            <p className="text-[10px] text-zinc-500 mt-1 ml-[4.5rem]">Applies to new deals at your table.</p>
            <p className="text-[10px] text-amber-200/90 mt-1 ml-[4.5rem] leading-snug">
              <span className="font-heading font-bold">Owner bank:</span> Tight pays players less on big hands (safer for you).
              Increased and Enhanced raise payouts (more player-friendly, more risk to your cash stack).
            </p>
            {payTableRows && (
              <div className="mt-2 ml-[4.5rem] border border-zinc-800 rounded overflow-hidden">
                <div className="px-2 py-1 bg-primary/8 border-b border-primary/20">
                  <span className="text-[9px] font-heading font-bold text-primary uppercase tracking-wider">
                    Pay table — {selectedLabel}
                  </span>
                </div>
                <div className="divide-y divide-zinc-800/60">
                  {payTableRows.map((row) => (
                    <div key={row.key} className="flex items-center justify-between px-2 py-1 text-[11px]">
                      <span className="text-zinc-300 font-heading">{row.name}</span>
                      <span className="text-primary font-heading font-bold tabular-nums">
                        {formatVideoPokerMultiplier(row.multiplier)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })()}
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
      {CASINO_TYPES_WITH_BUY_BACK.includes(casino.type) && (
        <div className="mb-2">
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-[11px] text-mutedForeground w-16 shrink-0">Buy-back (pts)</span>
            <input
              type="text"
              inputMode="numeric"
              value={casinoBuyBack}
              onChange={(e) => setCasinoBuyBack(e.target.value)}
              placeholder="0"
              className="flex-1 min-w-20 px-2 py-1 bg-zinc-900 border border-zinc-700 rounded text-sm"
            />
            <button type="button" onClick={handleCasinoSetBuyBack} disabled={saving} className="px-2 py-1 rounded bg-primary/20 border border-primary/50 text-primary text-xs font-heading uppercase disabled:opacity-50 shrink-0">
              {saving ? '...' : 'Set'}
            </button>
            <button type="button" onClick={handleCasinoRemoveBuyBack} disabled={saving || Number(casino.buy_back_reward ?? 0) <= 0} className="px-2 py-1 rounded bg-zinc-800/80 border border-zinc-600 text-zinc-300 text-xs font-heading uppercase hover:bg-zinc-800 disabled:opacity-50 shrink-0" title="Return held points">
              Remove
            </button>
          </div>
          <p className="text-[10px] text-zinc-500 mt-1 ml-[4.5rem]">
            Your points: {(Number(points) || 0).toLocaleString()} — buy-back cannot exceed balance. Use Remove to clear buy-back and return held points.
          </p>
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
        <FormattedNumberInput
          value={casinoSellPoints}
          onChange={setCasinoSellPoints}
          placeholder="e.g. 50,000"
          className="flex-1 min-w-20 px-2 py-1 bg-zinc-900 border border-zinc-700 rounded text-sm"
        />
        <button type="button" onClick={handleCasinoSell} disabled={saving} className="px-2 py-1 rounded bg-primary/20 border border-primary/50 text-primary text-xs font-heading uppercase disabled:opacity-50">
          {saving ? '...' : 'List'}
        </button>
      </div>
      <div className="flex gap-2 flex-wrap pt-1 border-t border-zinc-700/30 mt-2">
        <Link to={CASINO_PATHS[casino.type] || '/casino'} className="inline-flex items-center gap-1 px-2 py-1 rounded border border-primary/50 text-primary text-xs font-heading hover:bg-primary/10">
          <LinkIcon size={12} /> Open table
        </Link>
        <button type="button" onClick={handleCasinoResetProfit} disabled={saving} className="px-2 py-1 rounded bg-zinc-800/60 border border-zinc-600/60 text-zinc-200 text-xs font-heading hover:bg-zinc-800 disabled:opacity-50">
          Reset profit
        </button>
        <button type="button" onClick={handleCasinoRelinquish} disabled={saving} className="px-2 py-1 rounded bg-red-500/20 border border-red-500/50 text-red-400 text-xs font-heading hover:bg-red-500/30 disabled:opacity-50">
          Relinquish
        </button>
      </div>
      <div className="mp-art-line text-primary mx-3 mt-3" />
    </div>
  );
}

export default function MyProperties() {
  const [cachedBootstrap] = useState(() => readCachedMyProperties());
  const [data, setData] = useState(cachedBootstrap?.data || EMPTY_MY_PROPERTIES_DATA);
  const [saving, setSaving] = useState(false);
  const [airportPrice, setAirportPrice] = useState(
    cachedBootstrap?.data?.airport?.price_per_travel != null ? String(cachedBootstrap.data.airport.price_per_travel) : ''
  );
  const [airportTransferUsername, setAirportTransferUsername] = useState('');
  const [airportSellPoints, setAirportSellPoints] = useState('');
  const [bulletPrice, setBulletPrice] = useState(
    cachedBootstrap?.data?.armoury?.price_per_bullet != null ? String(cachedBootstrap.data.armoury.price_per_bullet) : ''
  );
  const [armouryDetail, setArmouryDetail] = useState(cachedBootstrap?.armouryDetail || null);
  const [armourySellPoints, setArmourySellPoints] = useState('');
  const [armouryTransferUsername, setArmouryTransferUsername] = useState('');
  // Pay-table data for any owned Video Poker casinos. Static across cities, so a single fetch
  // covers every CasinoBlock. Stays null until needed (only fetched if the user owns a VP casino).
  const [videoPokerConfig, setVideoPokerConfig] = useState(null);

  const fetchMyProperties = useCallback(async () => {
    try {
      const res = await api.get('/my-properties');
      const props = res.data;
      const { data: nextData, armouryDetail: nextArmouryDetail } = normalizeMyPropertiesPayload(props);
      const { airport, armoury } = nextData;
      setData(nextData);
      if (airport?.price_per_travel != null) setAirportPrice(String(airport.price_per_travel));
      if (armoury?.state) {
        if (armoury.price_per_bullet != null) setBulletPrice(String(armoury.price_per_bullet));
        setArmouryDetail(nextArmouryDetail);
      } else {
        setArmouryDetail(null);
      }
      writeCachedMyProperties(props);
    } catch (error) {
      const detail = error.response?.data?.detail || error.message || 'Unknown error';
      toast.error(`Failed to load properties: ${detail}`);
      setData(EMPTY_MY_PROPERTIES_DATA);
    }
  }, []);

  useEffect(() => { fetchMyProperties(); }, [fetchMyProperties]);

  useEffect(() => {
    const onRefresh = () => fetchMyProperties();
    window.addEventListener('app:refresh-user', onRefresh);
    return () => window.removeEventListener('app:refresh-user', onRefresh);
  }, [fetchMyProperties]);

  // Lazy-fetch the static Video Poker pay tables only if the user actually owns a VP casino.
  // Pay tables don't change at runtime, so one fetch per page mount is enough.
  useEffect(() => {
    if (videoPokerConfig) return;
    const hasVideoPoker = Array.isArray(data?.casinos) && data.casinos.some((c) => c?.type === 'videopoker');
    if (!hasVideoPoker) return;
    let cancelled = false;
    api
      .get('/casino/videopoker/config')
      .then((res) => {
        if (!cancelled && res?.data) setVideoPokerConfig(res.data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [data?.casinos, videoPokerConfig]);

  const handleAirportSetPrice = async () => {
    const p = data.airport;
    if (!p || saving) return;
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
    const p = data.airport;
    if (!p || saving) return;
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
    const p = data.airport;
    if (!p || saving) return;
    const pts = parseInt(String(airportSellPoints).replace(/,/g, '').replace(/\D/g, ''), 10);
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
    if (!data.armoury || saving) return;
    const val = parseInt(String(bulletPrice).replace(/\D/g, ''), 10);
    if (Number.isNaN(val) || val < 1) { toast.error('Enter valid price'); return; }
    setSaving(true);
    try {
      await api.post('/bullet-factory/set-price', { price_per_bullet: val, state: data.armoury.state });
      toast.success('Price updated');
      fetchMyProperties();
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    } finally {
      setSaving(false);
    }
  };

  const handleBulletCollect = async () => {
    if (!data.armoury || saving) return;
    setSaving(true);
    try {
      const res = await api.post('/bullet-factory/collect', { state: data.armoury.state });
      toast.success(res.data?.message || 'Refreshed');
      fetchMyProperties();
      window.dispatchEvent(new CustomEvent('app:refresh-user'));
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    } finally {
      setSaving(false);
    }
  };

  const handleArmouryRelinquish = async () => {
    if (!data.armoury || saving) return;
    if (!window.confirm('Relinquish the armoury? It will become unclaimed.')) return;
    setSaving(true);
    try {
      await api.post('/bullet-factory/relinquish', { state: data.armoury.state });
      toast.success('Armoury relinquished');
      fetchMyProperties();
      window.dispatchEvent(new CustomEvent('app:refresh-user'));
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    } finally {
      setSaving(false);
    }
  };

  const handleArmourySell = async () => {
    const p = data.armoury;
    if (!p || saving) return;
    const pts = parseInt(String(armourySellPoints).replace(/,/g, '').replace(/\D/g, ''), 10);
    if (Number.isNaN(pts) || pts < 0) { toast.error('Enter 0 or more points'); return; }
    setSaving(true);
    try {
      await api.post('/bullet-factory/sell-on-trade', { state: p.state, points: pts });
      toast.success('Armoury listed on Quick Trade');
      setArmourySellPoints('');
      fetchMyProperties();
      window.dispatchEvent(new CustomEvent('app:refresh-user'));
    } catch (e) {
      const detail = e?.response?.data?.detail;
      const msg = Array.isArray(detail)
        ? (detail[0]?.msg || 'Failed')
        : (typeof detail === 'string' ? detail : 'Failed');
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleArmouryTransfer = async () => {
    const p = data.armoury;
    if (!p || saving) return;
    const username = (armouryTransferUsername || '').trim();
    if (!username) { toast.error('Enter a username'); return; }
    setSaving(true);
    try {
      await api.post('/bullet-factory/send-to-user', { state: p.state, target_username: username });
      toast.success('Armoury transferred');
      setArmouryTransferUsername('');
      fetchMyProperties();
      window.dispatchEvent(new CustomEvent('app:refresh-user'));
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`space-y-4 ${styles.pageContent} mobile-page-root`} data-testid="my-properties-page">
      <style>{MP_STYLES}</style>

      <div className="relative mp-fade-in">
        <p className="text-[9px] text-primary/40 font-heading uppercase tracking-[0.3em] mb-1">Your Holdings</p>
        <p className="text-[10px] text-zinc-500 font-heading italic">One casino. Up to one airport and one armoury (you may hold both). Casinos are separate from airport/armoury.</p>
        {data.casinos.length > 1 ? (
          <p className="text-[10px] text-amber-500/90 font-heading mt-1.5">
            Multiple casinos are linked to your account (this should not happen). Each one is listed below — transfer or relinquish until only one remains.
          </p>
        ) : null}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Casino slot */}
        <div className={`relative ${styles.panel} rounded-lg overflow-visible md:overflow-hidden border border-primary/20 mp-card mp-fade-in mobile-panel`}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between">
            <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">🎰 Casino</span>
          </div>
          <div className="p-3">
            {data.casinos.length ? (
              data.casinos.map((c) => (
                <CasinoBlock
                  key={`${c.type}-${c.city}`}
                  casino={c}
                  points={data.points}
                  onRefresh={fetchMyProperties}
                  videoPokerConfig={c.type === 'videopoker' ? videoPokerConfig : null}
                />
              ))
            ) : (
              <p className="text-sm text-mutedForeground">
                None. Claim one from <Link to="/states" className="text-primary underline">States</Link> or <Link to="/casino" className="text-primary underline">Casino</Link> (Dice, Blackjack, Roulette, or Horse Racing).
              </p>
            )}
          </div>
        </div>

        {/* Property slot */}
        <div className={`relative ${styles.panel} rounded-lg overflow-hidden border border-primary/20 mp-card mp-fade-in mobile-panel`} style={{ animationDelay: '0.05s' }}>
          <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
          <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20 flex items-center justify-between">
            <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">🏭 Airport &amp; armoury</span>
          </div>
          <div className="p-3">
            {!data.airport && !data.armoury ? (
              <p className="text-sm text-mutedForeground">
                None. Claim an <Link to="/states" className="text-primary underline">Airport</Link> or <Link to="/armour-weapons" className="text-primary underline">Armoury</Link> from States.
              </p>
            ) : null}
            {data.airport ? (
              <>
                <div className="flex items-center gap-2 mb-2">
                  <Plane size={18} className="text-primary" />
                  <span className="font-heading font-bold text-foreground">Airport</span>
                  <span className="text-mutedForeground text-sm">· {data.airport.state}</span>
                </div>
                <p className="text-[11px] text-mutedForeground mb-1">Price per travel: {data.airport.price_per_travel ?? 10} pts</p>
                <p className="text-[11px] mb-2">
                  <span style={{ color: '#303030' }} className="font-heading">Profit: </span>
                  <span className={`font-heading font-bold ${(data.airport.total_earnings ?? 0) >= 0 ? 'text-emerald-500' : 'text-red-400'}`}>
                    {(data.airport.total_earnings ?? 0).toLocaleString()} pts
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
                  <FormattedNumberInput
                    value={airportSellPoints}
                    onChange={setAirportSellPoints}
                    placeholder="e.g. 50,000"
                    className="flex-1 min-w-20 px-2 py-1 bg-zinc-900 border border-zinc-700 rounded text-sm"
                  />
                  <button type="button" onClick={handleAirportSell} disabled={saving} className="px-2 py-1 rounded bg-primary/20 border border-primary/50 text-primary text-xs font-heading uppercase disabled:opacity-50">
                    {saving ? '...' : 'List'}
                  </button>
                </div>
                <div className="pt-1 border-t border-zinc-700/30 mt-2">
                  <Link to="/game/travel" className="inline-flex items-center gap-1 px-2 py-1 rounded border border-primary/50 text-primary text-xs font-heading hover:bg-primary/10">
                    <LinkIcon size={12} /> Travel
                  </Link>
                </div>
                <div className="mp-art-line text-primary mx-3 mt-3" />
              </>
            ) : null}
            {data.armoury ? (
              <>
                {data.airport ? <div className="border-t border-zinc-700/40 my-4 pt-2" /> : null}
                <div className="flex items-center gap-2 mb-2">
                  <Factory size={18} className="text-primary" />
                  <span className="font-heading font-bold text-foreground">Armoury</span>
                  <span className="text-mutedForeground text-sm">· {data.armoury.state}</span>
                </div>
                <p className="text-[11px] text-mutedForeground mb-1">Set price per bullet and collect from the armoury.</p>
                {armouryDetail && (
                  <>
                    <p className="text-[11px] mb-1">
                      <span className="text-mutedForeground">Profit to collect: </span>
                      <span className="text-primary font-bold">
                        {formatMoney(armouryDetail.owner_pending_profit ?? 0)} and {Number(armouryDetail.owner_pending_profit_points ?? 0).toLocaleString()} pts
                      </span>
                    </p>
                    <p className="text-[11px] mb-2">
                      <span className="text-mutedForeground">Stock value (bullets × price): </span>
                      <span className="text-primary font-bold">
                        {formatMoney(Number(armouryDetail.accumulated_bullets ?? 0) * Number(armouryDetail.price_per_bullet ?? 0))}
                      </span>
                      <span className="text-mutedForeground"> ({Number(armouryDetail.accumulated_bullets ?? 0).toLocaleString()} bullets × {formatMoney(armouryDetail.price_per_bullet ?? 0)}/ea)</span>
                    </p>
                    <p className="text-[11px] text-mutedForeground mb-2">
                      Stock: Bullets {Number(armouryDetail.accumulated_bullets ?? 0).toLocaleString()}
                      {Object.entries(armouryDetail.armour_stock || {}).filter(([, q]) => Number(q || 0) > 0).length > 0 && (
                        <span> · Armour {Object.entries(armouryDetail.armour_stock).filter(([, q]) => Number(q || 0) > 0).map(([lv, q]) => `Lv.${lv}: ${Number(q)}`).join(', ')}</span>
                      )}
                      {(Object.values(armouryDetail.weapon_stock || {}).reduce((a, b) => a + Number(b || 0), 0) || 0) > 0 && (
                        <span> · Weapons {Object.values(armouryDetail.weapon_stock || {}).reduce((a, b) => a + Number(b || 0), 0)} units</span>
                      )}
                    </p>
                  </>
                )}
                <div className="flex flex-wrap gap-2 items-center mb-2">
                  <span className="text-[11px] text-mutedForeground w-16 shrink-0">Set price</span>
                  <input
                    type="text"
                    value={bulletPrice}
                    onChange={(e) => setBulletPrice(e.target.value)}
                    placeholder="Price per bullet $"
                    className="flex-1 min-w-24 px-2 py-1 bg-zinc-900 border border-zinc-700 rounded text-sm"
                  />
                  <button type="button" onClick={handleBulletSetPrice} disabled={saving} className="px-2 py-1 rounded bg-primary/20 border border-primary/50 text-primary text-xs font-heading uppercase disabled:opacity-50">
                    {saving ? '...' : 'Set'}
                  </button>
                </div>
                <div className="flex flex-wrap gap-2 items-center mb-2">
                  <span className="text-[11px] text-mutedForeground w-16 shrink-0">Collect</span>
                  <button type="button" onClick={handleBulletCollect} disabled={saving} className="px-2 py-1 rounded bg-primary/20 border border-primary/50 text-primary text-xs font-heading uppercase disabled:opacity-50">
                    {saving ? '...' : 'Collect'}
                  </button>
                </div>
                <div className="flex flex-wrap gap-2 items-center mb-2">
                  <span className="text-[11px] text-mutedForeground w-16 shrink-0">Transfer</span>
                  <input
                    type="text"
                    value={armouryTransferUsername}
                    onChange={(e) => setArmouryTransferUsername(e.target.value)}
                    placeholder="Username"
                    className="flex-1 min-w-24 px-2 py-1 bg-zinc-900 border border-zinc-700 rounded text-sm"
                  />
                  <button type="button" onClick={handleArmouryTransfer} disabled={saving} className="px-2 py-1 rounded bg-primary/20 border border-primary/50 text-primary text-xs font-heading uppercase disabled:opacity-50">
                    {saving ? '...' : 'Send'}
                  </button>
                </div>
                <div className="flex flex-wrap gap-2 items-center mb-2">
                  <span className="text-[11px] text-mutedForeground w-16 shrink-0">Sell (pts)</span>
                  <FormattedNumberInput
                    value={armourySellPoints}
                    onChange={setArmourySellPoints}
                    placeholder="e.g. 50,000"
                    className="flex-1 min-w-20 px-2 py-1 bg-zinc-900 border border-zinc-700 rounded text-sm"
                  />
                  <button type="button" onClick={handleArmourySell} disabled={saving} className="px-2 py-1 rounded bg-primary/20 border border-primary/50 text-primary text-xs font-heading uppercase disabled:opacity-50">
                    {saving ? '...' : 'List'}
                  </button>
                </div>
                <div className="flex gap-2 flex-wrap pt-1 border-t border-zinc-700/30 mt-2">
                  <Link to="/armour-weapons" className="inline-flex items-center gap-1 px-2 py-1 rounded border border-primary/50 text-primary text-xs font-heading hover:bg-primary/10">
                    <LinkIcon size={12} /> Armoury
                  </Link>
                  <button type="button" onClick={handleArmouryRelinquish} disabled={saving} className="px-2 py-1 rounded bg-red-500/20 border border-red-500/50 text-red-400 text-xs font-heading hover:bg-red-500/30 disabled:opacity-50">
                    Relinquish
                  </button>
                </div>
                <div className="mp-art-line text-primary mx-3 mt-3" />
              </>
            ) : null}
          </div>
        </div>
      </div>

      <div className={`relative ${styles.panel} rounded-lg border border-primary/20 mp-fade-in mobile-panel`} style={{ animationDelay: '0.08s' }}>
        <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="px-3 py-2.5 bg-primary/8 border-b border-primary/20">
          <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.15em]">Rule</span>
        </div>
        <div className="p-3">
          <p className="text-[11px] text-mutedForeground">
            <strong className="text-foreground">Rule:</strong> You may own at most <strong>1 casino</strong> (one of: Dice, Blackjack, Roulette, Horse Racing, etc.) and up to <strong>1 airport</strong> plus <strong>1 armoury</strong> (both allowed). Not two casinos, not two airports, and not two armouries.
          </p>
        </div>
        <div className="mp-art-line text-primary mx-3" />
      </div>
    </div>
  );
}
