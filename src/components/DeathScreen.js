import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../utils/api';

const DEATH_STYLES = `
  @keyframes ds-fadeIn    { from { opacity: 0 } to { opacity: 1 } }
  @keyframes ds-fadeUp    { from { opacity: 0; transform: translateY(30px) } to { opacity: 1; transform: translateY(0) } }
  @keyframes ds-stoneRise { from { opacity: 0; transform: translateY(80px); filter: blur(4px) } to { opacity: 1; transform: translateY(0); filter: blur(0) } }
  @keyframes ds-expandX   { from { transform: scaleX(0); opacity: 0 } to { transform: scaleX(1); opacity: 1 } }
  @keyframes ds-twinkle   { from { opacity: 0.07; transform: scale(0.7) } to { opacity: 0.95; transform: scale(1.3) } }
  @keyframes ds-flicker   { 0% { transform: scale(1,1) skewX(0); opacity: .9 } 25% { transform: scale(.87,1.13) skewX(-2deg); opacity: 1 } 55% { transform: scale(1.06,.94) skewX(1deg); opacity: .84 } 100% { transform: scale(1,1) skewX(.4deg); opacity: .9 } }
  @keyframes ds-emberRise { 0% { transform: translateY(0) translateX(0); opacity: 0 } 8% { opacity: 1 } 90% { opacity: .15 } 100% { transform: translateY(-94vh) translateX(20px); opacity: 0 } }
  @keyframes ds-fogDrift  { from { transform: translateX(-4%) scaleX(1) } to { transform: translateX(4%) scaleX(1.06) } }
  @keyframes ds-crossGlow { from { filter: drop-shadow(0 0 3px rgba(184,145,68,.22)) } to { filter: drop-shadow(0 0 18px rgba(184,145,68,.72)) } }
  @keyframes ds-shimmer   { from { transform: translateX(-100%) } to { transform: translateX(200%) } }
  @keyframes ds-lightFlash { 0%,91%,93%,95%,100% { opacity: 0 } 92%,94% { opacity: 1 } }
  @keyframes ds-ravenFly  { from { transform: translateX(-50px); opacity: 0 } 10% { opacity: .35 } 90% { opacity: .35 } to { transform: translateX(110vw); opacity: 0 } }

  .ds-fade-in  { animation: ds-fadeIn 1s both }
  .ds-fade-in2 { animation: ds-fadeIn 1s 1.1s both }
  .ds-fade-in3 { animation: ds-fadeIn 1s 1.4s both }
  .ds-fade-in4 { animation: ds-fadeIn 1s 1.6s both }
  .ds-fade-in5 { animation: ds-fadeIn 1s 1.8s both }
  .ds-fade-in6 { animation: ds-fadeIn 1s 2.2s both }
  .ds-stone-rise { animation: ds-stoneRise 2.2s cubic-bezier(0.16,1,0.3,1) both }
  .ds-actions  { animation: ds-fadeUp .8s 2.2s both }
  .ds-revenge  { animation: ds-fadeUp .8s 2.5s both }
  .ds-expand   { animation: ds-expandX 1.3s 1.3s both }
  .ds-cross    { animation: ds-crossGlow 2.8s 1.8s ease-in-out infinite alternate }
  .ds-flicker  { animation: ds-flicker .98s ease-in-out infinite alternate }
  .ds-flicker2 { animation: ds-flicker .72s .28s ease-in-out infinite alternate }
`;

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
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, weekday: 'long' });
  } catch { return '—'; }
}

export default function DeathScreen({ user, onLogout }) {
  const starsRef = useRef(null);
  const embersRef = useRef(null);
  const navigate = useNavigate();
  const [killer, setKiller] = useState(
    user?.killer_revealed
      ? { username: user.killed_by_username, family: user.killed_by_family_name }
      : null
  );
  const [revealing, setRevealing] = useState(false);
  const [revealError, setRevealError] = useState(null);

  useEffect(() => {
    // Stars
    const starsEl = starsRef.current;
    if (starsEl) {
      for (let i = 0; i < 110; i++) {
        const s = document.createElement('div');
        const sz = Math.random() * 1.8 + 0.3;
        Object.assign(s.style, {
          position: 'absolute', borderRadius: '50%', background: 'white',
          width: sz + 'px', height: sz + 'px',
          top: Math.random() * 72 + '%', left: Math.random() * 100 + '%',
          animationName: 'ds-twinkle',
          animationDuration: (1.4 + Math.random() * 3.2) + 's',
          animationDelay: Math.random() * 5 + 's',
          animationTimingFunction: 'ease-in-out',
          animationIterationCount: 'infinite',
          animationDirection: 'alternate',
        });
        starsEl.appendChild(s);
      }
    }
    // Embers
    const embersEl = embersRef.current;
    if (embersEl) {
      const cols = ['rgba(184,145,68,.72)', 'rgba(200,162,78,.5)', 'rgba(220,185,90,.4)', 'rgba(184,145,68,.35)'];
      for (let i = 0; i < 20; i++) {
        const e = document.createElement('div');
        const sz = Math.random() * 2.5 + 0.7;
        const c = cols[Math.floor(Math.random() * cols.length)];
        Object.assign(e.style, {
          position: 'absolute', borderRadius: '50%',
          width: sz + 'px', height: sz + 'px',
          left: (8 + Math.random() * 84) + '%',
          bottom: (Math.random() * 14) + '%',
          background: c, boxShadow: `0 0 ${sz * 2}px ${c}`,
          animationName: 'ds-emberRise',
          animationDuration: (8 + Math.random() * 15) + 's',
          animationDelay: Math.random() * 13 + 's',
          animationTimingFunction: 'linear',
          animationIterationCount: 'infinite',
        });
        embersEl.appendChild(e);
      }
    }
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
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'radial-gradient(ellipse 100% 55% at 50% 0%, rgba(184,145,68,0.045) 0%, transparent 58%), radial-gradient(ellipse 80% 45% at 50% 100%, rgba(184,145,68,0.025) 0%, transparent 52%), linear-gradient(180deg, #0f0e13 0%, #13121a 100%)',
      overflowY: 'auto', overflowX: 'hidden',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: '60px 20px',
    }}>
      <style>{DEATH_STYLES}</style>

      {/* Lightning flash */}
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', background: 'rgba(210,205,240,0.022)', animation: 'ds-lightFlash 12s 4s infinite', zIndex: 4 }} />

      {/* Stars */}
      <div ref={starsRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }} />

      {/* Embers */}
      <div ref={embersRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }} />

      {/* Moon */}
      <div style={{
        position: 'absolute', top: 52, right: 72, width: 56, height: 56,
        borderRadius: '50%',
        background: 'radial-gradient(circle at 38% 35%, #f0ead8 55%, #bca880 100%)',
        boxShadow: '0 0 36px rgba(240,234,216,.1), 0 0 90px rgba(240,234,216,.04)',
        animation: 'ds-fadeIn 3.5s .5s both', pointerEvents: 'none',
      }} />

      {/* Raven */}
      <svg style={{ position: 'absolute', top: '20%', width: 26, height: 9, animation: 'ds-ravenFly linear 16s 4s both', pointerEvents: 'none' }}>
        <path d="M0,5 Q6,0 13,4 Q19,0 26,4" stroke="rgba(220,216,230,0.18)" strokeWidth="1" fill="none" />
      </svg>

      {/* Fog */}
      <div style={{ position: 'absolute', bottom: 0, left: '-20%', right: '-20%', pointerEvents: 'none' }}>
        <div style={{ height: 145, background: 'radial-gradient(ellipse at 50% 100%, rgba(184,145,68,.027) 0%, transparent 70%)', animation: 'ds-fogDrift 9s ease-in-out infinite alternate' }} />
      </div>

      {/* Main content */}
      <div style={{ position: 'relative', zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', maxWidth: 460 }}>

        {/* Stone monument */}
        <div className="ds-stone-rise" style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{
            width: '100%', maxWidth: 375,
            background: 'linear-gradient(158deg, #2c2a32 0%, #1c1a22 42%, #111019 100%)',
            border: '1px solid rgba(184,145,68,0.15)',
            boxShadow: '0 0 0 1px rgba(0,0,0,.95), -6px 0 20px rgba(0,0,0,.5), 6px 0 20px rgba(0,0,0,.5), 0 60px 120px rgba(0,0,0,.98), inset 0 1px 0 rgba(255,255,255,.04), inset 0 -2px 0 rgba(0,0,0,.4)',
            padding: '40px 36px 44px',
            clipPath: 'polygon(0% 8%, 4% 0%, 96% 0%, 100% 8%, 100% 100%, 0% 100%)',
            position: 'relative',
          }}>
            {/* Top gold bar */}
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'linear-gradient(90deg, transparent, rgba(184,145,68,.5), transparent)' }} />
            {/* Inner border */}
            <div style={{ position: 'absolute', inset: 9, border: '1px solid rgba(184,145,68,.055)', clipPath: 'polygon(0% 10%, 5% 0%, 95% 0%, 100% 10%, 100% 100%, 0% 100%)', pointerEvents: 'none' }} />

            {/* Cross */}
            <div className="ds-cross" style={{ textAlign: 'center', marginBottom: 14 }}>
              <svg width="44" height="54" viewBox="0 0 44 54">
                <circle cx="22" cy="18" r="10" fill="none" stroke="rgba(184,145,68,.1)" strokeWidth=".8" />
                <line x1="22" y1="2" x2="22" y2="52" stroke="rgba(184,145,68,.28)" strokeWidth="1.5" />
                <line x1="8" y1="18" x2="36" y2="18" stroke="rgba(184,145,68,.28)" strokeWidth="1.5" />
                <line x1="6" y1="15" x2="8" y2="18" stroke="rgba(184,145,68,.11)" strokeWidth=".8" />
                <line x1="6" y1="21" x2="8" y2="18" stroke="rgba(184,145,68,.11)" strokeWidth=".8" />
                <line x1="38" y1="15" x2="36" y2="18" stroke="rgba(184,145,68,.11)" strokeWidth=".8" />
                <line x1="38" y1="21" x2="36" y2="18" stroke="rgba(184,145,68,.11)" strokeWidth=".8" />
                <line x1="19" y1="2" x2="25" y2="2" stroke="rgba(184,145,68,.1)" strokeWidth=".8" />
              </svg>
            </div>

            {/* Candles */}
            <div className="ds-fade-in" style={{ display: 'flex', justifyContent: 'center', gap: 96, marginBottom: 14 }}>
              {[32, 22].map((h, i) => (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: i === 1 ? 10 : 0 }}>
                  <div style={{ position: 'relative', width: 9, height: 15, background: 'radial-gradient(ellipse at 50% 78%, #fff 0%, #ffe566 20%, #ff8c00 62%, transparent 100%)', borderRadius: '50% 50% 30% 30%', filter: 'blur(.35px)' }}
                    className={i === 0 ? 'ds-flicker' : 'ds-flicker2'}>
                    <div style={{ position: 'absolute', width: 22, height: 22, borderRadius: '50%', background: 'radial-gradient(circle, rgba(184,145,68,.24) 0%, transparent 70%)', top: -5, left: -7 }} />
                  </div>
                  <div style={{ width: 7, height: h, background: 'linear-gradient(180deg, #ddd0bc, #aa9878)', position: 'relative' }} />
                  <div style={{ width: 11, height: 5, background: 'linear-gradient(180deg, #988870, #787058)', borderRadius: '0 0 2px 2px' }} />
                </div>
              ))}
            </div>

            {/* RIP */}
            <div className="ds-fade-in" style={{ fontFamily: 'serif', fontSize: 10, letterSpacing: '.6em', color: 'rgba(184,145,68,.4)', textAlign: 'center', textTransform: 'uppercase', marginBottom: 8 }}>
              R · I · P
            </div>

            {/* Username */}
            <div className="ds-fade-in2" style={{ fontFamily: 'serif', fontSize: 'clamp(24px,5.5vw,34px)', fontWeight: 700, color: 'rgba(220,216,230,.92)', textAlign: 'center', letterSpacing: '.05em', textShadow: '0 2px 26px rgba(0,0,0,.95)', marginBottom: 4 }}>
              {username}
            </div>

            {/* Rank · Family */}
            <div className="ds-fade-in2" style={{ fontFamily: 'serif', fontSize: 13, fontStyle: 'italic', color: 'rgba(184,145,68,.5)', textAlign: 'center', marginBottom: 20 }}>
              {rankName}{familyName ? ` · ${familyName}` : ''}
            </div>

            {/* Rule */}
            <hr className="ds-expand" style={{ border: 'none', height: 1, background: 'linear-gradient(90deg, transparent, rgba(184,145,68,.22), transparent)', margin: '0 0 18px' }} />

            {/* Epitaph */}
            <div className="ds-fade-in3" style={{ fontFamily: 'serif', fontSize: 14.5, fontStyle: 'italic', color: 'rgba(220,216,230,.28)', textAlign: 'center', lineHeight: 1.92, marginBottom: 20 }}>
              {cashLost > 0
                ? <>Struck down in the shadows.<br />Everything was taken.<br />Even the empire you built.</>
                : <>He came. He fell.<br />The streets swallowed him whole.<br />No one saw a thing.</>
              }
            </div>

            {/* Killer reveal */}
            <div className="ds-fade-in3" style={{ marginBottom: 20, width: '100%' }}>
              {killer ? (
                <div style={{ background: 'rgba(130,25,25,.08)', border: '1px solid rgba(170,45,45,.25)', padding: '14px 18px', textAlign: 'center' }}>
                  <div style={{ fontFamily: 'serif', fontSize: 9, letterSpacing: '.2em', textTransform: 'uppercase', color: 'rgba(180,55,55,.45)', marginBottom: 8 }}>Killed By</div>
                  <button
                    type="button"
                    onClick={() => navigate(`/profile/${encodeURIComponent(killer.username)}`)}
                    style={{ fontFamily: 'serif', fontSize: 18, fontWeight: 700, color: 'rgba(220,100,100,.85)', letterSpacing: '.04em', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textShadow: '0 0 18px rgba(180,55,55,.4)' }}
                    onMouseEnter={e => { e.currentTarget.style.color = 'rgba(220,100,100,1)'; }}
                    onMouseLeave={e => { e.currentTarget.style.color = 'rgba(220,100,100,.85)'; }}
                  >
                    {killer.username}
                  </button>
                  {killer.family && (
                    <div style={{ fontFamily: 'serif', fontSize: 11, fontStyle: 'italic', color: 'rgba(220,216,230,.25)', marginTop: 4 }}>of {killer.family}</div>
                  )}
                </div>
              ) : (
                <div style={{ textAlign: 'center' }}>
                  {revealError && (
                    <div style={{ fontFamily: 'serif', fontSize: 11, color: 'rgba(180,55,55,.7)', marginBottom: 8, fontStyle: 'italic' }}>{revealError}</div>
                  )}
                  <button
                    type="button"
                    onClick={handleRevealKiller}
                    disabled={revealing}
                    style={{ padding: '10px 22px', fontFamily: 'serif', fontSize: 9, letterSpacing: '.2em', textTransform: 'uppercase', cursor: revealing ? 'default' : 'pointer', background: 'rgba(18,16,22,.8)', border: '1px solid rgba(184,145,68,.18)', color: revealing ? 'rgba(184,145,68,.25)' : 'rgba(184,145,68,.55)', transition: 'all .25s', opacity: revealing ? 0.6 : 1 }}
                    onMouseEnter={e => { if (!revealing) { e.currentTarget.style.borderColor = 'rgba(184,145,68,.38)'; e.currentTarget.style.color = 'rgba(184,145,68,.8)'; } }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(184,145,68,.18)'; e.currentTarget.style.color = 'rgba(184,145,68,.55)'; }}
                  >
                    {revealing ? 'Revealing...' : '🔍 Reveal Killer — 1,000 pts'}
                  </button>
                </div>
              )}
            </div>

            {/* Stats */}
            <div className="ds-fade-in4" style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 1, background: 'rgba(184,145,68,.08)', border: '1px solid rgba(184,145,68,.08)', marginBottom: 20 }}>
              {[
                { label: 'Kills', value: kills.toLocaleString(), red: false },
                { label: 'Rank', value: rankName, red: false },
                { label: 'Cash Lost', value: formatMoney(cashLost), red: true },
              ].map(({ label, value, red }) => (
                <div key={label} style={{ background: 'rgba(10,9,14,.8)', padding: '10px 6px', textAlign: 'center' }}>
                  <div style={{ fontFamily: 'serif', fontSize: 6.5, letterSpacing: '.18em', textTransform: 'uppercase', color: 'rgba(184,145,68,.3)', marginBottom: 4 }}>{label}</div>
                  <div style={{ fontFamily: 'serif', fontSize: 11, color: red ? 'rgba(180,55,55,.65)' : 'rgba(220,216,230,.5)', letterSpacing: '.03em' }}>{value}</div>
                </div>
              ))}
            </div>

            {/* Dates */}
            <div className="ds-fade-in5" style={{ display: 'flex', justifyContent: 'center', gap: 10, fontFamily: 'serif', fontSize: 8, letterSpacing: '.2em', color: 'rgba(220,216,230,.13)' }}>
              Joined <span style={{ color: 'rgba(184,145,68,.22)' }}>·</span> {formatDate(createdAt)}
              &nbsp;—&nbsp; Killed <span style={{ color: 'rgba(184,145,68,.22)' }}>·</span> {formatDate(deadAt)}
            </div>
          </div>

          {/* Stone base layers */}
          <div style={{ width: '100%', maxWidth: 415, height: 20, background: 'linear-gradient(180deg,#222028,#141218)', border: '1px solid rgba(184,145,68,.08)', borderTop: 'none', boxShadow: '0 10px 36px rgba(0,0,0,.8)' }} />
          <div style={{ width: '100%', maxWidth: 455, height: 12, background: 'linear-gradient(180deg,#161420,#0d0c12)', border: '1px solid rgba(184,145,68,.05)', borderTop: 'none' }} />
          <div style={{ width: '100%', maxWidth: 515, height: 8, background: '#09080c', borderTop: '1px solid rgba(184,145,68,.03)' }} />
        </div>

        {/* Action buttons */}
        <div className="ds-actions" style={{ display: 'flex', gap: 12, marginTop: 32, width: '100%', maxWidth: 375 }}>
          <button
            type="button"
            onClick={handleNewLife}
            style={{ flex: 1, padding: 13, fontFamily: 'serif', fontSize: 8.5, letterSpacing: '.22em', textTransform: 'uppercase', cursor: 'pointer', background: 'rgba(184,145,68,.1)', border: '1px solid rgba(184,145,68,.35)', color: 'var(--noir-primary-bright)', position: 'relative', overflow: 'hidden', transition: 'all .25s' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(184,145,68,.2)'; e.currentTarget.style.boxShadow = '0 0 24px rgba(184,145,68,.12)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(184,145,68,.1)'; e.currentTarget.style.boxShadow = 'none'; }}
          >
            <span style={{ position: 'absolute', top: 0, left: 0, width: '40%', height: '100%', background: 'linear-gradient(90deg, transparent, rgba(184,145,68,.1), transparent)', animation: 'ds-shimmer 3.5s 2.5s infinite' }} />
            New Life
          </button>
        </div>

        {/* Time of death */}
        <div className="ds-fade-in6" style={{ marginTop: 22, fontFamily: 'serif', fontSize: 7.5, letterSpacing: '.25em', color: 'rgba(220,216,230,.08)', textTransform: 'uppercase', textAlign: 'center' }}>
          Time of death &nbsp;<span style={{ color: 'rgba(184,145,68,.2)' }}>{formatTime(deadAt)}</span>
        </div>

        {/* Dead Alive link */}
        <div className="ds-fade-in6" style={{ marginTop: 24 }}>
          <Link
            to="/dead-alive"
            style={{ fontFamily: 'serif', fontSize: 9, letterSpacing: '.18em', textTransform: 'uppercase', color: 'rgba(184,145,68,.22)', textDecoration: 'none', borderBottom: '1px solid rgba(184,145,68,.1)', paddingBottom: 1 }}
            onMouseEnter={e => { e.currentTarget.style.color = 'rgba(184,145,68,.5)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'rgba(184,145,68,.22)'; }}
          >
            Transfer estate to new account →
          </Link>
        </div>
      </div>
    </div>
  );
}
