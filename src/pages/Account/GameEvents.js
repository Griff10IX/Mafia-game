import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Zap, Clock, Package, Gift } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../utils/api';
import AutoRefreshNote from '../../components/AutoRefreshNote';
import styles from '../../styles/noir.module.css';

const PAGE_STYLES = `
  @keyframes ge-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .ge-fade-in { animation: ge-fade-in 0.35s ease-out both; }
`;

const MULTIPLIER_LABELS = {
  rank_points: 'Rank points',
  kill_cash: 'Kill / loot cash',
  gta_success: 'GTA success',
  bodyguard_cost: 'Bodyguard cost',
  racket_cooldown: 'Racket cooldown',
  racket_payout: 'Racket / OC payout',
  armour_weapon_cost: 'Armour & weapons',
};

const MULTIPLIER_KEYS = Object.keys(MULTIPLIER_LABELS);

function formatCountdown(expiresAt) {
  if (!expiresAt) return '';
  const diff = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
  if (diff <= 0) return 'Rotating soon';
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  if (h > 0) return `${h}h ${m}m left`;
  return `${m}m left`;
}

function formatMult(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n === 1) return null;
  if (n < 1) return `×${n}`;
  return `×${n}`;
}

function formatPerkRemaining(ar) {
  if (ar?.attempts_remaining != null) {
    return `${ar.attempts_remaining} attempts left`;
  }
  if (!ar?.expires_at) return '';
  try {
    const until = new Date(String(ar.expires_at).replace('Z', 'Z'));
    const ms = until - new Date();
    if (ms <= 0) return 'Expired';
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return `${h}h ${m}m left`;
  } catch {
    return '';
  }
}

function multiplierChips(ev) {
  if (!ev) return [];
  const chips = [];
  MULTIPLIER_KEYS.forEach((key) => {
    const raw = Number(ev[key] ?? 1);
    if (!Number.isFinite(raw) || raw === 1) return;
    const label = MULTIPLIER_LABELS[key] || key;
    const isDiscount = raw < 1 && (key.includes('cost') || key === 'racket_cooldown');
    chips.push({
      label,
      value: formatMult(raw),
      cls: isDiscount || raw > 1 ? (raw > 1 ? 'text-emerald-300' : 'text-sky-300') : 'text-foreground',
    });
  });
  return chips;
}

function StatChipGrid({ chips }) {
  if (!chips?.length) return null;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
      {chips.map((c) => (
        <div key={c.label} className="rounded-md border border-zinc-700/40 bg-zinc-950/40 px-2.5 py-2 min-w-0">
          <div className="text-[8px] font-heading uppercase tracking-wider text-mutedForeground truncate">{c.label}</div>
          <div className={`text-[11px] font-heading font-bold truncate ${c.cls || 'text-foreground'}`}>{c.value}</div>
        </div>
      ))}
    </div>
  );
}

const REFRESH_MS = 60_000;

export default function GameEvents() {
  const [eventData, setEventData] = useState(null);
  const [storeSale, setStoreSale] = useState(null);
  const [myPerks, setMyPerks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [countdown, setCountdown] = useState('');

  const load = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    const eventsReq = api.get('/events/active')
      .then((evRes) => {
        setEventData(evRes?.data || null);
      })
      .catch(() => {
        if (!silent) {
          setEventData(null);
          toast.error('Failed to load game events');
        }
      })
      .finally(() => {
        if (!silent) setLoading(false);
      });

    const saleReq = api.get('/payments/store-points-event')
      .then((saleRes) => {
        setStoreSale(saleRes?.data?.event ?? null);
      })
      .catch(() => {
        if (!silent) setStoreSale(null);
      });

    const perksReq = api.get('/loot-box/status')
      .then((lootRes) => {
        const rewards = Array.isArray(lootRes?.data?.active_rewards) ? lootRes.data.active_rewards : [];
        setMyPerks(rewards);
      })
      .catch(() => {
        if (!silent) setMyPerks([]);
      });

    return Promise.all([eventsReq, saleReq, perksReq]);
  }, []);

  useEffect(() => {
    load(false);
    const id = setInterval(() => load(true), REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    const tick = () => setCountdown(formatCountdown(eventData?.expires_at));
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [eventData?.expires_at]);

  const activeEvents = useMemo(() => {
    if (Array.isArray(eventData?.active_events) && eventData.active_events.length) {
      return eventData.active_events;
    }
    const ids = eventData?.active_event_ids || [];
    const names = eventData?.active_event_names || [];
    return ids.map((id, i) => ({
      id,
      name: names[i] || id,
      message: '',
    }));
  }, [eventData]);

  const hasWorldEvents =
    !!eventData?.events_enabled
    && eventData?.event
    && eventData.event.id !== 'none'
    && activeEvents.length > 0;

  const combinedChips = multiplierChips(eventData?.event);
  const saleActive = storeSale && storeSale.active !== false && (storeSale.percent || storeSale.label);

  return (
    <div className={`${styles.pageContent} p-3 sm:p-4 mobile-page-root`}>
      <style>{PAGE_STYLES}</style>
      <div className="max-w-4xl mx-auto space-y-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h1 className="text-lg sm:text-xl font-heading font-bold text-primary flex items-center gap-2">
            <Zap size={22} />
            Game Events
          </h1>
        </div>
        <p className="text-[10px] sm:text-xs text-mutedForeground font-heading">
          Live world buffs for everyone, plus your active loot perks. Activate armoury tokens from Inventory.
        </p>
        <AutoRefreshNote seconds={60} />

        <section className="space-y-2 ge-fade-in">
          <div className="flex items-center gap-2 px-0.5">
            <Gift size={12} className="text-amber-400" />
            <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-wider">My game events perks</h2>
          </div>
          {myPerks.length === 0 ? (
            <div className={`${styles.panel} rounded-md border border-primary/20 p-3 text-[10px] text-mutedForeground font-heading mobile-panel`}>
              No personal loot perks active. Open a loot box or check{' '}
              <Link to="/account/inventory" className="text-primary hover:underline">Inventory → In use</Link>
              {' '}for armoury tokens.
            </div>
          ) : (
            <ul className={`${styles.panel} rounded-md border border-amber-500/25 bg-amber-500/5 mobile-panel p-2 list-none m-0 space-y-1.5`}>
              {myPerks.map((ar, i) => {
                const left = formatPerkRemaining(ar);
                return (
                  <li
                    key={`${ar.type || ar.name || 'perk'}-${i}`}
                    className="flex items-center gap-2 text-[10px] font-heading text-foreground rounded border border-amber-500/20 bg-zinc-950/40 px-2.5 py-2"
                  >
                    <Zap size={12} className="text-amber-400 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{ar.name || ar.type || 'Perk'}</span>
                    {left ? <span className="text-[9px] text-mutedForeground shrink-0">{left}</span> : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="space-y-2 ge-fade-in" style={{ animationDelay: '0.04s' }}>
          <div className="flex items-center gap-2 px-0.5">
            <Zap size={12} className="text-primary" />
            <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-wider">Active world events</h2>
            {countdown && hasWorldEvents ? (
              <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-heading font-bold text-emerald-300">
                <Clock size={9} />
                {countdown}
              </span>
            ) : null}
          </div>

          {loading && !eventData ? (
            <div className={`${styles.panel} rounded-md border border-primary/20 p-3 text-[10px] text-mutedForeground font-heading mobile-panel`}>
              Loading…
            </div>
          ) : !hasWorldEvents ? (
            <div className={`${styles.panel} rounded-md border border-primary/20 p-3 text-[10px] text-mutedForeground font-heading mobile-panel`}>
              No active world events right now. Check back when the next rotation starts.
            </div>
          ) : (
            <div className="space-y-2">
              {activeEvents.map((ev, idx) => {
                const chips = multiplierChips(ev);
                return (
                  <div
                    key={ev.id || idx}
                    className={`${styles.panel} rounded-md overflow-hidden border border-primary/20 mobile-panel p-2.5 space-y-2 ge-fade-in`}
                    style={{ animationDelay: `${idx * 0.04}s` }}
                  >
                    <div className="flex items-start gap-2 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/25 flex items-center justify-center shrink-0">
                        <Zap size={14} className="text-primary" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] font-heading font-bold text-foreground truncate">{ev.name}</div>
                        {ev.message ? (
                          <p className="text-[9px] text-mutedForeground font-heading mt-0.5 leading-relaxed">{ev.message}</p>
                        ) : null}
                      </div>
                    </div>
                    <StatChipGrid chips={chips} />
                  </div>
                );
              })}
              {activeEvents.length > 1 && combinedChips.length > 0 && (
                <div className={`${styles.panel} rounded-md border border-primary/25 bg-primary/5 mobile-panel p-2.5 space-y-2`}>
                  <div className="text-[10px] font-heading font-bold text-primary uppercase tracking-wider">Combined effect</div>
                  <p className="text-[10px] font-heading text-foreground">{eventData.event?.name}</p>
                  <StatChipGrid chips={combinedChips} />
                </div>
              )}
              {eventData.expires_at && (
                <p className="text-[9px] text-mutedForeground font-heading px-0.5">
                  Rotates at {new Date(eventData.expires_at).toLocaleString(undefined, { timeZone: 'UTC' })} UTC
                </p>
              )}
            </div>
          )}
        </section>

        {saleActive && (
          <section className="space-y-2 ge-fade-in" style={{ animationDelay: '0.08s' }}>
            <div className="flex items-center gap-2 px-0.5">
              <Package size={12} className="text-primary" />
              <h2 className="text-[10px] font-heading font-bold text-primary uppercase tracking-wider">Store sale</h2>
            </div>
            <Link
              to="/game/store"
              className={`${styles.panel} rounded-md border border-amber-500/30 bg-amber-500/5 mobile-panel p-2.5 block hover:border-amber-500/50 transition-colors`}
            >
              <div className="text-[11px] font-heading font-bold text-amber-200">
                {storeSale.label || `Points +${storeSale.percent || 75}%`}
              </div>
              <p className="text-[9px] text-mutedForeground font-heading mt-0.5">Open Store →</p>
            </Link>
          </section>
        )}
      </div>
    </div>
  );
}
