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
  Card,
  Consequence,
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
  Skeleton,
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

const ORDER_STATUSES = ['PENDING', 'ACCEPTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED', 'COMPLETED', 'REJECTED', 'CANCELLED'];
const BOOKING_STATUSES = ['PENDING', 'CONFIRMED', 'COMPLETED', 'REJECTED', 'CANCELLED'];
const VERIFICATION_STATUSES = ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED'];

/** Human-readable fulfillment type. No em dashes. */
function fulfillmentLabel(value: string | null | undefined): string {
  if (!value) return 'N/A';
  return value
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Service display names: multi-service items first, legacy `service` fallback. */
function bookingServiceNames(b: AdminBooking): string {
  const items = b.serviceItems ?? [];
  if (items.length > 0) return items.map((i) => i.name).join(', ');
  return b.service ? b.service.name : 'N/A';
}

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
      subtitle={o.business.name}
      meta={`Order · ${o.id}`}
      status={<Badge value={o.status} />}
      onClose={props.onClose}
    >
      <DefinitionList
        items={[
          { label: 'Order ID', value: <span className="nb-mono">{o.id}</span> },
          { label: 'Status', value: <Badge value={o.status} /> },
          { label: 'Fulfillment', value: fulfillmentLabel(o.fulfillmentType) },
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
          // Rider name only. Phone is intentionally excluded from admin
          // responses and is never shown here.
          { label: 'Rider', value: o.assignedRider ? o.assignedRider.name : 'Not assigned' },
          ...(o.deliveryAddressText
            ? [{ label: 'Delivery address', value: o.deliveryAddressText }]
            : []),
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
          <span className="nb-cell-sub">
            {fmtDate(o.createdAt)}
            {o.assignedRider ? ` · Rider: ${o.assignedRider.name}` : ''}
          </span>
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
      key: 'fulfillment',
      header: 'Fulfillment',
      render: (o) => (
        <span className="nb-badge nb-badge-neutral">{fulfillmentLabel(o.fulfillmentType)}</span>
      ),
      hideBelow: 'md',
    },
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
        kicker="Operations"
        title="Orders"
        subtitle={loading && orders.length === 0 ? 'Loading orders…' : `${plural(orders.length, 'order', 'orders')} in this view`}
      />
      <Toolbar>
        <Tabs
          tabs={[{ key: '', label: 'All statuses' }, ...ORDER_STATUSES.map((s) => ({ key: s, label: statusLabel(s) }))]}
          active={status}
          onChange={setStatus}
        />
      </Toolbar>
      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : loading && orders.length === 0 ? (
        <Skeleton rows={6} />
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
  const serviceItems = b.serviceItems ?? [];
  const servicesValue =
    serviceItems.length > 0 ? (
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {serviceItems.map((it) => (
          <li key={it.id} style={{ overflowWrap: 'anywhere' }}>
            {it.name}{' '}
            <span className="nb-muted">
              ({fmtMoney(it.priceMinor, b.currency)} · {it.durationMinutes} min)
            </span>
          </li>
        ))}
      </ul>
    ) : (
      <span>{b.service ? b.service.name : 'N/A'}</span>
    );
  const subtitle =
    serviceItems.length > 1
      ? `${serviceItems.length} services`
      : serviceItems.length === 1
        ? serviceItems[0].name
        : b.service
          ? b.service.name
          : b.business.name;
  return (
    <Drawer
      title={`Booking #${shortId(b.id)}`}
      subtitle={subtitle}
      meta={`Booking · ${b.id}`}
      status={<Badge value={b.status} />}
      onClose={props.onClose}
    >
      <DefinitionList
        items={[
          { label: 'Booking ID', value: <span className="nb-mono">{b.id}</span> },
          { label: 'Status', value: <Badge value={b.status} /> },
          { label: 'Services', value: servicesValue },
          {
            label: 'Combined duration',
            value: b.totalDurationMinutes != null ? `${b.totalDurationMinutes} min` : 'N/A',
          },
          {
            label: 'Combined price',
            value: fmtMoney(b.servicePriceMinor ?? 0, b.currency),
          },
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
          <span className="nb-cell-main" style={{ overflowWrap: 'anywhere' }}>
            {bookingServiceNames(b)}
          </span>
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
        kicker="Operations"
        title="Bookings"
        subtitle={loading && bookings.length === 0 ? 'Loading bookings…' : `${plural(bookings.length, 'booking', 'bookings')} in this view`}
      />
      <Toolbar>
        <Tabs
          tabs={[{ key: '', label: 'All statuses' }, ...BOOKING_STATUSES.map((s) => ({ key: s, label: statusLabel(s) }))]}
          active={status}
          onChange={setStatus}
        />
      </Toolbar>
      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : loading && bookings.length === 0 ? (
        <Skeleton rows={6} />
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

/* ------------------------------------------------------------------
   Verification review: a right-side drawer for simple applications,
   and a dedicated full-page workspace when the review is complex
   (multiple documents). Both share the same decision logic.
------------------------------------------------------------------- */

type DecisionKind = 'approve' | 'changes' | 'reject';

function useVerificationDecision(app: VerificationApplication, onDecided: () => void) {
  const [reviewerMessage, setReviewerMessage] = useState('');
  const [adminNotes, setAdminNotes] = useState('');
  const [busy, setBusy] = useState<null | DecisionKind>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ label: string; storageKey: string } | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  async function decide(kind: DecisionKind) {
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
      onDecided();
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

  return {
    reviewerMessage,
    setReviewerMessage,
    adminNotes,
    setAdminNotes,
    busy,
    formError,
    decide,
    preview,
    setPreview,
    downloadingId,
    downloadDocument,
  };
}

function VerificationDocuments(props: {
  app: VerificationApplication;
  downloadingId: string | null;
  onPreview: (doc: VerificationDocument) => void;
  onDownload: (doc: VerificationDocument) => void;
}) {
  const { app } = props;
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
            onClick={() => props.onPreview(d)}
          >
            Preview
          </button>
          <button
            type="button"
            className="nb-btn nb-btn-secondary nb-btn-sm"
            disabled={props.downloadingId === d.id}
            onClick={() => props.onDownload(d)}
          >
            {props.downloadingId === d.id ? 'Working…' : 'Download'}
          </button>
        </div>
      ),
    },
  ];

  if (app.documents.length === 0) {
    return (
      <EmptyState
        title="No documents attached"
        body="No documents were attached to this application."
      />
    );
  }
  return <DataTable<VerificationDocument> columns={docColumns} rows={app.documents} rowKey={(d) => d.id} />;
}

function VerificationInfoItems(app: VerificationApplication): { label: string; value: React.ReactNode }[] {
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
  if (app.categoryId)
    infoItems.push({ label: 'Category', value: <span className="nb-mono">{app.categoryId}</span> });
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
  return infoItems;
}

/** The decision form shared by the drawer and the workspace. */
function VerificationDecisionForm(props: { decision: ReturnType<typeof useVerificationDecision> }) {
  const d = props.decision;
  return (
    <>
      <Consequence>
        <strong>Approving</strong> grants the verified badge on this business and
        makes it eligible for a subscription trial. The reviewer message is
        shown to the business owner; admin notes stay internal.
      </Consequence>
      {d.formError ? <FormError message={d.formError} /> : null}
      <Field
        label="Reviewer message"
        hint="Shown to the business owner. Required when requesting changes or rejecting."
      >
        <textarea
          rows={3}
          value={d.reviewerMessage}
          onChange={(e) => d.setReviewerMessage(e.target.value)}
          placeholder="e.g. Your trade license looks good; approved."
          disabled={d.busy !== null}
        />
      </Field>
      <Field label="Admin notes" hint="Internal only. Never shown to the business owner.">
        <textarea
          rows={2}
          value={d.adminNotes}
          onChange={(e) => d.setAdminNotes(e.target.value)}
          placeholder="Optional internal note for the audit trail."
          disabled={d.busy !== null}
        />
      </Field>
    </>
  );
}

function DecisionButtons(props: { busy: null | DecisionKind; onDecide: (kind: DecisionKind) => void }) {
  const { busy, onDecide } = props;
  return (
    <>
      <button
        type="button"
        className="nb-btn nb-btn-danger"
        disabled={busy !== null}
        onClick={() => onDecide('reject')}
      >
        {busy === 'reject' ? 'Working…' : 'Reject verification'}
      </button>
      <button
        type="button"
        className="nb-btn nb-btn-secondary"
        disabled={busy !== null}
        onClick={() => onDecide('changes')}
      >
        {busy === 'changes' ? 'Working…' : 'Request changes'}
      </button>
      <button type="button" className="nb-btn" disabled={busy !== null} onClick={() => onDecide('approve')}>
        {busy === 'approve' ? 'Working…' : 'Approve verification'}
      </button>
    </>
  );
}

/** Simple applications: review without leaving the queue context. */
function VerificationReviewDrawer(props: {
  app: VerificationApplication;
  onClose: () => void;
  onDecided: () => void;
}) {
  const { app } = props;
  const decision = useVerificationDecision(app, props.onDecided);

  return (
    <Drawer
      title={app.publicName ?? app.business.name}
      subtitle={app.business.owner.email}
      meta={`Application · ${app.id.slice(0, 8)}`}
      status={<Badge value={app.status} />}
      onClose={props.onClose}
      actions={<DecisionButtons busy={decision.busy} onDecide={decision.decide} />}
    >
      <SectionTitle>Submitted information</SectionTitle>
      <DefinitionList items={VerificationInfoItems(app)} />

      <SectionTitle>Documents ({app.documents.length})</SectionTitle>
      <VerificationDocuments
        app={app}
        downloadingId={decision.downloadingId}
        onPreview={(d) => decision.setPreview({ label: statusLabel(d.docType), storageKey: d.storageKey })}
        onDownload={decision.downloadDocument}
      />

      <SectionTitle>Review</SectionTitle>
      <VerificationDecisionForm decision={decision} />

      {decision.preview ? (
        <DocumentPreview
          label={decision.preview.label}
          storageKey={decision.preview.storageKey}
          onClose={() => decision.setPreview(null)}
        />
      ) : null}
    </Drawer>
  );
}

/** Complex applications (multiple documents): a dedicated review workspace
    with a sticky decision rail, borrowed from The Ledger concept. */
function VerificationWorkspace(props: {
  app: VerificationApplication;
  onBack: () => void;
  onDecided: () => void;
}) {
  const { app } = props;
  const decision = useVerificationDecision(app, props.onDecided);
  const hasLocation = app.latitude != null || app.longitude != null || app.address != null;

  return (
    <div className="nb-workspace">
      <div className="nb-workspace-head">
        <button type="button" className="nb-linkbtn" onClick={props.onBack}>
          ← Back to verification queue
        </button>
        <PageHeader
          kicker="Verification workspace"
          title={app.publicName ?? app.business.name}
          subtitle={`${app.business.owner.email} · submitted ${
            app.submittedAt ? fmtDate(app.submittedAt) : 'not yet'
          }`}
        />
      </div>
      <div className="nb-workspace-grid">
        <div>
          <Card title="Submitted information">
            <DefinitionList items={VerificationInfoItems(app)} />
          </Card>
          <Card title={`Documents (${app.documents.length})`} subtitle="Preview each document before deciding.">
            <VerificationDocuments
              app={app}
              downloadingId={decision.downloadingId}
              onPreview={(d) =>
                decision.setPreview({ label: statusLabel(d.docType), storageKey: d.storageKey })
              }
              onDownload={decision.downloadDocument}
            />
          </Card>
          {hasLocation ? (
            <Card title="Location">
              <DefinitionList
                items={[
                  ...(app.latitude != null ? [{ label: 'Latitude', value: String(app.latitude) }] : []),
                  ...(app.longitude != null ? [{ label: 'Longitude', value: String(app.longitude) }] : []),
                  ...(app.address ? [{ label: 'Address', value: app.address }] : []),
                ]}
              />
            </Card>
          ) : null}
        </div>
        <aside className="nb-workspace-side" aria-label="Decision panel">
          <div className="nb-decision-card">
            <div className="nb-decision-card-head">
              <h3>Decision</h3>
              <p>
                Current status: <Badge value={app.status} />
              </p>
            </div>
            <div className="nb-decision-card-body">
              <VerificationDecisionForm decision={decision} />
            </div>
            <div className="nb-decision-card-foot">
              <DecisionButtons busy={decision.busy} onDecide={decision.decide} />
            </div>
          </div>
        </aside>
      </div>
      {decision.preview ? (
        <DocumentPreview
          label={decision.preview.label}
          storageKey={decision.preview.storageKey}
          onClose={() => decision.setPreview(null)}
        />
      ) : null}
    </div>
  );
}

/** Route simple reviews to the drawer, complex ones to the workspace. */
function isComplexReview(app: VerificationApplication): boolean {
  return app.documents.length >= 2;
}
export function VerificationReview(props: { initialStatus?: string }) {
  const [status, setStatus] = useState(props.initialStatus ?? '');
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
        kicker="Marketplace"
        title="Verifications"
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
        <span className="nb-toolbar-end">
          <span className="nb-result-count" aria-live="polite">
            {loading && apps.length === 0 ? 'Loading…' : `${apps.length} in queue`}
          </span>
        </span>
      </Toolbar>
      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : loading && apps.length === 0 ? (
        <Skeleton rows={6} />
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
        isComplexReview(selected) ? (
          <VerificationWorkspace
            key={selected.id}
            app={selected}
            onBack={() => setReviewId(null)}
            onDecided={() => {
              setReviewId(null);
              reload();
            }}
          />
        ) : (
          <VerificationReviewDrawer
            key={selected.id}
            app={selected}
            onClose={() => setReviewId(null)}
            onDecided={() => {
              setReviewId(null);
              reload();
            }}
          />
        )
      ) : null}
    </>
  );
}
