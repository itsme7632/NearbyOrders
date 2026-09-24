import { useState } from 'react';
import { getMyBusinesses, getVerification, logout, type Business } from '../api.js';
import { useAsyncData } from '../hooks.js';
import { Button, EmptyState, ErrorState, Loading } from '../components/ui.js';
import {
  BellIcon,
  CheckIcon,
  ChevronRightIcon,
  ExploreIcon,
  LockIcon,
  StarIcon,
  StoreIcon,
  UserIcon,
} from '../components/icons.js';
import { OwnerPlanCard } from './subscription-badge.js';
import { Stars } from '../components/ReviewForm.js';

/**
 * Business-mode Profile: the SELECTED BUSINESS's identity and business /
 * platform controls. Personal identity (My Orders, My Bookings, My Reviews)
 * lives only in Customer mode.
 *
 * Section order is deliberate: 1) business identity/status, 2) the
 * NearbyOrders Plan card (never buried), 3) manage my business,
 * 4) verification (real status), 5) promotions (real), 6) account.
 */
export function OwnerBusinessProfile(props: {
  onOpenDashboard: () => void;
  onOpenBusinessScreen: (businessId: string, screen: 'subscription' | 'verification' | 'promotions') => void;
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
      <div className="screen owner-business-profile">
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
  const open = (screen: 'subscription' | 'verification' | 'promotions') =>
    props.onOpenBusinessScreen(active.id, screen);

  return (
    <div className="screen owner-business-profile">
      <header className="owner-head">
        <h1>Business Profile</h1>
      </header>

      {/* 1) Business identity / status. */}
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

      {/* 2) NearbyOrders Plan: prominent, near the top, never buried. */}
      <OwnerPlanCard
        businessId={active.id}
        onManagePlan={() => open('subscription')}
        onViewPayments={() => open('subscription')}
      />

      {businesses.data.length > 1 ? (
        <div className="filter-row" aria-label="Switch business">
          {businesses.data.map((b) => (
            <button key={b.id} className={`chip${b.id === active.id ? ' chip-active' : ''}`} onClick={() => setSelectedId(b.id)}>
              {b.name}
            </button>
          ))}
        </div>
      ) : null}

      {/* 3) Manage my business. */}
      <section className="hub-section" aria-label="Manage my business">
        <h3 className="hub-section-label">Manage my business</h3>
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
              <ChevronRightIcon size={18} />
            </span>
          </button>
          {props.onListBusiness ? (
            <button type="button" className="hub-row hub-row-quiet" onClick={props.onListBusiness}>
              <span className="hub-row-icon" aria-hidden>
                <StoreIcon size={19} />
              </span>
              <span className="hub-row-text">
                <span className="hub-row-title">Add another business</span>
                <span className="hub-row-sub">List a second location or brand</span>
              </span>
              <span className="hub-row-chevron" aria-hidden>
                <ChevronRightIcon size={18} />
              </span>
            </button>
          ) : null}
        </div>
      </section>

      {/* 4) Verification and 5) Promotions: real rows with live status. */}
      <section className="hub-section" aria-label="Platform">
        <h3 className="hub-section-label">Platform</h3>
        <div className="hub-card">
          <VerificationRow businessId={active.id} onOpen={() => open('verification')} />
          <button type="button" className="hub-row" onClick={() => open('promotions')}>
            <span className="hub-row-icon" aria-hidden>
              <StarIcon size={19} />
            </span>
            <span className="hub-row-text">
              <span className="hub-row-title">Promotions</span>
              <span className="hub-row-sub">Featured listing and platform perks</span>
            </span>
            <span className="hub-row-chevron" aria-hidden>
              <ChevronRightIcon size={18} />
            </span>
          </button>
        </div>
      </section>

      {/* 6) Account. */}
      <section className="hub-section" aria-label="Account">
        <h3 className="hub-section-label">Account</h3>
        <div className="hub-card">
          <button type="button" className="hub-row" onClick={props.onEditProfile}>
            <span className="hub-row-icon" aria-hidden>
              <UserIcon size={19} />
            </span>
            <span className="hub-row-text">
              <span className="hub-row-title">Personal information</span>
              <span className="hub-row-sub">Your name and phone (customer identity)</span>
            </span>
            <span className="hub-row-chevron" aria-hidden>
              <ChevronRightIcon size={18} />
            </span>
          </button>
          <button type="button" className="hub-row" onClick={props.onChangePassword}>
            <span className="hub-row-icon" aria-hidden>
              <LockIcon size={19} />
            </span>
            <span className="hub-row-text">
              <span className="hub-row-title">Change password</span>
            </span>
            <span className="hub-row-chevron" aria-hidden>
              <ChevronRightIcon size={18} />
            </span>
          </button>
          <button type="button" className="hub-row" onClick={props.onOpenNotifications}>
            <span className="hub-row-icon" aria-hidden>
              <BellIcon size={19} />
            </span>
            <span className="hub-row-text">
              <span className="hub-row-title">Notifications</span>
            </span>
            <span className="hub-row-chevron" aria-hidden>
              <ChevronRightIcon size={18} />
            </span>
          </button>
        </div>
      </section>

      <section className="hub-section" aria-label="Switch context">
        <h3 className="hub-section-label">App context</h3>
        <div className="hub-card">
          <button type="button" className="hub-row" onClick={props.onSwitchToCustomer}>
            <span className="hub-row-icon" aria-hidden>
              <ExploreIcon size={19} />
            </span>
            <span className="hub-row-text">
              <span className="hub-row-title">Switch to Customer mode</span>
              <span className="hub-row-sub">Explore and order from other businesses as yourself</span>
            </span>
            <span className="hub-row-chevron" aria-hidden>
              <ChevronRightIcon size={18} />
            </span>
          </button>
        </div>
      </section>

      <div className="card">
        <Button full variant="ghost" onClick={() => void logout()}>
          Sign out
        </Button>
      </div>
    </div>
  );
}

/** Verification hub row with the live application status (never "Soon"). */
function VerificationRow(props: { businessId: string; onOpen: () => void }) {
  const verification = useAsyncData(() => getVerification(props.businessId), [props.businessId]);
  const status = verification.data?.application?.status ?? null;
  const sub = status === 'APPROVED'
    ? 'Your business is verified'
    : status === 'SUBMITTED' || status === 'UNDER_REVIEW'
      ? 'Under review by the NearbyOrders team'
      : status === 'CHANGES_REQUESTED'
        ? 'The review team asked for changes'
        : status === 'REJECTED'
          ? 'Not approved: update and resubmit'
          : status === 'DRAFT'
            ? 'Continue your application'
            : 'Get a verified badge';
  return (
    <button type="button" className="hub-row" onClick={props.onOpen}>
      <span className="hub-row-icon" aria-hidden>
        <CheckIcon size={19} />
      </span>
      <span className="hub-row-text">
        <span className="hub-row-title">Verification</span>
        <span className="hub-row-sub">{sub}</span>
      </span>
      {status === 'APPROVED' ? <span className="badge badge-verified">✓ Verified</span> : null}
      <span className="hub-row-chevron" aria-hidden>
        <ChevronRightIcon size={18} />
      </span>
    </button>
  );
}
