/**
 * Shared dashboard chrome — uses noir .panel so Classic / Modern / Dark Mafia Wars themes apply
 * the same as Crimes, Attack, and other pages.
 */
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import styles from '../../styles/noir.module.css';
import dash from '../../styles/dashboard.module.css';

export function DashPanel({ children, className = '', as: Tag = 'div', ...rest }) {
  return (
    <Tag
      className={`${styles.panel} relative rounded-md overflow-hidden border border-primary/20 mobile-panel ${className}`.trim()}
      {...rest}
    >
      {children}
    </Tag>
  );
}

export function DashHeader({ title, icon: Icon, actionTo, actionLabel, actionNode, badge }) {
  return (
    <div className={`${styles.panelHeader} px-2.5 py-1.5 border-b border-primary/20 flex items-center justify-between gap-2`}>
      <h2 className={`${dash.panelTitle} font-heading`}>
        {Icon ? <Icon size={11} className="shrink-0" aria-hidden /> : null}
        <span className="truncate">{title}</span>
        {badge != null ? badge : null}
      </h2>
      {actionNode || (actionTo && actionLabel ? (
        <Link to={actionTo} className={`${dash.panelAction} font-heading`}>
          {actionLabel} <ChevronRight size={10} aria-hidden />
        </Link>
      ) : null)}
    </div>
  );
}

export function DashBody({ children, compact = false, className = '' }) {
  return (
    <div className={`${compact ? dash.panelBodyCompact : dash.panelBody} ${className}`.trim()}>
      {children}
    </div>
  );
}

export function DashLoading({ icon: Icon, label = 'Loading…' }) {
  return (
    <DashPanel>
      <div className={`${dash.panelBody} flex items-center gap-2`} style={{ color: 'var(--noir-muted)', fontSize: 10 }}>
        {Icon ? <Icon size={14} className="animate-pulse shrink-0" aria-hidden /> : null}
        <span className="font-heading">{label}</span>
      </div>
    </DashPanel>
  );
}
