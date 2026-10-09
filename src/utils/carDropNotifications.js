/**
 * Stolen-car pop-ups on GTA. The inbox note when worn-out cars leave the garage
 * uses the same preference on the server (notification_preferences.car_drops).
 * Default on until the player turns it off in Profile → Alerts.
 */

let enabled = true;

export function setCarDropNotifications(on) {
  enabled = on !== false;
}

export function carDropNotificationsEnabled() {
  return enabled;
}
