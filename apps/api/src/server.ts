import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import multipart from '@fastify/multipart';
import type { Prisma } from '@prisma/client';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import jwt from '@fastify/jwt';
import argon2 from 'argon2';
import { ZodError, z } from 'zod';
import {
  prisma,
  NOTIFICATION_TYPES,
  createNotifications,
  addCalendarMonths,
  paymentRequestCreateSchema,
  paymentMethodSchema,
  paymentMethodUpdateSchema,
  paymentRejectSchema,
  bookingPaymentCreateSchema,
  orderPaymentCreateSchema,
  customerPaymentRejectSchema,
  businessPaymentMethodSchema,
  businessPaymentMethodUpdateSchema,
  deliverySettingsSchema,
  serviceAdvanceMinor,
  resolveServiceAdvance,
  type NotificationType,
  registerSchema,
  profileUpdateSchema,
  passwordChangeSchema,
  categoryCreateSchema,
  categoryUpdateSchema,
  businessSchema,
  businessLocationSchema,
  locationPutBodySchema,
  businessUpdateSchema,
  nearbyBusinessesQuerySchema,
  serviceSchema,
  serviceUpdateSchema,
  productSchema,
  productUpdateSchema,
  businessHoursSchema,
  bookingCreateSchema,
  bookingListQuerySchema,
  availabilityQuerySchema,
  orderSchema,
  reviewCreateSchema,
  businessStatusSchema,
  bookingStatusSchema,
  orderStatusSchema,
  slugify,
  allowedTransitions,
  isOpenNow,
  distanceKm,
  boundingBoxKm,
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
  PLAN_CATALOG,
  LIVE_SUBSCRIPTION_STATUSES,
  evaluateSubscription,
  searchQuerySchema,
} from './lib.js';
import type { AuthUser, NotificationInput } from './lib.js';
import { dispatchPushNotifications } from './push.js';
import type { SubscriptionStatus } from '@prisma/client';
import { RECEIPT_ACCEPTED_TYPES, RECEIPT_KEY_PATTERN, RECEIPT_MAX_BYTES, readReceipt, receiptContentType, saveReceipt } from './receiptStorage.js';

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
  await app.register(multipart, {
    limits: { fileSize: RECEIPT_MAX_BYTES, files: 1 },
    // Only the receipt endpoint consumes multipart bodies.
    attachFieldsToBody: false,
  });

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
    return { data: { id: u.id, email: u.email, role: u.role, firstName: u.firstName, lastName: u.lastName, phone: u.phone } };
  });

  /**
   * Own-profile update. Fields are editable only on the authenticated user's
   * own row (there is no userId parameter at all — identity comes from the
   * token). Email is intentionally not editable: it is the login identity and
   * no verification workflow exists yet.
   */
  app.patch('/api/v1/auth/profile', { preHandler: auth }, async (q) => {
    const d = profileUpdateSchema.parse(q.body);
    const u = await prisma.user.update({
      where: { id: currentUser(q).id },
      data: {
        ...(d.firstName !== undefined ? { firstName: d.firstName } : {}),
        ...(d.lastName !== undefined ? { lastName: d.lastName } : {}),
        ...(d.phone !== undefined ? { phone: d.phone } : {}),
      },
      select: { id: true, email: true, role: true, firstName: true, lastName: true, phone: true },
    });
    return { data: u };
  });

  /**
   * Password change: re-proves the current password, hashes the new one, and
   * revokes every refresh token so other devices must sign in again. Passwords
   * are never logged (the logger redacts `password` fields) and the response
   * carries no secret material.
   */
  app.patch('/api/v1/auth/password', { preHandler: auth }, async (q, r) => {
    const d = passwordChangeSchema.parse(q.body);
    const u = currentUser(q);
    const row = await prisma.user.findUnique({ where: { id: u.id }, select: { passwordHash: true } });
    if (!row || !(await argon2.verify(row.passwordHash, d.currentPassword)))
      return r.status(400).send({ error: { code: 'INVALID_CREDENTIALS', message: 'Current password is incorrect' } });
    await prisma.$transaction([
      prisma.user.update({ where: { id: u.id }, data: { passwordHash: await argon2.hash(d.newPassword, { type: argon2.argon2id }) } }),
      prisma.refreshToken.updateMany({ where: { userId: u.id, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await prisma.auditLog.create({
      data: { actorId: u.id, action: 'PASSWORD_CHANGED', entityType: 'User', entityId: u.id },
    });
    return r.status(204).send();
  });

  /* --------------------------- Categories --------------------------- */
  app.get('/api/v1/categories', async () => ({
    data: await prisma.category.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
  }));

  app.get('/api/v1/admin/categories', { preHandler: roles('ADMIN') }, async () => {
    const rows = await prisma.category.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { businesses: true } } },
    });
    // Flat DTO: businessCount instead of Prisma's _count nesting.
    return { data: rows.map(({ _count, ...c }) => ({ ...c, businessCount: _count.businesses })) };
  });

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
    const category = await prisma.category.update({ where: { id: existing.id }, data });
    // Moderation trail: every category change is attributable, including the
    // activate/deactivate toggle that hides it from customer discovery.
    await prisma.auditLog.create({
      data: {
        actorId: currentUser(q).id,
        action: d.isActive === undefined ? 'CATEGORY_UPDATED' : d.isActive ? 'CATEGORY_ACTIVATED' : 'CATEGORY_DEACTIVATED',
        entityType: 'Category',
        entityId: category.id,
        metadata: { name: category.name },
      },
    });
    return { data: category };
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
    const nearActive = s.nearLat !== undefined && s.nearLng !== undefined;
    // When distance search is active, prefilter to a conservative bounding box
    // in SQL so the fetch window targets relevant rows; the exact Haversine
    // distance still decides inclusion and ordering (server-authoritative).
    const near = nearActive ? boundingBoxKm(Number(s.nearLat), Number(s.nearLng), Math.min(Math.max(Number(s.radiusKm ?? 10), 0.1), 50)) : null;
    if (near) {
      where.latitude = { not: null, gte: near.minLat, lte: near.maxLat };
      where.longitude = { not: null, gte: near.minLng, lte: near.maxLng };
    }
    // Newest-first so the first page is deterministic once more businesses exist
    // than a single page can hold.
    const businesses = await prisma.business.findMany({ where, include: PUBLIC_BUSINESS_INCLUDE, take: near ? 200 : limit, orderBy: { createdAt: 'desc' } });
    const ratingSummaries = await Promise.all(businesses.map((b) => ratingSummary(b.id)));
    const mapped = businesses.map((b, i) => ({
      id: b.id,
      name: b.name,
      slug: b.slug,
      description: b.description,
      imageUrl: b.imageUrl,
      isVerified: b.isVerified,
      address: b.address,
      city: b.city,
      locality: b.locality,
      // Decimals serialize as strings; coordinates are always JSON numbers.
      latitude: b.latitude === null ? null : Number(b.latitude),
      longitude: b.longitude === null ? null : Number(b.longitude),
      currency: b.currency,
      isOpenNow: isOpenNow(b.hours),
      averageRating: ratingSummaries[i].averageRating,
      reviewCount: ratingSummaries[i].reviewCount,
      categories: b.categories.map((bc) => bc.category),
    }));

    if (nearActive) {
      const lat = Number(s.nearLat);
      const lng = Number(s.nearLng);
      // Query-string coords are range-checked; the radius is clamped to a
      // metro-scale maximum (50 km) so "nearby" stays meaningful.
      const radius = Math.min(Math.max(Number(s.radiusKm ?? 10), 0.1), 50);
      const coordsValid =
        Number.isFinite(lat) && Math.abs(lat) <= 90 && Number.isFinite(lng) && Math.abs(lng) <= 180;
      if (coordsValid) {
        return {
          data: mapped
            // Only businesses with real configured coordinates participate in
            // distance search — never an invented placeholder location.
            .filter((b) => b.latitude !== null && b.longitude !== null)
            .map((b) => ({ ...b, distanceKm: distanceKm(lat, lng, Number(b.latitude), Number(b.longitude)) }))
            .filter((b) => b.distanceKm <= radius)
            .sort((a, b) => a.distanceKm - b.distanceKm)
            .slice(0, limit),
        };
      }
    }
    return { data: mapped };
  });

  /**
   * Dedicated nearby search (Phase 11). Same public-business visibility rules
   * as the list endpoint, one authoritative server-side Haversine distance,
   * radius validation, and businesses without configured coordinates excluded.
   */
  app.get('/api/v1/businesses/nearby', async (q, r) => {
    const parsed = nearbyBusinessesQuerySchema.safeParse(q.query);
    if (!parsed.success)
      return r.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid nearby query' } });
    const { lat, lng, radiusKm, limit } = parsed.data;
    const take = Math.min(limit ?? 20, 100);
    // Conservative bounding box (a square that fully contains the radius
    // circle, so it never excludes an in-radius row) keeps the SQL scan
    // relevant in a populated database; the exact Haversine distance still
    // decides inclusion and ordering below.
    const bbox = boundingBoxKm(lat, lng, radiusKm);
    const businesses = await prisma.business.findMany({
      where: {
        status: 'APPROVED',
        archivedAt: null,
        latitude: bbox.minLat > -90 && bbox.maxLat < 90 ? { not: null, gte: bbox.minLat, lte: bbox.maxLat } : { not: null },
        longitude: bbox.minLng > -180 && bbox.maxLng < 180 ? { not: null, gte: bbox.minLng, lte: bbox.maxLng } : { not: null },
      },
      include: PUBLIC_BUSINESS_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const withDistance = (
      await Promise.all(
        businesses.map(async (b) => {
          const distance = distanceKm(lat, lng, Number(b.latitude), Number(b.longitude));
          if (distance > radiusKm) return null;
          const summary = await ratingSummary(b.id);
          return {
            id: b.id,
            name: b.name,
            slug: b.slug,
            description: b.description,
            imageUrl: b.imageUrl,
            isVerified: b.isVerified,
            address: b.address,
            city: b.city,
            locality: b.locality,
            latitude: b.latitude === null ? null : Number(b.latitude),
            longitude: b.longitude === null ? null : Number(b.longitude),
            currency: b.currency,
            isOpenNow: isOpenNow(b.hours),
            averageRating: summary.averageRating,
            reviewCount: summary.reviewCount,
            categories: b.categories.map((bc) => bc.category),
            distanceKm: Math.round(distance * 100) / 100,
          };
        }),
      )
    )
      .filter((v): v is NonNullable<typeof v> => v !== null)
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, take);
    return { data: withDistance };
  });

  /**
   * Unified marketplace search (Phase 14). One server-side query answers
   * "what can I book or buy?" across businesses, services, and products with
   * a clearly typed result shape (`type: business | service | product`), so
   * a customer searching "repair" can tell a repair BUSINESS from a specific
   * repair SERVICE. Relevance is honest and transparent: exact name match >
   * name prefix > word-prefix > substring, businesses before their own
   * services/products. Distance, when requested, is always computed here —
   * the client never supplies one. Results are cursor-paginated.
   */
  app.get('/api/v1/search', async (q, r) => {
    const parsed = searchQuerySchema.safeParse(q.query);
    if (!parsed.success)
      return r.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid search query' } });
    const { q: term, categoryId, type, openNow, minRating, sort, limit, cursor, lat, lng, radiusKm } = parsed.data;

    // Visibility first: only approved, non-archived businesses and their
    // ACTIVE services/products are publicly discoverable — everywhere below.
    const businessVisibility = { status: 'APPROVED' as const, archivedAt: null };
    const activeCatalog = { isActive: true };

    // Optional category scope: the authoritative identifier is the ID.
    const categoryFilter = categoryId
      ? { categories: { some: { category: { is: { id: categoryId, isActive: true } } } } }
      : {};

    // Text matching. Every token must be satisfied somewhere: the entity's
    // own name/description, OR (for businesses) one of its active
    // services/products — so "bike repair" surfaces a business offering bike
    // repair even when the business name alone does not mention it.
    // For services/products every token must land in the entity itself
    // (AND across tokens), so "paginate works 123" never matches an unrelated
    // business that merely shares the word "works".
    const tokens = (term ?? '').split(/\s+/).filter((t) => t.length > 0);
    const textMatch = (columns: { name: string; description: string }) =>
      tokens.map((t) => ({
        OR: [
          { [columns.name]: { contains: t, mode: 'insensitive' as const } },
          { [columns.description]: { contains: t, mode: 'insensitive' as const } },
        ],
      }));

    // Distance support: when the customer's coordinates arrive, only real
    // configured coordinates participate; bounding-box prefilter in SQL keeps
    // the scan relevant, the exact Haversine decides inclusion and order.
    const useDistance = lat !== undefined && lng !== undefined;
    const radius = useDistance ? Math.min(Math.max(radiusKm ?? 10, 0.1), 50) : null;
    const bbox = useDistance && radius ? boundingBoxKm(lat, lng, radius) : null;
    const distanceWhere =
      bbox && bbox.minLat > -90 && bbox.maxLat < 90
        ? { latitude: { not: null, gte: bbox.minLat, lte: bbox.maxLat }, longitude: { not: null, gte: bbox.minLng, lte: bbox.maxLng } }
        : useDistance
          ? { latitude: { not: null }, longitude: { not: null } }
          : {};

    // --- Businesses -------------------------------------------------------
    const bizWhere: Record<string, unknown> = { ...businessVisibility, ...categoryFilter, ...distanceWhere };
    if (term)
      // AND across tokens; per token, ANY of: own name/description, one of its
      // active services, or one of its active products.
      bizWhere.AND = tokens.map((t) => ({
        OR: [
          { name: { contains: t, mode: 'insensitive' as const } },
          { description: { contains: t, mode: 'insensitive' as const } },
          { services: { some: { isActive: true, OR: [{ name: { contains: t, mode: 'insensitive' as const } }, { description: { contains: t, mode: 'insensitive' as const } }] } } },
          { products: { some: { isActive: true, OR: [{ name: { contains: t, mode: 'insensitive' as const } }, { description: { contains: t, mode: 'insensitive' as const } }] } } },
        ],
      }));

    // --- Services / products (scoped to visible businesses) ---------------
    const svcWhere: Record<string, unknown> = {
      isActive: true,
      business: { ...businessVisibility, ...categoryFilter, ...distanceWhere },
    };
    if (term) svcWhere.AND = textMatch({ name: 'name', description: 'description' });
    const prodWhere: Record<string, unknown> = {
      isActive: true,
      business: { ...businessVisibility, ...categoryFilter, ...distanceWhere },
    };
    if (term) prodWhere.AND = textMatch({ name: 'name', description: 'description' });

    const wantBusinesses = type === 'all' || type === 'business';
    const wantServices = type === 'all' || type === 'service';
    const wantProducts = type === 'all' || type === 'product';

    const [bizRows, svcRows, prodRows] = await Promise.all([
      wantBusinesses
        ? prisma.business.findMany({
            where: bizWhere,
            // Services/products are fetched only for relevance scoring and the
            // sample-services preview — never as authorization-bypassing data.
            include: {
              ...PUBLIC_BUSINESS_INCLUDE,
              services: { where: activeCatalog, select: { id: true, name: true, description: true, priceMinor: true, currency: true, durationMinutes: true } },
              products: { where: activeCatalog, select: { id: true, name: true, description: true } },
            },
            orderBy: { createdAt: 'desc' },
            take: 200,
          })
        : Promise.resolve([]),
      wantServices
        ? prisma.service.findMany({
            where: svcWhere,
            include: { business: { select: { id: true, name: true, slug: true, city: true, locality: true, latitude: true, longitude: true, currency: true, hours: true } } },
            orderBy: { name: 'asc' },
            take: 200,
          })
        : Promise.resolve([]),
      wantProducts
        ? prisma.product.findMany({
            where: prodWhere,
            include: { business: { select: { id: true, name: true, slug: true, city: true, locality: true, latitude: true, longitude: true, currency: true } } },
            orderBy: { name: 'asc' },
            take: 200,
          })
        : Promise.resolve([]),
    ]);

    // Rating summaries in one batch; the DB does the aggregation.
    const involvedIds = [...new Set([...bizRows.map((b) => b.id), ...svcRows.map((s) => s.business.id), ...prodRows.map((p) => p.business.id)])];
    const ratingRows = involvedIds.length
      ? await prisma.review.groupBy({
          by: ['businessId'],
          // Moderation (Phase 15): admin-hidden reviews never move ratings.
          where: { businessId: { in: involvedIds }, isHiddenAt: null },
          _avg: { rating: true },
          _count: { rating: true },
        })
      : [];
    const ratings = new Map(ratingRows.map((row) => [row.businessId, { avg: row._avg.rating, count: row._count.rating }]));
    const ratingOf = (id: string) => {
      const r = ratings.get(id);
      return { averageRating: r && r.avg !== null ? Math.round(r.avg * 10) / 10 : null, reviewCount: r?.count ?? 0 };
    };

    type Unified =
      | { type: 'business'; id: string; businessId: string; businessName: string; businessSlug: string; name: string; description: string | null; imageUrl: string | null; city: string; locality: string | null; isVerified: boolean; isOpenNow: boolean; averageRating: number | null; reviewCount: number; categories: { id: string; name: string; slug: string }[]; distanceKm: number | null; sampleServices: { id: string; name: string; priceMinor: number; currency: string; durationMinutes: number | null }[]; score: number }
      | { type: 'service'; id: string; businessId: string; businessName: string; businessSlug: string; name: string; description: string | null; priceMinor: number; currency: string; durationMinutes: number | null; distanceKm: number | null; averageRating: number | null; reviewCount: number; score: number }
      | { type: 'product'; id: string; businessId: string; businessName: string; businessSlug: string; name: string; description: string | null; priceMinor: number; currency: string; imageUrl: string | null; distanceKm: number | null; averageRating: number | null; reviewCount: number; score: number };

    const lower = (s: string) => s.toLowerCase();
    const tokensLower = tokens.map(lower);
    // Transparent relevance score: exact name match 400, name starts-with 300,
    // name contains a whole token 200, name contains the token 100, plus 2
    // when the term also appears in the description. Ties break on rating.
    const scoreName = (name: string, description: string | null) => {
      const n = lower(name);
      let s = 0;
      for (const t of tokensLower) {
        if (n === t) s += 400;
        else if (n.startsWith(t)) s += 300;
        else if (new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(n)) s += 200;
        else if (n.includes(t)) s += 100;
        if (description && lower(description).includes(t)) s += 2;
      }
      return s;
    };
    // A business can match ONLY through its catalog ("bike repair" where the
    // business name never mentions bikes): without catalog credit it would sit
    // at score 0, buried under unrelated name matches. Catalog evidence ranks
    // below a direct name hit (60/token) but above pure noise.
    const businessCatalogScore = (b: {
      name: string;
      description: string | null;
      services?: { name: string; description: string | null }[];
      products?: { name: string; description: string | null }[];
    }) => {
      const tokensNotInProfile = tokensLower.filter(
        (t) => !lower(b.name).includes(t) && !(b.description && lower(b.description).includes(t)),
      );
      if (tokensNotInProfile.length === 0) return 0;
      const joinText = (arr: { name: string; description: string | null }[] | undefined) =>
        (arr ?? []).map((r) => `${lower(r.name)} ${r.description ? lower(r.description) : ''}`).join(' \n ');
      const catalog = `${joinText(b.services)} \n ${joinText(b.products)}`;
      let s = 0;
      for (const t of tokensNotInProfile) if (catalog.includes(t)) s += 60;
      return s;
    };
    const distanceOf = (latitude: unknown, longitude: unknown): number | null => {
      if (!useDistance || latitude === null || longitude === null) return null;
      const d = distanceKm(lat!, lng!, Number(latitude), Number(longitude));
      return radius && d > radius ? null : d;
    };

    const results: Unified[] = [];
    for (const b of bizRows) {
      const d = distanceOf(b.latitude, b.longitude);
      if (useDistance && d === null) continue;
      if (openNow === 'true' && !isOpenNow(b.hours)) continue;
      const { averageRating, reviewCount } = ratingOf(b.id);
      if (minRating !== undefined && (averageRating === null || averageRating < minRating)) continue;
      results.push({
        type: 'business',
        id: b.id,
        businessId: b.id,
        businessName: b.name,
        businessSlug: b.slug,
        name: b.name,
        description: b.description,
        imageUrl: b.imageUrl,
        city: b.city,
        locality: b.locality,
        isVerified: b.isVerified,
        isOpenNow: isOpenNow(b.hours),
        averageRating,
        reviewCount,
        categories: b.categories.map((bc) => ({ id: bc.category.id, name: bc.category.name, slug: bc.category.slug })),
        distanceKm: d === null ? null : Math.round(d * 100) / 100,
        sampleServices: b.services.slice(0, 3).map((s) => ({ id: s.id, name: s.name, priceMinor: s.priceMinor, currency: s.currency, durationMinutes: s.durationMinutes })),
        score: scoreName(b.name, b.description) + businessCatalogScore(b),
      });
    }
    for (const s of svcRows) {
      const d = distanceOf(s.business.latitude, s.business.longitude);
      if (useDistance && d === null) continue;
      const { averageRating, reviewCount } = ratingOf(s.business.id);
      if (minRating !== undefined && (averageRating === null || averageRating < minRating)) continue;
      results.push({
        type: 'service',
        id: s.id,
        businessId: s.business.id,
        businessName: s.business.name,
        businessSlug: s.business.slug,
        name: s.name,
        description: s.description,
        priceMinor: s.priceMinor,
        currency: s.business.currency,
        durationMinutes: s.durationMinutes,
        distanceKm: d === null ? null : Math.round(d * 100) / 100,
        averageRating,
        reviewCount,
        score: scoreName(s.name, s.description),
      });
    }
    for (const p of prodRows) {
      const d = distanceOf(p.business.latitude, p.business.longitude);
      if (useDistance && d === null) continue;
      const { averageRating, reviewCount } = ratingOf(p.business.id);
      if (minRating !== undefined && (averageRating === null || averageRating < minRating)) continue;
      results.push({
        type: 'product',
        id: p.id,
        businessId: p.business.id,
        businessName: p.business.name,
        businessSlug: p.business.slug,
        name: p.name,
        description: p.description,
        priceMinor: p.priceMinor,
        currency: p.business.currency,
        imageUrl: p.imageUrl,
        distanceKm: d === null ? null : Math.round(d * 100) / 100,
        averageRating,
        reviewCount,
        score: scoreName(p.name, p.description),
      });
    }

    // Ordering. `distance` without coordinates degrades honestly to
    // relevance (the response echoes the effective sort); nothing else is
    // implicit — labels match what actually happened.
    const effectiveSort = sort === 'distance' && !useDistance ? 'relevance' : sort;
    if (effectiveSort === 'distance') {
      results.sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity) || b.score - a.score);
    } else if (effectiveSort === 'rating') {
      results.sort((a, b) => (b.averageRating ?? -1) - (a.averageRating ?? -1) || b.reviewCount - a.reviewCount || b.score - a.score);
    } else {
      results.sort((a, b) => b.score - a.score || (b.averageRating ?? -1) - (a.averageRating ?? -1));
    }

    // Cursor pagination over the merged, ordered list: the cursor is the
    // offset within THIS result set (stable for one query+filters combination).
    let startIdx = 0;
    if (cursor) {
      const asInt = Number.parseInt(cursor, 10);
      if (Number.isInteger(asInt) && asInt >= 0) startIdx = asInt;
    }
    const page = results.slice(startIdx, startIdx + limit);
    const nextCursor = startIdx + limit < results.length ? String(startIdx + limit) : null;
    return { data: { results: page, nextCursor, total: results.length, sort: effectiveSort } };
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
    const summary = await ratingSummary(b.id);
    return {
      data: {
        id: b.id,
        name: b.name,
        slug: b.slug,
        description: b.description,
        imageUrl: b.imageUrl,
        isVerified: b.isVerified,
        averageRating: summary.averageRating,
        reviewCount: summary.reviewCount,
        phone: b.phone,
        email: b.email,
        address: b.address,
        city: b.city,
        locality: b.locality,
        // Decimals serialize as strings; coordinates are always JSON numbers.
        latitude: b.latitude === null ? null : Number(b.latitude),
        longitude: b.longitude === null ? null : Number(b.longitude),
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
    // create form). They stay null until the owner configures a real location
    // in Business mode; no city-centre or other invented fallback is applied.
    // Dev/preview-only convenience (AUTO_APPROVE_BUSINESSES=true): skip the
    // admin approval wait for NEW businesses. Strictly server-configured —
    // there is deliberately no client-controllable path to approval, and the
    // default stays PENDING.
    const status = process.env.AUTO_APPROVE_BUSINESSES === 'true' ? 'APPROVED' : 'PENDING';
    const b = await prisma.business.create({
      data: {
        ...input,
        latitude: latitude ?? null,
        longitude: longitude ?? null,
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

  /* ----------------------- Business location (Phase 11) ------------- */

  /** Owner-facing location view: coordinates plus configured-state flag. */
  const locationPayload = (b: { latitude: unknown; longitude: unknown }) => ({
    latitude: b.latitude === null ? null : Number(b.latitude),
    longitude: b.longitude === null ? null : Number(b.longitude),
    isConfigured: b.latitude !== null && b.longitude !== null,
  });

  app.get('/api/v1/businesses/:id/location', { preHandler: roles('BUSINESS_OWNER') }, async (q, r) => {
    const business = await ownedBusiness(q, (q.params as { id: string }).id);
    return { data: locationPayload(business) };
  });

  /**
   * Sets or clears the business's real coordinates. Clearing is explicit —
   * `{ latitude: null, longitude: null }` (or a bare JSON `null` body) — the
   * server never invents a location, and clearing one simply removes the
   * business from distance-based nearby results.
   */
  app.put('/api/v1/businesses/:id/location', { preHandler: roles('BUSINESS_OWNER') }, async (q, r) => {
    const id = (q.params as { id: string }).id;
    await ownedBusiness(q, id);
    // Bare `null` bodies are an accepted alias for clearing; a missing body
    // (undefined) is invalid — clearing is always deliberate.
    const parsed = locationPutBodySchema.safeParse(q.body ?? null);
    if (!parsed.success)
      return r.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid location payload' } });
    const data =
      parsed.data === null
        ? { latitude: null, longitude: null }
        : { latitude: parsed.data.latitude, longitude: parsed.data.longitude };
    await prisma.business.update({ where: { id }, data });
    return {
      data: {
        // Echo back as JSON numbers, matching the GET endpoints.
        latitude: data.latitude === null ? null : Number(data.latitude),
        longitude: data.longitude === null ? null : Number(data.longitude),
        isConfigured: data.latitude !== null,
      },
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

  /* ------------------- Subscriptions (Phase 7A foundation) ---------- */

  /**
   * Ensures the seeded plan rows exist. Idempotent (upsert by slug); re-running
   * never clobbers admin-edited prices (update is a no-op). Returns the plan
   * requested by slug.
   */
  const ensurePlan = async (slug: string) => {
    const spec = PLAN_CATALOG.find((p) => p.slug === slug);
    if (!spec) throw Object.assign(new Error('Unknown plan'), { statusCode: 500 });
    const existing = await prisma.plan.findUnique({ where: { slug } });
    if (existing) return existing;
    try {
      return await prisma.plan.create({ data: { ...spec } });
    } catch (e) {
      // Fresh-DB race: a parallel worker created it between our read and write.
      if ((e as { code?: string }).code !== 'P2002') throw e;
      return await prisma.plan.findUniqueOrThrow({ where: { slug } });
    }
  };

  /**
   * Client-safe subscription DTO: includes the plan for display and the
   * evaluated (lazily-expired) status. Historical rows are never returned.
   */
  const publicSubscription = (s: {
    id: string;
    status: SubscriptionStatus;
    trialStartAt: Date | null;
    trialEndAt: Date | null;
    currentPeriodStartAt: Date;
    currentPeriodEndAt: Date;
    cancelledAt: Date | null;
    plan: { slug: string; name: string; description: string | null; monthlyPriceMinor: number; currency: string; trialDays: number };
  }) => ({
    id: s.id,
    status: evaluateSubscription(s),
    trialStartAt: s.trialStartAt,
    trialEndAt: s.trialEndAt,
    currentPeriodStartAt: s.currentPeriodStartAt,
    currentPeriodEndAt: s.currentPeriodEndAt,
    cancelledAt: s.cancelledAt,
    plan: s.plan,
  });

  /** Latest subscription row for a business (any status), plan included. */
  const latestSubscription = (businessId: string) =>
    prisma.businessSubscription.findFirst({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
      include: { plan: true },
    });

  app.get('/api/v1/businesses/:id/subscription', { preHandler: roles('BUSINESS_OWNER') }, async (q, r) => {
    const id = (q.params as { id: string }).id;
    await ownedBusiness(q, id);
    // Opportunistic lazy expiry: normalize a past-period TRIAL/ACTIVE row so
    // reads are consistent even without a background job.
    const current = await latestSubscription(id);
    if (current && evaluateSubscription(current) === 'EXPIRED' && LIVE_SUBSCRIPTION_STATUSES.includes(current.status)) {
      await prisma.businessSubscription.update({ where: { id: current.id }, data: { status: 'EXPIRED' } });
      current.status = 'EXPIRED';
    }
    const sub = current ? publicSubscription(current) : null;
    return { data: sub };
  });

  /**
   * Starts the plan's free trial. One live (TRIAL/ACTIVE) subscription per
   * business is enforced the same way double-booking is: a transaction-scoped
   * advisory lock keyed on the business id, a re-check inside the lock, then
   * insert. Dates are always server-generated; the client sends nothing.
   */
  app.post('/api/v1/businesses/:id/subscription/trial', { preHandler: roles('BUSINESS_OWNER') }, async (q, r) => {
    const id = (q.params as { id: string }).id;
    await ownedBusiness(q, id);
    const plan = await ensurePlan('nearbyorders-business');
    const now = new Date();
    const trialEnd = new Date(now.getTime() + plan.trialDays * 86_400_000);
    try {
      const created = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
        const existing = await tx.businessSubscription.findFirst({
          where: { businessId: id, status: { in: [...LIVE_SUBSCRIPTION_STATUSES] } },
          select: { id: true },
        });
        if (existing) throw Object.assign(new Error('already-live'), { code: 'ALREADY_SUBSCRIBED' });
        return tx.businessSubscription.create({
          data: {
            businessId: id,
            planId: plan.id,
            status: 'TRIAL',
            trialStartAt: now,
            trialEndAt: trialEnd,
            currentPeriodStartAt: now,
            currentPeriodEndAt: trialEnd,
          },
          include: { plan: true },
        });
      });
      await prisma.auditLog.create({
        data: { actorId: currentUser(q).id, action: 'SUBSCRIPTION_TRIAL_STARTED', entityType: 'BusinessSubscription', entityId: created.id, metadata: { businessId: id, planSlug: plan.slug } },
      });
      return r.status(201).send({ data: publicSubscription(created) });
    } catch (e) {
      if ((e as { code?: string }).code === 'ALREADY_SUBSCRIBED')
        return r.status(409).send({ error: { code: 'ALREADY_SUBSCRIBED', message: 'This business already has an active or trial subscription' } });
      throw e;
    }
  });

  /**
   * Cancels the live subscription at period end: it stops renewing; access
   * continues until currentPeriodEndAt, then lazy expiry marks it EXPIRED.
   * Only the live row is cancellable — history stays immutable.
   */
  app.post('/api/v1/businesses/:id/subscription/cancel', { preHandler: roles('BUSINESS_OWNER') }, async (q, r) => {
    const id = (q.params as { id: string }).id;
    await ownedBusiness(q, id);
    const current = await latestSubscription(id);
    if (!current || !LIVE_SUBSCRIPTION_STATUSES.includes(current.status))
      return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'No active or trial subscription to cancel' } });
    const cancelled = await prisma.businessSubscription.update({
      where: { id: current.id },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
      include: { plan: true },
    });
    await prisma.auditLog.create({
      data: { actorId: currentUser(q).id, action: 'SUBSCRIPTION_CANCELLED', entityType: 'BusinessSubscription', entityId: cancelled.id, metadata: { businessId: id } },
    });
    return { data: publicSubscription(cancelled) };
  });

  /* ------------------- Manual subscription payments (Phase 7B) ------- */

  /** Public shape of a pay-in channel for businesses (no admin-only data). */
  const publicPaymentMethod = (m: {
    id: string;
    name: string;
    type: string;
    accountTitle: string;
    accountNumber: string;
    iban: string | null;
    instructions: string | null;
  }) => ({
    id: m.id,
    name: m.name,
    type: m.type,
    accountTitle: m.accountTitle,
    accountNumber: m.accountNumber,
    iban: m.iban,
    instructions: m.instructions,
  });

  /** Owner-safe payment-request DTO: business-safe fields, no reviewer internals. */
  const ownerPaymentRequest = (p: {
    id: string;
    status: string;
    amountMinor: number;
    currency: string;
    transactionReference: string;
    receiptStorageKey: string;
    rejectionReason: string | null;
    submittedAt: Date;
    reviewedAt: Date | null;
    subscription: { id: string } | null;
    paymentMethod: { id: string; name: string; type: string };
  }) => ({
    id: p.id,
    status: p.status,
    amountMinor: p.amountMinor,
    currency: p.currency,
    transactionReference: p.transactionReference,
    receiptStorageKey: p.receiptStorageKey,
    rejectionReason: p.rejectionReason,
    submittedAt: p.submittedAt,
    reviewedAt: p.reviewedAt,
    subscriptionId: p.subscription?.id ?? null,
    paymentMethod: { id: p.paymentMethod.id, name: p.paymentMethod.name, type: p.paymentMethod.type },
  });

  /** Active pay-in channels in display order. Public to authenticated businesses. */
  app.get('/api/v1/subscription/payment-methods', { preHandler: auth }, async () => {
    const methods = await prisma.paymentMethod.findMany({
      where: { isActive: true },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });
    return { data: methods.map(publicPaymentMethod) };
  });

  /**
   * REAL receipt upload (product-wide rule: upload, never a URL field). The
   * business uploads the picked image file; the server stores the bytes and
   * returns an opaque storage key for the payment request. No user-facing
   * receipt URL exists — receipts are only readable through the authorized
   * view endpoint below.
   */
  app.post('/api/v1/subscription/payment-receipts', { preHandler: roles('BUSINESS_OWNER') }, async (q, r) => {
    const file = await q.file();
    if (!file) return r.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'A receipt image file is required' } });
    if (!RECEIPT_ACCEPTED_TYPES.includes(file.mimetype as (typeof RECEIPT_ACCEPTED_TYPES)[number])) {
      return r.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Receipts must be JPG, PNG or WebP images' } });
    }
    try {
      const bytes = await file.toBuffer();
      const storageKey = await saveReceipt(bytes, file.mimetype);
      return r.status(201).send({ data: { storageKey } });
    } catch (e) {
      if ((e as { code?: string }).code === 'FST_PART_FILE_LIMIT_EXCEEDED' || (e as { statusCode?: number }).statusCode === 413)
        return r.status(400).send({ error: { code: 'VALIDATION_ERROR', message: `Receipts must be ${Math.round(RECEIPT_MAX_BYTES / (1024 * 1024))} MB or smaller` } });
      throw e;
    }
  });

  /**
   * Receipt bytes for an authorized viewer only: the owning business or an
   * ADMIN. Storage keys are opaque and validated before any disk access, so
   * no path traversal or public URL is ever exposed. The key itself contains
   * a slash (`receipts/<uuid>.<ext>`), so the route is a wildcard and the
   * full remainder is the key — a single `:param` would never match.
   */
  app.get('/api/v1/subscription/payment-receipts/*', { preHandler: auth }, async (q, r) => {
    const storageKey = (q.params as { '*': string })['*'];
    if (!RECEIPT_KEY_PATTERN.test(storageKey))
      return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Receipt not found' } });
    const request = await prisma.subscriptionPaymentRequest.findFirst({ where: { receiptStorageKey: storageKey }, include: { business: { select: { ownerId: true } } } });
    if (!request)
      return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Receipt not found' } });
    const user = currentUser(q);
    const authorized = user.role === 'ADMIN' || request.business.ownerId === user.id;
    if (!authorized)
      return r.status(403).send({ error: { code: 'FORBIDDEN', message: 'You cannot view this receipt' } });
    const bytes = await readReceipt(storageKey);
    if (!bytes) return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Receipt not found' } });
    return r.header('content-type', receiptContentType(storageKey) ?? 'application/octet-stream').send(bytes);
  });

  /**
   * Payment history for one owned business, newest first. Simple keyset
   * pagination on (submittedAt, id) via cursor param.
   */
  app.get('/api/v1/businesses/:id/subscription/payment-requests', { preHandler: roles('BUSINESS_OWNER') }, async (q, r) => {
    const id = (q.params as { id: string }).id;
    await ownedBusiness(q, id);
    const query = z
      .object({ limit: z.coerce.number().int().min(1).max(50).optional(), cursor: z.string().optional() })
      .parse(q.query ?? {});
    const requests = await prisma.subscriptionPaymentRequest.findMany({
      where: { businessId: id },
      orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
      take: query.limit ?? 20,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: { paymentMethod: { select: { id: true, name: true, type: true } }, subscription: { select: { id: true } } },
    });
    return {
      data: {
        items: requests.map(ownerPaymentRequest),
        nextCursor: requests.length === (query.limit ?? 20) ? requests[requests.length - 1].id : null,
      },
    };
  });

  /**
   * Submits manual payment proof. The amount is always the server-computed
   * plan price (the client never sends money values); the receipt is a
   * storage key returned by the existing image-upload abstraction — never a
   * user-facing URL. Duplicate protection: one PENDING request per business.
   */
  app.post('/api/v1/businesses/:id/subscription/payment-requests', { preHandler: roles('BUSINESS_OWNER') }, async (q, r) => {
    const id = (q.params as { id: string }).id;
    await ownedBusiness(q, id);
    const body = paymentRequestCreateSchema.parse(q.body);

    const method = await prisma.paymentMethod.findFirst({ where: { id: body.paymentMethodId, isActive: true } });
    if (!method) return r.status(400).send({ error: { code: 'INVALID_PAYMENT_METHOD', message: 'Choose a valid payment method' } });

    const plan = await ensurePlan('nearbyorders-business');
    const now = new Date();
    const current = await latestSubscription(id);
    const live = current && evaluateSubscription(current) === current.status ? current : null; // still TRIAL/ACTIVE by its own clock

    // Duplicate guard (checked again inside the advisory-lock transaction).
    const pending = await prisma.subscriptionPaymentRequest.findFirst({ where: { businessId: id, status: 'PENDING' }, select: { id: true } });
    if (pending) return r.status(409).send({ error: { code: 'PAYMENT_ALREADY_PENDING', message: 'You already have a payment awaiting verification. Wait for the review or cancel it from your payment history.' } });

    try {
      const created = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
        const dup = await tx.subscriptionPaymentRequest.findFirst({ where: { businessId: id, status: 'PENDING' }, select: { id: true } });
        if (dup) throw Object.assign(new Error('dup'), { code: 'PAYMENT_ALREADY_PENDING' });
        return tx.subscriptionPaymentRequest.create({
          data: {
            businessId: id,
            subscriptionId: live?.id ?? null,
            paymentMethodId: method.id,
            amountMinor: plan.monthlyPriceMinor,
            currency: plan.currency,
            transactionReference: body.transactionReference,
            receiptStorageKey: body.receiptStorageKey,
            status: 'PENDING',
            submittedAt: now,
          },
        });
      });
      await prisma.auditLog.create({
        data: { actorId: currentUser(q).id, action: 'SUBSCRIPTION_PAYMENT_SUBMITTED', entityType: 'SubscriptionPaymentRequest', entityId: created.id, metadata: { businessId: id, paymentMethodId: method.id, amountMinor: created.amountMinor } },
      });
      const withRelations = await prisma.subscriptionPaymentRequest.findUniqueOrThrow({
        where: { id: created.id },
        include: { paymentMethod: { select: { id: true, name: true, type: true } }, subscription: { select: { id: true } } },
      });
      return r.status(201).send({ data: ownerPaymentRequest(withRelations) });
    } catch (e) {
      if ((e as { code?: string }).code === 'PAYMENT_ALREADY_PENDING')
        return r.status(409).send({ error: { code: 'PAYMENT_ALREADY_PENDING', message: 'You already have a payment awaiting verification' } });
      throw e;
    }
  });

  /** Single payment request; only the owning business can view it. */
  app.get('/api/v1/businesses/:id/subscription/payment-requests/:requestId', { preHandler: roles('BUSINESS_OWNER') }, async (q, r) => {
    const id = (q.params as { id: string }).id;
    const requestId = (q.params as { requestId: string }).requestId;
    await ownedBusiness(q, id);
    const req = await prisma.subscriptionPaymentRequest.findFirst({
      where: { id: requestId, businessId: id },
      include: { paymentMethod: { select: { id: true, name: true, type: true } }, subscription: { select: { id: true } } },
    });
    if (!req) return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Payment request not found' } });
    return { data: ownerPaymentRequest(req) };
  });

  /**
   * Owner-side cancellation of their own PENDING request (e.g. wrong
   * reference typed). Never touches approved/rejected rows.
   */
  app.post('/api/v1/businesses/:id/subscription/payment-requests/:requestId/cancel', { preHandler: roles('BUSINESS_OWNER') }, async (q, r) => {
    const id = (q.params as { id: string }).id;
    const requestId = (q.params as { requestId: string }).requestId;
    await ownedBusiness(q, id);
    const req = await prisma.subscriptionPaymentRequest.findFirst({ where: { id: requestId, businessId: id } });
    if (!req) return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Payment request not found' } });
    if (req.status !== 'PENDING')
      return r.status(409).send({ error: { code: 'NOT_PENDING', message: 'Only a pending payment request can be cancelled' } });
    const cancelled = await prisma.subscriptionPaymentRequest.update({
      where: { id: req.id },
      data: { status: 'CANCELLED', reviewedAt: new Date() },
      include: { paymentMethod: { select: { id: true, name: true, type: true } }, subscription: { select: { id: true } } },
    });
    await prisma.auditLog.create({
      data: { actorId: currentUser(q).id, action: 'SUBSCRIPTION_PAYMENT_CANCELLED', entityType: 'SubscriptionPaymentRequest', entityId: req.id, metadata: { businessId: id } },
    });
    return { data: ownerPaymentRequest(cancelled) };
  });

  /* ------------------- Admin: payments & methods (Phase 7B) ----------- */

  /** Admin DTO: adds review metadata (reviewer id) the owner DTO omits. */
  const adminPaymentRequest = (p: {
    id: string;
    status: string;
    amountMinor: number;
    currency: string;
    transactionReference: string;
    receiptStorageKey: string;
    rejectionReason: string | null;
    submittedAt: Date;
    reviewedAt: Date | null;
    reviewedByUserId: string | null;
    subscription: { id: string; status: string } | null;
    paymentMethod: { id: string; name: string; type: string; accountTitle: string; accountNumber: string; iban: string | null };
    business: { id: string; name: string; slug: string; owner: { id: string; email: string; firstName: string | null; lastName: string | null } };
  }) => ({
    id: p.id,
    status: p.status,
    amountMinor: p.amountMinor,
    currency: p.currency,
    transactionReference: p.transactionReference,
    receiptStorageKey: p.receiptStorageKey,
    rejectionReason: p.rejectionReason,
    submittedAt: p.submittedAt,
    reviewedAt: p.reviewedAt,
    reviewedByUserId: p.reviewedByUserId,
    subscription: p.subscription ? { id: p.subscription.id, status: p.subscription.status } : null,
    paymentMethod: p.paymentMethod,
    business: {
      id: p.business.id,
      name: p.business.name,
      slug: p.business.slug,
      owner: { id: p.business.owner.id, email: p.business.owner.email, firstName: p.business.owner.firstName, lastName: p.business.owner.lastName },
    },
  });

  const PAYMENT_REQUEST_INCLUDE = {
    paymentMethod: { select: { id: true, name: true, type: true, accountTitle: true, accountNumber: true, iban: true } },
    subscription: { select: { id: true, status: true } },
    business: {
      select: { id: true, name: true, slug: true, owner: { select: { id: true, email: true, firstName: true, lastName: true } } },
    },
  } as const;

  app.get('/api/v1/admin/subscription/payment-requests', { preHandler: roles('ADMIN') }, async (q) => {
    const query = z
      .object({
        status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
        cursor: z.string().optional(),
      })
      .parse(q.query ?? {});
    const requests = await prisma.subscriptionPaymentRequest.findMany({
      where: query.status ? { status: query.status } : undefined,
      orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
      take: query.limit ?? 50,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: PAYMENT_REQUEST_INCLUDE,
    });
    return {
      data: {
        items: requests.map(adminPaymentRequest),
        nextCursor: requests.length === (query.limit ?? 50) ? requests[requests.length - 1].id : null,
      },
    };
  });

  app.get('/api/v1/admin/subscription/payment-requests/:id', { preHandler: roles('ADMIN') }, async (q, r) => {
    const req = await prisma.subscriptionPaymentRequest.findUnique({
      where: { id: (q.params as { id: string }).id },
      include: PAYMENT_REQUEST_INCLUDE,
    });
    if (!req) return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Payment request not found' } });
    return { data: adminPaymentRequest(req) };
  });

  /**
   * Approves a payment request and activates/renews the subscription —
   * atomically. The advisory lock (same pattern as trial start and booking
   * slots) serializes concurrent reviews; the PENDING re-check inside the
   * lock makes a double-approve impossible, and the receipt re-check guards
   * against a reference being approved twice across different requests.
   * Period math: renewing a live paid subscription extends from its current
   * expiry; otherwise the new period starts now (a running trial is replaced
   * — the business paid for the month).
   */
  app.post('/api/v1/admin/subscription/payment-requests/:id/approve', { preHandler: roles('ADMIN') }, async (q, r) => {
    const requestId = (q.params as { id: string }).id;
    const admin = currentUser(q);
    const now = new Date();
    try {
      const result = await prisma.$transaction(async (tx) => {
        const existing = await tx.subscriptionPaymentRequest.findUnique({ where: { id: requestId } });
        if (!existing) throw Object.assign(new Error('missing'), { code: 'NOT_FOUND' });
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${existing.businessId}))`;

        // Reload inside the lock — the authoritative state.
        const request = await tx.subscriptionPaymentRequest.findUniqueOrThrow({
          where: { id: requestId },
          include: { business: { select: { ownerId: true } } },
        });
        if (request.status !== 'PENDING') throw Object.assign(new Error('dup'), { code: 'NOT_PENDING' });

        const method = await tx.paymentMethod.findUnique({ where: { id: request.paymentMethodId } });
        if (!method || !method.isActive) throw Object.assign(new Error('method'), { code: 'INVALID_PAYMENT_METHOD' });
        const plan = await tx.plan.findFirst({ where: { slug: 'nearbyorders-business' } });
        if (!plan) throw Object.assign(new Error('plan'), { code: 'PLAN_MISSING' });
        if (request.amountMinor !== plan.monthlyPriceMinor)
          throw Object.assign(new Error('amount'), { code: 'AMOUNT_MISMATCH' });

        // Approving the same transaction reference twice (two business rows
        // claiming one real payment) is rejected.
        const referenceClash = await tx.subscriptionPaymentRequest.findFirst({
          where: { transactionReference: request.transactionReference, status: 'APPROVED', id: { not: request.id } },
          select: { id: true },
        });
        if (referenceClash) throw Object.assign(new Error('ref'), { code: 'REFERENCE_ALREADY_APPROVED' });

        const current = await tx.businessSubscription.findFirst({
          where: { businessId: request.businessId },
          orderBy: { createdAt: 'desc' },
        });
        const liveCurrent =
          current && LIVE_SUBSCRIPTION_STATUSES.includes(current.status) && current.currentPeriodEndAt.getTime() > now.getTime()
            ? current
            : null;
        // A paid renewal extends from the existing expiry; a fresh activation
        // (expired/cancelled/none/trial) starts now.
        const periodStart =
          liveCurrent && liveCurrent.status === 'ACTIVE' ? liveCurrent.currentPeriodEndAt : now;
        const periodEnd = addCalendarMonths(periodStart, 1);

        // Renewal math (server-controlled dates only):
        // - live paid subscription → extend from its current expiry (never
        //   shorten an entitlement), reusing the row;
        // - live trial → the paid month starts now, activating that same row
        //   (no second live subscription is created);
        // - anything else (none/expired/cancelled/suspended) → a fresh ACTIVE
        //   row starting now.
        let subscription;
        if (liveCurrent && liveCurrent.status === 'ACTIVE') {
          subscription = await tx.businessSubscription.update({
            where: { id: liveCurrent.id },
            data: { status: 'ACTIVE', currentPeriodStartAt: liveCurrent.currentPeriodEndAt, currentPeriodEndAt: periodEnd },
          });
        } else if (liveCurrent && liveCurrent.status === 'TRIAL') {
          subscription = await tx.businessSubscription.update({
            where: { id: liveCurrent.id },
            data: { status: 'ACTIVE', currentPeriodStartAt: now, currentPeriodEndAt: periodEnd },
          });
        } else {
          subscription = await tx.businessSubscription.create({
            data: {
              businessId: request.businessId,
              planId: plan.id,
              status: 'ACTIVE',
              currentPeriodStartAt: now,
              currentPeriodEndAt: periodEnd,
            },
          });
        }

        const approved = await tx.subscriptionPaymentRequest.update({
          where: { id: request.id },
          data: { status: 'APPROVED', reviewedAt: now, reviewedByUserId: admin.id, subscriptionId: subscription.id },
        });

        await createNotifications(
          tx,
          [
            {
              userId: request.business.ownerId,
              type: NOTIFICATION_TYPES.SUBSCRIPTION_PAYMENT_APPROVED,
              title: 'Subscription payment approved',
              message: `Your NearbyOrders Business subscription payment has been approved. Your subscription is now active until ${periodEnd.toLocaleDateString('en-PK')}.`,
              entityType: 'SubscriptionPaymentRequest',
              entityId: request.id,
            },
          ],
          tx,
        );

        return { approved, subscription, ownerId: request.business.ownerId };
      });
      // Push is an additional channel, dispatched only after commit.
      void dispatchPushNotifications([
        {
          userId: result.ownerId,
          type: NOTIFICATION_TYPES.SUBSCRIPTION_PAYMENT_APPROVED,
          title: 'Subscription payment approved',
          message: 'Your NearbyOrders Business subscription is now active.',
          entityType: 'SubscriptionPaymentRequest',
          entityId: result.approved.id,
        },
      ]).catch(() => undefined);

      await prisma.auditLog.create({
        data: { actorId: admin.id, action: 'SUBSCRIPTION_PAYMENT_APPROVED', entityType: 'SubscriptionPaymentRequest', entityId: result.approved.id, metadata: { businessId: result.approved.businessId, subscriptionId: result.subscription.id } },
      });
      const full = await prisma.subscriptionPaymentRequest.findUniqueOrThrow({ where: { id: requestId }, include: PAYMENT_REQUEST_INCLUDE });
      return { data: adminPaymentRequest(full) };
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'NOT_FOUND') return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Payment request not found' } });
      if (code === 'NOT_PENDING') return r.status(409).send({ error: { code: 'NOT_PENDING', message: 'This payment request has already been reviewed' } });
      if (code === 'INVALID_PAYMENT_METHOD') return r.status(409).send({ error: { code: 'INVALID_PAYMENT_METHOD', message: 'The payment method is no longer active' } });
      if (code === 'AMOUNT_MISMATCH') return r.status(409).send({ error: { code: 'AMOUNT_MISMATCH', message: 'Payment amount no longer matches the plan price' } });
      if (code === 'REFERENCE_ALREADY_APPROVED') return r.status(409).send({ error: { code: 'REFERENCE_ALREADY_APPROVED', message: 'This transaction reference was already approved on another payment request' } });
      if (code === 'PLAN_MISSING') return r.status(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Plan configuration missing' } });
      throw e;
    }
  });

  /**
   * Rejects a payment request with a required reason. The subscription is
   * untouched; the owner is notified and can submit a corrected request.
   */
  app.post('/api/v1/admin/subscription/payment-requests/:id/reject', { preHandler: roles('ADMIN') }, async (q, r) => {
    const requestId = (q.params as { id: string }).id;
    const admin = currentUser(q);
    const { reason } = paymentRejectSchema.parse(q.body);
    const now = new Date();
    try {
      const result = await prisma.$transaction(async (tx) => {
        const existing = await tx.subscriptionPaymentRequest.findUnique({ where: { id: requestId } });
        if (!existing) throw Object.assign(new Error('missing'), { code: 'NOT_FOUND' });
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${existing.businessId}))`;
        const request = await tx.subscriptionPaymentRequest.findUniqueOrThrow({ where: { id: requestId }, include: { business: { select: { ownerId: true } } } });
        if (request.status !== 'PENDING') throw Object.assign(new Error('dup'), { code: 'NOT_PENDING' });
        const rejected = await tx.subscriptionPaymentRequest.update({
          where: { id: request.id },
          data: { status: 'REJECTED', rejectionReason: reason, reviewedAt: now, reviewedByUserId: admin.id },
        });
        await createNotifications(
          tx,
          [
            {
              userId: request.business.ownerId,
              type: NOTIFICATION_TYPES.SUBSCRIPTION_PAYMENT_REJECTED,
              title: 'Subscription payment rejected',
              message: `Your NearbyOrders subscription payment was rejected. Reason: ${reason}`,
              entityType: 'SubscriptionPaymentRequest',
              entityId: request.id,
            },
          ],
          tx,
        );
        return { rejected, ownerId: request.business.ownerId };
      });
      void dispatchPushNotifications([
        {
          userId: result.ownerId,
          type: NOTIFICATION_TYPES.SUBSCRIPTION_PAYMENT_REJECTED,
          title: 'Subscription payment rejected',
          message: `Your NearbyOrders subscription payment was rejected. Reason: ${reason}`,
          entityType: 'SubscriptionPaymentRequest',
          entityId: result.rejected.id,
        },
      ]).catch(() => undefined);
      await prisma.auditLog.create({
        data: { actorId: admin.id, action: 'SUBSCRIPTION_PAYMENT_REJECTED', entityType: 'SubscriptionPaymentRequest', entityId: result.rejected.id, metadata: { businessId: result.rejected.businessId } },
      });
      const full = await prisma.subscriptionPaymentRequest.findUniqueOrThrow({ where: { id: result.rejected.id }, include: PAYMENT_REQUEST_INCLUDE });
      return { data: adminPaymentRequest(full) };
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'NOT_FOUND') return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Payment request not found' } });
      if (code === 'NOT_PENDING') return r.status(409).send({ error: { code: 'NOT_PENDING', message: 'This payment request has already been reviewed' } });
      throw e;
    }
  });

  /* ------------------- Admin: payment methods CRUD (Phase 7B) --------- */

  app.get('/api/v1/admin/payment-methods', { preHandler: roles('ADMIN') }, async () => {
    const methods = await prisma.paymentMethod.findMany({ orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }] });
    return { data: methods };
  });

  app.post('/api/v1/admin/payment-methods', { preHandler: roles('ADMIN') }, async (q, r) => {
    const d = paymentMethodSchema.parse(q.body);
    const created = await prisma.paymentMethod.create({ data: d });
    await prisma.auditLog.create({
      data: { actorId: currentUser(q).id, action: 'PAYMENT_METHOD_CREATED', entityType: 'PaymentMethod', entityId: created.id, metadata: { type: created.type } },
    });
    return r.status(201).send({ data: created });
  });

  app.patch('/api/v1/admin/payment-methods/:id', { preHandler: roles('ADMIN') }, async (q, r) => {
    const id = (q.params as { id: string }).id;
    const d = paymentMethodUpdateSchema.parse(q.body);
    const existing = await prisma.paymentMethod.findUnique({ where: { id } });
    if (!existing) return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Payment method not found' } });
    const updated = await prisma.paymentMethod.update({ where: { id }, data: d });
    await prisma.auditLog.create({
      data: { actorId: currentUser(q).id, action: 'PAYMENT_METHOD_UPDATED', entityType: 'PaymentMethod', entityId: id, metadata: { keys: Object.keys(d) } },
    });
    return { data: updated };
  });

  /**
   * Deleting a payment method is only allowed while it has no payment
   * requests (FK RESTRICT); otherwise admins deactivate it — history must
   * keep showing the channel a payment was paid to.
   */
  app.delete('/api/v1/admin/payment-methods/:id', { preHandler: roles('ADMIN') }, async (q, r) => {
    const id = (q.params as { id: string }).id;
    const existing = await prisma.paymentMethod.findUnique({ where: { id }, include: { _count: { select: { paymentRequests: true } } } });
    if (!existing) return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Payment method not found' } });
    if (existing._count.paymentRequests > 0)
      return r.status(409).send({ error: { code: 'IN_USE', message: 'This payment method has payment requests and can only be deactivated, not deleted' } });
    await prisma.paymentMethod.delete({ where: { id } });
    await prisma.auditLog.create({
      data: { actorId: currentUser(q).id, action: 'PAYMENT_METHOD_DELETED', entityType: 'PaymentMethod', entityId: id },
    });
    return r.status(204).send();
  });

  /* ------------- Customer→business payments (Phase 7C) ---------------- */

  /** Public DTO for a business pay-in channel shown to customers. */
  const publicPayInMethod = (m: {
    id: string;
    type: string;
    displayName: string;
    accountTitle: string;
    accountNumber: string | null;
    iban: string | null;
    instructions: string | null;
  }) => ({
    id: m.id,
    type: m.type,
    displayName: m.displayName,
    accountTitle: m.accountTitle,
    accountNumber: m.accountNumber,
    iban: m.iban,
    instructions: m.instructions,
  });

  /** Active pay-in channels for one business, in display order (customers). */
  app.get('/api/v1/businesses/:id/payment-methods', async (q, r) => {
    const key = (q.params as { id: string }).id;
    const business = await prisma.business.findFirst({
      where: { OR: [{ id: key }, { slug: key }], status: 'APPROVED', archivedAt: null },
      select: { id: true },
    });
    if (!business) return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Business not found' } });
    const methods = await prisma.businessPaymentMethod.findMany({
      where: { businessId: business.id, isActive: true },
      orderBy: [{ displayOrder: 'asc' }, { displayName: 'asc' }],
    });
    return { data: methods.map(publicPayInMethod) };
  });

  /** Owner view of their pay-in channels, including inactive ones. */
  app.get('/api/v1/owner/businesses/:id/payment-methods', { preHandler: roles('BUSINESS_OWNER') }, async (q, r) => {
    const id = (q.params as { id: string }).id;
    await ownedBusiness(q, id);
    const methods = await prisma.businessPaymentMethod.findMany({
      where: { businessId: id },
      orderBy: [{ displayOrder: 'asc' }, { displayName: 'asc' }],
    });
    return { data: methods };
  });

  app.post('/api/v1/owner/businesses/:id/payment-methods', { preHandler: roles('BUSINESS_OWNER') }, async (q, r) => {
    const id = (q.params as { id: string }).id;
    await ownedBusiness(q, id);
    const d = businessPaymentMethodSchema.parse(q.body);
    if (d.type === 'CASH' && (d.accountNumber || d.iban))
      return r.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Cash payments do not use account details' } });
    if (d.type !== 'CASH' && !d.accountNumber && !d.iban)
      return r.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Digital payment methods need an account number or IBAN' } });
    const created = await prisma.businessPaymentMethod.create({ data: { ...d, businessId: id } });
    await prisma.auditLog.create({
      data: { actorId: currentUser(q).id, action: 'BUSINESS_PAYMENT_METHOD_CREATED', entityType: 'BusinessPaymentMethod', entityId: created.id, metadata: { businessId: id, type: d.type } },
    });
    return r.status(201).send({ data: created });
  });

  app.patch('/api/v1/owner/businesses/:id/payment-methods/:methodId', { preHandler: roles('BUSINESS_OWNER') }, async (q, r) => {
    const id = (q.params as { id: string }).id;
    const methodId = (q.params as { methodId: string }).methodId;
    await ownedBusiness(q, id);
    const existing = await prisma.businessPaymentMethod.findFirst({ where: { id: methodId, businessId: id } });
    if (!existing) return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Payment method not found' } });
    const d = businessPaymentMethodUpdateSchema.parse(q.body);
    const updated = await prisma.businessPaymentMethod.update({ where: { id: existing.id }, data: d });
    await prisma.auditLog.create({
      data: { actorId: currentUser(q).id, action: 'BUSINESS_PAYMENT_METHOD_UPDATED', entityType: 'BusinessPaymentMethod', entityId: id, metadata: { businessId: id, keys: Object.keys(d) } },
    });
    return { data: updated };
  });

  /**
   * Deactivate (never hard-delete) a channel: payment history must keep
   * showing which account a customer paid to. Deletion is not offered.
   */
  app.delete('/api/v1/owner/businesses/:id/payment-methods/:methodId', { preHandler: roles('BUSINESS_OWNER') }, async (q, r) => {
    const id = (q.params as { id: string }).id;
    const methodId = (q.params as { methodId: string }).methodId;
    await ownedBusiness(q, id);
    const existing = await prisma.businessPaymentMethod.findFirst({ where: { id: methodId, businessId: id } });
    if (!existing) return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Payment method not found' } });
    const updated = await prisma.businessPaymentMethod.update({ where: { id: existing.id }, data: { isActive: false } });
    await prisma.auditLog.create({
      data: { actorId: currentUser(q).id, action: 'BUSINESS_PAYMENT_METHOD_DEACTIVATED', entityType: 'BusinessPaymentMethod', entityId: id, metadata: { businessId: id } },
    });
    return { data: updated };
  });

  /** Delivery / COD settings for one owned business. */
  app.put('/api/v1/owner/businesses/:id/delivery-settings', { preHandler: roles('BUSINESS_OWNER') }, async (q, r) => {
    const id = (q.params as { id: string }).id;
    await ownedBusiness(q, id);
    const d = deliverySettingsSchema.parse(q.body);
    const data: { deliveryEnabled: boolean; codEnabled?: boolean; deliveryFeeMinor?: number } = { deliveryEnabled: d.deliveryEnabled };
    if (d.codEnabled !== undefined) data.codEnabled = d.codEnabled;
    if (d.deliveryFeeMinor !== undefined) data.deliveryFeeMinor = d.deliveryFeeMinor;
    if (d.deliveryEnabled) data.deliveryFeeMinor = d.deliveryFeeMinor ?? 0;
    const updated = await prisma.business.update({ where: { id }, data });
    await prisma.auditLog.create({
      data: { actorId: currentUser(q).id, action: 'DELIVERY_SETTINGS_UPDATED', entityType: 'Business', entityId: id, metadata: { deliveryEnabled: updated.deliveryEnabled, codEnabled: updated.codEnabled, deliveryFeeMinor: updated.deliveryFeeMinor } },
    });
    return { data: { deliveryEnabled: updated.deliveryEnabled, codEnabled: updated.codEnabled, deliveryFeeMinor: updated.deliveryFeeMinor } };
  });

  app.get('/api/v1/owner/businesses/:id/delivery-settings', { preHandler: roles('BUSINESS_OWNER') }, async (q, r) => {
    const id = (q.params as { id: string }).id;
    await ownedBusiness(q, id);
    const b = await prisma.business.findUniqueOrThrow({ where: { id }, select: { deliveryEnabled: true, codEnabled: true, deliveryFeeMinor: true } });
    return { data: b };
  });

  /** Payment DTO: owner/customer-safe fields, no internal reviewer columns. */
  const publicCustomerPayment = (p: {
    id: string;
    amountMinor: number;
    currency: string;
    status: string;
    transactionReference: string | null;
    receiptStorageKey: string | null;
    rejectionReason: string | null;
    submittedAt: Date;
    verifiedAt: Date | null;
    /** OrderPayment rows additionally carry a denormalized method scalar. */
    method?: string | null;
    paymentMethod: { id: string; displayName: string; type: string } | null;
  }) => ({
    id: p.id,
    amountMinor: p.amountMinor,
    currency: p.currency,
    status: p.status,
    transactionReference: p.transactionReference,
    receiptStorageKey: p.receiptStorageKey,
    rejectionReason: p.rejectionReason,
    submittedAt: p.submittedAt,
    verifiedAt: p.verifiedAt,
    // Cash records have no BusinessPaymentMethod row; fall back to the
    // denormalized scalar so clients can still show Cash.
    paymentMethod:
      p.paymentMethod ?? (p.method ? { id: '', displayName: 'Cash', type: p.method } : null),
  });

  const PAYMENT_METHOD_SELECT = { select: { id: true, displayName: true, type: true } } as const;

  /**
   * Booking payments for one booking. Customers see their own; the business
   * owner sees their business's bookings. Foreign users get 404.
   */
  app.get('/api/v1/bookings/:id/payments', { preHandler: auth }, async (q, r) => {
    const booking = await loadVisibleBooking(q, (q.params as { id: string }).id);
    const payments = await prisma.bookingPayment.findMany({
      where: { bookingId: booking.id },
      orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
      include: { paymentMethod: PAYMENT_METHOD_SELECT },
    });
    return { data: payments.map(publicCustomerPayment) };
  });

  /**
   * Customer submits a booking payment (advance or outstanding balance).
   * Amount must be positive and cannot exceed the booking's remaining
   * requirement — for a booking with an advance, the first payment is capped
   * at the advance; after that, at the outstanding balance. Cash methods
   * skip reference/receipt; manual digital needs a reference. There is no
   * "payment successful": the business verifies before anything is PAID.
   */
  app.post('/api/v1/bookings/:id/payments', { preHandler: roles('CUSTOMER', 'BUSINESS_OWNER') }, async (q, r) => {
    const booking = await loadVisibleBooking(q, (q.params as { id: string }).id);
    const user = currentUser(q);
    if (booking.customerId !== user.id)
      return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Booking not found' } });
    if (booking.status === 'CANCELLED' || booking.status === 'REJECTED')
      return r.status(409).send({ error: { code: 'BOOKING_CLOSED', message: `A ${booking.status.toLowerCase()} booking cannot be paid` } });
    const d = bookingPaymentCreateSchema.parse(q.body);

    const method = await prisma.businessPaymentMethod.findFirst({
      where: { id: d.paymentMethodId, businessId: booking.businessId, isActive: true },
    });
    if (!method) return r.status(400).send({ error: { code: 'INVALID_PAYMENT_METHOD', message: 'Choose a valid payment method' } });

    const isAdvanceOutstanding = booking.amountPaidMinor < booking.advanceRequiredMinor;
    const cap = isAdvanceOutstanding
      ? booking.advanceRequiredMinor - booking.amountPaidMinor
      : booking.servicePriceMinor - booking.amountPaidMinor;
    if (d.amountMinor > cap)
      return r.status(400).send({
        error: { code: 'AMOUNT_EXCEEDS_DUE', message: `Payment cannot exceed the amount due (Rs ${Math.round(cap / 100)})` },
      });
    if (cap <= 0)
      return r.status(409).send({ error: { code: 'NOTHING_DUE', message: 'This booking is already fully paid' } });

    // Manual digital proof needs a reference + receipt; cash needs neither.
    if (method.type === 'CASH') {
      if (d.transactionReference || d.receiptStorageKey)
        return r.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Cash payments do not use references or receipts' } });
    } else if (!d.transactionReference || !d.receiptStorageKey) {
      return r.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'A transaction reference and receipt image are required' } });
    }

    const created = await prisma.bookingPayment.create({
      data: {
        bookingId: booking.id,
        businessId: booking.businessId,
        customerId: user.id,
        amountMinor: d.amountMinor,
        currency: booking.business.currency,
        paymentMethodId: method.id,
        status: 'PENDING_VERIFICATION',
        transactionReference: d.transactionReference || null,
        receiptStorageKey: d.receiptStorageKey || null,
      },
      include: { paymentMethod: PAYMENT_METHOD_SELECT },
    });
    await prisma.auditLog.create({
      data: { actorId: user.id, action: 'BOOKING_PAYMENT_SUBMITTED', entityType: 'BookingPayment', entityId: created.id, metadata: { bookingId: booking.id, businessId: booking.businessId, amountMinor: d.amountMinor, method: method.type } },
    });
    await createNotifications(prisma, [
      {
        userId: booking.business.ownerId,
        type: NOTIFICATION_TYPES.BOOKING_PAYMENT_SUBMITTED,
        title: 'Payment proof submitted',
        message: `${user.firstName ?? 'A customer'} submitted an advance payment (Rs ${Math.round(d.amountMinor / 100)}) for ${booking.service?.name ?? 'a booking'}. Verify it to mark the payment as received.`,
        entityType: 'BookingPayment',
        entityId: created.id,
      },
    ]);
    void dispatchPushNotifications([
      {
        userId: booking.business.ownerId,
        type: NOTIFICATION_TYPES.BOOKING_PAYMENT_SUBMITTED,
        title: 'Payment proof submitted',
        message: `${user.firstName ?? 'A customer'} submitted an advance payment (Rs ${Math.round(d.amountMinor / 100)}) for ${booking.service?.name ?? 'a booking'}. Verify it to mark the payment as received.`,
        entityType: 'BookingPayment',
        entityId: created.id,
      },
    ]).catch(() => undefined);
    return r.status(201).send({ data: publicCustomerPayment(created) });
  });

  /** Verification queue: pending payments across the owner's businesses. */
  /** Orders for ONE owned business (Business-mode listing). Ownership enforced server-side. */
  app.get('/api/v1/owner/businesses/:id/orders', { preHandler: roles('BUSINESS_OWNER') }, async (q, r) => {
    const id = (q.params as { id: string }).id;
    await ownedBusiness(q, id);
    const rows = await prisma.order.findMany({
      where: { businessId: id },
      include: ORDER_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return { data: rows.map(publicOrder) };
  });

  /* ------------- Owner operations & analytics (Phase 16) ------------- */
  /**
   * Server-authoritative business metrics. The client previously derived
   * "today" from UTC dates over truncated (take: 100) lists — wrong for PKT
   * businesses and silently incomplete. These endpoints compute every number
   * from the database inside the business-local (Asia/Karachi) day window;
   * ownership is enforced by `ownedBusiness` (404 for anyone else's business).
   */

  /** Business-local [from, to] date strings (inclusive) for an analytics period. */
  const pktPeriodDates = (period: 'today' | 'week' | 'month'): { from: string; to: string } => {
    const now = new Date();
    const today = pktDateOf(now);
    if (period === 'today') return { from: today, to: today };
    if (period === 'week') {
      // Business-local Monday..Sunday containing today (pktDayOfWeek: 0=Sunday).
      const daysSinceMonday = (pktDayOfWeek(now) + 6) % 7;
      return { from: pktDateOf(new Date(now.getTime() - daysSinceMonday * 86_400_000)), to: today };
    }
    return { from: `${today.slice(0, 7)}-01`, to: today };
  };

  /** Inclusive UTC window covering the business-local dates [from, to]. */
  const pktDatesWindowUtc = (from: string, to: string): { gte: Date; lt: Date } => ({
    gte: pktToUtc(from, 0),
    lt: pktToUtc(to, 24 * 60),
  });

  app.get('/api/v1/owner/businesses/:id/overview', { preHandler: roles('BUSINESS_OWNER') }, async (q) => {
    const id = (q.params as { id: string }).id;
    const business = await ownedBusiness(q, id);
    const now = new Date();
    const today = pktDateOf(now);
    const day = pktDayWindowUtc(today);

    const [
      pendingOrders,
      todayOrders,
      todayOrderRevenue,
      todayBookingRevenue,
      pendingBookings,
      todayBookings,
      pendingBookingPayments,
      pendingOrderPayments,
      upcoming,
      recentOrders,
      recentBookings,
      hoursCount,
      activeServices,
      activeProducts,
    ] = await Promise.all([
      prisma.order.count({ where: { businessId: id, status: 'PENDING' } }),
      prisma.order.count({
        where: { businessId: id, createdAt: { gte: day.from, lt: day.to }, status: { notIn: ['CANCELLED', 'REJECTED'] } },
      }),
      prisma.order.aggregate({
        where: { businessId: id, status: 'COMPLETED', completedAt: { gte: day.from, lt: day.to } },
        _sum: { totalMinor: true },
      }),
      prisma.booking.aggregate({
        where: { businessId: id, status: 'COMPLETED', completedAt: { gte: day.from, lt: day.to } },
        _sum: { servicePriceMinor: true },
      }),
      prisma.booking.count({ where: { businessId: id, status: 'PENDING' } }),
      prisma.booking.count({
        where: {
          businessId: id,
          bookingDate: { gte: new Date(`${today}T00:00:00Z`), lte: new Date(`${today}T00:00:00Z`) },
          status: { in: ['PENDING', 'CONFIRMED'] },
        },
      }),
      prisma.bookingPayment.count({ where: { businessId: id, status: 'PENDING_VERIFICATION' } }),
      prisma.orderPayment.count({ where: { businessId: id, status: 'PENDING_VERIFICATION' } }),
      prisma.booking.findMany({
        where: { businessId: id, status: { in: ['PENDING', 'CONFIRMED'] }, startAt: { gte: now } },
        include: { service: { select: { name: true } }, customer: { select: { firstName: true, lastName: true } } },
        orderBy: { startAt: 'asc' },
        take: 5,
      }),
      prisma.order.findMany({
        where: { businessId: id },
        include: ORDER_INCLUDE,
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      prisma.booking.findMany({
        where: { businessId: id },
        include: BOOKING_INCLUDE,
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      prisma.businessHour.count({ where: { businessId: id } }),
      prisma.service.count({ where: { businessId: id, isActive: true } }),
      prisma.product.count({ where: { businessId: id, isActive: true } }),
    ]);

    // Completeness from persisted fields only; "catalog" flags a business
    // with nothing bookable or orderable at all. Never a fake percentage.
    const profileMissing: string[] = [];
    if (!business.description) profileMissing.push('description');
    if (!business.phone) profileMissing.push('phone');
    if (!business.imageUrl) profileMissing.push('image');
    if (hoursCount === 0) profileMissing.push('hours');
    if (business.latitude === null || business.longitude === null) profileMissing.push('location');
    if (activeServices === 0 && activeProducts === 0) profileMissing.push('catalog');

    return {
      data: {
        business: {
          id: business.id,
          name: business.name,
          status: business.status,
          isVerified: business.isVerified,
          currency: business.currency,
          imageUrl: business.imageUrl,
        },
        today: {
          orders: todayOrders,
          bookings: todayBookings,
          revenueMinor: (todayOrderRevenue._sum.totalMinor ?? 0) + (todayBookingRevenue._sum.servicePriceMinor ?? 0),
        },
        needsAttention: {
          pendingOrders,
          pendingBookings,
          pendingPayments: pendingBookingPayments + pendingOrderPayments,
        },
        upcomingBookings: upcoming.map((b) => ({
          id: b.id,
          serviceName: b.service?.name ?? null,
          customerName: [b.customer.firstName, b.customer.lastName].filter(Boolean).join(' ') || 'Customer',
          date: pktDateOf(b.startAt),
          startTime: formatMinutes(pktMinutesOf(b.startAt)),
          status: b.status,
        })),
        recentOrders: recentOrders.map(publicOrder),
        recentBookings: recentBookings.map((b) => publicBooking(b)),
        profileMissing,
      },
    };
  });

  /** Activity + revenue for today / this week / this month (business-local). */
  app.get('/api/v1/owner/businesses/:id/analytics', { preHandler: roles('BUSINESS_OWNER') }, async (q) => {
    const id = (q.params as { id: string }).id;
    const business = await ownedBusiness(q, id);
    const { period } = z.object({ period: z.enum(['today', 'week', 'month']).default('today') }).parse(q.query ?? {});
    const { from, to } = pktPeriodDates(period);
    const created = pktDatesWindowUtc(from, to);
    const dateOnly = { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) };

    const [ordersTotal, ordersCompleted, ordersCancelled, orderRevenue, bookingsTotal, bookingsCompleted, bookingsCancelled, bookingRevenue, activeServices, activeProducts] = await Promise.all([
      prisma.order.count({ where: { businessId: id, createdAt: created } }),
      prisma.order.count({ where: { businessId: id, status: 'COMPLETED', completedAt: created } }),
      prisma.order.count({ where: { businessId: id, status: { in: ['CANCELLED', 'REJECTED'] }, createdAt: created } }),
      prisma.order.aggregate({ where: { businessId: id, status: 'COMPLETED', completedAt: created }, _sum: { totalMinor: true } }),
      prisma.booking.count({ where: { businessId: id, bookingDate: dateOnly } }),
      prisma.booking.count({ where: { businessId: id, status: 'COMPLETED', completedAt: created } }),
      prisma.booking.count({ where: { businessId: id, status: { in: ['CANCELLED', 'REJECTED'] }, bookingDate: dateOnly } }),
      prisma.booking.aggregate({ where: { businessId: id, status: 'COMPLETED', completedAt: created }, _sum: { servicePriceMinor: true } }),
      prisma.service.count({ where: { businessId: id, isActive: true } }),
      prisma.product.count({ where: { businessId: id, isActive: true } }),
    ]);

    return {
      data: {
        period,
        window: { from, to },
        orders: { total: ordersTotal, completed: ordersCompleted, cancelled: ordersCancelled, revenueMinor: orderRevenue._sum.totalMinor ?? 0 },
        bookings: { total: bookingsTotal, completed: bookingsCompleted, cancelled: bookingsCancelled, revenueMinor: bookingRevenue._sum.servicePriceMinor ?? 0 },
        catalog: { activeServices, activeProducts },
      },
    };
  });

  /**
   * Collected revenue: only COMPLETED transactions, valued at the frozen
   * order total / booking price snapshot. Cancelled, rejected, and unpaid
   * amounts are never "earnings"; pending payment proofs are reported
   * separately as awaiting verification, never as collected money.
   */
  app.get('/api/v1/owner/businesses/:id/earnings', { preHandler: roles('BUSINESS_OWNER') }, async (q) => {
    const id = (q.params as { id: string }).id;
    const business = await ownedBusiness(q, id);

    const [completedOrders, completedBookings, openOrders, pendingBookingPayments, pendingOrderPayments] = await Promise.all([
      prisma.order.aggregate({ where: { businessId: id, status: 'COMPLETED' }, _sum: { totalMinor: true }, _count: { id: true } }),
      prisma.booking.aggregate({ where: { businessId: id, status: 'COMPLETED' }, _sum: { servicePriceMinor: true }, _count: { id: true } }),
      prisma.order.findMany({
        where: { businessId: id, status: { in: ['PENDING', 'ACCEPTED', 'PREPARING', 'READY'] } },
        select: { totalMinor: true },
      }),
      prisma.bookingPayment.aggregate({ where: { businessId: id, status: 'PENDING_VERIFICATION' }, _sum: { amountMinor: true }, _count: { id: true } }),
      prisma.orderPayment.aggregate({ where: { businessId: id, status: 'PENDING_VERIFICATION' }, _sum: { amountMinor: true }, _count: { id: true } }),
    ]);

    const ordersRevenueMinor = completedOrders._sum.totalMinor ?? 0;
    const bookingsRevenueMinor = completedBookings._sum.servicePriceMinor ?? 0;
    const pendingCount = pendingBookingPayments._count.id + pendingOrderPayments._count.id;

    return {
      data: {
        currency: business.currency,
        collected: {
          ordersRevenueMinor,
          bookingsRevenueMinor,
          totalMinor: ordersRevenueMinor + bookingsRevenueMinor,
          completedOrders: completedOrders._count.id,
          completedBookings: completedBookings._count.id,
        },
        inProgress: {
          orders: openOrders.length,
          valueMinor: openOrders.reduce((s, o) => s + o.totalMinor, 0),
        },
        awaitingVerification: {
          count: pendingCount,
          amountMinor: (pendingBookingPayments._sum.amountMinor ?? 0) + (pendingOrderPayments._sum.amountMinor ?? 0),
        },
      },
    };
  });

  app.get('/api/v1/owner/payments', { preHandler: roles('BUSINESS_OWNER') }, async (q) => {
    const query = z
      .object({
        status: z.enum(['UNPAID', 'PENDING_VERIFICATION', 'PAID', 'FAILED']).optional(),
        kind: z.enum(['booking', 'order']).optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
      })
      .parse(q.query ?? {});
    const status = query.status ?? 'PENDING_VERIFICATION';
    const bookingPayments = query.kind && query.kind !== 'booking' ? [] : await prisma.bookingPayment.findMany({
      where: { business: { ownerId: currentUser(q).id }, status },
      orderBy: { submittedAt: 'desc' },
      take: query.limit ?? 50,
      include: {
        paymentMethod: PAYMENT_METHOD_SELECT,
        booking: { select: { id: true, service: { select: { name: true } }, startAt: true } },
        customer: { select: { id: true, email: true, firstName: true, lastName: true } },
      },
    });
    const orderPayments = query.kind && query.kind !== 'order' ? [] : await prisma.orderPayment.findMany({
      where: { business: { ownerId: currentUser(q).id }, status },
      orderBy: { submittedAt: 'desc' },
      take: query.limit ?? 50,
      include: {
        paymentMethod: PAYMENT_METHOD_SELECT,
        order: { select: { id: true, totalMinor: true } },
        customer: { select: { id: true, email: true, firstName: true, lastName: true } },
      },
    });
    return {
      data: {
        bookingPayments: bookingPayments.map((p) => ({
          ...publicCustomerPayment(p),
          booking: p.booking
            ? { id: p.booking.id, serviceName: p.booking.service?.name ?? null, date: pktDateOf(p.booking.startAt) }
            : null,
          customer: { id: p.customer.id, email: p.customer.email, firstName: p.customer.firstName, lastName: p.customer.lastName },
        })),
        orderPayments: orderPayments.map((p) => ({
          ...publicCustomerPayment(p),
          order: p.order ? { id: p.order.id, totalMinor: p.order.totalMinor } : null,
          customer: { id: p.customer.id, email: p.customer.email, firstName: p.customer.firstName, lastName: p.customer.lastName },
        })),
      },
    };
  });

  /**
   * Business verifies one of its own booking payments — atomically. The
   * advisory lock (same pattern as Phase 7B) + PENDING re-check makes a
   * double-verify impossible; the verified amount accumulates onto the
   * booking's `amountPaidMinor` inside the same transaction.
   */
  app.post('/api/v1/owner/payments/:id/verify', { preHandler: roles('BUSINESS_OWNER') }, async (q, r) => {
    const paymentId = (q.params as { id: string }).id;
    const owner = currentUser(q);
    try {
      const result = await prisma.$transaction(async (tx) => {
        const existing = await tx.bookingPayment.findUnique({ where: { id: paymentId }, select: { businessId: true } });
        if (!existing) throw Object.assign(new Error('missing'), { code: 'NOT_FOUND' });
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${existing.businessId}))`;
        const payment = await tx.bookingPayment.findUniqueOrThrow({
          where: { id: paymentId },
          include: { booking: { include: { business: { select: { ownerId: true, name: true } }, service: { select: { name: true } } } } },
        });
        // Ownership re-checked inside the lock: the payment's business must
        // belong to the authenticated owner.
        if (payment.booking.business.ownerId !== owner.id) throw Object.assign(new Error('own'), { code: 'NOT_FOUND' });
        if (payment.status !== 'PENDING_VERIFICATION') throw Object.assign(new Error('dup'), { code: 'NOT_PENDING' });
        // Amount sanity inside the lock: cannot verify more than is due.
        const due = Math.max(payment.booking.servicePriceMinor - payment.booking.amountPaidMinor, 0);
        if (payment.amountMinor <= 0 || payment.amountMinor > due)
          throw Object.assign(new Error('amount'), { code: 'AMOUNT_INVALID' });

        const verified = await tx.bookingPayment.update({
          where: { id: payment.id },
          data: { status: 'PAID', verifiedAt: new Date(), verifiedByUserId: owner.id },
        });
        await tx.booking.update({
          where: { id: payment.bookingId },
          data: { amountPaidMinor: { increment: payment.amountMinor } },
        });
        await createNotifications(prisma, [
          {
            userId: payment.customerId,
            type: NOTIFICATION_TYPES.BOOKING_PAYMENT_VERIFIED,
            title: 'Payment verified',
            message: `Your payment of Rs ${Math.round(payment.amountMinor / 100)} for ${payment.booking.service?.name ?? 'your booking'} has been verified by ${payment.booking.business.name}.`,
            entityType: 'BookingPayment',
            entityId: payment.id,
          },
        ], tx);
        return { verified, customerId: payment.customerId, paymentId: payment.id };
      });
      void dispatchPushNotifications([
        {
          userId: result.customerId,
          type: NOTIFICATION_TYPES.BOOKING_PAYMENT_VERIFIED,
          title: 'Payment verified',
          message: 'Your payment has been verified by the business.',
          entityType: 'BookingPayment',
          entityId: result.paymentId,
        },
      ]).catch(() => undefined);
      await prisma.auditLog.create({
        data: { actorId: owner.id, action: 'BOOKING_PAYMENT_VERIFIED', entityType: 'BookingPayment', entityId: result.verified.id, metadata: { businessId: result.verified.businessId, amountMinor: result.verified.amountMinor } },
      });
      const full = await prisma.bookingPayment.findUniqueOrThrow({ where: { id: paymentId }, include: { paymentMethod: PAYMENT_METHOD_SELECT } });
      return { data: publicCustomerPayment(full) };
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'NOT_FOUND') return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Payment not found' } });
      if (code === 'NOT_PENDING') return r.status(409).send({ error: { code: 'NOT_PENDING', message: 'This payment has already been reviewed' } });
      if (code === 'AMOUNT_INVALID') return r.status(409).send({ error: { code: 'AMOUNT_INVALID', message: 'Payment amount is no longer valid for this booking' } });
      throw e;
    }
  });

  /** Business rejects one of its own booking payments with a reason. */
  app.post('/api/v1/owner/payments/:id/reject', { preHandler: roles('BUSINESS_OWNER') }, async (q, r) => {
    const paymentId = (q.params as { id: string }).id;
    const owner = currentUser(q);
    const { reason } = customerPaymentRejectSchema.parse(q.body);
    try {
      const result = await prisma.$transaction(async (tx) => {
        const existing = await tx.bookingPayment.findUnique({ where: { id: paymentId }, select: { businessId: true } });
        if (!existing) throw Object.assign(new Error('missing'), { code: 'NOT_FOUND' });
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${existing.businessId}))`;
        const payment = await tx.bookingPayment.findUniqueOrThrow({
          where: { id: paymentId },
          include: { booking: { include: { business: { select: { ownerId: true, name: true } }, service: { select: { name: true } } } } },
        });
        if (payment.booking.business.ownerId !== owner.id) throw Object.assign(new Error('own'), { code: 'NOT_FOUND' });
        if (payment.status !== 'PENDING_VERIFICATION') throw Object.assign(new Error('dup'), { code: 'NOT_PENDING' });
        const rejected = await tx.bookingPayment.update({
          where: { id: payment.id },
          data: { status: 'FAILED', rejectionReason: reason, verifiedAt: new Date(), verifiedByUserId: owner.id },
        });
        await createNotifications(prisma, [
          {
            userId: payment.customerId,
            type: NOTIFICATION_TYPES.BOOKING_PAYMENT_REJECTED,
            title: 'Payment could not be verified',
            message: `${payment.booking.business.name} could not verify your payment of Rs ${Math.round(payment.amountMinor / 100)}. Reason: ${reason} You can submit a new payment.`,
            entityType: 'BookingPayment',
            entityId: payment.id,
          },
        ], tx);
        return { rejected, customerId: payment.customerId, paymentId: payment.id };
      });
      void dispatchPushNotifications([
        {
          userId: result.customerId,
          type: NOTIFICATION_TYPES.BOOKING_PAYMENT_REJECTED,
          title: 'Payment could not be verified',
          message: 'The business could not verify your payment. You can submit a new payment.',
          entityType: 'BookingPayment',
          entityId: result.paymentId,
        },
      ]).catch(() => undefined);
      await prisma.auditLog.create({
        data: { actorId: owner.id, action: 'BOOKING_PAYMENT_REJECTED', entityType: 'BookingPayment', entityId: result.rejected.id, metadata: { businessId: result.rejected.businessId, amountMinor: result.rejected.amountMinor } },
      });
      const full = await prisma.bookingPayment.findUniqueOrThrow({ where: { id: paymentId }, include: { paymentMethod: PAYMENT_METHOD_SELECT } });
      return { data: publicCustomerPayment(full) };
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'NOT_FOUND') return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Payment not found' } });
      if (code === 'NOT_PENDING') return r.status(409).send({ error: { code: 'NOT_PENDING', message: 'This payment has already been reviewed' } });
      throw e;
    }
  });

  /** Order payments for one order (customer or owning business). */
  app.get('/api/v1/orders/:id/payments', { preHandler: auth }, async (q, r) => {
    const u = currentUser(q);
    const order = await prisma.order.findUnique({ where: { id: (q.params as { id: string }).id }, include: { business: { select: { ownerId: true } } } });
    if (!order) return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Order not found' } });
    const isOwner = u.role === 'BUSINESS_OWNER' && order.business.ownerId === u.id;
    const isCustomer = order.customerId === u.id;
    if (!isOwner && !isCustomer) return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Order not found' } });
    const payments = await prisma.orderPayment.findMany({
      where: { orderId: order.id },
      orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
      include: { paymentMethod: PAYMENT_METHOD_SELECT },
    });
    return { data: payments.map(publicCustomerPayment) };
  });

  /**
   * Customer submits manual digital payment proof for an order. Amount can
   * never exceed the order's outstanding total (totalMinor minus verified
   * payments). COD is recorded by the owner as a cash collection instead —
   * selecting COD does NOT mark anything paid.
   */
  app.post('/api/v1/orders/:id/payments', { preHandler: roles('CUSTOMER', 'BUSINESS_OWNER') }, async (q, r) => {
    const order = await prisma.order.findUnique({
      where: { id: (q.params as { id: string }).id },
      include: { business: { select: { ownerId: true, name: true } } },
    });
    if (!order) return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Order not found' } });
    const user = currentUser(q);
    if (order.customerId !== user.id) return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Order not found' } });
    if (order.status === 'CANCELLED' || order.status === 'REJECTED')
      return r.status(409).send({ error: { code: 'ORDER_CLOSED', message: `A ${order.status.toLowerCase()} order cannot be paid` } });
    const d = orderPaymentCreateSchema.parse(q.body);

    const method = await prisma.businessPaymentMethod.findFirst({
      where: { id: d.paymentMethodId, businessId: order.businessId, isActive: true },
    });
    if (!method) return r.status(400).send({ error: { code: 'INVALID_PAYMENT_METHOD', message: 'Choose a valid payment method' } });
    if (method.type === 'CASH')
      return r.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Cash is collected by the business — submit a manual digital payment instead' } });
    if (!d.transactionReference || !d.receiptStorageKey)
      return r.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'A transaction reference and receipt image are required' } });

    const verified = await prisma.orderPayment.aggregate({
      where: { orderId: order.id, status: 'PAID' },
      _sum: { amountMinor: true },
    });
    const due = order.totalMinor - (verified._sum.amountMinor ?? 0);
    if (due <= 0)
      return r.status(409).send({ error: { code: 'NOTHING_DUE', message: 'This order is already fully paid' } });
    if (d.amountMinor > due)
      return r.status(400).send({
        error: { code: 'AMOUNT_EXCEEDS_DUE', message: `Payment cannot exceed the amount due (Rs ${Math.round(due / 100)})` },
      });

    const created = await prisma.orderPayment.create({
      data: {
        orderId: order.id,
        businessId: order.businessId,
        customerId: user.id,
        amountMinor: d.amountMinor,
        currency: order.currency,
        method: method.type,
        paymentMethodId: method.id,
        status: 'PENDING_VERIFICATION',
        transactionReference: d.transactionReference,
        receiptStorageKey: d.receiptStorageKey,
      },
      include: { paymentMethod: PAYMENT_METHOD_SELECT },
    });
    await prisma.auditLog.create({
      data: { actorId: user.id, action: 'ORDER_PAYMENT_SUBMITTED', entityType: 'OrderPayment', entityId: created.id, metadata: { orderId: order.id, businessId: order.businessId, amountMinor: d.amountMinor, method: method.type } },
    });
    await createNotifications(prisma, [
      {
        userId: order.business.ownerId,
        type: NOTIFICATION_TYPES.ORDER_PAYMENT_SUBMITTED,
        title: 'Order payment proof submitted',
        message: `${user.firstName ?? 'A customer'} submitted a payment (Rs ${Math.round(d.amountMinor / 100)}) for their order. Verify it to mark the payment as received.`,
        entityType: 'OrderPayment',
        entityId: created.id,
      },
    ]);
    void dispatchPushNotifications([
      {
        userId: order.business.ownerId,
        type: NOTIFICATION_TYPES.ORDER_PAYMENT_SUBMITTED,
        title: 'Order payment proof submitted',
        message: `${user.firstName ?? 'A customer'} submitted a payment (Rs ${Math.round(d.amountMinor / 100)}) for their order. Verify it to mark the payment as received.`,
        entityType: 'OrderPayment',
        entityId: created.id,
      },
    ]).catch(() => undefined);
    return r.status(201).send({ data: publicCustomerPayment(created) });
  });

  /** Business verifies one of its own order payments — atomically. */
  app.post('/api/v1/owner/order-payments/:id/verify', { preHandler: roles('BUSINESS_OWNER') }, async (q, r) => {
    const paymentId = (q.params as { id: string }).id;
    const owner = currentUser(q);
    try {
      const result = await prisma.$transaction(async (tx) => {
        const existing = await tx.orderPayment.findUnique({ where: { id: paymentId }, select: { businessId: true } });
        if (!existing) throw Object.assign(new Error('missing'), { code: 'NOT_FOUND' });
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${existing.businessId}))`;
        const payment = await tx.orderPayment.findUniqueOrThrow({
          where: { id: paymentId },
          include: { order: { include: { business: { select: { ownerId: true, name: true } } } } },
        });
        if (payment.order.business.ownerId !== owner.id) throw Object.assign(new Error('own'), { code: 'NOT_FOUND' });
        if (payment.status !== 'PENDING_VERIFICATION') throw Object.assign(new Error('dup'), { code: 'NOT_PENDING' });
        const verifiedSum = await tx.orderPayment.aggregate({
          where: { orderId: payment.orderId, status: 'PAID', id: { not: payment.id } },
          _sum: { amountMinor: true },
        });
        const due = payment.order.totalMinor - (verifiedSum._sum.amountMinor ?? 0);
        if (payment.amountMinor <= 0 || payment.amountMinor > due)
          throw Object.assign(new Error('amount'), { code: 'AMOUNT_INVALID' });
        const verified = await tx.orderPayment.update({
          where: { id: payment.id },
          data: { status: 'PAID', verifiedAt: new Date(), verifiedByUserId: owner.id },
        });
        await createNotifications(prisma, [
          {
            userId: payment.customerId,
            type: NOTIFICATION_TYPES.ORDER_PAYMENT_VERIFIED,
            title: 'Payment verified',
            message: `Your payment of Rs ${Math.round(payment.amountMinor / 100)} for your ${payment.order.business.name} order has been verified.`,
            entityType: 'OrderPayment',
            entityId: payment.id,
          },
        ], tx);
        return { verified, customerId: payment.customerId, paymentId: payment.id };
      });
      void dispatchPushNotifications([
        {
          userId: result.customerId,
          type: NOTIFICATION_TYPES.ORDER_PAYMENT_VERIFIED,
          title: 'Payment verified',
          message: 'Your payment has been verified.',
          entityType: 'OrderPayment',
          entityId: result.paymentId,
        },
      ]).catch(() => undefined);
      await prisma.auditLog.create({
        data: { actorId: owner.id, action: 'ORDER_PAYMENT_VERIFIED', entityType: 'OrderPayment', entityId: result.verified.id, metadata: { businessId: result.verified.businessId, amountMinor: result.verified.amountMinor } },
      });
      const full = await prisma.orderPayment.findUniqueOrThrow({ where: { id: paymentId }, include: { paymentMethod: PAYMENT_METHOD_SELECT } });
      return { data: publicCustomerPayment(full) };
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'NOT_FOUND') return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Payment not found' } });
      if (code === 'NOT_PENDING') return r.status(409).send({ error: { code: 'NOT_PENDING', message: 'This payment has already been reviewed' } });
      if (code === 'AMOUNT_INVALID') return r.status(409).send({ error: { code: 'AMOUNT_INVALID', message: 'Payment amount is no longer valid for this order' } });
      throw e;
    }
  });

  /** Business rejects one of its own order payments with a reason. */
  app.post('/api/v1/owner/order-payments/:id/reject', { preHandler: roles('BUSINESS_OWNER') }, async (q, r) => {
    const paymentId = (q.params as { id: string }).id;
    const owner = currentUser(q);
    const { reason } = customerPaymentRejectSchema.parse(q.body);
    try {
      const result = await prisma.$transaction(async (tx) => {
        const existing = await tx.orderPayment.findUnique({ where: { id: paymentId }, select: { businessId: true } });
        if (!existing) throw Object.assign(new Error('missing'), { code: 'NOT_FOUND' });
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${existing.businessId}))`;
        const payment = await tx.orderPayment.findUniqueOrThrow({
          where: { id: paymentId },
          include: { order: { include: { business: { select: { ownerId: true, name: true } } } } },
        });
        if (payment.order.business.ownerId !== owner.id) throw Object.assign(new Error('own'), { code: 'NOT_FOUND' });
        if (payment.status !== 'PENDING_VERIFICATION') throw Object.assign(new Error('dup'), { code: 'NOT_PENDING' });
        const rejected = await tx.orderPayment.update({
          where: { id: payment.id },
          data: { status: 'FAILED', rejectionReason: reason, verifiedAt: new Date(), verifiedByUserId: owner.id },
        });
        await createNotifications(prisma, [
          {
            userId: payment.customerId,
            type: NOTIFICATION_TYPES.ORDER_PAYMENT_REJECTED,
            title: 'Payment could not be verified',
            message: `${payment.order.business.name} could not verify your payment of Rs ${Math.round(payment.amountMinor / 100)}. Reason: ${reason} You can submit a new payment.`,
            entityType: 'OrderPayment',
            entityId: payment.id,
          },
        ], tx);
        return { rejected, customerId: payment.customerId, paymentId: payment.id };
      });
      void dispatchPushNotifications([
        {
          userId: result.customerId,
          type: NOTIFICATION_TYPES.ORDER_PAYMENT_REJECTED,
          title: 'Payment could not be verified',
          message: 'The business could not verify your payment. You can submit a new payment.',
          entityType: 'OrderPayment',
          entityId: result.paymentId,
        },
      ]).catch(() => undefined);
      await prisma.auditLog.create({
        data: { actorId: owner.id, action: 'ORDER_PAYMENT_REJECTED', entityType: 'OrderPayment', entityId: result.rejected.id, metadata: { businessId: result.rejected.businessId, amountMinor: result.rejected.amountMinor } },
      });
      const full = await prisma.orderPayment.findUniqueOrThrow({ where: { id: paymentId }, include: { paymentMethod: PAYMENT_METHOD_SELECT } });
      return { data: publicCustomerPayment(full) };
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'NOT_FOUND') return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Payment not found' } });
      if (code === 'NOT_PENDING') return r.status(409).send({ error: { code: 'NOT_PENDING', message: 'This payment has already been reviewed' } });
      throw e;
    }
  });

  /**
   * Owner records a cash collection (COD / cash on pickup) for one of their
   * orders. This is the only way a cash order becomes PAID — never by the
   * customer, and never merely because COD was selected at checkout.
   */
  app.post('/api/v1/owner/orders/:id/collect-cash', { preHandler: roles('BUSINESS_OWNER') }, async (q, r) => {
    const orderId = (q.params as { id: string }).id;
    const owner = currentUser(q);
    const order = await prisma.order.findUnique({ where: { id: orderId }, include: { business: { select: { ownerId: true, name: true } } } });
    if (!order || order.business.ownerId !== owner.id)
      return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Order not found' } });
    const verifiedSum = await prisma.orderPayment.aggregate({
      where: { orderId: order.id, status: 'PAID' },
      _sum: { amountMinor: true },
    });
    const due = order.totalMinor - (verifiedSum._sum.amountMinor ?? 0);
    if (due <= 0) return r.status(409).send({ error: { code: 'NOTHING_DUE', message: 'This order is already fully paid' } });
    const record = await prisma.orderPayment.create({
      data: {
        orderId: order.id,
        businessId: order.businessId,
        customerId: order.customerId,
        amountMinor: due,
        currency: order.currency,
        method: 'CASH',
        status: 'PAID',
        submittedAt: new Date(),
        verifiedAt: new Date(),
        verifiedByUserId: owner.id,
      },
    });
    await prisma.auditLog.create({
      data: { actorId: owner.id, action: 'ORDER_CASH_COLLECTED', entityType: 'OrderPayment', entityId: record.id, metadata: { orderId: order.id, businessId: order.businessId, amountMinor: due } },
    });
    await createNotifications(prisma, [
      {
        userId: order.customerId,
        type: NOTIFICATION_TYPES.ORDER_PAYMENT_VERIFIED,
        title: 'Payment received',
        message: `${order.business.name} received your cash payment of Rs ${Math.round(due / 100)}. Thank you!`,
        entityType: 'OrderPayment',
        entityId: record.id,
      },
    ]);
    void dispatchPushNotifications([
      {
        userId: order.customerId,
        type: NOTIFICATION_TYPES.ORDER_PAYMENT_VERIFIED,
        title: 'Payment received',
        message: `${order.business.name} received your cash payment of Rs ${Math.round(due / 100)}. Thank you!`,
        entityType: 'OrderPayment',
        entityId: record.id,
      },
    ]).catch(() => undefined);
    const full = await prisma.orderPayment.findUniqueOrThrow({ where: { id: record.id }, include: { paymentMethod: PAYMENT_METHOD_SELECT } });
    return r.status(201).send({ data: publicCustomerPayment(full) });
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
    const advance = resolveServiceAdvance(d, d.priceMinor);
    if ('error' in advance) return r.status(400).send({ error: { code: 'VALIDATION_ERROR', message: advance.error } });
    return r.status(201).send({ data: await prisma.service.create({ data: { ...d, ...advance.advance, businessId: id } }) });
  });

  app.patch('/api/v1/services/:id', { preHandler: roles('BUSINESS_OWNER') }, async (q, r) => {
    const id = (q.params as { id: string }).id;
    const service = await prisma.service.findUnique({ where: { id } });
    if (!service) return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Service not found' } });
    await ownedBusiness(q, service.businessId);
    const d = serviceUpdateSchema.parse(q.body);
    // Validate the advance against the NEW effective price (patched price or
    // the stored one) so a fixed advance can never exceed the service price.
    const price = d.priceMinor ?? service.priceMinor;
    const merged = {
      advanceType: d.advanceType ?? service.advanceType,
      advanceAmountMinor: d.advanceAmountMinor ?? (d.advanceType ? undefined : service.advanceAmountMinor ?? undefined),
      advancePercent: d.advancePercent ?? (d.advanceType ? undefined : service.advancePercent ?? undefined),
    };
    const advance = resolveServiceAdvance(merged, price);
    if ('error' in advance) return r.status(400).send({ error: { code: 'VALIDATION_ERROR', message: advance.error } });
    return { data: await prisma.service.update({ where: { id: service.id }, data: { ...d, ...advance.advance } }) };
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
    servicePriceMinor?: number;
    advanceRequiredMinor?: number;
    amountPaidMinor?: number;
    business: { id: string; name: string; slug: string; ownerId: string; imageUrl?: string | null };
    service: { id: string; name: string; durationMinutes: number | null; priceMinor: number; currency: string } | null | undefined;
  }) => ({
    id: booking.id,
    businessId: booking.business.id,
    businessName: booking.business.name,
    businessSlug: booking.business.slug,
    businessImageUrl: booking.business.imageUrl ?? null,
    serviceId: booking.service?.id ?? null,
    serviceName: booking.service?.name ?? null,
    priceMinor: booking.service?.priceMinor ?? null,
    currency: booking.service?.currency ?? 'PKR',
    // Payment snapshot (Phase 7C) — the booking's own frozen amounts, never
    // the service's current ones.
    servicePriceMinor: booking.servicePriceMinor ?? 0,
    advanceRequiredMinor: booking.advanceRequiredMinor ?? 0,
    amountPaidMinor: booking.amountPaidMinor ?? 0,
    amountDueMinor:
      booking.servicePriceMinor !== undefined
        ? Math.max(booking.servicePriceMinor - Math.max(booking.amountPaidMinor ?? 0, booking.advanceRequiredMinor ?? 0), 0)
        : null,
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
    business: { select: { id: true, name: true, slug: true, ownerId: true, imageUrl: true } },
    service: { select: { id: true, name: true, durationMinutes: true, priceMinor: true, currency: true } },
  } as const;

  /**
   * Shared order include. `business.ownerId` is selected only to authorize
   * owners; it is stripped by publicOrder and never serialized to clients.
   */
  const ORDER_INCLUDE = {
    business: { select: { id: true, name: true, slug: true, ownerId: true, imageUrl: true } },
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

  app.post('/api/v1/bookings', { preHandler: roles('CUSTOMER', 'BUSINESS_OWNER') }, async (q, r) => {
    const d = bookingCreateSchema.parse(q.body);

    const business = await prisma.business.findFirst({
      where: { id: d.businessId, status: 'APPROVED', archivedAt: null },
      include: { hours: true },
    });
    if (!business) return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Business not found' } });
    // Business owners may book OTHER businesses as customers, never their own
    // (a self-booking would let them manufacture booking history).
    if (business.ownerId === currentUser(q).id)
      return r.status(400).send({ error: { code: 'SELF_BOOKING', message: 'You cannot book your own business' } });

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
    const customer = currentUser(q);
    // Payment snapshot (Phase 7C): the agreed amounts are frozen at booking
    // time. Later service price/advance edits never rewrite existing bookings.
    const advanceRequiredMinor = serviceAdvanceMinor({
      advanceType: service.advanceType,
      advanceAmountMinor: service.advanceAmountMinor,
      advancePercent: service.advancePercent,
      priceMinor: service.priceMinor,
    });
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
      const created = await tx.booking.create({
        data: {
          customerId: customer.id,
          businessId: business.id,
          serviceId: service.id,
          bookingDate: new Date(Date.parse(`${d.date}T00:00:00Z`)),
          startAt,
          endAt,
          notes: d.notes,
          servicePriceMinor: service.priceMinor,
          advanceRequiredMinor,
          amountPaidMinor: 0,
        },
      });
      // Owner notification commits atomically with the booking — a rolled-back
      // booking can never leave a phantom notification.
      await createNotifications(prisma, [
        {
          userId: business.ownerId,
          type: NOTIFICATION_TYPES.BOOKING_CREATED,
          title: 'New booking request',
          message: `${customer.firstName ?? customer.email.split('@')[0]} booked ${service.name} on ${d.date} at ${d.startTime}.`,
          entityType: 'Booking',
          entityId: created.id,
        },
      ], tx);
      return created;
    });
    void dispatchPushNotifications([
      {
        userId: business.ownerId,
        type: NOTIFICATION_TYPES.BOOKING_CREATED,
        title: 'New booking request',
        message: `${customer.firstName ?? customer.email.split('@')[0]} booked ${service.name} on ${d.date} at ${d.startTime}.`,
        entityType: 'Booking',
        entityId: booking.id,
      },
    ]).catch(() => undefined);

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

    // /bookings is always the CALLER'S OWN bookings (customer identity).
    // Business-mode listing uses /businesses/:id/bookings.
    if (u.role !== 'ADMIN') {
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

  app.post('/api/v1/bookings/:id/cancel', { preHandler: roles('CUSTOMER', 'BUSINESS_OWNER') }, async (q, r) => {
    const booking = await loadVisibleBooking(q, (q.params as { id: string }).id);
    if (booking.customerId !== currentUser(q).id)
      return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Booking not found' } });
    if (!allowedTransitions.booking[booking.status].includes('CANCELLED'))
      return r.status(409).send({ error: { code: 'INVALID_TRANSITION', message: `A ${booking.status.toLowerCase()} booking cannot be cancelled` } });
    const cancelled = await prisma.$transaction(async (tx) => {
      const updated = await tx.booking.update({ where: { id: booking.id }, data: { status: 'CANCELLED' } });
      await createNotifications(prisma, [
        {
          userId: booking.business.ownerId,
          type: NOTIFICATION_TYPES.BOOKING_CANCELLED,
          title: 'Booking cancelled',
          message: `${currentUser(q).firstName ?? 'A customer'} cancelled their ${booking.service?.name ?? 'booking'} on ${pktDateOf(booking.startAt)}.`,
          entityType: 'Booking',
          entityId: booking.id,
        },
      ], tx);
      return updated;
    });
    void dispatchPushNotifications([
      {
        userId: booking.business.ownerId,
        type: NOTIFICATION_TYPES.BOOKING_CANCELLED,
        title: 'Booking cancelled',
        message: `${currentUser(q).firstName ?? 'A customer'} cancelled their ${booking.service?.name ?? 'booking'} on ${pktDateOf(booking.startAt)}.`,
        entityType: 'Booking',
        entityId: booking.id,
      },
    ]).catch(() => undefined);
    return { data: publicBooking({ ...cancelled, business: booking.business, service: booking.service }) };
  });

  app.patch('/api/v1/bookings/:id/status', { preHandler: roles('BUSINESS_OWNER', 'ADMIN') }, async (q, r) => {
    const status = bookingStatusSchema.parse((q.body as { status: string }).status);
    const booking = await loadVisibleBooking(q, (q.params as { id: string }).id);
    if (currentUser(q).role === 'BUSINESS_OWNER' && booking.business.ownerId !== currentUser(q).id)
      return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Booking not found' } });
    if (!allowedTransitions.booking[booking.status].includes(status))
      return r.status(409).send({ error: { code: 'INVALID_TRANSITION', message: `Cannot change a ${booking.status.toLowerCase()} booking to ${status.toLowerCase()}` } });
    // Status-change notification for the customer (only transitions that exist).
    const customerNotice: Record<string, { type: NotificationType; title: string; message: (serviceName: string, when: string) => string } | undefined> = {
      CONFIRMED: {
        type: NOTIFICATION_TYPES.BOOKING_ACCEPTED,
        title: 'Booking accepted',
        message: (s, w) => `Your ${s} booking on ${w} has been accepted.`,
      },
      REJECTED: {
        type: NOTIFICATION_TYPES.BOOKING_REJECTED,
        title: 'Booking declined',
        message: (s, w) => `Unfortunately your ${s} booking on ${w} was declined.`,
      },
      COMPLETED: {
        type: NOTIFICATION_TYPES.BOOKING_COMPLETED,
        title: 'Booking completed',
        message: (s, w) => `Your ${s} booking on ${w} is complete. Thanks for choosing ${booking.business.name}!`,
      },
    };
    const notice = customerNotice[status];
    const updated = await prisma.$transaction(async (tx) => {
      // completedAt is stamped once, atomically with the status change, so
      // revenue windows can be derived honestly (Phase 16).
      const row = await tx.booking.update({
        where: { id: booking.id },
        data: { status, ...(status === 'COMPLETED' ? { completedAt: new Date() } : {}) },
      });
      if (notice) {
        await createNotifications(prisma, [
          {
            userId: booking.customerId,
            type: notice.type,
            title: notice.title,
            message: notice.message(booking.service?.name ?? 'booking', pktDateOf(booking.startAt)),
            entityType: 'Booking',
            entityId: booking.id,
          },
        ], tx);
      }
      return { row, pushUserId: notice ? booking.customerId : null };
    });
    if (updated.pushUserId) {
      void dispatchPushNotifications([
        {
          userId: updated.pushUserId,
          type: notice!.type,
          title: notice!.title,
          message: notice!.message(booking.service?.name ?? 'booking', pktDateOf(booking.startAt)),
          entityType: 'Booking',
          entityId: booking.id,
        },
      ]).catch(() => undefined);
    }
    return { data: publicBooking({ ...updated.row, business: booking.business, service: booking.service }) };
  });

  /**
   * Customer-safe order shape: no internal user columns, no email. OrderItem
   * rows carry the purchase-time name/unitPriceMinor, so history survives
   * later product edits or deletion of the underlying product.
   */
  const publicOrder = (o: Prisma.OrderGetPayload<{ include: typeof ORDER_INCLUDE }> & { deliveryFeeMinor?: number; totalMinor?: number; paymentMethodId?: string | null }) => ({
    id: o.id,
    status: o.status,
    subtotalMinor: o.subtotalMinor,
    // Delivery fee + authoritative total (Phase 7C). Total = subtotal + fee,
    // both server-computed; the client never sends money values.
    deliveryFeeMinor: o.deliveryFeeMinor ?? 0,
    totalMinor: o.totalMinor ?? o.subtotalMinor,
    currency: o.currency,
    fulfillmentType: o.fulfillmentType,
    // Chosen manual digital channel (null = cash on delivery/pickup). The
    // payment STATE lives on OrderPayment rows, never inferred from status.
    paymentMethodId: o.paymentMethodId ?? null,
    notes: o.notes,
    createdAt: o.createdAt,
    business: { id: o.business.id, name: o.business.name, slug: o.business.slug, imageUrl: o.business.imageUrl ?? null },
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

  app.post('/api/v1/orders', { preHandler: roles('CUSTOMER', 'BUSINESS_OWNER') }, async (q, r) => {
    const d = orderSchema.parse(q.body);
    // Orders may only be placed with approved, visible businesses.
    const business = await prisma.business.findFirst({
      where: { id: d.businessId, status: 'APPROVED', archivedAt: null },
      select: { id: true, ownerId: true },
    });
    if (!business) return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Business not found' } });
    // Business owners may order from OTHER businesses as customers, never from
    // their own (a self-order would let them manufacture order history).
    if (business.ownerId === currentUser(q).id)
      return r.status(400).send({ error: { code: 'SELF_ORDER', message: 'You cannot order from your own business' } });
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
    const customer = currentUser(q);
    const itemCount = d.items.reduce((sum, i) => sum + i.quantity, 0);
    // Delivery fee + chosen payment channel come from BUSINESS settings and
    // server-side validation only (Phase 7C). A DELIVERY order without the
    // business's deliveryEnabled flag is rejected; the fee is never
    // client-controlled and pickup/collection orders are never charged one.
    const businessSettings = await prisma.business.findUniqueOrThrow({
      where: { id: d.businessId },
      select: { deliveryEnabled: true, codEnabled: true, deliveryFeeMinor: true },
    });
    if (d.fulfillmentType === 'DELIVERY' && !businessSettings.deliveryEnabled)
      return r.status(400).send({ error: { code: 'DELIVERY_UNAVAILABLE', message: 'This business does not offer delivery' } });
    const deliveryFeeMinor = d.fulfillmentType === 'DELIVERY' ? businessSettings.deliveryFeeMinor : 0;
    // Manual digital channel (Easypaisa etc.): must be one of this business's
    // ACTIVE pay-in methods. Cash flows (COD/pickup) omit it entirely.
    let paymentMethodId: string | null = null;
    if (d.paymentMethodId) {
      const method = await prisma.businessPaymentMethod.findFirst({
        where: { id: d.paymentMethodId, businessId: d.businessId, isActive: true },
        select: { id: true, type: true },
      });
      if (!method || method.type === 'CASH')
        return r.status(400).send({ error: { code: 'INVALID_PAYMENT_METHOD', message: 'Choose a valid payment method' } });
      paymentMethodId = method.id;
    } else if (d.fulfillmentType === 'DELIVERY' && !businessSettings.codEnabled) {
      return r.status(400).send({ error: { code: 'COD_UNAVAILABLE', message: 'Cash on delivery is not available for this business — choose a payment method' } });
    }
    const totalMinor = subtotalMinor + deliveryFeeMinor;
    let pushNotice: NotificationInput | null = null;
    const created = await prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          businessId: d.businessId,
          customerId: customer.id,
          subtotalMinor,
          deliveryFeeMinor,
          totalMinor,
          paymentMethodId,
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
      // Owner notification commits atomically with the order.
      const owner = await tx.business.findUnique({ where: { id: d.businessId }, select: { ownerId: true } });
      if (owner) {
        await createNotifications(prisma, [
          {
            userId: owner.ownerId,
            type: NOTIFICATION_TYPES.ORDER_CREATED,
            title: 'New order received',
            message: `${customer.firstName ?? 'A customer'} placed an order (${itemCount} item${itemCount === 1 ? '' : 's'}, Rs ${Math.round(totalMinor / 100)}${deliveryFeeMinor > 0 ? ' incl. delivery' : ''}).`,
            entityType: 'Order',
            entityId: order.id,
          },
        ], tx);
        pushNotice = {
          userId: owner.ownerId,
          type: NOTIFICATION_TYPES.ORDER_CREATED,
          title: 'New order received',
          message: `${customer.firstName ?? 'A customer'} placed an order (${itemCount} item${itemCount === 1 ? '' : 's'}, Rs ${Math.round(totalMinor / 100)}${deliveryFeeMinor > 0 ? ' incl. delivery' : ''}).`,
          entityType: 'Order',
          entityId: order.id,
        };
      }
      return order;
    });
    if (pushNotice) void dispatchPushNotifications([pushNotice]).catch(() => undefined);
    return r.status(201).send({ data: publicOrder(created) });
  });

  app.get('/api/v1/orders', { preHandler: auth }, async (q) => {
    const u = currentUser(q);
    // /orders is always the CALLER'S OWN placed orders (customer identity).
    // Business-mode listing uses /owner/orders; admins never see a mixed feed.
    const where = { customerId: u.id };
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
      include: ORDER_INCLUDE,
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
    // Customer notifications for owner-driven changes; owner notification for
    // customer cancellation. Only transitions the system actually supports.
    const noticeFor = (next: string): { userId: string; type: NotificationType; title: string; message: string } | null => {
      const entity = { entityType: 'Order' as const, entityId: o.id };
      if (isOwner) {
        const map: Record<string, { type: NotificationType; title: string; message: string }> = {
          ACCEPTED: { type: NOTIFICATION_TYPES.ORDER_ACCEPTED, title: 'Order accepted', message: `${o.business.name} accepted your order.` },
          REJECTED: { type: NOTIFICATION_TYPES.ORDER_REJECTED, title: 'Order declined', message: `Unfortunately ${o.business.name} could not accept your order.` },
          PREPARING: { type: NOTIFICATION_TYPES.ORDER_PREPARING, title: 'Your order is being prepared', message: `${o.business.name} is now preparing your order.` },
          READY: { type: NOTIFICATION_TYPES.ORDER_READY, title: 'Order ready', message: `Your order from ${o.business.name} is ready.` },
          COMPLETED: { type: NOTIFICATION_TYPES.ORDER_COMPLETED, title: 'Order completed', message: `Your order from ${o.business.name} is complete. Enjoy!` },
          CANCELLED: { type: NOTIFICATION_TYPES.ORDER_CANCELLED, title: 'Order cancelled', message: `Your order from ${o.business.name} was cancelled.` },
        };
        const n = map[next];
        return n ? { userId: o.customerId, ...n, ...entity } : null;
      }
      // Customer cancelled → notify the owner.
      if (next === 'CANCELLED') {
        return {
          userId: o.business.ownerId,
          type: NOTIFICATION_TYPES.ORDER_CANCELLED,
          title: 'Order cancelled',
          message: `${u.firstName ?? 'A customer'} cancelled their order (Rs ${Math.round(o.subtotalMinor / 100)}).`,
          ...entity,
        };
      }
      return null;
    };
    const notice = noticeFor(status);
    await prisma.$transaction(async (tx) => {
      // completedAt is stamped once, atomically with the status change, so
      // revenue windows can be derived honestly (Phase 16).
      await tx.order.update({
        where: { id: o.id },
        data: { status, ...(status === 'COMPLETED' ? { completedAt: new Date() } : {}) },
      });
      if (notice) {
        await createNotifications(prisma, [
          {
            userId: notice.userId,
            type: notice.type,
            title: notice.title,
            message: notice.message,
            entityType: 'Order',
            entityId: o.id,
          },
        ], tx);
      }
    });
    if (notice) {
      void dispatchPushNotifications([
        {
          userId: notice.userId,
          type: notice.type,
          title: notice.title,
          message: notice.message,
          entityType: 'Order',
          entityId: o.id,
        },
      ]).catch(() => undefined);
    }
    // Refetch with the full include for the authoritative response.
    const fresh = await prisma.order.findUnique({ where: { id: o.id }, include: ORDER_INCLUDE });
    return { data: publicOrder(fresh!) };
  });

  /* ------------------------------ Reviews ------------------------------ */

  /** Public review DTO: reviewer is reduced to a display name, nothing else. */
  const publicReview = (rv: {
    id: string;
    rating: number;
    comment: string | null;
    createdAt: Date;
    customer: { firstName: string | null; lastName: string | null };
  }) => ({
    id: rv.id,
    rating: rv.rating,
    comment: rv.comment,
    createdAt: rv.createdAt,
    reviewerName: [rv.customer.firstName, rv.customer.lastName ? `${rv.customer.lastName[0]}.` : null]
      .filter(Boolean)
      .join(' ') || 'Customer',
  });

  const REVIEW_LIST_SELECT = {
    id: true,
    rating: true,
    comment: true,
    createdAt: true,
    customer: { select: { firstName: true, lastName: true } },
  } as const;

  /** Aggregates over the complete review set — never just the visible page. */
  const ratingSummary = async (businessId: string) => {
    const agg = await prisma.review.aggregate({
      // Moderation (Phase 15): admin-hidden reviews never move public ratings.
      where: { businessId, isHiddenAt: null },
      _avg: { rating: true },
      _count: { rating: true },
    });
    return {
      averageRating: agg._avg.rating === null ? null : Math.round(agg._avg.rating * 10) / 10,
      reviewCount: agg._count.rating,
    };
  };

  app.post('/api/v1/businesses/:businessId/reviews', { preHandler: roles('CUSTOMER', 'BUSINESS_OWNER') }, async (q, r) => {
    const u = currentUser(q);
    const businessId = (q.params as { businessId: string }).businessId;
    const d = reviewCreateSchema.parse(q.body);

    // Eligibility is proven by the transaction, not claimed by the client:
    // it must exist, belong to this customer, belong to this business, and be
    // COMPLETED. Everything else is rejected.
    let source: { businessId: string } | null = null;
    if (d.bookingId) {
      const booking = await prisma.booking.findFirst({
        where: { id: d.bookingId, customerId: u.id, businessId, status: 'COMPLETED' },
        select: { businessId: true },
      });
      source = booking;
    } else if (d.orderId) {
      const order = await prisma.order.findFirst({
        where: { id: d.orderId, customerId: u.id, businessId, status: 'COMPLETED' },
        select: { businessId: true },
      });
      source = order;
    }
    if (!source)
      return r
        .status(404)
        .send({ error: { code: 'NOT_FOUND', message: 'You can only review a completed booking or order of your own' } });

    try {
      const created = await prisma.review.create({
        data: {
          businessId,
          customerId: u.id,
          bookingId: d.bookingId ?? null,
          orderId: d.orderId ?? null,
          rating: d.rating,
          comment: d.comment ?? null,
        },
        select: REVIEW_LIST_SELECT,
      });
      // New event (Phase 13): the business owner learns about every review.
      const owner = await prisma.business.findUniqueOrThrow({ where: { id: businessId }, select: { ownerId: true } });
      const reviewerName = u.firstName ?? 'A customer';
      await createNotifications(prisma, [
        {
          userId: owner.ownerId,
          type: NOTIFICATION_TYPES.REVIEW_CREATED,
          title: 'New review',
          message: `${reviewerName} left a ${d.rating}-star review on your business.`,
          entityType: 'Review',
          entityId: businessId,
        },
      ]);
      void dispatchPushNotifications([
        {
          userId: owner.ownerId,
          type: NOTIFICATION_TYPES.REVIEW_CREATED,
          title: 'New review',
          message: `${reviewerName} left a ${d.rating}-star review on your business.`,
          entityType: 'Review',
          entityId: businessId,
        },
      ]).catch(() => undefined);
      return r.status(201).send({ data: publicReview(created) });
    } catch (e) {
      // The partial unique indexes make duplicate reviews impossible even
      // under concurrent submissions.
      if ((e as { code?: string }).code === 'P2002')
        return r.status(409).send({ error: { code: 'ALREADY_REVIEWED', message: 'You have already reviewed this' } });
      throw e;
    }
  });

  // Public reviews + rating summary for a business. Public business discovery
  // is unauthenticated, so reading reviews is too; nothing private is exposed.
  app.get('/api/v1/businesses/:businessId/reviews', async (q) => {
    const businessId = (q.params as { businessId: string }).businessId;
    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(50).default(10),
        cursor: z.string().uuid().optional(),
      })
      .parse(q.query ?? {});
    const [rows, summary] = await Promise.all([
      prisma.review.findMany({
        where: { businessId, isHiddenAt: null },
        select: REVIEW_LIST_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      }),
      ratingSummary(businessId),
    ]);
    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, -1) : rows;
    return {
      data: {
        items: items.map(publicReview),
        nextCursor: hasMore ? items[items.length - 1]!.id : null,
        ...summary,
      },
    };
  });

  // The customer's own reviews: lets detail screens show "Reviewed" instead of
  // a second review CTA, and doubles as a simple review history.
  app.get('/api/v1/my-reviews', { preHandler: roles('CUSTOMER', 'BUSINESS_OWNER') }, async (q) => {
    const rows = await prisma.review.findMany({
      where: { customerId: currentUser(q).id },
      select: {
        id: true,
        rating: true,
        comment: true,
        createdAt: true,
        bookingId: true,
        orderId: true,
        business: { select: { id: true, name: true, slug: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
    });
    return {
      data: rows.map((rv) => ({
        id: rv.id,
        rating: rv.rating,
        comment: rv.comment,
        createdAt: rv.createdAt,
        bookingId: rv.bookingId,
        orderId: rv.orderId,
        business: rv.business,
      })),
    };
  });

  // Reviews across every business the owner manages; scoped by ownerId so a
  // foreign business's reviews are never returned.
  app.get('/api/v1/my-business-reviews', { preHandler: roles('BUSINESS_OWNER') }, async (q) => {
    const rows = await prisma.review.findMany({
      where: { business: { ownerId: currentUser(q).id } },
      select: {
        id: true,
        rating: true,
        comment: true,
        createdAt: true,
        business: { select: { id: true, name: true } },
        customer: { select: { firstName: true, lastName: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
    });
    return { data: rows.map((rv) => ({ ...publicReview(rv), business: rv.business })) };
  });

  /* -------------------------- Notifications -------------------------- */

  /** Customer-safe notification DTO: explicit fields only, no relations. */
  const publicNotification = (n: {
    id: string;
    type: string;
    title: string;
    message: string;
    entityType: string;
    entityId: string;
    isRead: boolean;
    readAt: Date | null;
    createdAt: Date;
  }) => ({
    id: n.id,
    type: n.type,
    title: n.title,
    message: n.message,
    entityType: n.entityType,
    entityId: n.entityId,
    isRead: n.isRead,
    readAt: n.readAt,
    createdAt: n.createdAt,
  });

  const notificationSelect = {
    id: true,
    type: true,
    title: true,
    message: true,
    entityType: true,
    entityId: true,
    isRead: true,
    readAt: true,
    createdAt: true,
  } as const;

  app.get('/api/v1/notifications', { preHandler: auth }, async (q) => {
    const u = currentUser(q);
    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(50).default(30),
        cursor: z.string().uuid().optional(),
      })
      .parse(q.query ?? {});
    const rows = await prisma.notification.findMany({
      where: { userId: u.id },
      select: notificationSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, -1) : rows;
    // Wrapped like every other endpoint ({ data: ... }) so the mobile client's
    // single unwrap yields { items, nextCursor } instead of a bare array that
    // would silently drop the pagination cursor.
    return {
      data: {
        items: items.map(publicNotification),
        nextCursor: hasMore ? items[items.length - 1]!.id : null,
      },
    };
  });

  app.get('/api/v1/notifications/unread-count', { preHandler: auth }, async (q) => {
    const count = await prisma.notification.count({ where: { userId: currentUser(q).id, isRead: false } });
    return { data: { count } };
  });

  app.patch('/api/v1/notifications/:id/read', { preHandler: auth }, async (q, r) => {
    const u = currentUser(q);
    const id = (q.params as { id: string }).id;
    // 404 (not 403) when the notification belongs to someone else.
    const existing = await prisma.notification.findFirst({ where: { id, userId: u.id }, select: { id: true } });
    if (!existing) return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Notification not found' } });
    const updated = await prisma.notification.update({
      where: { id },
      data: { isRead: true, readAt: new Date() },
      select: notificationSelect,
    });
    return { data: publicNotification(updated) };
  });

  app.patch('/api/v1/notifications/read-all', { preHandler: auth }, async (q) => {
    const u = currentUser(q);
    const result = await prisma.notification.updateMany({
      where: { userId: u.id, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    return { data: { updated: result.count } };
  });

  /* ------------------ Push devices & preferences (13) ----------------- */

  const deviceSelect = {
    id: true,
    platform: true,
    deviceId: true,
    isActive: true,
    lastSeenAt: true,
    createdAt: true,
    // pushToken deliberately excluded: an opaque provider credential.
  };

  const deviceRegisterBodySchema = z
    .object({
      platform: z.enum(['android', 'ios', 'web']),
      pushToken: z.string().min(16).max(4096),
      deviceId: z.string().min(4).max(128).optional(),
    })
    .strict();

  /**
   * Registers (or re-activates) a push target for the signed-in user. The
   * unique pushToken makes this idempotent: re-registering the same native
   * token - including from a reinstalled app under a different user - flips
   * it to this user and marks it active, never creating duplicates.
   */
  app.post('/api/v1/push/devices', { preHandler: auth }, async (q, r) => {
    const u = currentUser(q);
    const parsed = deviceRegisterBodySchema.safeParse(q.body);
    if (!parsed.success)
      return r.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid device payload' } });
    const { platform, pushToken, deviceId } = parsed.data;
    const device = await prisma.pushDevice.upsert({
      where: { pushToken },
      create: { userId: u.id, platform, pushToken, deviceId: deviceId ?? null },
      // A token always belongs to exactly one live registration: if it was
      // previously another user's (or deactivated), it now means THIS user.
      update: { userId: u.id, platform, deviceId: deviceId ?? null, isActive: true, lastSeenAt: new Date() },
      select: deviceSelect,
    });
    return r.status(201).send({ data: device });
  });

  /** Lists the caller's own registered devices (never the raw tokens). */
  app.get('/api/v1/push/devices', { preHandler: auth }, async (q) => {
    const devices = await prisma.pushDevice.findMany({
      where: { userId: currentUser(q).id },
      orderBy: { createdAt: 'desc' },
      select: deviceSelect,
    });
    return { data: devices };
  });

  /** Deactivates one of the caller's own devices (404 for anyone else's). */
  app.delete('/api/v1/push/devices/:id', { preHandler: auth }, async (q, r) => {
    const u = currentUser(q);
    const id = (q.params as { id: string }).id;
    const existing = await prisma.pushDevice.findFirst({ where: { id, userId: u.id }, select: { id: true } });
    if (!existing) return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Device not found' } });
    await prisma.pushDevice.update({ where: { id }, data: { isActive: false } });
    return { data: { id, isActive: false } };
  });

  const preferencesSchema = z
    .object({
      bookings: z.boolean(),
      orders: z.boolean(),
      payments: z.boolean(),
      reviews: z.boolean(),
      businessActivity: z.boolean(),
      account: z.boolean(),
    })
    .strict();

  /** Push preferences for the signed-in user (missing row = all on). */
  app.get('/api/v1/notifications/preferences', { preHandler: auth }, async (q) => {
    const u = currentUser(q);
    const row = await prisma.notificationPreference.findUnique({ where: { userId: u.id } });
    return {
      data:
        row ?? {
          userId: u.id,
          bookings: true,
          orders: true,
          payments: true,
          reviews: true,
          businessActivity: true,
          account: true,
        },
    };
  });

  app.put('/api/v1/notifications/preferences', { preHandler: auth }, async (q, r) => {
    const u = currentUser(q);
    const parsed = preferencesSchema.safeParse(q.body);
    if (!parsed.success)
      return r.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid preferences payload' } });
    const saved = await prisma.notificationPreference.upsert({
      where: { userId: u.id },
      create: { userId: u.id, ...parsed.data },
      update: parsed.data,
    });
    return { data: saved };
  });

  /* ------------------------------ Admin ------------------------------ */
  /**
   * Admin list endpoints for the web panel. Every route here requires the
   * ADMIN role server-side; customer/owner tokens get 403 at the preHandler.
   * User listings never expose passwordHash: only safe identity fields.
   */
  const ADMIN_USER_SELECT = {
    id: true,
    email: true,
    role: true,
    firstName: true,
    lastName: true,
    phone: true,
    isSuspended: true,
    createdAt: true,
  } as const;

  app.get('/api/v1/admin/users', { preHandler: roles('ADMIN') }, async (q) => {
    const query = z.object({ q: z.string().trim().max(120).optional(), role: z.enum(['CUSTOMER', 'BUSINESS_OWNER', 'ADMIN']).optional(), suspended: z.enum(['true', 'false']).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).parse(q.query);
    const where: Record<string, unknown> = {};
    if (query.q) where.OR = [{ email: { contains: query.q, mode: 'insensitive' } }, { firstName: { contains: query.q, mode: 'insensitive' } }, { lastName: { contains: query.q, mode: 'insensitive' } }];
    if (query.role) where.role = query.role;
    if (query.suspended) where.isSuspended = query.suspended === 'true';
    const users = await prisma.user.findMany({ where, select: ADMIN_USER_SELECT, orderBy: { createdAt: 'desc' }, take: query.limit });
    return { data: users };
  });

  /** One user plus counts of their platform relationships (no credentials). */
  app.get('/api/v1/admin/users/:id', { preHandler: roles('ADMIN') }, async (q, r) => {
    const user = await prisma.user.findUnique({
      where: { id: (q.params as { id: string }).id },
      select: { ...ADMIN_USER_SELECT, _count: { select: { businesses: true, bookings: true, orders: true, reviews: true } } },
    });
    if (!user) return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'User not found' } });
    const { _count, ...rest } = user;
    return { data: { ...rest, counts: _count } };
  });

  /** Suspend or reinstate a user. Admins cannot suspend other admins. */
  app.patch('/api/v1/admin/users/:id/suspension', { preHandler: roles('ADMIN') }, async (q, r) => {
    const { suspended } = z.object({ suspended: z.boolean() }).parse(q.body);
    const target = await prisma.user.findUnique({ where: { id: (q.params as { id: string }).id }, select: { id: true, role: true } });
    if (!target) return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'User not found' } });
    if (target.role === 'ADMIN') return r.status(409).send({ error: { code: 'ADMIN_IMMUTABLE', message: 'Administrator accounts cannot be suspended' } });
    const user = await prisma.user.update({ where: { id: target.id }, data: { isSuspended: suspended }, select: ADMIN_USER_SELECT });
    await prisma.auditLog.create({
      data: { actorId: currentUser(q).id, action: suspended ? 'USER_SUSPENDED' : 'USER_REINSTATED', entityType: 'User', entityId: user.id, metadata: { email: user.email } },
    });
    return { data: user };
  });

  /** Full business list across all statuses, with owner identity. */
  app.get('/api/v1/admin/businesses', { preHandler: roles('ADMIN') }, async (q) => {
    const query = z.object({ q: z.string().trim().max(120).optional(), status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED', 'ARCHIVED']).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).parse(q.query);
    const where: Record<string, unknown> = {};
    if (query.q) where.OR = [{ name: { contains: query.q, mode: 'insensitive' } }, { city: { contains: query.q, mode: 'insensitive' } }];
    if (query.status) where.status = query.status;
    const businesses = await prisma.business.findMany({
      where,
      select: {
        id: true, name: true, slug: true, status: true, isVerified: true, city: true, address: true, createdAt: true,
        owner: { select: { id: true, email: true, firstName: true, lastName: true } },
        // Operational activity counts (Phase 16): real aggregates, no tokens,
        // no customer data — just how alive this business is on the platform.
        _count: { select: { orders: true, bookings: true, services: true, products: true, reviews: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: query.limit,
    });
    return { data: businesses.map(({ _count, ...b }) => ({ ...b, counts: _count })) };
  });

  /** Verify/unverify a business (trust badge), separate from approval status. */
  app.patch('/api/v1/admin/businesses/:id/verification', { preHandler: roles('ADMIN') }, async (q, r) => {
    const { verified } = z.object({ verified: z.boolean() }).parse(q.body);
    const id = (q.params as { id: string }).id;
    const existing = await prisma.business.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Business not found' } });
    const business = await prisma.business.update({ where: { id }, data: { isVerified: verified } });
    await prisma.auditLog.create({
      data: { actorId: currentUser(q).id, action: verified ? 'BUSINESS_VERIFIED' : 'BUSINESS_UNVERIFIED', entityType: 'Business', entityId: id, metadata: { name: business.name } },
    });
    return { data: { id: business.id, isVerified: business.isVerified } };
  });

  /** Orders across all businesses with business + customer identity. */
  app.get('/api/v1/admin/orders', { preHandler: roles('ADMIN') }, async (q) => {
    const query = z.object({ q: z.string().trim().max(120).optional(), status: z.enum(['PENDING', 'ACCEPTED', 'REJECTED', 'PREPARING', 'READY', 'COMPLETED', 'CANCELLED']).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).parse(q.query);
    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;
    if (query.q) where.business = { name: { contains: query.q, mode: 'insensitive' } };
    const orders = await prisma.order.findMany({
      where,
      include: { ...ORDER_INCLUDE, customer: { select: { id: true, email: true, firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
      take: query.limit,
    });
    return { data: orders.map(publicOrder) };
  });

  /** Bookings across all businesses with business + customer identity. */
  app.get('/api/v1/admin/bookings', { preHandler: roles('ADMIN') }, async (q) => {
    const query = z.object({ status: z.enum(['PENDING', 'CONFIRMED', 'REJECTED', 'CANCELLED', 'COMPLETED']).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).parse(q.query);
    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;
    const bookings = await prisma.booking.findMany({
      where,
      include: { business: { select: { id: true, name: true, slug: true, ownerId: true, imageUrl: true } }, service: { select: { id: true, name: true, durationMinutes: true, priceMinor: true, currency: true } }, customer: { select: { id: true, email: true, firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
      take: query.limit,
    });
    return { data: bookings.map(publicBooking) };
  });

  /** All reviews for moderation, newest first, hidden state included. */
  app.get('/api/v1/admin/reviews', { preHandler: roles('ADMIN') }, async (q) => {
    const query = z.object({ status: z.enum(['visible', 'hidden']).optional(), limit: z.coerce.number().int().min(1).max(200).default(100) }).parse(q.query);
    const reviews = await prisma.review.findMany({
      where: query.status === 'visible' ? { isHiddenAt: null } : query.status === 'hidden' ? { isHiddenAt: { not: null } } : {},
      include: { business: { select: { id: true, name: true } }, customer: { select: { id: true, email: true, firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
      take: query.limit,
    });
    return {
      data: reviews.map((rv) => ({
        id: rv.id,
        rating: rv.rating,
        comment: rv.comment,
        createdAt: rv.createdAt,
        isHidden: rv.isHiddenAt !== null,
        hiddenAt: rv.isHiddenAt,
        business: rv.business,
        customer: rv.customer,
      })),
    };
  });

  /**
   * Review moderation (Phase 15): hide a review from every public surface —
   * business reviews list, rating summaries, search — or restore it. Hiding is
   * reversible soft-moderation; the customer's review history is untouched.
   * Every action is audit-logged with the acting admin.
   */
  app.patch('/api/v1/admin/reviews/:id/visibility', { preHandler: roles('ADMIN') }, async (q, r) => {
    const { hidden } = z.object({ hidden: z.boolean() }).strict().parse(q.body);
    const id = (q.params as { id: string }).id;
    const existing = await prisma.review.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Review not found' } });
    const review = await prisma.review.update({
      where: { id },
      data: { isHiddenAt: hidden ? new Date() : null },
      select: { id: true, isHiddenAt: true, business: { select: { id: true } } },
    });
    await prisma.auditLog.create({
      data: {
        actorId: currentUser(q).id,
        action: hidden ? 'REVIEW_HIDDEN' : 'REVIEW_RESTORED',
        entityType: 'Review',
        entityId: id,
        metadata: { businessId: review.business.id },
      },
    });
    return { data: { id: review.id, isHidden: review.isHiddenAt !== null } };
  });

  /** Subscriptions across the platform with business identity. */
  app.get('/api/v1/admin/subscriptions', { preHandler: roles('ADMIN') }, async (q) => {
    const query = z.object({ status: z.enum(['TRIAL', 'ACTIVE', 'EXPIRED', 'CANCELLED', 'SUSPENDED']).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).parse(q.query);
    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;
    const subscriptions = await prisma.businessSubscription.findMany({
      where,
      include: { business: { select: { id: true, name: true } }, plan: { select: { id: true, name: true, monthlyPriceMinor: true, currency: true } } },
      orderBy: { createdAt: 'desc' },
      take: query.limit,
    });
    return { data: subscriptions };
  });

  /** Recent audit entries (actor, action, target) for the panel's audit page. */
  app.get('/api/v1/admin/audit-log', { preHandler: roles('ADMIN') }, async (q) => {
    const query = z.object({ action: z.string().trim().max(80).optional(), limit: z.coerce.number().int().min(1).max(200).default(100) }).parse(q.query);
    const where: Record<string, unknown> = {};
    if (query.action) where.action = query.action;
    const entries = await prisma.auditLog.findMany({
      where,
      include: { actor: { select: { id: true, email: true, role: true } } },
      orderBy: { createdAt: 'desc' },
      take: query.limit,
    });
    return { data: entries };
  });

  app.get('/api/v1/admin/dashboard', { preHandler: roles('ADMIN') }, async () => ({
    data: {
      users: await prisma.user.count(),
      customers: await prisma.user.count({ where: { role: 'CUSTOMER' } }),
      businessOwners: await prisma.user.count({ where: { role: 'BUSINESS_OWNER' } }),
      businesses: await prisma.business.count(),
      activeBusinesses: await prisma.business.count({ where: { status: 'APPROVED' } }),
      pendingBusinesses: await prisma.business.count({ where: { status: 'PENDING' } }),
      suspendedBusinesses: await prisma.business.count({ where: { status: 'SUSPENDED' } }),
      bookings: await prisma.booking.count(),
      pendingBookings: await prisma.booking.count({ where: { status: 'PENDING' } }),
      orders: await prisma.order.count(),
      pendingOrders: await prisma.order.count({ where: { status: 'PENDING' } }),
      pendingSubscriptionPayments: await prisma.subscriptionPaymentRequest.count({ where: { status: 'PENDING' } }),
      reviews: await prisma.review.count(),
      hiddenReviews: await prisma.review.count({ where: { isHiddenAt: { not: null } } }),
      // Phase 13: push fleet health — counts only, never tokens.
      pushDevices: {
        total: await prisma.pushDevice.count(),
        active: await prisma.pushDevice.count({ where: { isActive: true } }),
        android: await prisma.pushDevice.count({ where: { platform: 'android' } }),
        ios: await prisma.pushDevice.count({ where: { platform: 'ios' } }),
        web: await prisma.pushDevice.count({ where: { platform: 'web' } }),
      },
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
