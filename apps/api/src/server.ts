import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import type { Prisma } from '@prisma/client';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import jwt from '@fastify/jwt';
import argon2 from 'argon2';
import { ZodError } from 'zod';
import {
  prisma,
  registerSchema,
  categoryCreateSchema,
  categoryUpdateSchema,
  businessSchema,
  businessUpdateSchema,
  serviceSchema,
  serviceUpdateSchema,
  productSchema,
  productUpdateSchema,
  businessHoursSchema,
  bookingCreateSchema,
  bookingListQuerySchema,
  availabilityQuerySchema,
  orderSchema,
  businessStatusSchema,
  bookingStatusSchema,
  orderStatusSchema,
  slugify,
  allowedTransitions,
  isOpenNow,
  distanceKm,
  BLOCKING_BOOKING_STATUSES,
  overlaps,
  generateSlots,
  minutesOfDay,
  formatMinutes,
  pktDateOf,
  pktDayOfWeek,
  pktMinutesOf,
  pktToUtc,
  pktDayWindowUtc,
} from './lib.js';
import type { AuthUser } from './lib.js';

declare module 'fastify' {
  interface FastifyRequest {
    currentUser: AuthUser & { email: string; firstName: string | null; lastName: string | null; phone: string | null };
  }
}

const PUBLIC_BUSINESS_INCLUDE = {
  categories: { include: { category: true } },
  hours: true,
} as const;

/** Flattens join rows (BusinessCategory[]) to the category objects clients expect. */
const flattenCategories = (
  rows: { category: unknown }[],
): unknown[] => rows.map((bc) => bc.category);

type SessionedRequest = FastifyRequest & { currentUser?: AuthUser & { email: string } };

/** Builds the Fastify app. Exported so integration tests can boot it against a test database. */
export async function buildApp(): Promise<FastifyInstance> {
  const env = {
    port: Number(process.env.PORT ?? 3000),
    access: process.env.JWT_ACCESS_SECRET ?? 'development-access-secret-change-me-32!',
    refresh: process.env.JWT_REFRESH_SECRET ?? 'development-refresh-secret-change-me-32!',
    cors: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  };

  const app = Fastify({ logger: { redact: ['req.headers.authorization', 'password', 'token'] } });
  const rateMax = Number(process.env.RATE_LIMIT_MAX ?? 100);
  const authRateMax = Number(process.env.AUTH_RATE_LIMIT_MAX ?? 10);

  await app.register(helmet);
  await app.register(cors, { origin: env.cors.split(',') });
  await app.register(rateLimit, { max: rateMax, timeWindow: '1 minute' });
  await app.register(jwt, { secret: env.access });

  app.setErrorHandler((e, _q, r) => {
    if (e instanceof ZodError)
      return r.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: e.flatten() } });
    if ((e as { code?: string }).code === 'P2002')
      return r.status(409).send({ error: { code: 'CONFLICT', message: 'A record with that value already exists' } });
    // Errors raised with an explicit statusCode + publicMessage carry a
    // client-safe message (e.g. slot conflicts); everything else stays opaque.
    const status = (e as { statusCode?: number }).statusCode;
    const publicMessage = (e as { publicMessage?: string }).publicMessage;
    if (status !== undefined && publicMessage)
      return r.status(status).send({ error: { code: (e as { code?: string }).code ?? 'CONFLICT', message: publicMessage } });
    app.log.error(e);
    return r
      .status(status ?? 500)
      .send({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  });

  const auth = async (q: FastifyRequest, r: FastifyReply): Promise<void> => {
    try {
      await q.jwtVerify();
      const u = await prisma.user.findUnique({ where: { id: (q.user as { id: string }).id } });
      if (!u || u.isSuspended) {
        await r.status(403).send({ error: { code: 'ACCOUNT_UNAVAILABLE', message: 'Account unavailable' } });
        return;
      }
      (q as SessionedRequest).currentUser = u;
    } catch {
      await r.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    }
  };

  const roles =
    (...rs: string[]) =>
    async (q: FastifyRequest, r: FastifyReply): Promise<void> => {
      await auth(q, r);
      if (r.sent) return;
      if (!rs.includes((q as SessionedRequest).currentUser!.role))
        await r.status(403).send({ error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
    };

  const currentUser = (q: FastifyRequest) => (q as SessionedRequest).currentUser!;

  /** Loads a business owned by the current user, or throws 404 (ownership enforced server-side). */
  const ownedBusiness = async (q: FastifyRequest, id: string) => {
    const b = await prisma.business.findFirst({ where: { id, ownerId: currentUser(q).id, archivedAt: null } });
    if (!b) throw Object.assign(new Error('Business not found'), { statusCode: 404 });
    return b;
  };

  /* ----------------------------- Health ----------------------------- */
  app.get('/health', async () => ({ status: 'ok' }));

  /* ------------------------------ Auth ------------------------------ */
  app.post(
    '/api/v1/auth/register',
    { config: { rateLimit: { max: authRateMax, timeWindow: '1 hour' } } },
    async (q, r) => {
      const d = registerSchema.parse(q.body);
      const user = await prisma.user.create({
        data: {
          email: d.email.toLowerCase(),
          passwordHash: await argon2.hash(d.password, { type: argon2.argon2id }),
          firstName: d.firstName,
          lastName: d.lastName,
          role: d.role ?? 'CUSTOMER',
        },
      });
      return r.status(201).send({ data: { id: user.id, email: user.email, role: user.role } });
    },
  );

  app.post('/api/v1/auth/login', { config: { rateLimit: { max: authRateMax, timeWindow: '15 minutes' } } }, async (q, r) => {
    const b = q.body as { email: string; password: string };
    const user = await prisma.user.findUnique({ where: { email: b.email?.toLowerCase() } });
    if (!user || user.isSuspended || !(await argon2.verify(user.passwordHash, b.password ?? '')))
      return r.status(401).send({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } });
    const accessToken = app.jwt.sign({ id: user.id, role: user.role }, { expiresIn: '15m' });
    return { data: { accessToken, user: { id: user.id, email: user.email, role: user.role } } };
  });

  app.get('/api/v1/auth/me', { preHandler: auth }, async (q) => {
    const u = currentUser(q);
    return { data: { id: u.id, email: u.email, role: u.role, firstName: u.firstName, lastName: u.lastName } };
  });

  /* --------------------------- Categories --------------------------- */
  app.get('/api/v1/categories', async () => ({
    data: await prisma.category.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
  }));

  app.get('/api/v1/admin/categories', { preHandler: roles('ADMIN') }, async () => ({
    data: await prisma.category.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { businesses: true } } },
    }),
  }));

  app.post('/api/v1/admin/categories', { preHandler: roles('ADMIN') }, async (q, r) => {
    const d = categoryCreateSchema.parse(q.body);
    const category = await prisma.category.create({
      data: { name: d.name, slug: d.slug ?? slugify(d.name), isActive: d.isActive ?? true },
    });
    await prisma.auditLog.create({
      data: { actorId: currentUser(q).id, action: 'CATEGORY_CREATED', entityType: 'Category', entityId: category.id, metadata: { name: category.name } },
    });
    return r.status(201).send({ data: category });
  });

  app.patch('/api/v1/admin/categories/:id', { preHandler: roles('ADMIN') }, async (q, r) => {
    const d = categoryUpdateSchema.parse(q.body);
    const existing = await prisma.category.findUnique({ where: { id: (q.params as { id: string }).id } });
    if (!existing) return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Category not found' } });
    const data: { name?: string; slug?: string; isActive?: boolean } = {};
    if (d.name !== undefined) {
      data.name = d.name;
      if (d.slug === undefined) data.slug = slugify(d.name);
    }
    if (d.slug !== undefined) data.slug = d.slug;
    if (d.isActive !== undefined) data.isActive = d.isActive;
    return { data: await prisma.category.update({ where: { id: existing.id }, data }) };
  });

  /* ------------------------- Businesses (public) --------------------- */
  app.get('/api/v1/businesses', async (q) => {
    const s = q.query as Record<string, string | undefined>;
    const where: Record<string, unknown> = { status: 'APPROVED', archivedAt: null };
    if (s.city) where.city = { equals: s.city, mode: 'insensitive' };
    if (s.q) where.OR = [{ name: { contains: s.q, mode: 'insensitive' } }, { description: { contains: s.q, mode: 'insensitive' } }];
    if (s.category) where.categories = { some: { category: { isActive: true, slug: s.category } } };

    const limit = Math.min(Number(s.limit ?? 20), 100);
    // Nearby filtering happens after the fetch, so when active we scan a wider
    // page before applying the radius + sort, then slice to the requested limit.
    const fetchTake = s.nearLat !== undefined && s.nearLng !== undefined ? 100 : limit;
    // Newest-first so the first page is deterministic once more businesses exist
    // than a single page can hold.
    const businesses = await prisma.business.findMany({ where, include: PUBLIC_BUSINESS_INCLUDE, take: fetchTake, orderBy: { createdAt: 'desc' } });
    const mapped = businesses.map((b) => ({
      id: b.id,
      name: b.name,
      slug: b.slug,
      description: b.description,
      imageUrl: b.imageUrl,
      isVerified: b.isVerified,
      address: b.address,
      city: b.city,
      locality: b.locality,
      latitude: b.latitude,
      longitude: b.longitude,
      currency: b.currency,
      isOpenNow: isOpenNow(b.hours),
      categories: b.categories.map((bc) => bc.category),
    }));

    if (s.nearLat !== undefined && s.nearLng !== undefined) {
      const lat = Number(s.nearLat);
      const lng = Number(s.nearLng);
      const radius = Number(s.radiusKm ?? 10);
      if (Number.isFinite(lat) && Number.isFinite(lng) && Number.isFinite(radius) && radius > 0) {
        return {
          data: mapped
            .map((b) => ({ ...b, distanceKm: distanceKm(lat, lng, Number(b.latitude), Number(b.longitude)) }))
            .filter((b) => b.distanceKm <= radius)
            .sort((a, b) => a.distanceKm - b.distanceKm)
            .slice(0, limit),
        };
      }
    }
    return { data: mapped };
  });

  app.get('/api/v1/businesses/:id', async (q, r) => {
    const key = (q.params as { id: string }).id;
    const b = await prisma.business.findFirst({
      where: { OR: [{ id: key }, { slug: key }], status: 'APPROVED', archivedAt: null },
      include: {
        ...PUBLIC_BUSINESS_INCLUDE,
        services: { where: { isActive: true }, orderBy: { name: 'asc' } },
        products: { where: { isActive: true }, orderBy: { name: 'asc' } },
      },
    });
    if (!b) return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Business not found' } });
    return {
      data: {
        id: b.id,
        name: b.name,
        slug: b.slug,
        description: b.description,
        imageUrl: b.imageUrl,
        isVerified: b.isVerified,
        phone: b.phone,
        email: b.email,
        address: b.address,
        city: b.city,
        locality: b.locality,
        latitude: b.latitude,
        longitude: b.longitude,
        currency: b.currency,
        isOpenNow: isOpenNow(b.hours),
        hours: b.hours,
        categories: b.categories.map((bc) => bc.category),
        services: b.services,
        products: b.products,
      },
    };
  });

  /* ----------------------- Businesses (owner) ------------------------ */
  app.post('/api/v1/businesses', { preHandler: roles('BUSINESS_OWNER') }, async (q, r) => {
    const d = businessSchema.parse(q.body);
    const { categoryIds, latitude, longitude, ...input } = d;
    const validCategories = await prisma.category.findMany({ where: { id: { in: categoryIds }, isActive: true } });
    if (validCategories.length !== categoryIds.length)
      return r.status(400).send({ error: { code: 'INVALID_CATEGORY', message: 'One or more categories are invalid' } });
    // Coordinates are optional for self-service onboarding (no maps in the
    // create form). When omitted, a city-centre fallback keeps the existing
    // schema/not-null contract and nearby search functional until real
    // coordinates are captured in a later phase.
    const FALLBACK_COORDS: Record<string, { latitude: number; longitude: number }> = {
      karachi: { latitude: 24.8607, longitude: 67.0011 },
      lahore: { latitude: 31.5204, longitude: 74.3587 },
      islamabad: { latitude: 33.6844, longitude: 73.0479 },
      rawalpindi: { latitude: 33.5651, longitude: 73.0169 },
      faisalabad: { latitude: 31.4187, longitude: 73.0791 },
      multan: { latitude: 30.1575, longitude: 71.5249 },
      peshawar: { latitude: 34.0151, longitude: 71.5249 },
      quetta: { latitude: 30.1798, longitude: 66.975 },
    };
    const fallback = FALLBACK_COORDS[d.city.trim().toLowerCase()] ?? { latitude: 30.3753, longitude: 69.3451 };
    // Dev/preview-only convenience (AUTO_APPROVE_BUSINESSES=true): skip the
    // admin approval wait for NEW businesses. Strictly server-configured —
    // there is deliberately no client-controllable path to approval, and the
    // default stays PENDING.
    const status = process.env.AUTO_APPROVE_BUSINESSES === 'true' ? 'APPROVED' : 'PENDING';
    const b = await prisma.business.create({
      data: {
        ...input,
        latitude: latitude ?? fallback.latitude,
        longitude: longitude ?? fallback.longitude,
        slug: `${slugify(d.name)}-${Date.now().toString(36)}`,
        ownerId: currentUser(q).id,
        status,
        categories: { create: categoryIds.map((categoryId) => ({ categoryId })) },
      },
      include: { categories: { include: { category: true } } },
    });
    if (status === 'APPROVED')
      await prisma.auditLog.create({
        data: {
          actorId: currentUser(q).id,
          action: 'BUSINESS_AUTO_APPROVED',
          entityType: 'Business',
          entityId: b.id,
          metadata: { reason: 'AUTO_APPROVE_BUSINESSES' },
        },
      });
    return r.status(201).send({ data: { ...b, categories: flattenCategories(b.categories) } });
  });

  app.get('/api/v1/businesses/mine', { preHandler: roles('BUSINESS_OWNER') }, async (q) => ({
    data: (
      await prisma.business.findMany({
        where: { ownerId: currentUser(q).id, archivedAt: null },
        include: { ...PUBLIC_BUSINESS_INCLUDE, services: { orderBy: { name: 'asc' } }, products: { orderBy: { name: 'asc' } } },
        orderBy: { createdAt: 'asc' },
      })
    ).map((b) => ({ ...b, categories: flattenCategories(b.categories) })),
  }));

  /** Optional profile fields the owner may explicitly clear (client sends ""/null). */
  const CLEARABLE_BUSINESS_FIELDS = ['description', 'locality', 'phone', 'email', 'imageUrl'] as const;

  app.patch('/api/v1/businesses/:id', { preHandler: roles('BUSINESS_OWNER') }, async (q, r) => {
    const id = (q.params as { id: string }).id;
    await ownedBusiness(q, id);
    const d = businessUpdateSchema.parse(q.body);
    const { categoryIds, ...rest } = d;
    const data: Record<string, unknown> = { ...rest };
    // A cleared optional field normalizes to undefined, but the client DID send
    // the key — translate that to a real DB null so the value is actually
    // removed instead of silently kept.
    const rawBody = (q.body ?? {}) as Record<string, unknown>;
    for (const key of CLEARABLE_BUSINESS_FIELDS) {
      if (key in rawBody && rawBody[key] !== undefined && data[key] === undefined) data[key] = null;
    }
    if (categoryIds) {
      const validCategories = await prisma.category.findMany({ where: { id: { in: categoryIds }, isActive: true } });
      if (validCategories.length !== categoryIds.length)
        return r.status(400).send({ error: { code: 'INVALID_CATEGORY', message: 'One or more categories are invalid' } });
      data.categories = { deleteMany: {}, create: categoryIds.map((categoryId) => ({ categoryId })) };
    }
    return {
      data: await prisma.business
        .update({ where: { id }, data, include: { categories: { include: { category: true } } } })
        .then((b) => ({ ...b, categories: flattenCategories(b.categories) })),
    };
  });

  app.get('/api/v1/businesses/:id/hours', async (q, r) => {
    const key = (q.params as { id: string }).id;
    const business = await prisma.business.findFirst({
      where: { OR: [{ id: key }, { slug: key }], status: 'APPROVED', archivedAt: null },
      include: { hours: { orderBy: { dayOfWeek: 'asc' } } },
    });
    if (!business) return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Business not found' } });
    return { data: business.hours };
  });

  /* --------------------------- Services ----------------------------- */
  app.get('/api/v1/businesses/:id/services', async (q, r) => {
    const key = (q.params as { id: string }).id;
    const business = await prisma.business.findFirst({
      where: { OR: [{ id: key }, { slug: key }], status: 'APPROVED', archivedAt: null },
      include: { services: { where: { isActive: true }, orderBy: { name: 'asc' } } },
    });
    if (!business) return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Business not found' } });
    return { data: business.services };
  });

  app.post('/api/v1/businesses/:id/services', { preHandler: roles('BUSINESS_OWNER') }, async (q, r) => {
    const id = (q.params as { id: string }).id;
    await ownedBusiness(q, id);
    const d = serviceSchema.parse(q.body);
    return r.status(201).send({ data: await prisma.service.create({ data: { ...d, businessId: id } }) });
  });

  app.patch('/api/v1/services/:id', { preHandler: roles('BUSINESS_OWNER') }, async (q, r) => {
    const id = (q.params as { id: string }).id;
    const service = await prisma.service.findUnique({ where: { id } });
    if (!service) return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Service not found' } });
    await ownedBusiness(q, service.businessId);
    return { data: await prisma.service.update({ where: { id: service.id }, data: serviceUpdateSchema.parse(q.body) }) };
  });

  app.delete('/api/v1/services/:id', { preHandler: roles('BUSINESS_OWNER') }, async (q, r) => {
    const id = (q.params as { id: string }).id;
    const service = await prisma.service.findUnique({ where: { id } });
    if (!service) return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Service not found' } });
    await ownedBusiness(q, service.businessId);
    await prisma.service.delete({ where: { id: service.id } });
    return r.status(204).send();
  });

  /* --------------------------- Products ----------------------------- */
  app.get('/api/v1/businesses/:id/products', async (q, r) => {
    const key = (q.params as { id: string }).id;
    const business = await prisma.business.findFirst({
      where: { OR: [{ id: key }, { slug: key }], status: 'APPROVED', archivedAt: null },
      include: { products: { where: { isActive: true }, orderBy: { name: 'asc' } } },
    });
    if (!business) return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Business not found' } });
    return { data: business.products };
  });

  app.post('/api/v1/businesses/:id/products', { preHandler: roles('BUSINESS_OWNER') }, async (q, r) => {
    const id = (q.params as { id: string }).id;
    await ownedBusiness(q, id);
    const d = productSchema.parse(q.body);
    return r.status(201).send({ data: await prisma.product.create({ data: { ...d, businessId: id } }) });
  });

  app.patch('/api/v1/products/:id', { preHandler: roles('BUSINESS_OWNER') }, async (q, r) => {
    const id = (q.params as { id: string }).id;
    const product = await prisma.product.findUnique({ where: { id } });
    if (!product) return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Product not found' } });
    await ownedBusiness(q, product.businessId);
    return { data: await prisma.product.update({ where: { id: product.id }, data: productUpdateSchema.parse(q.body) }) };
  });

  app.delete('/api/v1/products/:id', { preHandler: roles('BUSINESS_OWNER') }, async (q, r) => {
    const id = (q.params as { id: string }).id;
    const product = await prisma.product.findUnique({ where: { id } });
    if (!product) return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Product not found' } });
    await ownedBusiness(q, product.businessId);
    // Historical integrity (Phase 4 ordering): OrderItem.productId is
    // ON DELETE RESTRICT, so a product referenced by an order can never be
    // hard-deleted. Instead of letting that surface as a 500, refuse it
    // explicitly and direct the owner to the non-destructive alternative.
    const referenced = await prisma.orderItem.findFirst({ where: { productId: product.id }, select: { id: true } });
    if (referenced)
      return r.status(409).send({
        error: {
          code: 'PRODUCT_IN_USE',
          message: 'This product is part of an order and cannot be deleted. Disable it instead.',
        },
      });
    await prisma.product.delete({ where: { id: product.id } });
    return r.status(204).send();
  });

  /* -------------------------- Hours (owner) -------------------------- */
  app.put('/api/v1/businesses/:id/hours', { preHandler: roles('BUSINESS_OWNER') }, async (q, r) => {
    const id = (q.params as { id: string }).id;
    await ownedBusiness(q, id);
    const days = businessHoursSchema.parse(q.body);
    await prisma.$transaction([
      prisma.businessHour.deleteMany({ where: { businessId: id } }),
      prisma.businessHour.createMany({
        data: days.map((d) => ({
          businessId: id,
          dayOfWeek: d.dayOfWeek,
          isClosed: d.isClosed,
          opensAt: d.opensAt ?? null,
          closesAt: d.closesAt ?? null,
        })),
      }),
    ]);
    return { data: await prisma.businessHour.findMany({ where: { businessId: id }, orderBy: { dayOfWeek: 'asc' } }) };
  });

  /* -------------------- Bookings (Phase 3A) --------------------------- */

  /**
   * Business error with a client-safe message. Used for booking conflicts so
   * the error handler can expose a useful reason without leaking internals.
   */
  const bookingError = (statusCode: number, code: string, message: string): Error =>
    Object.assign(new Error(message), { statusCode, code, publicMessage: message });

  /** Loads one booking visible to the current user (own, owned business, or admin); else 404. */
  const loadVisibleBooking = async (q: FastifyRequest, id: string) => {
    const u = currentUser(q);
    const booking = await prisma.booking.findUnique({ where: { id }, include: { business: true, service: true } });
    if (!booking) throw bookingError(404, 'NOT_FOUND', 'Booking not found');
    const ownsBusiness = (u.role === 'BUSINESS_OWNER' || u.role === 'ADMIN') && booking.business.ownerId === u.id;
    if (booking.customerId !== u.id && !ownsBusiness) throw bookingError(404, 'NOT_FOUND', 'Booking not found');
    return booking;
  };

  /** Booking fields safe to return to any client (never credentials or internal ids). */
  const publicBooking = (booking: {
    id: string;
    bookingDate: Date;
    startAt: Date;
    endAt: Date;
    status: string;
    notes: string | null;
    customerId: string;
    createdAt: Date;
    business: { id: string; name: string; slug: string; ownerId: string };
    service: { id: string; name: string; durationMinutes: number | null; priceMinor: number; currency: string } | null | undefined;
  }) => ({
    id: booking.id,
    businessId: booking.business.id,
    businessName: booking.business.name,
    businessSlug: booking.business.slug,
    serviceId: booking.service?.id ?? null,
    serviceName: booking.service?.name ?? null,
    priceMinor: booking.service?.priceMinor ?? null,
    currency: booking.service?.currency ?? 'PKR',
    bookingDate: pktDateOf(booking.startAt),
    startTime: formatMinutes(pktMinutesOf(booking.startAt)),
    endTime: formatMinutes(pktMinutesOf(booking.endAt)),
    status: booking.status,
    notes: booking.notes,
    customerId: booking.customerId,
    createdAt: booking.createdAt,
  });

  /** Shared booking-list include with only public customer fields. */
  const BOOKING_INCLUDE = {
    business: { select: { id: true, name: true, slug: true, ownerId: true } },
    service: { select: { id: true, name: true, durationMinutes: true, priceMinor: true, currency: true } },
  } as const;

  /**
   * Shared order include. `business.ownerId` is selected only to authorize
   * owners; it is stripped by publicOrder and never serialized to clients.
   */
  const ORDER_INCLUDE = {
    business: { select: { id: true, name: true, slug: true, ownerId: true } },
    customer: { select: { firstName: true, lastName: true } },
    items: true,
  } as const;

  app.get('/api/v1/businesses/:businessId/services/:serviceId/availability', async (q, r) => {
    const { businessId, serviceId } = q.params as { businessId: string; serviceId: string };
    const { date } = availabilityQuerySchema.parse(q.query);

    const business = await prisma.business.findFirst({
      where: { OR: [{ id: businessId }, { slug: businessId }], status: 'APPROVED', archivedAt: null },
      include: { hours: true },
    });
    if (!business) return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Business not found' } });

    const service = await prisma.service.findFirst({ where: { id: serviceId, businessId: business.id } });
    if (!service || !service.isActive || service.durationMinutes === null)
      return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Service not found or not bookable' } });
    const duration = service.durationMinutes;

    const day = pktDayOfWeek(new Date(Date.parse(`${date}T12:00:00Z`)));
    const todayHours = business.hours.find((h) => h.dayOfWeek === day);
    if (!todayHours || todayHours.isClosed || !todayHours.opensAt || !todayHours.closesAt) {
      return {
        data: { date, serviceDurationMinutes: duration, businessHours: null, closed: true, slots: [] },
      };
    }

    // Blocking bookings for this business on this local date.
    const window = pktDayWindowUtc(date);
    const busy = await prisma.booking.findMany({
      where: {
        businessId: business.id,
        status: { in: [...BLOCKING_BOOKING_STATUSES] },
        startAt: { lt: window.to },
        endAt: { gt: window.from },
      },
      select: { startAt: true, endAt: true },
    });

    const slots = generateSlots({ opensAt: todayHours.opensAt, closesAt: todayHours.closesAt }, duration).map((s) => {
      const start = pktToUtc(date, s.startMinutes);
      const end = pktToUtc(date, s.endMinutes);
      const startMinutesLocal = s.startMinutes;
      const isInPast = start.getTime() <= Date.now();
      const isTaken = busy.some((b) => overlaps(start, end, b.startAt, b.endAt));
      return {
        start: formatMinutes(startMinutesLocal),
        end: formatMinutes(s.endMinutes),
        available: !isInPast && !isTaken,
      };
    });

    return {
      data: {
        date,
        serviceDurationMinutes: duration,
        businessHours: { open: todayHours.opensAt, close: todayHours.closesAt },
        closed: false,
        slots,
      },
    };
  });

  app.post('/api/v1/bookings', { preHandler: roles('CUSTOMER') }, async (q, r) => {
    const d = bookingCreateSchema.parse(q.body);

    const business = await prisma.business.findFirst({
      where: { id: d.businessId, status: 'APPROVED', archivedAt: null },
      include: { hours: true },
    });
    if (!business) return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Business not found' } });

    const service = await prisma.service.findFirst({ where: { id: d.serviceId, businessId: business.id } });
    if (!service || !service.isActive || service.durationMinutes === null)
      return r.status(400).send({ error: { code: 'INVALID_SERVICE', message: 'Service is unavailable' } });
    const duration = service.durationMinutes;

    const startMinutes = minutesOfDay(d.startTime);
    const endMinutes = startMinutes + duration;
    const startAt = pktToUtc(d.date, startMinutes);
    const endAt = pktToUtc(d.date, endMinutes);

    // Business-hours + past validation (customer-selected wall clock).
    const day = pktDayOfWeek(startAt);
    const todayHours = business.hours.find((h) => h.dayOfWeek === day);
    if (!todayHours || todayHours.isClosed || !todayHours.opensAt || !todayHours.closesAt)
      return r.status(400).send({ error: { code: 'CLOSED_DAY', message: 'The business is closed on the selected day' } });
    if (startMinutes < minutesOfDay(todayHours.opensAt) || endMinutes > minutesOfDay(todayHours.closesAt))
      return r.status(400).send({ error: { code: 'OUTSIDE_HOURS', message: 'The selected time is outside business hours' } });
    if (startAt.getTime() <= Date.now())
      return r.status(400).send({ error: { code: 'IN_PAST', message: 'The selected time has already passed' } });

    // Double-booking protection: serialize concurrent booking attempts for the
    // same business with a transaction-scoped advisory lock, then re-check
    // overlap inside the transaction and insert. Two overlapping requests can
    // never both pass the check because the second waits for the first to commit.
    const booking = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${business.id}))`;
      const conflicting = await tx.booking.findFirst({
        where: {
          businessId: business.id,
          status: { in: [...BLOCKING_BOOKING_STATUSES] },
          startAt: { lt: endAt },
          endAt: { gt: startAt },
        },
        select: { id: true },
      });
      if (conflicting) throw bookingError(409, 'SLOT_TAKEN', 'That time slot was just booked. Please choose another.');
      return tx.booking.create({
        data: {
          customerId: currentUser(q).id,
          businessId: business.id,
          serviceId: service.id,
          bookingDate: new Date(Date.parse(`${d.date}T00:00:00Z`)),
          startAt,
          endAt,
          notes: d.notes,
        },
      });
    });

    return r.status(201).send({ data: publicBooking({ ...booking, business, service }) });
  });

  app.get('/api/v1/bookings', { preHandler: auth }, async (q) => {
    const u = currentUser(q);
    const filters = bookingListQuerySchema.parse(q.query ?? {});
    const dateFilter: Record<string, unknown> = {};
    if (filters.from) dateFilter.gte = Date.parse(`${filters.from}T00:00:00Z`);
    if (filters.to) dateFilter.lte = Date.parse(`${filters.to}T00:00:00Z`);
    const where: Record<string, unknown> = {};
    if (Object.keys(dateFilter).length > 0) where.bookingDate = dateFilter;
    if (filters.status) where.status = filters.status;

    if (u.role === 'BUSINESS_OWNER') {
      where.business = { ownerId: u.id };
    } else if (u.role === 'CUSTOMER') {
      where.customerId = u.id;
    }
    const bookings = await prisma.booking.findMany({
      where,
      include: { ...BOOKING_INCLUDE, customer: { select: { id: true, email: true, firstName: true, lastName: true } } },
      orderBy: [{ bookingDate: 'desc' }, { startAt: 'desc' }],
      take: 200,
    });
    return { data: bookings.map((b) => ({ ...publicBooking(b), customer: b.customer })) };
  });

  app.get('/api/v1/bookings/:id', { preHandler: auth }, async (q) => {
    const booking = await loadVisibleBooking(q, (q.params as { id: string }).id);
    return { data: publicBooking(booking) };
  });

  app.get('/api/v1/businesses/:id/bookings', { preHandler: roles('BUSINESS_OWNER') }, async (q) => {
    const id = (q.params as { id: string }).id;
    await ownedBusiness(q, id);
    const filters = bookingListQuerySchema.parse(q.query ?? {});
    const where: Record<string, unknown> = { businessId: id };
    if (filters.status) where.status = filters.status;
    const dateFilter: Record<string, unknown> = {};
    if (filters.from) dateFilter.gte = Date.parse(`${filters.from}T00:00:00Z`);
    if (filters.to) dateFilter.lte = Date.parse(`${filters.to}T00:00:00Z`);
    if (Object.keys(dateFilter).length > 0) where.bookingDate = dateFilter;
    const bookings = await prisma.booking.findMany({
      where,
      include: { ...BOOKING_INCLUDE, customer: { select: { id: true, email: true, firstName: true, lastName: true } } },
      orderBy: [{ bookingDate: 'desc' }, { startAt: 'desc' }],
      take: 200,
    });
    return { data: bookings.map((b) => ({ ...publicBooking(b), customer: b.customer })) };
  });

  app.post('/api/v1/bookings/:id/cancel', { preHandler: roles('CUSTOMER') }, async (q, r) => {
    const booking = await loadVisibleBooking(q, (q.params as { id: string }).id);
    if (booking.customerId !== currentUser(q).id)
      return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Booking not found' } });
    if (!allowedTransitions.booking[booking.status].includes('CANCELLED'))
      return r.status(409).send({ error: { code: 'INVALID_TRANSITION', message: `A ${booking.status.toLowerCase()} booking cannot be cancelled` } });
    return { data: publicBooking(await prisma.booking.update({ where: { id: booking.id }, data: { status: 'CANCELLED' }, include: BOOKING_INCLUDE })) };
  });

  app.patch('/api/v1/bookings/:id/status', { preHandler: roles('BUSINESS_OWNER', 'ADMIN') }, async (q, r) => {
    const status = bookingStatusSchema.parse((q.body as { status: string }).status);
    const booking = await loadVisibleBooking(q, (q.params as { id: string }).id);
    if (currentUser(q).role === 'BUSINESS_OWNER' && booking.business.ownerId !== currentUser(q).id)
      return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Booking not found' } });
    if (!allowedTransitions.booking[booking.status].includes(status))
      return r.status(409).send({ error: { code: 'INVALID_TRANSITION', message: `Cannot change a ${booking.status.toLowerCase()} booking to ${status.toLowerCase()}` } });
    return { data: publicBooking(await prisma.booking.update({ where: { id: booking.id }, data: { status }, include: BOOKING_INCLUDE })) };
  });

  /**
   * Customer-safe order shape: no internal user columns, no email. OrderItem
   * rows carry the purchase-time name/unitPriceMinor, so history survives
   * later product edits or deletion of the underlying product.
   */
  const publicOrder = (o: Prisma.OrderGetPayload<{ include: typeof ORDER_INCLUDE }>) => ({
    id: o.id,
    status: o.status,
    subtotalMinor: o.subtotalMinor,
    currency: o.currency,
    fulfillmentType: o.fulfillmentType,
    notes: o.notes,
    createdAt: o.createdAt,
    business: { id: o.business.id, name: o.business.name, slug: o.business.slug },
    customer: o.customer ? { firstName: o.customer.firstName, lastName: o.customer.lastName } : null,
    items: o.items.map((i) => ({
      id: i.id,
      productId: i.productId,
      name: i.name,
      unitPriceMinor: i.unitPriceMinor,
      quantity: i.quantity,
      lineTotalMinor: i.unitPriceMinor * i.quantity,
    })),
  });

  app.post('/api/v1/orders', { preHandler: roles('CUSTOMER') }, async (q, r) => {
    const d = orderSchema.parse(q.body);
    // Orders may only be placed with approved, visible businesses.
    const business = await prisma.business.findFirst({
      where: { id: d.businessId, status: 'APPROVED', archivedAt: null },
      select: { id: true },
    });
    if (!business) return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Business not found' } });
    // Reject duplicate product lines up front instead of silently merging.
    const requestedIds = d.items.map((i) => i.productId);
    if (new Set(requestedIds).size !== requestedIds.length)
      return r.status(400).send({ error: { code: 'INVALID_PRODUCTS', message: 'Duplicate products in the order' } });
    // Server re-reads every product: price, availability and business linkage
    // come from the database, never from the client.
    const products = await prisma.product.findMany({
      where: { id: { in: requestedIds }, businessId: d.businessId, isActive: true },
    });
    if (products.length !== d.items.length)
      return r.status(400).send({ error: { code: 'INVALID_PRODUCTS', message: 'One or more products are unavailable' } });
    // Purchase-time price is stored per item; integer arithmetic only.
    const subtotalMinor = d.items.reduce(
      (sum, i) => sum + products.find((p) => p.id === i.productId)!.priceMinor * i.quantity,
      0,
    );
    const created = await prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          businessId: d.businessId,
          customerId: currentUser(q).id,
          subtotalMinor,
          notes: d.notes,
          fulfillmentType: d.fulfillmentType,
          items: {
            create: d.items.map((i) => {
              const p = products.find((x) => x.id === i.productId)!;
              return { productId: p.id, name: p.name, unitPriceMinor: p.priceMinor, quantity: i.quantity };
            }),
          },
        },
        include: ORDER_INCLUDE,
      });
      return order;
    });
    return r.status(201).send({ data: publicOrder(created) });
  });

  app.get('/api/v1/orders', { preHandler: auth }, async (q) => {
    const u = currentUser(q);
    // Customers see their own orders; owners see orders for businesses they own
    // (all their businesses — the dashboard filters per business client-side).
    // Admins are not a delivery surface for orders; keep the scope explicit.
    const where = u.role === 'BUSINESS_OWNER' ? { business: { ownerId: u.id } } : { customerId: u.id };
    const rows = await prisma.order.findMany({
      where,
      include: ORDER_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return { data: rows.map(publicOrder) };
  });

  app.get('/api/v1/orders/:id', { preHandler: auth }, async (q, r) => {
    const u = currentUser(q);
    const o = await prisma.order.findUnique({
      where: { id: (q.params as { id: string }).id },
      include: ORDER_INCLUDE,
    });
    // 404 (not 403) so foreign order ids are not enumerable.
    if (!o) return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Order not found' } });
    const isOwner = u.role === 'BUSINESS_OWNER' && o.business.ownerId === u.id;
    const isCustomer = o.customerId === u.id;
    if (!isOwner && !isCustomer)
      return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Order not found' } });
    return { data: publicOrder(o) };
  });

  app.patch('/api/v1/orders/:id/status', { preHandler: auth }, async (q, r) => {
    const status = orderStatusSchema.parse((q.body as { status: string }).status);
    const u = currentUser(q);
    const o = await prisma.order.findUnique({
      where: { id: (q.params as { id: string }).id },
      include: { business: { select: { ownerId: true } } },
    });
    if (!o) return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Order not found' } });
    const isOwner = u.role === 'BUSINESS_OWNER' && o.business.ownerId === u.id;
    const isCustomer = o.customerId === u.id;
    // A customer's only permitted action is cancelling a PENDING order.
    // Everyone else (including foreign customers) gets 404/409 — never COMPLETED.
    const allowed: readonly string[] = isOwner
      ? allowedTransitions.order[o.status]
      : isCustomer && o.status === 'PENDING'
        ? ['CANCELLED']
        : [];
    if (!allowed.includes(status))
      return r.status(isOwner ? 409 : 404).send({
        error: {
          code: isOwner ? 'INVALID_TRANSITION' : 'NOT_FOUND',
          message: isOwner
            ? `Cannot change a ${o.status.toLowerCase()} order to ${status.toLowerCase()}`
            : 'Order not found',
        },
      });
    return { data: publicOrder(await prisma.order.update({ where: { id: o.id }, data: { status }, include: ORDER_INCLUDE })) };
  });

  /* ------------------------------ Admin ------------------------------ */
  app.get('/api/v1/admin/dashboard', { preHandler: roles('ADMIN') }, async () => ({
    data: {
      users: await prisma.user.count(),
      businesses: await prisma.business.count(),
      bookings: await prisma.booking.count(),
      orders: await prisma.order.count(),
    },
  }));

  app.patch('/api/v1/admin/businesses/:id/status', { preHandler: roles('ADMIN') }, async (q, r) => {
    const status = businessStatusSchema.parse((q.body as { status: string }).status);
    const b = await prisma.business.update({ where: { id: (q.params as { id: string }).id }, data: { status } });
    await prisma.auditLog.create({
      data: { actorId: currentUser(q).id, action: 'BUSINESS_STATUS_CHANGED', entityType: 'Business', entityId: b.id, metadata: { status } },
    });
    return { data: b };
  });

  return app;
}

/** Runs the HTTP server only when this module is the process entrypoint (not under vitest). */
const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const app = await buildApp();
  await app.listen({ port: Number(process.env.PORT ?? 3000), host: '0.0.0.0' });
}
