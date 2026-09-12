import { useEffect, useMemo, useState } from 'react';
import {
  createOrder,
  listBusinessPayInMethods,
  submitOrderPayment,
  uploadPaymentReceipt,
  ApiError,
  type BusinessPayInMethod,
} from '../api.js';
import { Button, EmptyState, ErrorState, Money } from '../components/ui.js';
import { OrdersIcon, CheckIcon } from '../components/icons.js';
import { cartSubtotal, clearCart, getCart, lineTotal, onCartChange, removeFromCart, setQuantity, type Cart } from '../cart.js';

/**
 * Cart + checkout review (Phase 7C). The server re-prices authoritatively —
 * the fee and total shown here come back from the created order. Payment:
 * cash on pickup, cash on delivery (when the business offers it), or a manual
 * digital channel (Easypaisa etc.) whose proof the business verifies before
 * the payment is ever "paid". There is no gateway and no self-attestation.
 */
export function CartScreen(props: { onBack: () => void; onBrowse: () => void; onPlaced: (orderId: string) => void }) {
  const [cart, setCart] = useState<Cart | null>(getCart());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<{ id: string; businessName: string; totalMinor: number } | null>(null);

  // Phase 7C checkout state.
  const [methods, setMethods] = useState<BusinessPayInMethod[] | null>(null);
  const [methodsError, setMethodsError] = useState(false);
  const [fulfillment, setFulfillment] = useState<'PICKUP' | 'DELIVERY'>('PICKUP');
  const [methodId, setMethodId] = useState<string | null>(null);
  const [reference, setReference] = useState('');
  const [receiptFile, setReceiptFile] = useState<File | null>(null);

  const digitalMethods = useMemo(() => (methods ?? []).filter((m) => m.type !== 'CASH'), [methods]);
  const selected = digitalMethods.find((m) => m.id === methodId) ?? null;

  // Keep in sync with cart mutations triggered elsewhere (e.g. removed elsewhere).
  const sync = () => setCart(getCart());
  onCartChange(sync);
  // Re-subscribe on every render keeps this simple and correct for this scale.

  // Load the business's pay-in channels once; failures degrade to cash-only.
  useEffect(() => {
    let alive = true;
    if (!cart) return;
    listBusinessPayInMethods(cart.businessId)
      .then((list) => {
        if (alive) setMethods(list);
      })
      .catch(() => {
        if (alive) setMethodsError(true);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart?.businessId]);

  const place = async () => {
    if (!cart || busy) return;
    setBusy(true);
    setError(null);
    try {
      const order = await createOrder({
        businessId: cart.businessId,
        items: cart.items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
        fulfillmentType: fulfillment,
        ...(selected ? { paymentMethodId: selected.id } : {}),
      });
      // Manual digital proof follows immediately; the payment stays
      // PENDING_VERIFICATION until the business verifies it.
      if (selected) {
        const receiptStorageKey = receiptFile ? await uploadPaymentReceipt(receiptFile) : undefined;
        await submitOrderPayment(order.id, {
          amountMinor: order.totalMinor ?? order.subtotalMinor,
          paymentMethodId: selected.id,
          transactionReference: reference.trim() || undefined,
          receiptStorageKey,
        });
      }
      clearCart();
      setPlaced({
        id: order.id,
        businessName: order.business.name,
        totalMinor: order.totalMinor ?? order.subtotalMinor,
      });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'INVALID_PRODUCTS')
        setError('One or more items are no longer available. Remove them and try again.');
      else if (e instanceof ApiError && e.code === 'DELIVERY_UNAVAILABLE')
        setError('This business does not offer delivery. Choose pickup instead.');
      else if (e instanceof ApiError && e.code === 'COD_UNAVAILABLE')
        setError('Cash on delivery is not available here — choose a payment method or pickup.');
      else if (e instanceof ApiError) setError(e.message);
      else setError('Could not place the order');
    } finally {
      setBusy(false);
    }
  };

  if (placed) {
    return (
      <div className="screen">
        <button className="back-link" onClick={props.onBack}>
          ‹ Back
        </button>
        <EmptyState
          icon={<CheckIcon size={34} />}
          title={selected ? 'Payment submitted' : 'Order placed!'}
          body={
            selected
              ? `${placed.businessName} received your order of Rs ${Math.round(placed.totalMinor / 100)} and your payment proof. It is waiting for the business to verify your payment.`
              : `${placed.businessName} has received your order of Rs ${Math.round(placed.totalMinor / 100)}. Track it under Orders.`
          }
          action={<Button onClick={() => props.onPlaced(placed.id)}>View my orders</Button>}
        />
      </div>
    );
  }

  if (!cart || cart.items.length === 0) {
    return (
      <div className="screen">
        <button className="back-link" onClick={props.onBack}>
          ‹ Back
        </button>
        <EmptyState
          icon={<OrdersIcon size={30} />}
          title="Your cart is empty"
          body="Browse nearby businesses and add products to get started."
          action={<Button onClick={props.onBrowse}>Find businesses</Button>}
        />
      </div>
    );
  }

  return (
    <div className="screen">
      <button className="back-link" onClick={props.onBack}>
        ‹ Back
      </button>
      <header className="owner-head">
        <h1>Your cart</h1>
      </header>
      <p className="cart-business">
        Ordering from <strong>{cart.businessName}</strong>
      </p>
      {error ? <ErrorState message={error} /> : null}

      <section className="card">
        <ul className="cart-list">
          {cart.items.map((item) => (
            <li key={item.productId} className="cart-item">
              <div className="cart-item-main">
                <div className="item-row">
                  <span className="item-name">{item.name}</span>
                  <Money minor={lineTotal(item)} currency="PKR" />
                </div>
                <span className="cart-unit">
                  <Money minor={item.unitPriceMinor} currency="PKR" /> each
                </span>
                <div className="cart-controls">
                  <div className="qty-stepper" aria-label={`Quantity of ${item.name}`}>
                    <button
                      type="button"
                      className="qty-btn"
                      onClick={() => setQuantity(item.productId, item.quantity - 1)}
                      aria-label={`Decrease quantity of ${item.name}`}
                    >
                      −
                    </button>
                    <span className="qty-value">{item.quantity}</span>
                    <button
                      type="button"
                      className="qty-btn"
                      onClick={() => setQuantity(item.productId, item.quantity + 1)}
                      aria-label={`Increase quantity of ${item.name}`}
                    >
                      +
                    </button>
                  </div>
                  <button type="button" className="cart-remove" onClick={() => removeFromCart(item.productId)}>
                    Remove
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
        <div className="cart-summary">
          <div className="cart-line">
            <span>Subtotal</span>
            <Money minor={cartSubtotal(cart)} currency="PKR" />
          </div>
          <div className="cart-line cart-total">
            <span>{fulfillment === 'DELIVERY' ? 'Total (delivery fee added by the business)' : 'Total'}</span>
            <Money minor={cartSubtotal(cart)} currency="PKR" />
          </div>
        </div>
      </section>

      {/* Fulfillment: pickup or delivery (fee comes from business settings). */}
      <section className="card" aria-label="How do you want to receive the order?">
        <h2>Receiving</h2>
        <div className="pay-methods" role="radiogroup" aria-label="Receiving option">
          {(['PICKUP', 'DELIVERY'] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              role="radio"
              aria-checked={fulfillment === kind}
              className={`pay-chip${fulfillment === kind ? ' pay-chip-active' : ''}`}
              onClick={() => setFulfillment(kind)}
            >
              {kind === 'PICKUP' ? 'Pickup (pay cash there)' : 'Delivery'}
            </button>
          ))}
        </div>
      </section>

      {/* Payment method: cash flows need nothing; digital needs proof. */}
      {digitalMethods.length > 0 ? (
        <section className="card" aria-label="Payment method">
          <h2>Pay by</h2>
          <div className="pay-methods" role="radiogroup" aria-label="Payment method">
            <button
              type="button"
              role="radio"
              aria-checked={methodId === null}
              className={`pay-chip${methodId === null ? ' pay-chip-active' : ''}`}
              onClick={() => {
                setMethodId(null);
                setReference('');
                setReceiptFile(null);
              }}
            >
              {fulfillment === 'DELIVERY' ? 'Cash on delivery' : 'Cash on pickup'}
            </button>
            {digitalMethods.map((m) => (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={methodId === m.id}
                className={`pay-chip${methodId === m.id ? ' pay-chip-active' : ''}`}
                onClick={() => setMethodId(m.id)}
              >
                {m.displayName}
              </button>
            ))}
          </div>

          {selected ? (
            <div className="pay-details">
              <p className="pay-instructions">{selected.instructions ?? 'Pay the business directly, then submit your proof below.'}</p>
              {selected.accountTitle || selected.accountNumber || selected.iban ? (
                <dl className="pay-account">
                  {selected.accountTitle ? (
                    <div>
                      <dt>Account title</dt>
                      <dd>{selected.accountTitle}</dd>
                    </div>
                  ) : null}
                  {selected.accountNumber ? (
                    <div>
                      <dt>Account number</dt>
                      <dd>{selected.accountNumber}</dd>
                    </div>
                  ) : null}
                  {selected.iban ? (
                    <div>
                      <dt>IBAN</dt>
                      <dd className="pay-iban">{selected.iban}</dd>
                    </div>
                  ) : null}
                </dl>
              ) : null}
              <label className="field">
                <span className="label">Transaction reference (required)</span>
                <input
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="e.g. TX-123456"
                  maxLength={80}
                />
              </label>
              <label className="field">
                <span className="label">Receipt image</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)}
                />
              </label>
              <p className="hint">Your payment stays “submitted” until the business verifies it.</p>
            </div>
          ) : null}
        </section>
      ) : (
        <p className="hint">
          {methodsError ? 'Payment options could not be loaded — you will pay cash.' : 'You will pay cash when you receive the order.'}
        </p>
      )}

      <Button full onClick={place} disabled={busy || (!!selected && (!reference.trim() || !receiptFile))}>
        {busy ? 'Placing order…' : selected ? 'Submit order + payment proof' : 'Place order'}
      </Button>
      <div className="btn-row" style={{ marginTop: 8 }}>
        <Button full variant="ghost" onClick={clearCart} disabled={busy}>
          Clear cart
        </Button>
      </div>
    </div>
  );
}
