import React, { useState } from 'react';
import * as api from './api.js';
import type {
  AdminBooking,
  AdminOrder,
  VerificationApplication,
  VerificationDocument,
} from './api.js';
import {
  Badge,
  DataTable,
  DefinitionList,
  Drawer,
  EmptyState,
  ErrorState,
  Field,
  FilterSelect,
  FormActions,
  FormError,
  LoadingState,
  Modal,
  PageHeader,
  SearchInput,
  SectionTitle,
  Tabs,
  Toolbar,
  useAsync,
  fmtDate,
  fmtDateTime,
  fmtMoney,
  statusLabel,
} from './ds.js';
import type { Column } from './ds.js';

/* ------------------------------------------------------------------
   Operations screens: Orders, Bookings, Verification review.
------------------------------------------------------------------- */

const ORDER_STATUSES = ['PENDING', 'ACCEPTED', 'PREPARING', 'READY', 'COMPLETED', 'REJECTED', 'CANCELLED'];
const BOOKING_STATUSES = ['PENDING', 'CONFIRMED', 'COMPLETED', 'REJECTED', 'CANCELLED'];
const VERIFICATION_STATUSES = ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED'];

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

function personName(firstName: string | null, lastName: string | null, fallback: string): string {
  const name = [firstName, lastName].filter(Boolean).join(' ').trim();
  return name || fallback;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/* ------------------------------- Orders ------------------------------ */

function OrderDrawer(props: { order: AdminOrder; onClose: () => void }) {
  const o = props.order;
  return (
    <Drawer
      title={`Order #${shortId(o.id)}`}
      subtitle={`Placed ${fmtDateTime(o.createdAt)}`}
      onClose={props.onClose}
    >
      <DefinitionList
        items={[
          { label: 'Order ID', value: <span className="nb-mono">{o.id}</span> },
          { label: 'Status', value: <Badge value={o.status} /> },
          {
            label: 'Customer',
            value: (
              <>
                <span className="nb-cell-main">
                  {personName(o.customer.firstName, o.customer.lastName, o.customer.email)}
                </span>
                <span className="nb-cell-sub">{o.customer.email}</span>
              </>
            ),
          },
          { label: 'Business', value: o.business.name },
          { label: 'Subtotal', value: fmtMoney(o.subtotalMinor, o.currency) },
          { label: 'Total', value: fmtMoney(o.totalMinor ?? o.subtotalMinor, o.currency) },
          { label: 'Placed', value: fmtDateTime(o.createdAt) },
        ]}
      />
    </Drawer>
  );
}

export function Orders(props: { initialStatus?: string }) {
  const [status, setStatus] = useState(props.initialStatus ?? '');
  const [selected, setSelected] = useState<AdminOrder | null>(null);
  const { data, loading, error, reload } = useAsync(() => api.listOrders(status), [status]);
  const orders = data ?? [];

  const columns: Column<AdminOrder>[] = [
    {
      key: 'order',
      header: 'Order',
      render: (o) => (
        <>
          <span className="nb-cell-main nb-mono">#{shortId(o.id)}</span>
          <span className="nb-cell-sub">{fmtDate(o.createdAt)}</span>
        </>
      ),
    },
    {
      key: 'customer',
      header: 'Customer',
      render: (o) => (
        <>
          <span className="nb-cell-main">{personName(o.customer.firstName, o.customer.lastName, o.customer.email)}</span>
          <span className="nb-cell-sub">{o.customer.email}</span>
        </>
      ),
    },
    { key: 'business', header: 'Business', render: (o) => o.business.name, hideBelow: 'md' },
    {
      key: 'amount',
      header: 'Amount',
      render: (o) => fmtMoney(o.totalMinor ?? o.subtotalMinor, o.currency),
    },
    { key: 'status', header: 'Status', render: (o) => <Badge value={o.status} /> },
    {
      key: 'actions',
      header: 'Actions',
      render: (o) => (
        <div className="nb-cell-actions">
          <button type="button" className="nb-btn nb-btn-secondary nb-btn-sm" onClick={() => setSelected(o)}>
            View
          </button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Orders"
        subtitle={loading && orders.length === 0 ? 'Loading orders…' : plural(orders.length, 'order', 'orders')}
      />
      <Tabs
        tabs={[{ key: '', label: 'All statuses' }, ...ORDER_STATUSES.map((s) => ({ key: s, label: statusLabel(s) }))]}
        active={status}
        onChange={setStatus}
      />
      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : loading && orders.length === 0 ? (
        <LoadingState label="Loading orders…" />
      ) : (
        <DataTable<AdminOrder>
          columns={columns}
          rows={orders}
          rowKey={(o) => o.id}
          onRowClick={setSelected}
          empty={<EmptyState title="No orders match this filter." />}
        />
      )}
      {selected ? <OrderDrawer order={selected} onClose={() => setSelected(null)} /> : null}
    </>
  );
}

/* ------------------------------ Bookings ----------------------------- */

function BookingDrawer(props: { booking: AdminBooking; onClose: () => void }) {
  const b = props.booking;
  return (
    <Drawer
      title={`Booking #${shortId(b.id)}`}
      subtitle={`Created ${fmtDateTime(b.createdAt)}`}
      onClose={props.onClose}
    >
      <DefinitionList
        items={[
          { label: 'Booking ID', value: <span className="nb-mono">{b.id}</span> },
          { label: 'Status', value: <Badge value={b.status} /> },
          { label: 'Service', value: b.service ? b.service.name : 'N/A' },
          {
            label: 'Customer',
            value: (
              <>
                <span className="nb-cell-main">
                  {personName(b.customer.firstName, b.customer.lastName, b.customer.email)}
                </span>
                <span className="nb-cell-sub">{b.customer.email}</span>
              </>
            ),
          },
          { label: 'Business', value: b.business.name },
          { label: 'Booking date', value: fmtDate(b.bookingDate) },
          { label: 'Starts', value: fmtDateTime(b.startAt) },
          {
            label: 'Amount due',
            value: b.amountDueMinor == null ? 'N/A' : fmtMoney(b.amountDueMinor, b.currency),
          },
          { label: 'Amount paid', value: fmtMoney(b.amountPaidMinor, b.currency) },
          { label: 'Created', value: fmtDateTime(b.createdAt) },
        ]}
      />
    </Drawer>
  );
}

export function Bookings(props: { initialStatus?: string }) {
  const [status, setStatus] = useState(props.initialStatus ?? '');
  const [selected, setSelected] = useState<AdminBooking | null>(null);
  const { data, loading, error, reload } = useAsync(() => api.listBookings(status), [status]);
  const bookings = data ?? [];

  const columns: Column<AdminBooking>[] = [
    {
      key: 'booking',
      header: 'Booking',
      render: (b) => (
        <>
          <span className="nb-cell-main">{b.service ? b.service.name : 'N/A'}</span>
          <span className="nb-cell-sub">{fmtDateTime(b.startAt)}</span>
        </>
      ),
    },
    {
      key: 'customer',
      header: 'Customer',
      render: (b) => (
        <>
          <span className="nb-cell-main">{personName(b.customer.firstName, b.customer.lastName, b.customer.email)}</span>
          <span className="nb-cell-sub">{b.customer.email}</span>
        </>
      ),
    },
    { key: 'business', header: 'Business', render: (b) => b.business.name, hideBelow: 'md' },
    {
      key: 'amount',
      header: 'Amount due',
      render: (b) => (b.amountDueMinor == null ? 'N/A' : fmtMoney(b.amountDueMinor, b.currency)),
    },
    { key: 'status', header: 'Status', render: (b) => <Badge value={b.status} /> },
    {
      key: 'actions',
      header: 'Actions',
      render: (b) => (
        <div className="nb-cell-actions">
          <button type="button" className="nb-btn nb-btn-secondary nb-btn-sm" onClick={() => setSelected(b)}>
            View
          </button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Bookings"
        subtitle={loading && bookings.length === 0 ? 'Loading bookings…' : plural(bookings.length, 'booking', 'bookings')}
      />
      <Tabs
        tabs={[{ key: '', label: 'All statuses' }, ...BOOKING_STATUSES.map((s) => ({ key: s, label: statusLabel(s) }))]}
        active={status}
        onChange={setStatus}
      />
      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : loading && bookings.length === 0 ? (
        <LoadingState label="Loading bookings…" />
      ) : (
        <DataTable<AdminBooking>
          columns={columns}
          rows={bookings}
          rowKey={(b) => b.id}
          onRowClick={setSelected}
          empty={<EmptyState title="No bookings match this filter." />}
        />
      )}
      {selected ? <BookingDrawer booking={selected} onClose={() => setSelected(null)} /> : null}
    </>
  );
}

/* --------------------------- Verification ---------------------------- */

function DocumentPreview(props: { label: string; storageKey: string; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    api
      .fetchVerificationDocumentUrl(props.storageKey)
      .then((u) => {
        if (alive) setUrl(u);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : 'Could not load the document.');
      });
    return () => {
      alive = false;
    };
  }, [props.storageKey]);

  React.useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );

  return (
    <Modal title={`Document: ${props.label}`} onClose={props.onClose}>
      {error ? (
        <FormError message={error} />
      ) : url ? (
        <>
          <img className="nb-receipt" src={url} alt={`Verification document: ${props.label}`} />
          <p className="nb-hint">
            <a href={url} download={`verification-document-${props.label.toLowerCase().replace(/\s+/g, '-')}`}>
              Download document
            </a>
          </p>
        </>
      ) : (
        <LoadingState label="Loading document…" />
      )}
    </Modal>
  );
}

function VerificationReviewDrawer(props: {
  app: VerificationApplication;
  onClose: () => void;
  onDecided: () => void;
}) {
  const { app } = props;
  const [reviewerMessage, setReviewerMessage] = useState('');
  const [adminNotes, setAdminNotes] = useState('');
  const [busy, setBusy] = useState<null | 'approve' | 'changes' | 'reject'>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ label: string; storageKey: string } | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  async function decide(kind: 'approve' | 'changes' | 'reject') {
    if (busy) return;
    setFormError(null);
    const message = reviewerMessage.trim();
    const notes = adminNotes.trim();
    if (kind !== 'approve' && message.length < 4) {
      setFormError('A reviewer message is required so the business owner knows what to fix.');
      return;
    }
    setBusy(kind);
    try {
      const withNotes = notes ? { adminNotes: notes } : {};
      if (kind === 'approve') {
        await api.approveVerification(app.id, { ...withNotes, ...(message ? { reviewerMessage: message } : {}) });
      } else if (kind === 'changes') {
        await api.requestVerificationChanges(app.id, { reviewerMessage: message, ...withNotes });
      } else {
        await api.rejectVerification(app.id, { reviewerMessage: message, ...withNotes });
      }
      props.onDecided();
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : 'Could not record the decision. Please try again.');
      setBusy(null);
    }
  }

  async function downloadDocument(doc: VerificationDocument) {
    if (downloadingId) return;
    setDownloadingId(doc.id);
    try {
      const url = await api.fetchVerificationDocumentUrl(doc.storageKey);
      const a = document.createElement('a');
      a.href = url;
      a.download = `verification-document-${doc.docType.toLowerCase().replace(/_/g, '-')}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : 'Could not download the document.');
    } finally {
      setDownloadingId(null);
    }
  }

  const infoItems: { label: string; value: React.ReactNode }[] = [
    { label: 'Business', value: app.publicName ?? app.business.name },
    { label: 'Business slug', value: <span className="nb-mono">{app.business.slug}</span> },
  ];
  if (app.legalName) infoItems.push({ label: 'Legal name', value: app.legalName });
  if (app.publicName) infoItems.push({ label: 'Public name', value: app.publicName });
  if (app.ownerName) infoItems.push({ label: 'Owner name', value: app.ownerName });
  infoItems.push({
    label: 'Owner email',
    value: <span className="nb-mono">{app.business.owner.email}</span>,
  });
  if (app.phone) infoItems.push({ label: 'Phone', value: app.phone });
  if (app.address) infoItems.push({ label: 'Address', value: app.address });
  if (app.city) infoItems.push({ label: 'City', value: app.city });
  if (app.categoryId) infoItems.push({ label: 'Category', value: <span className="nb-mono">{app.categoryId}</span> });
  if (app.description) infoItems.push({ label: 'Description', value: app.description });
  if (app.registrationInfo) infoItems.push({ label: 'Registration info', value: app.registrationInfo });
  if (app.latitude != null) infoItems.push({ label: 'Latitude', value: String(app.latitude) });
  if (app.longitude != null) infoItems.push({ label: 'Longitude', value: String(app.longitude) });
  infoItems.push({
    label: 'Submitted',
    value: app.submittedAt ? fmtDateTime(app.submittedAt) : 'Not submitted yet',
  });
  if (app.reviewerMessage) infoItems.push({ label: 'Last reviewer message', value: app.reviewerMessage });
  if (app.adminNotes) infoItems.push({ label: 'Internal notes', value: app.adminNotes });

  const hasLocation = app.latitude != null || app.longitude != null || app.address != null;

  const docColumns: Column<VerificationDocument>[] = [
    {
      key: 'doc',
      header: 'Document',
      render: (d) => (
        <>
          <span className="nb-cell-main">{statusLabel(d.docType)}</span>
          <span className="nb-cell-sub">{fmtDate(d.uploadedAt)}</span>
        </>
      ),
    },
    { key: 'status', header: 'Status', render: (d) => <Badge value={d.status} /> },
    {
      key: 'actions',
      header: 'Actions',
      render: (d) => (
        <div className="nb-cell-actions">
          <button
            type="button"
            className="nb-btn nb-btn-secondary nb-btn-sm"
            onClick={() => setPreview({ label: statusLabel(d.docType), storageKey: d.storageKey })}
          >
            Preview
          </button>
          <button
            type="button"
            className="nb-btn nb-btn-secondary nb-btn-sm"
            disabled={downloadingId === d.id}
            onClick={() => downloadDocument(d)}
          >
            {downloadingId === d.id ? 'Working…' : 'Download'}
          </button>
        </div>
      ),
    },
  ];

  return (
    <Drawer
      title={app.publicName ?? app.business.name}
      subtitle={`Verification application · ${app.business.owner.email}`}
      onClose={props.onClose}
    >
      <SectionTitle>Submitted information</SectionTitle>
      <DefinitionList items={infoItems} />

      <SectionTitle>Documents ({app.documents.length})</SectionTitle>
      {app.documents.length === 0 ? (
        <p className="nb-hint">No documents were attached to this application.</p>
      ) : (
        <DataTable<VerificationDocument>
          columns={docColumns}
          rows={app.documents}
          rowKey={(d) => d.id}
        />
      )}

      {hasLocation ? (
        <>
          <SectionTitle>Location</SectionTitle>
          <DefinitionList
            items={[
              ...(app.latitude != null ? [{ label: 'Latitude', value: String(app.latitude) }] : []),
              ...(app.longitude != null ? [{ label: 'Longitude', value: String(app.longitude) }] : []),
              ...(app.address ? [{ label: 'Address', value: app.address }] : []),
            ]}
          />
        </>
      ) : null}

      <SectionTitle>Review</SectionTitle>
      <p className="nb-hint">
        Current status: <Badge value={app.status} />
      </p>
      <p className="nb-hint">
        Approving grants the verified badge on this business and makes it eligible for a subscription trial.
        The reviewer message is shown to the business owner; admin notes stay internal.
      </p>
      {formError ? <FormError message={formError} /> : null}
      <Field label="Reviewer message" hint="Shown to the business owner.">
        <textarea
          rows={3}
          value={reviewerMessage}
          onChange={(e) => setReviewerMessage(e.target.value)}
          placeholder="e.g. Your trade license looks good; approved."
          disabled={busy !== null}
        />
      </Field>
      <Field label="Admin notes" hint="Internal only. Never shown to the business owner.">
        <textarea
          rows={2}
          value={adminNotes}
          onChange={(e) => setAdminNotes(e.target.value)}
          placeholder="Optional internal note for the audit trail."
          disabled={busy !== null}
        />
      </Field>
      <FormActions>
        <button type="button" className="nb-btn nb-btn-danger" disabled={busy !== null} onClick={() => decide('reject')}>
          {busy === 'reject' ? 'Working…' : 'Reject verification'}
        </button>
        <button type="button" className="nb-btn nb-btn-secondary" disabled={busy !== null} onClick={() => decide('changes')}>
          {busy === 'changes' ? 'Working…' : 'Request changes'}
        </button>
        <button type="button" className="nb-btn" disabled={busy !== null} onClick={() => decide('approve')}>
          {busy === 'approve' ? 'Working…' : 'Approve'}
        </button>
      </FormActions>

      {preview ? (
        <DocumentPreview label={preview.label} storageKey={preview.storageKey} onClose={() => setPreview(null)} />
      ) : null}
    </Drawer>
  );
}

export function VerificationReview() {
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [appliedQ, setAppliedQ] = useState('');
  const [reviewId, setReviewId] = useState<string | null>(null);

  const { data, loading, error, reload } = useAsync(
    () =>
      api.listVerifications({
        status: status || undefined,
        q: appliedQ || undefined,
      }),
    [status, appliedQ],
  );
  const apps = data ?? [];
  const selected = reviewId ? apps.find((a) => a.id === reviewId) ?? null : null;

  const columns: Column<VerificationApplication>[] = [
    {
      key: 'business',
      header: 'Business',
      render: (a) => (
        <>
          <span className="nb-cell-main">{a.publicName ?? a.business.name}</span>
          <span className="nb-cell-sub">{[a.legalName, a.city].filter(Boolean).join(' · ') || a.business.slug}</span>
        </>
      ),
    },
    {
      key: 'owner',
      header: 'Owner',
      render: (a) => (
        <>
          <span className="nb-cell-main">{a.ownerName ?? a.business.owner.email}</span>
          <span className="nb-cell-sub">
            {[a.business.owner.email, a.phone].filter(Boolean).join(' · ')}
          </span>
        </>
      ),
    },
    {
      key: 'submitted',
      header: 'Submitted',
      render: (a) => (a.submittedAt ? fmtDate(a.submittedAt) : 'Not submitted'),
      hideBelow: 'md',
    },
    { key: 'status', header: 'Status', render: (a) => <Badge value={a.status} /> },
    {
      key: 'actions',
      header: 'Actions',
      render: (a) => (
        <div className="nb-cell-actions">
          <button type="button" className="nb-btn nb-btn-secondary nb-btn-sm" onClick={() => setReviewId(a.id)}>
            Review
          </button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Verification"
        subtitle="Review business verification applications. Showing the first page of the queue."
      />
      <Toolbar>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setAppliedQ(q.trim());
          }}
          style={{ display: 'flex', gap: '8px', alignItems: 'center', flex: 1, flexWrap: 'wrap' }}
        >
          <SearchInput
            value={q}
            onChange={setQ}
            placeholder="Search business or owner email"
            label="Search verification applications"
          />
          <button type="submit" className="nb-btn nb-btn-secondary">
            Search
          </button>
        </form>
        <FilterSelect
          label="Filter by status"
          value={status}
          onChange={setStatus}
          options={[
            { value: '', label: 'All statuses' },
            ...VERIFICATION_STATUSES.map((s) => ({ value: s, label: statusLabel(s) })),
          ]}
        />
      </Toolbar>
      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : loading && apps.length === 0 ? (
        <LoadingState label="Loading verification applications…" />
      ) : (
        <DataTable<VerificationApplication>
          columns={columns}
          rows={apps}
          rowKey={(a) => a.id}
          onRowClick={(a) => setReviewId(a.id)}
          empty={<EmptyState title="No applications match these filters." />}
        />
      )}
      {selected ? (
        <VerificationReviewDrawer
          key={selected.id}
          app={selected}
          onClose={() => setReviewId(null)}
          onDecided={() => {
            setReviewId(null);
            reload();
          }}
        />
      ) : null}
    </>
  );
}
