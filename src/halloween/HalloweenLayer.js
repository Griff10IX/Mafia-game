import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTheme } from '../context/ThemeContext';
import { isHalloweenActive, setHalloweenAccount, subscribeHalloween } from './active';
import {
  HalloweenDecor,
  KillScene,
  KillerLurk,
  KillerStalk,
  SpiderRunner,
  pickKiller,
  preloadHalloweenSprites,
} from './Decor';
import { halloweenRoll, prefersReducedMotion } from './roll';
import { ScareFrame, pickScareKind, scareDuration } from './Scares';
import { maybeHalloweenScare, showButtonWeb } from './trigger';
import './halloween.css';

const RUNNER_MS = 6800;
const LURK_MS = 7800;
const STALK_MS = 13500;
const KILL_MS = 7900;

// one ambient event, then a pause, so they never pile up
const AMBIENT_GAP = [22_000, 70_000];

let eventSeq = 0;
function nextId() {
  eventSeq += 1;
  return eventSeq;
}

function randomBetween([lo, hi]) {
  return lo + Math.random() * (hi - lo);
}

function coin(a, b) {
  return Math.random() < 0.5 ? a : b;
}

function pickAmbientType() {
  const roll = Math.random();
  if (roll < 0.42) return 'runner';
  if (roll < 0.7) return 'lurk';
  if (roll < 0.9) return 'stalk';
  return 'kill';
}

// Buttons players hit over and over. Menu links are handled separately.
const FREQUENT_TESTID = /^(bust-out-|commit-crime-|skip-crime-|attempt-gta-|skip-gta-|attack-kill-|kill-inline-button|wheel-spin-)/;
const FREQUENT_LABEL = new Set(['bust', 'commit', 'steal', 'snitch', 'kill', 'attack', 'spin']);

function isFrequentAction(btn) {
  const id = btn.getAttribute?.('data-testid') || '';
  if (FREQUENT_TESTID.test(id)) return true;
  const label = (btn.innerText || '').replace(/\s+/g, ' ').trim().toLowerCase();
  return FREQUENT_LABEL.has(label);
}

function useOneEvent() {
  const [event, setEvent] = useState(null);
  useEffect(() => {
    if (!event) return undefined;
    const id = event.id;
    const timer = window.setTimeout(() => {
      setEvent((cur) => (cur && cur.id === id ? null : cur));
    }, event.ms);
    return () => window.clearTimeout(timer);
  }, [event]);
  return [event, setEvent];
}

export default function HalloweenLayer() {
  const { halloweenOn } = useTheme();
  const [active, setActive] = useState(() => isHalloweenActive());
  const [event, setEvent] = useOneEvent();

  useEffect(() => {
    setHalloweenAccount(!!halloweenOn);
  }, [halloweenOn]);

  useEffect(() => subscribeHalloween(() => setActive(isHalloweenActive())), []);

  useEffect(() => {
    if (!active) setEvent(null);
  }, [active, setEvent]);

  useEffect(() => {
    if (active) preloadHalloweenSprites();
  }, [active]);

  // 1 in 20: a menu link or a frequent button flashes one scare. Any button can grow a web, on its own roll.
  useEffect(() => {
    if (!active) return undefined;
    const onClick = (clickEvent) => {
      if (!isHalloweenActive() || prefersReducedMotion()) return;
      if (clickEvent.target?.closest?.('[data-halloween-scare]')) return;
      const nav = clickEvent.target?.closest?.('[data-halloween-nav]');
      const btn = clickEvent.target?.closest?.('button, [role="button"]');
      if (nav || (btn && isFrequentAction(btn))) maybeHalloweenScare();
      if (!btn || !halloweenRoll()) return;
      showButtonWeb(btn);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [active]);

  useEffect(() => {
    const place = (next, force) => {
      setEvent((cur) => {
        if (force) return next;
        if (cur && cur.type === 'scare') return cur;
        if (next.type !== 'scare' && cur) return cur;
        return next;
      });
    };
    const onScare = (e) => {
      if (prefersReducedMotion()) return;
      const d = e.detail || {};
      const kind = pickScareKind(d.kind);
      place({ id: nextId(), type: 'scare', kind, ms: scareDuration(kind) }, !!d.kind);
    };
    const onRunner = (e) => {
      if (prefersReducedMotion()) return;
      const d = e.detail || {};
      place({
        id: nextId(),
        type: 'runner',
        dir: d.dir || coin('left', 'right'),
        ms: RUNNER_MS,
      }, !!d.dir);
    };
    const onLurk = (e) => {
      if (prefersReducedMotion()) return;
      const d = e.detail || {};
      place({
        id: nextId(),
        type: 'lurk',
        killer: pickKiller(d.killer).id,
        side: d.side || coin('left', 'right'),
        ms: LURK_MS,
      }, !!d.killer);
    };
    const onStalk = (e) => {
      if (prefersReducedMotion()) return;
      const d = e.detail || {};
      place({
        id: nextId(),
        type: 'stalk',
        killer: pickKiller(d.killer).id,
        dir: d.dir || coin('left', 'right'),
        ms: STALK_MS,
      }, !!d.killer);
    };
    const onKill = (e) => {
      if (prefersReducedMotion()) return;
      const d = e.detail || {};
      place({
        id: nextId(),
        type: 'kill',
        killer: pickKiller(d.killer).id,
        ms: KILL_MS,
      }, !!d.killer);
    };
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
  }, [setEvent]);

  useEffect(() => {
    if (!active || prefersReducedMotion()) return undefined;
    let timer = 0;
    let stopped = false;
    const loop = () => {
      timer = window.setTimeout(() => {
        if (stopped) return;
        if (isHalloweenActive() && document.visibilityState === 'visible') {
          const type = pickAmbientType();
          if (type === 'runner') {
            window.dispatchEvent(new CustomEvent('halloween-runner', { detail: {} }));
          } else if (type === 'lurk') {
            window.dispatchEvent(new CustomEvent('halloween-lurk', { detail: {} }));
          } else if (type === 'stalk') {
            window.dispatchEvent(new CustomEvent('halloween-stalk', { detail: {} }));
          } else {
            window.dispatchEvent(new CustomEvent('halloween-kill', { detail: {} }));
          }
        }
        loop();
      }, randomBetween(AMBIENT_GAP));
    };
    loop();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [active]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <>
      {active ? <HalloweenDecor /> : null}
      {active && event?.type === 'runner' ? <SpiderRunner key={event.id} dir={event.dir} /> : null}
      {active && event?.type === 'lurk' ? <KillerLurk key={event.id} killer={event.killer} side={event.side} /> : null}
      {active && event?.type === 'stalk' ? <KillerStalk key={event.id} killer={event.killer} dir={event.dir} /> : null}
      {active && event?.type === 'kill' ? <KillScene key={event.id} killer={event.killer} /> : null}
      {event?.type === 'scare' ? <ScareFrame key={event.id} kind={event.kind} /> : null}
    </>,
    document.body,
  );
}
