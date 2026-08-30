import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';
import { formatGameTimeWeekday } from '../utils/gameDateTime';

const DEATH_STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@500;700;800&family=Cormorant+Garamond:ital,wght@0,500;0,600;0,700;1,500;1,600&display=swap');

  [data-death-screen].ds-root {
    position: fixed;
    inset: 0;
    z-index: 9999;
    overflow-x: hidden;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    padding: max(8px, env(safe-area-inset-top)) 12px max(28px, env(safe-area-inset-bottom));
    background: #0a0a0c;
    color: #ebe6d8;
  }

  @keyframes ds-rise { from { transform: translateY(36px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
  @keyframes ds-fog { from { transform: translateX(-8%) } to { transform: translateX(8%) } }
  @keyframes ds-rain { from { transform: translate3d(0,-80px,0) } to { transform: translate3d(-18px,110vh,0) } }
  @keyframes ds-glow { from { opacity: .35 } to { opacity: .85 } }
  @keyframes ds-flash { 0%,88%,92%,96%,100% { opacity: 0 } 90%,94% { opacity: .11 } }
  @keyframes ds-smoke { 0% { transform: translateY(0) scaleX(1); opacity: .28 } 100% { transform: translateY(-46px) scaleX(1.5); opacity: 0 } }
  @keyframes ds-mist { from { opacity: .18 } to { opacity: .42 } }

  .ds-world { position: fixed; inset: 0; pointer-events: none; z-index: 0; overflow: hidden; background: #0a0a0c }
  .ds-world-photo {
    position: absolute; inset: -6%;
    width: 112%; height: 112%;
    object-fit: cover; object-position: center 42%;
    filter: brightness(.34) saturate(.62) contrast(1.06);
  }
  .ds-world-scrim {
    position: absolute; inset: 0;
    background:
      radial-gradient(ellipse 130% 90% at 50% 38%, rgba(0,0,0,.08) 0%, rgba(0,0,0,.42) 58%, rgba(0,0,0,.72) 100%),
      linear-gradient(180deg, rgba(0,0,0,.18) 0%, rgba(0,0,0,.28) 45%, rgba(0,0,0,.48) 100%);
  }
  .ds-vignette {
    position: absolute; inset: 0;
    box-shadow: inset 0 0 100px 24px rgba(0,0,0,.55);
  }
  .ds-raindrop {
    position: absolute; top: -12%; width: 1.2px;
    background: linear-gradient(180deg, transparent, rgba(220,226,236,.34) 40%, rgba(220,226,236,.05));
    animation: ds-rain linear infinite;
    transform: rotate(8deg);
  }
  .ds-flash {
    position: absolute; inset: 0;
    background: rgba(228,226,245,.14);
    animation: ds-flash 18s 4s infinite;
  }
  .ds-fog {
    position: absolute; left: -20%; right: -20%; pointer-events: none;
    animation: ds-fog 16s ease-in-out infinite alternate;
  }
  .ds-fog-lo {
    bottom: 0; height: 34%;
    background: radial-gradient(ellipse at 50% 110%, rgba(88,84,72,.5) 0%, transparent 70%);
  }
  .ds-fog-mid {
    bottom: 10%; height: 26%; opacity: .7;
    background: radial-gradient(ellipse at 38% 100%, rgba(50,48,42,.38) 0%, transparent 72%);
    animation-duration: 22s;
  }

  .ds-col {
    position: relative; z-index: 10; width: 100%; max-width: 440px;
    display: flex; flex-direction: column; align-items: center;
  }

  .ds-monument {
    position: relative; width: min(100%, 400px);
    margin-top: 4px;
    animation: ds-rise 1.2s cubic-bezier(.16,1,.3,1) both;
    filter: drop-shadow(0 24px 32px rgba(0,0,0,.65));
  }
  .ds-headstone-img {
    width: 100%; display: block; user-select: none; pointer-events: none;
    -webkit-mask-image:
      linear-gradient(180deg, #000 0%, #000 68%, transparent 96%),
      linear-gradient(90deg, transparent 0%, #000 10%, #000 90%, transparent 100%);
    mask-image:
      linear-gradient(180deg, #000 0%, #000 68%, transparent 96%),
      linear-gradient(90deg, transparent 0%, #000 10%, #000 90%, transparent 100%);
    -webkit-mask-composite: source-in;
    mask-composite: intersect;
  }
  .ds-monument::after {
    content: '';
    position: absolute; left: 8%; right: 8%; bottom: 0; height: 28%;
    background: linear-gradient(180deg, transparent, rgba(10,10,12,.85));
    pointer-events: none;
  }
  .ds-carve {
    position: absolute;
    left: 23%; right: 23%; top: 27%; height: 30%;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    text-align: center; pointer-events: none;
  }
  .ds-carve-rip {
    font-family: 'Cinzel', 'Times New Roman', serif;
    font-size: 10px; font-weight: 700; letter-spacing: .42em;
    color: #b7ae93; margin-bottom: 5px;
    text-shadow: 0 1px 0 rgba(255,255,255,.08), 0 -1px 0 rgba(0,0,0,.65);
  }
  .ds-carve-name {
    font-family: 'Cormorant Garamond', Georgia, serif;
    font-weight: 700; line-height: .95; letter-spacing: .02em;
    color: #efe6cc;
    text-shadow:
      0 1px 0 rgba(255,248,220,.16),
      0 -1px 1px rgba(0,0,0,.7),
      0 8px 18px rgba(0,0,0,.35);
  }
  .ds-carve-rank {
    font-family: 'Cinzel', serif;
    font-size: 10px; letter-spacing: .2em; text-transform: uppercase;
    color: #c4b48a; margin-top: 6px;
    text-shadow: 0 1px 0 rgba(0,0,0,.7);
  }
  .ds-carve-epitaph {
    font-family: 'Cormorant Garamond', Georgia, serif;
    font-style: italic; font-size: 11px; line-height: 1.25;
    color: #9c937c; margin-top: 7px; max-width: 92%;
    text-shadow: 0 1px 0 rgba(0,0,0,.55);
  }
  .ds-carve-dates {
    font-family: 'Cinzel', serif;
    font-size: 7.5px; letter-spacing: .16em; text-transform: uppercase;
    color: #8f866e; margin-top: 6px;
    text-shadow: 0 1px 0 rgba(0,0,0,.6);
  }

  .ds-smoke {
    position: absolute; width: 18px; height: 40px; pointer-events: none;
    background: radial-gradient(ellipse at 50% 100%, rgba(210,200,180,.22), transparent 70%);
    animation: ds-smoke 2.8s ease-out infinite;
    filter: blur(3px);
  }
  .ds-smoke-l { left: 16%; top: 58%; }
  .ds-smoke-r { right: 16%; top: 60%; animation-delay: .7s }

  .ds-glow-pool {
    position: absolute; width: 72px; height: 54px; pointer-events: none;
    background: radial-gradient(circle, rgba(255,150,50,.22) 0%, transparent 70%);
    animation: ds-glow 1.1s ease-in-out infinite alternate;
    mix-blend-mode: screen;
  }
  .ds-glow-l { left: 8%; top: 58%; }
  .ds-glow-r { right: 8%; top: 60%; animation-duration: 1.35s }

  .ds-skull {
    position: absolute;
    left: 50%;
    bottom: 1.5%;
    transform: translateX(-50%);
    width: 19%;
    min-width: 52px;
    max-width: 78px;
    z-index: 6;
    pointer-events: none;
    filter: drop-shadow(0 8px 14px rgba(0,0,0,.75)) brightness(.92) contrast(1.05);
    opacity: .94;
  }

  .ds-plaque {
    width: 100%;
    margin-top: 14px;
    padding: 16px 16px 15px;
    position: relative;
    border: 1px solid rgba(148, 144, 136, .28);
    background:
      linear-gradient(175deg, rgba(88, 86, 80, .94) 0%, rgba(52, 50, 48, .96) 42%, rgba(38, 36, 34, .97) 100%),
      repeating-linear-gradient(93deg, transparent, transparent 3px, rgba(255,255,255,.018) 3px, rgba(255,255,255,.018) 4px),
      repeating-linear-gradient(3deg, transparent, transparent 4px, rgba(0,0,0,.035) 4px, rgba(0,0,0,.035) 5px);
    box-shadow:
      inset 0 1px 0 rgba(255,255,255,.07),
      inset 0 -3px 12px rgba(0,0,0,.35),
      0 18px 36px rgba(0,0,0,.55);
    animation: ds-rise .75s ease-out both;
  }
  .ds-plaque::before {
    content: '';
    position: absolute; inset: 6px;
    border: 1px solid rgba(200, 196, 186, .1);
    pointer-events: none;
  }
  .ds-corner {
    position: absolute; width: 11px; height: 11px; border-color: rgba(196, 192, 182, .32);
  }
  .ds-corner-tl { top: 3px; left: 3px; border-top: 2px solid; border-left: 2px solid }
  .ds-corner-tr { top: 3px; right: 3px; border-top: 2px solid; border-right: 2px solid }
  .ds-corner-bl { bottom: 3px; left: 3px; border-bottom: 2px solid; border-left: 2px solid }
  .ds-corner-br { bottom: 3px; right: 3px; border-bottom: 2px solid; border-right: 2px solid }

  .ds-plaque-label {
    font-family: 'Cinzel', serif;
    font-size: 10px; letter-spacing: .3em; text-transform: uppercase;
    color: #c4bdb0; margin-bottom: 12px; text-align: center;
    text-shadow: 0 1px 0 rgba(0,0,0,.65), 0 -1px 0 rgba(255,255,255,.04);
  }
  .ds-killer {
    text-align: center; padding: 13px 12px 11px; margin-bottom: 12px;
    background:
      radial-gradient(ellipse at 50% 0%, rgba(140, 18, 18, .38) 0%, transparent 70%),
      rgba(28, 8, 8, .62);
    border: 1px solid rgba(168, 48, 48, .42);
    box-shadow: inset 0 0 22px rgba(0,0,0,.45);
  }
  .ds-killer-mark {
    font-family: 'Cinzel', serif; font-size: 9px; letter-spacing: .26em;
    color: #c07070; text-transform: uppercase; margin-bottom: 6px;
  }
  .ds-killer button {
    font-family: 'Cormorant Garamond', Georgia, serif;
    font-size: 28px; font-weight: 700; letter-spacing: .03em;
    color: #e87878; background: none; border: none; cursor: pointer; padding: 0;
    text-shadow: 0 0 20px rgba(160, 20, 20, .5);
  }
  .ds-killer button:hover { color: #f6b0b0; }
  .ds-killer-fam {
    font-family: 'Cormorant Garamond', Georgia, serif;
    font-size: 14px; font-style: italic; color: #c2b8a6; margin-top: 4px;
  }
  .ds-reveal {
    width: 100%;
    font-family: 'Cinzel', serif;
    font-size: 11px; letter-spacing: .12em; text-transform: uppercase;
    padding: 12px 12px; cursor: pointer;
    background: linear-gradient(180deg, rgba(72, 70, 66, .95), rgba(42, 40, 38, .98));
    border: 1px solid rgba(160, 156, 148, .35);
    color: #d8d0c0;
    box-shadow: inset 0 1px 0 rgba(255,255,255,.06);
  }
  .ds-reveal:hover:not(:disabled) { border-color: rgba(200, 196, 186, .5); color: #efe8dc }
  .ds-reveal:disabled { opacity: .55; cursor: default }
  .ds-err {
    font-family: 'Cormorant Garamond', Georgia, serif;
    font-size: 13px; color: #d07070; text-align: center; margin-bottom: 8px;
  }
  .ds-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px }
  .ds-stat {
    text-align: center; padding: 10px 4px 9px;
    background: rgba(0,0,0,.22);
    border: 1px solid rgba(160, 156, 148, .16);
  }
  .ds-stat span {
    display: block; font-family: 'Cinzel', serif;
    font-size: 8px; letter-spacing: .18em; text-transform: uppercase;
    color: #8a8578; margin-bottom: 5px;
  }
  .ds-stat strong {
    font-family: 'Cormorant Garamond', Georgia, serif;
    font-size: 17px; font-weight: 700; color: #efe6cc;
  }
  .ds-stat strong.ds-stat-red { color: #d07070 }

  .ds-steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px }
  .ds-steps li {
    display: flex; gap: 11px; align-items: center;
    font-family: 'Cormorant Garamond', Georgia, serif;
    font-size: 16px; color: #e4dcc8;
  }
  .ds-num {
    flex: 0 0 22px; height: 22px; border-radius: 50%;
    display: inline-flex; align-items: center; justify-content: center;
    font-family: 'Cinzel', serif; font-size: 10px; font-weight: 700;
    color: #2a2824;
    background: radial-gradient(circle at 35% 30%, #d4cdc0, #8a8478 72%);
    box-shadow: inset 0 1px 0 rgba(255,255,255,.25), 0 2px 6px rgba(0,0,0,.35);
  }
  .ds-note {
    font-family: 'Cormorant Garamond', Georgia, serif;
    font-size: 13px; font-style: italic; line-height: 1.45; color: #9a958a; margin: 14px 0 0; text-align: center;
  }
  .ds-cta {
    width: 100%; margin-top: 15px; padding: 14px 16px;
    font-family: 'Cinzel', serif;
    font-size: 12px; font-weight: 800; letter-spacing: .18em; text-transform: uppercase;
    color: #ece6d8;
    cursor: pointer;
    border: 1px solid rgba(180, 176, 166, .35);
    background:
      linear-gradient(180deg, rgba(96, 94, 88, .98) 0%, rgba(58, 56, 52, .99) 55%, rgba(42, 40, 38, 1) 100%);
    box-shadow:
      inset 0 1px 0 rgba(255,255,255,.12),
      inset 0 -2px 0 rgba(0,0,0,.35),
      0 10px 24px rgba(0,0,0,.45);
    text-shadow: 0 1px 0 rgba(0,0,0,.5);
  }
  .ds-cta:hover { filter: brightness(1.08) }

  @media (max-width: 480px) {
    .ds-killer button { font-size: 24px }
    .ds-carve-epitaph { font-size: 10px }
  }

  @media (prefers-reduced-motion: reduce) {
    .ds-monument, .ds-plaque, .ds-raindrop, .ds-fog, .ds-flash, .ds-smoke, .ds-glow-pool { animation: none !important }
    .ds-flash, .ds-raindrop, .ds-smoke { display: none !important }
  }
`;

const RAIN = [
  ['6%', '88px', '1.05s', '0s'], ['14%', '64px', '.88s', '.25s'], ['22%', '76px', '1.2s', '.1s'],
  ['31%', '52px', '.95s', '.55s'], ['39%', '90px', '1.15s', '.05s'], ['48%', '70px', '.82s', '.4s'],
  ['57%', '84px', '1.08s', '.2s'], ['66%', '58px', '.9s', '.65s'], ['74%', '78px', '1.22s', '.15s'],
  ['83%', '66px', '.98s', '.45s'], ['91%', '80px', '1.12s', '.3s'], ['11%', '48px', '1.35s', '.8s'],
  ['44%', '94px', '1.28s', '.7s'], ['69%', '54px', '.86s', '.9s'],
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

function prefersReducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function wrapName(name) {
  const s = String(name || '—');
  if (s.length <= 14) return [s];
  const mid = Math.ceil(s.length / 2);
  const cut = s.lastIndexOf(' ', mid) > 4 ? s.lastIndexOf(' ', mid) : mid;
  return [s.slice(0, cut).trim(), s.slice(cut).trim()].filter(Boolean);
}

function Plaque({ children, className = '' }) {
  return (
    <div className={`ds-plaque ${className}`}>
      <span className="ds-corner ds-corner-tl" />
      <span className="ds-corner ds-corner-tr" />
      <span className="ds-corner ds-corner-bl" />
      <span className="ds-corner ds-corner-br" />
      {children}
    </div>
  );
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
  const nameLines = wrapName(username);
  const nameSize = username.length > 16 ? 26 : username.length > 11 ? 32 : 40;
  const epitaph = cashLost > 0
    ? ['Struck down in the shadows.', 'Everything on hand was taken.']
    : ['He came. He fell.', 'The streets swallowed him whole.'];
  const stoneSub = [rankName, familyName].filter(Boolean).join('  ·  ');

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
    <div data-app-shell="1" data-death-screen data-testid="death-screen" className="ds-root">
      <style>{DEATH_STYLES}</style>

      <div className="ds-world" aria-hidden>
        <img className="ds-world-photo" src="/images/death/cemetery-night.jpg" alt="" />
        <div className="ds-world-scrim" />
        <div className="ds-vignette" />
        {!reduceMotion && RAIN.map(([left, height, dur, delay], i) => (
          <span
            key={i}
            className="ds-raindrop"
            style={{ left, height, animationDuration: dur, animationDelay: delay }}
          />
        ))}
        {!reduceMotion && <div className="ds-flash" />}
        <div className="ds-fog ds-fog-mid" />
        <div className="ds-fog ds-fog-lo" />
      </div>

      <div className="ds-col">
        <div className="ds-monument">
          <img
            className="ds-headstone-img"
            src="/images/death/headstone.jpg"
            alt={`Headstone for ${username}`}
          />
          <div className="ds-carve">
            <div className="ds-carve-rip">R · I · P</div>
            {nameLines.map((line) => (
              <div key={line} className="ds-carve-name" style={{ fontSize: nameSize }}>
                {line}
              </div>
            ))}
            <div className="ds-carve-rank">{stoneSub}</div>
            <div className="ds-carve-epitaph">
              {epitaph.map((line) => (
                <div key={line}>{line}</div>
              ))}
            </div>
            <div className="ds-carve-dates">
              {`Joined ${formatDate(createdAt)}  —  Killed ${formatDate(deadAt)}`}
              <br />
              {formatGameTimeWeekday(deadAt)}
            </div>
          </div>
          {!reduceMotion && (
            <>
              <span className="ds-glow-pool ds-glow-l" />
              <span className="ds-glow-pool ds-glow-r" />
              <span className="ds-smoke ds-smoke-l" />
              <span className="ds-smoke ds-smoke-r" />
            </>
          )}
          <img
            className="ds-skull"
            src="/images/death/skull.png"
            alt=""
            aria-hidden
          />
        </div>

        <Plaque>
          <div className="ds-plaque-label">How you fell</div>
          {killer ? (
            <div className="ds-killer">
              <div className="ds-killer-mark">Struck down by</div>
              <button type="button" onClick={() => navigate(`/profile/${encodeURIComponent(killer.username)}`)}>
                {killer.username}
              </button>
              {killer.family && <div className="ds-killer-fam">of {killer.family}</div>}
            </div>
          ) : (
            <div style={{ marginBottom: 12 }}>
              {revealError && <div className="ds-err">{revealError}</div>}
              <button type="button" className="ds-reveal" onClick={handleRevealKiller} disabled={revealing}>
                {revealing ? 'Revealing…' : 'Reveal killer — 1,000 pts'}
              </button>
            </div>
          )}
          <div className="ds-stats">
            <div className="ds-stat"><span>Kills</span><strong>{kills.toLocaleString()}</strong></div>
            <div className="ds-stat"><span>Rank</span><strong>{rankName}</strong></div>
            <div className="ds-stat"><span>Cash taken</span><strong className="ds-stat-red">{formatMoney(cashLost)}</strong></div>
          </div>
        </Plaque>

        <Plaque className="ds-actions">
          <div className="ds-plaque-label">What happens next</div>
          <ol className="ds-steps">
            <li><span className="ds-num">1</span><span>Create a new account</span></li>
            <li><span className="ds-num">2</span><span>Log in on that living account</span></li>
            <li><span className="ds-num">3</span><span>Open Dead &gt; Alive and claim the estate</span></li>
          </ol>
          <p className="ds-note">
            Pocket cash is gone. Points and Swiss stay for Dead &gt; Alive on the living account.
          </p>
          <button type="button" className="ds-cta" onClick={handleNewLife}>
            Start a new life
          </button>
        </Plaque>
      </div>
    </div>
  );
}
