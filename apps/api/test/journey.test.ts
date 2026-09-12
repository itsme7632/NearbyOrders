/**
 * Phase 3C.5 end-to-end journey (API-backed):
 * owner onboards (auto-approved) → saves profile → adds a service → sets
 * hours → appears in discovery → customer books → owner confirms and
 * completes → customer sees the final status.
 *
 * This file runs in its own vitest fork, so enabling the dev flag here cannot
 * leak into the other suites (which assert the PENDING default).
 */
process.env.AUTO_APPROVE_BUSINESSES = 'true';

import { describe, expect, it } from 'vitest';
import { prisma } from '../src/lib.js';
import { authed, makeApp, registerAndLogin } from './helpers.js';

const app = await makeApp();

// All seven days open: the journey books "tomorrow" (PKT), which is a
// different weekday depending on when CI runs — a closed Sunday here made
// this suite a date time-bomb. Closed-day behavior is covered in
// bookings.test.ts, which controls its own hours explicitly.
const HOUR_ENTRIES = Array.from({ length: 7 }, (_, day) => ({
  dayOfWeek: day,
  isClosed: false,
  opensAt: '10:00',
  closesAt: '20:00',
}));

describe('onboarding → discovery → booking journey (auto-approved dev flow)', () => {
  it('runs the complete product flow end to end', async () => {
    const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const customer = await registerAndLogin(app, 'CUSTOMER');

    /* 1. Owner onboards a business — auto-approved, immediately in discovery. */
    const categoriesRes = await app.inject({ method: 'GET', url: '/api/v1/categories' });
    const categories = JSON.parse(categoriesRes.body).data as { id: string; isActive: boolean }[];
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/businesses',
      headers: authed(owner.token),
      payload: {
        name: `Journey Kitchen ${Date.now()}`,
        description: 'Journey test kitchen',
        address: '5 Boulevard Road',
        city: 'Lahore',
        categoryIds: [categories[0]!.id],
      },
    });
    expect(created.statusCode).toBe(201);
    const business = JSON.parse(created.body).data as { id: string; slug: string; status: string };
    expect(business.status).toBe('APPROVED');
    expect(await prisma.business.findUniqueOrThrow({ where: { id: business.id } })).toMatchObject({
      ownerId: owner.userId,
      status: 'APPROVED',
    });

    /* 2. Save profile (the previously broken Save-profile contract). */
    const saved = await app.inject({
      method: 'PATCH',
      url: `/api/v1/businesses/${business.id}`,
      headers: authed(owner.token),
      payload: {
        name: 'Journey Kitchen',
        description: 'Updated by owner',
        phone: '+92 300 7654321',
        email: '',
        locality: '',
        imageUrl: '',
        address: '5 Boulevard Road, Gulberg',
        city: 'Lahore',
      },
    });
    expect(saved.statusCode).toBe(200);
    const savedBody = JSON.parse(saved.body).data as { phone: string | null; email: string | null; categories: unknown[] };
    expect(savedBody.phone).toBe('+92 300 7654321');
    expect(savedBody.email).toBeNull();
    expect(savedBody.categories[0]).toHaveProperty('id');

    /* 3. Add a bookable service. */
    const serviceRes = await app.inject({
      method: 'POST',
      url: `/api/v1/businesses/${business.id}/services`,
      headers: authed(owner.token),
      payload: { name: 'Chef Consultation', priceMinor: 150000, durationMinutes: 30 },
    });
    expect(serviceRes.statusCode).toBe(201);
    const service = JSON.parse(serviceRes.body).data as { id: string; isActive: boolean };
    expect(service.isActive).toBe(true);

    /* 4. Configure opening hours (replacement endpoint). */
    const hoursRes = await app.inject({
      method: 'PUT',
      url: `/api/v1/businesses/${business.id}/hours`,
      headers: authed(owner.token),
      payload: HOUR_ENTRIES,
    });
    expect(hoursRes.statusCode).toBe(200);

    /* 5. Business appears in customer discovery. */
    const discovery = await app.inject({ method: 'GET', url: '/api/v1/businesses?q=Journey%20Kitchen' });
    expect(discovery.statusCode).toBe(200);
    expect(JSON.parse(discovery.body).data.map((b: { id: string }) => b.id)).toContain(business.id);
    const detail = await app.inject({ method: 'GET', url: `/api/v1/businesses/${business.slug}` });
    expect(detail.statusCode).toBe(200);
    const detailBody = JSON.parse(detail.body).data as { services: { id: string }[]; hours: unknown[] };
    expect(detailBody.services.map((s) => s.id)).toContain(service.id);
    expect(detailBody.hours).toHaveLength(7);

    /* 6–9. Customer finds the business, books the service. */
    const availability = await app.inject({
      method: 'GET',
      url: `/api/v1/businesses/${business.id}/services/${service.id}/availability?date=${tomorrowPkt()}`,
    });
    expect(availability.statusCode).toBe(200);
    const availabilityBody = JSON.parse(availability.body).data as { closed: boolean; slots: { start: string; available: boolean }[] };
    expect(availabilityBody.closed).toBe(false);
    const slots = availabilityBody.slots.filter((s) => s.available);
    expect(slots.length).toBeGreaterThan(0);

    const bookingRes = await app.inject({
      method: 'POST',
      url: '/api/v1/bookings',
      headers: authed(customer.token),
      payload: {
        businessId: business.id,
        serviceId: service.id,
        date: tomorrowPkt(),
        startTime: slots[0]!.start,
      },
    });
    expect(bookingRes.statusCode).toBe(201);
    const booking = JSON.parse(bookingRes.body).data as { id: string; status: string };
    expect(booking.status).toBe('PENDING');

    /* 10–11. Owner sees the booking and confirms it. */
    const ownerList = await app.inject({
      method: 'GET',
      url: `/api/v1/businesses/${business.id}/bookings`,
      headers: authed(owner.token),
    });
    expect(ownerList.statusCode).toBe(200);
    const listed = JSON.parse(ownerList.body).data as { id: string; customer: { email: string } }[];
    const seen = listed.find((b) => b.id === booking.id);
    const customerRow = await prisma.user.findUniqueOrThrow({ where: { id: customer.userId } });
    expect(seen?.customer.email).toBe(customerRow.email);

    const confirmed = await app.inject({
      method: 'PATCH',
      url: `/api/v1/bookings/${booking.id}/status`,
      headers: authed(owner.token),
      payload: { status: 'CONFIRMED' },
    });
    expect(confirmed.statusCode).toBe(200);

    /* 12. Customer sees CONFIRMED. */
    const asCustomer = await app.inject({
      method: 'GET',
      url: `/api/v1/bookings/${booking.id}`,
      headers: authed(customer.token),
    });
    expect(JSON.parse(asCustomer.body).data.status).toBe('CONFIRMED');

    /* 13–14. Owner completes; customer sees COMPLETED. */
    const completed = await app.inject({
      method: 'PATCH',
      url: `/api/v1/bookings/${booking.id}/status`,
      headers: authed(owner.token),
      payload: { status: 'COMPLETED' },
    });
    expect(completed.statusCode).toBe(200);
    const final = await app.inject({
      method: 'GET',
      url: `/api/v1/bookings/${booking.id}`,
      headers: authed(customer.token),
    });
    expect(JSON.parse(final.body).data.status).toBe('COMPLETED');
  });

  /**
   * Phase 7C end-to-end: booking advance (manual proof → owner verification)
   * and order COD/delivery (server-computed fee, cash state) flows.
   */
  it('runs the Phase 7C payment journeys end to end', async () => {
    const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const customer = await registerAndLogin(app, 'CUSTOMER');

    const categoriesRes = await app.inject({ method: 'GET', url: '/api/v1/categories' });
    const categories = JSON.parse(categoriesRes.body).data as { id: string }[];
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/businesses',
      headers: authed(owner.token),
      payload: {
        name: `Payment Kitchen ${Date.now()}`,
        description: 'Phase 7C journey kitchen',
        address: '7 Payment Road',
        city: 'Lahore',
        categoryIds: [categories[0]!.id],
      },
    });
    expect(created.statusCode).toBe(201);
    const business = JSON.parse(created.body).data as { id: string; slug: string };

    // All seven days open: "tomorrow" must be bookable regardless of weekday.
    const hoursRes = await app.inject({
      method: 'PUT',
      url: `/api/v1/businesses/${business.id}/hours`,
      headers: authed(owner.token),
      payload: HOUR_ENTRIES,
    });
    expect(hoursRes.statusCode).toBe(200);

    /* BOOKING ADVANCE FLOW: Rs 1,000 service with Rs 200 fixed advance. */
    const serviceRes = await app.inject({
      method: 'POST',
      url: `/api/v1/businesses/${business.id}/services`,
      headers: authed(owner.token),
      payload: {
        name: 'Advance Consultation',
        priceMinor: 100000,
        durationMinutes: 30,
        advanceType: 'FIXED',
        advanceAmountMinor: 20000,
      },
    });
    expect(serviceRes.statusCode).toBe(201);
    const service = JSON.parse(serviceRes.body).data as { id: string };

    // Owner configures an Easypaisa channel customers will see.
    const methodRes = await app.inject({
      method: 'POST',
      url: `/api/v1/owner/businesses/${business.id}/payment-methods`,
      headers: authed(owner.token),
      payload: {
        type: 'EASYPAISA',
        displayName: 'Journey Easypaisa',
        accountTitle: 'Journey Kitchen',
        accountNumber: '03001112222',
        instructions: 'Send the advance, then submit the reference.',
      },
    });
    expect(methodRes.statusCode).toBe(201);
    const method = JSON.parse(methodRes.body).data as { id: string };
    // Customer sees the active channel with account details.
    const publicMethods = JSON.parse(
      (await app.inject({ method: 'GET', url: `/api/v1/businesses/${business.id}/payment-methods` })).body,
    ).data as { id: string; accountNumber: string | null }[];
    expect(publicMethods.map((m) => m.id)).toContain(method.id);
    expect(publicMethods.find((m) => m.id === method.id)?.accountNumber).toBe('03001112222');

    const availability = await app.inject({
      method: 'GET',
      url: `/api/v1/businesses/${business.id}/services/${service.id}/availability?date=${tomorrowPkt()}`,
    });
    const slots = (JSON.parse(availability.body).data as { slots: { start: string; available: boolean }[] }).slots.filter((s) => s.available);
    expect(slots.length).toBeGreaterThan(0);

    const bookingRes = await app.inject({
      method: 'POST',
      url: '/api/v1/bookings',
      headers: authed(customer.token),
      payload: { businessId: business.id, serviceId: service.id, date: tomorrowPkt(), startTime: slots[0]!.start },
    });
    expect(bookingRes.statusCode).toBe(201);
    const booking = JSON.parse(bookingRes.body).data as {
      id: string;
      servicePriceMinor: number;
      advanceRequiredMinor: number;
      amountPaidMinor: number;
      amountDueMinor: number;
    };
    // The booking snapshot freezes the agreed amounts.
    expect(booking.servicePriceMinor).toBe(100000);
    expect(booking.advanceRequiredMinor).toBe(20000);
    expect(booking.amountPaidMinor).toBe(0);
    expect(booking.amountDueMinor).toBe(80000);

    // Customer pays the advance externally and submits proof.
    const submitRes = await app.inject({
      method: 'POST',
      url: `/api/v1/bookings/${booking.id}/payments`,
      headers: authed(customer.token),
      payload: {
        amountMinor: 20000,
        paymentMethodId: method.id,
        transactionReference: `TX-JRN-${Date.now()}`,
        receiptStorageKey: 'receipts/journey-advance.png',
      },
    });
    expect(submitRes.statusCode).toBe(201);
    const payment = JSON.parse(submitRes.body).data as { id: string; status: string; amountMinor: number };
    expect(payment.status).toBe('PENDING_VERIFICATION');
    expect(payment.amountMinor).toBe(20000);

    // Owner sees it in the queue, views the receipt, then verifies.
    const queue = JSON.parse(
      (await app.inject({
        method: 'GET',
        url: '/api/v1/owner/payments?status=PENDING_VERIFICATION&kind=booking',
        headers: authed(owner.token),
      })).body,
    ).data as { bookingPayments: { id: string }[] };
    expect(queue.bookingPayments.map((p) => p.id)).toContain(payment.id);

    const verifyRes = await app.inject({
      method: 'POST',
      url: `/api/v1/owner/payments/${payment.id}/verify`,
      headers: authed(owner.token),
    });
    expect(verifyRes.statusCode).toBe(200);
    expect(JSON.parse(verifyRes.body).data.status).toBe('PAID');

    // Booking financial state reflects the verified advance.
    const after = JSON.parse(
      (await app.inject({ method: 'GET', url: `/api/v1/bookings/${booking.id}`, headers: authed(customer.token) })).body,
    ).data as { amountPaidMinor: number; amountDueMinor: number };
    expect(after.amountPaidMinor).toBe(20000);
    expect(after.amountDueMinor).toBe(80000);

    // Customer got the "payment verified" notification.
    const notifications = JSON.parse(
      (await app.inject({ method: 'GET', url: '/api/v1/notifications', headers: authed(customer.token) })).body,
    ).data as { items: { type: string }[] };
    expect(notifications.items.some((n) => n.type === 'BOOKING_PAYMENT_VERIFIED')).toBe(true);

    /* ORDER FLOW: delivery fee computed server-side, COD stays UNPAID. */
    const productRes = await app.inject({
      method: 'POST',
      url: `/api/v1/businesses/${business.id}/products`,
      headers: authed(owner.token),
      payload: { name: 'Journey Biryani', priceMinor: 200000 },
    });
    expect(productRes.statusCode).toBe(201);
    const product = JSON.parse(productRes.body).data as { id: string };

    const settingsRes = await app.inject({
      method: 'PUT',
      url: `/api/v1/owner/businesses/${business.id}/delivery-settings`,
      headers: authed(owner.token),
      payload: { deliveryEnabled: true, codEnabled: true, deliveryFeeMinor: 20000 },
    });
    expect(settingsRes.statusCode).toBe(200);

    // Client-sent subtotal/fee fields are ignored by the server.
    const orderRes = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: authed(customer.token),
      payload: {
        businessId: business.id,
        items: [{ productId: product.id, quantity: 1 }],
        fulfillmentType: 'DELIVERY',
        subtotalMinor: 1,
        deliveryFeeMinor: 1,
        totalMinor: 1,
      } as Record<string, unknown>,
    });
    expect(orderRes.statusCode).toBe(201);
    const placed = JSON.parse(orderRes.body).data as {
      id: string;
      subtotalMinor: number;
      deliveryFeeMinor: number;
      totalMinor: number;
      status: string;
    };
    expect(placed.subtotalMinor).toBe(200000); // Rs 2,000
    expect(placed.deliveryFeeMinor).toBe(20000); // Rs 200 fee from settings
    expect(placed.totalMinor).toBe(220000); // Rs 2,200
    expect(placed.status).toBe('PENDING');

    // COD order starts UNPAID — never PAID merely for choosing COD.
    const orderPayments = JSON.parse(
      (await app.inject({ method: 'GET', url: `/api/v1/orders/${placed.id}/payments`, headers: authed(customer.token) })).body,
    ).data as { status: string; amountMinor: number }[];
    expect(orderPayments).toHaveLength(0); // no payment record until proof/collection

    const orderDetail = JSON.parse(
      (await app.inject({ method: 'GET', url: `/api/v1/orders/${placed.id}`, headers: authed(customer.token) })).body,
    ).data as { fulfillmentType: string; totalMinor: number };
    expect(orderDetail.fulfillmentType).toBe('DELIVERY');
    expect(orderDetail.totalMinor).toBe(220000);

    // Pickup order: no delivery fee is ever charged.
    const pickupRes = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: authed(customer.token),
      payload: {
        businessId: business.id,
        items: [{ productId: product.id, quantity: 1 }],
        fulfillmentType: 'PICKUP',
      },
    });
    expect(pickupRes.statusCode).toBe(201);
    const pickup = JSON.parse(pickupRes.body).data as { deliveryFeeMinor: number; totalMinor: number };
    expect(pickup.deliveryFeeMinor).toBe(0);
    expect(pickup.totalMinor).toBe(200000);
  });
});

/** Tomorrow's date (YYYY-MM-DD) in business-local PKT (UTC+5, no DST). */
function tomorrowPkt(): string {
  return new Date(Date.now() + 5 * 60 * 60 * 1000 + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
