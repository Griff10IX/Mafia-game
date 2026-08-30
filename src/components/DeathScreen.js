import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';
import { formatGameTimeWeekday } from '../utils/gameDateTime';
import styles from '../styles/noir.module.css';

const DEATH_STYLES = `
  [data-death-screen].ds-root {
    position: fixed;
    inset: 0;
    z-index: 9999;
    overflow-x: hidden;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: max(20px, env(safe-area-inset-top)) 16px max(24px, env(safe-area-inset-bottom));
    background:
      radial-gradient(ellipse 100% 55% at 50% 0%, rgba(var(--noir-primary-rgb, 184, 145, 68), 0.07) 0%, transparent 58%),
      radial-gradient(ellipse 80% 45% at 50% 100%, rgba(var(--noir-primary-rgb, 184, 145, 68), 0.04) 0%, transparent 52%),
      linear-gradient(180deg, #0f0e13 0%, #13121a 100%);
    color: var(--noir-foreground, #e8e4dc);
  }

  @keyframes ds-fadeIn    { from { transform: translateY(4px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
  @keyframes ds-fadeUp    { from { transform: translateY(12px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
  @keyframes ds-stoneRise { from { transform: translateY(24px) } to { transform: translateY(0) } }
  @keyframes ds-expandX   { from { transform: scaleX(0); opacity: 0 } to { transform: scaleX(1); opacity: 1 } }
  @keyframes ds-twinkle   { from { opacity: 0.12 } to { opacity: 0.85 } }
  @keyframes ds-flicker   { 0% { opacity: .88 } 50% { opacity: 1 } 100% { opacity: .82 } }
  @keyframes ds-emberRise { 0% { transform: translateY(0); opacity: 0 } 10% { opacity: .7 } 100% { transform: translateY(-90vh); opacity: 0 } }
  @keyframes ds-fogDrift  { from { transform: translateX(-3%) } to { transform: translateX(3%) } }
  @keyframes ds-crossGlow { from { filter: drop-shadow(0 0 3px rgba(var(--noir-primary-rgb, 184, 145, 68), .22)) } to { filter: drop-shadow(0 0 14px rgba(var(--noir-primary-rgb, 184, 145, 68), .65)) } }
  @keyframes ds-lightFlash { 0%,91%,93%,95%,100% { opacity: 0 } 92%,94% { opacity: 1 } }
  @keyframes ds-ravenFly  { from { transform: translateX(-40px); opacity: 0 } 12% { opacity: .3 } 88% { opacity: .3 } to { transform: translateX(110vw); opacity: 0 } }

  .ds-fade-in  { animation: ds-fadeIn .4s ease-out both }
  .ds-fade-in2 { animation: ds-fadeIn .4s .05s ease-out both }
  .ds-fade-in3 { animation: ds-fadeIn .4s .1s ease-out both }
  .ds-stone-rise { animation: ds-stoneRise 1s cubic-bezier(0.16,1,0.3,1) }
  .ds-actions  { animation: ds-fadeUp .45s .15s ease-out both }
  .ds-expand   { animation: ds-expandX .7s .12s both }
  .ds-cross    { animation: ds-crossGlow 2.8s 1.4s ease-in-out infinite alternate }
  .ds-flicker  { animation: ds-flicker 1s ease-in-out infinite alternate }
  .ds-flicker2 { animation: ds-flicker .8s .25s ease-in-out infinite alternate }

  .ds-sky { position: absolute; inset: 0; pointer-events: none; overflow: hidden }
  .ds-star {
    position: absolute; width: 2px; height: 2px; border-radius: 50%;
    background: rgba(255,255,255,.7);
    animation: ds-twinkle 2.8s ease-in-out infinite alternate;
  }
  .ds-ember {
    position: absolute; bottom: 4%; width: 2px; height: 2px; border-radius: 50%;
    background: rgba(var(--noir-primary-rgb, 184, 145, 68), .65);
    box-shadow: 0 0 6px rgba(var(--noir-primary-rgb, 184, 145, 68), .4);
    animation: ds-emberRise linear infinite;
  }
  .ds-flash {
    position: fixed; inset: 0; pointer-events: none; z-index: 4;
    background: rgba(210,205,240,0.03);
    animation: ds-lightFlash 14s 5s infinite;
  }
  .ds-moon {
    position: absolute; top: 36px; right: 12%; width: 48px; height: 48px; border-radius: 50%;
    background: radial-gradient(circle at 38% 35%, #f0ead8 55%, #bca880 100%);
    box-shadow: 0 0 28px rgba(240,234,216,.12);
  }
  .ds-raven {
    position: absolute; top: 18%; width: 26px; height: 9px;
    animation: ds-ravenFly linear 18s 5s both;
  }
  .ds-fog {
    position: absolute; bottom: 0; left: -20%; right: -20%; height: 140px;
    background: radial-gradient(ellipse at 50% 100%, rgba(var(--noir-primary-rgb, 184, 145, 68), .05) 0%, transparent 70%);
    animation: ds-fogDrift 10s ease-in-out infinite alternate;
  }

  .ds-col {
    position: relative; z-index: 10; width: 100%; max-width: 480px;
    display: flex; flex-direction: column; align-items: center;
  }

  .ds-stone {
    width: 100%; max-width: 380px;
    background: linear-gradient(158deg, #2c2a32 0%, #1c1a22 42%, #111019 100%);
    border: 1px solid rgba(var(--noir-primary-rgb, 184, 145, 68), 0.18);
    box-shadow:
      0 0 0 1px rgba(0,0,0,.95),
      0 40px 90px rgba(0,0,0,.7),
      inset 0 1px 0 rgba(255,255,255,.04);
    padding: 32px 28px 28px;
    clip-path: polygon(0% 8%, 4% 0%, 96% 0%, 100% 8%, 100% 100%, 0% 100%);
    position: relative;
  }
  .ds-stone-bar {
    position: absolute; top: 0; left: 0; right: 0; height: 2px;
    background: linear-gradient(90deg, transparent, rgba(var(--noir-primary-rgb, 184, 145, 68), .55), transparent);
  }
  .ds-rip {
    font-family: var(--font-heading, inherit);
    font-size: 10px; letter-spacing: .55em; text-transform: uppercase; text-align: center;
    color: rgba(var(--noir-primary-rgb, 184, 145, 68), .5); margin-bottom: 8px;
  }
  .ds-name {
    font-family: serif;
    font-size: clamp(26px, 6vw, 36px); font-weight: 700; text-align: center;
    letter-spacing: .04em; color: rgba(232, 228, 220, .94);
    text-shadow: 0 2px 24px rgba(0,0,0,.9); margin-bottom: 4px;
    overflow-wrap: anywhere;
  }
  .ds-sub {
    font-family: var(--font-heading, inherit);
    font-size: 12px; text-align: center;
    color: rgba(var(--noir-primary-rgb, 184, 145, 68), .62); margin-bottom: 16px;
  }
  .ds-rule {
    border: none; height: 1px; margin: 0 0 16px;
    background: linear-gradient(90deg, transparent, rgba(var(--noir-primary-rgb, 184, 145, 68), .28), transparent);
  }
  .ds-epitaph {
    font-family: serif; font-size: 14px; font-style: italic; text-align: center;
    line-height: 1.75; color: rgba(232, 228, 220, .38); margin-bottom: 8px;
  }
  .ds-dates {
    font-family: var(--font-heading, inherit);
    font-size: 10px; letter-spacing: .14em; text-transform: uppercase; text-align: center;
    color: rgba(232, 228, 220, .28);
  }
  .ds-time {
    font-family: var(--font-heading, inherit);
    font-size: 10px; letter-spacing: .16em; text-transform: uppercase; text-align: center;
    color: rgba(232, 228, 220, .2); margin-top: 8px;
  }
  .ds-plinth {
    width: 100%;
    background: linear-gradient(180deg, #1c1a22, #0d0c12);
    border: 1px solid rgba(var(--noir-primary-rgb, 184, 145, 68), .08);
    border-top: none;
  }

  .ds-card {
    width: 100%;
    margin-top: 18px;
    padding: 16px 16px 14px;
    background: rgba(12, 11, 16, .72);
    border: 1px solid rgba(var(--noir-primary-rgb, 184, 145, 68), .16);
    border-radius: 6px;
  }
  .ds-card-label {
    font-family: var(--font-heading, inherit);
    font-size: 10px; letter-spacing: .2em; text-transform: uppercase;
    color: rgba(var(--noir-primary-rgb, 184, 145, 68), .55); margin-bottom: 10px;
  }
  .ds-killer {
    text-align: center; padding: 10px 12px;
    background: rgba(130, 25, 25, .1);
    border: 1px solid rgba(170, 45, 45, .28);
    margin-bottom: 12px;
  }
  .ds-killer button {
    font-family: var(--font-heading, inherit);
    font-size: 16px; font-weight: 700; letter-spacing: .03em;
    color: rgba(230, 110, 110, .92); background: none; border: none; cursor: pointer; padding: 0;
  }
  .ds-killer button:hover { color: #fca5a5; }
  .ds-killer-fam {
    font-family: var(--font-heading, inherit);
    font-size: 11px; color: rgba(232, 228, 220, .35); margin-top: 4px;
  }
  .ds-reveal {
    width: 100%;
    font-family: var(--font-heading, inherit);
    font-size: 11px; letter-spacing: .08em; text-transform: uppercase;
    padding: 10px 12px; cursor: pointer;
    background: rgba(18, 16, 22, .85);
    border: 1px solid rgba(var(--noir-primary-rgb, 184, 145, 68), .28);
    color: rgba(var(--noir-primary-rgb, 184, 145, 68), .85);
  }
  .ds-reveal:hover:not(:disabled) { border-color: rgba(var(--noir-primary-rgb, 184, 145, 68), .5); }
  .ds-reveal:disabled { opacity: .55; cursor: default; }
  .ds-err {
    font-family: var(--font-heading, inherit);
    font-size: 11px; color: rgba(220, 80, 80, .85); text-align: center; margin-bottom: 8px;
  }
  .ds-stats {
    display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px;
    background: rgba(var(--noir-primary-rgb, 184, 145, 68), .1);
    border: 1px solid rgba(var(--noir-primary-rgb, 184, 145, 68), .1);
  }
  .ds-stat {
    background: rgba(10, 9, 14, .8); padding: 10px 6px; text-align: center;
  }
  .ds-stat span {
    display: block; font-family: var(--font-heading, inherit);
    font-size: 9px; letter-spacing: .14em; text-transform: uppercase;
    color: rgba(var(--noir-primary-rgb, 184, 145, 68), .4); margin-bottom: 4px;
  }
  .ds-stat strong {
    font-family: var(--font-heading, inherit); font-size: 12px; font-weight: 600;
    color: rgba(232, 228, 220, .7);
  }
  .ds-stat strong.ds-stat-red { color: rgba(200, 80, 80, .75); }

  .ds-steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  .ds-steps li {
    display: flex; gap: 10px; align-items: flex-start;
    font-family: var(--font-heading, inherit); font-size: 13px; line-height: 1.4;
    color: rgba(232, 228, 220, .72);
  }
  .ds-num {
    flex: 0 0 20px; height: 20px; border-radius: 50%;
    display: inline-flex; align-items: center; justify-content: center;
    font-size: 10px; font-weight: 700;
    color: var(--noir-button-foreground, #111);
    background: rgb(var(--noir-primary-rgb, 184, 145, 68));
  }
  .ds-note {
    font-family: var(--font-heading, inherit);
    font-size: 11px; line-height: 1.45; color: rgba(232, 228, 220, .4); margin: 12px 0 0;
  }
  .ds-cta {
    width: 100%; margin-top: 14px; padding: 12px 16px;
    font-family: var(--font-heading, inherit);
    font-size: 12px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase;
  }

  .ds-candles { display: flex; justify-content: center; gap: 88px; margin-bottom: 12px; }
  .ds-candle { display: flex; flex-direction: column; align-items: center; }
  .ds-flame {
    width: 8px; height: 13px; border-radius: 50% 50% 30% 30%;
    background: radial-gradient(ellipse at 50% 78%, #fff 0%, #ffe566 20%, #ff8c00 62%, transparent 100%);
  }
  .ds-wax { width: 6px; background: linear-gradient(180deg, #ddd0bc, #aa9878); }
  .ds-base { width: 10px; height: 4px; background: linear-gradient(180deg, #988870, #787058); border-radius: 0 0 2px 2px; }

  @media (max-width: 480px) {
    .ds-stone { padding: 26px 20px 22px; clip-path: none; border-radius: 4px 4px 0 0; }
    .ds-candles { gap: 64px; }
    .ds-moon { top: 16px; right: 16px; width: 36px; height: 36px; }
  }

  @media (prefers-reduced-motion: reduce) {
    .ds-fade-in, .ds-fade-in2, .ds-fade-in3, .ds-stone-rise, .ds-actions, .ds-expand, .ds-cross,
    .ds-flicker, .ds-flicker2, .ds-star, .ds-ember, .ds-flash, .ds-fog, .ds-raven {
      animation: none !important;
    }
    .ds-flash, .ds-ember, .ds-raven { display: none !important; }
  }
`;

const STAR_SPOTS = [
  ['8%', '12%', '0s'], ['22%', '28%', '0.6s'], ['41%', '9%', '1.1s'], ['63%', '18%', '0.3s'],
  ['78%', '7%', '1.8s'], ['91%', '22%', '0.9s'], ['14%', '41%', '1.4s'], ['33%', '52%', '0.2s'],
  ['55%', '36%', '2s'], ['71%', '48%', '0.7s'], ['86%', '39%', '1.5s'], ['5%', '61%', '1.2s'],
  ['47%', '14%', '0.4s'], ['96%', '55%', '1.7s'],
];

const EMBER_SPOTS = [
  ['12%', '11s', '0s'], ['28%', '14s', '3s'], ['46%', '10s', '6s'], ['61%', '16s', '1s'],
  ['74%', '12s', '8s'], ['88%', '15s', '4s'],
];

function formatMoney(n) {
  if (!n) return '$0';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}

function formatDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).getFullYear(); } catch { return '—'; }
}

function formatTime(iso) {
  return formatGameTimeWeekday(iso);
}

function prefersReducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export default function DeathScreen({ user, onLogout }) {
  const navigate = useNavigate();
  const [killer, setKiller] = useState(
    user?.killer_revealed
      ? { username: user.killed_by_username, family: user.killed_by_family_name }
      : null
  );
  const [revealing, setRevealing] = useState(false);
  const [revealError, setRevealError] = useState(null);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    setReduceMotion(prefersReducedMotion());
  }, []);

  const cashLost = user?.money_at_death || 0;
  const kills = user?.total_kills || 0;
  const rankName = user?.rank_name || '—';
  const familyName = user?.family_name || null;
  const deadAt = user?.dead_at;
  const createdAt = user?.created_at;
  const username = user?.username || '—';

  const handleNewLife = async () => {
    try { await api.post('/auth/logout'); } catch {}
    try {
      sessionStorage.setItem('landing_default_tab', 'register');
    } catch (_) {}
    if (onLogout) onLogout();
  };

  const handleRevealKiller = async () => {
    setRevealing(true);
    setRevealError(null);
    try {
      const res = await api.post('/death/reveal-killer');
      setKiller({ username: res.data.killer_username, family: res.data.killer_family });
    } catch (err) {
      setRevealError(err?.response?.data?.detail || 'Failed to reveal killer');
    } finally {
      setRevealing(false);
    }
  };

  return (
    <div data-app-shell="1" data-death-screen data-testid="death-screen" className={`ds-root ${styles.themeGangsterModern}`}>
      <style>{DEATH_STYLES}</style>

      {!reduceMotion && <div className="ds-flash" />}

      <div className="ds-sky" aria-hidden>
        {STAR_SPOTS.map(([left, top, delay], i) => (
          <span key={i} className="ds-star" style={{ left, top, animationDelay: delay }} />
        ))}
        {!reduceMotion && EMBER_SPOTS.map(([left, dur, delay], i) => (
          <span key={`e${i}`} className="ds-ember" style={{ left, animationDuration: dur, animationDelay: delay }} />
        ))}
        <div className="ds-moon" />
        {!reduceMotion && (
          <svg className="ds-raven" viewBox="0 0 26 9">
            <path d="M0,5 Q6,0 13,4 Q19,0 26,4" stroke="rgba(220,216,230,0.2)" strokeWidth="1" fill="none" />
          </svg>
        )}
        <div className="ds-fog" />
      </div>

      <div className="ds-col">
        <div className="ds-stone-rise" style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div className="ds-stone">
            <div className="ds-stone-bar" />
            <div className="ds-cross" style={{ textAlign: 'center', marginBottom: 10 }}>
              <svg width="40" height="50" viewBox="0 0 44 54" aria-hidden>
                <circle cx="22" cy="18" r="10" fill="none" stroke="rgba(var(--noir-primary-rgb, 184, 145, 68), .12)" strokeWidth=".8" />
                <line x1="22" y1="2" x2="22" y2="52" stroke="rgba(var(--noir-primary-rgb, 184, 145, 68), .32)" strokeWidth="1.5" />
                <line x1="8" y1="18" x2="36" y2="18" stroke="rgba(var(--noir-primary-rgb, 184, 145, 68), .32)" strokeWidth="1.5" />
              </svg>
            </div>
            <div className="ds-candles ds-fade-in">
              {[30, 20].map((h, i) => (
                <div key={i} className="ds-candle" style={{ marginTop: i === 1 ? 8 : 0 }}>
                  <div className={`ds-flame ${i === 0 ? 'ds-flicker' : 'ds-flicker2'}`} />
                  <div className="ds-wax" style={{ height: h }} />
                  <div className="ds-base" />
                </div>
              ))}
            </div>
            <div className="ds-rip">R · I · P</div>
            <div className="ds-name">{username}</div>
            <div className="ds-sub">{rankName}{familyName ? ` · ${familyName}` : ''}</div>
            <hr className="ds-rule ds-expand" />
            <div className="ds-epitaph ds-fade-in2">
              {cashLost > 0
                ? <>Struck down in the shadows.<br />Everything on hand was taken.</>
                : <>He came. He fell.<br />The streets swallowed him whole.</>
              }
            </div>
            <div className="ds-dates ds-fade-in2">
              Joined {formatDate(createdAt)} — Killed {formatDate(deadAt)}
            </div>
            <div className="ds-time">{formatTime(deadAt)}</div>
          </div>
          <div className="ds-plinth" style={{ maxWidth: 410, height: 16 }} />
          <div className="ds-plinth" style={{ maxWidth: 448, height: 10 }} />
        </div>

        <div className="ds-card ds-fade-in3">
          <div className="ds-card-label">How you fell</div>
          {killer ? (
            <div className="ds-killer">
              <button
                type="button"
                onClick={() => navigate(`/profile/${encodeURIComponent(killer.username)}`)}
              >
                {killer.username}
              </button>
              {killer.family && <div className="ds-killer-fam">of {killer.family}</div>}
            </div>
          ) : (
            <div style={{ marginBottom: 12 }}>
              {revealError && <div className="ds-err">{revealError}</div>}
              <button
                type="button"
                className="ds-reveal"
                onClick={handleRevealKiller}
                disabled={revealing}
              >
                {revealing ? 'Revealing…' : 'Reveal killer — 1,000 pts'}
              </button>
            </div>
          )}
          <div className="ds-stats">
            <div className="ds-stat"><span>Kills</span><strong>{kills.toLocaleString()}</strong></div>
            <div className="ds-stat"><span>Rank</span><strong>{rankName}</strong></div>
            <div className="ds-stat"><span>Cash taken</span><strong className="ds-stat-red">{formatMoney(cashLost)}</strong></div>
          </div>
        </div>

        <div className="ds-card ds-actions">
          <div className="ds-card-label">What happens next</div>
          <ol className="ds-steps">
            <li><span className="ds-num">1</span><span>Create a new account</span></li>
            <li><span className="ds-num">2</span><span>Log in on that living account</span></li>
            <li><span className="ds-num">3</span><span>Open Dead &gt; Alive and claim the estate</span></li>
          </ol>
          <p className="ds-note">
            Pocket cash is gone. Points and Swiss stay for Dead &gt; Alive on the living account.
          </p>
          <button
            type="button"
            className={`${styles.btnPrimary} ds-cta`}
            onClick={handleNewLife}
          >
            Start a new life
          </button>
        </div>
      </div>
    </div>
  );
}
