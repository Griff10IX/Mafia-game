import { useState, useEffect } from 'react';
import api from '../../utils/api';
import StoreWidget from './StoreWidget';

/** Dashboard store slot (world events live on Account → Game Events only). */
export default function EventOrStoreSlot({ user, userId }) {
  const [storePointsEvent, setStorePointsEvent] = useState(null);

  useEffect(() => {
    if (!userId) {
      setStorePointsEvent(null);
      return;
    }
    api
      .get('/payments/store-points-event')
      .then((res) => setStorePointsEvent(res.data?.event ?? null))
      .catch(() => setStorePointsEvent(null));
  }, [userId]);

  return <StoreWidget user={user} storePointsEvent={storePointsEvent} />;
}
