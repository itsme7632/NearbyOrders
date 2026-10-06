import { RemoteImage } from '../components/RemoteImage.js';
import { useEffect, useMemo, useState } from 'react';
import {
  getMyOrder,
  listMyOrders,
  listMyReviews,
  listBusinessPayInMethods,
  listOrderPayments,
  submitOrderPayment,
  uploadPaymentReceipt,
  resolveImageUrl,
  type BusinessPayInMethod,
  type CustomerPayment,
} from '../api.js';
import { useAsyncData } from '../hooks.js';
import { Button, EmptyState, ErrorState, ListSkeleton, Loading, Money } from '../components/ui.js';
import { OrdersIcon } from '../components/icons.js';
import type { Order, OrderStatus } from '../api.js';
import { ReviewForm } from '../components/ReviewForm.js';

/** Short, human-safe order label: never exposes the raw database id. */
export function orderNumber(o: Order): string {
  return `#${o.id.replace(/-/g, '').slice(-6).toUpperCase()}`;
}

/** Marketplace-card business thumbnail: image when present, monogram otherwise. */
export function OrderThumb(props: { name: string; imageUrl?: string | null }) {
  if (props.imageUrl) {
    return <RemoteImage className="oc-thumb" src={resolveImageUrl(props.imageUrl) ?? undefined} alt="" loading="lazy" />;
  }
  return (
    <span className="oc-thumb" aria-hidden>
      {props.name[0]?.toUpperCase() ?? '?'}
    </span>
  );
}

export function orderLabel(status: OrderStatus): { text: string; cls: string } {
  switch (status) {
    case 'PENDING':
      return { text: 'Pending', cls: 'status-pending' };
    case 'ACCEPTED':
      return { text: 'Accepted', cls: 'status-accepted' };
    case 'PREPARING':
      return { text: 'Preparing', cls: 'status-preparing' };
    case 'READY':
      return { text: 'Ready', cls: 'status-ready' };
    case 'OUT_FOR_DELIVERY':
      return { text: 'Out for delivery', cls: 'status-ready' };
    case 'DELIVERED':
      return { text: 'Delivered', cls: 'status-completed' };
    case 'COMPLETED':
      return { text: 'Completed', cls: 'status-completed' };
    case 'CANCELLED':
      return { text: 'Cancelled', cls: 'status-cancelled' };
    case 'REJECTED':
      return { text: 'Rejected', cls: 'status-cancelled' };
    default:
      // Defensive: a future server status enum value must never blank the
      // whole list with a render exception. Show the raw value honestly.
      return { text: status, cls: 'status-pending' };
  }
}

const itemCount = (o: Order) => o.items.reduce((sum, i) => sum + i.quantity, 0);

const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString('en-PK', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/** In-flight statuses surface at the top under "Active"; the rest is history. */
const isActiveStatus = (s: OrderStatus) => !['COMPLETED', 'CANCELLED', 'REJECTED'].includes(s);

export function OrdersScreen(props: { onOpenOrder: (id: string) => void; onBrowse: () => void }) {
  const orders = useAsyncData<Order[]>(() => listMyOrders(), []);
  const [view, setView] = useState<'active' | 'all'>('active');

  const all = orders.data ?? [];
  const activeCount = all.filter((o) => isActiveStatus(o.status)).length;
  const visible = view === 'active' ? all.filter((o) => isActiveStatus(o.status)) : all;

  // The archive ("All") reads as a hierarchy, not one undifferentiated list:
  // in-flight work first, then completed, then cancelled/rejected history.
  const historyGroups = useMemo(
    () =>
      [
        { key: 'progress', title: 'In progress', items: all.filter((o) => isActiveStatus(o.status)) },
        { key: 'completed', title: 'Completed', items: all.filter((o) => o.status === 'COMPLETED') },
        { key: 'cancelled', title: 'Cancelled & rejected', items: all.filter((o) => o.status === 'CANCELLED' || o.status === 'REJECTED') },
      ].filter((g) => g.items.length > 0),
    [all],
  );

  return (
    <div className="screen">
      <header className="owner-head">
        <h1>My orders</h1>
      </header>
      {orders.loading ? (
        <ListSkeleton count={4} />
      ) : orders.error ? (
        <ErrorState message={orders.error} onRetry={orders.reload} />
      ) : !orders.data?.length ? (
        <EmptyState
          icon={<OrdersIcon size={30} />}
          title="No orders yet"
          body="Discover something nearby and place your first order."
          action={<Button onClick={props.onBrowse}>Find businesses</Button>}
        />
      ) : (
        <>
          {/* Status scopes: Active is the default lens; All is the archive. */}
          <div className="seg-tabs" role="tablist" aria-label="Order view">
            <button
              type="button"
              role="tab"
              aria-selected={view === 'active'}
              className={`seg-tab${view === 'active' ? ' seg-tab-active' : ''}`}
              onClick={() => setView('active')}
            >
              Active{activeCount > 0 ? <span className="seg-count">{activeCount}</span> : null}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === 'all'}
              className={`seg-tab${view === 'all' ? ' seg-tab-active' : ''}`}
              onClick={() => setView('all')}
            >
              All
            </button>
          </div>

          {!visible.length ? (
            <EmptyState
              icon={<OrdersIcon size={28} />}
              title="No active orders"
              body="Orders in progress will appear here until they are completed."
            />
          ) : view === 'active' ? (
            <ul className="order-list">
              {visible.map((o) => (
                <li key={o.id}>
                  <OrderStatusCard order={o} onOpen={() => props.onOpenOrder(o.id)} />
                </li>
              ))}
            </ul>
          ) : (
            historyGroups.map((g) => (
              <section key={g.key} aria-label={`${g.title} orders`} className="order-group">
                <div className="section-head section-head-sm">
                  <h2>{g.title}</h2>
                  <span className="biz-distance">
                    {g.items.length} {g.items.length === 1 ? 'order' : 'orders'}
                  </span>
                </div>
                <ul className="order-list">
                  {g.items.map((o) => (
                    <li key={o.id}>
                      <OrderStatusCard order={o} onOpen={() => props.onOpenOrder(o.id)} />
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </>
      )}
    </div>
  );
}

/**
 * Order card with a meaningful status strip: business identity, items and
 * total on one row, then the status progression dots underneath — the state
 * the customer cares about, always visible without opening the order.
 */
function OrderStatusCard(props: { order: Order; onOpen: () => void }) {
  const o = props.order;
  const label = orderLabel(o.status);
  return (
    <button type="button" className="order-card-v3" onClick={props.onOpen}>
      <span className="oc-top">
        <OrderThumb name={o.business.name} imageUrl={o.business.imageUrl} />
        <span className="oc-main">
          <span className="oc-name">{o.business.name}</span>
          <span className="oc-sub">
            {orderNumber(o)} · {itemCount(o)} item{itemCount(o) === 1 ? '' : 's'}
          </span>
        </span>
        <span className="oc-side">
          <Money minor={o.totalMinor ?? o.subtotalMinor} currency={o.currency} />
        </span>
      </span>
      <span className="oc-track">
        <OrderTrack status={o.status} fulfillmentType={o.fulfillmentType} />
        <span className={`badge ${label.cls}`}>{label.text}</span>
      </span>
      <span className="oc-bottom">
        <span className="oc-when">Placed {formatWhen(o.createdAt)}</span>
        <span className="oc-when" aria-hidden>
          ›
        </span>
      </span>
    </button>
  );
}

const PICKUP_TRACK_STEPS: { key: OrderStatus; label: string }[] = [
  { key: 'PENDING', label: 'Placed' },
  { key: 'ACCEPTED', label: 'Accepted' },
  { key: 'PREPARING', label: 'Preparing' },
  { key: 'READY', label: 'Ready' },
  { key: 'COMPLETED', label: 'Completed' },
];

const DELIVERY_TRACK_STEPS: { key: OrderStatus; label: string }[] = [
  { key: 'PENDING', label: 'Placed' },
  { key: 'ACCEPTED', label: 'Accepted' },
  { key: 'PREPARING', label: 'Preparing' },
  { key: 'READY', label: 'Ready' },
  { key: 'OUT_FOR_DELIVERY', label: 'Out for delivery' },
  { key: 'DELIVERED', label: 'Delivered' },
];

/**
 * Status progression for order cards and detail. Terminal negative states
 * (cancelled/rejected) show a simple declined mark instead of a fake
 * progression — never invents a step that did not happen.
 * Delivery orders use the 6-step delivery timeline; pickup uses 5 steps.
 */
export function OrderTrack(props: { status: OrderStatus; fulfillmentType?: string; compact?: boolean }) {
  if (props.status === 'CANCELLED' || props.status === 'REJECTED') {
    return <span className={`track track-halted${props.compact ? ' track-compact' : ''}`} aria-label="Order cancelled" />;
  }
  const steps = props.fulfillmentType === 'DELIVERY' ? DELIVERY_TRACK_STEPS : PICKUP_TRACK_STEPS;
  const currentIdx = steps.findIndex((s) => s.key === props.status);
  return (
    <span
      className={`track${props.compact ? ' track-compact' : ''}`}
      role="img"
      aria-label={`Order progress: ${steps[Math.max(currentIdx, 0)].label}`}
    >
      {steps.map((s, i) => (
        <span
          key={s.key}
          className={`track-dot${i <= currentIdx ? ' track-done' : ''}${i === currentIdx ? ' track-now' : ''}`}
        />
      ))}
    </span>
  );
}

/** Fetches by id; list views pass ids, so a dedicated fetch keeps it simple. */
async function fetchOrder(id: string): Promise<Order> {
  return getMyOrder(id);
}

export function OrderDetailScreen(props: { orderId: string; onBack: () => void }) {
  const order = useAsyncData<Order>(() => fetchOrder(props.orderId), [props.orderId]);

  if (order.loading) return <Loading label="Loading order…" />;
  if (order.error) return <ErrorState message={order.error} onRetry={order.reload} />;
  if (!order.data)
    return <EmptyState icon={<OrdersIcon size={30} />} title="Order not found" body="It may belong to another account." />;

  const o = order.data;
  const label = orderLabel(o.status);

  return (
    <div className="screen">
      <button className="back-link" onClick={props.onBack}>
        ‹ Back
      </button>
      {/* Status hero: the state first, the identity right under it. */}
      <section className="order-status-hero" aria-label="Order status">
        <span className={`badge ${label.cls}`}>{label.text}</span>
        <OrderTrack status={o.status} fulfillmentType={o.fulfillmentType} />
      </section>
      <header className="owner-head">
        <h1>Order {orderNumber(o)}</h1>
      </header>
      <p className="order-meta">
        {o.business.name} · {formatWhen(o.createdAt)}
      </p>

      <section className="detail-section" aria-label="Order items">
        <h2 className="detail-section-title">Items</h2>
        <ul className="item-list">
          {o.items.map((i) => (
            <li key={i.id}>
              <div className="item-row">
                <span className="item-name">{i.name}</span>
                <Money minor={i.lineTotalMinor} currency={o.currency} />
              </div>
              <p className="item-desc">
                {i.quantity} × <Money minor={i.unitPriceMinor} currency={o.currency} />
              </p>
            </li>
          ))}
        </ul>
        <div className="cart-summary">
          {o.fulfillmentType === 'DELIVERY' ? (
            <div className="cart-line">
              <span>Delivery fee</span>
              <Money minor={o.deliveryFeeMinor ?? 0} currency={o.currency} />
            </div>
          ) : null}
          <div className="cart-line">
            <span>Items subtotal</span>
            <Money minor={o.subtotalMinor} currency={o.currency} />
          </div>
          <div className="cart-line cart-total">
            <span>Total</span>
            <Money minor={o.totalMinor ?? o.subtotalMinor} currency={o.currency} />
          </div>
        </div>
      </section>
      {o.fulfillmentType === 'DELIVERY' && o.deliveryAddressText ? (
        <section className="detail-section" aria-label="Delivery address">
          <h2 className="detail-section-title">Deliver to</h2>
          {o.deliveryAddressLabel ? <p className="item-desc">{o.deliveryAddressLabel}</p> : null}
          <p className="order-addr">{o.deliveryAddressText}</p>
        </section>
      ) : null}
      {o.fulfillmentType === 'DELIVERY' && o.assignedRider ? (
        <section className="detail-section" aria-label="Delivery rider">
          <h2 className="detail-section-title">Your rider</h2>
          <div className="rider-card">
            {o.assignedRider.photoUrl ? (
              <RemoteImage className="rider-photo" src={resolveImageUrl(o.assignedRider.photoUrl) ?? undefined} alt="" loading="lazy" />
            ) : null}
            <div className="rider-info">
              <p className="rider-name">{o.assignedRider.name}</p>
              {o.assignedRider.phone ? (
                <a className="rider-call" href={`tel:${o.assignedRider.phone.replace(/[^+\d]/g, '')}`}>
                  Call rider
                </a>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}
      <p className="hint">
        Purchase-time prices are shown: later menu changes never alter your order.
        {o.fulfillmentType === 'DELIVERY' ? ' Delivered by the business’s own rider.' : ''}
      </p>

      <OrderPaymentPanel order={o} onChanged={order.reload} />

      {o.status === 'COMPLETED' ? <OrderReviewPanel order={o} /> : null}
    </div>
  );
}

/* ------------------- Phase 7C: order payment (customer) ------------------- */

const ORDER_PAYMENT_LABEL: Record<CustomerPayment['status'], string> = {
  PENDING_VERIFICATION: 'Waiting for verification',
  PAID: 'Paid',
  FAILED: 'Rejected',
  UNPAID: 'Unpaid',
};

const ORDER_PAYMENT_BADGE: Record<CustomerPayment['status'], string> = {
  PENDING_VERIFICATION: 'badge-neutral',
  PAID: 'badge-open',
  FAILED: 'badge-closed',
  UNPAID: 'badge-closed',
};

/**
 * Payment UI is driven by the payment method frozen on the ORDER.
 * Business payment methods are used only to display that selected method's
 * instructions; their availability never decides whether an order is payable.
 */
export function OrderPaymentPanel(props: { order: Order; onChanged: () => void }) {
  const { order } = props;
  const payments = useAsyncData<CustomerPayment[]>(() => listOrderPayments(order.id), [order.id]);
  const methods = useAsyncData<BusinessPayInMethod[]>(
    () => (order.paymentMethodId ? listBusinessPayInMethods(order.business.id) : Promise.resolve([])),
    [order.business.id, order.paymentMethodId],
  );

  const total = order.totalMinor ?? order.subtotalMinor;
  const allPayments = payments.data ?? [];
  const paid = allPayments.filter((p) => p.status === 'PAID').reduce((s, p) => s + p.amountMinor, 0);
  const pending = allPayments.filter((p) => p.status === 'PENDING_VERIFICATION').reduce((s, p) => s + p.amountMinor, 0);
  const due = Math.max(total - paid - pending, 0);

  const [formOpen, setFormOpen] = useState(false);
  const [reference, setReference] = useState('');
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // When the frozen method was removed, the customer explicitly picks a
  // current method for the replacement proof. Never auto-substituted.
  const [replacementMethodId, setReplacementMethodId] = useState<string | null>(null);

  if (payments.loading) return <Loading label="Loading payment…" />;
  if (payments.error) return null;

  const isCash = order.paymentMethodId == null;
  const selectedMethod = order.paymentMethodId
    ? (methods.data ?? []).find((m) => m.id === order.paymentMethodId) ?? null
    : null;
  const latestPayment = [...allPayments].sort(
    (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime(),
  )[0] ?? null;
  const hasPending = pending > 0;
  const isPaid = paid >= total;
  const isTerminal = ['COMPLETED', 'CANCELLED', 'REJECTED', 'DELIVERED'].includes(order.status);
  const methodRemoved = !isCash && order.paymentMethodId != null && selectedMethod == null;
  const replacementMethod = methodRemoved
    ? (methods.data ?? []).find((m) => m.id === replacementMethodId) ?? null
    : null;
  // The method used for a (re)submission: the frozen method when it is still
  // listed, otherwise the explicitly chosen replacement. The order's frozen
  // paymentMethodId is never rewritten by the client.
  const submitMethod = selectedMethod ?? replacementMethod;
  const needsSubmission =
    !isCash && !isTerminal && due > 0 && !hasPending && !isPaid && latestPayment?.status !== 'PENDING_VERIFICATION';
  const canSubmitOnlineProof = needsSubmission && submitMethod != null;

  if (isCash) {
    return (
      <section className="detail-section" aria-label="Payment">
        <h2 className="detail-section-title">Payment</h2>
        <div className="cart-summary">
          <div className="cart-line">
            <span>Payment method</span>
            <span>Cash</span>
          </div>
          <div className="cart-line cart-total">
            <span>{isPaid ? 'Collected' : 'Due on arrival'}</span>
            <Money minor={Math.max(total - paid, 0)} currency={order.currency} />
          </div>
        </div>
        <p className="hint">
          {isPaid
            ? 'Cash payment was collected.'
            : order.fulfillmentType === 'PICKUP'
              ? 'Pay cash when you pick up your order.'
              : 'Pay cash when your order arrives.'}
        </p>
      </section>
    );
  }

  return (
    <section className="detail-section" aria-label="Payment">
      <h2 className="detail-section-title">Payment</h2>
      {error ? <ErrorState message={error} /> : null}

      <div className="cart-summary">
        <div className="cart-line">
          <span>Payment method</span>
          <span>{selectedMethod?.displayName ?? latestPayment?.paymentMethod?.displayName ?? 'Online payment'}</span>
        </div>
        <div className="cart-line">
          <span>Total</span>
          <Money minor={total} currency={order.currency} />
        </div>
        {paid > 0 ? (
          <div className="cart-line">
            <span>Paid</span>
            <Money minor={paid} currency={order.currency} />
          </div>
        ) : null}
        {pending > 0 ? (
          <div className="cart-line">
            <span>Submitted</span>
            <Money minor={pending} currency={order.currency} />
          </div>
        ) : null}
        <div className="cart-line cart-total">
          <span>{isPaid ? 'Paid in full' : 'Due'}</span>
          {!isPaid ? <Money minor={due} currency={order.currency} /> : null}
        </div>
      </div>

      <ul className="manage-list">
        {allPayments.map((p) => (
          <li key={p.id} className="manage-item">
            <div className="item-row">
              <span className="item-name">
                {p.paymentMethod?.displayName ?? 'Online payment'} · <Money minor={p.amountMinor} currency={p.currency} />
              </span>
              <span className={`badge ${ORDER_PAYMENT_BADGE[p.status]}`}>{ORDER_PAYMENT_LABEL[p.status]}</span>
            </div>
            {p.transactionReference ? <p className="item-desc pay-ref">Ref {p.transactionReference}</p> : null}
            {p.status === 'FAILED' && p.rejectionReason ? <p className="item-desc">Reason: {p.rejectionReason}</p> : null}
          </li>
        ))}
      </ul>

      {pending > 0 ? (
        <p className="hint">Payment proof submitted. Waiting for the business to verify it.</p>
      ) : isPaid ? (
        <p className="hint">Payment received and verified.</p>
      ) : latestPayment?.status === 'FAILED' && !isTerminal && !methodRemoved ? (
        <p className="hint">Payment proof was rejected. Submit a new proof using the same payment method.</p>
      ) : null}

      {methodRemoved && needsSubmission ? (
        <div className="pay-details">
          <p className="hint" role="alert">
            The original payment method
            {latestPayment?.paymentMethod?.displayName ? ` (${latestPayment.paymentMethod.displayName})` : ''} is
            no longer available. Choose one of the business's current payment methods to submit your proof.
            The order's payment method stays unchanged.
          </p>
          <label className="field">
            <span className="label">Payment method for the new proof</span>
            <select
              value={replacementMethodId ?? ''}
              onChange={(e) => setReplacementMethodId(e.target.value || null)}
            >
              <option value="">Choose a payment method…</option>
              {(methods.data ?? []).map((m) => (
                <option key={m.id} value={m.id}>{m.displayName}</option>
              ))}
            </select>
          </label>
          {!(methods.data ?? []).length && !methods.loading ? (
            <p className="hint">The business has no online payment methods right now. Contact the business to arrange payment.</p>
          ) : null}
        </div>
      ) : null}

      {canSubmitOnlineProof ? (
        formOpen ? (
          <div className="pay-details">
            <p className="pay-instructions">
              {submitMethod?.instructions ?? 'Pay the business directly, then submit your proof below.'}
            </p>
            {submitMethod?.accountTitle || submitMethod?.accountNumber || submitMethod?.iban ? (
              <dl className="pay-account">
                {submitMethod.accountTitle ? <div><dt>Account title</dt><dd>{submitMethod.accountTitle}</dd></div> : null}
                {submitMethod.accountNumber ? <div><dt>Account number</dt><dd>{submitMethod.accountNumber}</dd></div> : null}
                {submitMethod.iban ? <div><dt>IBAN</dt><dd className="pay-iban">{submitMethod.iban}</dd></div> : null}
              </dl>
            ) : null}
            <label className="field">
              <span className="label">Transaction reference (required)</span>
              <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. TX-123456" maxLength={80} />
            </label>
            <label className="field">
              <span className="label">Receipt image</span>
              <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)} />
            </label>
            <p className="hint">Your proof stays pending until the business verifies it.</p>
            <div className="btn-row">
              <Button
                sm
                disabled={busy || !reference.trim() || !receiptFile}
                onClick={() => {
                  if (!submitMethod) return;
                  setBusy(true);
                  setError(null);
                  uploadPaymentReceipt(receiptFile!)
                    .then((receiptStorageKey) =>
                      submitOrderPayment(order.id, {
                        amountMinor: due,
                        paymentMethodId: submitMethod.id,
                        transactionReference: reference.trim(),
                        receiptStorageKey,
                      }),
                    )
                    .then(() => {
                      setFormOpen(false);
                      setReference('');
                      setReceiptFile(null);
                      props.onChanged();
                      payments.reload();
                    })
                    .catch((e) => setError(e instanceof Error ? e.message : 'Could not submit payment'))
                    .finally(() => setBusy(false));
                }}
              >
                {busy ? 'Submitting…' : 'Submit payment proof'}
              </Button>
              <Button sm variant="ghost" disabled={busy} onClick={() => setFormOpen(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button full variant="secondary" onClick={() => setFormOpen(true)}>
            Pay Rs {due / 100} online · Submit proof
          </Button>
        )
      ) : null}
    </section>
  );
}

/** Leave-a-review panel for completed orders; server rejects duplicates. */
function OrderReviewPanel(props: { order: Order }) {
  const [showForm, setShowForm] = useState(false);
  const [reviewed, setReviewed] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    listMyReviews()
      .then((mine) => {
        if (active) setReviewed(mine.some((rv) => rv.orderId === props.order.id));
      })
      .catch(() => {
        if (active) setReviewed(false); // Fail open; the API still blocks duplicates.
      });
    return () => {
      active = false;
    };
  }, [props.order.id]);

  if (reviewed === null) return null;
  if (reviewed)
    return (
      <p className="review-done" role="status">
        ★ Reviewed: thank you for your feedback.
      </p>
    );
  if (!showForm)
    return (
      <Button full variant="secondary" onClick={() => setShowForm(true)}>
        Leave a review
      </Button>
    );
  return (
    <ReviewForm
      businessId={props.order.business.id}
      source={{ orderId: props.order.id }}
      heading="Rate this business"
      onSubmitted={() => {
        setReviewed(true);
        setShowForm(false);
      }}
      onCancel={() => setShowForm(false)}
    />
  );
}
