import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Crown, Gamepad2, Lock, Map as MapIcon, Pause, Play, Shirt, Star, Trophy, Volume2, VolumeX, X } from 'lucide-react';
import { toast } from 'sonner';
import api, { apiRequestWith429Retry, getApiErrorMessage, refreshUser } from '../../utils/api';
import { publicAsset } from '../../utils/publicAssets';
import styles from '../../styles/noir.module.css';
import { createGame, setWant, step, summary } from './rrPacman/engine';
import { createRenderer } from './rrPacman/renderer';
import { BANNERS, LOGO_URL, loadBanners, loadBoss, loadCore, loadSkin, loadTiles, pickAtlasSize } from './rrPacman/sprites';
import { attachInput, vibrate } from './rrPacman/input';
import { isMuted, play as playSfx, setMuted, unlockAudio } from './rrPacman/sfx';
import { CAMPAIGN_LEVELS, LEVELS_PER_WORLD, WORLDS, isBossLevel, worldIndexForCampaign, worldIndexForEndless } from './rrPacman/tuning';

let _staffOkCache = null;
const STEP_MS = 1000 / 60;
const DPAD_KEY = 'rrpm_dpad';
const SKIN_PREVIEW = {
  classic: publicAsset('/images/chicken-cross/roadrunner/idle_01.png'),
  mafia: publicAsset('/images/rr-pacman/skins/mafia/idle_01.png'),
  cop: publicAsset('/images/rr-pacman/skins/cop/idle_01.png'),
  gold: publicAsset('/images/rr-pacman/skins/gold/idle_01.png'),
};
const SKIN_LABEL = { classic: 'Classic', mafia: 'Mafia', cop: 'Cop', gold: 'Gold' };
const SOUND_EVENTS = new Set(['seed', 'bag', 'enemy', 'bonus', 'powerup', 'extralife', 'death', 'clear', 'gameover', 'missile', 'blast', 'stomp', 'bosshit', 'shield_pop']);
const isTouch = () => typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);
const isIOS = () => typeof navigator !== 'undefined' && /iP(hone|ad|od)/.test(navigator.userAgent);

function GameView({ mode, level, skin, best, onOver }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const gameRef = useRef(null);
  const pausedRef = useRef(false);
  const [paused, setPaused] = useState(false);
  const [loading, setLoading] = useState(true);
  const [muted, setMutedState] = useState(isMuted());
  const [dpad, setDpad] = useState(() => {
    try { return localStorage.getItem(DPAD_KEY) === '1'; } catch (_) { return false; }
  });
  const onOverRef = useRef(onOver);
  onOverRef.current = onOver;

  const setPause = useCallback((v) => {
    pausedRef.current = v;
    setPaused(v);
  }, []);

  const finishNow = useCallback(() => {
    const g = gameRef.current;
    if (!g || g.submitted) return;
    g.submitted = true;
    onOverRef.current(summary(g));
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    const renderer = createRenderer(canvas);
    const size = pickAtlasSize();
    const assets = { core: null, boss: null, skin: null, tiles: {}, banners: null };
    const g = createGame({ mode, level });
    gameRef.current = g;
    const ui = { mode, best };
    let raf = 0;
    let disposed = false;
    let last = performance.now();
    let acc = 0;
    let slowFrames = 0;
    let overAt = 0;

    const ensureWorld = (lv) => {
      const wi = mode === 'campaign' ? worldIndexForCampaign(lv) : worldIndexForEndless(lv);
      [wi, (wi + 1) % WORLDS.length].forEach((i) => {
        const id = WORLDS[i].id;
        if (!assets.tiles[id]) loadTiles(id).then((t) => { assets.tiles[id] = t; }).catch(() => {});
      });
      if ((isBossLevel(lv) || isBossLevel(lv + 1)) && !assets.boss) loadBoss(size).then((b) => { assets.boss = b; }).catch(() => {});
    };

    const fit = () => {
      const r = wrap.getBoundingClientRect();
      renderer.resize(r.width, r.height);
    };
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);
    fit();

    const handleEvents = () => {
      g.events.forEach((ev) => {
        if (SOUND_EVENTS.has(ev.type)) playSfx(ev.type);
        if (ev.type === 'death') vibrate(200);
        else if (ev.type === 'enemy' || ev.type === 'bosshit') vibrate(30);
        else if (ev.type === 'level') ensureWorld(ev.level);
      });
      g.events.length = 0;
    };

    const frame = (now) => {
      if (disposed) return;
      const dt = Math.min(250, now - last);
      last = now;
      if (!pausedRef.current && assets.core) {
        acc += dt;
        let n = 0;
        while (acc >= STEP_MS && n < 8) {
          step(g);
          handleEvents();
          acc -= STEP_MS;
          n += 1;
        }
        if (n === 8) acc = 0;
        slowFrames = dt > 24 ? slowFrames + 1 : Math.max(0, slowFrames - 1);
        if (slowFrames > 90) renderer.setLowQuality(true);
      }
      if (assets.core) renderer.draw(g, assets, ui);
      if (g.phase === 'over') {
        if (!overAt) overAt = now;
        else if (now - overAt > 2200) finishNow();
      }
      raf = requestAnimationFrame(frame);
    };

    ensureWorld(level);
    Promise.all([
      loadCore(size),
      loadSkin(size, skin).catch(() => null),
      loadTiles(g.world.id).catch(() => null),
      loadBanners().catch(() => null),
      isBossLevel(level) ? loadBoss(size).catch(() => null) : Promise.resolve(null),
    ]).then(([core, skinAtlas, tiles, banners, boss]) => {
      if (disposed) return;
      assets.core = core;
      assets.skin = skinAtlas;
      if (tiles) assets.tiles[g.world.id] = tiles;
      assets.banners = banners && BANNERS.every((b) => banners[b]) ? banners : null;
      if (boss) assets.boss = boss;
      setLoading(false);
      playSfx('start');
      last = performance.now();
    }).catch(() => {
      if (!disposed) toast.error('Could not load the game art. Check your connection and try again.');
    });

    const detach = attachInput(wrap, (d) => { unlockAudio(); setWant(g, d); }, () => setPause(!pausedRef.current));
    const onVis = () => { if (document.hidden) setPause(true); };
    document.addEventListener('visibilitychange', onVis);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (isTouch() && !isIOS() && document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
    }
    raf = requestAnimationFrame(frame);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      detach();
      document.removeEventListener('visibilitychange', onVis);
      document.body.style.overflow = prevOverflow;
      if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
    };
  }, [mode, level, skin, best, finishNow, setPause]);

  const press = (d) => (e) => {
    e.preventDefault();
    unlockAudio();
    if (gameRef.current) setWant(gameRef.current, d);
  };
  const toggleMute = () => { unlockAudio(); setMuted(!muted); setMutedState(!muted); };
  const toggleDpad = () => {
    const v = !dpad;
    setDpad(v);
    try { localStorage.setItem(DPAD_KEY, v ? '1' : '0'); } catch (_) { /* private mode */ }
  };
  const quit = () => {
    const g = gameRef.current;
    if (g && g.phase !== 'over') { g.phase = 'over'; g.result = { cleared: false, stars: 0 }; }
    finishNow();
  };

  const iconBtn = 'flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900/80 text-zinc-200 active:scale-95';
  const padBtn = 'flex h-16 w-16 items-center justify-center rounded-xl border border-primary/40 bg-zinc-900/85 text-primary active:bg-primary/25 select-none';

  return (
    <div
      className="fixed inset-0 z-[300] flex flex-col bg-black"
      style={{ height: '100dvh', paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)', paddingLeft: 'env(safe-area-inset-left)', paddingRight: 'env(safe-area-inset-right)' }}
      data-testid="rr-pacman-game"
    >
      <div className="flex items-center justify-between gap-2 px-2 py-1.5">
        <button type="button" className={iconBtn} onClick={quit} aria-label="Quit"><X size={18} /></button>
        <div className="flex items-center gap-2">
          {isTouch() ? (
            <button type="button" className={`${iconBtn} ${dpad ? 'border-primary/60 text-primary' : ''}`} onClick={toggleDpad} aria-label="Toggle D-pad"><Gamepad2 size={18} /></button>
          ) : null}
          <button type="button" className={iconBtn} onClick={toggleMute} aria-label="Toggle sound">{muted ? <VolumeX size={18} /> : <Volume2 size={18} />}</button>
          <button type="button" className={iconBtn} onClick={() => setPause(!paused)} aria-label="Pause">{paused ? <Play size={18} /> : <Pause size={18} />}</button>
        </div>
      </div>
      <div
        ref={wrapRef}
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden"
        style={{ touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none' }}
        onPointerDown={unlockAudio}
      >
        <canvas ref={canvasRef} className="block" />
        {loading ? <p className="absolute text-sm font-heading text-zinc-400">Loading…</p> : null}
        {paused ? (
          <button type="button" className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70" onClick={() => { unlockAudio(); setPause(false); }}>
            <Play size={44} className="text-primary" />
            <span className="font-heading text-lg font-bold uppercase tracking-widest text-white">Tap to continue</span>
          </button>
        ) : null}
      </div>
      {dpad ? (
        <div className="flex items-center justify-center pb-2 pt-1">
          <div className="grid grid-cols-3 grid-rows-3 gap-1">
            <span />
            <button type="button" className={padBtn} onPointerDown={press('up')} aria-label="Up"><ArrowUp size={28} /></button>
            <span />
            <button type="button" className={padBtn} onPointerDown={press('left')} aria-label="Left"><ArrowLeft size={28} /></button>
            <span />
            <button type="button" className={padBtn} onPointerDown={press('right')} aria-label="Right"><ArrowRight size={28} /></button>
            <span />
            <button type="button" className={padBtn} onPointerDown={press('down')} aria-label="Down"><ArrowDown size={28} /></button>
            <span />
          </div>
        </div>
      ) : (
        <p className="pb-2 text-center text-[10px] font-heading text-zinc-500">{isTouch() ? 'Swipe to steer' : 'Arrow keys / WASD · P to pause'}</p>
      )}
    </div>
  );
}

function Stars({ n, size = 12 }) {
  return (
    <span className="inline-flex gap-0.5">
      {[0, 1, 2].map((i) => <Star key={i} size={size} className={i < n ? 'fill-amber-400 text-amber-400' : 'text-zinc-600'} />)}
    </span>
  );
}

export default function RoadRunnerPacmanPage() {
  const [staffOk, setStaffOk] = useState(_staffOkCache);
  const [config, setConfig] = useState(null);
  const [view, setView] = useState('menu');
  const [run, setRun] = useState(null);
  const [result, setResult] = useState(null);
  const [board, setBoard] = useState(null);
  const [boardTab, setBoardTab] = useState('daily');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (_staffOkCache === true) {
      setStaffOk(true);
      return undefined;
    }
    api.get('/auth/staff-flags')
      .then((r) => {
        if (cancelled) return;
        const ok = !!r.data?.is_admin;
        _staffOkCache = ok;
        setStaffOk(ok);
      })
      .catch(() => {
        if (!cancelled) {
          _staffOkCache = false;
          setStaffOk(false);
        }
      });
    return () => { cancelled = true; };
  }, []);

  const fetchConfig = useCallback(() => {
    apiRequestWith429Retry(() => api.get('/arcade/rr-pacman/config'))
      .then((r) => setConfig(r.data))
      .catch((e) => toast.error(getApiErrorMessage(e)));
  }, []);

  const fetchBoard = useCallback(() => {
    apiRequestWith429Retry(() => api.get('/arcade/rr-pacman/leaderboard'))
      .then((r) => setBoard(r.data))
      .catch((e) => toast.error(getApiErrorMessage(e)));
  }, []);

  useEffect(() => {
    if (staffOk !== true) return;
    fetchConfig();
    fetchBoard();
    loadCore(pickAtlasSize()).catch(() => {});
  }, [staffOk, fetchConfig, fetchBoard]);

  const progress = config?.progress || { stars: {}, unlocked: 1, skins: ['classic'], skin: 'classic', best_score: 0 };

  const start = async (mode, level = 1) => {
    if (busy) return;
    unlockAudio();
    setBusy(true);
    try {
      const r = await api.post('/arcade/rr-pacman/start', { mode, level });
      setResult(null);
      setRun({ mode, level: r.data.level, token: r.data.run_token, key: r.data.run_token });
    } catch (e) {
      toast.error(getApiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const onOver = useCallback(async (s) => {
    const current = run;
    setRun(null);
    if (!current) return;
    setResult({ ...s, mode: current.mode, level: current.level, pending: true });
    try {
      const r = await api.post('/arcade/rr-pacman/finish', { run_token: current.token, ...s });
      setResult({ ...s, mode: current.mode, level: current.level, server: r.data });
      if (r.data?.accepted === false) toast.error('Score could not be verified.');
      if (r.data?.rewards?.length) {
        const pts = r.data.rewards.reduce((a, t) => a + t.points, 0);
        const bul = r.data.rewards.reduce((a, t) => a + t.bullets, 0);
        toast.success(`Daily reward: ${pts.toLocaleString()} points + ${bul.toLocaleString()} bullets`);
        refreshUser?.();
      }
      (r.data?.new_skins || []).forEach((sk) => toast.success(`New skin unlocked: ${SKIN_LABEL[sk]}`));
      fetchConfig();
      fetchBoard();
    } catch (e) {
      setResult({ ...s, mode: current.mode, level: current.level, error: getApiErrorMessage(e) });
    }
  }, [run, fetchConfig, fetchBoard]);

  const pickSkin = async (skin) => {
    try {
      await api.post('/arcade/rr-pacman/skin', { skin });
      setConfig((c) => (c ? { ...c, progress: { ...c.progress, skin } } : c));
    } catch (e) {
      toast.error(getApiErrorMessage(e));
    }
  };

  if (staffOk === false) return <Navigate to="/casino" replace />;
  if (staffOk === null) {
    return (
      <div className={`space-y-4 ${styles.pageContent} mobile-page-root`} data-testid="rr-pacman-page">
        <p className="text-[11px] font-heading text-zinc-500">Checking admin access…</p>
      </div>
    );
  }

  const tabBtn = (id, label, Icon) => (
    <button
      key={id}
      type="button"
      onClick={() => setView(id)}
      className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-[11px] font-heading font-bold uppercase tracking-wider ${view === id ? 'border-primary/60 bg-primary/15 text-primary' : 'border-zinc-700 bg-zinc-950/60 text-zinc-400'}`}
    >
      <Icon size={14} /> {label}
    </button>
  );

  const nextTier = (config?.tiers || []).find((t, i) => !(config?.claimed_tiers || []).includes(i));
  const rows = board ? (boardTab === 'daily' ? board.daily : board.all_time) : [];

  return (
    <div className={`space-y-4 ${styles.pageContent} mobile-page-root pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-0`} data-testid="rr-pacman-page">
      {run ? <GameView key={run.key} mode={run.mode} level={run.level} skin={progress.skin} best={progress.best_score} onOver={onOver} /> : null}

      <header className="flex flex-col items-center gap-2 text-center">
        <img src={LOGO_URL} alt="Road Runner Pac-Man" className="w-full max-w-[420px]" />
        {config?.admin_only ? (
          <span className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-heading font-bold uppercase tracking-wider text-amber-300">Admin test</span>
        ) : null}
      </header>

      {result ? (
        <section className={`${styles.panel} mobile-panel rounded-xl border border-primary/30 p-4 text-center space-y-2`}>
          <p className="text-[10px] font-heading uppercase tracking-widest text-zinc-500">{result.mode === 'campaign' ? `Stage ${result.level}` : 'Endless run'}</p>
          <p className="text-3xl font-heading font-black tabular-nums text-white">{result.score.toLocaleString()}</p>
          {result.mode === 'campaign' ? (
            result.cleared ? <div className="flex justify-center"><Stars n={result.server?.stars || result.stars} size={22} /></div> : <p className="text-sm font-heading text-red-400">Stage failed</p>
          ) : (
            <p className="text-[11px] font-heading text-zinc-400">Reached level {result.level_reached}{result.server?.new_best ? ' · New personal best!' : ''}</p>
          )}
          {result.pending ? <p className="text-[11px] text-zinc-500">Saving…</p> : null}
          {result.error ? <p className="text-[11px] text-red-400">{result.error}</p> : null}
          <div className="flex justify-center gap-2 pt-1">
            <button type="button" disabled={busy} onClick={() => start(result.mode, result.mode === 'campaign' ? result.level : 1)} className="rounded-lg bg-primary px-4 py-2 text-[12px] font-heading font-bold uppercase text-black">Play again</button>
            {result.mode === 'campaign' && result.cleared && result.level < CAMPAIGN_LEVELS ? (
              <button type="button" disabled={busy} onClick={() => start('campaign', result.level + 1)} className="rounded-lg border border-primary/50 px-4 py-2 text-[12px] font-heading font-bold uppercase text-primary">Next stage</button>
            ) : null}
            <button type="button" onClick={() => setResult(null)} className="rounded-lg border border-zinc-700 px-4 py-2 text-[12px] font-heading font-bold uppercase text-zinc-300">Close</button>
          </div>
        </section>
      ) : null}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
        {tabBtn('menu', 'Play', Play)}
        {tabBtn('campaign', 'Campaign', MapIcon)}
        {tabBtn('skins', 'Skins', Shirt)}
        {tabBtn('board', 'Leaderboard', Trophy)}
      </div>

      {view === 'menu' ? (
        <section className={`${styles.panel} mobile-panel rounded-xl border border-primary/25 p-4 space-y-4`}>
          <div className="grid grid-cols-2 gap-2 text-center">
            <div className="rounded-lg border border-zinc-700/60 bg-zinc-950/60 p-2">
              <p className="text-[9px] font-heading uppercase tracking-widest text-zinc-500">Today&apos;s best</p>
              <p className="text-lg font-heading font-black tabular-nums text-white">{(config?.today_best || 0).toLocaleString()}</p>
            </div>
            <div className="rounded-lg border border-zinc-700/60 bg-zinc-950/60 p-2">
              <p className="text-[9px] font-heading uppercase tracking-widest text-zinc-500">All-time best</p>
              <p className="text-lg font-heading font-black tabular-nums text-white">{(progress.best_score || 0).toLocaleString()}</p>
            </div>
          </div>
          <button type="button" disabled={busy} onClick={() => start('endless')} className="w-full rounded-xl bg-primary py-3 text-sm font-heading font-black uppercase tracking-[0.2em] text-black active:scale-[0.99]">
            Play endless
          </button>
          <div className="space-y-1.5">
            <p className="text-[9px] font-heading uppercase tracking-widest text-zinc-500">Daily rewards (endless, once per day each)</p>
            {(config?.tiers || []).map((t, i) => {
              const done = (config?.claimed_tiers || []).includes(i);
              return (
                <div key={t.score} className={`flex items-center justify-between rounded-lg border px-3 py-1.5 text-[11px] font-heading ${done ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : 'border-zinc-700/60 bg-zinc-950/50 text-zinc-300'}`}>
                  <span className="tabular-nums">{t.score.toLocaleString()} pts</span>
                  <span className="tabular-nums">{t.points.toLocaleString()} points + {t.bullets.toLocaleString()} bullets{done ? ' ✓' : ''}</span>
                </div>
              );
            })}
            {nextTier ? <p className="text-[10px] text-zinc-500">Next: score {nextTier.score.toLocaleString()} in one run.</p> : null}
            <p className="text-[10px] text-zinc-500">Top 3 each day also win {(config?.top3_prizes || []).map((p) => p.points.toLocaleString()).join(' / ')} points at midnight (UTC).</p>
          </div>
        </section>
      ) : null}

      {view === 'campaign' ? (
        <section className={`${styles.panel} mobile-panel rounded-xl border border-primary/25 p-3 space-y-3`}>
          {WORLDS.map((w, wi) => (
            <div key={w.id} className="space-y-1.5">
              <p className="text-[10px] font-heading font-bold uppercase tracking-widest text-primary">{w.name}{w.powerup ? <span className="ml-2 font-normal text-zinc-500 normal-case tracking-normal">new power-up: {w.powerup.replace('_', ' ')}</span> : null}</p>
              <div className="grid grid-cols-5 gap-1.5">
                {Array.from({ length: LEVELS_PER_WORLD }, (_, k) => {
                  const lv = wi * LEVELS_PER_WORLD + k + 1;
                  const locked = lv > progress.unlocked;
                  const stars = Number(progress.stars?.[String(lv)] || 0);
                  return (
                    <button
                      key={lv}
                      type="button"
                      disabled={locked || busy}
                      onClick={() => start('campaign', lv)}
                      className={`flex flex-col items-center gap-0.5 rounded-lg border py-2 text-[12px] font-heading font-bold ${locked ? 'border-zinc-800 bg-zinc-950/40 text-zinc-600' : 'border-primary/30 bg-zinc-950/70 text-white active:scale-95'}`}
                    >
                      {locked ? <Lock size={14} /> : <span className="flex items-center gap-1">{isBossLevel(lv) ? <Crown size={12} className="text-red-400" /> : null}{lv}</span>}
                      {!locked ? <Stars n={stars} size={10} /> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          <p className="text-[10px] text-zinc-500">1 star: clear · 2 stars: no lives lost · 3 stars: also grab a bonus item (boss stages: win inside 90s). Campaign is for practice and skins; daily rewards come from endless.</p>
        </section>
      ) : null}

      {view === 'skins' ? (
        <section className={`${styles.panel} mobile-panel rounded-xl border border-primary/25 p-3`}>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {['classic', 'mafia', 'cop', 'gold'].map((sk) => {
              const owned = progress.skins.includes(sk);
              const on = progress.skin === sk;
              const hint = sk === 'gold' ? '3 stars on all 35 stages' : `Clear stage ${config?.skin_unlocks?.[sk]}`;
              return (
                <button
                  key={sk}
                  type="button"
                  disabled={!owned}
                  onClick={() => pickSkin(sk)}
                  className={`flex flex-col items-center gap-1 rounded-xl border p-2 ${on ? 'border-primary bg-primary/10' : 'border-zinc-700/60 bg-zinc-950/60'} ${owned ? '' : 'opacity-50'}`}
                >
                  <img src={SKIN_PREVIEW[sk]} alt="" className="h-24 w-24 object-contain" loading="lazy" />
                  <span className="text-[11px] font-heading font-bold uppercase tracking-wider text-white">{SKIN_LABEL[sk]}</span>
                  <span className="text-[9px] text-zinc-500">{owned ? (on ? 'Equipped' : 'Tap to equip') : hint}</span>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {view === 'board' ? (
        <section className={`${styles.panel} mobile-panel rounded-xl border border-primary/25 p-3 space-y-2`}>
          <div className="flex gap-1.5">
            {[['daily', 'Today'], ['all', 'All time']].map(([id, label]) => (
              <button key={id} type="button" onClick={() => setBoardTab(id)} className={`flex-1 rounded-lg border py-1.5 text-[11px] font-heading font-bold uppercase ${boardTab === id ? 'border-primary/60 bg-primary/15 text-primary' : 'border-zinc-700 text-zinc-400'}`}>{label}</button>
            ))}
          </div>
          {rows.length ? (
            <ol className="space-y-1">
              {rows.map((r, i) => (
                <li key={r.user_id} className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-1.5 text-[12px] font-heading">
                  <span className="flex items-center gap-2"><span className={`w-5 text-right tabular-nums ${i < 3 ? 'text-amber-400 font-black' : 'text-zinc-500'}`}>{i + 1}</span><span className="text-white">{r.username}</span></span>
                  <span className="tabular-nums text-zinc-200">{r.score.toLocaleString()}</span>
                </li>
              ))}
            </ol>
          ) : <p className="py-4 text-center text-[11px] text-zinc-500">No scores yet. Be the first.</p>}
        </section>
      ) : null}
    </div>
  );
}
