import React, { useEffect, useRef, useState } from 'react';
import * as api from './api.js';
import type {
  AdminPromotion,
  AdminPromotionPayment,
  AdminPromotionRequest,
  EditorialFeature,
  FeaturedItem,
  FeaturedListState,
  PromotionInput,
} from './api.js';
import {
  Badge,
  Card,
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
  fmtDate,
  fmtDateTime,
  fmtMoney,
  statusLabel,
  useAsync,
} from './ds.js';
import type { Column } from './ds.js';

/* Rebuilt promotions center on the shared ds primitives:
   Catalog | Requests | Payments | Active | Featured.

   Paid promotions can only go live through payment approval in the
   Payments tab; the UI repeats that rule wherever activation could be
   misunderstood. Editorial features are free admin curation and never
   touch promotions or payments. */

/* ------------------------------ drawer -------------------------------- */
/* The legacy `.drawer` class is kept alongside `nb-drawer` so existing
   selectors and tests keep matching. */

function GrowthDrawer(props: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="nb-drawer drawer">
      <Drawer title={props.title} subtitle={props.subtitle} onClose={props.onClose} actions={props.actions}>
        {props.children}
      </Drawer>
    </div>
  );
}

/* --------------------------- receipt viewer ---------------------------- */

function ReceiptViewer(props: { storageKey: string; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.fetchReceiptObjectUrl(props.storageKey).then(
      (u) => {
        if (alive) setUrl(u);
      },
      (e) => {
        if (alive) setError(e instanceof Error ? e.message : 'Could not load the receipt.');
      },
    );
    return () => {
      alive = false;
    };
  }, [props.storageKey]);

  return (
    <Modal title="Payment receipt" onClose={props.onClose}>
      {error ? (
        <FormError message={error} />
      ) : url ? (
        <img className="nb-receipt receipt-img" src={url} alt="Payment receipt" />
      ) : (
        <LoadingState label="Loading receipt…" />
      )}
    </Modal>
  );
}

/* ------------------------- payment review panel ------------------------ */
/* Shared by the Payments tab drawer and the Requests queue drawer. */

function PaymentReviewPanel(props: { paymentId: string; onDecided: () => void }) {
  const [payment, setPayment] = useState<AdminPromotionPayment | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [receiptOpen, setReceiptOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    api
      .getPromotionPaymentRequest(props.paymentId)
      .then((p) => {
        if (alive) setPayment(p);
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : 'Could not load the payment.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [props.paymentId]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      props.onDecided();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Action failed.');
    } finally {
      setBusy(false);
    }
  };

  const approve = (p: AdminPromotionPayment) => {
    if (
      !window.confirm(
        `Approve this payment of ${fmtMoney(p.amountMinor, p.currency)} from ${p.business.name}? The promotion activates immediately with server-set start and end dates.`,
      )
    )
      return;
    void run(() => api.approvePromotionPayment(p.id));
  };

  if (loading) return <LoadingState label="Loading payment…" />;
  if (error || !payment) return <ErrorState message={error ?? 'Payment not found.'} />;
  const p = payment;

  const catalogPrice =
    p.promotion.priceMinor == null ? (
      <span className="nb-muted">Not available</span>
    ) : (
      <>
        {fmtMoney(p.promotion.priceMinor, p.currency)}
        {p.promotion.priceMinor === p.amountMinor ? (
          <div className="nb-hint">Matches the catalog price.</div>
        ) : (
          <FormError message="Does not match the catalog price. Verify with the business before approving." />
        )}
      </>
    );

  return (
    <>
      {actionError ? <FormError message={actionError} /> : null}
      <DefinitionList
        items={[
          { label: 'Business', value: <strong>{p.business.name}</strong> },
          {
            label: 'Promotion',
            value: (
              <>
                <strong>{p.promotion.name}</strong>
                <div className="nb-muted nb-mono">
                  {p.promotion.slug}
                  {p.promotion.durationDays ? ` · ${p.promotion.durationDays} days` : ''}
                </div>
              </>
            ),
          },
          { label: 'Amount paid', value: fmtMoney(p.amountMinor, p.currency) },
          { label: 'Catalog price', value: catalogPrice },
          {
            label: 'Payment method',
            value: (
              <>
                {p.paymentMethod.name} <span className="nb-muted">({statusLabel(p.paymentMethod.type)})</span>
              </>
            ),
          },
          { label: 'Transaction reference', value: <span className="nb-mono">{p.transactionReference || 'N/A'}</span> },
          { label: 'Paid date', value: p.paidAt ? fmtDate(p.paidAt) : <span className="nb-muted">Not provided</span> },
          { label: 'Submitted', value: fmtDateTime(p.submittedAt) },
          ...(p.note ? [{ label: 'Business note', value: p.note }] : []),
          {
            label: 'Receipt / proof',
            value: p.receiptStorageKey ? (
              <button type="button" className="nb-btn nb-btn-sm nb-btn-secondary" onClick={() => setReceiptOpen(true)}>
                View receipt
              </button>
            ) : (
              <span className="nb-muted">No receipt uploaded</span>
            ),
          },
          { label: 'Status', value: <Badge value={p.status} /> },
          ...(p.reviewedAt
            ? [
                {
                  label: 'Decision',
                  value: (
                    <>
                      <div>Decided {fmtDate(p.reviewedAt)}</div>
                      {p.rejectionReason ? <div className="nb-hint">{p.rejectionReason}</div> : null}
                    </>
                  ),
                },
              ]
            : []),
        ]}
      />
      <p className="nb-hint">
        Approving a payment is the only action that puts a paid promotion live. The promotion activates with server-set start and end
        dates. Rejecting keeps the application approved so the business can resubmit.
      </p>
      {p.status === 'PENDING' ? (
        rejecting ? (
          <>
            <Field label="Rejection reason">
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Rejection reason (required)"
                aria-label="Payment rejection reason"
              />
            </Field>
            <FormActions>
              <button
                type="button"
                className="nb-btn nb-btn-danger"
                disabled={busy || reason.trim().length < 4}
                onClick={() => void run(() => api.rejectPromotionPayment(p.id, reason.trim()))}
              >
                {busy ? 'Working…' : 'Confirm rejection'}
              </button>
              <button
                type="button"
                className="nb-btn nb-btn-secondary"
                onClick={() => {
                  setRejecting(false);
                  setReason('');
                }}
              >
                Cancel
              </button>
            </FormActions>
          </>
        ) : (
          <FormActions>
            <button type="button" className="nb-btn" disabled={busy} onClick={() => approve(p)}>
              {busy ? 'Working…' : 'Approve payment'}
            </button>
            <button type="button" className="nb-btn nb-btn-secondary" onClick={() => setRejecting(true)}>
              Reject payment
            </button>
          </FormActions>
        )
      ) : null}
      {receiptOpen && p.receiptStorageKey ? <ReceiptViewer storageKey={p.receiptStorageKey} onClose={() => setReceiptOpen(false)} /> : null}
    </>
  );
}

/* ------------------------------ catalog tab ---------------------------- */

function PromotionDialog(props: { promotion: AdminPromotion | null; onClose: () => void; onSaved: () => void }) {
  const editing = props.promotion;
  const [name, setName] = useState(editing?.name ?? '');
  const [slug, setSlug] = useState(editing?.slug ?? '');
  const [description, setDescription] = useState(editing?.description ?? '');
  const [price, setPrice] = useState(editing ? String(editing.priceMinor / 100) : '');
  const [durationDays, setDurationDays] = useState(editing ? String(editing.durationDays) : '30');
  const [displayOrder, setDisplayOrder] = useState(editing ? String(editing.displayOrder) : '0');
  const [benefits, setBenefits] = useState(editing ? editing.benefits.join('\n') : '');
  const [requirements, setRequirements] = useState(editing?.requirements ?? '');
  const [isActive, setIsActive] = useState(editing?.isActive ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    const rupees = parseFloat(price);
    if (!trimmedName || !Number.isFinite(rupees) || rupees < 0) {
      setError('Enter a promotion name and a valid price in rupees.');
      return;
    }
    const input: PromotionInput = {
      name: trimmedName,
      description: description.trim() || null,
      benefits: benefits
        .split('\n')
        .map((b) => b.trim())
        .filter(Boolean),
      priceMinor: Math.round(rupees * 100),
      durationDays: Math.max(1, parseInt(durationDays, 10) || 30),
      requirements: requirements.trim() || null,
      isActive,
      displayOrder: parseInt(displayOrder, 10) || 0,
    };
    const slugTrimmed = slug.trim();
    if (!editing && slugTrimmed) input.slug = slugTrimmed;
    setBusy(true);
    setError(null);
    try {
      if (editing) await api.updatePromotion(editing.id, input);
      else await api.createPromotion(input);
      props.onSaved();
      props.onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the promotion.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={editing ? `Edit promotion: ${editing.name}` : 'New promotion'} onClose={props.onClose} wide>
      {error ? <FormError message={error} /> : null}
      <form onSubmit={(e) => void save(e)}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Name">
            <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} placeholder="Ramadan Spotlight" />
          </Field>
          <Field label={editing ? 'Slug (locked)' : 'Slug (optional, auto-generated)'}>
            <input value={slug} onChange={(e) => setSlug(e.target.value)} maxLength={80} placeholder="ramadan-spotlight" disabled={!!editing} />
          </Field>
        </div>
        <Field label="Description">
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Short pitch shown to business owners." />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <Field label="Price (PKR)">
            <input value={price} onChange={(e) => setPrice(e.target.value)} required placeholder="4999" inputMode="decimal" />
          </Field>
          <Field label="Duration (days)">
            <input value={durationDays} onChange={(e) => setDurationDays(e.target.value)} inputMode="numeric" />
          </Field>
          <Field label="Display order">
            <input value={displayOrder} onChange={(e) => setDisplayOrder(e.target.value)} inputMode="numeric" />
          </Field>
        </div>
        <Field label="Benefits (one per line)">
          <textarea value={benefits} onChange={(e) => setBenefits(e.target.value)} placeholder={'Homepage banner\nSocial mention'} />
        </Field>
        <Field label="Requirements">
          <textarea value={requirements} onChange={(e) => setRequirements(e.target.value)} placeholder="e.g. Active subscription required." />
        </Field>
        <Field label="Visible to businesses">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} aria-label="Active" />
        </Field>
        <FormActions>
          <button type="submit" className="nb-btn" disabled={busy}>
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Create promotion'}
          </button>
          <button type="button" className="nb-btn nb-btn-secondary" onClick={props.onClose}>
            Cancel
          </button>
        </FormActions>
      </form>
    </Modal>
  );
}

function PromotionCatalogTab() {
  const catalog = useAsync(() => api.listPromotions(), []);
  const [dialog, setDialog] = useState<AdminPromotion | null | 'new'>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const toggleActive = async (p: AdminPromotion) => {
    setBusyId(p.id);
    setActionError(null);
    try {
      await api.updatePromotion(p.id, { isActive: !p.isActive });
      catalog.reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Action failed.');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (p: AdminPromotion) => {
    if (!window.confirm(`Delete the promotion "${p.name}"? This cannot be undone.`)) return;
    setBusyId(p.id);
    setActionError(null);
    try {
      await api.deletePromotion(p.id);
      catalog.reload();
    } catch (e) {
      if (e instanceof api.ApiError && e.status === 409) {
        setActionError(`Cannot delete "${p.name}": promotion requests reference it. Deactivate it instead.`);
      } else {
        setActionError(e instanceof Error ? e.message : 'Could not delete the promotion.');
      }
    } finally {
      setBusyId(null);
    }
  };

  const columns: Column<AdminPromotion>[] = [
    {
      key: 'promotion',
      header: 'Promotion',
      render: (p) => (
        <>
          <strong>{p.name}</strong>
          <div className="nb-muted nb-mono">{p.slug}</div>
        </>
      ),
    },
    { key: 'price', header: 'Price', render: (p) => fmtMoney(p.priceMinor, p.currency) },
    { key: 'duration', header: 'Duration', render: (p) => `${p.durationDays} days` },
    { key: 'requests', header: 'Requests', render: (p) => (p.requestCount == null ? <span className="nb-muted">N/A</span> : String(p.requestCount)) },
    { key: 'status', header: 'Status', render: (p) => <Badge value={p.isActive ? 'ACTIVE' : 'INACTIVE'} /> },
    {
      key: 'actions',
      header: 'Actions',
      render: (p) => (
        <>
          <button type="button" className="nb-btn nb-btn-sm nb-btn-secondary" disabled={busyId === p.id} onClick={() => setDialog(p)}>
            Edit
          </button>{' '}
          <button
            type="button"
            className="nb-btn nb-btn-sm nb-btn-secondary"
            disabled={busyId === p.id}
            onClick={() => void toggleActive(p)}
          >
            {p.isActive ? 'Deactivate' : 'Activate'}
          </button>{' '}
          <button type="button" className="nb-btn nb-btn-sm nb-btn-secondary" disabled={busyId === p.id} onClick={() => void remove(p)}>
            Delete
          </button>
        </>
      ),
    },
  ];

  return (
    <>
      <p className="nb-hint" style={{ marginTop: 0 }}>
        The paid visibility products businesses can apply for. Prices here are what payment reviewers compare against.
      </p>
      <Toolbar>
        <button type="button" className="nb-btn" onClick={() => setDialog('new')}>
          New promotion
        </button>
      </Toolbar>
      {actionError ? <FormError message={actionError} /> : null}
      {catalog.loading ? (
        <LoadingState label="Loading promotions…" />
      ) : catalog.error ? (
        <ErrorState message={catalog.error} onRetry={catalog.reload} />
      ) : (
        <Card title={`Promotion catalog (${catalog.data!.length})`}>
          <DataTable<AdminPromotion>
            columns={columns}
            rows={catalog.data!}
            rowKey={(p) => p.id}
            empty={<EmptyState title="No promotions yet." body="Create one to offer paid visibility boosts to businesses." />}
          />
        </Card>
      )}
      {dialog ? (
        <PromotionDialog promotion={dialog === 'new' ? null : dialog} onClose={() => setDialog(null)} onSaved={catalog.reload} />
      ) : null}
    </>
  );
}

/* ------------------------------ requests tab --------------------------- */

const REQUEST_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'ACTIVE', 'EXPIRED', 'CANCELLED'] as const;

function RequestDrawer(props: { request: AdminPromotionRequest; onClose: () => void; onChanged: () => void }) {
  const r = props.request;
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const priceMinor = r.promotion?.priceMinor ?? null;
  const isPaid = (priceMinor ?? 0) > 0;

  const decide = async (approve: boolean) => {
    const verb = approve ? 'Approve' : 'Reject';
    const extra = approve
      ? isPaid
        ? ' The owner must pay before the promotion goes live.'
        : ' This free promotion activates immediately.'
      : '';
    if (!window.confirm(`${verb} the promotion application from ${r.business.name}${r.promotion ? ` for "${r.promotion.name}"` : ''}?${extra}`))
      return;
    setBusy(true);
    setError(null);
    try {
      const msg = message.trim() || undefined;
      if (approve) await api.approvePromotionRequest(r.id, msg);
      else await api.rejectPromotionRequest(r.id, msg);
      props.onChanged();
      props.onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Decision failed.');
    } finally {
      setBusy(false);
    }
  };

  const owner = r.business.owner;
  const ownerName = [owner.firstName, owner.lastName].filter(Boolean).join(' ');

  return (
    <GrowthDrawer title="Promotion request" subtitle={r.business.name} onClose={props.onClose}>
      {error ? <FormError message={error} /> : null}
      <SectionTitle>Application</SectionTitle>
      <DefinitionList
        items={[
          {
            label: 'Business',
            value: (
              <>
                <strong>{r.business.name}</strong>
                <div className="nb-muted nb-mono">{r.business.slug}</div>
                <div className="nb-muted">
                  {owner.email}
                  {ownerName ? ` · ${ownerName}` : ''}
                </div>
              </>
            ),
          },
          {
            label: 'Promotion',
            value: r.promotion ? (
              <>
                <strong>{r.promotion.name}</strong>
                <div className="nb-muted nb-mono">
                  {r.promotion.slug} · {r.promotion.durationDays} days
                </div>
                <div className="nb-muted">{r.promotion.priceMinor === 0 ? 'Free' : fmtMoney(r.promotion.priceMinor, r.promotion.currency)}</div>
              </>
            ) : (
              <span className="nb-muted">No promotion attached</span>
            ),
          },
          ...(r.note ? [{ label: 'Application note', value: r.note }] : []),
          ...(r.reviewerMessage ? [{ label: 'Reviewer message', value: r.reviewerMessage }] : []),
          { label: 'Requested', value: fmtDateTime(r.createdAt) },
          { label: 'Decided', value: r.reviewedAt ? fmtDateTime(r.reviewedAt) : <span className="nb-muted">Not decided yet</span> },
          { label: 'Activated', value: r.activatedAt ? fmtDateTime(r.activatedAt) : <span className="nb-muted">Not active</span> },
          { label: 'Expires', value: r.expiresAt ? fmtDateTime(r.expiresAt) : <span className="nb-muted">N/A</span> },
          { label: 'Application status', value: <Badge value={r.status} /> },
          { label: 'Payment status', value: r.paymentStatus ? <Badge value={r.paymentStatus} /> : <span className="nb-muted">None</span> },
        ]}
      />
      {r.status === 'PENDING' ? (
        <>
          <SectionTitle>Decision</SectionTitle>
          <p className="nb-hint">
            {isPaid
              ? 'Approval moves this to the payment step: the owner must pay before the promotion goes live.'
              : 'Approving activates this free promotion immediately. No payment is needed.'}
          </p>
          <Field label="Reviewer message (optional)">
            <input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Shown to the business owner." />
          </Field>
          <FormActions>
            <button type="button" className="nb-btn" disabled={busy} onClick={() => void decide(true)}>
              {busy ? 'Working…' : 'Approve application'}
            </button>
            <button type="button" className="nb-btn nb-btn-danger" disabled={busy} onClick={() => void decide(false)}>
              {busy ? 'Working…' : 'Reject application'}
            </button>
          </FormActions>
        </>
      ) : null}
      {r.status === 'APPROVED' && isPaid ? (
        <>
          <SectionTitle>Latest payment</SectionTitle>
          {r.payments.length === 0 ? (
            <p className="nb-hint">No payment submitted yet. The business owner can submit one from their app.</p>
          ) : (
            <PaymentReviewPanel
              paymentId={r.payments[0].id}
              onDecided={() => {
                props.onChanged();
                props.onClose();
              }}
            />
          )}
        </>
      ) : null}
    </GrowthDrawer>
  );
}

function PromotionRequestsTab() {
  const [status, setStatus] = useState<string>('PENDING');
  const queue = useAsync(() => api.listPromotionRequests(status || undefined), [status]);
  const [selected, setSelected] = useState<AdminPromotionRequest | null>(null);

  const columns: Column<AdminPromotionRequest>[] = [
    { key: 'requested', header: 'Requested', render: (r) => fmtDate(r.createdAt) },
    {
      key: 'business',
      header: 'Business',
      render: (r) => (
        <>
          <strong>{r.business.name}</strong>
          <div className="nb-muted">{r.business.owner.email}</div>
        </>
      ),
    },
    {
      key: 'promotion',
      header: 'Promotion',
      render: (r) =>
        r.promotion ? (
          <>
            <strong>{r.promotion.name}</strong>
            <div className="nb-muted">{r.promotion.durationDays} days</div>
          </>
        ) : (
          <span className="nb-muted">N/A</span>
        ),
    },
    {
      key: 'price',
      header: 'Price',
      render: (r) =>
        r.promotion ? (
          r.promotion.priceMinor === 0 ? (
            'Free'
          ) : (
            fmtMoney(r.promotion.priceMinor, r.promotion.currency)
          )
        ) : (
          <span className="nb-muted">N/A</span>
        ),
    },
    {
      key: 'applied',
      header: 'Applied',
      render: (r) => (r.activatedAt ? fmtDate(r.activatedAt) : <span className="nb-muted">Not active</span>),
    },
    { key: 'app-status', header: 'Application status', render: (r) => <Badge value={r.status} /> },
    {
      key: 'pay-status',
      header: 'Payment status',
      render: (r) => (r.paymentStatus ? <Badge value={r.paymentStatus} /> : <span className="nb-muted">None</span>),
    },
    {
      key: 'promo-status',
      header: 'Promotion status',
      render: (r) => {
        if (r.status === 'ACTIVE')
          return (
            <>
              <Badge value="ACTIVE" />
              {r.expiresAt ? <div className="nb-muted">until {fmtDate(r.expiresAt)}</div> : null}
            </>
          );
        if (r.status === 'EXPIRED') return <Badge value="EXPIRED" />;
        return <span className="nb-muted">N/A</span>;
      },
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (r) => (
        <button type="button" className="nb-btn nb-btn-sm nb-btn-secondary" onClick={() => setSelected(r)}>
          Review
        </button>
      ),
    },
  ];

  return (
    <>
      <p className="nb-hint" style={{ marginTop: 0 }}>
        How a promotion goes live: Available → Applied → Pending review → Approved → Payment required → Payment submitted → Payment
        approved → Active → Expires. Free promotions skip the payment steps and activate on approval.
      </p>
      <p className="nb-hint">Free promotions activate immediately on approval. Paid promotions wait for the owner's payment before going live.</p>
      <Toolbar>
        <FilterSelect
          label="Filter promotion requests by status"
          value={status}
          onChange={setStatus}
          options={[
            { value: '', label: 'All statuses' },
            ...REQUEST_STATUSES.map((s) => ({ value: s, label: statusLabel(s) })),
          ]}
        />
      </Toolbar>
      {queue.loading ? (
        <LoadingState label="Loading promotion requests…" />
      ) : queue.error ? (
        <ErrorState message={queue.error} onRetry={queue.reload} />
      ) : (
        <Card title={`Promotion requests (${queue.data!.length})`}>
          <DataTable<AdminPromotionRequest>
            columns={columns}
            rows={queue.data!}
            rowKey={(r) => r.id}
            onRowClick={(r) => setSelected(r)}
            empty={<EmptyState title="No promotion requests with this status." />}
          />
        </Card>
      )}
      {selected ? <RequestDrawer request={selected} onClose={() => setSelected(null)} onChanged={queue.reload} /> : null}
    </>
  );
}

/* ------------------------------ payments tab --------------------------- */

const PAYMENT_FILTERS = [
  { key: 'PENDING', label: 'Pending review' },
  { key: 'APPROVED', label: 'Approved' },
  { key: 'REJECTED', label: 'Rejected' },
  { key: 'CANCELLED', label: 'Cancelled' },
  { key: 'ALL', label: 'All' },
] as const;

type PaymentFilter = (typeof PAYMENT_FILTERS)[number]['key'];

export function PromotionPaymentsTab(props: { onPendingCount?: (n: number) => void }) {
  const [status, setStatus] = useState<PaymentFilter>('PENDING');
  const list = useAsync(() => api.listPromotionPaymentRequests({ status: status === 'ALL' ? undefined : status }), [status]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  /* Keep the shell's Payments tab badge honest: it reflects the pending
     queue, not the currently selected filter. */
  const onPendingCountRef = useRef(props.onPendingCount);
  onPendingCountRef.current = props.onPendingCount;
  useEffect(() => {
    const report = onPendingCountRef.current;
    if (!report) return;
    if (status === 'PENDING' && list.data) {
      report(list.data.items.length);
      return;
    }
    let alive = true;
    Promise.resolve()
      .then(() => api.listPromotionPaymentRequests({ status: 'PENDING' }))
      .then((res) => {
        if (alive && res) report(res.items.length);
      })
      .catch(() => {
        /* keep the last known count */
      });
    return () => {
      alive = false;
    };
  }, [status, list.data]);

  const columns: Column<AdminPromotionPayment>[] = [
    { key: 'business', header: 'Business', render: (p) => <strong>{p.business.name}</strong> },
    { key: 'promotion', header: 'Promotion', render: (p) => p.promotion.name },
    { key: 'amount', header: 'Amount', render: (p) => fmtMoney(p.amountMinor, p.currency) },
    { key: 'method', header: 'Method', render: (p) => p.paymentMethod.name },
    { key: 'reference', header: 'Reference', render: (p) => <span className="nb-mono">{p.transactionReference || 'N/A'}</span> },
    { key: 'submitted', header: 'Submitted', render: (p) => fmtDate(p.submittedAt) },
    { key: 'status', header: 'Status', render: (p) => <Badge value={p.status} /> },
    {
      key: 'actions',
      header: '',
      render: (p) => (
        <button type="button" className="nb-btn nb-btn-sm nb-btn-secondary" onClick={() => setSelectedId(p.id)}>
          Review
        </button>
      ),
    },
  ];

  return (
    <>
      <p className="nb-hint" style={{ marginTop: 0 }}>
        Paid promotions go live only through this workflow: review the business payment here, and approving it activates the promotion with
        server-set start and end dates.
      </p>
      <p className="nb-hint">Showing the first page of results. This list is server-paginated; use the status filters to review each queue.</p>
      <Toolbar>
        <Tabs
          tabs={PAYMENT_FILTERS.map((f) => ({ key: f.key, label: f.label }))}
          active={status}
          onChange={(k) => setStatus(k as PaymentFilter)}
        />
      </Toolbar>
      {list.loading ? (
        <LoadingState label="Loading promotion payments…" />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : (
        <Card title="Promotion payments">
          <DataTable<AdminPromotionPayment>
            columns={columns}
            rows={list.data!.items}
            rowKey={(p) => p.id}
            empty={<EmptyState title="No promotion payments with this status." />}
          />
        </Card>
      )}
      {selectedId ? (
        <GrowthDrawer title="Promotion payment review" onClose={() => setSelectedId(null)}>
          <PaymentReviewPanel
            paymentId={selectedId}
            onDecided={() => {
              list.reload();
              setSelectedId(null);
            }}
          />
        </GrowthDrawer>
      ) : null}
    </>
  );
}

/* ------------------------------- active tab ---------------------------- */

export function ActivePlacementsTab() {
  const placements = useAsync(() => api.listFeatured('active').then((all) => all.filter((i) => i.source === 'paid')), []);

  const columns: Column<FeaturedItem>[] = [
    {
      key: 'business',
      header: 'Business',
      render: (i) => (
        <>
          <strong>{i.business.name}</strong>
          <div className="nb-muted nb-mono">{i.business.slug}</div>
        </>
      ),
    },
    {
      key: 'promotion',
      header: 'Promotion',
      render: (i) => (
        <>
          <strong>{i.promotion?.name ?? <span className="nb-muted">N/A</span>}</strong>
          {i.payment ? <div className="nb-muted nb-mono">{fmtMoney(i.payment.amountMinor, i.payment.currency)} paid</div> : null}
        </>
      ),
    },
    { key: 'placement', header: 'Placement', render: (i) => <span className="nb-mono">{i.placementType}</span> },
    { key: 'started', header: 'Started', render: (i) => (i.startsAt ? fmtDate(i.startsAt) : <span className="nb-muted">N/A</span>) },
    { key: 'ends', header: 'Ends', render: (i) => (i.endsAt ? fmtDate(i.endsAt) : <span className="nb-muted">N/A</span>) },
    {
      key: 'status',
      header: 'Status',
      render: (i) => (
        <>
          <Badge value={i.state.toUpperCase()} />
          {i.payment ? (
            <div style={{ marginTop: 4 }}>
              <Badge value={i.payment.status} />
            </div>
          ) : null}
        </>
      ),
    },
  ];

  return (
    <>
      <p className="nb-hint" style={{ marginTop: 0 }}>
        Currently live paid promotion placements. Each one went live through payment approval in the Payments tab.
      </p>
      {placements.loading ? (
        <LoadingState label="Loading active placements…" />
      ) : placements.error ? (
        <ErrorState message={placements.error} onRetry={placements.reload} />
      ) : (
        <Card title={`Active paid placements (${placements.data!.length})`}>
          <DataTable<FeaturedItem>
            columns={columns}
            rows={placements.data!}
            rowKey={(i) => i.id}
            empty={<EmptyState title="No paid promotions are live right now." />}
          />
        </Card>
      )}
    </>
  );
}

/* ------------------------------ featured tab --------------------------- */

function SourceBadge(props: { source: 'paid' | 'editorial' }) {
  return props.source === 'paid' ? (
    <span className="nb-badge nb-badge-ok">Paid promotion</span>
  ) : (
    <span className="nb-badge nb-badge-info">Editorial pick</span>
  );
}

const FEATURED_STATES: Array<{ value: FeaturedListState; label: string }> = [
  { value: 'active', label: 'Active' },
  { value: 'expired', label: 'Expired' },
  { value: 'all', label: 'All' },
];

function FeaturedItemDrawer(props: {
  item: FeaturedItem;
  onClose: () => void;
  onEnded: () => void;
  onExtend: () => void;
  onRemoved: () => void;
}) {
  const i = props.item;
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const isEditorial = i.source === 'editorial';
  const isLive = i.state === 'active' || i.state === 'scheduled';

  const run = async (fn: () => Promise<unknown>, done: () => void) => {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      done();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Action failed.');
    } finally {
      setBusy(false);
    }
  };

  const endEarly = () => {
    if (!window.confirm(`End the editorial feature "${i.label}" for ${i.business.name} early? It will stop showing immediately.`)) return;
    void run(() => api.endEditorialFeature(i.id), props.onEnded);
  };

  const remove = () => {
    if (!window.confirm(`Remove the editorial feature "${i.label}" for ${i.business.name} entirely? This cannot be undone.`)) return;
    void run(() => api.deleteEditorialFeature(i.id), props.onRemoved);
  };

  return (
    <GrowthDrawer title={isEditorial ? 'Editorial feature' : 'Paid placement'} onClose={props.onClose}>
      {actionError ? <FormError message={actionError} /> : null}
      <DefinitionList
        items={[
          {
            label: 'Business',
            value: (
              <>
                <strong>{i.business.name}</strong>
                <div className="nb-muted nb-mono">{i.business.slug}</div>
              </>
            ),
          },
          { label: 'Source', value: <SourceBadge source={i.source} /> },
          ...(isEditorial
            ? [
                { label: 'Placement type', value: <span className="nb-mono">{i.placementType}</span> },
                { label: 'Label', value: i.label },
              ]
            : [
                {
                  label: 'Promotion',
                  value: (
                    <>
                      <strong>{i.promotion?.name ?? 'N/A'}</strong>
                      {i.promotion ? <div className="nb-muted nb-mono">{i.promotion.slug}</div> : null}
                    </>
                  ),
                },
                ...(i.payment
                  ? [
                      {
                        label: 'Payment',
                        value: (
                          <>
                            {fmtMoney(i.payment.amountMinor, i.payment.currency)} <Badge value={i.payment.status} />
                          </>
                        ),
                      },
                    ]
                  : []),
              ]),
          { label: 'Starts', value: i.startsAt ? fmtDate(i.startsAt) : <span className="nb-muted">N/A</span> },
          { label: 'Ends', value: i.endsAt ? fmtDate(i.endsAt) : <span className="nb-muted">N/A</span> },
          { label: 'State', value: <Badge value={i.state.toUpperCase()} /> },
        ]}
      />
      {isEditorial ? (
        <p className="nb-hint">
          Editorial features are free admin curation and are structurally separate from paid promotions. Creating, extending, or removing
          one can never activate a paid promotion.
        </p>
      ) : (
        <p className="nb-hint">
          This placement went live through payment approval in the Payments tab. Paid placements cannot be started, extended, or ended from
          this screen; they run their server-set term.
        </p>
      )}
      {isEditorial && isLive ? (
        <FormActions>
          <button type="button" className="nb-btn" disabled={busy} onClick={props.onExtend}>
            Extend end date
          </button>
          <button type="button" className="nb-btn nb-btn-secondary" disabled={busy} onClick={endEarly}>
            End early
          </button>
          <button type="button" className="nb-btn nb-btn-danger" disabled={busy} onClick={remove}>
            Remove
          </button>
        </FormActions>
      ) : null}
    </GrowthDrawer>
  );
}

function ExtendFeatureModal(props: { feature: EditorialFeature; onClose: () => void; onSaved: () => void }) {
  const f = props.feature;
  const [endAt, setEndAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!endAt) {
      setError('Pick a new end date.');
      return;
    }
    const next = new Date(endAt);
    if (Number.isNaN(next.getTime()) || next <= new Date(f.endsAt)) {
      setError('The new end date must be later than the current end date.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.updateEditorialFeature(f.id, { endAt: next.toISOString() });
      props.onSaved();
      props.onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not extend the feature.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Extend feature: ${f.label}`} onClose={props.onClose}>
      {error ? <FormError message={error} /> : null}
      <p className="nb-hint" style={{ marginTop: 0 }}>
        Current end date: {fmtDate(f.endsAt)}. The extension is extend-only: the new end date must be later than the current one. Only the
        end date can change; paid promotions are never affected.
      </p>
      <form onSubmit={(e) => void save(e)}>
        <Field label="New end date and time">
          <input type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} required />
        </Field>
        <FormActions>
          <button type="submit" className="nb-btn" disabled={busy}>
            {busy ? 'Saving…' : 'Extend feature'}
          </button>
          <button type="button" className="nb-btn nb-btn-secondary" onClick={props.onClose}>
            Cancel
          </button>
        </FormActions>
      </form>
    </Modal>
  );
}

function NewEditorialFeatureModal(props: { onClose: () => void; onSaved: () => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Array<{ id: string; name: string; slug: string }> | null>(null);
  const [searching, setSearching] = useState(false);
  const [businessId, setBusinessId] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [placementType, setPlacementType] = useState('');
  const [label, setLabel] = useState('');
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async () => {
    const term = q.trim();
    if (term.length < 2) {
      setError('Type at least 2 characters to search businesses.');
      return;
    }
    setSearching(true);
    setError(null);
    try {
      const list = await api.listBusinesses({ q: term });
      setResults(
        list.slice(0, 8).map((b) => ({ id: b.id, name: b.name, slug: b.slug })),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Business search failed.');
    } finally {
      setSearching(false);
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!businessId) {
      setError('Search for and select a business first.');
      return;
    }
    const pt = placementType.trim();
    if (pt.length < 2) {
      setError('Enter a placement type, e.g. homepage_hero.');
      return;
    }
    if (!endAt) {
      setError('Pick an end date for the feature.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.createEditorialFeature({
        businessId,
        placementType: pt,
        label: label.trim() || undefined,
        startAt: startAt ? new Date(startAt).toISOString() : undefined,
        endAt: new Date(endAt).toISOString(),
      });
      props.onSaved();
      props.onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the feature.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="New editorial feature" onClose={props.onClose} wide>
      {error ? <FormError message={error} /> : null}
      <p className="nb-hint" style={{ marginTop: 0 }}>
        Editorial features are free admin curation and are structurally separate from paid promotions. Creating one can never activate a
        paid promotion. Paid promotions go live only when a payment is approved in the Payments tab.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save(e);
        }}
      >
        <Field label="Business">
          {businessId ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <strong>{businessName}</strong>
              <button
                type="button"
                className="nb-btn nb-btn-sm nb-btn-secondary"
                onClick={() => {
                  setBusinessId('');
                  setBusinessName('');
                  setResults(null);
                }}
              >
                Change
              </button>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                <div style={{ flex: 1 }}>
                  <SearchInput value={q} onChange={setQ} placeholder="Search by business name" label="Search businesses" />
                </div>
                <button type="button" className="nb-btn" disabled={searching} onClick={() => void search()}>
                  {searching ? 'Searching…' : 'Search'}
                </button>
              </div>
              {results ? (
                results.length === 0 ? (
                  <EmptyState title="No businesses match this search." />
                ) : (
                  <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0 }}>
                    {results.map((b) => (
                      <li
                        key={b.id}
                        style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--line)' }}
                      >
                        <span>
                          <strong>{b.name}</strong> <span className="nb-muted nb-mono">{b.slug}</span>
                        </span>
                        <button
                          type="button"
                          className="nb-btn nb-btn-sm nb-btn-secondary"
                          style={{ marginLeft: 'auto' }}
                          onClick={() => {
                            setBusinessId(b.id);
                            setBusinessName(b.name);
                          }}
                        >
                          Select
                        </button>
                      </li>
                    ))}
                  </ul>
                )
              ) : null}
            </>
          )}
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Placement type">
            <input value={placementType} onChange={(e) => setPlacementType(e.target.value)} required maxLength={60} placeholder="homepage_hero" />
          </Field>
          <Field label="Label (optional, defaults to the placement type)">
            <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120} placeholder="Homepage hero" />
          </Field>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Start (optional, defaults to now)">
            <input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
          </Field>
          <Field label="End (required)">
            <input type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} required />
          </Field>
        </div>
        <FormActions>
          <button type="submit" className="nb-btn" disabled={busy}>
            {busy ? 'Creating…' : 'Create editorial feature'}
          </button>
          <button type="button" className="nb-btn nb-btn-secondary" onClick={props.onClose}>
            Cancel
          </button>
        </FormActions>
      </form>
    </Modal>
  );
}

export function FeaturedTab() {
  const [state, setState] = useState<FeaturedListState>('active');
  const list = useAsync(() => api.listFeatured(state), [state]);
  const [selected, setSelected] = useState<FeaturedItem | null>(null);
  const [extending, setExtending] = useState<EditorialFeature | null>(null);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const items = list.data ?? [];
  const paid = items.filter((i) => i.source === 'paid');
  const editorial = items.filter((i) => i.source === 'editorial');

  const openExtend = (i: FeaturedItem) => {
    if (i.source !== 'editorial') return;
    /* The extend modal only needs the current end date, which the unified
       list already carries; no single-feature GET exists. */
    setExtending({
      id: i.id,
      placementType: i.placementType,
      label: i.label,
      startsAt: i.startsAt ?? new Date().toISOString(),
      endsAt: i.endsAt ?? new Date().toISOString(),
      state: i.state,
      createdAt: i.startsAt ?? new Date().toISOString(),
      business: i.business,
      createdBy: { id: '', email: '' },
    });
  };

  const endEarly = async (i: FeaturedItem) => {
    if (i.source !== 'editorial') return;
    if (!window.confirm(`End the editorial feature "${i.label}" for ${i.business.name} early? It will stop showing immediately.`)) return;
    setBusyId(i.id);
    setActionError(null);
    try {
      await api.endEditorialFeature(i.id);
      list.reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Action failed.');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (i: FeaturedItem) => {
    if (i.source !== 'editorial') return;
    if (!window.confirm(`Remove the editorial feature "${i.label}" for ${i.business.name} entirely? This cannot be undone.`)) return;
    setBusyId(i.id);
    setActionError(null);
    try {
      await api.deleteEditorialFeature(i.id);
      list.reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Action failed.');
    } finally {
      setBusyId(null);
    }
  };

  const paidColumns: Column<FeaturedItem>[] = [
    {
      key: 'business',
      header: 'Business',
      render: (i) => (
        <>
          <strong>{i.business.name}</strong>
          <div className="nb-muted nb-mono">{i.business.slug}</div>
        </>
      ),
    },
    { key: 'source', header: 'Source', render: (i) => <SourceBadge source={i.source} /> },
    {
      key: 'placement',
      header: 'Placement',
      render: (i) => (
        <>
          <strong>{i.promotion?.name ?? 'N/A'}</strong>
          {i.payment ? <div className="nb-muted nb-mono">{fmtMoney(i.payment.amountMinor, i.payment.currency)} paid</div> : null}
          <div className="nb-muted nb-mono">{i.placementType}</div>
        </>
      ),
    },
    { key: 'starts', header: 'Starts', render: (i) => (i.startsAt ? fmtDate(i.startsAt) : <span className="nb-muted">N/A</span>) },
    { key: 'ends', header: 'Ends', render: (i) => (i.endsAt ? fmtDate(i.endsAt) : <span className="nb-muted">N/A</span>) },
    { key: 'state', header: 'State', render: (i) => <Badge value={i.state.toUpperCase()} /> },
    {
      key: 'actions',
      header: 'Actions',
      render: (i) => (
        <button type="button" className="nb-btn nb-btn-sm nb-btn-secondary" onClick={() => setSelected(i)}>
          View
        </button>
      ),
    },
  ];

  const editorialColumns: Column<FeaturedItem>[] = [
    {
      key: 'business',
      header: 'Business',
      render: (i) => (
        <>
          <strong>{i.business.name}</strong>
          <div className="nb-muted nb-mono">{i.business.slug}</div>
        </>
      ),
    },
    { key: 'source', header: 'Source', render: (i) => <SourceBadge source={i.source} /> },
    {
      key: 'placement',
      header: 'Placement',
      render: (i) => (
        <>
          <strong>{i.label}</strong>
          <div className="nb-muted nb-mono">{i.placementType}</div>
        </>
      ),
    },
    { key: 'starts', header: 'Starts', render: (i) => (i.startsAt ? fmtDate(i.startsAt) : <span className="nb-muted">N/A</span>) },
    { key: 'ends', header: 'Ends', render: (i) => (i.endsAt ? fmtDate(i.endsAt) : <span className="nb-muted">N/A</span>) },
    { key: 'state', header: 'State', render: (i) => <Badge value={i.state.toUpperCase()} /> },
    {
      key: 'actions',
      header: 'Actions',
      render: (i) => {
        const isLive = i.state === 'active' || i.state === 'scheduled';
        return (
          <>
            <button type="button" className="nb-btn nb-btn-sm nb-btn-secondary" onClick={() => setSelected(i)}>
              View
            </button>
            {isLive ? (
              <>
                {' '}
                <button type="button" className="nb-btn nb-btn-sm nb-btn-secondary" disabled={busyId === i.id} onClick={() => openExtend(i)}>
                  Extend
                </button>{' '}
                <button type="button" className="nb-btn nb-btn-sm nb-btn-secondary" disabled={busyId === i.id} onClick={() => void endEarly(i)}>
                  End early
                </button>{' '}
                <button type="button" className="nb-btn nb-btn-sm nb-btn-danger" disabled={busyId === i.id} onClick={() => void remove(i)}>
                  Remove
                </button>
              </>
            ) : null}
          </>
        );
      },
    },
  ];

  return (
    <>
      <p className="nb-hint" style={{ marginTop: 0 }}>
        The unified featured list. <strong>Paid promotion</strong> badges mark placements that were activated through payment approval;
        <strong> Editorial pick</strong> badges mark free admin curation. Nothing on this screen can activate a paid promotion.
      </p>
      <Toolbar>
        <FilterSelect
          label="Filter featured items by state"
          value={state}
          onChange={(v) => setState(v as FeaturedListState)}
          options={FEATURED_STATES.map((s) => ({ value: s.value, label: s.label }))}
        />
        <button type="button" className="nb-btn" onClick={() => setCreating(true)}>
          New editorial feature
        </button>
      </Toolbar>
      {actionError ? <FormError message={actionError} /> : null}
      {list.loading ? (
        <LoadingState label="Loading featured businesses…" />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : (
        <>
          <Card
            title={`Paid promotions (${paid.length})`}
            subtitle="Activated through payment approval in the Payments tab. Read-only here."
          >
            <DataTable<FeaturedItem>
              columns={paidColumns}
              rows={paid}
              rowKey={(i) => `paid-${i.id}`}
              empty={<EmptyState title="No paid placements with this filter." />}
            />
          </Card>
          <div style={{ height: 16 }} />
          <Card
            title={`Editorial picks (${editorial.length})`}
            subtitle="Free admin curation. Creating, extending, or removing one can never activate a paid promotion."
          >
            <DataTable<FeaturedItem>
              columns={editorialColumns}
              rows={editorial}
              rowKey={(i) => `editorial-${i.id}`}
              empty={<EmptyState title="No editorial features with this filter." body="Use New editorial feature to curate one." />}
            />
          </Card>
        </>
      )}
      {selected ? (
        <FeaturedItemDrawer
          item={selected}
          onClose={() => setSelected(null)}
          onEnded={() => {
            setSelected(null);
            list.reload();
          }}
          onExtend={() => {
            const it = selected;
            setSelected(null);
            openExtend(it);
          }}
          onRemoved={() => {
            setSelected(null);
            list.reload();
          }}
        />
      ) : null}
      {extending ? <ExtendFeatureModal feature={extending} onClose={() => setExtending(null)} onSaved={list.reload} /> : null}
      {creating ? <NewEditorialFeatureModal onClose={() => setCreating(false)} onSaved={list.reload} /> : null}
    </>
  );
}

/* ---------------------------- center (5 tabs) --------------------------- */

const TABS = [
  { key: 'catalog', label: 'Catalog' },
  { key: 'requests', label: 'Requests' },
  { key: 'payments', label: 'Payments' },
  { key: 'active', label: 'Active' },
  { key: 'featured', label: 'Featured' },
] as const;

type CenterTab = (typeof TABS)[number]['key'];

export function PromotionCenter() {
  const [tab, setTab] = useState<CenterTab>('catalog');
  const [pendingPayments, setPendingPayments] = useState<number | null>(null);

  return (
    <>
      <PageHeader title="Promotions" subtitle="Growth and advertising control center." />
      <Tabs
        tabs={TABS.map((t) => ({
          key: t.key,
          label: t.label,
          count: t.key === 'payments' && pendingPayments ? pendingPayments : undefined,
        }))}
        active={tab}
        onChange={(k) => setTab(k as CenterTab)}
      />
      <div style={{ marginTop: 16 }}>
        {tab === 'catalog' ? <PromotionCatalogTab /> : null}
        {tab === 'requests' ? <PromotionRequestsTab /> : null}
        {tab === 'payments' ? <PromotionPaymentsTab onPendingCount={setPendingPayments} /> : null}
        {tab === 'active' ? <ActivePlacementsTab /> : null}
        {tab === 'featured' ? <FeaturedTab /> : null}
      </div>
    </>
  );
}
