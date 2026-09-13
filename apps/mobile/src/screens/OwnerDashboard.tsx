import { useState } from 'react';
import { getMyBusinesses, type Business } from '../api.js';
import { useAsyncData } from '../hooks.js';
import { Button, EmptyState, ErrorState, Loading } from '../components/ui.js';
import { CheckIcon, OrdersIcon, StoreIcon } from '../components/icons.js';
import { OwnerHubRow, OwnerHubSection } from './owner-ui.js';

/**
 * Business Dashboard hub. Pure navigation: it never renders the management
 * forms themselves — each lives on its own dedicated screen (routes under
 * /owner/...). Everything here scrolls in the normal document flow, so no
 * overlay can ever cover page content.
 */
export function OwnerDashboardScreen(props: {
  onBack: () => void;
  onOpen: (path: string) => void;
  onListBusiness?: () => void;
  justCreatedName?: string | null;
  justCreatedStatus?: string | null;
}) {
  const businesses = useAsyncData<Business[]>(() => getMyBusinesses(), []);
  const [businessId, setBusinessId] = useState<string | undefined>(undefined);

  if (businesses.loading) return <Loading label="Loading your businesses…" />;
  if (businesses.error) return <ErrorState message={businesses.error} onRetry={businesses.reload} />;
  if (!businesses.data?.length) {
    return (
      <div className="screen">
        <button className="back-link" onClick={props.onBack}>
          ‹ Back
        </button>
        <EmptyState
          icon={<StoreIcon size={30} />}
          title="Your business"
          body="You haven't listed a business yet. Create your business profile and start accepting bookings."
          action={
            props.onListBusiness ? (
              <Button onClick={props.onListBusiness}>List my business</Button>
            ) : null
          }
        />
      </div>
    );
  }

  const active = businesses.data.find((b) => b.id === businessId) ?? businesses.data[0];
  const switcher =
    businesses.data.length > 1 ? (
      <div className="filter-row" aria-label="Switch business">
        {businesses.data.map((b) => (
          <button key={b.id} className={`chip${b.id === active.id ? ' chip-active' : ''}`} onClick={() => setBusinessId(b.id)}>
            {b.name}
          </button>
        ))}
      </div>
    ) : null;
  const base = `/owner/${active.id}`;

  return (
    <div className="screen">
      <button className="back-link" onClick={props.onBack}>
        ‹ Back
      </button>
      <header className="owner-head">
        <h1>Business dashboard</h1>
      </header>
      {props.justCreatedName ? (
        <div className="created-banner" role="status">
          <CheckIcon size={16} />
          <span>
            <strong>{props.justCreatedName}</strong> has been created. Add your services and opening hours below.
            {props.justCreatedStatus === 'APPROVED'
              ? ' It\'s now visible to customers.'
              : ' It will appear in customer search once approved.'}
          </span>
        </div>
      ) : null}
      {/* One business: manage it directly. Several: the switcher above shows
          which business the sections below act on. */}
      {businesses.data.length === 1 ? (
        <div className="owner-biz-card" aria-label="Managed business">
          <span className="owner-biz-name">{active.name}</span>
          <span className={`badge ${active.status === 'APPROVED' ? 'badge-open' : 'badge-closed'}`}>{active.status}</span>
        </div>
      ) : null}
      {switcher}
      <div className="btn-row">
        {props.onListBusiness ? (
          <Button variant="ghost" sm onClick={props.onListBusiness}>
            List another business
          </Button>
        ) : null}
      </div>

      <OwnerHubSection label="Business">
        <OwnerHubRow
          icon={<StoreIcon size={18} />}
          title="Business Profile"
          subtitle="Name, description, contact, logo, categories"
          onClick={() => props.onOpen(`${base}/profile`)}
        />
        <OwnerHubRow
          icon={<OrdersIcon size={18} />}
          title="Business Hours"
          subtitle="Opening times for each day of the week"
          onClick={() => props.onOpen(`${base}/hours`)}
        />
        <OwnerHubRow
          icon={<OrdersIcon size={18} />}
          title="Delivery & COD"
          subtitle="Own-rider delivery, cash on delivery, delivery fee"
          onClick={() => props.onOpen(`${base}/delivery`)}
        />
      </OwnerHubSection>

      <OwnerHubSection label="Catalog">
        <OwnerHubRow
          icon={<StoreIcon size={18} />}
          title="Services"
          subtitle="Bookable services, prices and advance settings"
          onClick={() => props.onOpen(`${base}/services`)}
        />
        <OwnerHubRow
          icon={<OrdersIcon size={18} />}
          title="Products / Menu"
          subtitle="Products customers can order"
          onClick={() => props.onOpen(`${base}/products`)}
        />
      </OwnerHubSection>

      <OwnerHubSection label="Operations">
        <OwnerHubRow
          icon={<OrdersIcon size={18} />}
          title="Bookings"
          subtitle="Accept, reject and complete customer bookings"
          onClick={() => props.onOpen(`${base}/bookings`)}
        />
        <OwnerHubRow
          icon={<OrdersIcon size={18} />}
          title="Orders"
          subtitle="Incoming orders and cash collection"
          onClick={() => props.onOpen(`${base}/orders`)}
        />
        <OwnerHubRow
          icon={<OrdersIcon size={18} />}
          title="Customer Payments"
          subtitle="Verify or reject customer payment proofs"
          onClick={() => props.onOpen(`${base}/payments`)}
        />
      </OwnerHubSection>

      <OwnerHubSection label="Payments">
        <OwnerHubRow
          icon={<OrdersIcon size={18} />}
          title="Business Payment Methods"
          subtitle="Channels customers use to pay you"
          onClick={() => props.onOpen(`${base}/payment-methods`)}
        />
        <OwnerHubRow
          icon={<OrdersIcon size={18} />}
          title="Service Advance Settings"
          subtitle="Managed per service on the Services screen"
          onClick={() => props.onOpen(`${base}/advances`)}
        />
      </OwnerHubSection>

      <OwnerHubSection label="Trust">
        <OwnerHubRow
          icon={<OrdersIcon size={18} />}
          title="Reviews"
          subtitle="What customers say about your business"
          onClick={() => props.onOpen(`${base}/reviews`)}
        />
      </OwnerHubSection>

      <OwnerHubSection label="Account">
        <OwnerHubRow
          icon={<OrdersIcon size={18} />}
          title="Business Subscription"
          subtitle="Trial, plan and manual payments"
          onClick={() => props.onOpen(`${base}/subscription`)}
        />
        <OwnerHubRow
          icon={<OrdersIcon size={18} />}
          title="Business Settings"
          subtitle="Delivery, COD and payment channels"
          onClick={() => props.onOpen(`${base}/settings`)}
        />
      </OwnerHubSection>
    </div>
  );
}
