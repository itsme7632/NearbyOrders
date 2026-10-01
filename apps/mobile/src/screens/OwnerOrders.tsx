import { useState } from 'react';
import { collectOrderCash, listBusinessOrders, listOrderPayments, setOrderStatus, ApiError, type CustomerPayment, type Order, type OrderStatus } from '../api.js';
import { useAsyncData } from '../hooks.js';
import { Button, EmptyState, ErrorState, Loading, Money } from '../components/ui.js';
import { AlertIcon, OrdersIcon } from '../components/icons.js';
import { AssignRiderModal } from './AssignRiderModal.js';

/** Board columns: which statuses belong where. */
const BOARD_COLUMNS = [
  { key: 'NEW', title: 'New', statuses: ['PENDING', 'ACCEPTED'] as OrderStatus[] },
  { key: 'PREPARING', title: 'Preparing', statuses: ['PREPARING'] as OrderStatus[] },
  { key: 'READY', title: 'Ready', statuses: ['READY'] as OrderStatus[] },
  { key: 'OUT_FOR_DELIVERY', title: 'Out for delivery', statuses: ['OUT_FOR_DELIVERY'] as OrderStatus[] },
  { key: 'COMPLETED', title: 'Completed', statuses: ['DELIVERED', 'COMPLETED', 'REJECTED', 'CANCELLED'] as OrderStatus[] },
] as const;

type ColumnKey = (typeof BOARD_COLUMNS)[number]['key'];

const columnFor = (status: OrderStatus): ColumnKey =>
  BOARD_COLUMNS.find((c) => (c.statuses as readonly OrderStatus[]).includes(status))?.key ?? 'COMPLETED';

const STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING: 'Pending',
  ACCEPTED: 'Accepted',
  REJECTED: 'Rejected',
  PREPARING: 'Preparing',
  READY: 'Ready',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

const STATUS_CLASS: Record<OrderStatus, string> = {
  PENDING: 'status-pending',
  ACCEPTED: 'status-accepted',
  REJECTED: 'status-cancelled',
  PREPARING: 'status-preparing',
  READY: 'status-ready',
  OUT_FOR_DELIVERY: 'status-preparing',
  DELIVERED: 'status-completed',
  COMPLETED: 'status-completed',
  CANCELLED: 'status-cancelled',
};

/** Short human-safe label (mirrors customer Orders screen). */
export const orderNo = (o: Order) => `#${o.id.replace(/-/g, '').slice(-6).toUpperCase()}`;

const itemCount = (o: Order) => o.items.reduce((sum, i) => sum + i.quantity, 0);

const customerName = (o: Order) => [o.customer?.firstName, o.customer?.lastName].filter(Boolean).join(' ') || 'Customer';

const isDelivery = (o: Order) => o.fulfillmentType === 'DELIVERY';

const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString('en-PK', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

type NextAction =
  | { kind: 'status'; status: OrderStatus; label: string; variant: 'primary' | 'secondary' | 'danger' }
  | { kind: 'assign-rider'; label: string };

/** The single next action for an order on the board. Exported for tests. */
export function nextAction(o: Order): NextAction | null {
  switch (o.status) {
    case 'PENDING':
      return { kind: 'status', status: 'ACCEPTED', label: 'Accept', variant: 'primary' };
    case 'ACCEPTED':
      return { kind: 'status', status: 'PREPARING', label: 'Start preparing', variant: 'primary' };
    case 'PREPARING':
      return { kind: 'status', status: 'READY', label: 'Mark ready', variant: 'primary' };
    case 'READY':
      if (isDelivery(o)) {
        return o.assignedRider
          ? { kind: 'status', status: 'OUT_FOR_DELIVERY', label: 'Out for delivery', variant: 'primary' }
          : { kind: 'assign-rider', label: 'Assign rider' };
      }
      return { kind: 'status', status: 'COMPLETED', label: 'Complete', variant: 'primary' };
    case 'OUT_FOR_DELIVERY':
      return { kind: 'status', status: 'DELIVERED', label: 'Mark delivered', variant: 'primary' };
    default:
      return null;
  }
}

/** Which board column an order status belongs to. Exported for tests. */
export function boardColumn(status: OrderStatus): ColumnKey {
  return columnFor(status);
}

/**
 * Owner operations board for one business: Kanban-style columns grouped
 * client-side from the existing owner orders response. When `orders` is
 * provided (the Business-mode tab already fetched the scoped list) it is used
 * directly; otherwise the component fetches itself (management screens).
 */
export function OwnerOrders(props: { businessId: string; orders?: Order[] }) {
  // Management screens fetch the caller-scoped business listing (server-side
  // ownership, same dataset the Business-mode tab uses); the personal list is
  // never the source for business order management.
  const selfFetched = useAsyncData<Order[]>(
    props.orders ? async () => [] : () => listBusinessOrders(props.businessId),
    [],
  );
  const orders = props.orders ? { data: props.orders, loading: false, error: null, reload: selfFetched.reload } : selfFetched;
  const list = (orders.data ?? []).filter((o) => o.business.id === props.businessId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [boardFilter, setBoardFilter] = useState<ColumnKey | 'ALL'>('ALL');
  const [assignOrderId, setAssignOrderId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const act = async (order: Order, next: OrderStatus) => {
    setBusyId(order.id);
    setError(null);
    try {
      await setOrderStatus(order.id, next);
      orders.reload();
    } catch (e) {
      // Someone else (or the other side) changed it first — surface and refresh.
      setError(
        e instanceof ApiError && (e.code === 'INVALID_TRANSITION' || e.code === 'RIDER_REQUIRED')
          ? e.code === 'RIDER_REQUIRED'
            ? 'Assign an active rider before marking the order out for delivery.'
            : 'That action is no longer available: the order status already changed.'
          : e instanceof Error
            ? e.message
            : 'Could not update the order',
      );
      orders.reload();
    } finally {
      setBusyId(null);
    }
  };

  if (orders.loading) return <Loading label="Loading orders…" />;
  if (orders.error) return <ErrorState message={orders.error} onRetry={orders.reload} />;

  // Scoped to the one business being managed. (Owner detail isolation is
  // enforced server-side.)
  const mine = list;
  const assignOrder = assignOrderId ? mine.find((x) => x.id === assignOrderId) ?? null : null;
  const assignModal = assignOrder ? (
    <AssignRiderModal
      businessId={props.businessId}
      order={assignOrder}
      onClose={() => setAssignOrderId(null)}
      onAssigned={() => {
        setAssignOrderId(null);
        orders.reload();
      }}
    />
  ) : null;

  if (selectedId) {
    const o = mine.find((x) => x.id === selectedId);
    if (!o) {
      return (
        <section className="card">
          {error ? <ErrorState message={error} /> : null}
          <EmptyState
            icon={<OrdersIcon size={28} />}
            title="Order not found"
            body="It may have been removed, or belongs to another business."
            action={<Button sm onClick={() => setSelectedId(null)}>Back to orders</Button>}
          />
        </section>
      );
    }
    const action = nextAction(o);
    return (
      <section className="card" aria-label="Order detail">
        <button className="back-link" onClick={() => setSelectedId(null)}>
          ‹ All orders
        </button>
        {error ? <ErrorState message={error} /> : null}
        <div className="owner-head">
          <h2>Order {orderNo(o)}</h2>
          <span className={`badge ${STATUS_CLASS[o.status]}`}>{STATUS_LABEL[o.status]}</span>
        </div>
        <p className="order-meta">
          {customerName(o)} · {formatWhen(o.createdAt)} · {isDelivery(o) ? 'Delivery' : 'Pickup'}
        </p>
        {isDelivery(o) && o.deliveryAddressText ? (
          <p className="order-meta">Deliver to: {o.deliveryAddressText}</p>
        ) : null}
        {o.assignedRider ? (
          <p className="order-meta">Rider: {o.assignedRider.name}</p>
        ) : null}
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
          <div className="cart-line">
            <span>Subtotal</span>
            <Money minor={o.subtotalMinor} currency={o.currency} />
          </div>
          {isDelivery(o) ? (
            <div className="cart-line">
              <span>Delivery fee</span>
              <Money minor={o.deliveryFeeMinor ?? 0} currency={o.currency} />
            </div>
          ) : null}
          <div className="cart-line">
            <span>{isDelivery(o) ? 'Delivery' : 'Pickup'} · total</span>
            <Money minor={o.totalMinor ?? o.subtotalMinor} currency={o.currency} />
          </div>
        </div>

        <OrderPaymentBlock orderId={o.id} onChanged={orders.reload} />

        {action ? (
          <div className="btn-row">
            {action.kind === 'assign-rider' ? (
              <Button sm variant="primary" disabled={busyId === o.id} onClick={() => setAssignOrderId(o.id)}>
                {action.label}
              </Button>
            ) : (
              <Button sm variant={action.variant} disabled={busyId === o.id} onClick={() => void act(o, action.status)}>
                {busyId === o.id ? 'Working…' : action.label}
              </Button>
            )}
            {o.status === 'PENDING' ? (
              <Button sm variant="danger" disabled={busyId === o.id} onClick={() => void act(o, 'REJECTED')}>
                Reject
              </Button>
            ) : null}
          </div>
        ) : (
          <p className="hint">No further actions: this order is {STATUS_LABEL[o.status].toLowerCase()}.</p>
        )}
        {assignModal}
      </section>
    );
  }

  return (
    <section aria-label="Operations board" className="ops-workspace">
      <div className="ops-workspace-head">
        <div>
          <span className="cart-kicker">BUSINESS ORDERS</span>
          <h2>Orders</h2>
          <p className="ops-subtitle">Move each order through one clear next step.</p>
        </div>
        <span className="ops-active-count">
          {mine.filter((o) => !['DELIVERED', 'COMPLETED', 'REJECTED', 'CANCELLED'].includes(o.status)).length} active
        </span>
      </div>
      {error ? <ErrorState message={error} /> : null}

      <div className="ops-filters" role="tablist" aria-label="Order status">
        {([
          ['ALL', 'All'],
          ['NEW', 'New'],
          ['PREPARING', 'Preparing'],
          ['READY', 'Ready'],
          ['OUT_FOR_DELIVERY', 'Out for delivery'],
          ['COMPLETED', 'Completed'],
        ] as const).map(([key, label]) => {
          const count = key === 'ALL'
            ? mine.length
            : mine.filter((o) => columnFor(o.status) === key).length;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={boardFilter === key}
              className={`ops-filter${boardFilter === key ? ' is-active' : ''}`}
              onClick={() => setBoardFilter(key)}
            >
              <span>{label}</span>
              <small>{count}</small>
            </button>
          );
        })}
      </div>

      {!mine.length ? (
        <div className="card ops-empty-state">
          <EmptyState
            icon={<OrdersIcon size={28} />}
            title="No customer orders yet"
            body="Orders placed with your business will appear here."
          />
        </div>
      ) : (
        <div className="ops-list">
          {BOARD_COLUMNS
            .filter((col) => boardFilter === 'ALL' || col.key === boardFilter)
            .map((col) => {
              const cards = mine
                .filter((o) => (col.statuses as readonly OrderStatus[]).includes(o.status))
                .sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
              if (!cards.length) {
                return (
                  <section key={col.key} className="ops-section">
                    <div className="ops-section-head">
                      <div>
                        <h3>{col.title}</h3>
                        <span>0 orders</span>
                      </div>
                    </div>
                    <div className="ops-section-empty">Nothing here right now.</div>
                  </section>
                );
              }
              return (
                <section key={col.key} className="ops-section" aria-label={col.title}>
                  <div className="ops-section-head">
                    <div>
                      <h3>{col.title}</h3>
                      <span>{cards.length} order{cards.length === 1 ? '' : 's'}</span>
                    </div>
                    <span className={`ops-section-dot ops-dot-${col.key.toLowerCase().replaceAll('_', '-')}`} aria-hidden />
                  </div>
                  <ul className="ops-order-list">
                    {cards.map((o) => {
                      const action = nextAction(o);
                      return (
                        <li key={o.id} className="ops-order-card">
                          <button
                            type="button"
                            className="ops-order-open"
                            onClick={() => setSelectedId(o.id)}
                            aria-label={`Open order ${orderNo(o)}`}
                          >
                            <div className="ops-order-top">
                              <span className="order-no">{orderNo(o)}</span>
                              <span className={`badge ${STATUS_CLASS[o.status]}`}>{STATUS_LABEL[o.status]}</span>
                            </div>
                            <div className="ops-order-main">
                              <div>
                                <strong>{customerName(o)}</strong>
                                <p>{formatWhen(o.createdAt)} · {itemCount(o)} item{itemCount(o) === 1 ? '' : 's'}</p>
                              </div>
                              <Money minor={o.totalMinor ?? o.subtotalMinor} currency={o.currency} />
                            </div>
                            <div className="ops-order-meta">
                              <span className={`ops-fulfillment ${isDelivery(o) ? 'is-delivery' : ''}`}>
                                {isDelivery(o) ? 'Delivery' : 'Pickup'}
                              </span>
                              {isDelivery(o) && o.deliveryAddressText ? <span className="ops-address">{o.deliveryAddressText}</span> : null}
                              {o.assignedRider ? <span>Rider: {o.assignedRider.name}</span> : null}
                            </div>
                          </button>
                          {action ? (
                            <div className="ops-order-action">
                              {action.kind === 'assign-rider' ? (
                                <Button full variant="primary" disabled={busyId === o.id} onClick={() => setAssignOrderId(o.id)}>
                                  {action.label}
                                </Button>
                              ) : (
                                <Button full variant={action.variant} disabled={busyId === o.id} onClick={() => void act(o, action.status)}>
                                  {busyId === o.id ? 'Working…' : action.label}
                                </Button>
                              )}
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
        </div>
      )}
      {assignModal}
    </section>
  );
}

/* ------------------ Owner view of one order's payment ------------------ */

const OWNER_ORDER_PAYMENT_LABEL: Record<CustomerPayment['status'], string> = {
  PENDING_VERIFICATION: 'Waiting for your verification',
  PAID: 'Paid',
  FAILED: 'Rejected',
  UNPAID: 'Unpaid',
};

/**
 * Payment block inside the owner's order detail: the chosen channel (or
 * cash), existing payment proofs with honest statuses, and — for cash flows
 * with money still due — a Collect cash action. COD stays UNPAID until the
 * owner confirms the cash was received in person; NearbyOrders never holds it.
 */
export function OrderPaymentBlock(props: { orderId: string; onChanged: () => void }) {
  const payments = useAsyncData<CustomerPayment[]>(() => listOrderPayments(props.orderId), [props.orderId]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (payments.loading) return <Loading label="Loading payment…" />;
  if (payments.error || !payments.data) return null; // Non-critical; order still shows.

  const collect = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await collectOrderCash(props.orderId);
      payments.reload();
      props.onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record the cash collection');
    } finally {
      setBusy(false);
    }
  };

  const paid = payments.data.filter((p) => p.status === 'PAID').reduce((s, p) => s + p.amountMinor, 0);
  const pending = payments.data.filter((p) => p.status === 'PENDING_VERIFICATION').reduce((s, p) => s + p.amountMinor, 0);

  return (
    <div className="pay-details">
      <h3 className="pay-section-title">Payment</h3>
      {error ? <ErrorState message={error} /> : null}
      {payments.data.length === 0 ? (
        <p className="hint">No payment proof yet: the customer will pay cash or submit proof for verification.</p>
      ) : (
        <ul className="manage-list">
          {payments.data.map((p) => (
            <li key={p.id} className="manage-item">
              <div className="item-row">
                <span className="item-name">
                  {p.paymentMethod?.displayName ?? 'Cash'} · <Money minor={p.amountMinor} currency={p.currency} />
                </span>
                <span className={`pay-status pay-status-${p.status === 'PAID' ? 'paid' : p.status === 'FAILED' ? 'failed' : 'pending'}`}>
                  {OWNER_ORDER_PAYMENT_LABEL[p.status]}
                </span>
              </div>
              {p.transactionReference ? <p className="item-desc pay-ref">Ref {p.transactionReference}</p> : null}
              {p.status === 'FAILED' && p.rejectionReason ? (
                <p className="item-desc">
                  <AlertIcon size={12} /> Reason: {p.rejectionReason}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {paid + pending === 0 ? (
        <Button sm variant="secondary" disabled={busy} onClick={() => void collect()}>
          {busy ? 'Recording…' : 'Collect cash'}
        </Button>
      ) : null}
    </div>
  );
}
