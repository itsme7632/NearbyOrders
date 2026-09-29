import type { ReactNode } from 'react';
import { formatMoney } from '@nearbyorders/shared';
import { formatDistanceKm, hasCoordinates } from '../location.js';
import type { Business } from '../api.js';
import { resolveImageUrl } from '../api.js';
import { StoreIcon } from './icons.js';
import { RemoteImage } from './RemoteImage.js';

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

/** Consistent star glyph for ratings; color comes from the token system. */
export function StarGlyph({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden focusable="false">
      <path d="m12 3.6 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.8l5.9-.9z" />
    </svg>
  );
}

/** Shows a rating only when the API provides one; never invents numbers. */
export function RatingChip({ average, count }: { average?: number | null; count?: number }) {
  if (average === null || average === undefined) return null;
  return (
    <span className="biz-card-rating" aria-label={`Rated ${average.toFixed(1)} out of 5`}>
      <StarGlyph />
      {average.toFixed(1)}
      {count !== undefined ? <span className="muted">({count})</span> : null}
    </span>
  );
}

/** Tappable rounded icon tile used for the Home category grid. */
export function CategoryTile(props: { name: string; icon: ReactNode; onClick: () => void }) {
  return (
    <button type="button" className="category-tile" onClick={props.onClick}>
      <span className="category-tile-icon" aria-hidden>
        {props.icon}
      </span>
      <span className="category-tile-name">{props.name}</span>
    </button>
  );
}

/** Selling section header with optional trailing action. */
export function SectionHeader(props: { title: string; action?: ReactNode }) {
  return (
    <div className="section-head">
      <h2>{props.title}</h2>
      {props.action}
    </div>
  );
}

export function Button(props: {
  children: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  full?: boolean;
  sm?: boolean;
  className?: string;
}) {
  const cls = `btn btn-${props.variant ?? 'primary'}${props.full ? ' btn-full' : ''}${props.sm ? ' btn-sm' : ''}${props.className ? ` ${props.className}` : ''}`;
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

export function EmptyState(props: { icon: ReactNode; title: string; body: string; action?: ReactNode }) {
  // Canonical empty state (Phase 1: EmptyStateV3 merged in): illustration
  // circle, tight title/body, optional action. One visual language everywhere.
  return (
    <div className="empty-state">
      <div className="empty-state-icon" aria-hidden>
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

/** Layout-matching shimmer placeholder for a list of business cards. */
export function BusinessCardSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div role="status" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skeleton-card" aria-hidden>
          <div className="skeleton skeleton-img" />
          <div className="skeleton-row">
            <div className="skeleton skeleton-line w-60" />
            <div className="skeleton skeleton-line w-25" />
          </div>
          <div className="skeleton skeleton-line w-40" />
        </div>
      ))}
    </div>
  );
}

/** Compact row-shaped placeholder for detail screens and lists. */
export function ListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div role="status" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skeleton-card" aria-hidden>
          <div className="skeleton-row">
            <div className="skeleton skeleton-thumb" />
            <div className="skeleton-stack">
              <div className="skeleton skeleton-line w-60" />
              <div className="skeleton skeleton-line w-40" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function Toggle(props: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label className="toggle">
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
        disabled={props.disabled}
      />
      <span className="toggle-track" aria-hidden />
      <span className="toggle-label">{props.label}</span>
    </label>
  );
}

/**
 * Editorial business row: the primary scanning unit across discovery screens
 * (Home lists, Explore results, map sheet). Media thumbnail left; name, rating,
 * category, distance and honest open/closed state in a compact meta line;
 * optional one-line description. Purely presentational — all data is real.
 */
export function BusinessRow(props: { business: Business; onOpen: () => void; selected?: boolean; showDescription?: boolean }) {
  const b = props.business;
  return (
    <button
      type="button"
      className={`biz-row${props.selected ? ' biz-row-selected' : ''}`}
      onClick={props.onOpen}
    >
      <span className="biz-row-media">
        {b.imageUrl ? (
          <RemoteImage src={resolveImageUrl(b.imageUrl) ?? undefined} alt="" loading="lazy" />
        ) : (
          <span className="pop-card-initial" aria-hidden>
            {b.name[0]?.toUpperCase() ?? '?'}
          </span>
        )}
      </span>
      <span className="biz-row-main">
        <span className="biz-row-name">{b.name}</span>
        <span className="biz-row-meta">
          <RatingChip average={b.averageRating} count={b.reviewCount ?? undefined} />
          {b.categories[0] ? <span className="biz-row-cat">{b.categories[0].name}</span> : null}
          {b.distanceKm !== undefined && b.distanceKm !== null ? (
            <span className="biz-distance">{formatDistanceKm(b.distanceKm)}</span>
          ) : null}
          {b.isOpenNow !== undefined ? (
            <span className={`biz-open${b.isOpenNow ? '' : ' biz-open-closed'}`}>{b.isOpenNow ? 'Open' : 'Closed'}</span>
          ) : null}
        </span>
        {props.showDescription && b.description ? <span className="biz-row-desc">{b.description}</span> : null}
      </span>
      <span className="biz-row-chevron" aria-hidden>
        ›
      </span>
    </button>
  );
}

/**
 * Marketplace business card: cover image (with graceful brand-gradient
 * fallback), category tag, name, rating when available, locality/distance
 * and open/closed status. Purely presentational: all data comes from the API.
 */
export function BusinessCard(props: { business: Business; onOpen: () => void }) {
  const b = props.business;
  const category = b.categories[0]?.name;
  const place = [b.locality, b.city].filter(Boolean).join(', ');
  // Only server-computed distances for businesses with real coordinates are
  // shown — never a client-invented estimate (Phase 11).
  const distance =
    b.distanceKm !== undefined && b.distanceKm !== null && hasCoordinates(b) ? formatDistanceKm(b.distanceKm) : null;
  return (
    <button className="biz-card" onClick={props.onOpen}>
      <span className="biz-card-imgwrap">
        {b.imageUrl ? (
          <RemoteImage className="biz-card-img" src={resolveImageUrl(b.imageUrl) ?? undefined} alt="" loading="lazy" />
        ) : (
          <span className="detail-hero-fallback">
            <StoreIcon size={34} />
          </span>
        )}
        {category ? <span className="biz-card-cat">{category}</span> : null}
      </span>
      <span className="biz-card-body">
        <span className="biz-card-titlerow">
          <span className="biz-card-name">{b.name}</span>
          {b.isVerified ? <span className="verified-dot" title="Verified">✓</span> : null}
          <RatingChip average={b.averageRating} />
        </span>
        {b.description ? <span className="biz-card-desc">{b.description}</span> : null}
        <span className="biz-card-meta">
          {distance ? <span className="biz-distance">📍 {distance}</span> : place ? <span className="biz-place">📍 {place}</span> : null}
          {b.isOpenNow !== undefined ? <OpenBadge open={b.isOpenNow} /> : null}
        </span>
      </span>
    </button>
  );
}
