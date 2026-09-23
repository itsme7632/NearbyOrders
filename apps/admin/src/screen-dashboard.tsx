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
  fmtDateTime,
  useAsync,
} from './ds.js';

type AttentionRow = {
  label: string;
  count: number;
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
      label: 'Payment requests',
      count: d.pendingSubscriptionPayments ?? 0,
      hint: 'Subscription payments awaiting review',
      section: 'payments',
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

function RecentActivity() {
  const log = useAsync(() => api.listAuditLog(''), []);
  if (log.loading) return <LoadingState label="Loading recent activity…" />;
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

  if (dash.loading) {
    return (
      <>
        <PageHeader title="Dashboard" subtitle="Marketplace operations at a glance." />
        <LoadingState label="Loading platform metrics…" />
      </>
    );
  }

  if (dash.error || !dash.data) {
    return (
      <>
        <PageHeader title="Dashboard" subtitle="Marketplace operations at a glance." />
        <ErrorState message={dash.error ?? 'Could not load the dashboard.'} onRetry={dash.reload} />
      </>
    );
  }

  const d = dash.data;
  const active = attentionRows(d).filter((r) => r.count > 0);

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Marketplace operations at a glance." />

      <Card title="Needs attention" subtitle="Queues with items waiting on an admin.">
        {active.length === 0 ? (
          <EmptyState title="All caught up" body="No queues need attention right now." />
        ) : (
          <div className="nb-attention-list">
            {active.map((r) => (
              <AttentionItem
                key={`${r.section}-${r.status}`}
                label={r.label}
                count={r.count}
                hint={r.hint}
                onOpen={() => props.onTriage(r.section, r.status)}
              />
            ))}
          </div>
        )}
        <div className="nb-attention-list">
          <AttentionItem
            label="Verification review queue"
            hint="Applications awaiting a decision"
            onOpen={() => props.onTriage('verifications')}
          />
          <AttentionItem
            label="Promotion requests"
            hint="Promotion requests awaiting review"
            onOpen={() => props.onTriage('promotions')}
          />
        </div>
      </Card>

      <Card title="Platform totals">
        <div className="nb-kpi-grid">
          <Kpi label="Users" value={d.users ?? 0} />
          <Kpi label="Customers" value={d.customers ?? 0} />
          <Kpi label="Business owners" value={d.businessOwners ?? 0} />
          <Kpi label="Businesses" value={d.businesses ?? 0} />
          <Kpi label="Active businesses" value={d.activeBusinesses ?? 0} />
          <Kpi label="Orders" value={d.orders ?? 0} />
          <Kpi label="Bookings" value={d.bookings ?? 0} />
          <Kpi label="Reviews" value={d.reviews ?? 0} />
        </div>
        <p className="nb-muted">
          Push devices: {d.pushDevices?.active ?? 0}/{d.pushDevices?.total ?? 0} active
        </p>
      </Card>

      <Card title="Recent activity" subtitle="Latest admin actions across the platform.">
        <RecentActivity />
      </Card>
    </>
  );
}
