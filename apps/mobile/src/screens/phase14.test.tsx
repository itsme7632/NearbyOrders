/**
 * Phase 14 UI/UX hardening: P0 + P1 regression tests.
 *
 * Covers the approved findings without touching backend, auth, FCM, or the
 * order/payment truth table.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import * as fs from 'node:fs';
import * as path from 'node:path';

const SCREENS = path.resolve(__dirname);
const SRC = path.resolve(SCREENS, '..');
const ROOT = path.resolve(SRC, '..');
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const readScreen = (rel: string) => fs.readFileSync(path.join(SCREENS, rel), 'utf8');

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ */
/* P1: structural source contracts                                      */
/* ------------------------------------------------------------------ */

describe('P1 structural contracts', () => {
  it('no window.confirm remains in app source', () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (/\.(tsx?|jsx?)$/.test(entry.name) && !/\.test\./.test(entry.name)) {
          const content = fs.readFileSync(full, 'utf8');
          if (content.includes('window.confirm')) hits.push(path.relative(ROOT, full));
        }
      }
    };
    walk(SRC);
    expect(hits).toEqual([]);
  });

  it('Toggle is consolidated: only primitives exports it', () => {
    const ui = read('components/ui.tsx');
    const primitives = read('components/primitives.tsx');
    expect(ui).not.toMatch(/export (function|const) Toggle/);
    expect(primitives).toMatch(/export function Toggle/);
  });

  it('OwnerDashboardScreen is fully removed', () => {
    expect(fs.existsSync(path.join(SRC, 'screens/OwnerDashboard.tsx'))).toBe(false);
    const main = read('main.tsx');
    expect(main).not.toMatch(/from '.\/screens\/OwnerDashboard/);
    expect(main).not.toMatch(/<OwnerDashboardScreen/);
  });

  it('.btn has a single base definition', () => {
    const css = fs.readFileSync(path.join(SRC, 'styles.css'), 'utf8');
    const matches = css.match(/^\.btn \{/gm) ?? [];
    expect(matches.length).toBe(1);
  });

  it('no #EF4444 / rgb(239,68,68) remains in styles', () => {
    const css = fs.readFileSync(path.join(SRC, 'styles.css'), 'utf8');
    expect(css).not.toMatch(/#EF4444/i);
    expect(css).not.toMatch(/239,\s*68,\s*68/);
  });

  it('me-band uses flat slate, no gradient', () => {
    const css = fs.readFileSync(path.join(SRC, 'styles.css'), 'utf8');
    const block = css.match(/\.me-band \{[^}]*\}/)?.[0] ?? '';
    expect(block).not.toMatch(/linear-gradient/);
    expect(block).toMatch(/var\(--brand\)/);
  });

  it('pay-pending uses amber warning tokens, not blue', () => {
    const css = fs.readFileSync(path.join(SRC, 'styles.css'), 'utf8');
    const block = css.match(/\.pay-pending \{[^}]*\}/)?.[0] ?? '';
    expect(block).toMatch(/var\(--warning/);
    expect(block).not.toMatch(/37,\s*99,\s*235/);
  });

  it('promotion lifecycle badges follow status semantics', () => {
    const src = readScreen('OwnerPromotionsScreen.tsx');
    // PAYMENT_REQUIRED must not be green (badge-open).
    expect(src).toMatch(/PAYMENT_REQUIRED:\s*'badge-warn'/);
    expect(src).not.toMatch(/PAYMENT_REQUIRED:\s*'badge-open'/);
  });

  it('review notification derives mode from the user role, not the payload', () => {
    const src = read('main.tsx');
    // The Review branch must consult the authorized role before switching mode.
    const idx = src.indexOf("entityType === 'Review'");
    expect(idx).toBeGreaterThan(-1);
    const reviewBranch = src.slice(idx, idx + 400);
    expect(reviewBranch).toMatch(/isOwner/);
    // No unconditional business-mode switch directly on the Review entity type.
    expect(reviewBranch).not.toMatch(/entityType === 'Review'\) \{\s*setAppMode\('BUSINESS'\)/);
  });
});

/* ------------------------------------------------------------------ */
/* P0-1: service delete requires confirmation                           */
/* ------------------------------------------------------------------ */

describe('P0-1 service delete confirmation', () => {
  it('requires an explicit second step before deleting', async () => {
    const api = await import('../api.js');
    const { OwnerServices } = await import('./OwnerCatalog.js');
    vi.spyOn(api, 'listOwnerServices').mockResolvedValue([
      {
        id: 'svc-1',
        name: 'Haircut',
        description: null,
        priceMinor: 50000,
        durationMinutes: 30,
        isActive: true,
        advanceType: 'NONE',
        advanceAmountMinor: null,
        advancePercent: null,
      } as never,
    ]);
    const deleteSpy = vi.spyOn(api, 'deleteService').mockResolvedValue(undefined);

    render(<OwnerServices businessId="biz-1" />);
    const deleteBtn = await screen.findByRole('button', { name: 'Delete' });
    fireEvent.click(deleteBtn);

    // First click only arms the confirmation; nothing is deleted yet.
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(screen.getByText('Delete this service?')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Yes, delete' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Keep' })).toBeTruthy();

    // "Keep" cancels without deleting.
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(screen.queryByText('Delete this service?')).toBeNull();

    // Confirming deletes exactly once.
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete' }));
    await waitFor(() => expect(deleteSpy).toHaveBeenCalledTimes(1));
    expect(deleteSpy).toHaveBeenCalledWith('svc-1');
  });
});

/* ------------------------------------------------------------------ */
/* P0-2: payment fetch error renders a visible error, never null        */
/* ------------------------------------------------------------------ */

describe('P0-2 owner payment error state', () => {
  it('renders an error with retry instead of vanishing', async () => {
    const api = await import('../api.js');
    const { OrderPaymentBlock } = await import('./OwnerOrders.js');
    vi.spyOn(api, 'listOrderPayments').mockRejectedValue(new Error('network down'));
    vi.spyOn(api, 'listOwnerPayInMethods').mockResolvedValue([]);

    const order = {
      id: 'order-1',
      businessId: 'biz-1',
      business: { id: 'biz-1' },
      paymentMethodId: 'pm-1',
      status: 'PENDING',
    };
    render(<OrderPaymentBlock order={order as never} onChanged={() => {}} />);
    const message = await screen.findByText(/could not be loaded/i);
    expect(message).toBeTruthy();
    // Retry is offered.
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
  });

  it('treats a business-method fetch failure as a payment error, never as method removal', async () => {
    const api = await import('../api.js');
    const { OrderPaymentBlock } = await import('./OwnerOrders.js');
    vi.spyOn(api, 'listOrderPayments').mockResolvedValue([]);
    const methodsSpy = vi.spyOn(api, 'listOwnerPayInMethods').mockRejectedValue(new Error('network down'));

    const order = {
      id: 'order-1',
      businessId: 'biz-1',
      business: { id: 'biz-1' },
      paymentMethodId: 'pm-1',
      status: 'PENDING',
    };
    render(<OrderPaymentBlock order={order as never} onChanged={() => {}} />);
    // Visible payment-information error, not a silent null and not a
    // "method removed" misreading.
    expect(await screen.findByText(/could not be loaded/i)).toBeTruthy();
    expect(screen.queryByText(/no longer available/i)).toBeNull();

    // Retry re-issues the failed methods request.
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    await waitFor(() => expect(methodsSpy).toHaveBeenCalledTimes(2));
  });
});

/* ------------------------------------------------------------------ */
/* P0-4: booking step back navigation                                   */
/* ------------------------------------------------------------------ */

describe('P0-4 booking back navigation', () => {
  it('back from the time step returns to service selection when no service was preselected', async () => {
    const api = await import('../api.js');
    const { BookServiceScreen } = await import('./BookService.js');
    vi.spyOn(api, 'getBusiness').mockResolvedValue({
      id: 'biz-1',
      name: 'Test Business',
      services: [
        { id: 'svc-1', name: 'Haircut', priceMinor: 50000, durationMinutes: 30, isActive: true },
      ],
    } as never);
    vi.spyOn(api, 'getMultiServiceAvailability').mockResolvedValue({ slots: [] } as never);

    render(<BookServiceScreen businessId="biz-1" onBack={() => {}} onDone={() => {}} />);
    // Pick a service and continue to reach the time step.
    const serviceBtn = await screen.findByRole('button', { name: /haircut/i });
    fireEvent.click(serviceBtn);
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    // Wait for the time step (back button reads "Back to services").
    // Back from the time step returns to service selection, not out of the flow.
    const backBtn = await screen.findByRole('button', { name: /back to services/i });
    fireEvent.click(backBtn);
    expect(await screen.findByRole('button', { name: /haircut/i })).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ */
/* P1-8: all categories reachable                                       */
/* ------------------------------------------------------------------ */

describe('P1-8 category discovery', () => {
  it('renders every category, not just the first eight', async () => {
    const api = await import('../api.js');
    const { ExploreScreen } = await import('./Explore.js');
    const categories = Array.from({ length: 12 }, (_, i) => ({
      id: `cat-${i}`,
      name: `Category ${i}`,
      slug: `cat-${i}`,
    }));
    vi.spyOn(api, 'listCategories').mockResolvedValue(categories as never);
    vi.spyOn(api, 'listBusinesses').mockResolvedValue([]);

    render(<ExploreScreen onOpenBusiness={() => {}} />);
    for (const c of categories) {
      expect(await screen.findByRole('button', { name: c.name })).toBeTruthy();
    }
  });
});

/* ------------------------------------------------------------------ */
/* P1-15: booking card inline Accept/Reject                             */
/* ------------------------------------------------------------------ */

describe('P1-15 booking card actions', () => {
  const baseBooking = {
    id: 'booking-1',
    status: 'PENDING',
    bookingDate: '2026-10-10',
    startTime: '10:00',
    endTime: '11:00',
    serviceName: 'Haircut',
    priceMinor: 50000,
    currency: 'PKR',
    customer: { name: 'Test Customer', email: 'test@example.com' },
    businessName: 'Test Business',
  };

  it('shows inline Accept/Reject on pending cards and confirms before rejecting', async () => {
    const api = await import('../api.js');
    const { BookingGroup } = await import('./OwnerBookings.js');
    const statusSpy = vi.spyOn(api, 'setBookingStatus').mockResolvedValue({ ...baseBooking, status: 'CONFIRMED' } as never);
    const onChanged = vi.fn();

    render(
      <BookingGroup label="Incoming" bookings={[baseBooking as never]} onOpenBooking={() => {}} onChanged={onChanged} />,
    );
    expect(screen.getByRole('button', { name: 'Accept' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeTruthy();

    // Reject requires an explicit inline confirmation; nothing fires on first click.
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(statusSpy).not.toHaveBeenCalled();
    expect(screen.getByText(/reject this booking/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Yes, reject' }));
    await waitFor(() => expect(statusSpy).toHaveBeenCalledWith('booking-1', 'REJECTED'));
    expect(onChanged).toHaveBeenCalled();
  });

  it('accepts directly and refreshes the card', async () => {
    const api = await import('../api.js');
    const { BookingGroup } = await import('./OwnerBookings.js');
    const statusSpy = vi.spyOn(api, 'setBookingStatus').mockResolvedValue({ ...baseBooking, status: 'CONFIRMED' } as never);
    const onChanged = vi.fn();

    render(
      <BookingGroup label="Incoming" bookings={[baseBooking as never]} onOpenBooking={() => {}} onChanged={onChanged} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(statusSpy).toHaveBeenCalledWith('booking-1', 'CONFIRMED'));
    expect(onChanged).toHaveBeenCalled();
  });

  it('shows no actions on non-pending bookings', async () => {
    const { BookingGroup } = await import('./OwnerBookings.js');
    render(
      <BookingGroup
        label="Upcoming"
        bookings={[{ ...baseBooking, status: 'CONFIRMED' } as never]}
        onOpenBooking={() => {}}
        onChanged={() => {}}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reject' })).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* P1-5: inline confirmations replaced window.confirm                   */
/* ------------------------------------------------------------------ */

describe('P1-5 inline confirmations', () => {
  it('promotion request cancel uses the two-step inline pattern', async () => {
    const api = await import('../api.js');
    const { OwnerPromotions } = await import('./OwnerPromotionsScreen.js');
    vi.spyOn(api, 'listPromotions').mockResolvedValue([]);
    vi.spyOn(api, 'listPromotionRequests').mockResolvedValue([
      { id: 'req-1', promotionName: 'Boost', lifecycleState: 'PENDING_REVIEW' },
    ] as never);
    const cancelSpy = vi.spyOn(api, 'cancelPromotionRequest').mockResolvedValue({ id: 'req-1' } as never);

    render(<OwnerPromotions businessId="biz-1" />);
    // Switch to the requests tab where the cancel button lives.
    const requestsTab = await screen.findByRole('radio', { name: /my requests/i });
    fireEvent.click(requestsTab);
    const cancelBtn = await screen.findByRole('button', { name: 'Cancel request' });
    fireEvent.click(cancelBtn);
    expect(cancelSpy).not.toHaveBeenCalled();
    expect(screen.getByText(/cancel your request/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Yes, cancel' }));
    await waitFor(() => expect(cancelSpy).toHaveBeenCalled());
  });
});

/* ------------------------------------------------------------------ */
/* P0-3: rejected proof when the original method was removed            */
/* ------------------------------------------------------------------ */

describe('P0-3 rejected proof with removed method', () => {
  it('explains the removal and offers an explicit replacement choice', async () => {
    const api = await import('../api.js');
    const { OrderPaymentPanel } = await import('./Orders.js');
    // The order's frozen method (pm-old) is gone from the business list.
    vi.spyOn(api, 'listOrderPayments').mockResolvedValue([
      {
        id: 'pay-1',
        amountMinor: 50000,
        currency: 'PKR',
        status: 'FAILED',
        rejectionReason: 'Blurry receipt',
        submittedAt: new Date().toISOString(),
        paymentMethod: { id: 'pm-old', displayName: 'Old Easypaisa' },
      },
    ] as never);
    vi.spyOn(api, 'listBusinessPayInMethods').mockResolvedValue([
      { id: 'pm-new', displayName: 'New JazzCash', instructions: 'Pay here', accountTitle: null, accountNumber: null, iban: null },
    ] as never);

    const order = {
      id: 'order-1',
      business: { id: 'biz-1' },
      paymentMethodId: 'pm-old',
      status: 'PENDING',
      fulfillmentType: 'DELIVERY',
      totalMinor: 50000,
      subtotalMinor: 50000,
      currency: 'PKR',
    };
    render(<OrderPaymentPanel order={order as never} onChanged={() => {}} />);

    // The frozen method name is preserved and the removal is explained.
    expect(await screen.findByText(/no longer available/i)).toBeTruthy();
    // An explicit replacement picker is offered; nothing is auto-substituted.
    const select = await screen.findByRole('combobox');
    expect(select).toBeTruthy();
    // The frozen paymentMethodId is not rewritten by the client.
    expect(order.paymentMethodId).toBe('pm-old');
  });
});

/* ------------------------------------------------------------------ */
/* P1-7: cart shows the delivery address text                           */
/* ------------------------------------------------------------------ */

describe('P1-7 cart delivery address', () => {
  it('renders the selected address text for delivery orders', async () => {
    const api = await import('../api.js');
    const cartMod = await import('../cart.js');
    const { CartScreen } = await import('./Cart.js');
    vi.spyOn(api, 'getSession').mockReturnValue({ user: { id: 'user-1' }, tokens: {} } as never);
    vi.spyOn(api, 'listAddresses').mockResolvedValue([
      { id: 'addr-1', label: 'Home', addressText: 'House 12, Street 4, Gulberg, Lahore', isDefault: true },
    ] as never);
    vi.spyOn(cartMod, 'getCart').mockReturnValue({
      businessId: 'biz-1',
      items: [{ productId: 'prod-1', name: 'Biryani', priceMinor: 50000, quantity: 1, image: null }],
    } as never);
    vi.spyOn(api, 'getBusiness').mockResolvedValue({
      id: 'biz-1',
      name: 'Test Business',
      deliveryEnabled: true,
    } as never);

    render(<CartScreen onBack={() => {}} onBrowse={() => {}} onAddAddress={() => {}} onPlaced={() => {}} />);
    // Switch to delivery to reveal the address box.
    const deliveryBtn = await screen.findByRole('radio', { name: /delivery/i });
    fireEvent.click(deliveryBtn);
    // The full address text is visible, not just the label.
    expect(await screen.findByText(/House 12, Street 4, Gulberg, Lahore/)).toBeTruthy();
  });
});
