import { buildApp } from '../src/server.js';
import { prisma } from '../src/lib.js';
import type { FastifyInstance } from 'fastify';

/** Boots the real app against the test database (single instance, rebuilt per file). */
export async function makeApp(): Promise<FastifyInstance> {
  const app = await buildApp();
  await app.ready();
  return app;
}

export type TestApp = Awaited<ReturnType<typeof makeApp>>;

let counter = 0;
export const uniqueEmail = (prefix: string): string => `${prefix}-${Date.now()}-${++counter}@test.local`;

const PASSWORD = 'Str0ngPassphrase!42';

/** Registers a user and returns a bearer token plus the user id. */
export async function registerAndLogin(
  app: FastifyInstance,
  role: 'CUSTOMER' | 'BUSINESS_OWNER' = 'CUSTOMER',
): Promise<{ token: string; userId: string }> {
  const email = uniqueEmail(role.toLowerCase());
  const reg = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { email, password: PASSWORD, role },
  });
  if (reg.statusCode !== 201) throw new Error(`register failed: ${reg.body}`);
  return login(app, email);
}

/** Promotes an existing user to ADMIN in the database, then logs them in. */
export async function registerAdminAndLogin(app: FastifyInstance): Promise<{ token: string; userId: string }> {
  const { userId } = await registerAndLogin(app);
  await prisma.user.update({ where: { id: userId }, data: { role: 'ADMIN' } });
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: user.email, password: PASSWORD } });
  return { token: (JSON.parse(login.body).data.accessToken as string), userId };
}

async function login(app: FastifyInstance, email: string): Promise<{ token: string; userId: string }> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: PASSWORD } });
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.body}`);
  const body = JSON.parse(res.body);
  return { token: body.data.accessToken as string, userId: body.data.user.id as string };
}

export const authed = (token: string) => ({ authorization: `Bearer ${token}` });

/**
 * Test fixture category used by createBusiness when no categoryIds are given.
 *
 * Reuses the seeded core category (`food-restaurants`) instead of inventing a
 * new one: a bespoke fixture row ("Helper Category") was referenced by every
 * helper-created business, so the seed prune (which protects referenced
 * categories) kept it and it leaked into the public, customer-facing catalog.
 */
const FIXTURE_CATEGORY_SLUG = 'food-restaurants';
export async function ensureCategory(): Promise<{ id: string; slug: string }> {
  const category = await prisma.category.upsert({
    where: { slug: FIXTURE_CATEGORY_SLUG },
    update: { isActive: true },
    create: { name: 'Food & Restaurants', slug: FIXTURE_CATEGORY_SLUG, isActive: true },
  });
  return { id: category.id, slug: category.slug };
}

/** Creates an owned business for an owner token and returns its id/slug (still PENDING). */
export async function createBusiness(
  app: FastifyInstance,
  token: string,
  overrides: Partial<{ name: string; city: string; description: string; categoryIds: string[] }> = {},
): Promise<{ id: string; slug: string }> {
  const category = await ensureCategory();
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/businesses',
    headers: authed(token),
    payload: {
      name: overrides.name ?? `Test Business ${Date.now()}-${++counter}`,
      description: overrides.description ?? 'Created by test helper',
      address: '1 Test Street',
      city: overrides.city ?? 'Lahore',
      latitude: 31.5204,
      longitude: 74.3587,
      categoryIds: overrides.categoryIds ?? [category.id],
    },
  });
  if (res.statusCode !== 201) throw new Error(`createBusiness failed: ${res.body}`);
  const body = JSON.parse(res.body);
  return { id: body.data.id as string, slug: body.data.slug as string };
}

/** Promotes a business to APPROVED + verified directly in the database (test fixture). */
export async function approveBusiness(businessId: string): Promise<void> {
  await prisma.business.update({ where: { id: businessId }, data: { status: 'APPROVED', isVerified: true } });
}
