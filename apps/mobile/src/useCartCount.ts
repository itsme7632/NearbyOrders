import { useEffect, useState } from 'react';
import { cartCount, onCartChange } from './cart.js';

/** Re-renders the component whenever the cart contents change. */
export function useCartCount(): number {
  const [count, setCount] = useState(() => cartCount());
  useEffect(() => onCartChange(() => setCount(cartCount())), []);
  return count;
}
