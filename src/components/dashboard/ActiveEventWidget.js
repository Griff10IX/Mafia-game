import { Link } from 'react-router-dom';
import { Zap, Clock } from 'lucide-react';
import styles from '../../styles/noir.module.css';

function formatCountdown(expiresAt) {
  if (!expiresAt) return '';
  const diff = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
  if (diff <= 0) return 'rotating soon';
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  if (h > 0) return `${h}h ${m}m left`;
  return `${m}m left`;
}

/** Dashboard summary card — links to Game Events (parent passes already-fetched event data). */
export default function ActiveEventWidget({ eventData }) {
  if (!eventData?.events_enabled || !eventData?.event || eventData?.event?.id === 'none') {
    return null;
  }

  const names = eventData.active_event_names || [];
  const title = names.length > 0 ? names.join(' + ') : (eventData.event?.name || 'Event');
  const countdown = formatCountdown(eventData.expires_at);

  return (
    <Link
      to="/account/game-events"
      className={`${styles.panel} rounded-md overflow-hidden border border-primary/20 mobile-panel block hover:border-primary/40 transition-colors`}
    >
      <div className="h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      <div className="px-2.5 py-1.5 bg-primary/8 border-b border-primary/20 flex items-center gap-1">
        <Zap size={10} className="text-primary" />
        <span className="text-[10px] font-heading font-bold text-primary uppercase tracking-[0.12em]">
          Active Event
        </span>
        {countdown ? (
          <span className="ml-auto inline-flex items-center gap-0.5 text-[8px] font-heading text-mutedForeground">
            <Clock size={8} />
            {countdown}
          </span>
        ) : null}
      </div>
      <div className="px-2.5 py-2">
        <p className="text-[11px] font-heading text-foreground">{title}</p>
        <p className="text-[9px] font-heading text-primary/80 mt-1">View Game Events →</p>
      </div>
    </Link>
  );
}
