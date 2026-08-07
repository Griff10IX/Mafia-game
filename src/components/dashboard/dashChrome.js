/**
 * Shared dashboard command-center chrome.
 */
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import dash from '../../styles/dashboard.module.css';

export function DashPanel({ children, className = '', compact = false, as: Tag = 'div', ...rest }) {
  return (
    <Tag className={`${dash.panel} mobile-panel ${className}`.trim()} {...rest}>
      {children}
    </Tag>
  );
}

export function DashHeader({ title, icon: Icon, actionTo, actionLabel, actionNode, badge }) {
  return (
    <div className={dash.panelHeader}>
      <h2 className={dash.panelTitle}>
        {Icon ? <Icon size={11} className="shrink-0" aria-hidden /> : null}
        <span className="truncate">{title}</span>
        {badge != null ? badge : null}
      </h2>
      {actionNode || (actionTo && actionLabel ? (
        <Link to={actionTo} className={dash.panelAction}>
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
    <div className={`${dash.panel} mobile-panel ${dash.panelBody}`}>
      <div className="flex items-center gap-2" style={{ color: 'var(--noir-muted)', fontSize: 10 }}>
        {Icon ? <Icon size={14} className="animate-pulse shrink-0" aria-hidden /> : null}
        <span className="font-heading">{label}</span>
      </div>
    </div>
  );
}
