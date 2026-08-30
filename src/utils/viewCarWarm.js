import api from './api';
import { readSessionJson, writeSessionJson } from './sessionPageCache';

const CACHE_PREFIX = 'mafia_view_car_v1_';

export function viewCarCacheKey(id) {
  return `${CACHE_PREFIX}${String(id || '')}`;
}

export function readViewCarCache(id) {
  if (!id) return null;
  const data = readSessionJson(viewCarCacheKey(id));
  return data && typeof data === 'object' ? data : null;
}

export function writeViewCarCache(id, data) {
  if (!id || !data) return;
  writeSessionJson(viewCarCacheKey(id), data);
}

export function prefetchViewCarPage(id) {
  if (!id) return;
  import('../pages/Cars/ViewCar').catch(() => {});
  if (readViewCarCache(id)) return;
  api.get('/gta/view-car', { params: { id } })
    .then((r) => {
      if (r?.data) writeViewCarCache(id, r.data);
    })
    .catch(() => {});
}
