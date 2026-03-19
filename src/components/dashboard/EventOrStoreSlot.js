import { useState, useEffect } from 'react';
import api from '../../utils/api';
import ActiveEventWidget from './ActiveEventWidget';
import StoreWidget from './StoreWidget';

export default function EventOrStoreSlot({ user }) {
  const [eventData, setEventData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/events/active')
      .then((res) => setEventData(res.data))
      .catch(() => setEventData(null))
      .finally(() => setLoading(false));
  }, []);

  const hasEvent = !loading && eventData?.events_enabled && eventData?.event && eventData?.event?.id !== 'none';
  if (hasEvent) return <ActiveEventWidget />;
  return <StoreWidget user={user} />;
}
