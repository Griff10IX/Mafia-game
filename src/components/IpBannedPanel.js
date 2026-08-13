import styles from '../styles/noir.module.css';

function formatExpires(iso) {
  if (!iso) return '';
  try {
    const d = new Date(String(iso).replace('Z', '+00:00'));
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return '';
  }
}

/** Public IP-ban card. No login/register/forgot actions. Reason only if staff set one. */
export default function IpBannedPanel({ ban }) {
  const reason = (ban?.reason || '').trim();
  const until = formatExpires(ban?.expires_at);
  return (
    <div
      className={`overflow-hidden rounded-xl border ${styles.panel}`}
      data-testid="ip-banned-panel"
      style={{
        borderColor: 'rgba(239,68,68,0.35)',
        background: 'linear-gradient(180deg, rgba(14,14,16,0.94) 0%, rgba(8,8,10,0.96) 100%)',
        boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
      }}
    >
      <div className="p-5 sm:p-6 space-y-3">
        <h2
          className="text-sm font-heading font-bold uppercase tracking-wider text-center"
          style={{ color: 'rgba(248,113,113,1)' }}
        >
          IP banned
        </h2>
        <p className="text-[12px] sm:text-sm font-heading text-center" style={{ color: 'var(--noir-foreground)' }}>
          {ban?.detail || 'Your IP has been banned from this server.'}
        </p>
        {reason ? (
          <div
            className="rounded border px-3 py-2.5 space-y-1"
            style={{
              borderColor: 'rgba(239,68,68,0.35)',
              background: 'rgba(239,68,68,0.08)',
            }}
          >
            <p className="text-[9px] font-heading uppercase tracking-wider" style={{ color: 'rgba(248,113,113,0.85)' }}>
              Reason
            </p>
            <p className="text-[12px] font-heading whitespace-pre-wrap break-words" style={{ color: 'var(--noir-foreground)' }}>
              {reason}
            </p>
          </div>
        ) : null}
        {until ? (
          <p className="text-[10px] font-heading text-center" style={{ color: 'var(--noir-muted)' }}>
            Until {until}
          </p>
        ) : null}
      </div>
    </div>
  );
}
