import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
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
  bookingSchema,
  orderSchema,
  businessStatusSchema,
  bookingStatusSchema,
  orderStatusSchema,
  slugify,
  allowedTransitions,
  isOpenNow,
  distanceKm,
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
    app.log.error(e);
    return r
      .status((e as { statusCode?: number }).statusCode ?? 500)
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
    const businesses = await prisma.business.findMany({ where, include: PUBLIC_BUSINESS_INCLUDE, take: fetchTake });
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
    const { categoryIds, ...input } = d;
    const validCategories = await prisma.category.findMany({ where: { id: { in: categoryIds }, isActive: true } });
    if (validCategories.length !== categoryIds.length)
      return r.status(400).send({ error: { code: 'INVALID_CATEGORY', message: 'One or more categories are invalid' } });
    const b = await prisma.business.create({
      data: {
        ...input,
        slug: `${slugify(d.name)}-${Date.now().toString(36)}`,
        ownerId: currentUser(q).id,
        categories: { create: categoryIds.map((categoryId) => ({ categoryId })) },
      },
      include: { categories: true },
    });
    return r.status(201).send({ data: b });
  });

  app.get('/api/v1/businesses/mine', { preHandler: roles('BUSINESS_OWNER') }, async (q) => ({
    data: await prisma.business.findMany({
      where: { ownerId: currentUser(q).id, archivedAt: null },
      include: { ...PUBLIC_BUSINESS_INCLUDE, services: { orderBy: { name: 'asc' } }, products: { orderBy: { name: 'asc' } } },
      orderBy: { createdAt: 'asc' },
    }),
  }));

  app.patch('/api/v1/businesses/:id', { preHandler: roles('BUSINESS_OWNER') }, async (q, r) => {
    const id = (q.params as { id: string }).id;
    await ownedBusiness(q, id);
    const d = businessUpdateSchema.parse(q.body);
    const { categoryIds, ...rest } = d;
    const data: Record<string, unknown> = { ...rest };
    if (categoryIds) {
      const validCategories = await prisma.category.findMany({ where: { id: { in: categoryIds }, isActive: true } });
      if (validCategories.length !== categoryIds.length)
        return r.status(400).send({ error: { code: 'INVALID_CATEGORY', message: 'One or more categories are invalid' } });
      data.categories = { deleteMany: {}, create: categoryIds.map((categoryId) => ({ categoryId })) };
    }
    return { data: await prisma.business.update({ where: { id }, data, include: { categories: true } }) };
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

  /* -------------------- Bookings / Orders (Phase 1) ------------------- */
  app.post('/api/v1/bookings', { preHandler: roles('CUSTOMER') }, async (q, r) => {
    const d = bookingSchema.parse(q.body);
    const b = await prisma.business.findFirst({ where: { id: d.businessId, status: 'APPROVED' } });
    if (!b) return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Business not found' } });
    if (d.serviceId && !(await prisma.service.findFirst({ where: { id: d.serviceId, businessId: b.id, isActive: true } })))
      return r.status(400).send({ error: { code: 'INVALID_SERVICE', message: 'Service is unavailable' } });
    return r.status(201).send({ data: await prisma.booking.create({ data: { ...d, customerId: currentUser(q).id } }) });
  });

  app.get('/api/v1/bookings', { preHandler: auth }, async (q) => {
    const u = currentUser(q);
    return {
      data:
        u.role === 'BUSINESS_OWNER'
          ? await prisma.booking.findMany({ where: { business: { ownerId: u.id } }, include: { customer: true, service: true } })
          : await prisma.booking.findMany({ where: { customerId: u.id }, include: { business: true, service: true } }),
    };
  });

  app.patch('/api/v1/bookings/:id/status', { preHandler: auth }, async (q, r) => {
    const status = bookingStatusSchema.parse((q.body as { status: string }).status);
    const b = await prisma.booking.findUnique({ where: { id: (q.params as { id: string }).id } });
    if (!b) return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Booking not found' } });
    const u = currentUser(q);
    const businessOwner = await prisma.business.findFirst({ where: { id: b.businessId, ownerId: u.id } });
    const allowed: readonly string[] =
      u.role === 'CUSTOMER' && b.customerId === u.id ? ['CANCELLED'] : businessOwner ? allowedTransitions.booking[b.status] : [];
    if (!allowed.includes(status))
      return r.status(409).send({ error: { code: 'INVALID_TRANSITION', message: 'Status transition is not allowed' } });
    return { data: await prisma.booking.update({ where: { id: b.id }, data: { status } }) };
  });

  app.post('/api/v1/orders', { preHandler: roles('CUSTOMER') }, async (q, r) => {
    const d = orderSchema.parse(q.body);
    const products = await prisma.product.findMany({
      where: { id: { in: d.items.map((i) => i.productId) }, businessId: d.businessId, isActive: true },
    });
    if (products.length !== d.items.length)
      return r.status(400).send({ error: { code: 'INVALID_PRODUCTS', message: 'One or more products are unavailable' } });
    const subtotalMinor = d.items.reduce((sum, i) => sum + products.find((p) => p.id === i.productId)!.priceMinor * i.quantity, 0);
    return r.status(201).send({
      data: await prisma.order.create({
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
        include: { items: true },
      }),
    });
  });

  app.get('/api/v1/orders', { preHandler: auth }, async (q) => {
    const u = currentUser(q);
    return {
      data:
        u.role === 'BUSINESS_OWNER'
          ? await prisma.order.findMany({ where: { business: { ownerId: u.id } }, include: { items: true, customer: true } })
          : await prisma.order.findMany({ where: { customerId: u.id }, include: { items: true, business: true } }),
    };
  });

  app.patch('/api/v1/orders/:id/status', { preHandler: auth }, async (q, r) => {
    const status = orderStatusSchema.parse((q.body as { status: string }).status);
    const o = await prisma.order.findUnique({ where: { id: (q.params as { id: string }).id } });
    if (!o) return r.status(404).send({ error: { code: 'NOT_FOUND', message: 'Order not found' } });
    const u = currentUser(q);
    const owner = await prisma.business.findFirst({ where: { id: o.businessId, ownerId: u.id } });
    const allowed: readonly string[] =
      u.role === 'CUSTOMER' && o.customerId === u.id ? ['CANCELLED'] : owner ? allowedTransitions.order[o.status] : [];
    if (!allowed.includes(status))
      return r.status(409).send({ error: { code: 'INVALID_TRANSITION', message: 'Status transition is not allowed' } });
    return { data: await prisma.order.update({ where: { id: o.id }, data: { status } }) };
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
