/**
 * Client-side cart — pre-order state only.
 *
 * Rules:
 * - One business per cart. Adding from another business requires an explicit
 *   clear-and-replace decision (the UI asks; `replaceAll` enforces it).
 * - Quantity is clamped to 1..MAX_QUANTITY, mirroring the server's schema.
 * - Prices shown are informational snapshots; the server always re-prices.
 * - Persisted to localStorage so the cart survives navigation and restarts.
 *   The authoritative order is created server-side at checkout.
 */

export const MAX_QUANTITY = 99;

export type CartItem = {
  productId: string;
  name: string;
  /** Informational snapshot of the product price at add time (minor units). */
  unitPriceMinor: number;
  quantity: number;
  imageUrl: string | null;
};

export type Cart = {
  businessId: string;
  businessName: string;
  items: CartItem[];
};

const STORAGE_KEY = 'nearbyorders.cart.v1';

const clampQuantity = (q: number): number => Math.min(MAX_QUANTITY, Math.max(1, Math.floor(q) || 1));

function readStored(): Cart | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Cart;
    if (!parsed || typeof parsed.businessId !== 'string' || !Array.isArray(parsed.items)) return null;
    // Defensive re-clamp: never trust stored quantities beyond server limits.
    const items = parsed.items
      .filter((i) => i && typeof i.productId === 'string' && Number.isFinite(i.unitPriceMinor))
      .map((i) => ({ ...i, quantity: clampQuantity(i.quantity) }));
    return items.length ? { ...parsed, items } : null;
  } catch {
    return null;
  }
}

function writeStored(cart: Cart | null): void {
  try {
    if (!cart || cart.items.length === 0) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cart));
  } catch {
    // Storage unavailable (private mode etc.) — cart simply won't persist.
  }
}

let cart: Cart | null = readStored();
const listeners = new Set<() => void>();

const emit = () => {
  writeStored(cart);
  for (const listener of listeners) listener();
};

/** Subscribes to cart changes; returns an unsubscribe function. */
export function onCartChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getCart(): Cart | null {
  return cart;
}

export function cartCount(): number {
  return cart?.items.reduce((sum, i) => sum + i.quantity, 0) ?? 0;
}

/** Pure integer line/subtotal totals in minor units. */
export function lineTotal(item: CartItem): number {
  return item.unitPriceMinor * item.quantity;
}

export function cartSubtotal(c: Cart | null = cart): number {
  return c?.items.reduce((sum, i) => sum + lineTotal(i), 0) ?? 0;
}

export type AddResult = { added: true } | { added: false; reason: 'different-business' };

/**
 * Adds a product to the cart. Fails (without mutating) when the cart holds
 * items from a different business — the caller should ask the user whether to
 * clear the cart, then call `replaceAll`.
 */
export function addToCart(input: {
  businessId: string;
  businessName: string;
  product: { id: string; name: string; priceMinor: number; imageUrl: string | null };
  quantity?: number;
}): AddResult {
  if (cart && cart.businessId !== input.businessId) return { added: false, reason: 'different-business' };
  if (!cart) cart = { businessId: input.businessId, businessName: input.businessName, items: [] };
  const existing = cart.items.find((i) => i.productId === input.product.id);
  if (existing) {
    existing.quantity = clampQuantity(existing.quantity + (input.quantity ?? 1));
  } else {
    cart.items.push({
      productId: input.product.id,
      name: input.product.name,
      unitPriceMinor: input.product.priceMinor,
      quantity: clampQuantity(input.quantity ?? 1),
      imageUrl: input.product.imageUrl,
    });
  }
  emit();
  return { added: true };
}

/** Hard-replaces the cart with a fresh single-item cart (cross-business flow). */
export function replaceWith(input: {
  businessId: string;
  businessName: string;
  product: { id: string; name: string; priceMinor: number; imageUrl: string | null };
}): void {
  cart = {
    businessId: input.businessId,
    businessName: input.businessName,
    items: [
      {
        productId: input.product.id,
        name: input.product.name,
        unitPriceMinor: input.product.priceMinor,
        quantity: 1,
        imageUrl: input.product.imageUrl,
      },
    ],
  };
  emit();
}

/** Sets the quantity of an item; quantity < 1 removes the item. */
export function setQuantity(productId: string, quantity: number): void {
  if (!cart) return;
  const next = quantity < 1 ? 0 : clampQuantity(quantity);
  cart.items = cart.items.filter((i) => i.productId !== productId || next > 0);
  const item = cart.items.find((i) => i.productId === productId);
  if (item) item.quantity = next;
  if (cart.items.length === 0) cart = null;
  emit();
}

export function removeFromCart(productId: string): void {
  if (!cart) return;
  cart.items = cart.items.filter((i) => i.productId !== productId);
  if (cart.items.length === 0) cart = null;
  emit();
}

export function clearCart(): void {
  cart = null;
  emit();
}
