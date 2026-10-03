const KEYS = {
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
};
const SWIPE_PX = 20;

// Keyboard + swipe input. Swipes fire as soon as the finger passes the threshold,
// then re-arm from the current point so one long drag can chain turns.
export function attachInput(target, onDir, onPause) {
  const onKey = (e) => {
    if (e.code === 'Escape' || e.code === 'KeyP') { onPause?.(); return; }
    const d = KEYS[e.code];
    if (!d) return;
    e.preventDefault();
    onDir(d);
  };
  let start = null;
  const onDown = (e) => { start = { x: e.clientX, y: e.clientY, id: e.pointerId }; };
  const onMove = (e) => {
    if (!start || e.pointerId !== start.id) return;
    const dx = e.clientX - start.x; const dy = e.clientY - start.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_PX) return;
    onDir(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
    start = { x: e.clientX, y: e.clientY, id: e.pointerId };
  };
  const onUp = () => { start = null; };
  window.addEventListener('keydown', onKey);
  target.addEventListener('pointerdown', onDown);
  target.addEventListener('pointermove', onMove);
  target.addEventListener('pointerup', onUp);
  target.addEventListener('pointercancel', onUp);
  return () => {
    window.removeEventListener('keydown', onKey);
    target.removeEventListener('pointerdown', onDown);
    target.removeEventListener('pointermove', onMove);
    target.removeEventListener('pointerup', onUp);
    target.removeEventListener('pointercancel', onUp);
  };
}

export function vibrate(ms) {
  try { if (navigator.vibrate) navigator.vibrate(ms); } catch (_) { /* unsupported */ }
}
