/**
 * New-account (civilian) protection revoke confirmation.
 * Backend returns 409 + code civilian_protection_confirm when a protected
 * user attempts an intentional revoke action without the confirm header.
 */

import api from './api';

export const CIVILIAN_PROTECTION_CONFIRM_CODE = 'civilian_protection_confirm';
export const CIVILIAN_PROTECTION_CONFIRM_HEADER = 'X-Confirm-Civilian-Protection-Revoke';

export const CIVILIAN_PROTECTION_CONFIRM_MESSAGE =
  'This will permanently remove your new account protection. Other players will be able to attack you in normal PvP. Continue?';

/** Exclusive-car risk (GTA / loot): confirm before the attempt, not after a drop. */
export const CIVILIAN_PROTECTION_EXCLUSIVE_CAR_MESSAGE =
  'If you get an exclusive car, your new account protection will be permanently removed and other players will be able to attack you in normal PvP. Continue?';

export function isCivilianProtectionConfirmError(err) {
  const detail = err?.response?.data?.detail;
  if (detail && typeof detail === 'object' && detail.code === CIVILIAN_PROTECTION_CONFIRM_CODE) {
    return true;
  }
  return false;
}

export function getCivilianProtectionConfirmMessage(err) {
  const detail = err?.response?.data?.detail;
  if (detail && typeof detail === 'object') {
    if (detail.reason === 'exclusive_car') {
      return CIVILIAN_PROTECTION_EXCLUSIVE_CAR_MESSAGE;
    }
    if (typeof detail.message === 'string' && detail.message.trim()) {
      return detail.message.trim();
    }
  }
  return CIVILIAN_PROTECTION_CONFIRM_MESSAGE;
}

export function civilianProtectionConfirmHeaders(extra = {}) {
  return {
    ...extra,
    [CIVILIAN_PROTECTION_CONFIRM_HEADER]: '1',
  };
}

/**
 * Run an API request; on protection-confirm 409, ask the user and retry once with the confirm header.
 * @param {(headers: Record<string, string>) => Promise<any>} requestFn
 *   Called with {} first, then with confirm headers on retry.
 * @returns {Promise<any>}
 */
export async function requestWithCivilianProtectionConfirm(requestFn) {
  try {
    return await requestFn({});
  } catch (err) {
    if (!isCivilianProtectionConfirmError(err)) throw err;
    const msg = getCivilianProtectionConfirmMessage(err);
    if (typeof window !== 'undefined' && !window.confirm(msg)) {
      const cancelled = new Error('civilian_protection_confirm_cancelled');
      cancelled.code = 'civilian_protection_confirm_cancelled';
      cancelled.cause = err;
      throw cancelled;
    }
    return await requestFn(civilianProtectionConfirmHeaders());
  }
}

export function isCivilianProtectionConfirmCancelled(err) {
  return err?.code === 'civilian_protection_confirm_cancelled';
}

/**
 * Convenience wrapper for api.post with protection-confirm 409 retry.
 * @param {string} url
 * @param {any} [data]
 * @param {import('axios').AxiosRequestConfig} [config]
 */
export function apiPostWithCivilianProtectionConfirm(url, data, config = {}) {
  return requestWithCivilianProtectionConfirm((headers) =>
    api.post(url, data, {
      ...config,
      headers: { ...(config.headers || {}), ...headers },
    }),
  );
}
