import { PrismaClient, Role } from '@prisma/client';
import { z } from 'zod';

export const prisma = new PrismaClient();

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(12).max(128),
  firstName: z.string().min(1).max(80).optional(),
  lastName: z.string().max(80).optional(),
  role: z.enum(['CUSTOMER', 'BUSINESS_OWNER']).optional(),
});

/* ------------------------------------------------------------------ */
/* Shared primitives                                                   */
/* ------------------------------------------------------------------ */

/** Time of day as HH:MM (24h). Seconds intentionally rejected. */
const timeOfDay = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Must be HH:MM (24h)');

const optionalUrl = z
  .string()
  .url()
  .max(500)
  .optional()
  .or(z.literal('').transform(() => undefined));

const phone = z.string().min(7).max(20).regex(/^[+\d][\d\s-]+$/, 'Invalid phone number');

export const slugify = (value: string): string =>
  value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

/* ------------------------------------------------------------------ */
/* Categories                                                          */
/* ------------------------------------------------------------------ */

export const categoryCreateSchema = z.object({
  name: z.string().min(2).max(60),
  slug: z.string().min(2).max(60).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Slug must be lowercase kebab-case').optional(),
  isActive: z.boolean().optional(),
});

export const categoryUpdateSchema = categoryCreateSchema.partial().refine(
  (data) => Object.keys(data).length > 0,
  { message: 'No changes provided' },
);

/* ------------------------------------------------------------------ */
/* Businesses                                                          */
/* ------------------------------------------------------------------ */

const businessCore = {
  name: z.string().min(2).max(120),
  description: z.string().max(2000).optional(),
  address: z.string().min(5),
  city: z.string().min(2),
  locality: z.string().max(100).optional(),
  latitude: z.number().gte(-90).lte(90),
  longitude: z.number().gte(-180).lte(180),
  phone: phone.optional(),
  email: z.string().email().max(120).optional(),
  imageUrl: optionalUrl,
};

export const businessSchema = z.object({
  ...businessCore,
  categoryIds: z.array(z.string().uuid()).min(1),
});

/** Owners may update profile content but never status, verification, slug or ownership. */
export const businessUpdateSchema = z
  .object({
    name: businessCore.name.optional(),
    description: businessCore.description,
    address: businessCore.address.optional(),
    city: businessCore.city.optional(),
    locality: businessCore.locality,
    latitude: businessCore.latitude.optional(),
    longitude: businessCore.longitude.optional(),
    phone: businessCore.phone,
    email: businessCore.email,
    imageUrl: optionalUrl,
    categoryIds: z.array(z.string().uuid()).min(1).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'No changes provided' });

/* ------------------------------------------------------------------ */
/* Services / Products                                                 */
/* ------------------------------------------------------------------ */

const priceMinor = z.number().int().nonnegative().max(99_999_999);

export const serviceSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(1000).optional(),
  priceMinor,
  durationMinutes: z.number().int().positive().max(1440).optional(),
  isActive: z.boolean().optional(),
});

export const serviceUpdateSchema = serviceSchema
  .partial()
  .refine((data) => Object.keys(data).length > 0, { message: 'No changes provided' });

export const productSchema = serviceSchema.omit({ durationMinutes: true }).extend({
  imageUrl: optionalUrl,
});

export const productUpdateSchema = productSchema
  .partial()
  .refine((data) => Object.keys(data).length > 0, { message: 'No changes provided' });

/* ------------------------------------------------------------------ */
/* Business hours                                                      */
/* ------------------------------------------------------------------ */

export const hourEntrySchema = z
  .object({
    dayOfWeek: z.number().int().min(0).max(6),
    isClosed: z.boolean(),
    opensAt: timeOfDay.optional(),
    closesAt: timeOfDay.optional(),
  })
  .refine((d) => d.isClosed || (d.opensAt !== undefined && d.closesAt !== undefined), {
    message: 'Open days require opensAt and closesAt',
  })
  .refine((d) => !d.opensAt || !d.closesAt || d.opensAt < d.closesAt, {
    message: 'opensAt must be earlier than closesAt',
  });

/** Exactly one entry per weekday; days must not repeat. */
export const businessHoursSchema = z
  .array(hourEntrySchema)
  .length(7)
  .refine(
    (days) => new Set(days.map((d) => d.dayOfWeek)).size === 7,
    { message: 'Each day of the week must appear exactly once' },
  );

/* ------------------------------------------------------------------ */
/* Bookings / Orders (Phase 1)                                         */
/* ------------------------------------------------------------------ */

export const bookingSchema = z.object({
  businessId: z.string().uuid(),
  serviceId: z.string().uuid().optional(),
  scheduledAt: z.coerce.date().refine((d) => d > new Date(), 'Must be in the future'),
  notes: z.string().max(1000).optional(),
});

export const orderSchema = z.object({
  businessId: z.string().uuid(),
  items: z
    .array(z.object({ productId: z.string().uuid(), quantity: z.number().int().min(1).max(99) }))
    .min(1),
  notes: z.string().max(1000).optional(),
  fulfillmentType: z.enum(['PICKUP', 'DELIVERY', 'COLLECTION']).default('PICKUP'),
});

/* ------------------------------------------------------------------ */
/* Status transitions                                                  */
/* ------------------------------------------------------------------ */

export const allowedTransitions: {
  booking: Record<string, readonly string[]>;
  order: Record<string, readonly string[]>;
} = {
  booking: {
    PENDING: ['CONFIRMED', 'REJECTED', 'CANCELLED'],
    CONFIRMED: ['COMPLETED', 'CANCELLED'],
    REJECTED: [],
    CANCELLED: [],
    COMPLETED: [],
  },
  order: {
    PENDING: ['ACCEPTED', 'REJECTED', 'CANCELLED'],
    ACCEPTED: ['PREPARING', 'READY', 'COMPLETED', 'CANCELLED'],
    REJECTED: [],
    PREPARING: ['READY', 'COMPLETED', 'CANCELLED'],
    READY: ['COMPLETED', 'CANCELLED'],
    COMPLETED: [],
    CANCELLED: [],
  },
};

/* ------------------------------------------------------------------ */
/* Status enums for route validation                                   */
/* ------------------------------------------------------------------ */

export const businessStatusSchema = z.enum(['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED', 'ARCHIVED']);
export const bookingStatusSchema = z.enum(['PENDING', 'CONFIRMED', 'REJECTED', 'CANCELLED', 'COMPLETED']);
export const orderStatusSchema = z.enum(['PENDING', 'ACCEPTED', 'REJECTED', 'PREPARING', 'READY', 'COMPLETED', 'CANCELLED']);

/* ------------------------------------------------------------------ */
/* Opening-hours helper (server-local timezone approximation)          */
/* ------------------------------------------------------------------ */

const minutesOfDay = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** True when `now` falls inside the provided opening-hours rows. */
export const isOpenNow = (
  hours: readonly { dayOfWeek: number; isClosed: boolean; opensAt: string | null; closesAt: string | null }[],
  now: Date = new Date(),
): boolean => {
  const today = hours.find((h) => h.dayOfWeek === now.getDay());
  if (!today || today.isClosed || !today.opensAt || !today.closesAt) return false;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  return minutesOfDay(today.opensAt) <= nowMinutes && nowMinutes < minutesOfDay(today.closesAt);
};

/* ------------------------------------------------------------------ */
/* Nearby search (Haversine, km — no external maps provider)           */
/* ------------------------------------------------------------------ */

export const distanceKm = (
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number => {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
};

export type AuthUser = { id: string; role: Role };
