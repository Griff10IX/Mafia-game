import { useEffect, useState } from 'react';
import { useTheme } from '../context/ThemeContext';
import { isHalloweenActive, setHalloweenAccount, subscribeHalloween } from './active';
import {
  HalloweenDecor,
  KillScene,
  KillerLurk,
  KillerStalk,
  SpiderRunner,
  preloadHalloweenSprites,
} from './Decor';
import { halloweenRoll, prefersReducedMotion } from './roll';
import { ScareFrame, scareDuration } from './Scares';
import { showButtonWeb } from './trigger';
import './halloween.css';

const RUNNER_MS = 6800;
const LURK_MS = 7800;
const STALK_MS = 13500;
const KILL_MS = 7900;

// ambient "now and again" gaps, in ms
const RUNNER_GAP = [28_000, 75_000];
const LURK_GAP = [70_000, 170_000];
const STALK_GAP = [90_000, 220_000];
const KILL_GAP = [240_000, 540_000];

function randomBetween([lo, hi]) {
  return lo + Math.random() * (hi - lo);
}

function coin(a, b) {
  return Math.random() < 0.5 ? a : b;
}

function useTimedState(ms) {
  const [value, setValue] = useState(null);
  useEffect(() => {
    if (!value) return undefined;
    const timer = window.setTimeout(() => setValue(null), typeof ms === 'function' ? ms(value) : ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return [value, setValue];
}

export default function HalloweenLayer() {
  const { halloweenOn } = useTheme();
  const [active, setActive] = useState(() => isHalloweenActive());
  const [scare, setScare] = useTimedState((s) => scareDuration(s.kind));
  const [runner, setRunner] = useTimedState(RUNNER_MS);
  const [lurk, setLurk] = useTimedState(LURK_MS);
  const [stalk, setStalk] = useTimedState(STALK_MS);
  const [kill, setKill] = useTimedState(KILL_MS);

  useEffect(() => {
    setHalloweenAccount(!!halloweenOn);
  }, [halloweenOn]);

  useEffect(() => subscribeHalloween(() => setActive(isHalloweenActive())), []);

  useEffect(() => {
    if (active) preloadHalloweenSprites();
  }, [active]);

  // 1 in 20 button presses grow a web
  useEffect(() => {
    if (!active) return undefined;
    const onClick = (event) => {
      if (!isHalloweenActive() || prefersReducedMotion()) return;
      const btn = event.target?.closest?.('button, [role="button"]');
      if (!btn || btn.closest('[data-halloween-scare]')) return;
      if (!halloweenRoll()) return;
      showButtonWeb(btn);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [active]);

  // forced / rolled events
  useEffect(() => {
    const guard = (fn) => (event) => {
      if (prefersReducedMotion()) return;
      fn(event.detail || {});
    };
    const onScare = guard((d) => setScare({ id: Date.now(), kind: d.kind || null }));
    const onRunner = guard((d) => setRunner({ id: Date.now(), dir: d.dir || coin('left', 'right') }));
    const onLurk = guard((d) => setLurk({ id: Date.now(), killer: d.killer || null, side: d.side || coin('left', 'right') }));
    const onStalk = guard((d) => setStalk({ id: Date.now(), killer: d.killer || null, dir: d.dir || coin('left', 'right') }));
    const onKill = guard((d) => setKill({ id: Date.now(), killer: d.killer || null }));
    window.addEventListener('halloween-scare', onScare);
    window.addEventListener('halloween-runner', onRunner);
    window.addEventListener('halloween-lurk', onLurk);
    window.addEventListener('halloween-stalk', onStalk);
    window.addEventListener('halloween-kill', onKill);
    return () => {
      window.removeEventListener('halloween-scare', onScare);
      window.removeEventListener('halloween-runner', onRunner);
      window.removeEventListener('halloween-lurk', onLurk);
      window.removeEventListener('halloween-stalk', onStalk);
      window.removeEventListener('halloween-kill', onKill);
    };
  }, [setScare, setRunner, setLurk, setStalk, setKill]);

  // ambient events while the overlay is on
  useEffect(() => {
    if (!active || prefersReducedMotion()) return undefined;
    const timers = [];
    const schedule = (gap, fire) => {
      const tick = () => {
        timers.push(window.setTimeout(() => {
          if (isHalloweenActive() && document.visibilityState === 'visible') fire();
          tick();
        }, randomBetween(gap)));
      };
      tick();
    };
    schedule(RUNNER_GAP, () => setRunner({ id: Date.now(), dir: coin('left', 'right') }));
    schedule(LURK_GAP, () => setLurk({ id: Date.now(), killer: null, side: coin('left', 'right') }));
    schedule(STALK_GAP, () => setStalk({ id: Date.now(), killer: null, dir: coin('left', 'right') }));
    schedule(KILL_GAP, () => setKill({ id: Date.now(), killer: null }));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [active, setRunner, setLurk, setStalk, setKill]);

  return (
    <>
      {active ? <HalloweenDecor /> : null}
      {active && runner ? <SpiderRunner key={runner.id} dir={runner.dir} /> : null}
      {active && lurk ? <KillerLurk key={lurk.id} killer={lurk.killer} side={lurk.side} /> : null}
      {active && stalk ? <KillerStalk key={stalk.id} killer={stalk.killer} dir={stalk.dir} /> : null}
      {active && kill ? <KillScene key={kill.id} killer={kill.killer} /> : null}
      {scare ? <ScareFrame key={scare.id} kind={scare.kind} /> : null}
    </>
  );
}
