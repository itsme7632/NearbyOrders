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
});

/** Tomorrow's date (YYYY-MM-DD) in business-local PKT (UTC+5, no DST). */
function tomorrowPkt(): string {
  return new Date(Date.now() + 5 * 60 * 60 * 1000 + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
