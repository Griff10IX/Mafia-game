/**
 * Match canvas backing-store resolution to CSS size × devicePixelRatio so 2D draws stay sharp on HiDPI.
 * After calling, draw using logical pixels (0…logicalW, 0…logicalH).
 */
export function applyCanvasHiDpi(canvas, logicalW, logicalH, maxDpr = 2) {
  const dpr = Math.min(typeof window !== "undefined" && window.devicePixelRatio ? window.devicePixelRatio : 1, maxDpr);
  const lw = Math.max(1, Math.floor(logicalW));
  const lh = Math.max(1, Math.floor(logicalH));
  const bw = Math.max(1, Math.round(lw * dpr));
  const bh = Math.max(1, Math.round(lh * dpr));
  canvas.width = bw;
  canvas.height = bh;
  canvas.style.width = `${lw}px`;
  canvas.style.height = `${lh}px`;
  const ctx = canvas.getContext("2d");
  if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { dpr, logicalW: lw, logicalH: lh, ctx };
}
