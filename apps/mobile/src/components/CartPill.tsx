import { useEffect, useState } from 'react';
import { cartSubtotal, onCartChange } from '../cart.js';
import { useCartCount } from '../useCartCount.js';
import { Money } from './ui.js';
import './CartPill.css';

function BagGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
    >
      <path d="M5.5 8h13l-1 12.5h-11z" />
      <path d="M9 10.5V6.8a3 3 0 0 1 6 0v3.7" />
    </svg>
  );
}

/**
 * Floating cart summary pill (Phase 2E). Renders only while the cart holds
 * items — returns null when the count is 0. Export only; the app root mounts
 * it (customer tab surfaces only — never on the cart, checkout, or
 * business-mode screens).
 */
export function CartPill(props: { onViewCart: () => void }) {
  const count = useCartCount();
  const [subtotal, setSubtotal] = useState(() => cartSubtotal());
  useEffect(() => onCartChange(() => setSubtotal(cartSubtotal())), []);

  if (count === 0) return null;

  return (
    <button
      type="button"
      className="cart-pill"
      onClick={props.onViewCart}
      aria-label={`View cart: ${count} ${count === 1 ? 'item' : 'items'}`}
    >
      <span className="cart-pill-icon" aria-hidden>
        <BagGlyph />
      </span>
      <span className="cart-pill-text">
        <span className="cart-pill-count">
          {count} {count === 1 ? 'item' : 'items'}
        </span>
        <span className="cart-pill-sep" aria-hidden>
          ·
        </span>
        <span className="cart-pill-subtotal">
          <Money minor={subtotal} currency="PKR" />
        </span>
      </span>
      <span className="cart-pill-action">View cart</span>
    </button>
  );
}
