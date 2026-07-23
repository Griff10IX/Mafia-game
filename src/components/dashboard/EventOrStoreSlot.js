import { useState, useEffect } from 'react';
import api from '../../utils/api';
import { getDashboardWidget, setDashboardWidget } from '../../utils/dashboardWidgetCache';
import ActiveEventWidget from './ActiveEventWidget';
import StoreWidget from './StoreWidget';

const WIDGET_KEY = 'events_active';

export default function EventOrStoreSlot({ user, userId }) {
  const [eventData, setEventData] = useState(null);
  const [storePointsEvent, setStorePointsEvent] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) {
      setEventData(null);
      setLoading(true);
      return;
    }
    const cached = getDashboardWidget(userId, WIDGET_KEY);
    if (cached) {
      setEventData(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }
    api
      .get('/events/active')
      .then((res) => {
        const d = res.data;
        setEventData(d);
        if (d) setDashboardWidget(userId, WIDGET_KEY, d);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    api
      .get('/payments/store-points-event')
      .then((res) => setStorePointsEvent(res.data?.event ?? null))
      .catch(() => setStorePointsEvent(null));
  }, [userId]);

  const hasEvent = !loading && eventData?.events_enabled && eventData?.event && eventData?.event?.id !== 'none';
  if (hasEvent) return <ActiveEventWidget eventData={eventData} />;
  return <StoreWidget user={user} storePointsEvent={storePointsEvent} />;
}
