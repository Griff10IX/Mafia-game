// Tiny synthesized sound set (no audio files). iOS needs unlock() inside a user tap.
const MUTE_KEY = 'rrpm_muted';
let ctx = null;
let muted = typeof localStorage !== 'undefined' && localStorage.getItem(MUTE_KEY) === '1';
let wakaFlip = false;

export function unlockAudio() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
  } catch (_) { ctx = null; }
}

export const isMuted = () => muted;
export function setMuted(v) {
  muted = !!v;
  try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch (_) { /* private mode */ }
}

function tone(freq, dur, { type = 'square', vol = 0.06, slide = 0, delay = 0 } = {}) {
  if (muted || !ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const gn = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
  gn.gain.setValueAtTime(vol, t);
  gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(gn).connect(ctx.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

const SOUNDS = {
  seed: () => { wakaFlip = !wakaFlip; tone(wakaFlip ? 520 : 390, 0.05, { type: 'triangle', vol: 0.05 }); },
  bag: () => tone(220, 0.25, { type: 'sawtooth', slide: 440, vol: 0.05 }),
  enemy: () => tone(300, 0.3, { type: 'square', slide: 900 }),
  bonus: () => { tone(660, 0.08); tone(880, 0.08, { delay: 0.08 }); tone(1320, 0.12, { delay: 0.16 }); },
  powerup: () => { tone(500, 0.1, { type: 'triangle' }); tone(750, 0.15, { type: 'triangle', delay: 0.1 }); },
  extralife: () => [0, 0.1, 0.2, 0.3].forEach((d, i) => tone(600 + i * 150, 0.1, { delay: d })),
  death: () => tone(700, 1.2, { type: 'sawtooth', slide: -620, vol: 0.06 }),
  clear: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.15, { type: 'triangle', delay: i * 0.12 })),
  gameover: () => [392, 330, 262, 196].forEach((f, i) => tone(f, 0.25, { type: 'triangle', delay: i * 0.22 })),
  missile: () => tone(1200, 0.4, { type: 'sine', slide: -800, vol: 0.04 }),
  blast: () => tone(90, 0.3, { type: 'sawtooth', slide: -40, vol: 0.08 }),
  stomp: () => tone(60, 0.4, { type: 'square', slide: -20, vol: 0.09 }),
  bosshit: () => tone(180, 0.3, { type: 'square', slide: 500, vol: 0.07 }),
  shield_pop: () => tone(900, 0.2, { type: 'sine', slide: -500 }),
  start: () => [262, 392, 523, 392, 523, 659].forEach((f, i) => tone(f, 0.12, { type: 'triangle', delay: i * 0.13 })),
};

export function play(name) {
  const fn = SOUNDS[name];
  if (fn) fn();
}
