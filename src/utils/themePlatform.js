/** Viewport bucket for persisted theme (matches Layout / UsersOnline: max-width 767px). */
export function getThemeUiPlatform() {
  if (typeof window === 'undefined') return 'pc';
  return window.matchMedia('(max-width: 767px)').matches ? 'mobile' : 'pc';
}
