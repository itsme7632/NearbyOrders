import { useState } from 'react';
import {
  getOrder,
  setOrderStatus,
  ApiError,
  type Order,
  type OrderStatus,
} from '../api.js';
import { useAsyncData } from '../hooks.js';
import { Button, EmptyState, ErrorState, Loading, Money } from '../components/ui.js';
import { OrdersIcon } from '../components/icons.js';
import { AssignRiderModal } from './AssignRiderModal.js';
import {
  OrderPaymentBlock,
  customerName,
  formatWhen,
  isDelivery,
  nextAction,
  orderNo,
  STATUS_CLASS,
  STATUS_LABEL,
} from './OwnerOrders.js';

/**
 * Business order detail as a standalone screen (deep links, notifications).
 * Fetches the order via GET /orders/:id, which authorizes the owning business
 * server-side (404 for anyone else's order). The payload never decides who
 * may see it.
 */
export function OwnerOrderDetailScreen(props: { orderId: string; onBack: () => void }) {
  const order = useAsyncData<Order>(() => getOrder(props.orderId), [props.orderId]);

  if (order.loading) return <Loading label="Loading order…" />;
  if (order.error) return <ErrorState message={order.error} onRetry={order.reload} />;
  if (!order.data) {
    return (
      <section className="card">
        <EmptyState
          icon={<OrdersIcon size={28} />}
          title="Order not found"
          body="It may have been removed, or belongs to another business."
          action={
            <Button sm onClick={props.onBack}>
              Back
            </Button>
          }
        />
      </section>
    );
  }
  return <OwnerOrderDetailBody order={order.data} backLabel="‹ Back" onBack={props.onBack} onChanged={order.reload} />;
}

/**
 * The business order detail body, shared by the inline board selection and
 * the standalone deep-link screen. Business context only: never renders
 * customer payment actions.
 */
export function OwnerOrderDetailBody(props: {
  order: Order;
  backLabel: string;
  onBack: () => void;
  onChanged: () => void;
}) {
  const { order: o } = props;
  const [busy, setBusy] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = async (next: OrderStatus) => {
    setBusy(true);
    setError(null);
    try {
      await setOrderStatus(o.id, next);
      props.onChanged();
    } catch (e) {
      setError(
        e instanceof ApiError && (e.code === 'INVALID_TRANSITION' || e.code === 'RIDER_REQUIRED')
          ? e.code === 'RIDER_REQUIRED'
            ? 'Assign an active rider before marking the order out for delivery.'
            : 'That action is no longer available: the order status already changed.'
          : e instanceof Error
            ? e.message
            : 'Could not update the order',
      );
      props.onChanged();
    } finally {
      setBusy(false);
    }
  };

  const action = nextAction(o);

  return (
    <section className="card" aria-label="Order detail">
      <button className="back-link" onClick={props.onBack}>
        {props.backLabel}
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
        <div className="order-address-block">
          {o.deliveryAddressLabel ? <strong>{o.deliveryAddressLabel}</strong> : null}
          <p className="order-meta">Deliver to: {o.deliveryAddressText}</p>
        </div>
      ) : null}
      {o.assignedRider ? <p className="order-meta">Rider: {o.assignedRider.name}</p> : null}
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

      <OrderPaymentBlock order={o} onChanged={props.onChanged} />

      {action ? (
        <div className="btn-row">
          {action.kind === 'assign-rider' ? (
            <Button sm variant="primary" disabled={busy} onClick={() => setAssignOpen(true)}>
              {action.label}
            </Button>
          ) : (
            <Button sm variant={action.variant} disabled={busy} onClick={() => void act(action.status)}>
              {busy ? 'Working…' : action.label}
            </Button>
          )}
          {o.status === 'PENDING' ? (
            <Button sm variant="danger" disabled={busy} onClick={() => void act('REJECTED')}>
              Reject
            </Button>
          ) : null}
        </div>
      ) : (
        <p className="hint">No further actions: this order is {STATUS_LABEL[o.status].toLowerCase()}.</p>
      )}
      {assignOpen ? (
        <AssignRiderModal
          businessId={o.business.id}
          order={o}
          onClose={() => setAssignOpen(false)}
          onAssigned={() => {
            setAssignOpen(false);
            props.onChanged();
          }}
        />
      ) : null}
    </section>
  );
}
