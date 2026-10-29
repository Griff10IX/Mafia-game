import { useEffect, useRef, useState } from 'react';
import api from '../../utils/api';

const PUBLIC = process.env.PUBLIC_URL || '';
const GANGSTER_IMG = `${PUBLIC}/images/landing-gangster.png`;
const PHOTO_CROPS = ['center 20%', '30% 15%', '70% 25%'];

export function LandingScene() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    let drops = [];
    let frame = 0;
    const size = () => {
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      const n = Math.floor(window.innerWidth / (window.innerWidth < 600 ? 14 : 7));
      drops = Array.from({ length: n }, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        l: (8 + Math.random() * 14) * dpr,
        v: (8 + Math.random() * 8) * dpr,
      }));
    };
    const tick = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = 'rgba(190,210,230,.38)';
      ctx.lineWidth = dpr;
      ctx.beginPath();
      for (const d of drops) {
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x - 2 * dpr, d.y + d.l);
        d.y += d.v;
        d.x -= dpr;
        if (d.y > canvas.height) { d.y = -20; d.x = Math.random() * canvas.width; }
      }
      ctx.stroke();
      frame = requestAnimationFrame(tick);
    };
    const onVisibility = () => {
      cancelAnimationFrame(frame);
      if (!document.hidden) frame = requestAnimationFrame(tick);
    };
    size();
    frame = requestAnimationFrame(tick);
    window.addEventListener('resize', size);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', size);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return (
    <div className="ln-scene" aria-hidden>
      <div className="ln-scene-bg" style={{ backgroundImage: `url(${PUBLIC}/images/landing-bg.png)` }} />
      <div className="ln-scene-tint" />
      <div className="ln-scene-fog" />
      <canvas ref={canvasRef} />
      <div className="ln-scene-vignette" />
    </div>
  );
}

/** Public login feed: Most Wanted + recent street events. Refreshes every minute. */
export function useLandingFeed(enabled) {
  const [feed, setFeed] = useState({ most_wanted: [], live: [] });
  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    const load = () => {
      api.get('/auth/landing-feed')
        .then((r) => {
          if (cancelled) return;
          const d = r.data || {};
          setFeed({
            most_wanted: Array.isArray(d.most_wanted) ? d.most_wanted.slice(0, 3) : [],
            live: Array.isArray(d.live) ? d.live : [],
          });
        })
        .catch(() => {});
    };
    load();
    const id = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [enabled]);
  return feed;
}

function compact(n) {
  const v = Number(n) || 0;
  if (v >= 1e9) return `${+(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${+(v / 1e6).toFixed(1)}M`;
  if (v >= 1e4) return `${Math.round(v / 1e3)}K`;
  return v.toLocaleString();
}

function bountyLine(p) {
  if (p.bounty_cash > 0) return `Bounty $${compact(p.bounty_cash)}`;
  if (p.bounty_points > 0) return `Bounty ${compact(p.bounty_points)} pts`;
  if (p.kills > 0) return `${Number(p.kills).toLocaleString()} kills`;
  return 'Armed & dangerous';
}

const TILTS = { 1: [6], 2: [-7, 7], 3: [-9, 3, 11] };

export function MostWanted({ people }) {
  if (!people?.length) return null;
  const tilts = TILTS[people.length] || TILTS[3];
  return (
    <>
      <div className="ln-wanted-label">· MOST WANTED ·</div>
      <div className="ln-wanted">
        {people.map((p, i) => (
          <div
            key={p.username}
            className="ln-polaroid"
            style={{ '--tilt': `${tilts[i]}deg` }}
            tabIndex={0}
            title={`${p.username} · ${p.rank} · ${bountyLine(p)}`}
          >
            <span className="ln-polaroid-tape" />
            <div
              className="ln-polaroid-photo"
              style={{
                backgroundImage: `url(${p.avatar_url || GANGSTER_IMG})`,
                backgroundPosition: p.avatar_url ? 'center' : PHOTO_CROPS[i % PHOTO_CROPS.length],
              }}
            />
            <span className="ln-polaroid-stamp">WANTED</span>
            <div className="ln-polaroid-cap">
              <b>{p.username}</b>
              {p.rank}
              <small>{bountyLine(p)}</small>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function timeAgo(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 90) return 'now';
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

/** Shows `rows` items at a time and steps through the rest every few seconds. */
export function LiveStreets({ items, rows = 3 }) {
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState(() => !(typeof window !== 'undefined' && window.matchMedia('(max-width: 520px)').matches));

  useEffect(() => {
    if (items.length <= rows) return undefined;
    const id = setInterval(() => setOffset((o) => (o + 1) % items.length), 3400);
    return () => clearInterval(id);
  }, [items.length, rows]);

  if (!items.length) return null;
  const shown = Array.from({ length: Math.min(rows, items.length) }, (_, i) => items[(offset + i) % items.length]);
  return (
    <details className="ln-live-box" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary><span className="ln-dot" />Live on the streets</summary>
      <div className="ln-live" aria-live="polite">
        <h2><i />Live on the streets</h2>
        <ul>
          {shown.map((it, i) => (
            <li key={`${offset}-${i}-${it.at}`}>
              <span className={`k ${it.type}`} />
              <span className="t">{it.message}</span>
              <small>{timeAgo(it.at)}</small>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}

const ICON_PATHS = {
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></>,
  lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>,
};

export function FieldIcon({ name }) {
  return <svg viewBox="0 0 24 24" aria-hidden>{ICON_PATHS[name]}</svg>;
}

export function passwordStrength(v) {
  if (!v) return 0;
  let s = 0;
  if (v.length >= 8) s++;
  if (/[A-Z]/.test(v) && /[a-z]/.test(v)) s++;
  if (/\d/.test(v)) s++;
  if (/[^A-Za-z0-9]/.test(v)) s++;
  return s;
}

export const STRENGTH_LABELS = ['Too weak', 'Weak', 'Okay', 'Strong', 'Made man'];
