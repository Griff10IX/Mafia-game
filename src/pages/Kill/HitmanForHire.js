import { useState, useEffect, useCallback } from 'react';
import { Crosshair, Coins, Skull, Ticket, Search, AlertTriangle, Shield, Target, Clock, Sparkles, Users, XCircle } from 'lucide-react';
import api, { refreshUser, getApiErrorMessage } from '../../utils/api';
import { toast } from 'sonner';
import styles from '../../styles/noir.module.css';

const HITMAN_STYLES = `
  @keyframes hm-fade-in {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .hm-fade-in { animation: hm-fade-in 0.45s ease-out both; }

  @keyframes hm-smoke {
    0% { transform: translateY(0) scaleX(1); opacity: 0.35; }
    100% { transform: translateY(-36px) scaleX(1.8); opacity: 0; }
  }
  .hm-smoke { animation: hm-smoke 3.5s ease-out infinite; }

  @keyframes hm-flicker {
    0%, 100% { opacity: 1; }
    48% { opacity: 0.88; }
    52% { opacity: 0.96; }
  }
  .hm-flicker { animation: hm-flicker 2.8s ease-in-out infinite; }

  @keyframes hm-stamp {
    0% { transform: scale(2.2) rotate(-18deg); opacity: 0; }
    70% { transform: scale(1.05) rotate(-12deg); opacity: 1; }
    100% { transform: scale(1) rotate(-12deg); opacity: 0.92; }
  }
  .hm-stamp { animation: hm-stamp 0.55s cubic-bezier(0.2, 0.8, 0.3, 1) forwards; }

  .hm-bullet {
    width: 7px; height: 7px; border-radius: 50%;
    background: radial-gradient(circle, #0a0a0a 35%, transparent 70%);
    box-shadow: inset 0 1px 2px rgba(0,0,0,0.85);
  }
`;

const fmtPts = (n) => `${Number(n || 0).toLocaleString()} pts`;
const fmtRespect = (n) => `${Number(n || 0).toLocaleString()} respect`;

export default function HitmanForHire() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState('');
  const [lookup, setLookup] = useState(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [hiringTier, setHiringTier] = useState(null);
  const [buyingProtection, setBuyingProtection] = useState(null);
  const [lastResult, setLastResult] = useState(null);

  const loadStatus = useCallback(async () => {
    try {
      const st = await api.get('/hitman/status');
      setStatus(st.data || null);
    } catch (e) {
      toast.error(getApiErrorMessage(e, 'Failed to load Hitman'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const available = !!status?.available;
  const staffPreview = !!status?.staff_preview;
  const freeTokens = status?.free_tokens ?? 0;
  const discount = status?.my_discount;
  const tiers = status?.tiers || [];
  const stats = status?.stats || { hires: 0, points_spent: 0, kills: 0 };
  const gameStats = status?.game_stats || {
    hires: 0,
    kills: 0,
    fails: 0,
    points_spent: 0,
    unique_hirers: 0,
    unique_victims: 0,
  };
  const protectionCost = status?.protection_cost ?? 3000;
  const protectionRespectCost = status?.protection_respect_cost ?? 5000;
  const protectionDays = status?.protection_days ?? 5;
  const protectionActive = !!status?.protection_active;
  const protectionUntil = status?.protection_until;
  const protectionRebuyCooldownUntil = status?.protection_rebuy_cooldown_until;
  const protectionOnRebuyCooldown = !!protectionRebuyCooldownUntil && !protectionActive;
  const protectionCanBuy = status?.protection_can_buy !== false && !protectionActive && !protectionOnRebuyCooldown;
  const protectionRebuyHours = status?.protection_rebuy_cooldown_hours ?? 2;

  const buyProtection = async (payWith = 'points') => {
    if (protectionActive) {
      toast.error('Anti-hitman protection is already active (cannot stack).');
      return;
    }
    if (protectionOnRebuyCooldown) {
      toast.error('Protection rebuy cooldown — try again later.');
      return;
    }
    const priceLabel = payWith === 'respect' ? fmtRespect(protectionRespectCost) : fmtPts(protectionCost);
    const ok = window.confirm(
      `Buy anti-hitman protection for ${priceLabel}? Lasts ${protectionDays} days. Cannot stack. After it ends there is a ${protectionRebuyHours}h rebuy cooldown.`
    );
    if (!ok) return;
    setBuyingProtection(payWith);
    try {
      const res = await api.post('/hitman/buy-protection', { pay_with: payWith });
      const d = res.data || {};
      toast.success(d.message || 'Protection active');
      setStatus((prev) =>
        prev
          ? {
              ...prev,
              points: d.points ?? prev.points,
              respect_points: d.respect_points ?? prev.respect_points,
              protection_active: d.protection_active ?? true,
              protection_until: d.protection_until ?? prev.protection_until,
              protection_can_buy: false,
              protection_rebuy_cooldown_until: null,
            }
          : prev
      );
      refreshUser();
      loadStatus();
    } catch (e) {
      toast.error(getApiErrorMessage(e, 'Could not buy protection'));
    } finally {
      setBuyingProtection(null);
    }
  };

  const doLookup = async () => {
    const u = username.trim();
    if (!u) {
      toast.error('Enter a username');
      return;
    }
    setLookingUp(true);
    setLookup(null);
    setLastResult(null);
    try {
      const res = await api.get('/hitman/lookup', { params: { username: u } });
      setLookup(res.data || null);
      if (res.data?.username) setUsername(res.data.username);
    } catch (e) {
      toast.error(getApiErrorMessage(e, 'Lookup failed'));
    } finally {
      setLookingUp(false);
    }
  };

  const priceForTier = (tier) => {
    if (freeTokens > 0) return { label: 'FREE TOKEN', cost: 0, free: true };
    if (discount && lookup?.username && discount.vs_username?.toLowerCase() === lookup.username.toLowerCase()) {
      return { label: fmtPts(tier.discount_cost), cost: tier.discount_cost, discount: true };
    }
    return { label: fmtPts(tier.cost), cost: tier.cost, free: false };
  };

  const hire = async (tierId) => {
    if (!lookup?.hireable) return;
    const tier = tiers.find((t) => t.id === tierId);
    if (!tier) return;
    const pricing = priceForTier(tier);
    const ok = window.confirm(
      pricing.free
        ? `Use 1 free hitman token for a ${tier.success_pct}% shot at ${lookup.username}'s visible robot bodyguard?`
        : `Pay ${pricing.label} for a ${tier.success_pct}% shot at ${lookup.username}'s visible robot bodyguard?`
    );
    if (!ok) return;
    setHiringTier(tierId);
    try {
      const res = await api.post('/hitman/hire', {
        target_username: lookup.username || username.trim(),
        tier: tierId,
      });
      const d = res.data || {};
      setLastResult(d);
      setStatus((prev) =>
        prev
          ? {
              ...prev,
              free_tokens: d.free_tokens ?? prev.free_tokens,
              stats: d.stats ?? prev.stats,
              points: d.points ?? prev.points,
            }
          : prev
      );
      if (d.success) {
        toast.success(d.message || 'Hit landed');
      } else {
        toast.error(d.message || 'Hit failed');
      }
      if (d.free_token_earned) toast.success('Free hitman token earned');
      refreshUser();
      // Refresh hireability after kill / cooldown
      const again = await api.get('/hitman/lookup', { params: { username: lookup.username || username.trim() } }).catch(() => null);
      if (again?.data) setLookup(again.data);
      loadStatus();
    } catch (e) {
      toast.error(getApiErrorMessage(e, 'Hire failed'));
    } finally {
      setHiringTier(null);
    }
  };

  if (loading) {
    return (
      <div className={`min-h-[40vh] px-3 sm:px-4 max-w-3xl mx-auto ${styles.pageContent} mobile-page-root`}>
        <p className="text-xs text-zinc-400 font-heading">Loading the contract desk…</p>
      </div>
    );
  }

  if (!available) {
    return (
      <div className={`min-h-[40vh] px-3 sm:px-4 max-w-3xl mx-auto space-y-3 ${styles.pageContent} mobile-page-root`}>
        <style>{HITMAN_STYLES}</style>
        <div className={`relative rounded-lg overflow-hidden ${styles.panel} mobile-panel hm-fade-in`}>
          <div className={`px-3 py-2 ${styles.panelHeader}`}>
            <h1 className="text-xs font-heading font-bold text-primary uppercase tracking-wider flex items-center gap-2">
              <Crosshair size={14} /> Hitman for Hire
            </h1>
          </div>
          <div className="p-4 space-y-2">
            <p className="text-[11px] font-heading text-zinc-300">Coming soon</p>
            <p className="text-[10px] text-zinc-500 font-heading leading-relaxed">
              The back-room contractors aren&apos;t taking public jobs yet. Check back when the street opens.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-[40vh] px-3 sm:px-4 max-w-3xl mx-auto space-y-3 sm:space-y-4 ${styles.pageContent} mobile-page-root`}>
      <style>{HITMAN_STYLES}</style>

      {/* Title */}
      <div className="relative hm-fade-in">
        <div className="flex items-center gap-2 border-b pb-2" style={{ borderBottomColor: 'var(--gm-border)' }}>
          <Crosshair size={20} className="shrink-0 hm-flicker" style={{ color: 'var(--gm-gold)' }} />
          <h1 className={`text-sm sm:text-base font-heading font-bold ${styles.gmTitle}`}>Hitman for Hire</h1>
        </div>
        <p className="mt-1.5 text-[9px] sm:text-[10px] text-zinc-400 font-heading italic leading-relaxed">
          Quiet work. Pay a contractor to take out a rival&apos;s visible robot bodyguard — no witnesses, no names.
        </p>
        {staffPreview && (
          <div className="mt-2 inline-flex items-center gap-1.5 rounded border border-amber-500/45 bg-amber-500/10 px-2 py-1 text-[9px] font-heading font-bold uppercase tracking-wider text-amber-300">
            <AlertTriangle size={11} /> Staff preview — not live for players
          </div>
        )}
      </div>

      {/* Stats */}
      <div className={`relative rounded-lg overflow-hidden ${styles.panel} mobile-panel hm-fade-in`} style={{ animationDelay: '0.05s' }}>
        <div className="absolute top-2 right-3 flex gap-2 opacity-40 pointer-events-none">
          <span className="hm-bullet" />
          <span className="hm-bullet" style={{ marginTop: 4 }} />
        </div>
        <div className={`px-2.5 sm:px-3 py-2 ${styles.panelHeader}`}>
          <h2 className="text-[10px] sm:text-xs font-heading font-bold text-primary uppercase tracking-wider">Your ledger</h2>
        </div>
        <div className="p-2.5 sm:p-3 grid grid-cols-2 sm:grid-cols-4 gap-1.5">
          {[
            { label: 'Hitman hired', value: (stats.hires || 0).toLocaleString(), Icon: Target, cls: 'text-foreground' },
            { label: 'Points spent', value: (stats.points_spent || 0).toLocaleString(), Icon: Coins, cls: 'text-amber-300' },
            { label: 'Hitman kills', value: (stats.kills || 0).toLocaleString(), Icon: Skull, cls: 'text-red-400' },
            { label: 'Free tokens', value: (freeTokens || 0).toLocaleString(), Icon: Ticket, cls: 'text-emerald-300' },
          ].map(({ label, value, Icon, cls }) => (
            <div key={label} className="rounded-md border border-zinc-700/40 bg-zinc-950/50 px-2 py-2 min-w-0">
              <div className="flex items-center gap-1 text-[8px] font-heading uppercase tracking-wider text-zinc-500 truncate">
                <Icon size={10} className="shrink-0 opacity-70" />
                {label}
              </div>
              <div className={`text-[13px] font-heading font-bold tabular-nums truncate ${cls}`}>{value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Game-wide stats */}
      <div className={`relative rounded-lg overflow-hidden ${styles.panel} mobile-panel hm-fade-in`} style={{ animationDelay: '0.06s' }}>
        <div className={`px-2.5 sm:px-3 py-2 ${styles.panelHeader}`}>
          <h2 className="text-[10px] sm:text-xs font-heading font-bold text-primary uppercase tracking-wider">Street ledger</h2>
        </div>
        <div className="p-2.5 sm:p-3 grid grid-cols-2 sm:grid-cols-3 gap-1.5">
          {[
            { label: 'Contracts hired', value: (gameStats.hires || 0).toLocaleString(), Icon: Target, cls: 'text-foreground' },
            { label: 'Bodyguards killed', value: (gameStats.kills || 0).toLocaleString(), Icon: Skull, cls: 'text-red-400' },
            { label: 'Misses', value: (gameStats.fails || 0).toLocaleString(), Icon: XCircle, cls: 'text-zinc-400' },
            { label: 'Players hired', value: (gameStats.unique_hirers || 0).toLocaleString(), Icon: Users, cls: 'text-sky-300' },
            { label: 'Players hit', value: (gameStats.unique_victims || 0).toLocaleString(), Icon: Crosshair, cls: 'text-amber-300' },
            { label: 'Points spent', value: (gameStats.points_spent || 0).toLocaleString(), Icon: Coins, cls: 'text-amber-300' },
          ].map(({ label, value, Icon, cls }) => (
            <div key={label} className="rounded-md border border-zinc-700/40 bg-zinc-950/50 px-2 py-2 min-w-0">
              <div className="flex items-center gap-1 text-[8px] font-heading uppercase tracking-wider text-zinc-500 truncate">
                <Icon size={10} className="shrink-0 opacity-70" />
                {label}
              </div>
              <div className={`text-[13px] font-heading font-bold tabular-nums truncate ${cls}`}>{value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Discount banner */}
      {discount && (
        <div className="rounded-lg border border-emerald-500/35 bg-emerald-500/10 px-3 py-2.5 hm-fade-in" style={{ animationDelay: '0.08s' }}>
          <div className="flex items-start gap-2">
            <Sparkles size={14} className="text-emerald-300 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="text-[10px] font-heading font-bold text-emerald-300 uppercase tracking-wider">Counter-contract open</div>
              <p className="text-[10px] text-zinc-300 font-heading mt-0.5 leading-snug">
                25% off any tier vs <span className="text-foreground font-bold">{discount.vs_username}</span>
                {discount.expires_at && (
                  <span className="text-zinc-500"> · until {new Date(discount.expires_at).toLocaleString()}</span>
                )}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Anti-hitman protection */}
      <div
        className={`relative rounded-lg overflow-hidden ${styles.panel} mobile-panel hm-fade-in ${
          protectionActive ? 'ring-1 ring-sky-500/30' : ''
        }`}
        style={{ animationDelay: '0.09s' }}
      >
        <div className={`px-2.5 sm:px-3 py-2 ${styles.panelHeader} flex items-center gap-1.5`}>
          <Shield size={12} className="text-sky-300" />
          <h2 className="text-[10px] sm:text-xs font-heading font-bold text-primary uppercase tracking-wider">
            Anti-hitman protection
          </h2>
        </div>
        <div className="p-2.5 sm:p-3 flex flex-col sm:flex-row sm:items-center gap-2.5">
          <div className="min-w-0 flex-1 space-y-1">
            {protectionActive ? (
              <>
                <div className="text-[10px] font-heading font-bold text-sky-300 uppercase tracking-wider">Active</div>
                <p className="text-[10px] text-zinc-400 font-heading leading-snug">
                  Contractors cannot mark you
                  {protectionUntil && (
                    <span className="text-zinc-500"> · until {new Date(protectionUntil).toLocaleString()}</span>
                  )}
                  . Cannot stack. After it ends: {protectionRebuyHours}h rebuy cooldown.
                </p>
              </>
            ) : protectionOnRebuyCooldown ? (
              <>
                <div className="text-[10px] font-heading font-bold text-amber-300 uppercase tracking-wider">Rebuy cooldown</div>
                <p className="text-[10px] text-zinc-400 font-heading leading-snug flex items-center gap-1">
                  <Clock size={10} className="shrink-0" />
                  Available again {new Date(protectionRebuyCooldownUntil).toLocaleString()}
                </p>
              </>
            ) : (
              <p className="text-[10px] text-zinc-400 font-heading leading-snug">
                Block all Hitman contracts on you for <span className="text-zinc-200">{protectionDays} days</span>.{' '}
                <span className="text-zinc-200">{fmtPts(protectionCost)}</span> or{' '}
                <span className="text-zinc-200">{fmtRespect(protectionRespectCost)}</span> · cannot stack ·{' '}
                {protectionRebuyHours}h rebuy cooldown after it ends.
              </p>
            )}
          </div>
          <div className="flex flex-col sm:flex-row gap-1.5 shrink-0">
            <button
              type="button"
              disabled={!protectionCanBuy || !!buyingProtection}
              onClick={() => buyProtection('points')}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md border border-sky-500/40 bg-sky-500/10 text-sky-200 text-[10px] font-heading font-bold uppercase tracking-wider hover:bg-sky-500/20 disabled:opacity-40 disabled:cursor-not-allowed touch-manipulation"
            >
              <Coins size={12} />
              {buyingProtection === 'points'
                ? 'Buying…'
                : protectionActive
                  ? 'Protected'
                  : protectionOnRebuyCooldown
                    ? 'Cooldown'
                    : fmtPts(protectionCost)}
            </button>
            <button
              type="button"
              disabled={!protectionCanBuy || !!buyingProtection}
              onClick={() => buyProtection('respect')}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-200 text-[10px] font-heading font-bold uppercase tracking-wider hover:bg-amber-500/20 disabled:opacity-40 disabled:cursor-not-allowed touch-manipulation"
            >
              <Shield size={12} />
              {buyingProtection === 'respect'
                ? 'Buying…'
                : protectionActive
                  ? 'Protected'
                  : protectionOnRebuyCooldown
                    ? 'Cooldown'
                    : fmtRespect(protectionRespectCost)}
            </button>
          </div>
        </div>
      </div>

      {/* Rules */}
      <div className={`relative rounded-lg overflow-hidden ${styles.panel} mobile-panel hm-fade-in`} style={{ animationDelay: '0.1s' }}>
        <div className={`px-2.5 sm:px-3 py-2 ${styles.panelHeader} flex items-center gap-1.5`}>
          <Shield size={12} className="text-primary" />
          <h2 className="text-[10px] sm:text-xs font-heading font-bold text-primary uppercase tracking-wider">House rules</h2>
        </div>
        <ul className="p-2.5 sm:p-3 space-y-1.5 text-[10px] text-zinc-400 font-heading leading-relaxed list-disc pl-5">
          <li>Targets the <span className="text-zinc-200">visible</span> robot bodyguard (highest slot: 4 of 4, 3 of 3, …).</li>
          <li>Needs <span className="text-zinc-200">at least 2</span> bodyguards — cannot hit a lone Slot 1 guard.</li>
          <li>Success: silent kill (no witnesses). Owner learns a hitman struck — <span className="text-zinc-200">not who paid</span>.</li>
          <li>Victim locked from Hitman for <span className="text-zinc-200">24h</span> after a successful strike.</li>
          <li>Fail: 10% free second attempt · target may get 25% off vs you for 24h · success has 25% chance of a free token.</li>
          <li>
            <span className="text-zinc-200">Anti-hitman protection</span>: {fmtPts(protectionCost)} or{' '}
            {fmtRespect(protectionRespectCost)} for {protectionDays} days — blocks all contracts on you. Cannot stack.
            After it ends: <span className="text-zinc-200">{protectionRebuyHours}h</span> before you can buy again.
          </li>
        </ul>
      </div>

      {/* Target */}
      <div className={`relative rounded-lg overflow-hidden ${styles.panel} mobile-panel hm-fade-in`} style={{ animationDelay: '0.12s' }}>
        <div className="pointer-events-none absolute bottom-2 left-4 text-zinc-600/30">
          <div className="hm-smoke w-5 h-5" />
        </div>
        <div className={`px-2.5 sm:px-3 py-2 ${styles.panelHeader}`}>
          <h2 className="text-[10px] sm:text-xs font-heading font-bold text-primary uppercase tracking-wider">Name the mark</h2>
        </div>
        <div className="p-2.5 sm:p-3 space-y-2.5">
          <div className="flex gap-2">
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && doLookup()}
              placeholder="Username"
              className="flex-1 min-w-0 px-2.5 py-2 rounded-md bg-zinc-950/60 border border-zinc-700/50 text-[11px] font-heading text-foreground placeholder:text-zinc-600 focus:outline-none focus:border-primary/50"
            />
            <button
              type="button"
              onClick={doLookup}
              disabled={lookingUp}
              className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-primary/45 bg-primary/15 text-primary text-[10px] font-heading font-bold uppercase tracking-wider hover:bg-primary/25 disabled:opacity-50 touch-manipulation"
            >
              <Search size={12} />
              {lookingUp ? '…' : 'Check'}
            </button>
          </div>

          {lookup && (
            <div
              className={`rounded-md border px-2.5 py-2 text-[10px] font-heading ${
                lookup.hireable
                  ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-200'
                  : 'border-amber-500/35 bg-amber-500/10 text-amber-200'
              }`}
            >
              <div className="font-bold uppercase tracking-wider text-[9px] opacity-80">
                {lookup.username || username}
              </div>
              <p className="mt-0.5 leading-snug">{lookup.hireable ? 'Contract available — pick a tier below.' : lookup.reason || 'Not hireable.'}</p>
              {lookup.protected && lookup.protection_until && (
                <p className="mt-1 flex items-center gap-1 text-[9px] text-zinc-400">
                  <Shield size={10} /> Protected until {new Date(lookup.protection_until).toLocaleString()}
                </p>
              )}
              {lookup.on_cooldown && lookup.cooldown_until && (
                <p className="mt-1 flex items-center gap-1 text-[9px] text-zinc-400">
                  <Clock size={10} /> Until {new Date(lookup.cooldown_until).toLocaleString()}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Tiers */}
      <div className={`relative rounded-lg overflow-hidden ${styles.panel} mobile-panel hm-fade-in`} style={{ animationDelay: '0.15s' }}>
        <div className={`px-2.5 sm:px-3 py-2 ${styles.panelHeader}`}>
          <h2 className="text-[10px] sm:text-xs font-heading font-bold text-primary uppercase tracking-wider">Contractors</h2>
        </div>
        <div className="p-2.5 sm:p-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
          {tiers.map((tier, i) => {
            const pricing = priceForTier(tier);
            const busy = hiringTier === tier.id;
            const canHire = !!lookup?.hireable && !hiringTier;
            return (
              <div
                key={tier.id}
                className="relative rounded-lg border border-zinc-700/45 bg-zinc-950/45 p-3 space-y-2 overflow-hidden"
                style={{ animationDelay: `${0.05 * i}s` }}
              >
                <div className="absolute -right-1 top-2 opacity-[0.07] pointer-events-none">
                  <Crosshair size={56} />
                </div>
                <div className="text-[9px] font-heading font-bold uppercase tracking-[0.14em] text-primary/90">{tier.label}</div>
                <div className="text-lg font-heading font-bold text-foreground tabular-nums">{tier.success_pct}%</div>
                <div className="text-[9px] text-zinc-500 font-heading uppercase tracking-wider">Kill chance</div>
                <div
                  className={`text-[12px] font-heading font-bold tabular-nums ${
                    pricing.free ? 'text-emerald-300' : pricing.discount ? 'text-amber-300' : 'text-zinc-200'
                  }`}
                >
                  {pricing.label}
                  {pricing.discount && <span className="ml-1 text-[9px] text-amber-400/80">25% off</span>}
                </div>
                <button
                  type="button"
                  disabled={!canHire || busy}
                  onClick={() => hire(tier.id)}
                  className="w-full mt-1 py-2 rounded-md border border-red-500/40 bg-red-500/10 text-red-300 text-[10px] font-heading font-bold uppercase tracking-wider hover:bg-red-500/20 disabled:opacity-40 disabled:cursor-not-allowed touch-manipulation active:scale-[0.98] transition-all"
                >
                  {busy ? 'Working…' : 'Hire'}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {lastResult && (
        <div
          className={`relative rounded-lg border px-3 py-3 hm-fade-in ${
            lastResult.success
              ? 'border-emerald-500/40 bg-emerald-500/10'
              : 'border-zinc-600/40 bg-zinc-900/50'
          }`}
        >
          {lastResult.success && (
            <div className="absolute right-3 top-2 hm-stamp text-[10px] font-heading font-bold uppercase tracking-widest text-red-400/80 border-2 border-red-500/50 px-2 py-0.5 rounded-sm -rotate-12">
              Paid in blood
            </div>
          )}
          <p className="text-[11px] font-heading text-foreground leading-snug pr-16">{lastResult.message}</p>
        </div>
      )}
    </div>
  );
}
