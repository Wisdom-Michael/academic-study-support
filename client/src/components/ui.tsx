import { ReactNode } from 'react';
import { LucideIcon } from 'lucide-react';

/** Circle with a person's initials, used wherever the design shows a profile photo. */
export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' }) {
  const initials = name
    .replace(/^(Dr|Prof|Mr|Ms|Mrs)\.?\s+/i, '')
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
  return <span className={`avatar avatar-${size}`} aria-hidden="true">{initials}</span>;
}

/** White rounded panel with an optional title row and action. */
export function Card({ title, action, className = '', children, id }: {
  title?: ReactNode;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
  id?: string;
}) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section className={`card ${className}`} id={id} aria-labelledby={title ? headingId : undefined}>
      {(title || action) && (
        <div className="card-head">
          {title && <h2 id={headingId}>{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export type Tone = 'teal' | 'gold' | 'navy' | 'plain';

/** A headline figure: label, value, and a line of context. */
export function StatTile({ label, value, detail, tone = 'plain', icon: Icon }: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  tone?: Tone;
  icon: LucideIcon;
}) {
  return (
    <div className={`stat-tile stat-${tone}`}>
      <div className="stat-top">
        <span className="stat-label">{label}</span>
        <span className="stat-icon"><Icon size={16} strokeWidth={2.2} aria-hidden="true" /></span>
      </div>
      <p className="stat-value">{value}</p>
      {detail && <p className="stat-detail">{detail}</p>}
    </div>
  );
}

/** Small rounded status label; always text, so meaning never depends on colour alone. */
export function Pill({ tone, children }: { tone: 'high' | 'medium' | 'low' | 'pending' | 'active' | 'done' | 'neutral'; children: ReactNode }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

/** Page title row: heading, one line of context, and optional actions on the right. */
export function PageHeader({ title, lede, actions }: { title: string; lede?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {lede && <p className="lede">{lede}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}
