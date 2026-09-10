import { PrismaClient, Role, type BookingStatus } from '@prisma/client';
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

/**
 * Optional string field that also accepts an empty string or null (a cleared
 * form input) and normalizes it to undefined. Mobile forms keep controlled
 * inputs as strings, so "cleared" arrives as "" — and clearing to null must
 * remain expressible so owners can remove an optional value again.
 */
const optionalText = (max: number) =>
  z
    .union([z.string().max(max), z.literal(''), z.null()])
    .optional()
    .transform((v) => (v === null || v === '' ? undefined : v));

const optionalEmail = z
  .union([z.string().email().max(120), z.literal(''), z.null()])
  .optional()
  .transform((v) => (v === null || v === '' ? undefined : v));

const optionalUrl = z
  .union([z.string().url().max(500), z.literal(''), z.null()])
  .optional()
  .transform((v) => (v === null || v === '' ? undefined : v));

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
  description: optionalText(2000),
  address: z.string().min(5),
  city: z.string().min(2),
  locality: optionalText(100),
  // Optional for self-service onboarding; the create handler applies a
  // city-centre fallback so the not-null schema contract stays intact.
  latitude: z.number().gte(-90).lte(90).optional(),
  longitude: z.number().gte(-180).lte(180).optional(),
  phone: z
    .union([phone, z.literal(''), z.null()])
    .optional()
    .transform((v) => (v === null || v === '' ? undefined : v)),
  email: optionalEmail,
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
    // Cleared optional fields arrive as null/'' from the profile form and must
    // normalize to undefined (i.e. "no value"), not fail validation.
    phone: z
      .union([phone, z.literal(''), z.null()])
      .optional()
      .transform((v) => (v === null || v === '' ? undefined : v)),
    email: optionalEmail,
    imageUrl: optionalUrl,
    categoryIds: z.array(z.string().uuid()).min(1).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'No changes provided' });

/* ------------------------------------------------------------------ */
/* Services / Products                                                 */
/* ------------------------------------------------------------------ */

const priceMinor = z.number().int().nonnegative().max(99_999_999);

export const serviceSchema = z.object({
  // Trim so padded input ("  X  ") never stores display-breaking whitespace;
  // the mobile client trims too, this is the authoritative backstop.
  name: z.string().trim().min(2).max(120),
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
/* Bookings (Phase 3A)                                                 */
/* ------------------------------------------------------------------ */

/**
 * Time-storage strategy (detailed in docs/bookings.md):
 * - `Booking.startAt` / `Booking.endAt` store absolute UTC instants.
 * - `Booking.bookingDate` stores the business-local (Asia/Karachi) calendar
 *   date, so availability queries filter by the customer's local day.
 * - Pakistan has no DST, so local wall-clock time is a fixed UTC+05:00
 *   offset. Conversions below are exact and never depend on server TZ.
 */
export const BUSINESS_TZ_OFFSET_MINUTES = 300; // UTC+05:00 (Asia/Karachi, no DST)

/** Formats minutes-since-midnight as HH:MM. */
export const formatMinutes = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** Calendar date (YYYY-MM-DD) of a UTC instant, in business-local time. */
export const pktDateOf = (instant: Date): string =>
  new Date(instant.getTime() + BUSINESS_TZ_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);

/** Minutes-since-midnight (0–1439) of a UTC instant, in business-local time. */
export const pktMinutesOf = (instant: Date): number => {
  const shifted = new Date(instant.getTime() + BUSINESS_TZ_OFFSET_MINUTES * 60_000);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
};

/** Day of week (0=Sunday) of a UTC instant, in business-local time. */
export const pktDayOfWeek = (instant: Date): number =>
  new Date(Date.parse(`${pktDateOf(instant)}T00:00:00Z`)).getUTCDay();

/** Converts a business-local wall clock (date + minutes) to a UTC instant. */
export const pktToUtc = (date: string, minutes: number): Date =>
  new Date(Date.parse(`${date}T00:00:00Z`) + (minutes - BUSINESS_TZ_OFFSET_MINUTES) * 60_000);

/** Inclusive [from, to) UTC instants covering one business-local calendar date. */
export const pktDayWindowUtc = (date: string): { from: Date; to: Date } => ({
  from: pktToUtc(date, 0),
  to: pktToUtc(date, 24 * 60),
});

/** Round-trip-validated calendar date; rejects impossible dates like 02-30. */
export const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD')
  .refine((d) => {
    const parsed = Date.parse(`${d}T00:00:00Z`);
    return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === d;
  }, { message: 'Must be a real calendar date' });

/** Customer-visible booking creation: the server derives everything else. */
export const bookingCreateSchema = z.object({
  businessId: z.string().uuid(),
  serviceId: z.string().uuid(),
  date: calendarDate,
  startTime: timeOfDay,
  notes: z.string().max(1000).optional(),
});

export const availabilityQuerySchema = z.object({ date: calendarDate });

/** Booking statuses that occupy a time slot; REJECTED/CANCELLED never block. */
export const BLOCKING_BOOKING_STATUSES: readonly BookingStatus[] = ['PENDING', 'CONFIRMED'];

/** True when the half-open intervals [aStart,aEnd) and [bStart,bEnd) overlap. */
export const overlaps = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean =>
  aStart < bEnd && bStart < aEnd;

/**
 * Generates duration-aligned candidate slots for one open business day:
 * slots step by `durationMinutes` from opening time and must fit entirely
 * inside [opensAt, closesAt). Pure; overlap filtering happens separately.
 */
export const generateSlots = (
  hours: { opensAt: string; closesAt: string },
  durationMinutes: number,
): { startMinutes: number; endMinutes: number }[] => {
  const open = minutesOfDay(hours.opensAt);
  const close = minutesOfDay(hours.closesAt);
  const slots: { startMinutes: number; endMinutes: number }[] = [];
  for (let start = open; start + durationMinutes <= close; start += durationMinutes) {
    slots.push({ startMinutes: start, endMinutes: start + durationMinutes });
  }
  return slots;
};

export const orderSchema = z.object({
  businessId: z.string().uuid(),
  items: z
    .array(z.object({ productId: z.string().uuid(), quantity: z.number().int().min(1).max(99) }))
    .min(1),
  notes: z.string().max(1000).optional(),
  fulfillmentType: z.enum(['PICKUP', 'DELIVERY', 'COLLECTION']).default('PICKUP'),
});

/* ------------------------------------------------------------------ */
/* Notifications (Phase 5 foundation)                                  */
/* ------------------------------------------------------------------ */

/**
 * Controlled notification event types. Only events the platform actually
 * produces; extend this map when new business events exist.
 */
export const NOTIFICATION_TYPES = {
  BOOKING_CREATED: 'BOOKING_CREATED',
  BOOKING_ACCEPTED: 'BOOKING_ACCEPTED',
  BOOKING_REJECTED: 'BOOKING_REJECTED',
  BOOKING_CANCELLED: 'BOOKING_CANCELLED',
  BOOKING_COMPLETED: 'BOOKING_COMPLETED',
  ORDER_CREATED: 'ORDER_CREATED',
  ORDER_ACCEPTED: 'ORDER_ACCEPTED',
  ORDER_REJECTED: 'ORDER_REJECTED',
  ORDER_PREPARING: 'ORDER_PREPARING',
  ORDER_READY: 'ORDER_READY',
  ORDER_COMPLETED: 'ORDER_COMPLETED',
  ORDER_CANCELLED: 'ORDER_CANCELLED',
} as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES];

/** Explicit, safe notification input — never a raw domain object. */
export type NotificationInput = {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  entityType: 'Booking' | 'Order';
  entityId: string;
};

/**
 * The delivery-channel contract. Phase 5 ships the in-app channel only;
 * push/email/SMS/WhatsApp providers can be registered later without touching
 * any business logic — they just implement this interface.
 */
export interface NotificationChannelProvider {
  readonly name: string;
  deliver(notifications: NotificationInput[]): Promise<void>;
}

/**
 * In-app channel: persists notifications. Duplicate protection comes from the
 * (userId, type, entityId) unique index — a retried business event with the
 * same key can never create a second row (skipDuplicates makes it idempotent).
 */
export class InAppNotificationProvider implements NotificationChannelProvider {
  readonly name = 'in-app';

  // eslint-disable-next-line no-explicit-any
  constructor(private readonly client: any) {}

  async deliver(notifications: NotificationInput[]): Promise<void> {
    if (notifications.length === 0) return;
    await this.client.notification.createMany({
      data: notifications.map((n) => ({
        userId: n.userId,
        type: n.type,
        title: n.title,
        message: n.message,
        entityType: n.entityType,
        entityId: n.entityId,
      })),
      // Unique (userId, type, entityId): replays are silently ignored.
      skipDuplicates: true,
    });
  }
}

/**
 * Creates notifications for the successful business event. Returns a promise:
 * - Inside a transaction (pass the `tx` client): callers MUST `await` it so the
 *   rows commit or roll back together with the business change.
 * - Outside one (root client): callers may `void` it — delivery failures are
 *   swallowed and never break the business operation.
 */
export async function createNotifications(
  // eslint-disable-next-line no-explicit-any
  rootClient: any,
  inputs: NotificationInput[],
  // eslint-disable-next-line no-explicit-any
  txClient?: any,
): Promise<void> {
  if (inputs.length === 0) return;
  const provider = new InAppNotificationProvider(txClient ?? rootClient);
  if (txClient) {
    // Transactional: surface failures so the business operation rolls back too.
    await provider.deliver(inputs);
  } else {
    // Standalone: never let notification problems break the business event.
    await provider.deliver(inputs).catch(() => undefined);
  }
}

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

/** Booking list filters (customer and owner endpoints). */
export const bookingListQuerySchema = z
  .object({
    status: bookingStatusSchema.optional(),
    from: calendarDate.optional(),
    to: calendarDate.optional(),
  });

/* ------------------------------------------------------------------ */
/* Opening-hours helper (business-local time, Asia/Karachi)            */
/* ------------------------------------------------------------------ */

/** Parses HH:MM into minutes-since-midnight. */
export const minutesOfDay = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** True when `now` falls inside the provided opening-hours rows (PKT wall clock). */
export const isOpenNow = (
  hours: readonly { dayOfWeek: number; isClosed: boolean; opensAt: string | null; closesAt: string | null }[],
  now: Date = new Date(),
): boolean => {
  const today = hours.find((h) => h.dayOfWeek === pktDayOfWeek(now));
  if (!today || today.isClosed || !today.opensAt || !today.closesAt) return false;
  const nowMinutes = pktMinutesOf(now);
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
