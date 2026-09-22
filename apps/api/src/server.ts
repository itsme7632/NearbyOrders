import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes, createHash } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import multipart, { type MultipartFile } from '@fastify/multipart';
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
  addDays,
  formatMinor,
  paymentRequestCreateSchema,
  planCreateSchema,
  planUpdateSchema,
  verificationUpsertSchema,
  verificationDocTypeSchema,
  verificationApproveSchema,
  verificationDecisionSchema,
  promotionCreateSchema,
  promotionUpdateSchema,
  promotionRequestCreateSchema,
  promotionRequestReviewSchema,
  promotionPaymentRequestCreateSchema,
  promotionPaymentReviewSchema,
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
  addressCreateSchema,
  addressUpdateSchema,
} from './lib.js';
import type { AuthUser, NotificationInput } from './lib.js';
import { dispatchPushNotifications } from './push.js';
import type { SubscriptionStatus, Prisma } from '@prisma/client';
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
  // The API serves GET/POST/PUT/PATCH/DELETE routes (e.g. PATCH
  // /api/v1/auth/profile); the CORS preflight must advertise all of them or
  // WebView/browser clients cannot call mutating endpoints cross-origin —
  // the request is blocked before it reaches the route and surfaces as a
  // network error. @fastify/cors defaults to GET,HEAD,POST only.
  await app.register(cors, {
    origin: env.cors.split(','),
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
  });
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

  /* ------------------- Refresh tokens (persistent login) ------------ */
  /** Opaque 128-bit token; only the SHA-256 hex digest is ever stored. */
  const newRefreshToken = (): string => randomBytes(16).toString('hex');
  const hashRefreshToken = (token: string): string => createHash('sha256').update(token, 'utf8').digest('hex');
  const REFRESH_TOKEN_TTL_MS = 90 * 86_400_000; // 90 days

  /** Issues a refresh-token row for a user (root or transaction client). */
  // eslint-disable-next-line no-explicit-any
  const issueRefreshToken = async (client: any, userId: string) => {
    const token = newRefreshToken();
    await client.refreshToken.create({
      data: { userId, tokenHash: hashRefreshToken(token), expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS) },
    });
    return token;
  };

  /** Public shape of the authenticated user in auth responses. */
  const publicAuthUser = (u: { id: string; email: string; role: string }) => ({ id: u.id, email: u.email, role: u.role });

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
    // Persistent login: an opaque refresh token (only its hash is stored)
    // with a 90-day lifetime. Additive to the existing response shape.
    const refreshToken = await issueRefreshToken(prisma, user.id);
    return { data: { accessToken, refreshToken, user: publicAuthUser(user) } };
  });

  /**
   * Rotates a refresh token: the presented token must be live (hash match,
   * not revoked, not expired) and belong to a non-suspended user. Rotation
   * revokes the old row and issues a fresh pair, so a stolen token is
   * single-use — replaying it after rotation yields 401.
   */
  app.post('/api/v1/auth/refresh', { config: { rateLimit: { max: authRateMax, timeWindow: '15 minutes' } } }, async (q, r) => {
    const { refreshToken } = z.object({ refreshToken: z.string().min(1).max(256) }).parse(q.body);
    const now = new Date();
    const row = await prisma.refreshToken.findUnique({
      where: { tokenHash: hashRefreshToken(refreshToken) },
      include: { user: { select: { id: true, email: true, role: true, isSuspended: true } } },
    });
    if (!row || row.revokedAt || row.expiresAt.getTime() <= now.getTime() || row.user.isSuspended)
      return r.status(401).send({ error: { code: 'INVALID_REFRESH', message: 'Session expired. Please sign in again' } });
    const rotated = await prisma.$transaction(async (tx) => {
      await tx.refreshToken.update({ where: { id: row.id }, data: { revokedAt: now } });
      const next = await issueRefreshToken(tx, row.userId);
      return next;
    });
    const accessToken = app.jwt.sign({ id: row.user.id, role: row.user.role }, { expiresIn: '15m' });
    return { data: { accessToken, refreshToken: rotated, user: publicAuthUser(row.user) } };
  });

  /**
   * Logs out: revokes the presented refresh token, or every live refresh
   * token for the user when none is presented (sign out everywhere).
   */
  app.post('/api/v1/auth/logout', { preHandler: auth }, async (q, r) => {
    const u = currentUser(q);
    const parsed = z.object({ refreshToken: z.string().min(1).max(256).optional() }).safeParse(q.body ?? {});
    const token = parsed.success ? parsed.data.refreshToken : undefined;
    if (token) {
      await prisma.refreshToken.updateMany({
        where: { userId: u.id, tokenHash: hashRefreshToken(token), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    } else {
      await prisma.refreshToken.updateMany({ where: { userId: u.id, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    return r.status(204).send();
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
        // Phase 3H: authoritative delivery capability, rendered verbatim by
        // the customer app. The fee is only meaningful when delivery is
        // enabled — null otherwise, never invented.
        deliveryEnabled: b.deliveryEnabled,
        codEnabled: b.codEnabled,
        deliveryFeeMinor: b.deliveryEnabled ? b.deliveryFeeMinor : null,
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
        // Explicitly not trial-eligible at creation: trials are never
        // auto-started; an admin grants eligibility after review.
        trialStatus: 'NOT_ELIGIBLE',
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
   * Public plan catalog: the active subscription plans with their real
   * pricing, so clients never hard-code a price. Falls back to PLAN_CATALOG
   * (the source of truth `ensurePlan` seeds from) when the table is empty.
   */
  app.get('/api/v1/subscription/plans', async () => {
    const rows = await prisma.plan.findMany({ where: { isActive: true }, orderBy: [{ displayOrder: 'asc' }, { monthlyPriceMinor: 'asc' }] });
    const data = (rows.length ? rows : PLAN_CATALOG).map((p) => ({
      id: 'id' in p && p.id ? p.id : p.slug,
      slug: p.slug,
      name: p.name,
      description: p.description,
      monthlyPriceMinor: p.monthlyPriceMinor,
      currency: p.currency,
      trialDays: p.trialDays,
      benefits: p.benefits,
      billingInterval: p.billingInterval,
      displayOrder: p.displayOrder,
      isHighlighted: p.isHighlighted,
      isActive: 'isActive' in p ? Boolean(p.isActive) : true,
    }));
    return { data };
  });

  /**
   * Ensures the seeded plan rows exist. Idempotent (upsert by slug); re-running
   * never clobbers admin-edited prices (update is a no-op). Returns the plan
   * requested by slug, or null for an unknown slug.
   */
  const findPlan = async (slug: string) => {
    const existing = await prisma.plan.findUnique({ where: { slug } });
    if (existing) return existing;
    const spec = PLAN_CATALOG.find((p) => p.slug === slug);
    if (!spec) return null;
    try {
      return await prisma.plan.create({ data: { ...spec } });
    } catch (e) {
      // Fresh-DB race: a parallel worker created it between our read and write.
      if ((e as { code?: string }).code !== 'P2002') throw e;
      return await prisma.plan.findUniqueOrThrow({ where: { slug } });
    }
  };

  /** Same as findPlan, but an unknown slug is a server misconfiguration. */
  const ensurePlan = async (slug: string) => {
    const plan = await findPlan(slug);
    if (!plan) throw Object.assign(new Error('Unknown plan'), { statusCode: 500 });
    return plan;
  };

  /**
   * Client-safe subscription DTO: includes the plan for display, the
   * plan snapshot frozen at activation (so price/name history survives plan
   * edits), and the evaluated (lazily-expired) status. Historical rows are
   * never returned.
   */
  const publicSubscription = (s: {
    id: string;
    status: SubscriptionStatus;
    trialStartAt: Date | null;
    trialEndAt: Date | null;
    currentPeriodStartAt: Date;
    currentPeriodEndAt: Date;
    cancelledAt: Date | null;
    planNameSnapshot: string | null;
    planPriceMinorSnapshot: number | null;
    plan: { slug: string; name: string; description: string | null; monthlyPriceMinor: number; currency: string; trialDays: number; benefits: string[]; billingInterval: string; displayOrder: number; isHighlighted: boolean };
  }) => ({
    id: s.id,
    status: evaluateSubscription(s),
    trialStartAt: s.trialStartAt,
    trialEndAt: s.trialEndAt,
    currentPeriodStartAt: s.currentPeriodStartAt,
    currentPeriodEndAt: s.currentPeriodEndAt,
    cancelledAt: s.cancelledAt,
    planNameSnapshot: s.planNameSnapshot,
    planPriceMinorSnapshot: s.planPriceMinorSnapshot,
    plan: s.plan,
  });

  /** Latest subscription row for a business (any status), plan included. */
  const latestSubscription = (businessId: string) =>
    prisma.businessSubscription.findFirst({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
      include: { plan: true },
    });

  /**
   * Owner's current subscription. Also reports the business's verification
   * and trial status so the owner screen can render them in one round trip.
   * Opportunistic lazy expiry: a past-period TRIAL row is normalized to
   * EXPIRED on read (no background job), which also moves the business's
   * trialStatus from ACTIVE to EXPIRED. While a live trial is in its last
   * 48 hours, a best-effort TRIAL_ENDING_SOON notification is sent once —
   * notification failures never fail the read.
   */
  app.get('/api/v1/businesses/:id/subscription', { preHandler: roles('BUSINESS_OWNER') }, async (q, r) => {
    const id = (q.params as { id: string }).id;
    const business = await ownedBusiness(q, id);
    // Opportunistic lazy expiry: normalize a past-period TRIAL/ACTIVE row so
    // reads are consistent even without a background job.
    const current = await latestSubscription(id);
    if (current && evaluateSubscription(current) === 'EXPIRED' && LIVE_SUBSCRIPTION_STATUSES.includes(current.status)) {
      await prisma.$transaction([
        prisma.businessSubscription.update({ where: { id: current.id }, data: { status: 'EXPIRED' } }),
        ...(business.trialStatus === 'ACTIVE'
          ? [prisma.business.update({ where: { id }, data: { trialStatus: 'EXPIRED' } })]
          : []),
      ]);
      current.status = 'EXPIRED';
      business.trialStatus = business.trialStatus === 'ACTIVE' ? 'EXPIRED' : business.trialStatus;
    }
    const now = new Date();
    // Best-effort TRIAL_ENDING_SOON: once, while the trial is in its last 48
    // hours and still live. Never fails the read.
    if (
      current &&
      evaluateSubscription(current) === 'TRIAL' &&
      current.trialEndAt &&
      !current.trialEndingNotifiedAt &&
      current.trialEndAt.getTime() - now.getTime() <= 48 * 3_600_000
    ) {
      const claimed = await prisma.businessSubscription
        .updateMany({ where: { id: current.id, trialEndingNotifiedAt: null }, data: { trialEndingNotifiedAt: now } })
        .catch(() => ({ count: 0 }));
      if (claimed.count > 0) {
        const remainingDays = Math.max(0, Math.ceil((current.trialEndAt.getTime() - now.getTime()) / 86_400_000));
        void createNotifications(prisma, [
          {
            userId: business.ownerId,
            type: NOTIFICATION_TYPES.TRIAL_ENDING_SOON,
            title: 'Trial ending soon',
            message: `Your ${current.plan.name} trial ends in ${remainingDays} day(s). Submit a payment to keep your listing active.`,
            entityType: 'BusinessSubscription',
            entityId: current.id,
          },
        ]).catch(() => undefined);
      }
    }
    const sub = current ? publicSubscription(current) : null;
    const trial =
      sub && sub.status === 'TRIAL' && sub.trialStartAt && sub.trialEndAt
        ? {
            startsAt: sub.trialStartAt.toISOString(),
            endsAt: sub.trialEndAt.toISOString(),
            daysRemaining: Math.max(0, Math.ceil((sub.trialEndAt.getTime() - now.getTime()) / 86_400_000)),
          }
        : null;
    return {
      data: {
        businessId: id,
        subscription: sub,
        status: sub?.status ?? null,
        trial,
        planNameSnapshot: sub?.planNameSnapshot ?? null,
        planPriceMinorSnapshot: sub?.planPriceMinorSnapshot ?? null,
        verificationStatus: business.verificationStatus,
        trialStatus: business.trialStatus,
      },
    };
  });

  /**
   * Starts the chosen plan's free trial. The business must be trial-eligible
   * (an admin grants eligibility after review; new businesses are
   * NOT_ELIGIBLE and trials never auto-start), the plan must exist and carry
   * a trial window, and no live (TRIAL/ACTIVE) subscription may exist. The
   * trial is one-time per business: applying flips trialStatus to ACTIVE, so
   * a second apply is rejected. One live subscription per business is enforced
   * the same way double-booking is: a transaction-scoped advisory lock keyed
   * on the business id, a re-check inside the lock, then insert. Dates are
   * always server-generated; the client sends only the plan slug.
   */
  app.post('/api/v1/businesses/:id/subscription/trial/apply', { preHandler: roles('BUSINESS_OWNER') }, async (q, r) => {
    const id = (q.params as { id: string }).id;
    const business = await ownedBusiness(q, id);
    const { planSlug } = z.object({ planSlug: z.string().trim().min(1).max(80) }).parse(q.body);
    const plan = await findPlan(planSlug);
    if (!plan) return r.status(400).send({ error: { code: 'PLAN_NOT_FOUND', message: 'Unknown plan' } });
    if (!plan.isActive) return r.status(400).send({ error: { code: 'PLAN_NOT_FOUND', message: 'This plan is no longer offered' } });
    if (plan.trialDays <= 0) return r.status(400).send({ error: { code: 'TRIAL_NOT_AVAILABLE', message: 'This plan has no trial' } });
    if (business.trialStatus !== 'ELIGIBLE')
      return r.status(403).send({ error: { code: 'NOT_ELIGIBLE', message: 'This business is not eligible for a free trial' } });
    const now = new Date();
    const trialEnd = new Date(now.getTime() + plan.trialDays * 86_400_000);
    try {
      const created = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
        // Re-check everything inside the lock — the authoritative state.
        const gate = await tx.business.findUniqueOrThrow({ where: { id }, select: { trialStatus: true, ownerId: true } });
        if (gate.trialStatus !== 'ELIGIBLE') throw Object.assign(new Error('not-eligible'), { code: 'NOT_ELIGIBLE' });
        const existing = await tx.businessSubscription.findFirst({
          where: { businessId: id, status: { in: [...LIVE_SUBSCRIPTION_STATUSES] } },
          select: { id: true },
        });
        if (existing) throw Object.assign(new Error('already-live'), { code: 'ALREADY_SUBSCRIBED' });
        const livePlan = await tx.plan.findUnique({ where: { id: plan.id } });
        if (!livePlan || !livePlan.isActive || livePlan.trialDays <= 0)
          throw Object.assign(new Error('plan'), { code: 'TRIAL_NOT_AVAILABLE' });
        const row = await tx.businessSubscription.create({
          data: {
            businessId: id,
            planId: livePlan.id,
            status: 'TRIAL',
            trialStartAt: now,
            trialEndAt: trialEnd,
            currentPeriodStartAt: now,
            currentPeriodEndAt: trialEnd,
            // Freeze the plan's commercial terms at activation: price/name
            // history survives later plan edits.
            planNameSnapshot: livePlan.name,
            planPriceMinorSnapshot: livePlan.monthlyPriceMinor,
          },
          include: { plan: true },
        });
        await tx.business.update({
          where: { id },
          data: { trialStatus: 'ACTIVE', trialStartedAt: now, trialEndsAt: trialEnd },
        });
        return row;
      });
      await prisma.auditLog.create({
        data: { actorId: currentUser(q).id, action: 'SUBSCRIPTION_TRIAL_STARTED', entityType: 'BusinessSubscription', entityId: created.id, metadata: { businessId: id, planSlug: plan.slug } },
      });
      // Best-effort owner notification, only after commit.
      void createNotifications(prisma, [
        {
          userId: business.ownerId,
          type: NOTIFICATION_TYPES.TRIAL_STARTED,
          title: 'Trial started',
          message: `Your ${plan.trialDays}-day free trial of ${created.plan.name} has started.`,
          entityType: 'BusinessSubscription',
          entityId: created.id,
        },
      ]).catch(() => undefined);
      return r.status(201).send({ data: publicSubscription(created) });
    } catch (e) {
      if ((e as { code?: string }).code === 'ALREADY_SUBSCRIBED')
        return r.status(409).send({ error: { code: 'ALREADY_SUBSCRIBED', message: 'This business already has an active or trial subscription' } });
      if ((e as { code?: string }).code === 'NOT_ELIGIBLE')
        return r.status(403).send({ error: { code: 'NOT_ELIGIBLE', message: 'This business is not eligible for a free trial' } });
      if ((e as { code?: string }).code === 'TRIAL_NOT_AVAILABLE')
        return r.status(400).send({ error: { code: 'TRIAL_NOT_AVAILABLE', message: 'This plan has no trial' } });
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

  /* ------------------- Business verification (Phase 18) ------------- */

  /** Owner-safe verification application DTO (no reviewer internals). */
  const ownerVerification = (v: {
    id: string; status: string; legalName: string | null; publicName: string | null; ownerName: string | null;
    phone: string | null; address: string | null; city: string | null; categoryId: string | null;
    description: string | null; latitude: number | null; longitude: number | null;
    registrationInfo: string | null; reviewerMessage: string | null;
    submittedAt: Date | null; reviewedAt: Date | null; createdAt: Date; updatedAt: Date;
    documents: { id: string; docType: string; storageKey: string; status: string; uploadedAt: Date }[];
  }) => ({
    id: v.id,
    status: v.status,
    legalName: v.legalName,
    publicName: v.publicName,
    ownerName: v.ownerName,
    phone: v.phone,
    address: v.address,
    city: v.city,
    categoryId: v.categoryId,
    description: v.description,
    latitude: v.latitude,
    longitude: v.longitude,
    registrationInfo: v.registrationInfo,
    reviewerMessage: v.reviewerMessage,
    submittedAt: v.submittedAt?.toISOString() ?? null,
    reviewedAt: v.reviewedAt?.toISOString() ?? null,
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
    documents: v.documents.map((d) => ({ id: d.id, docType: d.docType, status: d.status, uploadedAt: d.uploadedAt.toISOString() })),
  });

  const VERIFICATION_INCLUDE = {
    documents: { select: { id: true, docType: true, storageKey: true, status: true, uploadedAt: true }, orderBy: { uploadedAt: 'asc' } },
  } satisfies Prisma.VerificationApplicationInclude;

  /** Editable while the application is a DRAFT or was sent back for changes. */
  const VERIFICATION_EDITABLE = ['DRAFT', 'CHANGES_REQUESTED'] as const;

  /** Owner's current verification application (may be null). */
  app.get('/api/v1/businesses/:id/verification', { preHandler: roles('BUSINESS_OWNER') }, async (q) => {
    const id = (q.params as { id: string }).id;
    await ownedBusiness(q, id);
    const application = await prisma.verificationApplication.findUnique({ where: { businessId: id }, include: VERIFICATION_INCLUDE });
    return { data: application ? ownerVerification(application) : null };
  });

  /**
   * Creates or updates the verification draft. There is deliberately no
   * isVerified field anywhere on owner input — verification is granted only
   * by the admin review flow. A submitted application must be sent back for
   * changes before it becomes editable again.
   */
  app.put('/api/v1/businesses/:id/verification', { preHandler: roles('BUSINESS_OWNER') }, async (q, r) => {
    const id = (q.params as { id: string }).id;
    await ownedBusiness(q, id);
    const d = verificationUpsertSchema.parse(q.body);
    if (d.categoryId) {
      const category = await prisma.category.findFirst({ where: { id: d.categoryId, isActive: true }, select: { id: true } });
      if (!category) return r.status(400).send({ error: { code: 'INVALID_CATEGORY', message: 'The selected category is invalid' } });
    }
    const existing = await prisma.verificationApplication.findUnique({ where: { businessId: id } });
    if (existing && !VERIFICATION_EDITABLE.includes(existing.status as (typeof VERIFICATION_EDITABLE)[number]))
      return r.status(409).send({ error: { code: 'NOT_EDITABLE', message: 'This application is under review and cannot be edited' } });
    const application = existing
      ? await prisma.verificationApplication.update({ where: { id: existing.id }, data: { ...d, status: existing.status === 'CHANGES_REQUESTED' ? 'DRAFT' : existing.status }, include: VERIFICATION_INCLUDE })
      : await prisma.verificationApplication.create({ data: { businessId: id, ...d }, include: VERIFICATION_INCLUDE });
    return { data: ownerVerification(application) };
  });

  /**
   * Submits the draft for admin review. Requires legalName, ownerName, phone
   * and at least one document; empty strings are treated as missing.
   */
  app.post('/api/v1/businesses/:id/verification/submit', { preHandler: roles('BUSINESS_OWNER') }, async (q, r) => {
    const id = (q.params as { id: string }).id;
    const business = await ownedBusiness(q, id);
    const application = await prisma.verificationApplication.findUnique({ where: { businessId: id }, include: VERIFICATION_INCLUDE });
    if (!application) return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'No verification application to submit' } });
    if (!VERIFICATION_EDITABLE.includes(application.status as (typeof VERIFICATION_EDITABLE)[number]))
      return r.status(409).send({ error: { code: 'NOT_EDITABLE', message: 'This application has already been submitted' } });
    const missing: string[] = [];
    if (!application.legalName?.trim()) missing.push('legalName');
    if (!application.ownerName?.trim()) missing.push('ownerName');
    if (!application.phone?.trim()) missing.push('phone');
    if (application.documents.length === 0) missing.push('documents');
    if (missing.length > 0)
      return r.status(400).send({ error: { code: 'INCOMPLETE_APPLICATION', message: `Complete these fields before submitting: ${missing.join(', ')}` } });
    const now = new Date();
    const submitted = await prisma.$transaction(async (tx) => {
      const row = await tx.verificationApplication.update({
        where: { id: application.id },
        data: { status: 'SUBMITTED', submittedAt: now },
        include: VERIFICATION_INCLUDE,
      });
      await tx.business.update({ where: { id }, data: { verificationStatus: 'PENDING' } });
      return row;
    });
    await prisma.auditLog.create({
      data: { actorId: currentUser(q).id, action: 'VERIFICATION_SUBMITTED', entityType: 'VerificationApplication', entityId: application.id, metadata: { businessId: id } },
    });
    void createNotifications(prisma, [
      {
        userId: business.ownerId,
        type: NOTIFICATION_TYPES.VERIFICATION_SUBMITTED,
        title: 'Verification submitted',
        message: 'Your business verification application has been submitted for review.',
        entityType: 'VerificationApplication',
        entityId: application.id,
      },
    ]).catch(() => undefined);
    return { data: ownerVerification(submitted) };
  });

  /**
   * REAL document upload (product-wide rule: upload, never a URL field). The
   * owner uploads the document image; the server stores the bytes via the
   * receipt storage abstraction and keeps an opaque storage key. Documents
   * are only readable through the authorized view endpoint below.
   */
  app.post('/api/v1/businesses/:id/verification/documents', { preHandler: roles('BUSINESS_OWNER') }, async (q, r) => {
    const id = (q.params as { id: string }).id;
    await ownedBusiness(q, id);
    const application = await prisma.verificationApplication.findUnique({ where: { businessId: id } });
    if (!application) return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Create the verification application first' } });
    if (!VERIFICATION_EDITABLE.includes(application.status as (typeof VERIFICATION_EDITABLE)[number]))
      return r.status(409).send({ error: { code: 'NOT_EDITABLE', message: 'This application is under review and cannot be edited' } });
    let type = '';
    let file: MultipartFile | null = null;
    let fileBytes: Buffer | null = null;
    // NOTE: the file stream must be consumed inside the iteration — leaving
    // a file part unread stalls q.parts() forever (busboy backpressure).
    for await (const part of q.parts()) {
      if (part.type === 'file') {
        if (!file) {
          file = part;
          fileBytes = await part.toBuffer();
        } else {
          part.file.resume();
        }
      } else if (part.fieldname === 'type' && typeof part.value === 'string') {
        type = part.value;
      }
    }
    const docType = verificationDocTypeSchema.safeParse(type);
    if (!docType.success) return r.status(400).send({ error: { code: 'VALIDATION_ERROR', message: docType.error.issues[0]?.message ?? 'Document type is required' } });
    if (!file) return r.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'A document image file is required' } });
    if (!RECEIPT_ACCEPTED_TYPES.includes(file.mimetype as (typeof RECEIPT_ACCEPTED_TYPES)[number])) {
      return r.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Documents must be JPG, PNG or WebP images' } });
    }
    try {
      const bytes = fileBytes ?? (await file.toBuffer());
      const storageKey = await saveReceipt(bytes, file.mimetype);
      const created = await prisma.verificationDocument.create({
        data: { applicationId: application.id, docType: docType.data.toUpperCase(), storageKey, status: 'PENDING' },
      });
      return r.status(201).send({ data: { id: created.id, docType: created.docType, status: created.status, uploadedAt: created.uploadedAt.toISOString() } });
    } catch (e) {
      if ((e as { code?: string }).code === 'FST_PART_FILE_LIMIT_EXCEEDED' || (e as { statusCode?: number }).statusCode === 413)
        return r.status(400).send({ error: { code: 'VALIDATION_ERROR', message: `Documents must be ${Math.round(RECEIPT_MAX_BYTES / (1024 * 1024))} MB or smaller` } });
      throw e;
    }
  });

  /**
   * Verification document bytes for an authorized viewer only: the owning
   * business or an ADMIN. Same opaque-key, no-public-URL rule as receipts.
   */
  app.get('/api/v1/verification/documents/*', { preHandler: auth }, async (q, r) => {
    const storageKey = (q.params as { '*': string })['*'];
    if (!RECEIPT_KEY_PATTERN.test(storageKey))
      return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Document not found' } });
    const doc = await prisma.verificationDocument.findFirst({
      where: { storageKey },
      include: { application: { select: { business: { select: { ownerId: true } } } } },
    });
    if (!doc) return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Document not found' } });
    const user = currentUser(q);
    const authorized = user.role === 'ADMIN' || doc.application.business.ownerId === user.id;
    if (!authorized) return r.status(403).send({ error: { code: 'FORBIDDEN', message: 'You cannot view this document' } });
    const bytes = await readReceipt(storageKey);
    if (!bytes) return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Document not found' } });
    return r.header('content-type', receiptContentType(storageKey) ?? 'application/octet-stream').send(bytes);
  });

  /* ------------------- Promotions (Phase 18) ------------------------ */

  /** Public promotion DTO. */
  const publicPromotion = (p: {
    id: string; name: string; slug: string; description: string | null; benefits: string[];
    priceMinor: number | null; currency: string; durationDays: number | null;
    requirements: string | null; displayOrder: number;
  }) => ({
    id: p.id,
    name: p.name,
    slug: p.slug,
    description: p.description,
    benefits: p.benefits,
    priceMinor: p.priceMinor,
    currency: p.currency,
    durationDays: p.durationDays,
    requirements: p.requirements,
    displayOrder: p.displayOrder,
  });

  /** Active promotions in display order — visible to everyone. */
  app.get('/api/v1/promotions', async () => {
    const promotions = await prisma.promotion.findMany({
      where: { isActive: true },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });
    return { data: promotions.map(publicPromotion) };
  });

  app.get('/api/v1/promotions/:slug', async (q, r) => {
    const promotion = await prisma.promotion.findFirst({
      where: { slug: (q.params as { slug: string }).slug, isActive: true },
    });
    if (!promotion) return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Promotion not found' } });
    return { data: publicPromotion(promotion) };
  });

  /**
   * Promotion monetization lifecycle (Phase 19).
   *
   *   PENDING (application) -> APPROVED (payment required, paid promotions)
   *     -> payment PENDING -> payment APPROVED -> ACTIVE (dates set)
   *     -> EXPIRED (server-side transition on access)
   *
   * A zero-price promotion skips payment: application approval activates it
   * directly. Application approval NEVER activates a paid promotion.
   * Duration is always measured from activation, never from application.
   * Every transition is server-authoritative: price, duration, dates and
   * statuses are resolved from the catalog/database, never the client.
   */
  const PROMOTION_DEFAULT_DURATION_DAYS = 30;

  /** Owner-visible lifecycle state derived from request + latest payment. */
  const promotionLifecycleState = (
    status: string,
    priceMinor: number | null,
    latestPaymentStatus: string | null,
  ): string => {
    if (status === 'PENDING') return 'PENDING_REVIEW';
    if (status === 'REJECTED') return 'REJECTED';
    if (status === 'CANCELLED') return 'CANCELLED';
    if (status === 'EXPIRED') return 'EXPIRED';
    if (status === 'ACTIVE') return 'ACTIVE';
    // APPROVED: a paid promotion still needs a verified payment.
    if (latestPaymentStatus === 'PENDING') return 'PAYMENT_UNDER_REVIEW';
    return 'PAYMENT_REQUIRED';
  };

  /** Amount the business must pay for a promotion (server-resolved catalog price). */
  const promotionAmountDue = (priceMinor: number | null): number => priceMinor ?? 0;

  /**
   * Server-side expiration: ACTIVE requests whose end date passed are
   * flipped to EXPIRED on access (read path), never by the client. Runs
   * before business/admin promotion-request reads. Notifications are
   * idempotent thanks to the (userId, type, entityId) unique constraint.
   */
  const expireOverduePromotionRequests = async (db: typeof prisma): Promise<void> => {
    const now = new Date();
    const overdue = await db.promotionRequest.findMany({
      where: { status: 'ACTIVE', expiresAt: { lt: now } },
      select: {
        id: true,
        promotion: { select: { name: true } },
        business: { select: { ownerId: true } },
      },
    });
    if (overdue.length === 0) return;
    await db.promotionRequest.updateMany({
      where: { id: { in: overdue.map((o) => o.id) }, status: 'ACTIVE' },
      data: { status: 'EXPIRED' },
    });
    await db.auditLog.createMany({
      data: overdue.map((o) => ({
        // System transition: no human actor performed this; keep actorId null
        // rather than attributing it to the business owner.
        actorId: null,
        action: 'PROMOTION_EXPIRED',
        entityType: 'PromotionRequest',
        entityId: o.id,
      })),
    });
    void createNotifications(
      prisma,
      overdue.map((o) => ({
        userId: o.business.ownerId,
        type: NOTIFICATION_TYPES.PROMOTION_EXPIRED,
        title: 'Promotion ended',
        message: `Your "${o.promotion.name}" promotion has ended.`,
        entityType: 'PromotionRequest',
        entityId: o.id,
      })),
    ).catch(() => undefined);
  };

  /** Owner-safe promotion-request DTO, incl. lifecycle state and payment info. */
  const ownerPromotionRequest = (p: {
    id: string; status: string; note: string | null; reviewerMessage: string | null;
    createdAt: Date; reviewedAt: Date | null; activatedAt: Date | null; expiresAt: Date | null;
    promotion: { id: string; name: string; slug: string; priceMinor: number | null; currency: string; durationDays: number | null };
    payments: { status: string }[];
  }) => {
    const priceMinor = p.promotion.priceMinor;
    const latestPaymentStatus = p.payments[0]?.status ?? null;
    return {
      id: p.id,
      status: p.status,
      lifecycleState: promotionLifecycleState(p.status, priceMinor, latestPaymentStatus),
      note: p.note,
      reviewerMessage: p.reviewerMessage,
      createdAt: p.createdAt.toISOString(),
      reviewedAt: p.reviewedAt?.toISOString() ?? null,
      activatedAt: p.activatedAt?.toISOString() ?? null,
      expiresAt: p.expiresAt?.toISOString() ?? null,
      amountDueMinor: promotionAmountDue(priceMinor),
      currency: p.promotion.currency,
      paymentStatus: latestPaymentStatus,
      lastPaymentRejected: p.payments.some((x) => x.status === 'REJECTED'),
      promotion: p.promotion,
    };
  };

  const PROMOTION_REQUEST_PAYMENTS_INCLUDE = {
    payments: { select: { status: true }, orderBy: { submittedAt: 'desc' as const }, take: 1 },
  } as const;

  /** Owner-safe promotion-payment DTO: business-safe fields, no reviewer internals. */
  const ownerPromotionPayment = (p: {
    id: string; status: string; amountMinor: number; currency: string;
    transactionReference: string; receiptStorageKey: string;
    paidAt: Date | null; note: string | null; rejectionReason: string | null;
    submittedAt: Date; reviewedAt: Date | null; promotionRequestId: string;
    paymentMethod: { id: string; name: string; type: string };
  }) => ({
    id: p.id,
    status: p.status,
    amountMinor: p.amountMinor,
    currency: p.currency,
    transactionReference: p.transactionReference,
    receiptStorageKey: p.receiptStorageKey,
    paidAt: p.paidAt?.toISOString() ?? null,
    note: p.note,
    rejectionReason: p.rejectionReason,
    submittedAt: p.submittedAt.toISOString(),
    reviewedAt: p.reviewedAt?.toISOString() ?? null,
    promotionRequestId: p.promotionRequestId,
    paymentMethod: p.paymentMethod,
  });

  /** Admin DTO for a promotion payment: full review context. */
  const adminPromotionPayment = (p: {
    id: string; status: string; amountMinor: number; currency: string;
    transactionReference: string; receiptStorageKey: string;
    paidAt: Date | null; note: string | null; rejectionReason: string | null;
    submittedAt: Date; reviewedAt: Date | null; reviewedByUserId: string | null;
    business: { id: string; name: string };
    promotionRequest: { id: string; status: string; promotion: { id: string; name: string; slug: string } };
    paymentMethod: { id: string; name: string; type: string };
  }) => ({
    id: p.id,
    status: p.status,
    amountMinor: p.amountMinor,
    currency: p.currency,
    transactionReference: p.transactionReference,
    receiptStorageKey: p.receiptStorageKey,
    paidAt: p.paidAt?.toISOString() ?? null,
    note: p.note,
    rejectionReason: p.rejectionReason,
    submittedAt: p.submittedAt.toISOString(),
    reviewedAt: p.reviewedAt?.toISOString() ?? null,
    reviewedByUserId: p.reviewedByUserId,
    business: p.business,
    promotionRequest: { id: p.promotionRequest.id, status: p.promotionRequest.status },
    promotion: p.promotionRequest.promotion,
    paymentMethod: p.paymentMethod,
  });

  const PROMOTION_PAYMENT_INCLUDE = {
    business: { select: { id: true, name: true } },
    promotionRequest: {
      select: {
        id: true,
        status: true,
        promotion: { select: { id: true, name: true, slug: true } },
      },
    },
    paymentMethod: { select: { id: true, name: true, type: true } },
  } as const;

  /**
   * Requests to join a promotion. Requesting creates a PENDING row an admin
   * reviews. Paid promotions require a verified manual payment AFTER
   * application approval — approval alone never activates them. A zero-price
   * promotion activates directly on approval. One live request per
   * business+promotion: a new application is blocked while a PENDING,
   * APPROVED or ACTIVE request exists (re-request allowed after a decision
   * or expiry).
   */
  app.post('/api/v1/businesses/:id/promotion-requests', { preHandler: roles('BUSINESS_OWNER') }, async (q, r) => {
    const id = (q.params as { id: string }).id;
    await ownedBusiness(q, id);
    const body = promotionRequestCreateSchema.parse(q.body);
    const promotion = await prisma.promotion.findFirst({ where: { id: body.promotionId, isActive: true } });
    if (!promotion) return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Promotion not found' } });
    // Duplicate guard under an advisory lock on (business, promotion): the
    // pre-check-then-create race would otherwise allow two live requests.
    try {
      const created = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${id}:${promotion.id}`}))`;
        const live = await tx.promotionRequest.findFirst({
          where: { businessId: id, promotionId: promotion.id, status: { in: ['PENDING', 'APPROVED', 'ACTIVE'] } },
          select: { id: true },
        });
        if (live) throw Object.assign(new Error('dup'), { code: 'REQUEST_ALREADY_PENDING' });
        return tx.promotionRequest.create({
          data: { businessId: id, promotionId: promotion.id, note: body.note ?? null },
          include: {
            promotion: { select: { id: true, name: true, slug: true, priceMinor: true, currency: true, durationDays: true } },
            ...PROMOTION_REQUEST_PAYMENTS_INCLUDE,
          },
        });
      });
      await prisma.auditLog.create({
        data: { actorId: currentUser(q).id, action: 'PROMOTION_REQUEST_CREATED', entityType: 'PromotionRequest', entityId: created.id, metadata: { businessId: id, promotionId: promotion.id } },
      });
      return r.status(201).send({ data: ownerPromotionRequest(created) });
    } catch (e) {
      if ((e as { code?: string }).code === 'REQUEST_ALREADY_PENDING')
        return r.status(409).send({ error: { code: 'REQUEST_ALREADY_PENDING', message: 'You already have an active or pending request for this promotion' } });
      throw e;
    }
  });

  /** Owner's promotion requests, newest first (with server-side expiry applied). */
  app.get('/api/v1/businesses/:id/promotion-requests', { preHandler: roles('BUSINESS_OWNER') }, async (q) => {
    const id = (q.params as { id: string }).id;
    await ownedBusiness(q, id);
    await expireOverduePromotionRequests(prisma);
    const requests = await prisma.promotionRequest.findMany({
      where: { businessId: id },
      include: {
        promotion: { select: { id: true, name: true, slug: true, priceMinor: true, currency: true, durationDays: true } },
        ...PROMOTION_REQUEST_PAYMENTS_INCLUDE,
      },
      orderBy: { createdAt: 'desc' },
    });
    return { data: requests.map(ownerPromotionRequest) };
  });

  /**
   * Submits a manual payment for an APPROVED paid promotion request. The
   * amount is the server-resolved catalog price — never a client number.
   * One PENDING payment per request (advisory-lock guarded). Submission
   * never activates the promotion; admin payment approval does.
   */
  app.post('/api/v1/businesses/:id/promotion-requests/:requestId/payment-requests', { preHandler: roles('BUSINESS_OWNER') }, async (q, r) => {
    const id = (q.params as { id: string }).id;
    const requestId = (q.params as { requestId: string }).requestId;
    await ownedBusiness(q, id);
    const body = promotionPaymentRequestCreateSchema.parse(q.body);

    const target = await prisma.promotionRequest.findFirst({
      where: { id: requestId, businessId: id },
      include: { promotion: { select: { id: true, name: true, priceMinor: true, currency: true } } },
    });
    if (!target) return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Promotion request not found' } });
    const amountMinor = promotionAmountDue(target.promotion.priceMinor);
    if (amountMinor <= 0)
      return r.status(400).send({ error: { code: 'PAYMENT_NOT_REQUIRED', message: 'This promotion is free: no payment is required' } });
    if (target.status !== 'APPROVED')
      return r.status(409).send({ error: { code: 'NOT_PAYABLE', message: 'This promotion request is not awaiting payment' } });

    const method = await prisma.paymentMethod.findFirst({ where: { id: body.paymentMethodId, isActive: true } });
    if (!method) return r.status(400).send({ error: { code: 'INVALID_PAYMENT_METHOD', message: 'Choose a valid payment method' } });

    const now = new Date();
    const pending = await prisma.promotionPaymentRequest.findFirst({
      where: { promotionRequestId: requestId, status: 'PENDING' },
      select: { id: true },
    });
    if (pending) return r.status(409).send({ error: { code: 'PAYMENT_ALREADY_PENDING', message: 'You already have a payment awaiting review for this promotion' } });

    try {
      const created = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${requestId}))`;
        const recheck = await tx.promotionRequest.findUnique({ where: { id: requestId }, select: { status: true } });
        if (!recheck || recheck.status !== 'APPROVED') throw Object.assign(new Error('state'), { code: 'NOT_PAYABLE' });
        const dup = await tx.promotionPaymentRequest.findFirst({ where: { promotionRequestId: requestId, status: 'PENDING' }, select: { id: true } });
        if (dup) throw Object.assign(new Error('dup'), { code: 'PAYMENT_ALREADY_PENDING' });
        return tx.promotionPaymentRequest.create({
          data: {
            promotionRequestId: requestId,
            businessId: id,
            paymentMethodId: method.id,
            amountMinor,
            currency: target.promotion.currency,
            transactionReference: body.transactionReference,
            receiptStorageKey: body.receiptStorageKey,
            paidAt: body.paidAt ? new Date(body.paidAt) : null,
            note: body.note ?? null,
            status: 'PENDING',
            submittedAt: now,
          },
        });
      });
      await prisma.auditLog.create({
        data: { actorId: currentUser(q).id, action: 'PROMOTION_PAYMENT_SUBMITTED', entityType: 'PromotionPaymentRequest', entityId: created.id, metadata: { businessId: id, promotionRequestId: requestId, amountMinor } },
      });
      const owner = await prisma.business.findUniqueOrThrow({ where: { id }, select: { ownerId: true } });
      void createNotifications(prisma, [
        {
          userId: owner.ownerId,
          type: NOTIFICATION_TYPES.PROMOTION_PAYMENT_SUBMITTED,
          title: 'Promotion payment submitted',
          message: `Your payment for "${target.promotion.name}" was submitted and is under review. The promotion activates after approval.`,
          entityType: 'PromotionPaymentRequest',
          entityId: created.id,
        },
      ]).catch(() => undefined);
      const withRelations = await prisma.promotionPaymentRequest.findUniqueOrThrow({
        where: { id: created.id },
        include: { paymentMethod: { select: { id: true, name: true, type: true } } },
      });
      return r.status(201).send({ data: ownerPromotionPayment(withRelations) });
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'PAYMENT_ALREADY_PENDING')
        return r.status(409).send({ error: { code, message: 'You already have a payment awaiting review for this promotion' } });
      if (code === 'NOT_PAYABLE')
        return r.status(409).send({ error: { code, message: 'This promotion request is not awaiting payment' } });
      throw e;
    }
  });

  /** Owner's promotion payments for one of their requests, newest first. */
  app.get('/api/v1/businesses/:id/promotion-requests/:requestId/payment-requests', { preHandler: roles('BUSINESS_OWNER') }, async (q, r) => {
    const id = (q.params as { id: string }).id;
    const requestId = (q.params as { requestId: string }).requestId;
    await ownedBusiness(q, id);
    const target = await prisma.promotionRequest.findFirst({ where: { id: requestId, businessId: id }, select: { id: true } });
    if (!target) return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Promotion request not found' } });
    const payments = await prisma.promotionPaymentRequest.findMany({
      where: { promotionRequestId: requestId, businessId: id },
      include: { paymentMethod: { select: { id: true, name: true, type: true } } },
      orderBy: { submittedAt: 'desc' },
    });
    return { data: payments.map(ownerPromotionPayment) };
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
    qrImageUrl: string | null;
    instructions: string | null;
  }) => ({
    id: m.id,
    name: m.name,
    type: m.type,
    accountTitle: m.accountTitle,
    accountNumber: m.accountNumber,
    iban: m.iban,
    qrImageUrl: m.qrImageUrl,
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
    paidAt: Date | null;
    note: string | null;
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
    paidAt: p.paidAt?.toISOString() ?? null,
    note: p.note,
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
    const promoRequest = request
      ? null
      : await prisma.promotionPaymentRequest.findFirst({ where: { receiptStorageKey: storageKey }, include: { business: { select: { ownerId: true } } } });
    const ownerId = request?.business.ownerId ?? promoRequest?.business.ownerId;
    if (!ownerId)
      return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Receipt not found' } });
    const user = currentUser(q);
    const authorized = user.role === 'ADMIN' || ownerId === user.id;
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
   * user-facing URL. `paidAt` records when the business says it actually paid
   * (admin reference only, never in the future); `note` is an optional owner
   * remark. The plan price comes from the business's live subscription when
   * one exists, else the seeded commercial plan. Duplicate protection: one
   * PENDING request per business.
   */
  app.post('/api/v1/businesses/:id/subscription/payment-requests', { preHandler: roles('BUSINESS_OWNER') }, async (q, r) => {
    const id = (q.params as { id: string }).id;
    await ownedBusiness(q, id);
    const body = paymentRequestCreateSchema.parse(q.body);

    const method = await prisma.paymentMethod.findFirst({ where: { id: body.paymentMethodId, isActive: true } });
    if (!method) return r.status(400).send({ error: { code: 'INVALID_PAYMENT_METHOD', message: 'Choose a valid payment method' } });

    const now = new Date();
    const current = await latestSubscription(id);
    const live = current && LIVE_SUBSCRIPTION_STATUSES.includes(current.status) && current.currentPeriodEndAt.getTime() > now.getTime() ? current : null;
    const plan = live?.plan ?? (await ensurePlan('nearbyorders-business'));

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
            paidAt: body.paidAt ? new Date(body.paidAt) : null,
            note: body.note ?? null,
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
    paidAt: Date | null;
    note: string | null;
    rejectionReason: string | null;
    submittedAt: Date;
    reviewedAt: Date | null;
    reviewedByUserId: string | null;
    subscription: { id: string; status: string } | null;
    paymentMethod: { id: string; name: string; type: string; accountTitle: string; accountNumber: string; iban: string | null; qrImageUrl: string | null };
    business: { id: string; name: string; slug: string; owner: { id: string; email: string; firstName: string | null; lastName: string | null } };
  }) => ({
    id: p.id,
    status: p.status,
    amountMinor: p.amountMinor,
    currency: p.currency,
    transactionReference: p.transactionReference,
    receiptStorageKey: p.receiptStorageKey,
    paidAt: p.paidAt?.toISOString() ?? null,
    note: p.note,
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
    paymentMethod: { select: { id: true, name: true, type: true, accountTitle: true, accountNumber: true, iban: true, qrImageUrl: true } },
    subscription: { select: { id: true, status: true } },
    business: {
      select: { id: true, name: true, slug: true, owner: { select: { id: true, email: true, firstName: true, lastName: true } } },
    },
  } as const;

  app.get('/api/v1/admin/subscription/payment-requests', { preHandler: roles('ADMIN') }, async (q) => {
    const query = z
      .object({
        status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(),
        businessId: z.string().uuid().optional(),
        q: z.string().trim().max(120).optional(),
        planId: z.string().uuid().optional(),
        paymentMethodId: z.string().uuid().optional(),
        from: z.string().datetime({ offset: true }).optional(),
        to: z.string().datetime({ offset: true }).optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
        cursor: z.string().optional(),
      })
      .parse(q.query ?? {});
    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;
    if (query.businessId) where.businessId = query.businessId;
    if (query.paymentMethodId) where.paymentMethodId = query.paymentMethodId;
    if (query.planId) where.subscription = { planId: query.planId };
    if (query.q)
      where.OR = [
        { transactionReference: { contains: query.q, mode: 'insensitive' } },
        { business: { name: { contains: query.q, mode: 'insensitive' } } },
      ];
    if (query.from || query.to)
      where.submittedAt = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    const requests = await prisma.subscriptionPaymentRequest.findMany({
      where,
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
        // Plan resolution (server-authoritative): the plan on the request's
        // linked subscription when one exists, else the business's latest
        // subscription's plan, else the seeded commercial plan. The payable
        // amount is the server-computed amount stored at submit time — the
        // business paid the quoted price, so later admin plan edits never
        // invalidate a pending request. The activated row freezes the plan's
        // CURRENT name/price as a snapshot so history survives those edits.
        const linkedPlan = request.subscriptionId
          ? await tx.businessSubscription.findUnique({ where: { id: request.subscriptionId }, select: { planId: true } })
          : null;
        const latestSub = await tx.businessSubscription.findFirst({
          where: { businessId: request.businessId },
          orderBy: { createdAt: 'desc' },
          select: { planId: true },
        });
        const planId = linkedPlan?.planId ?? latestSub?.planId;
        const plan = planId
          ? await tx.plan.findUnique({ where: { id: planId } })
          : await tx.plan.findFirst({ where: { slug: 'nearbyorders-business' } });
        if (!plan) throw Object.assign(new Error('plan'), { code: 'PLAN_MISSING' });

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
            data: {
              status: 'ACTIVE',
              currentPeriodStartAt: liveCurrent.currentPeriodEndAt,
              currentPeriodEndAt: periodEnd,
              planNameSnapshot: plan.name,
              planPriceMinorSnapshot: plan.monthlyPriceMinor,
            },
          });
        } else if (liveCurrent && liveCurrent.status === 'TRIAL') {
          subscription = await tx.businessSubscription.update({
            where: { id: liveCurrent.id },
            data: {
              status: 'ACTIVE',
              currentPeriodStartAt: now,
              currentPeriodEndAt: periodEnd,
              planNameSnapshot: plan.name,
              planPriceMinorSnapshot: plan.monthlyPriceMinor,
            },
          });
        } else {
          subscription = await tx.businessSubscription.create({
            data: {
              businessId: request.businessId,
              planId: plan.id,
              status: 'ACTIVE',
              currentPeriodStartAt: now,
              currentPeriodEndAt: periodEnd,
              planNameSnapshot: plan.name,
              planPriceMinorSnapshot: plan.monthlyPriceMinor,
            },
          });
        }

        // Paid conversion: a business that trialled (ACTIVE/EXPIRED) is marked
        // CONVERTED. A business that never trialled keeps its status.
        const gate = await tx.business.findUnique({ where: { id: request.businessId }, select: { trialStatus: true } });
        if (gate && (gate.trialStatus === 'ACTIVE' || gate.trialStatus === 'EXPIRED'))
          await tx.business.update({ where: { id: request.businessId }, data: { trialStatus: 'CONVERTED' } });

        const approved = await tx.subscriptionPaymentRequest.update({
          where: { id: request.id },
          data: { status: 'APPROVED', reviewedAt: now, reviewedByUserId: admin.id, subscriptionId: subscription.id },
        });

        return { approved, subscription, ownerId: request.business.ownerId, planName: plan.name, activeUntil: periodEnd.toLocaleDateString('en-PK') };
      });
      // Notifications are best-effort and post-commit: they must never fail
      // the payment transaction.
      void createNotifications(prisma, [
        {
          userId: result.ownerId,
          type: NOTIFICATION_TYPES.SUBSCRIPTION_PAYMENT_APPROVED,
          title: 'Subscription payment approved',
          message: `Your ${result.planName} subscription payment has been approved. Your subscription is now active until ${result.activeUntil}.`,
          entityType: 'SubscriptionPaymentRequest',
          entityId: result.approved.id,
        },
        {
          userId: result.ownerId,
          type: NOTIFICATION_TYPES.SUBSCRIPTION_ACTIVATED,
          title: 'Subscription activated',
          message: `Your ${result.planName} subscription is now active.`,
          entityType: 'BusinessSubscription',
          entityId: result.subscription.id,
        },
      ]).catch(() => undefined);
      // Push is an additional channel, dispatched only after commit.
      void dispatchPushNotifications([
        {
          userId: result.ownerId,
          type: NOTIFICATION_TYPES.SUBSCRIPTION_PAYMENT_APPROVED,
          title: 'Subscription payment approved',
          message: `Your ${result.planName} subscription is now active.`,
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
        return { rejected, ownerId: request.business.ownerId };
      });
      // Best-effort and post-commit: never fails the rejection transaction.
      void createNotifications(prisma, [
        {
          userId: result.ownerId,
          type: NOTIFICATION_TYPES.SUBSCRIPTION_PAYMENT_REJECTED,
          title: 'Subscription payment rejected',
          message: `Your NearbyOrders subscription payment was rejected. Reason: ${reason}`,
          entityType: 'SubscriptionPaymentRequest',
          entityId: result.rejected.id,
        },
      ]).catch(() => undefined);
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

  const adminListPaymentMethods = async () => {
    const methods = await prisma.paymentMethod.findMany({ orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }] });
    return { data: methods };
  };

  const adminCreatePaymentMethod = async (q: FastifyRequest, r: FastifyReply) => {
    const d = paymentMethodSchema.parse(q.body);
    const created = await prisma.paymentMethod.create({ data: d });
    await prisma.auditLog.create({
      data: { actorId: currentUser(q).id, action: 'PAYMENT_METHOD_CREATED', entityType: 'PaymentMethod', entityId: created.id, metadata: { type: created.type } },
    });
    return r.status(201).send({ data: created });
  };

  const adminUpdatePaymentMethod = async (q: FastifyRequest, r: FastifyReply) => {
    const id = (q.params as { id: string }).id;
    const d = paymentMethodUpdateSchema.parse(q.body);
    const existing = await prisma.paymentMethod.findUnique({ where: { id } });
    if (!existing) return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Payment method not found' } });
    const updated = await prisma.paymentMethod.update({ where: { id }, data: d });
    await prisma.auditLog.create({
      data: { actorId: currentUser(q).id, action: 'PAYMENT_METHOD_UPDATED', entityType: 'PaymentMethod', entityId: id, metadata: { keys: Object.keys(d) } },
    });
    return { data: updated };
  };

  /**
   * Deleting a payment method is only allowed while it has no payment
   * requests (FK RESTRICT); otherwise admins deactivate it — history must
   * keep showing the channel a payment was paid to.
   */
  const adminDeletePaymentMethod = async (q: FastifyRequest, r: FastifyReply) => {
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
  };

  // Legacy paths, kept for compatibility.
  app.get('/api/v1/admin/payment-methods', { preHandler: roles('ADMIN') }, adminListPaymentMethods);
  app.post('/api/v1/admin/payment-methods', { preHandler: roles('ADMIN') }, adminCreatePaymentMethod);
  app.patch('/api/v1/admin/payment-methods/:id', { preHandler: roles('ADMIN') }, adminUpdatePaymentMethod);
  app.delete('/api/v1/admin/payment-methods/:id', { preHandler: roles('ADMIN') }, adminDeletePaymentMethod);
  // Canonical paths under the subscription namespace.
  app.get('/api/v1/admin/subscription/payment-methods', { preHandler: roles('ADMIN') }, adminListPaymentMethods);
  app.post('/api/v1/admin/subscription/payment-methods', { preHandler: roles('ADMIN') }, adminCreatePaymentMethod);
  app.patch('/api/v1/admin/subscription/payment-methods/:id', { preHandler: roles('ADMIN') }, adminUpdatePaymentMethod);
  app.delete('/api/v1/admin/subscription/payment-methods/:id', { preHandler: roles('ADMIN') }, adminDeletePaymentMethod);

  /* ------------------- Admin: subscription plans (Phase 18) ---------- */

  /** Plan row with a usage count so admins can see references at a glance. */
  const publicAdminPlan = async (plan: {
    id: string; slug: string; name: string; description: string | null; monthlyPriceMinor: number; currency: string;
    trialDays: number; benefits: string[]; billingInterval: string; displayOrder: number; isHighlighted: boolean;
    isActive: boolean; createdAt: Date; updatedAt: Date;
  }) => ({
    ...plan,
    usageCount: await prisma.businessSubscription.count({ where: { planId: plan.id } }),
  });

  app.get('/api/v1/admin/subscription/plans', { preHandler: roles('ADMIN') }, async () => {
    const plans = await prisma.plan.findMany({ orderBy: [{ displayOrder: 'asc' }, { monthlyPriceMinor: 'asc' }] });
    return { data: await Promise.all(plans.map(publicAdminPlan)) };
  });

  app.post('/api/v1/admin/subscription/plans', { preHandler: roles('ADMIN') }, async (q, r) => {
    const d = planCreateSchema.parse(q.body);
    const existing = await prisma.plan.findUnique({ where: { slug: d.slug } });
    if (existing) return r.status(409).send({ error: { code: 'PLAN_SLUG_IN_USE', message: 'A plan with this slug already exists' } });
    const created = await prisma.plan.create({ data: d });
    await prisma.auditLog.create({
      data: { actorId: currentUser(q).id, action: 'SUBSCRIPTION_PLAN_CREATED', entityType: 'Plan', entityId: created.id, metadata: { slug: created.slug } },
    });
    return r.status(201).send({ data: await publicAdminPlan(created) });
  });

  app.patch('/api/v1/admin/subscription/plans/:id', { preHandler: roles('ADMIN') }, async (q, r) => {
    const id = (q.params as { id: string }).id;
    const d = planUpdateSchema.parse(q.body);
    const existing = await prisma.plan.findUnique({ where: { id } });
    if (!existing) return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Plan not found' } });
    const updated = await prisma.plan.update({ where: { id }, data: d });
    await prisma.auditLog.create({
      data: { actorId: currentUser(q).id, action: 'SUBSCRIPTION_PLAN_UPDATED', entityType: 'Plan', entityId: id, metadata: { keys: Object.keys(d) } },
    });
    return { data: await publicAdminPlan(updated) };
  });

  /**
   * Deleting a plan is only allowed while no subscription references it —
   * history rows freeze the plan's name/price as snapshots, and the FK is
   * RESTRICT. Deactivation is the soft path for retiring a plan.
   */
  app.delete('/api/v1/admin/subscription/plans/:id', { preHandler: roles('ADMIN') }, async (q, r) => {
    const id = (q.params as { id: string }).id;
    const existing = await prisma.plan.findUnique({ where: { id }, include: { _count: { select: { subscriptions: true } } } });
    if (!existing) return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Plan not found' } });
    if (existing._count.subscriptions > 0)
      return r.status(409).send({ error: { code: 'PLAN_IN_USE', message: 'This plan has subscriptions and can only be deactivated, not deleted' } });
    await prisma.plan.delete({ where: { id } });
    await prisma.auditLog.create({
      data: { actorId: currentUser(q).id, action: 'SUBSCRIPTION_PLAN_DELETED', entityType: 'Plan', entityId: id, metadata: { slug: existing.slug } },
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

  /**
   * Owner management reads. The public /businesses/:id/* endpoints only serve
   * APPROVED businesses (and only active catalog items) — an owner managing a
   * PENDING business, or reviewing inactive items, would get a 404 "Business
   * not found". These owner-scoped reads are gated by the same `ownedBusiness`
   * ownership check but return the owner's own full, unfiltered rows.
   */
  app.get('/api/v1/owner/businesses/:id/hours', { preHandler: roles('BUSINESS_OWNER') }, async (q) => {
    const id = (q.params as { id: string }).id;
    await ownedBusiness(q, id);
    const hours = await prisma.businessHour.findMany({ where: { businessId: id }, orderBy: { dayOfWeek: 'asc' } });
    return { data: hours };
  });

  app.get('/api/v1/owner/businesses/:id/services', { preHandler: roles('BUSINESS_OWNER') }, async (q) => {
    const id = (q.params as { id: string }).id;
    await ownedBusiness(q, id);
    const services = await prisma.service.findMany({ where: { businessId: id }, orderBy: { name: 'asc' } });
    return { data: services };
  });

  app.get('/api/v1/owner/businesses/:id/products', { preHandler: roles('BUSINESS_OWNER') }, async (q) => {
    const id = (q.params as { id: string }).id;
    await ownedBusiness(q, id);
    const products = await prisma.product.findMany({ where: { businessId: id }, orderBy: { name: 'asc' } });
    return { data: products };
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
      return r.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Cash is collected by the business. Submit a manual digital payment instead' } });
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
    // DELIVERY snapshot captured at placement (Phase 17); null for pickup
    // orders or delivery orders placed before addresses existed.
    deliveryAddressText: o.deliveryAddressText ?? null,
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
      return r.status(400).send({ error: { code: 'COD_UNAVAILABLE', message: 'Cash on delivery is not available for this business. Choose a payment method' } });
    }
    const totalMinor = subtotalMinor + deliveryFeeMinor;
    // DELIVERY (Phase 17): the client names the customer's own address-book
    // row; the server reads and snapshots its text. Free-form delivery text
    // from the client is never trusted, and PICKUP/COLLECTION orders never
    // carry a delivery address.
    let deliveryAddressText: string | null = null;
    if (d.deliveryAddressId !== undefined) {
      if (d.fulfillmentType !== 'DELIVERY')
        return r.status(400).send({ error: { code: 'INVALID_ADDRESS', message: 'A delivery address applies only to delivery orders' } });
      const address = await prisma.customerAddress.findFirst({
        where: { id: d.deliveryAddressId, customerId: customer.id },
        select: { addressText: true },
      });
      if (!address)
        return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Delivery address not found' } });
      deliveryAddressText = address.addressText;
    } else if (d.fulfillmentType === 'DELIVERY') {
      // Convenience default: the customer's default address, when they have one.
      const fallback = await prisma.customerAddress.findFirst({
        where: { customerId: customer.id, isDefault: true },
        select: { addressText: true },
      });
      deliveryAddressText = fallback?.addressText ?? null;
    }
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
          deliveryAddressText,
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

  /* ------------------- Favorites (Phase 17) -------------------------- */

  /**
   * Saved (favorite) businesses. Server-authoritative persistence in
   * FavoriteBusiness; the (customerId, businessId) pair is unique so saving
   * twice is idempotent. Only APPROVED, unarchived businesses can be saved —
   * a customer never keeps a pinned entry pointing at a hidden/pending page.
   * The saved list reuses the public business DTO (id/name/slug/image/city/
   * rating/categories) so it can be rendered from the same card component as
   * discovery results.
   */
  const favoriteListSelect = {
    business: {
      select: { id: true, name: true, slug: true, imageUrl: true, city: true, address: true, isVerified: true },
    },
    createdAt: true,
  } as const;

  app.get('/api/v1/me/favorites', { preHandler: auth }, async (q) => {
    const rows = await prisma.favoriteBusiness.findMany({
      where: { customerId: currentUser(q).id },
      select: favoriteListSelect,
      orderBy: [{ createdAt: 'desc' }, { businessId: 'desc' }],
      take: 200,
    });
    const ratings = await Promise.all(rows.map((row) => ratingSummary(row.business.id)));
    return {
      data: rows.map((row, i) => ({
        business: {
          ...row.business,
          averageRating: ratings[i].averageRating,
          reviewCount: ratings[i].reviewCount,
        },
        savedAt: row.createdAt,
      })),
    };
  });

  /** Is this business saved by the caller? Powers the profile-heart state. */
  app.get('/api/v1/me/favorites/:businessId', { preHandler: auth }, async (q) => {
    const businessId = (q.params as { businessId: string }).businessId;
    const row = await prisma.favoriteBusiness.findUnique({
      where: { customerId_businessId: { customerId: currentUser(q).id, businessId } },
      select: { createdAt: true },
    });
    return { data: { saved: row !== null } };
  });

  app.post('/api/v1/me/favorites/:businessId', { preHandler: auth }, async (q, r) => {
    const businessId = (q.params as { businessId: string }).businessId;
    // Approved + visible only; anything else is a 404 the same as discovery.
    const business = await prisma.business.findFirst({
      where: { OR: [{ id: businessId }, { slug: businessId }], status: 'APPROVED', archivedAt: null },
      select: { id: true },
    });
    if (!business) return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Business not found' } });
    // Idempotent upsert: double-tap save never errors and never duplicates.
    await prisma.favoriteBusiness.upsert({
      where: { customerId_businessId: { customerId: currentUser(q).id, businessId: business.id } },
      update: {},
      create: { customerId: currentUser(q).id, businessId: business.id },
    });
    return { data: { saved: true } };
  });

  app.delete('/api/v1/me/favorites/:businessId', { preHandler: auth }, async (q) => {
    const businessId = (q.params as { businessId: string }).businessId;
    // Idempotent unsave: deleting a missing save is still a success — the
    // end state (not saved) is exactly what the caller asked for.
    await prisma.favoriteBusiness.deleteMany({ where: { customerId: currentUser(q).id, businessId } });
    return { data: { saved: false } };
  });

  /* ---------------- Customer addresses (Phase 17) --------------------- */

  /**
   * The customer's delivery address book. Ownership is the caller's own id
   * on every query; a foreign or malformed id is simply a 404. Coordinates
   * are optional and range-validated by the schema; nothing invents them.
   */
  const publicAddress = (a: {
    id: string;
    label: string;
    recipientName: string;
    phone: string | null;
    addressText: string;
    latitude: unknown;
    longitude: unknown;
    isDefault: boolean;
    createdAt: Date;
  }) => ({
    id: a.id,
    label: a.label,
    recipientName: a.recipientName,
    phone: a.phone,
    addressText: a.addressText,
    // Decimals serialize as strings; coordinates are always JSON numbers.
    latitude: a.latitude === null || a.latitude === undefined ? null : Number(a.latitude),
    longitude: a.longitude === null || a.longitude === undefined ? null : Number(a.longitude),
    isDefault: a.isDefault,
    createdAt: a.createdAt,
  });

  app.get('/api/v1/me/addresses', { preHandler: auth }, async (q) => {
    const rows = await prisma.customerAddress.findMany({
      where: { customerId: currentUser(q).id },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      take: 50,
    });
    return { data: rows.map(publicAddress) };
  });

  app.post('/api/v1/me/addresses', { preHandler: auth }, async (q, r) => {
    const d = addressCreateSchema.parse(q.body);
    const customerId = currentUser(q).id;
    const count = await prisma.customerAddress.count({ where: { customerId } });
    if (count >= 20)
      return r.status(400).send({ error: { code: 'ADDRESS_LIMIT', message: 'Address book is full (20 addresses maximum)' } });
    const created = await prisma.$transaction(async (tx) => {
      // A customer always keeps a default when possible: an explicit
      // isDefault=true demotes the previous default; a create into a book
      // with NO default promotes the new row unless the customer explicitly
      // declined (isDefault === false). Never zero and two defaults.
      const hasDefault = await tx.customerAddress.findFirst({ where: { customerId, isDefault: true }, select: { id: true } });
      const makeDefault = d.isDefault === true || (!hasDefault && d.isDefault !== false);
      if (makeDefault)
        await tx.customerAddress.updateMany({ where: { customerId, isDefault: true }, data: { isDefault: false } });
      return tx.customerAddress.create({
        data: {
          customerId,
          label: d.label,
          recipientName: d.recipientName,
          phone: d.phone ?? null,
          addressText: d.addressText,
          latitude: d.coordinates?.latitude ?? null,
          longitude: d.coordinates?.longitude ?? null,
          isDefault: makeDefault,
        },
      });
    });
    return r.status(201).send({ data: publicAddress(created) });
  });

  app.patch('/api/v1/me/addresses/:id', { preHandler: auth }, async (q, r) => {
    const id = (q.params as { id: string }).id;
    const d = addressUpdateSchema.parse(q.body);
    const customerId = currentUser(q).id;
    // Ownership check first: a foreign id is indistinguishable from a missing
    // one (404), never an update of someone else's row.
    const existing = await prisma.customerAddress.findFirst({ where: { id, customerId }, select: { id: true } });
    if (!existing) return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Address not found' } });
    const updated = await prisma.$transaction(async (tx) => {
      if (d.isDefault === true)
        await tx.customerAddress.updateMany({ where: { customerId, isDefault: true }, data: { isDefault: false } });
      return tx.customerAddress.update({
        where: { id },
        data: {
          ...(d.label !== undefined ? { label: d.label } : {}),
          ...(d.recipientName !== undefined ? { recipientName: d.recipientName } : {}),
          ...(d.phone !== undefined ? { phone: d.phone } : {}),
          ...(d.addressText !== undefined ? { addressText: d.addressText } : {}),
          ...(d.coordinates !== undefined
            ? { latitude: d.coordinates?.latitude ?? null, longitude: d.coordinates?.longitude ?? null }
            : {}),
          ...(d.isDefault !== undefined ? { isDefault: d.isDefault } : {}),
        },
      });
    });
    return { data: publicAddress(updated) };
  });

  app.delete('/api/v1/me/addresses/:id', { preHandler: auth }, async (q) => {
    const id = (q.params as { id: string }).id;
    // deleteMany scoped by owner: foreign ids delete nothing and still 404.
    const deleted = await prisma.customerAddress.deleteMany({ where: { id, customerId: currentUser(q).id } });
    if (deleted.count === 0) return { data: { deleted: false } };
    return { data: { deleted: true } };
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
        id: true, name: true, slug: true, status: true, isVerified: true, verificationStatus: true, trialStatus: true,
        city: true, address: true, createdAt: true,
        owner: { select: { id: true, email: true, firstName: true, lastName: true } },
        // Operational activity counts (Phase 16): real aggregates, no tokens,
        // no customer data — just how alive this business is on the platform.
        _count: { select: { orders: true, bookings: true, services: true, products: true, reviews: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: query.limit,
    });
    // Current live subscription status per business (evaluated, lazily-expired).
    const subs = await prisma.businessSubscription.findMany({
      where: { businessId: { in: businesses.map((b) => b.id) } },
      select: { businessId: true, status: true, currentPeriodEndAt: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    const subscriptionStatusByBusiness = new Map<string, string>();
    for (const s of subs) {
      if (!subscriptionStatusByBusiness.has(s.businessId)) subscriptionStatusByBusiness.set(s.businessId, evaluateSubscription(s));
    }
    return {
      data: businesses.map(({ _count, ...b }) => ({
        ...b,
        counts: _count,
        subscriptionStatus: subscriptionStatusByBusiness.get(b.id) ?? null,
      })),
    };
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

  /* ------------------- Admin: verification applications ------------- */

  /** Admin DTO: adds reviewer identity and internal notes the owner DTO omits. */
  const adminVerification = (v: {
    id: string; status: string; legalName: string | null; publicName: string | null; ownerName: string | null;
    phone: string | null; address: string | null; city: string | null; categoryId: string | null;
    description: string | null; latitude: number | null; longitude: number | null;
    registrationInfo: string | null; adminNotes: string | null; reviewerMessage: string | null;
    reviewedByUserId: string | null; submittedAt: Date | null; reviewedAt: Date | null;
    createdAt: Date; updatedAt: Date;
    business: { id: string; name: string; slug: string; owner: { id: string; email: string; firstName: string | null; lastName: string | null } };
    documents: { id: string; docType: string; storageKey: string; status: string; uploadedAt: Date }[];
  }) => ({
    id: v.id,
    status: v.status,
    legalName: v.legalName,
    publicName: v.publicName,
    ownerName: v.ownerName,
    phone: v.phone,
    address: v.address,
    city: v.city,
    categoryId: v.categoryId,
    description: v.description,
    latitude: v.latitude,
    longitude: v.longitude,
    registrationInfo: v.registrationInfo,
    adminNotes: v.adminNotes,
    reviewerMessage: v.reviewerMessage,
    reviewedByUserId: v.reviewedByUserId,
    submittedAt: v.submittedAt?.toISOString() ?? null,
    reviewedAt: v.reviewedAt?.toISOString() ?? null,
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
    business: v.business,
    documents: v.documents,
  });

  const VERIFICATION_ADMIN_INCLUDE = {
    business: {
      select: { id: true, name: true, slug: true, owner: { select: { id: true, email: true, firstName: true, lastName: true } } },
    },
    documents: { select: { id: true, docType: true, storageKey: true, status: true, uploadedAt: true }, orderBy: { uploadedAt: 'asc' } },
  } satisfies Prisma.VerificationApplicationInclude;

  /** Review queue: filterable by status, newest first, paginated. */
  app.get('/api/v1/admin/verifications', { preHandler: roles('ADMIN') }, async (q) => {
    const query = z
      .object({
        status: z.enum(['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED']).optional(),
        q: z.string().trim().max(120).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
        cursor: z.string().optional(),
      })
      .parse(q.query ?? {});
    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;
    if (query.q) where.business = { name: { contains: query.q, mode: 'insensitive' } };
    const applications = await prisma.verificationApplication.findMany({
      where,
      include: VERIFICATION_ADMIN_INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    return {
      data: {
        items: applications.map(adminVerification),
        nextCursor: applications.length === query.limit ? applications[applications.length - 1].id : null,
      },
    };
  });

  app.get('/api/v1/admin/verifications/:id', { preHandler: roles('ADMIN') }, async (q, r) => {
    const application = await prisma.verificationApplication.findUnique({
      where: { id: (q.params as { id: string }).id },
      include: VERIFICATION_ADMIN_INCLUDE,
    });
    if (!application) return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Verification application not found' } });
    return { data: adminVerification(application) };
  });

  /**
   * Approves an application: marks documents verified, grants the business
   * its verified badge (isVerified + verificationStatus VERIFIED), and makes
   * the business trial-eligible when it has never been eligible before. The
   * review is a one-way transition from SUBMITTED — re-deciding an already
   * decided application is rejected.
   */
  app.post('/api/v1/admin/verifications/:id/approve', { preHandler: roles('ADMIN') }, async (q, r) => {
    const id = (q.params as { id: string }).id;
    const admin = currentUser(q);
    const { adminNotes, reviewerMessage } = verificationApproveSchema.parse(q.body ?? {});
    const now = new Date();
    try {
      const result = await prisma.$transaction(async (tx) => {
        const application = await tx.verificationApplication.findUniqueOrThrow({ where: { id }, include: { business: { select: { id: true, ownerId: true, trialStatus: true } } } });
        if (application.status !== 'SUBMITTED') throw Object.assign(new Error('dup'), { code: 'NOT_SUBMITTED' });
        const updated = await tx.verificationApplication.update({
          where: { id },
          data: { status: 'APPROVED', adminNotes: adminNotes ?? null, reviewerMessage: reviewerMessage ?? null, reviewedByUserId: admin.id, reviewedAt: now },
        });
        await tx.verificationDocument.updateMany({ where: { applicationId: id }, data: { status: 'ACCEPTED' } });
        await tx.business.update({
          where: { id: application.businessId },
          data: {
            isVerified: true,
            verificationStatus: 'VERIFIED',
            verifiedAt: now,
            // A verified business that never had trial access becomes
            // trial-eligible: verification is the eligibility gate.
            ...(application.business.trialStatus === 'NOT_ELIGIBLE' ? { trialStatus: 'ELIGIBLE' } : {}),
          },
        });
        return { updated, business: application.business };
      });
      await prisma.auditLog.create({
        data: { actorId: admin.id, action: 'VERIFICATION_APPROVED', entityType: 'VerificationApplication', entityId: id, metadata: { businessId: result.business.id } },
      });
      const notifications: NotificationInput[] = [
        {
          userId: result.business.ownerId,
          type: NOTIFICATION_TYPES.VERIFICATION_APPROVED,
          title: 'Business verified',
          message: 'Your business has been verified and now carries the verified badge.',
          entityType: 'VerificationApplication',
          entityId: id,
        },
      ];
      if (result.business.trialStatus === 'NOT_ELIGIBLE')
        notifications.push({
          userId: result.business.ownerId,
          type: NOTIFICATION_TYPES.TRIAL_ELIGIBLE,
          title: 'Free trial unlocked',
          message: 'Your business is now eligible for a free trial subscription.',
          entityType: 'VerificationApplication',
          entityId: id,
        });
      void createNotifications(prisma, notifications).catch(() => undefined);
      const full = await prisma.verificationApplication.findUniqueOrThrow({ where: { id }, include: VERIFICATION_ADMIN_INCLUDE });
      return { data: adminVerification(full) };
    } catch (e) {
      if ((e as { code?: string }).code === 'NOT_SUBMITTED')
        return r.status(409).send({ error: { code: 'NOT_SUBMITTED', message: 'This application has already been reviewed' } });
      if ((e as { code?: string }).code === 'P2025')
        return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Verification application not found' } });
      throw e;
    }
  });

  /**
   * Rejects an application: marks documents rejected, clears the verified
   * badge (verificationStatus REJECTED), and leaves trial eligibility
   * untouched. The owner-visible reviewer message is required.
   */
  app.post('/api/v1/admin/verifications/:id/reject', { preHandler: roles('ADMIN') }, async (q, r) => {
    const id = (q.params as { id: string }).id;
    const admin = currentUser(q);
    const { adminNotes, reviewerMessage } = verificationDecisionSchema.parse(q.body);
    const now = new Date();
    try {
      const result = await prisma.$transaction(async (tx) => {
        const application = await tx.verificationApplication.findUniqueOrThrow({ where: { id }, include: { business: { select: { id: true, ownerId: true } } } });
        if (application.status !== 'SUBMITTED') throw Object.assign(new Error('dup'), { code: 'NOT_SUBMITTED' });
        const updated = await tx.verificationApplication.update({
          where: { id },
          data: { status: 'REJECTED', adminNotes: adminNotes ?? null, reviewerMessage, reviewedByUserId: admin.id, reviewedAt: now },
        });
        await tx.verificationDocument.updateMany({ where: { applicationId: id }, data: { status: 'REJECTED' } });
        await tx.business.update({
          where: { id: application.businessId },
          data: { isVerified: false, verificationStatus: 'REJECTED' },
        });
        return { updated, business: application.business };
      });
      await prisma.auditLog.create({
        data: { actorId: admin.id, action: 'VERIFICATION_REJECTED', entityType: 'VerificationApplication', entityId: id, metadata: { businessId: result.business.id } },
      });
      void createNotifications(prisma, [
        {
          userId: result.business.ownerId,
          type: NOTIFICATION_TYPES.VERIFICATION_REJECTED,
          title: 'Verification rejected',
          message: `Your verification application was rejected. ${reviewerMessage}`,
          entityType: 'VerificationApplication',
          entityId: id,
        },
      ]).catch(() => undefined);
      const full = await prisma.verificationApplication.findUniqueOrThrow({ where: { id }, include: VERIFICATION_ADMIN_INCLUDE });
      return { data: adminVerification(full) };
    } catch (e) {
      if ((e as { code?: string }).code === 'NOT_SUBMITTED')
        return r.status(409).send({ error: { code: 'NOT_SUBMITTED', message: 'This application has already been reviewed' } });
      if ((e as { code?: string }).code === 'P2025')
        return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Verification application not found' } });
      throw e;
    }
  });

  /**
   * Sends an application back for changes: the owner can edit the draft again
   * and re-submit. Documents return to PENDING. The owner-visible reviewer
   * message is required.
   */
  app.post('/api/v1/admin/verifications/:id/request-changes', { preHandler: roles('ADMIN') }, async (q, r) => {
    const id = (q.params as { id: string }).id;
    const admin = currentUser(q);
    const { adminNotes, reviewerMessage } = verificationDecisionSchema.parse(q.body);
    const now = new Date();
    try {
      const result = await prisma.$transaction(async (tx) => {
        const application = await tx.verificationApplication.findUniqueOrThrow({ where: { id }, include: { business: { select: { id: true, ownerId: true } } } });
        if (application.status !== 'SUBMITTED') throw Object.assign(new Error('dup'), { code: 'NOT_SUBMITTED' });
        const updated = await tx.verificationApplication.update({
          where: { id },
          data: { status: 'CHANGES_REQUESTED', adminNotes: adminNotes ?? null, reviewerMessage, reviewedByUserId: admin.id, reviewedAt: now },
        });
        await tx.verificationDocument.updateMany({ where: { applicationId: id }, data: { status: 'PENDING' } });
        return { updated, business: application.business };
      });
      await prisma.auditLog.create({
        data: { actorId: admin.id, action: 'VERIFICATION_CHANGES_REQUESTED', entityType: 'VerificationApplication', entityId: id, metadata: { businessId: result.business.id } },
      });
      void createNotifications(prisma, [
        {
          userId: result.business.ownerId,
          type: NOTIFICATION_TYPES.VERIFICATION_CHANGES_REQUESTED,
          title: 'Verification needs changes',
          message: `Your verification application needs changes before it can be approved. ${reviewerMessage}`,
          entityType: 'VerificationApplication',
          entityId: id,
        },
      ]).catch(() => undefined);
      const full = await prisma.verificationApplication.findUniqueOrThrow({ where: { id }, include: VERIFICATION_ADMIN_INCLUDE });
      return { data: adminVerification(full) };
    } catch (e) {
      if ((e as { code?: string }).code === 'NOT_SUBMITTED')
        return r.status(409).send({ error: { code: 'NOT_SUBMITTED', message: 'This application has already been reviewed' } });
      if ((e as { code?: string }).code === 'P2025')
        return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Verification application not found' } });
      throw e;
    }
  });

  /**
   * Admin edits the review fields on an application directly (internal notes,
   * owner-visible message). Never accepts isVerified — verification is
   * granted only through the approve transition above.
   */
  app.patch('/api/v1/admin/verifications/:id', { preHandler: roles('ADMIN') }, async (q, r) => {
    const id = (q.params as { id: string }).id;
    const { adminNotes, reviewerMessage } = verificationApproveSchema.parse(q.body ?? {});
    if (adminNotes === undefined && reviewerMessage === undefined)
      return r.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'No changes provided' } });
    const existing = await prisma.verificationApplication.findUnique({ where: { id } });
    if (!existing) return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Verification application not found' } });
    const updated = await prisma.verificationApplication.update({
      where: { id },
      data: {
        ...(adminNotes !== undefined ? { adminNotes } : {}),
        ...(reviewerMessage !== undefined ? { reviewerMessage } : {}),
      },
      include: VERIFICATION_ADMIN_INCLUDE,
    });
    await prisma.auditLog.create({
      data: { actorId: currentUser(q).id, action: 'VERIFICATION_UPDATED', entityType: 'VerificationApplication', entityId: id },
    });
    return { data: adminVerification(updated) };
  });

  /* ------------------- Admin: promotions (Phase 18) ------------------ */

  const slugifyPromotion = (name: string) =>
    name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || `promotion-${Date.now().toString(36)}`;

  app.get('/api/v1/admin/promotions', { preHandler: roles('ADMIN') }, async () => {
    const promotions = await prisma.promotion.findMany({ orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }] });
    return { data: promotions };
  });

  app.post('/api/v1/admin/promotions', { preHandler: roles('ADMIN') }, async (q, r) => {
    const d = promotionCreateSchema.parse(q.body);
    const slug = d.slug ?? slugifyPromotion(d.name);
    const existing = await prisma.promotion.findUnique({ where: { slug } });
    if (existing) return r.status(409).send({ error: { code: 'PROMOTION_SLUG_IN_USE', message: 'A promotion with this slug already exists' } });
    const created = await prisma.promotion.create({ data: { ...d, slug } });
    await prisma.auditLog.create({
      data: { actorId: currentUser(q).id, action: 'PROMOTION_CREATED', entityType: 'Promotion', entityId: created.id, metadata: { slug } },
    });
    return r.status(201).send({ data: created });
  });

  app.patch('/api/v1/admin/promotions/:id', { preHandler: roles('ADMIN') }, async (q, r) => {
    const id = (q.params as { id: string }).id;
    const d = promotionUpdateSchema.parse(q.body);
    const existing = await prisma.promotion.findUnique({ where: { id } });
    if (!existing) return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Promotion not found' } });
    const updated = await prisma.promotion.update({ where: { id }, data: d });
    await prisma.auditLog.create({
      data: { actorId: currentUser(q).id, action: 'PROMOTION_UPDATED', entityType: 'Promotion', entityId: id, metadata: { keys: Object.keys(d) } },
    });
    return { data: updated };
  });

  /**
   * Deleting a promotion is only allowed while it has no requests (FK
   * RESTRICT); otherwise admins deactivate it — history must keep showing
   * what a business requested.
   */
  app.delete('/api/v1/admin/promotions/:id', { preHandler: roles('ADMIN') }, async (q, r) => {
    const id = (q.params as { id: string }).id;
    const existing = await prisma.promotion.findUnique({ where: { id }, include: { _count: { select: { requests: true } } } });
    if (!existing) return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Promotion not found' } });
    if (existing._count.requests > 0)
      return r.status(409).send({ error: { code: 'IN_USE', message: 'This promotion has requests and can only be deactivated, not deleted' } });
    await prisma.promotion.delete({ where: { id } });
    await prisma.auditLog.create({
      data: { actorId: currentUser(q).id, action: 'PROMOTION_DELETED', entityType: 'Promotion', entityId: id, metadata: { slug: existing.slug } },
    });
    return r.status(204).send();
  });

  /** Admin DTO for promotion requests: business identity + reviewer + payment/activation fields. */
  const adminPromotionRequest = (p: {
    id: string; status: string; note: string | null; reviewerMessage: string | null;
    reviewedByUserId: string | null; createdAt: Date; reviewedAt: Date | null;
    activatedAt: Date | null; expiresAt: Date | null;
    promotion: { id: string; name: string; slug: string; priceMinor: number | null; currency: string; durationDays: number | null };
    business: { id: string; name: string; slug: string; owner: { id: string; email: string; firstName: string | null; lastName: string | null } };
    payments: { id: string; status: string; amountMinor: number; submittedAt: Date }[];
  }) => ({
    id: p.id,
    status: p.status,
    note: p.note,
    reviewerMessage: p.reviewerMessage,
    reviewedByUserId: p.reviewedByUserId,
    createdAt: p.createdAt.toISOString(),
    reviewedAt: p.reviewedAt?.toISOString() ?? null,
    activatedAt: p.activatedAt?.toISOString() ?? null,
    expiresAt: p.expiresAt?.toISOString() ?? null,
    paymentStatus: p.payments[0]?.status ?? null,
    payments: p.payments.map((x) => ({ id: x.id, status: x.status, amountMinor: x.amountMinor, submittedAt: x.submittedAt.toISOString() })),
    promotion: p.promotion,
    business: p.business,
  });

  const PROMOTION_REQUEST_INCLUDE = {
    promotion: { select: { id: true, name: true, slug: true, priceMinor: true, currency: true, durationDays: true } },
    business: {
      select: { id: true, name: true, slug: true, owner: { select: { id: true, email: true, firstName: true, lastName: true } } },
    },
    payments: { select: { id: true, status: true, amountMinor: true, submittedAt: true }, orderBy: { submittedAt: 'desc' as const } },
  } as const;

  /** Promotion request queue: filterable by status/promotion, newest first (expiry applied on read). */
  app.get('/api/v1/admin/promotion-requests', { preHandler: roles('ADMIN') }, async (q) => {
    const query = z
      .object({
        status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'ACTIVE', 'EXPIRED', 'CANCELLED']).optional(),
        promotionId: z.string().uuid().optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      })
      .parse(q.query ?? {});
    await expireOverduePromotionRequests(prisma);
    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;
    if (query.promotionId) where.promotionId = query.promotionId;
    const requests = await prisma.promotionRequest.findMany({
      where,
      include: PROMOTION_REQUEST_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: query.limit,
    });
    return { data: requests.map(adminPromotionRequest) };
  });

  app.get('/api/v1/admin/promotion-requests/:id', { preHandler: roles('ADMIN') }, async (q, r) => {
    await expireOverduePromotionRequests(prisma);
    const request = await prisma.promotionRequest.findUnique({
      where: { id: (q.params as { id: string }).id },
      include: PROMOTION_REQUEST_INCLUDE,
    });
    if (!request) return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Promotion request not found' } });
    return { data: adminPromotionRequest(request) };
  });

  /**
   * Approves a promotion request.
   *
   * - Zero-price promotion: activates immediately (status ACTIVE with
   *   server-computed start/end dates) — no payment is ever requested.
   * - Paid promotion: moves to APPROVED ("payment required"). Application
   *   approval NEVER activates a paid promotion; only admin approval of the
   *   business's payment does.
   */
  app.post('/api/v1/admin/promotion-requests/:id/approve', { preHandler: roles('ADMIN') }, async (q, r) => {
    const id = (q.params as { id: string }).id;
    const admin = currentUser(q);
    const { reviewerMessage } = promotionRequestReviewSchema.parse(q.body ?? {});
    const now = new Date();
    const existing = await prisma.promotionRequest.findUnique({
      where: { id },
      include: {
        business: { select: { ownerId: true } },
        promotion: { select: { name: true, priceMinor: true, currency: true, durationDays: true } },
      },
    });
    if (!existing) return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Promotion request not found' } });
    if (existing.status !== 'PENDING')
      return r.status(409).send({ error: { code: 'NOT_PENDING', message: 'This promotion request has already been reviewed' } });
    const amountMinor = promotionAmountDue(existing.promotion.priceMinor);
    const isFree = amountMinor <= 0;
    const days = Math.max(1, existing.promotion.durationDays ?? PROMOTION_DEFAULT_DURATION_DAYS);
    const approved = await prisma.promotionRequest.update({
      where: { id },
      data: isFree
        ? {
            status: 'ACTIVE',
            activatedAt: now,
            expiresAt: addDays(now, days),
            reviewerMessage: reviewerMessage ?? null,
            reviewedByUserId: admin.id,
            reviewedAt: now,
          }
        : {
            status: 'APPROVED',
            reviewerMessage: reviewerMessage ?? null,
            reviewedByUserId: admin.id,
            reviewedAt: now,
          },
      include: PROMOTION_REQUEST_INCLUDE,
    });
    await prisma.auditLog.create({
      data: {
        actorId: admin.id,
        action: isFree ? 'PROMOTION_ACTIVATED' : 'PROMOTION_REQUEST_APPROVED',
        entityType: 'PromotionRequest',
        entityId: id,
      },
    });
    void createNotifications(prisma, [
      isFree
        ? {
            userId: existing.business.ownerId,
            type: NOTIFICATION_TYPES.PROMOTION_ACTIVATED,
            title: 'Promotion active',
            message: `Your request to join "${existing.promotion.name}" was approved and the promotion is now active.`,
            entityType: 'PromotionRequest',
            entityId: id,
          }
        : {
            userId: existing.business.ownerId,
            type: NOTIFICATION_TYPES.PROMOTION_REQUEST_APPROVED,
            title: 'Promotion request approved',
            message: `Your request to join "${existing.promotion.name}" was approved. A payment of ${formatMinor(existing.promotion.currency, amountMinor)} is required to activate it.`,
            entityType: 'PromotionRequest',
            entityId: id,
          },
    ]).catch(() => undefined);
    return { data: adminPromotionRequest(approved) };
  });

  /** Rejects a promotion request with an owner-visible message (optional). */
  app.post('/api/v1/admin/promotion-requests/:id/reject', { preHandler: roles('ADMIN') }, async (q, r) => {
    const id = (q.params as { id: string }).id;
    const admin = currentUser(q);
    const { reviewerMessage } = promotionRequestReviewSchema.parse(q.body ?? {});
    const now = new Date();
    const existing = await prisma.promotionRequest.findUnique({
      where: { id },
      include: { business: { select: { ownerId: true } }, promotion: { select: { name: true } } },
    });
    if (!existing) return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Promotion request not found' } });
    if (existing.status !== 'PENDING')
      return r.status(409).send({ error: { code: 'NOT_PENDING', message: 'This promotion request has already been reviewed' } });
    const rejected = await prisma.promotionRequest.update({
      where: { id },
      data: { status: 'REJECTED', reviewerMessage: reviewerMessage ?? null, reviewedByUserId: admin.id, reviewedAt: now },
      include: PROMOTION_REQUEST_INCLUDE,
    });
    await prisma.auditLog.create({
      data: { actorId: admin.id, action: 'PROMOTION_REQUEST_REJECTED', entityType: 'PromotionRequest', entityId: id },
    });
    void createNotifications(prisma, [
      {
        userId: existing.business.ownerId,
        type: NOTIFICATION_TYPES.PROMOTION_REQUEST_REJECTED,
        title: 'Promotion request rejected',
        message: `Your request to join "${existing.promotion.name}" was not approved.${reviewerMessage ? ` ${reviewerMessage}` : ''}`,
        entityType: 'PromotionRequest',
        entityId: id,
      },
    ]).catch(() => undefined);
    return { data: adminPromotionRequest(rejected) };
  });

  /* ---------------- Admin: promotion payment review ----------------- */
  /**
   * Promotion payment queue: filterable by status/request/business, newest
   * first. Same paginated envelope as the subscription payment queue.
   */
  app.get('/api/v1/admin/promotion-payment-requests', { preHandler: roles('ADMIN') }, async (q) => {
    const query = z
      .object({
        status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(),
        promotionRequestId: z.string().uuid().optional(),
        businessId: z.string().uuid().optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
        cursor: z.string().optional(),
      })
      .parse(q.query ?? {});
    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;
    if (query.promotionRequestId) where.promotionRequestId = query.promotionRequestId;
    if (query.businessId) where.businessId = query.businessId;
    const requests = await prisma.promotionPaymentRequest.findMany({
      where,
      orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
      take: query.limit ?? 50,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: PROMOTION_PAYMENT_INCLUDE,
    });
    return {
      data: {
        items: requests.map(adminPromotionPayment),
        nextCursor: requests.length === (query.limit ?? 50) ? requests[requests.length - 1].id : null,
      },
    };
  });

  app.get('/api/v1/admin/promotion-payment-requests/:id', { preHandler: roles('ADMIN') }, async (q, r) => {
    const req = await prisma.promotionPaymentRequest.findUnique({
      where: { id: (q.params as { id: string }).id },
      include: PROMOTION_PAYMENT_INCLUDE,
    });
    if (!req) return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Promotion payment request not found' } });
    return { data: adminPromotionPayment(req) };
  });

  /**
   * Approves a promotion payment: the payment becomes APPROVED and — only
   * now — the promotion request becomes ACTIVE with server-computed
   * start/end dates (activation moment + catalog duration). Advisory-locked
   * so a payment is processed exactly once; the promotion request must be
   * APPROVED (application stage) or the approval is refused.
   */
  app.post('/api/v1/admin/promotion-payment-requests/:id/approve', { preHandler: roles('ADMIN') }, async (q, r) => {
    const requestId = (q.params as { id: string }).id;
    const admin = currentUser(q);
    const now = new Date();
    try {
      const result = await prisma.$transaction(async (tx) => {
        const existing = await tx.promotionPaymentRequest.findUnique({ where: { id: requestId } });
        if (!existing) throw Object.assign(new Error('missing'), { code: 'NOT_FOUND' });
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${existing.promotionRequestId}))`;

        // Reload inside the lock — the authoritative state.
        const payment = await tx.promotionPaymentRequest.findUniqueOrThrow({
          where: { id: requestId },
          include: {
            business: { select: { ownerId: true } },
            promotionRequest: { select: { id: true, status: true, promotionId: true } },
          },
        });
        if (payment.status !== 'PENDING') throw Object.assign(new Error('dup'), { code: 'NOT_PENDING' });
        if (payment.promotionRequest.status !== 'APPROVED')
          throw Object.assign(new Error('state'), { code: 'REQUEST_NOT_APPROVED' });

        const method = await tx.paymentMethod.findUnique({ where: { id: payment.paymentMethodId } });
        if (!method || !method.isActive) throw Object.assign(new Error('method'), { code: 'INVALID_PAYMENT_METHOD' });

        // Approving the same transaction reference twice (two requests
        // claiming one real payment) is rejected.
        const referenceClash = await tx.promotionPaymentRequest.findFirst({
          where: { transactionReference: payment.transactionReference, status: 'APPROVED', id: { not: payment.id } },
          select: { id: true },
        });
        if (referenceClash) throw Object.assign(new Error('ref'), { code: 'REFERENCE_ALREADY_APPROVED' });

        // Amount and duration are server-authoritative, resolved at
        // activation: the catalog price/duration as they exist NOW.
        const promotion = await tx.promotion.findUniqueOrThrow({ where: { id: payment.promotionRequest.promotionId } });
        const days = Math.max(1, promotion.durationDays ?? PROMOTION_DEFAULT_DURATION_DAYS);
        const approvedPayment = await tx.promotionPaymentRequest.update({
          where: { id: payment.id },
          data: { status: 'APPROVED', reviewedAt: now, reviewedByUserId: admin.id },
        });
        const activated = await tx.promotionRequest.update({
          where: { id: payment.promotionRequest.id },
          data: { status: 'ACTIVE', activatedAt: now, expiresAt: addDays(now, days) },
        });
        return { payment: approvedPayment, request: activated, ownerId: payment.business.ownerId, promotionName: promotion.name };
      });
      await prisma.auditLog.create({
        data: { actorId: admin.id, action: 'PROMOTION_PAYMENT_APPROVED', entityType: 'PromotionPaymentRequest', entityId: requestId },
      });
      void createNotifications(prisma, [
        {
          userId: result.ownerId,
          type: NOTIFICATION_TYPES.PROMOTION_PAYMENT_APPROVED,
          title: 'Promotion payment approved',
          message: `Your payment for "${result.promotionName}" was approved.`,
          entityType: 'PromotionPaymentRequest',
          entityId: requestId,
        },
        {
          userId: result.ownerId,
          type: NOTIFICATION_TYPES.PROMOTION_ACTIVATED,
          title: 'Promotion active',
          message: `Your "${result.promotionName}" promotion is now active until ${result.request.expiresAt!.toISOString().slice(0, 10)}.`,
          entityType: 'PromotionRequest',
          entityId: result.request.id,
        },
      ]).catch(() => undefined);
      const full = await prisma.promotionPaymentRequest.findUniqueOrThrow({
        where: { id: requestId },
        include: PROMOTION_PAYMENT_INCLUDE,
      });
      return { data: adminPromotionPayment(full) };
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'NOT_FOUND') return r.status(404).send({ error: { code, message: 'Promotion payment request not found' } });
      if (code === 'NOT_PENDING')
        return r.status(409).send({ error: { code, message: 'This promotion payment has already been reviewed' } });
      if (code === 'REQUEST_NOT_APPROVED')
        return r.status(409).send({ error: { code, message: 'The promotion application is not approved, so a payment cannot activate it' } });
      if (code === 'INVALID_PAYMENT_METHOD')
        return r.status(400).send({ error: { code, message: 'The payment method is no longer active' } });
      if (code === 'REFERENCE_ALREADY_APPROVED')
        return r.status(409).send({ error: { code, message: 'This transaction reference was already approved for another payment' } });
      throw e;
    }
  });

  /**
   * Rejects a promotion payment with an owner-visible reason (optional).
   * The promotion request stays APPROVED so the business can submit a
   * corrected payment — rejection never activates anything.
   */
  app.post('/api/v1/admin/promotion-payment-requests/:id/reject', { preHandler: roles('ADMIN') }, async (q, r) => {
    const requestId = (q.params as { id: string }).id;
    const admin = currentUser(q);
    const { reason } = promotionPaymentReviewSchema.parse(q.body ?? {});
    const now = new Date();
    const existing = await prisma.promotionPaymentRequest.findUnique({
      where: { id: requestId },
      include: {
        business: { select: { ownerId: true } },
        promotionRequest: { select: { promotion: { select: { name: true } } } },
      },
    });
    if (!existing) return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Promotion payment request not found' } });
    if (existing.status !== 'PENDING')
      return r.status(409).send({ error: { code: 'NOT_PENDING', message: 'This promotion payment has already been reviewed' } });
    const rejected = await prisma.promotionPaymentRequest.update({
      where: { id: requestId },
      data: { status: 'REJECTED', rejectionReason: reason ?? null, reviewedAt: now, reviewedByUserId: admin.id },
      include: PROMOTION_PAYMENT_INCLUDE,
    });
    await prisma.auditLog.create({
      data: { actorId: admin.id, action: 'PROMOTION_PAYMENT_REJECTED', entityType: 'PromotionPaymentRequest', entityId: requestId },
    });
    void createNotifications(prisma, [
      {
        userId: existing.business.ownerId,
        type: NOTIFICATION_TYPES.PROMOTION_PAYMENT_REJECTED,
        title: 'Promotion payment rejected',
        message: `Your payment for "${existing.promotionRequest.promotion.name}" was not approved.${reason ? ` ${reason}` : ''} You can submit a corrected payment from your promotion requests.`,
        entityType: 'PromotionPaymentRequest',
        entityId: requestId,
      },
    ]).catch(() => undefined);
    return { data: adminPromotionPayment(rejected) };
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
