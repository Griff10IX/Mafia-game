/**
 * URL for a file served from `public/` (CRA `PUBLIC_URL` when the app is on a subpath).
 * @param {string} path - Absolute path under public, e.g. '/favicon.png'
 */
export function publicAsset(path) {
  const p = path.startsWith('/') ? path : `/${path}`;
  const base = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
  return `${base}${p}`;
}

/** PNG favicon — tab icons, manifests, desktop notifications, etc. */
export const FAVICON_PNG = publicAsset('/favicon.png');

/** PWA / high-res notification icon */
export const APP_ICON_192_PNG = publicAsset('/icon-192.png');
