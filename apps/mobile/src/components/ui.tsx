import type { ReactNode } from 'react';
import { formatMoney } from '@nearbyorders/shared';
import type { Business } from '../api.js';

export function Money({ minor, currency = 'PKR' }: { minor: number; currency?: string }) {
  return <span className="money">{formatMoney(minor, currency)}</span>;
}

export function VerifiedBadge({ verified }: { verified: boolean }) {
  if (!verified) return null;
  return (
    <span className="badge badge-verified" title="Verified by NearbyOrders">
      ✓ Verified
    </span>
  );
}

export function OpenBadge({ open }: { open: boolean }) {
  return (
    <span className={`badge ${open ? 'badge-open' : 'badge-closed'}`}>{open ? 'Open now' : 'Closed'}</span>
  );
}

export function CategoryPill({ name }: { name: string }) {
  return <span className="pill">{name}</span>;
}

export function Button(props: {
  children: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  full?: boolean;
  sm?: boolean;
}) {
  const cls = `btn btn-${props.variant ?? 'primary'}${props.full ? ' btn-full' : ''}${props.sm ? ' btn-sm' : ''}`;
  return (
    <button type={props.type ?? 'button'} className={cls} onClick={props.onClick} disabled={props.disabled}>
      {props.children}
    </button>
  );
}

export function Field(props: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span className="label">{props.label}</span>
      {props.children}
      {props.hint ? <span className="hint">{props.hint}</span> : null}
    </label>
  );
}

export function EmptyState(props: { icon: string; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <div className="empty-icon" aria-hidden>
        {props.icon}
      </div>
      <h3>{props.title}</h3>
      <p>{props.body}</p>
      {props.action}
    </div>
  );
}

export function ErrorState(props: { message: string; onRetry?: () => void }) {
  return (
    <div className="error-state" role="alert">
      <p>⚠ {props.message}</p>
      {props.onRetry ? (
        <Button variant="secondary" sm onClick={props.onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <span className="spinner" aria-hidden /> {label}
    </div>
  );
}

export function Toggle(props: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="toggle">
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
      />
      <span className="toggle-track" aria-hidden />
      <span className="toggle-label">{props.label}</span>
    </label>
  );
}

export function BusinessCard(props: { business: Business; onOpen: () => void }) {
  const b = props.business;
  const category = b.categories[0]?.name;
  const place = [b.locality, b.city].filter(Boolean).join(', ');
  return (
    <button className="business-card" onClick={props.onOpen}>
      <div className="business-card-body">
        <div className="business-card-title">
          <span className="biz-name">{b.name}</span>
          {b.isVerified ? <span className="verified-dot" title="Verified">✓</span> : null}
        </div>
        {b.description ? <p className="biz-desc">{b.description}</p> : null}
        <div className="biz-meta">
          {category ? <CategoryPill name={category} /> : null}
          {place ? <span className="biz-place">📍 {place}</span> : null}
          {b.isOpenNow !== undefined ? <OpenBadge open={b.isOpenNow} /> : null}
        </div>
      </div>
      <span className="business-card-chevron" aria-hidden>
        ›
      </span>
    </button>
  );
}
