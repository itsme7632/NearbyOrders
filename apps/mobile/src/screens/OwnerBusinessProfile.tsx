import { useState } from 'react';
import { getMyBusinesses, logout, type Business } from '../api.js';
import { useAsyncData } from '../hooks.js';
import { Button, EmptyState, ErrorState, Loading } from '../components/ui.js';
import { StoreIcon } from '../components/icons.js';
import { SubscriptionBadge } from './subscription-badge.js';
import { Stars } from '../components/ReviewForm.js';

/**
 * Business-mode Profile: the SELECTED BUSINESS's identity and business /
 * platform controls. Personal identity (My Orders, My Bookings, My Reviews)
 * lives only in Customer mode.
 */
export function OwnerBusinessProfile(props: {
  onOpenDashboard: () => void;
  onEditProfile: () => void;
  onChangePassword: () => void;
  onOpenNotifications: () => void;
  onSwitchToCustomer: () => void;
  onListBusiness?: () => void;
}) {
  const businesses = useAsyncData<Business[]>(() => getMyBusinesses(), []);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);

  if (businesses.loading) return <Loading label="Loading your businesses…" />;
  if (businesses.error) return <ErrorState message={businesses.error} onRetry={businesses.reload} />;
  if (!businesses.data?.length) {
    return (
      <div className="screen">
        <EmptyState
          icon={<StoreIcon size={30} />}
          title="Your business"
          body="You haven't listed a business yet. Create your business profile to get started."
          action={props.onListBusiness ? <Button onClick={props.onListBusiness}>List my business</Button> : null}
        />
      </div>
    );
  }

  const active = businesses.data.find((b) => b.id === selectedId) ?? businesses.data[0];
  const place = [active.locality, active.city].filter(Boolean).join(', ');
  const category = active.categories[0]?.name;

  return (
    <div className="screen">
      <header className="owner-head">
        <h1>Business Profile</h1>
      </header>

      <div className="card profile-hero">
        <div className="avatar" aria-hidden>
          {active.name[0]?.toUpperCase() ?? '?'}
        </div>
        <div className="profile-hero-text">
          <h2 className="profile-hero-name">{active.name}</h2>
          <p className="profile-hero-email">{place || active.address}</p>
          <span className="badge-badge-row">
            <span className={`badge ${active.status === 'APPROVED' ? 'badge-open' : 'badge-closed'}`}>
              {active.status ?? 'PENDING'}
            </span>
            {active.isVerified ? <span className="badge badge-verified">✓ Verified</span> : null}
            {category ? <span className="pill">{category}</span> : null}
          </span>
          {active.averageRating != null ? <Stars value={active.averageRating} /> : null}
        </div>
      </div>
      <SubscriptionBadge businessId={active.id} />

      {businesses.data.length > 1 ? (
        <div className="filter-row" aria-label="Switch business">
          {businesses.data.map((b) => (
            <button key={b.id} className={`chip${b.id === active.id ? ' chip-active' : ''}`} onClick={() => setSelectedId(b.id)}>
              {b.name}
            </button>
          ))}
        </div>
      ) : null}

      <div className="card">
        <Button full onClick={props.onOpenDashboard}>
          Manage my business
        </Button>
      </div>

      <section className="hub-section" aria-label="Business management">
        <h3 className="hub-section-label">Business management</h3>
        <div className="hub-card">
          <button type="button" className="hub-row" onClick={props.onOpenDashboard}>
            <span className="hub-row-icon" aria-hidden>
              <StoreIcon size={19} />
            </span>
            <span className="hub-row-text">
              <span className="hub-row-title">Business dashboard</span>
              <span className="hub-row-sub">Profile, hours, catalog, payments, reviews</span>
            </span>
            <span className="hub-row-chevron" aria-hidden>
              ›
            </span>
          </button>
        </div>
      </section>

      <section className="hub-section" aria-label="Platform features">
        <h3 className="hub-section-label">Platform</h3>
        <div className="hub-card">
          <button type="button" className="hub-row" onClick={props.onOpenDashboard}>
            <span className="hub-row-icon" aria-hidden>
              ★
            </span>
            <span className="hub-row-text">
              <span className="hub-row-title">NearbyOrders Plan</span>
              <span className="hub-row-sub">Subscription and manual payments</span>
            </span>
            <span className="hub-row-chevron" aria-hidden>
              ›
            </span>
          </button>
          <button type="button" className="hub-row hub-row-disabled">
            <span className="hub-row-icon" aria-hidden>
              ✓
            </span>
            <span className="hub-row-text">
              <span className="hub-row-title">Verification</span>
              <span className="hub-row-sub">{active.isVerified ? 'Your business is verified' : 'Get a verified badge'}</span>
            </span>
            <span className="hub-row-soon">Soon</span>
          </button>
          <button type="button" className="hub-row hub-row-disabled">
            <span className="hub-row-icon" aria-hidden>
              ◆
            </span>
            <span className="hub-row-text">
              <span className="hub-row-title">Promotions</span>
              <span className="hub-row-sub">Featured listing and platform perks</span>
            </span>
            <span className="hub-row-soon">Soon</span>
          </button>
        </div>
      </section>

      <section className="hub-section" aria-label="Account">
        <h3 className="hub-section-label">Account</h3>
        <div className="hub-card">
          <button type="button" className="hub-row" onClick={props.onEditProfile}>
            <span className="hub-row-icon" aria-hidden>
              ✎
            </span>
            <span className="hub-row-text">
              <span className="hub-row-title">Personal information</span>
              <span className="hub-row-sub">Your name and phone (customer identity)</span>
            </span>
            <span className="hub-row-chevron" aria-hidden>
              ›
            </span>
          </button>
          <button type="button" className="hub-row" onClick={props.onChangePassword}>
            <span className="hub-row-icon" aria-hidden>
              🔒
            </span>
            <span className="hub-row-text">
              <span className="hub-row-title">Change password</span>
            </span>
            <span className="hub-row-chevron" aria-hidden>
              ›
            </span>
          </button>
          <button type="button" className="hub-row" onClick={props.onOpenNotifications}>
            <span className="hub-row-icon" aria-hidden>
              🔔
            </span>
            <span className="hub-row-text">
              <span className="hub-row-title">Notifications</span>
            </span>
            <span className="hub-row-chevron" aria-hidden>
              ›
            </span>
          </button>
        </div>
      </section>

      <section className="hub-section" aria-label="Switch context">
        <h3 className="hub-section-label">App context</h3>
        <div className="hub-card">
          <button type="button" className="hub-row" onClick={props.onSwitchToCustomer}>
            <span className="hub-row-icon" aria-hidden>
              ⇄
            </span>
            <span className="hub-row-text">
              <span className="hub-row-title">Switch to Customer mode</span>
              <span className="hub-row-sub">Explore and order from other businesses as yourself</span>
            </span>
            <span className="hub-row-chevron" aria-hidden>
              ›
            </span>
          </button>
        </div>
      </section>

      <div className="card">
        <Button full variant="ghost" onClick={logout}>
          Sign out
        </Button>
      </div>
    </div>
  );
}
