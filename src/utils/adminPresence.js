/** Stable id per browser tab session for admin-tool presence heartbeats. */
export function getAdminPresenceTabId() {
  if (typeof sessionStorage === 'undefined') {
    return `t-${Date.now()}`;
  }
  try {
    const k = 'admin_presence_tab_id';
    let id = sessionStorage.getItem(k);
    if (!id) {
      id =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `t-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
      sessionStorage.setItem(k, id);
    }
    return id;
  } catch {
    return `t-${Date.now()}`;
  }
}
