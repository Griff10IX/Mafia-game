import { useEffect, useMemo, useState } from 'react';
import { useAuthUser } from '../context/AuthContext';
import { publicAsset } from './publicAssets';

/** Optional GhostFace-only local preview of Vader GIF (legacy). */
export const BJ_VADER_CARD_BACK = publicAsset('/images/blackjack/card-backs/darth-vader.gif');
export const BJ_VADER_BACK_STORAGE_KEY = 'bj_preview_vader_back';
const BJ_VADER_BACK_EVENT = 'bj-card-back-change';
const BJ_EQUIPPED_EVENT = 'bj-equipped-card-back-change';

export function isGhostFaceAdminPreview(user) {
  return String(user?.username || '').toLowerCase() === 'ghostface';
}

export function isBlackjackVaderBackOn() {
  try {
    return localStorage.getItem(BJ_VADER_BACK_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setBlackjackVaderBackOn(on) {
  try {
    if (on) localStorage.setItem(BJ_VADER_BACK_STORAGE_KEY, '1');
    else localStorage.removeItem(BJ_VADER_BACK_STORAGE_KEY);
  } catch {
    /* ignore */
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(BJ_VADER_BACK_EVENT));
  }
}

export function notifyBlackjackCardBackChanged() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(BJ_EQUIPPED_EVENT));
  }
}

/** Face-down card image URL from equipped account cosmetic, or null for default navy. */
export function useBlackjackCardBackSrc() {
  const user = useAuthUser();
  const [tick, setTick] = useState(0);
  const [vaderOn, setVaderOn] = useState(() => isBlackjackVaderBackOn());

  useEffect(() => {
    const sync = () => {
      setTick((n) => n + 1);
      setVaderOn(isBlackjackVaderBackOn());
    };
    window.addEventListener(BJ_VADER_BACK_EVENT, sync);
    window.addEventListener(BJ_EQUIPPED_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(BJ_VADER_BACK_EVENT, sync);
      window.removeEventListener(BJ_EQUIPPED_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  return useMemo(() => {
    void tick;
    const equipped = user?.blackjack_card_back;
    const img = equipped?.image ? publicAsset(String(equipped.image).split('?')[0]) : null;
    if (img) return img;
    if (isGhostFaceAdminPreview(user) && vaderOn) return BJ_VADER_CARD_BACK;
    return null;
  }, [user, tick, vaderOn]);
}

/** @deprecated use useBlackjackCardBackSrc */
export function useBlackjackVaderBackSrc() {
  return useBlackjackCardBackSrc();
}

export function defaultNavyCardBackStyle() {
  return {
    background: 'linear-gradient(135deg, #1a3a7a, #0d2255)',
    border: '2px solid #2a4a9a',
  };
}

export function cardBackFaceStyle(src) {
  if (!src) return defaultNavyCardBackStyle();
  return {
    backgroundImage: `url(${src})`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    border: '2px solid #2a4a9a',
  };
}
