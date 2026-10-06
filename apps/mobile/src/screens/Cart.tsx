import { useEffect, useMemo, useState } from 'react';
import {
  createOrder,
  listBusinessPayInMethods,
  getBusiness,
  submitOrderPayment,
  uploadPaymentReceipt,
  ApiError,
  type BusinessPayInMethod,
} from '../api.js';
import { listAddresses, getSession, type CustomerAddress } from '../api.js';
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
export function CartScreen(props: { onBack: () => void; onBrowse: () => void; onAddAddress: () => void; onPlaced: (orderId: string) => void }) {
  const [cart, setCart] = useState<Cart | null>(getCart());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<{
    id: string;
    businessName: string;
    subtotalMinor: number;
    deliveryFeeMinor?: number;
    totalMinor: number;
  } | null>(null);

  // Phase 7C checkout state.
  const [methods, setMethods] = useState<BusinessPayInMethod[] | null>(null);
  const [methodsError, setMethodsError] = useState(false);
  const [fulfillment, setFulfillment] = useState<'PICKUP' | 'DELIVERY'>('PICKUP');
  // Phase 17: the customer's address book drives DELIVERY checkout.
  const [addresses, setAddresses] = useState<CustomerAddress[] | null>(null);
  const [addressId, setAddressId] = useState<string | null>(null);
  const [business, setBusiness] = useState<Awaited<ReturnType<typeof getBusiness>> | null>(null);
  const [businessLoading, setBusinessLoading] = useState(false);
  const [methodId, setMethodId] = useState<string | null>(null);
  const [reference, setReference] = useState('');
  const [receiptFile, setReceiptFile] = useState<File | null>(null);

  const digitalMethods = useMemo(() => (methods ?? []).filter((m) => m.type !== 'CASH'), [methods]);
  const selected = digitalMethods.find((m) => m.id === methodId) ?? null;
  const selectedAddress = addresses?.find((a) => a.id === addressId) ?? null;
  const deliveryFeeMinor = business?.deliveryFeeMinor ?? null;
  const deliveryAvailable = business?.deliveryEnabled !== false;
  const checkoutTotalMinor = cart ? cartSubtotal(cart) + (fulfillment === 'DELIVERY' ? deliveryFeeMinor ?? 0 : 0) : 0;

  // Keep checkout synchronized with product-page quantity changes. Clone the
  // snapshot because the small local cart store mutates its object in place;
  // setting the same object reference would not trigger a React render.
  useEffect(() => {
    const unsubscribe = onCartChange(() => {
      const next = getCart();
      setCart(next ? { ...next, items: next.items.map((item) => ({ ...item })) } : null);
    });
    return unsubscribe;
  }, []);

  // Phase 17: load the address book once for the delivery selector.
  useEffect(() => {
    let alive = true;
    if (!getSession()) return;
    listAddresses()
      .then((list) => {
        if (!alive) return;
        setAddresses(list);
        setAddressId((list.find((a) => a.isDefault) ?? list[0])?.id ?? null);
      })
      .catch(() => {
        if (alive) setAddresses([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Load public business detail for delivery capability/fee and the
  // business payment channels together.
  useEffect(() => {
    let alive = true;
    if (!cart) return;
    setBusinessLoading(true);
    setBusiness(null);
    setMethods(null);
    setMethodsError(false);
    Promise.allSettled([
      getBusiness(cart.businessId),
      listBusinessPayInMethods(cart.businessId),
    ])
      .then(([detailResult, methodsResult]) => {
        if (!alive) return;
        if (detailResult.status === 'fulfilled') setBusiness(detailResult.value);
        if (methodsResult.status === 'fulfilled') {
          setMethods(methodsResult.value);
        } else {
          setMethodsError(true);
        }
      })
      .finally(() => {
        if (alive) setBusinessLoading(false);
      });
    return () => {
      alive = false;
    };
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
        ...(fulfillment === 'DELIVERY' && addressId ? { deliveryAddressId: addressId } : {}),
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
        subtotalMinor: order.subtotalMinor,
        // Server-authoritative fee, when the order carried one (delivery).
        ...(order.deliveryFeeMinor !== undefined ? { deliveryFeeMinor: order.deliveryFeeMinor } : {}),
        totalMinor: order.totalMinor ?? order.subtotalMinor,
      });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'INVALID_PRODUCTS')
        setError('One or more items are no longer available. Remove them and try again.');
      else if (e instanceof ApiError && e.code === 'DELIVERY_UNAVAILABLE')
        setError('This business does not offer delivery. Choose pickup instead.');
      else if (e instanceof ApiError && e.code === 'COD_UNAVAILABLE')
        setError('Cash on delivery is not available here: choose a payment method or pickup.');
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
        {/* Server-authoritative price breakdown for the placed order. */}
        {placed.deliveryFeeMinor !== undefined ? (
          <section className="checkout-step" aria-label="Order total">
            <div className="cart-summary">
              <div className="cart-line">
                <span className="type-meta">Item subtotal</span>
                <span className="type-price">
                  <Money minor={placed.subtotalMinor} currency="PKR" />
                </span>
              </div>
              <div className="cart-line">
                <span className="type-meta">Delivery fee</span>
                <span className="type-price">
                  <Money minor={placed.deliveryFeeMinor} currency="PKR" />
                </span>
              </div>
              <div className="cart-line cart-total">
                <span className="type-section">Total</span>
                <span className="type-price">
                  <Money minor={placed.totalMinor} currency="PKR" />
                </span>
              </div>
            </div>
          </section>
        ) : null}
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

      <section className="cart-panel cart-items-panel" aria-label="Items">
        <div className="cart-panel-head">
          <div>
            <span className="cart-kicker">YOUR ORDER</span>
            <h2>Your items</h2>
          </div>
          <span className="cart-item-count">{cart.items.reduce((sum, item) => sum + item.quantity, 0)} items</span>
        </div>
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
      </section>

      {/* Fulfillment: pickup or delivery (fee comes from business settings). */}
      <section className="cart-panel" aria-label="Receiving">
        <div className="cart-panel-head">
          <div>
            <span className="cart-kicker">HOW YOU'LL RECEIVE IT</span>
            <h2>Receiving</h2>
          </div>
        </div>
        <div className="pay-methods" role="radiogroup" aria-label="Receiving option">
          {(['PICKUP', ...(deliveryAvailable ? (['DELIVERY'] as const) : [])] as const).map((kind) => (
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
        {fulfillment === 'DELIVERY' ? (
          <div className="cart-address-box">
            <div className="cart-address-copy">
              <span className="cart-field-label">Delivery address</span>
              {addresses === null ? (
                <strong>Loading addresses…</strong>
              ) : selectedAddress ? (
                <>
                  <strong>{selectedAddress.label}</strong>
                  <span>{selectedAddress.addressText}</span>
                </>
              ) : (
                <>
                  <strong>No address</strong>
                  <span>Add a delivery address before placing this order.</span>
                </>
              )}
            </div>
            <Button sm variant="secondary" onClick={props.onAddAddress}>
              {selectedAddress ? 'Change' : 'Add address'}
            </Button>
          </div>
        ) : null}
        {fulfillment === 'DELIVERY' && addresses && addresses.length > 1 ? (
          <div className="cart-address-options" role="radiogroup" aria-label="Saved delivery addresses">
            {addresses.map((a) => (
              <button
                key={a.id}
                type="button"
                role="radio"
                aria-checked={addressId === a.id}
                className={`cart-address-option${addressId === a.id ? ' is-selected' : ''}`}
                onClick={() => setAddressId(a.id)}
              >
                <span>{a.label}</span>
                {a.isDefault ? <small>Default</small> : null}
              </button>
            ))}
          </div>
        ) : null}
        {fulfillment === 'DELIVERY' && businessLoading ? <p className="hint">Checking delivery fee…</p> : null}
        {fulfillment === 'DELIVERY' && !businessLoading && deliveryFeeMinor === null ? (
          <p className="addr-hint">Delivery fee is currently unavailable. Please try again in a moment.</p>
        ) : null}
      </section>

      {/* Payment method: cash flows need nothing; digital needs proof. */}
      {digitalMethods.length > 0 ? (
        <section className="cart-panel" aria-label="Payment method">
          <div className="cart-panel-head">
            <div>
              <span className="cart-kicker">PAYMENT</span>
              <h2>Payment</h2>
            </div>
          </div>
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
          {methodsError ? 'Payment options could not be loaded: you will pay cash.' : 'You will pay cash when you receive the order.'}
        </p>
      )}

      <section className="cart-panel cart-summary-panel" aria-label="Order summary">
        <div className="cart-panel-head">
          <div>
            <span className="cart-kicker">SUMMARY</span>
            <h2>Order total</h2>
          </div>
        </div>
        <div className="cart-price-list">
          <div className="cart-line"><span>Items</span><Money minor={cartSubtotal(cart)} currency="PKR" /></div>
          {fulfillment === 'DELIVERY' ? (
            <div className="cart-line">
              <span>Delivery</span>
              <span>{deliveryFeeMinor !== null ? <Money minor={deliveryFeeMinor} currency="PKR" /> : '—'}</span>
            </div>
          ) : null}
          <div className="cart-line cart-total">
            <span>Total</span>
            <Money minor={checkoutTotalMinor} currency="PKR" />
          </div>
        </div>
        <Button
          full
          className="btn-ember"
          onClick={place}
          disabled={
            busy ||
            (fulfillment === 'DELIVERY' && (!addressId || deliveryFeeMinor === null || businessLoading)) ||
            (!!selected && (!reference.trim() || !receiptFile))
          }
        >
          {busy ? 'Placing order…' : selected ? 'Submit order + payment proof' : 'Place order'}
        </Button>
        <button type="button" className="cart-clear-link" onClick={clearCart} disabled={busy}>Clear cart</button>
      </section>
    </div>
  );
}
