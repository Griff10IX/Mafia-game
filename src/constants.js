/** Racket/family UI accent – original gold theme only */
export const RACKET_ACCENT_STYLES = {
  gold: { bar: 'bg-primary', text: 'text-primary', btn: 'bg-primary/20 text-primary border border-primary/40 hover:bg-primary/30', bannerBg: 'bg-primary/10', bannerText: 'text-primary', border: 'border-primary/30', tabActive: 'text-primary border-primary bg-primary/5' },
};
export const getRacketAccent = () => RACKET_ACCENT_STYLES.gold;

/**
 * Jail page background (Al Capone prison cell) for the status cards.
 * Uses local public/jail-background.jpg if present; otherwise the URL below.
 * Override: set REACT_APP_JAIL_BACKGROUND_IMAGE in .env (e.g. /jail-background.png if you used .png).
 */
const JAIL_BACKGROUND_URL =
  'https://media.istockphoto.com/id/146916841/photo/al-capones-old-prison-cell-in-black-and-white.jpg?s=612x612&w=0&k=20&c=7-xMDByWhz32QGkQyVJ3BoDHIIrrMRXLbZNjxT9lPhA=';

const JAIL_BACKGROUND_LOCAL = `${process.env.PUBLIC_URL || ''}/jail-background.jpg`;

export const JAIL_BACKGROUND_IMAGE =
  process.env.REACT_APP_JAIL_BACKGROUND_IMAGE || JAIL_BACKGROUND_LOCAL || JAIL_BACKGROUND_URL;

/**
 * Full-page background for the Jail route (Alcatraz panorama). Override: REACT_APP_JAIL_PAGE_BACKGROUND in .env.
 */
export const JAIL_PAGE_BACKGROUND =
  process.env.REACT_APP_JAIL_PAGE_BACKGROUND ||
  'https://thumbs.dreamstime.com/b/panorama-alcatraz-island-famous-prison-building-san-francisco-usa-black-white-image-panorama-alcatraz-island-99504728.jpg?w=992';
