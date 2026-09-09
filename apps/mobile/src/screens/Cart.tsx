import { useState } from 'react';
import { createOrder, ApiError } from '../api.js';
import { Button, EmptyState, ErrorState, Money } from '../components/ui.js';
import { OrdersIcon, CheckIcon } from '../components/icons.js';
import { cartSubtotal, clearCart, getCart, lineTotal, onCartChange, removeFromCart, setQuantity, type Cart } from '../cart.js';

/**
 * Cart + checkout review. The cart itself lives in cart.ts; this screen edits
 * it, reviews the order, and posts it — the server re-prices authoritatively.
 */
export function CartScreen(props: { onBack: () => void; onBrowse: () => void; onPlaced: (orderId: string) => void }) {
  const [cart, setCart] = useState<Cart | null>(getCart());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<{ id: string; businessName: string; totalMinor: number } | null>(null);

  // Keep in sync with cart mutations triggered elsewhere (e.g. removed elsewhere).
  const sync = () => setCart(getCart());
  onCartChange(sync);
  // Re-subscribe on every render keeps this simple and correct for this scale.

  const place = async () => {
    if (!cart || busy) return;
    setBusy(true);
    setError(null);
    try {
      const order = await createOrder({
        businessId: cart.businessId,
        items: cart.items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
      });
      clearCart();
      setPlaced({ id: order.id, businessName: order.business.name, totalMinor: order.subtotalMinor });
    } catch (e) {
      setError(
        e instanceof ApiError && e.code === 'INVALID_PRODUCTS'
          ? 'One or more items are no longer available. Remove them and try again.'
          : e instanceof Error
            ? e.message
            : 'Could not place the order',
      );
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
          title="Order placed!"
          body={`${placed.businessName} has received your order of Rs ${Math.round(placed.totalMinor / 100)}. Track it under Orders.`}
          action={
            <Button onClick={() => props.onPlaced(placed.id)}>View my orders</Button>
          }
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
            <span>Total</span>
            <Money minor={cartSubtotal(cart)} currency="PKR" />
          </div>
        </div>
      </section>

      <p className="hint">Pay when you collect — online payment comes later.</p>
      <Button full onClick={place} disabled={busy}>
        {busy ? 'Placing order…' : 'Place order'}
      </Button>
      <div className="btn-row" style={{ marginTop: 8 }}>
        <Button full variant="ghost" onClick={clearCart} disabled={busy}>
          Clear cart
        </Button>
      </div>
    </div>
  );
}
