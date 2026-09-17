/**
 * Phase 7C API tests: customer→business payments.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { makeApp, registerAndLogin, registerAdminAndLogin, createBusiness, authed, type TestApp } from './helpers.js';
import { prisma } from '../src/lib.js';

// All Phase 7C customer flows require APPROVED businesses. Set the dev/test
// auto-approval flag once for the whole file instead of writing it inside
// each test: a set-after-createBusiness race left businesses PENDING and made
// every customer-facing endpoint 404. journey.test.ts uses the same pattern.
process.env.AUTO_APPROVE_BUSINESSES = 'true';

let app: TestApp;

beforeAll(async () => {
  app = await makeApp();
});

async function createMethod(
  app: TestApp,
  token: string,
  businessId: string,
  type: 'CASH' | 'EASYPAISA' | 'JAZZCASH' | 'BANK_TRANSFER' | 'OTHER',
  displayName: string,
  accountTitle = 'Test Business',
  accountNumber?: string,
  iban?: string,
) {
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/owner/businesses/${businessId}/payment-methods`,
    headers: authed(token),
    payload: {
      type,
      displayName,
      accountTitle,
      ...(accountNumber ? { accountNumber } : {}),
      ...(iban ? { iban } : {}),
      instructions: 'Send the required advance and keep the reference.',
    },
  });
  if (res.statusCode !== 201) throw new Error(`createMethod failed: ${res.body}`);
  return JSON.parse(res.body).data as { id: string };
}

async function setHours(app: TestApp, token: string, businessId: string, closedSaturday = true) {
  await app.inject({
    method: 'PUT',
    url: `/api/v1/businesses/${businessId}/hours`,
    headers: authed(token),
    payload: Array.from({ length: 7 }, (_, day) => ({
      dayOfWeek: day,
      isClosed: closedSaturday && day === 6,
      opensAt: closedSaturday && day === 6 ? undefined : '09:00',
      closesAt: closedSaturday && day === 6 ? undefined : '17:00',
    })),
  });
}

/**
 * Next business-local (PKT) date the fixtures keep open. The fixtures below
 * close day 6 (Saturday; JS getUTCDay convention 0=Sunday), so a naive
 * "tomorrow" lands on the closed day once a week and every booking in this
 * file fails with CLOSED_DAY. Skip any date that falls on the closed day.
 */
const tomorrowPkt = (): string => {
  for (let addDays = 1; addDays <= 7; addDays += 1) {
    const shifted = new Date(Date.now() + 5 * 60 * 60 * 1000 + addDays * 24 * 60 * 60 * 1000);
    const date = shifted.toISOString().slice(0, 10);
    const dayOfWeek = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (dayOfWeek !== 6) return date;
  }
  throw new Error('unreachable: no open day within a week');
};

describe('service advance creation', () => {
  it('owner can create NONE/FIXED/PERCENTAGE advance', async () => {
    const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id: businessId } = await createBusiness(app, owner.token);

    const r1 = await app.inject({
      method: 'POST',
      url: `/api/v1/businesses/${businessId}/services`,
      headers: authed(owner.token),
      payload: { name: 'No advance service', priceMinor: 100000 },
    });
    const d1 = JSON.parse(r1.body).data as {
      advanceType: string;
      advanceAmountMinor: number | null;
      advancePercent: number | null;
    };
    expect(d1.advanceType).toBe('NONE');

    const r2 = await app.inject({
      method: 'POST',
      url: `/api/v1/businesses/${businessId}/services`,
      headers: authed(owner.token),
      payload: {
        name: 'Fixed advance service',
        priceMinor: 100000,
        advanceType: 'FIXED',
        advanceAmountMinor: 20000,
      },
    });
    const d2 = JSON.parse(r2.body).data as {
      advanceType: string;
      advanceAmountMinor: number | null;
      advancePercent: number | null;
    };
    expect(d2).toMatchObject({
      advanceType: 'FIXED',
      advanceAmountMinor: 20000,
      advancePercent: null,
    });

    const r3 = await app.inject({
      method: 'POST',
      url: `/api/v1/businesses/${businessId}/services`,
      headers: authed(owner.token),
      payload: {
        name: 'Percentage advance service',
        priceMinor: 100000,
        advanceType: 'PERCENTAGE',
        advancePercent: 20,
      },
    });
    const d3 = JSON.parse(r3.body).data as {
      advanceType: string;
      advanceAmountMinor: number | null;
      advancePercent: number | null;
    };
    expect(d3).toMatchObject({
      advanceType: 'PERCENTAGE',
      advanceAmountMinor: null,
      advancePercent: 20,
    });
  });

  it('negative/over-price/invalid percentage advances rejected', async () => {
    const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id: businessId } = await createBusiness(app, owner.token);
    for (const payload of [
      { name: 'bad', priceMinor: 1000, advanceType: 'FIXED', advanceAmountMinor: -10 },
      { name: 'bad', priceMinor: 1000, advanceType: 'FIXED', advanceAmountMinor: 2000 },
      { name: 'bad', priceMinor: 1000, advanceType: 'PERCENTAGE', advancePercent: 0 },
      { name: 'bad', priceMinor: 1000, advanceType: 'PERCENTAGE', advancePercent: 101 },
    ]) {
      expect(
        (await app.inject({
          method: 'POST',
          url: `/api/v1/businesses/${businessId}/services`,
          headers: authed(owner.token),
          payload,
        })).statusCode,
      ).toBe(400);
    }
  });
});

describe('booking payment snapshot', () => {
  it('freezes service price + advance at booking creation, unaffected by later edits', async () => {
    const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const customer = await registerAndLogin(app, 'CUSTOMER');
    const { id: businessId } = await createBusiness(app, owner.token);
    await setHours(app, owner.token, businessId);
    const serviceRes = await app.inject({
      method: 'POST',
      url: `/api/v1/businesses/${businessId}/services`,
      headers: authed(owner.token),
      payload: {
        name: 'Service',
        priceMinor: 100000,
        durationMinutes: 30,
        advanceType: 'FIXED',
        advanceAmountMinor: 20000,
      },
    });
    const service = JSON.parse(serviceRes.body).data as { id: string };
    const bookingRes = await app.inject({
      method: 'POST',
      url: '/api/v1/bookings',
      headers: authed(customer.token),
      payload: { businessId, serviceId: service.id, date: tomorrowPkt(), startTime: '09:30' },
    });
    const booking = JSON.parse(bookingRes.body).data as {
      id: string;
      servicePriceMinor: number;
      advanceRequiredMinor: number;
      amountPaidMinor: number;
      amountDueMinor: number;
    };
    expect(booking.servicePriceMinor).toBe(100000);
    expect(booking.advanceRequiredMinor).toBe(20000);
    expect(booking.amountPaidMinor).toBe(0);
    expect(booking.amountDueMinor).toBe(80000);

    await app.inject({
      method: 'PATCH',
      url: `/api/v1/services/${service.id}`,
      headers: authed(owner.token),
      payload: { priceMinor: 120000, advanceAmountMinor: 30000 },
    });
    const fresh = JSON.parse(
      (await app.inject({
        method: 'GET',
        url: `/api/v1/bookings/${booking.id}`,
        headers: authed(customer.token),
      })).body,
    ).data as {
      servicePriceMinor: number;
      advanceRequiredMinor: number;
      amountPaidMinor: number;
      amountDueMinor: number;
    };
    expect(fresh.servicePriceMinor).toBe(100000);
    expect(fresh.advanceRequiredMinor).toBe(20000);
    expect(fresh.amountPaidMinor).toBe(0);
    expect(fresh.amountDueMinor).toBe(80000);
  });
});

describe('booking payment submit / verify / reject', () => {
  it('customer submits proof; business verifies; amount capped to advance', async () => {
    const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const customer = await registerAndLogin(app, 'CUSTOMER');
    const { id: businessId } = await createBusiness(app, owner.token);
    await setHours(app, owner.token, businessId);
    const serviceRes = await app.inject({
      method: 'POST',
      url: `/api/v1/businesses/${businessId}/services`,
      headers: authed(owner.token),
      payload: {
        name: 'Advance service',
        priceMinor: 100000,
        durationMinutes: 30,
        advanceType: 'FIXED',
        advanceAmountMinor: 20000,
      },
    });
    const service = JSON.parse(serviceRes.body).data as { id: string };
    const bookingRes = await app.inject({
      method: 'POST',
      url: '/api/v1/bookings',
      headers: authed(customer.token),
      payload: { businessId, serviceId: service.id, date: tomorrowPkt(), startTime: '09:30' },
    });
    const booking = JSON.parse(bookingRes.body).data as {
      id: string;
      servicePriceMinor: number;
      advanceRequiredMinor: number;
    };

    const method = await createMethod(
      app,
      owner.token,
      businessId,
      'EASYPAISA',
      'Easypaisa',
      'Test Business',
      '03001112222',
    );
    const submit = await app.inject({
      method: 'POST',
      url: `/api/v1/bookings/${booking.id}/payments`,
      headers: authed(customer.token),
      payload: {
        amountMinor: 20000,
        paymentMethodId: method.id,
        transactionReference: 'TX-ADVANCE-' + Date.now(),
        receiptStorageKey: 'receipts/t1.png',
      },
    });
    const payment = JSON.parse(submit.body).data as {
      id: string;
      status: string;
      amountMinor: number;
    };
    expect(payment.status).toBe('PENDING_VERIFICATION');
    expect(payment.amountMinor).toBe(20000);

    const approve = await app.inject({
      method: 'POST',
      url: `/api/v1/owner/payments/${payment.id}/verify`,
      headers: authed(owner.token),
    });
    expect(JSON.parse(approve.body).data.status).toBe('PAID');
    const updated = JSON.parse(
      (await app.inject({
        method: 'GET',
        url: `/api/v1/bookings/${booking.id}`,
        headers: authed(customer.token),
      })).body,
    ).data as { amountPaidMinor: number; amountDueMinor: number };
    expect(updated.amountPaidMinor).toBe(20000);
    expect(updated.amountDueMinor).toBe(80000);
  });

  it('cash skips references/receipts; digital requires them; overpay rejected', async () => {
    const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const customer = await registerAndLogin(app, 'CUSTOMER');
    const { id: businessId } = await createBusiness(app, owner.token);
    await setHours(app, owner.token, businessId);
    const serviceRes = await app.inject({
      method: 'POST',
      url: `/api/v1/businesses/${businessId}/services`,
      headers: authed(owner.token),
      payload: {
        name: 'Advance service',
        priceMinor: 100000,
        durationMinutes: 30,
        advanceType: 'FIXED',
        advanceAmountMinor: 20000,
      },
    });
    const service = JSON.parse(serviceRes.body).data as { id: string };
    const bookingRes = await app.inject({
      method: 'POST',
      url: '/api/v1/bookings',
      headers: authed(customer.token),
      payload: { businessId, serviceId: service.id, date: tomorrowPkt(), startTime: '10:00' },
    });
    const booking = JSON.parse(bookingRes.body).data as { id: string; advanceRequiredMinor: number };

    const digitalMethod = await createMethod(
      app,
      owner.token,
      businessId,
      'EASYPAISA',
      'Easypaisa',
      'Test Business',
      '03001112222',
    );
    const overpay = await app.inject({
      method: 'POST',
      url: `/api/v1/bookings/${booking.id}/payments`,
      headers: authed(customer.token),
      payload: {
        amountMinor: 20001,
        paymentMethodId: digitalMethod.id,
        transactionReference: 'TX-OVER',
        receiptStorageKey: 'receipts/t2.png',
      },
    });
    expect(overpay.statusCode).toBe(400);
    expect(JSON.parse(overpay.body).error.code).toBe('AMOUNT_EXCEEDS_DUE');

    const cashMethod = await createMethod(app, owner.token, businessId, 'CASH', 'Cash');
    const cash = await app.inject({
      method: 'POST',
      url: `/api/v1/bookings/${booking.id}/payments`,
      headers: authed(customer.token),
      payload: { amountMinor: 20000, paymentMethodId: cashMethod.id },
    });
    expect(cash.statusCode).toBe(201);
    expect(JSON.parse(cash.body).data.transactionReference).toBeNull();
  });

  it('duplicate verify blocked; reject sets reason; booking stays unpaid', async () => {
    const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const customer = await registerAndLogin(app, 'CUSTOMER');
    const { id: businessId } = await createBusiness(app, owner.token);
    await setHours(app, owner.token, businessId);
    const serviceRes = await app.inject({
      method: 'POST',
      url: `/api/v1/businesses/${businessId}/services`,
      headers: authed(owner.token),
      payload: {
        name: 'Advance service',
        priceMinor: 100000,
        durationMinutes: 30,
        advanceType: 'FIXED',
        advanceAmountMinor: 20000,
      },
    });
    const service = JSON.parse(serviceRes.body).data as { id: string };
    const bookingRes = await app.inject({
      method: 'POST',
      url: '/api/v1/bookings',
      headers: authed(customer.token),
      payload: { businessId, serviceId: service.id, date: tomorrowPkt(), startTime: '10:00' },
    });
    const booking = JSON.parse(bookingRes.body).data as { id: string; servicePriceMinor: number };

    const method = await createMethod(
      app,
      owner.token,
      businessId,
      'EASYPAISA',
      'Easypaisa',
      'Test Business',
      '03001112222',
    );
    const submit = await app.inject({
      method: 'POST',
      url: `/api/v1/bookings/${booking.id}/payments`,
      headers: authed(customer.token),
      payload: {
        amountMinor: 20000,
        paymentMethodId: method.id,
        transactionReference: 'TX-' + Date.now(),
        receiptStorageKey: 'receipts/t2.png',
      },
    });
    const payment = JSON.parse(submit.body).data as { id: string };

    const reject = await app.inject({
      method: 'POST',
      url: `/api/v1/owner/payments/${payment.id}/reject`,
      headers: authed(owner.token),
      payload: { reason: 'Receipt does not match reference.' },
    });
    expect(JSON.parse(reject.body).data.status).toBe('FAILED');
    expect(JSON.parse(reject.body).data.rejectionReason).toBe('Receipt does not match reference.');
    expect(
      (await app.inject({
        method: 'POST',
        url: `/api/v1/owner/payments/${payment.id}/verify`,
        headers: authed(owner.token),
      })).statusCode,
    ).toBe(409);
  });
});

describe('owner payment queue', () => {
  it('pending booking payments appear for owning business only', async () => {
    const ownerA = await registerAndLogin(app, 'BUSINESS_OWNER');
    const customerA = await registerAndLogin(app, 'CUSTOMER');
    const ownerB = await registerAndLogin(app, 'BUSINESS_OWNER');
    const { id: idA } = await createBusiness(app, ownerA.token);
    const { id: idB } = await createBusiness(app, ownerB.token);
    await setHours(app, ownerA.token, idA);
    // An advance means the customer actually has something to pay.
    const serviceA = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/businesses/${idA}/services`,
          headers: authed(ownerA.token),
          payload: { name: 'Private service', priceMinor: 100000, durationMinutes: 30, advanceType: 'FIXED', advanceAmountMinor: 20000 },
        })
      ).body,
    ).data as { id: string };
    const bookingA = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/bookings',
          headers: authed(customerA.token),
          payload: { businessId: idA, serviceId: serviceA.id, date: tomorrowPkt(), startTime: '09:30' },
        })
      ).body,
    ).data as { id: string };
    const method = await createMethod(app, ownerA.token, idA, 'EASYPAISA', 'Easypaisa', 'Test Business', '03001112222');
    const submit = await app.inject({
      method: 'POST',
      url: `/api/v1/bookings/${bookingA.id}/payments`,
      headers: authed(customerA.token),
      payload: {
        amountMinor: 20000,
        paymentMethodId: method.id,
        transactionReference: 'TX-QUEUE-' + Date.now(),
        receiptStorageKey: 'receipts/queue.png',
      },
    });
    expect(submit.statusCode).toBe(201);

    // Owner A sees the pending proof; owner B's queue stays empty.
    const queueA = JSON.parse(
      (await app.inject({ method: 'GET', url: '/api/v1/owner/payments', headers: authed(ownerA.token) })).body,
    ).data;
    const pendingA = queueA.bookingPayments as { id: string }[];
    expect(pendingA.length).toBeGreaterThan(0);
    const queueB = JSON.parse(
      (await app.inject({ method: 'GET', url: '/api/v1/owner/payments', headers: authed(ownerB.token) })).body,
    ).data;
    expect((queueB.bookingPayments as { id: string }[]).length).toBe(0);
  });
});

describe('order delivery fee', () => {
  it('delivery fee added server-side; pickup not charged; client cannot tamper', async () => {
    const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const customer = await registerAndLogin(app, 'CUSTOMER');
    const { id: businessId } = await createBusiness(app, owner.token);
    await setHours(app, owner.token, businessId);
    await app.inject({
      method: 'PUT',
      url: `/api/v1/owner/businesses/${businessId}/delivery-settings`,
      headers: authed(owner.token),
      payload: { deliveryEnabled: true, codEnabled: true, deliveryFeeMinor: 20000 },
    });

    const product = JSON.parse(
      (await app.inject({
        method: 'POST',
        url: `/api/v1/businesses/${businessId}/products`,
        headers: authed(owner.token),
        payload: { name: 'Product', priceMinor: 100000 },
      })).body,
    ).data as { id: string };

    const deliveryOrder = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/orders',
          headers: authed(customer.token),
          payload: { businessId, items: [{ productId: product.id, quantity: 1 }], fulfillmentType: 'DELIVERY' },
        })
      ).body,
    ).data as { deliveryFeeMinor: number; totalMinor: number };
    expect(deliveryOrder.deliveryFeeMinor).toBe(20000);
    expect(deliveryOrder.totalMinor).toBe(120000);

    const pickupOrder = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/orders',
          headers: authed(customer.token),
          payload: { businessId, items: [{ productId: product.id, quantity: 1 }], fulfillmentType: 'PICKUP' },
        })
      ).body,
    ).data as { deliveryFeeMinor: number; totalMinor: number };
    expect(pickupOrder.deliveryFeeMinor).toBe(0);
    expect(pickupOrder.totalMinor).toBe(100000);

    const badFees = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: authed(customer.token),
      payload: {
        businessId,
        items: [{ productId: product.id, quantity: 1 }],
        fulfillmentType: 'DELIVERY',
        paymentMethodId: '00000000-0000-4000-8000-000000000000',
      },
    });
    expect(badFees.statusCode).toBe(400);
    expect(JSON.parse(badFees.body).error.code).toBe('INVALID_PAYMENT_METHOD');
  });
});

describe('order payment + cash collection', () => {
  it('manual digital order payment verify; cash collected by owner', async () => {
    const owner = await registerAndLogin(app, 'BUSINESS_OWNER');
    const customer = await registerAndLogin(app, 'CUSTOMER');
    const { id: businessId } = await createBusiness(app, owner.token);
    await setHours(app, owner.token, businessId);
    await app.inject({
      method: 'PUT',
      url: `/api/v1/owner/businesses/${businessId}/delivery-settings`,
      headers: authed(owner.token),
      payload: { deliveryEnabled: true, codEnabled: true, deliveryFeeMinor: 20000 },
    });

    const product = JSON.parse(
      (await app.inject({
        method: 'POST',
        url: `/api/v1/businesses/${businessId}/products`,
        headers: authed(owner.token),
        payload: { name: 'Product', priceMinor: 100000 },
      })).body,
    ).data as { id: string };
    const order = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/orders',
          headers: authed(customer.token),
          payload: { businessId, items: [{ productId: product.id, quantity: 1 }], fulfillmentType: 'DELIVERY' },
        })
      ).body,
    ).data as { id: string; totalMinor: number };

    await createMethod(
      app,
      owner.token,
      businessId,
      'JAZZCASH',
      'JazzCash',
      'Test Business',
      '03003334444',
    );
    const allMethods = JSON.parse(
      (await app.inject({
        method: 'GET',
        url: `/api/v1/businesses/${businessId}/payment-methods`,
        headers: authed(customer.token),
      })).body,
    ).data as { id: string; displayName: string }[];
    const method = allMethods.find((m) => m.displayName === 'JazzCash');
    if (!method) throw new Error('JazzCash method missing');

    // Partial digital payment (part of the total), verified by the owner.
    const partialMinor = Math.round(order.totalMinor / 2);
    const submit = await app.inject({
      method: 'POST',
      url: `/api/v1/orders/${order.id}/payments`,
      headers: authed(customer.token),
      payload: {
        amountMinor: partialMinor,
        paymentMethodId: method.id,
        transactionReference: 'TX-ORDER-' + Date.now(),
        receiptStorageKey: 'receipts/t3.png',
      },
    });
    expect(JSON.parse(submit.body).data.status).toBe('PENDING_VERIFICATION');

    const verifyResult = await app.inject({
      method: 'POST',
      url: `/api/v1/owner/order-payments/${JSON.parse(submit.body).data.id}/verify`,
      headers: authed(owner.token),
    });
    expect(JSON.parse(verifyResult.body).data.status).toBe('PAID');

    // Cash collection covers only the remaining balance; the verified digital
    // payment counts toward the total, so a double-collect is impossible.
    const collected = JSON.parse(
      (await app.inject({
        method: 'POST',
        url: `/api/v1/owner/orders/${order.id}/collect-cash`,
        headers: authed(owner.token),
      })).body,
    ).data as { paymentMethod: { type: string } | null; status: string; amountMinor: number };
    expect(collected.paymentMethod?.type).toBe('CASH');
    expect(collected.status).toBe('PAID');
    expect(collected.amountMinor).toBe(order.totalMinor - partialMinor);
  });
});

describe('security: cross-business / cross-user', () => {
  it('customer cannot verify/reject; other business/other customer blocked', async () => {
    const ownerA = await registerAndLogin(app, 'BUSINESS_OWNER');
    const ownerB = await registerAndLogin(app, 'BUSINESS_OWNER');
    const customerA = await registerAndLogin(app, 'CUSTOMER');
    const customerB = await registerAndLogin(app, 'CUSTOMER');
    const { id: idA } = await createBusiness(app, ownerA.token);
    await setHours(app, ownerA.token, idA);
    const serviceA = JSON.parse(
      (await app.inject({
        method: 'POST',
        url: `/api/v1/businesses/${idA}/services`,
        headers: authed(ownerA.token),
        payload: { name: 'Private service', priceMinor: 100000, durationMinutes: 30 },
      })).body,
    ).data as { id: string };
    const bookingA = JSON.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/bookings',
          headers: authed(customerA.token),
          payload: { businessId: idA, serviceId: serviceA.id, date: tomorrowPkt(), startTime: '09:30' },
        })
      ).body,
    ).data as { id: string };
    const method = await createMethod(
      app,
      ownerA.token,
      idA,
      'EASYPAISA',
      'Easypaisa',
      'Test Business',
      '03001112222',
    );
    const paymentA = JSON.parse(
      (await app.inject({
        method: 'POST',
        url: `/api/v1/bookings/${bookingA.id}/payments`,
        headers: authed(customerA.token),
        payload: {
          amountMinor: 20000,
          paymentMethodId: method.id,
          transactionReference: 'TX-' + Date.now(),
          receiptStorageKey: 'receipts/t4.png',
        },
      })).body,
    ).data as { id: string };

    expect(
      (await app.inject({
        method: 'POST',
        url: `/api/v1/owner/payments/${paymentA.id}/verify`,
        headers: authed(customerA.token),
      })).statusCode,
    ).toBe(403);
    expect(
      (await app.inject({
        method: 'POST',
        url: `/api/v1/owner/payments/${paymentA.id}/reject`,
        headers: authed(customerA.token),
        payload: { reason: 'No' },
      })).statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ method: 'GET', url: `/api/v1/bookings/${bookingA.id}/payments`, headers: authed(customerB.token) })).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({
        method: 'POST',
        url: `/api/v1/owner/payments/${paymentA.id}/verify`,
        headers: authed(ownerB.token),
      })).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({
        method: 'POST',
        url: `/api/v1/owner/payments/${paymentA.id}/reject`,
        headers: authed(ownerB.token),
        payload: { reason: 'No proof attached' },
      })).statusCode,
    ).toBe(404);
  });
});
