import React from 'react';
import * as api from './api.js';
import type { AdminDashboard, AuditEntry } from './api.js';
import {
  PageHeader,
  Kpi,
  AttentionItem,
  Card,
  LoadingState,
  ErrorState,
  EmptyState,
  Badge,
  Skeleton,
  fmtDateTime,
  useAsync,
} from './ds.js';

type AttentionRow = {
  label: string;
  count: number | null;
  hint?: string;
  section: string;
  status?: string;
};

function attentionRows(d: AdminDashboard): AttentionRow[] {
  return [
    {
      label: 'Pending businesses',
      count: d.pendingBusinesses ?? 0,
      hint: 'Businesses awaiting an approval decision',
      section: 'businesses',
      status: 'PENDING',
    },
    {
      label: 'Payment requests',
      count: d.pendingSubscriptionPayments ?? 0,
      hint: 'Subscription payments awaiting review',
      section: 'payments',
      status: 'PENDING',
    },
    {
      label: 'Pending orders',
      count: d.pendingOrders ?? 0,
      hint: 'Orders waiting on the business',
      section: 'orders',
      status: 'PENDING',
    },
    {
      label: 'Pending bookings',
      count: d.pendingBookings ?? 0,
      hint: 'Booking requests awaiting confirmation',
      section: 'bookings',
      status: 'PENDING',
    },
    {
      label: 'Hidden reviews',
      count: d.hiddenReviews ?? 0,
      hint: 'Reviews hidden from customers',
      section: 'reviews',
      status: 'hidden',
    },
    {
      label: 'Suspended businesses',
      count: d.suspendedBusinesses ?? 0,
      hint: 'Suspended and out of discovery',
      section: 'businesses',
      status: 'SUSPENDED',
    },
  ];
}

/** Queue counts that are not part of the dashboard payload, fetched live. */
function useExtraQueues() {
  const verif = useAsync(
    () =>
      Promise.all([
        api.listVerifications({ status: 'SUBMITTED' }),
        api.listVerifications({ status: 'UNDER_REVIEW' }),
      ]).then(([a, b]) => a.length + b.length),
    [],
  );
  const promo = useAsync(
    () =>
      Promise.all([
        api.listPromotionRequests('PENDING'),
        api.listPromotionPaymentRequests({ status: 'PENDING' }),
      ]).then(([a, b]) => a.length + b.items.length),
    [],
  );
  return { verif, promo };
}

function RecentActivity() {
  const log = useAsync(() => api.listAuditLog(''), []);
  if (log.loading) return <Skeleton rows={5} />;
  if (log.error) {
    return (
      <div className="nb-state">
        <p className="nb-state-body nb-muted">Could not load recent activity.</p>
        <div className="nb-state-action">
          <button type="button" className="nb-btn nb-btn-secondary" onClick={log.reload}>
            Try again
          </button>
        </div>
      </div>
    );
  }
  const items: AuditEntry[] = (log.data ?? []).slice(0, 8);
  if (items.length === 0) {
    return <EmptyState title="No activity yet" body="No admin actions have been recorded." />;
  }
  return (
    <ul className="nb-timeline">
      {items.map((e) => (
        <li key={e.id} className="nb-timeline-item">
          <span className="nb-timeline-time">{fmtDateTime(e.createdAt)}</span>
          <div className="nb-timeline-body">
            <span className="nb-timeline-actor">{e.actor?.email ?? 'system'}</span>{' '}
            <Badge value={e.action} />{' '}
            <span className="nb-timeline-target">
              {e.entityType}/{e.entityId.slice(0, 8)}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Dashboard(props: { onTriage: (section: string, status?: string) => void }) {
  const dash = useAsync(() => api.getDashboard(), []);
  const { verif, promo } = useExtraQueues();

  if (dash.loading) {
    return (
      <>
        <PageHeader kicker="Operations" title="Command center" subtitle="Marketplace operations at a glance." />
        <Card title="Needs attention">
          <Skeleton rows={4} />
        </Card>
        <Card title="Platform snapshot">
          <Skeleton rows={2} height={52} />
        </Card>
      </>
    );
  }

  if (dash.error || !dash.data) {
    return (
      <>
        <PageHeader kicker="Operations" title="Command center" subtitle="Marketplace operations at a glance." />
        <ErrorState message={dash.error ?? 'Could not load the dashboard.'} onRetry={dash.reload} />
      </>
    );
  }

  const d = dash.data;
  const rows: AttentionRow[] = [
    ...attentionRows(d),
    {
      label: 'Verification applications',
      count: verif.data ?? null,
      hint: 'Submitted or under review, awaiting a decision',
      section: 'verifications',
      status: 'SUBMITTED',
    },
    {
      label: 'Promotion queue',
      count: promo.data ?? null,
      hint: 'Promotion requests and payments awaiting review',
      section: 'promotions',
    },
  ];
  const active = rows.filter((r) => (r.count ?? 0) > 0);
  const unknown = rows.filter((r) => r.count === null && !r.status);

  return (
    <>
      <PageHeader
        kicker="Operations"
        title="Command center"
        subtitle="What needs your attention right now, and the state of the marketplace."
      />

      <Card title="Needs attention" subtitle="Queues with items waiting on an admin. Select a queue to open it filtered.">
        {active.length === 0 ? (
          <EmptyState title="All caught up" body="No queues need attention right now." />
        ) : (
          <div className="nb-attention-list">
            {active.map((r) => (
              <AttentionItem
                key={`${r.section}-${r.status ?? 'all'}`}
                label={r.label}
                count={r.count ?? undefined}
                hint={r.hint}
                onOpen={() => props.onTriage(r.section, r.status)}
              />
            ))}
          </div>
        )}
        {unknown.length > 0 && (verif.error || promo.error) ? (
          <p className="nb-hint">Some queue counts could not be loaded. The queues themselves are still available in the rail.</p>
        ) : null}
      </Card>

      <Card title="Platform snapshot" subtitle="Live totals from the API.">
        <div className="nb-kpi-grid">
          <Kpi label="Businesses" value={d.businesses ?? 0} sub={`${d.activeBusinesses ?? 0} active`} />
          <Kpi label="Users" value={d.users ?? 0} sub={`${d.customers ?? 0} customers · ${d.businessOwners ?? 0} owners`} />
          <Kpi label="Orders" value={d.orders ?? 0} />
          <Kpi label="Bookings" value={d.bookings ?? 0} />
          <Kpi label="Reviews" value={d.reviews ?? 0} />
          <Kpi
            label="Push devices"
            value={`${d.pushDevices?.active ?? 0}/${d.pushDevices?.total ?? 0}`}
            sub="active / total"
          />
        </div>
      </Card>

      <Card title="Recent activity" subtitle="Latest admin actions across the platform.">
        <RecentActivity />
      </Card>
    </>
  );
}
