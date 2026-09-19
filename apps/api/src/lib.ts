import { PrismaClient, Role, type BookingStatus, type SubscriptionStatus } from '@prisma/client';
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

/** Profile fields a signed-in user may change about themselves. Email is intentionally absent: it is the login identity and has no verification workflow yet. */
export const profileUpdateSchema = z
  .object({
    firstName: z.union([z.string().trim().min(1).max(80), z.literal(''), z.null()]).optional().transform((v) => (v === '' || v === null ? null : v)),
    lastName: z.union([z.string().trim().max(80), z.literal(''), z.null()]).optional().transform((v) => (v === '' || v === null ? null : v)),
    phone: z
      .union([
        z.string().trim().min(7).max(20).regex(/^[+\d][\d\s-]+$/, 'Invalid phone number'),
        z.literal(''),
        z.null(),
      ])
      .optional()
      .transform((v) => (v === '' || v === null ? null : v)),
  })
  .refine((d) => d.firstName !== undefined || d.lastName !== undefined || d.phone !== undefined, {
    message: 'No changes provided',
  });

/**
 * Password change. The current password must be re-proven; the new password
 * meets the same strength bar as registration. Never logged (server redacts
 * `password` fields) and never stored client-side.
 */
export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(12).max(128),
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

/**
 * Shared coordinate validation for location APIs. Reused by the business
 * create/update payloads and the nearby-search query string.
 */
export const latitudeSchema = z
  .number()
  .gte(-90)
  .lte(90)
  .refine((v) => Number.isFinite(v), { message: 'latitude must be finite' });
export const longitudeSchema = z
  .number()
  .gte(-180)
  .lte(180)
  .refine((v) => Number.isFinite(v), { message: 'longitude must be finite' });

const businessCore = {
  name: z.string().min(2).max(120),
  description: optionalText(2000),
  address: z.string().min(5),
  city: z.string().min(2),
  locality: optionalText(100),
  // Optional for self-service onboarding; nullable until the owner configures
  // a real location via the dedicated location screen.
  latitude: latitudeSchema.optional(),
  longitude: longitudeSchema.optional(),
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

export const businessLocationSchema = z
  .object({
    // Coordinates are set or cleared together: null/null clears the location,
    // numbers configure it. The server never invents a location.
    latitude: latitudeSchema.nullable(),
    longitude: longitudeSchema.nullable(),
  })
  .strict()
  .refine((d) => (d.latitude === null) === (d.longitude === null), {
    message: 'latitude and longitude must be set or cleared together',
  });

/**
 * Accepts the documented location-payload shapes: the full object, or a bare
 * JSON `null` as an explicit alias for "clear the location". A missing body
 * (undefined) stays invalid — clearing is always deliberate.
 */
export const locationPutBodySchema = z.union([businessLocationSchema, z.null()]);

export const nearbyBusinessesQuerySchema = z
  .object({
    // Query strings arrive as text — coerce, then range/finite-check.
    lat: z.coerce.number().gte(-90).lte(90).refine((v) => Number.isFinite(v), { message: 'latitude must be finite' }),
    lng: z.coerce.number().gte(-180).lte(180).refine((v) => Number.isFinite(v), { message: 'longitude must be finite' }),
    // 50 km covers metro-scale discovery without inventing cross-country "nearby".
    radiusKm: z.coerce.number().gt(0).lte(50).default(10),
    limit: z.coerce.number().int().gt(0).lte(100).optional(),
  })
  .strict();

/**
 * Unified marketplace search (Phase 14). One endpoint answers "what can I book
 * or buy here?" across businesses, services, and products with a clearly
 * typed result shape. All filters and ordering are server-authoritative:
 * distance is computed server-side over configured coordinates, and every
 * parameter is validated here before it reaches Prisma.
 */
export const searchQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(120).optional(),
    // Authoritative identifiers are category IDs (never names-as-ids).
    categoryId: z.string().uuid().optional(),
    type: z.enum(['all', 'business', 'service', 'product']).default('all'),
    openNow: z.enum(['true', 'false']).optional(),
    minRating: z.coerce.number().gte(0).lte(5).optional(),
    sort: z.enum(['relevance', 'distance', 'rating']).default('relevance'),
    limit: z.coerce.number().int().gt(0).lte(50).default(20),
    cursor: z.string().max(400).optional(),
    // Location is optional: search works fully without it, and distances are
    // only ever computed server-side from these client-supplied coordinates.
    lat: z.coerce.number().gte(-90).lte(90).refine((v) => Number.isFinite(v), { message: 'latitude must be finite' }).optional(),
    lng: z.coerce.number().gte(-180).lte(180).refine((v) => Number.isFinite(v), { message: 'longitude must be finite' }).optional(),
    radiusKm: z.coerce.number().gt(0).lte(50).optional(),
  })
  .strict()
  .refine((v) => (v.lat !== undefined) === (v.lng !== undefined), {
    message: 'latitude and longitude must be provided together',
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
  // Advance requirement (Phase 7C). FIXED needs advanceAmountMinor;
  // PERCENTAGE needs advancePercent (1–100); NONE needs neither. Cross-field
  // rules (fixed ≤ price) are enforced in the route where price is known.
  advanceType: z.enum(['NONE', 'FIXED', 'PERCENTAGE']).optional(),
  advanceAmountMinor: z.number().int().positive().max(99_999_999).optional(),
  advancePercent: z.number().int().min(1).max(100).optional(),
});

/**
 * Validates the advance triplet against the service price. Returns the
 * canonical fields (advanceType + the one relevant value) or an error message.
 * Pure and shared by create/update routes — integer minor units only.
 */
export const resolveServiceAdvance = (
  input: { advanceType?: 'NONE' | 'FIXED' | 'PERCENTAGE'; advanceAmountMinor?: number; advancePercent?: number },
  priceMinor: number,
): { advance: { advanceType: 'NONE' | 'FIXED' | 'PERCENTAGE'; advanceAmountMinor: number | null; advancePercent: number | null } } | { error: string } => {
  const type = input.advanceType ?? 'NONE';
  if (type === 'NONE') {
    if (input.advanceAmountMinor !== undefined || input.advancePercent !== undefined)
      return { error: 'advanceAmountMinor/advancePercent must not be set when advanceType is NONE' };
    return { advance: { advanceType: 'NONE', advanceAmountMinor: null, advancePercent: null } };
  }
  if (type === 'FIXED') {
    const amount = input.advanceAmountMinor;
    if (amount === undefined) return { error: 'FIXED advance requires advanceAmountMinor' };
    if (amount <= 0) return { error: 'FIXED advance must be greater than zero' };
    if (amount > priceMinor) return { error: 'Fixed advance cannot exceed the service price' };
    return { advance: { advanceType: 'FIXED', advanceAmountMinor: amount, advancePercent: null } };
  }
  const percent = input.advancePercent;
  if (percent === undefined) return { error: 'PERCENTAGE advance requires advancePercent' };
  if (percent < 1 || percent > 100) return { error: 'Percentage advance must be between 1 and 100' };
  return { advance: { advanceType: 'PERCENTAGE', advanceAmountMinor: null, advancePercent: percent } };
};

/**
 * The advance a service requires, in integer minor units. PERCENTAGE uses
 * integer math (floor) so no floating point ever touches money; a 17%
 * advance of 99999 minor is 16999 minor, exactly.
 */
export const serviceAdvanceMinor = (s: {
  advanceType: 'NONE' | 'FIXED' | 'PERCENTAGE';
  advanceAmountMinor: number | null;
  advancePercent: number | null;
  priceMinor: number;
}): number => {
  if (s.advanceType === 'FIXED') return s.advanceAmountMinor ?? 0;
  if (s.advanceType === 'PERCENTAGE') return Math.floor((s.priceMinor * (s.advancePercent ?? 0)) / 100);
  return 0;
};

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
  // Optional selected business pay-in channel (manual digital only). Cash
  // flows omit it; the server validates the method belongs to the business
  // and is active. Never a money value — totals stay server-computed.
  paymentMethodId: z.string().uuid().optional(),
  // DELIVERY only (Phase 17): the customer's chosen address snapshot. The
  // server snapshots the address BOOK row the customer owns — the client
  // sends the address id, never free-form text, so placed orders can never
  // carry attacker-controlled delivery text. Pickup/collection orders must
  // not send one.
  deliveryAddressId: z.string().uuid().optional(),
});

/* ------------------------------------------------------------------ */
/* Favorites (Phase 17)                                                */
/* ------------------------------------------------------------------ */

/**
 * Saved (favorite) businesses are a pure toggle: no body, no flags. The
 * business id comes from the URL; ownership of the save is the caller's own
 * account, enforced server-side.
 */
export const favoriteToggleParamsSchema = z.object({ businessId: z.string().uuid() });

/* ------------------------------------------------------------------ */
/* Customer addresses (Phase 17)                                       */
/* ------------------------------------------------------------------ */

/** Optional real-Earth coordinates on a customer address, or none at all. */
export const addressCoordinatesSchema = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  })
  .optional();

/** Customer address create; `isDefault` promotes within the caller's book. */
export const addressCreateSchema = z.object({
  label: z.string().trim().min(1).max(60),
  recipientName: z.string().trim().min(1).max(120),
  phone: z
    .union([
      z.string().trim().min(7).max(20).regex(/^[+\d][\d\s-]+$/, 'Invalid phone number'),
      z.literal(''),
      z.null(),
    ])
    .optional()
    .transform((v) => (v === '' || v === null ? null : v)),
  addressText: z.string().trim().min(5).max(300),
  coordinates: addressCoordinatesSchema,
  // Missing key stays undefined (the server decides the auto-default rule);
  // only an explicit false means "do not make this the default".
  isDefault: z.boolean().optional(),
});

/** Customer address edit — partial; untouched fields stay unchanged. */
export const addressUpdateSchema = z.object({
  label: z.string().trim().min(1).max(60).optional(),
  recipientName: z.string().trim().min(1).max(120).optional(),
  phone: z
    .union([
      z.string().trim().min(7).max(20).regex(/^[+\d][\d\s-]+$/, 'Invalid phone number'),
      z.literal(''),
      z.null(),
    ])
    .optional()
    .transform((v) => (v === '' || v === null ? null : v)),
  addressText: z.string().trim().min(5).max(300).optional(),
  // Replace coordinates, or null to clear them.
  coordinates: z.union([addressCoordinatesSchema, z.literal(null)]).optional(),
  isDefault: z.boolean().optional(),
});

/* ------------------------------------------------------------------ */
/* Reviews (Phase 6)                                                   */
/* ------------------------------------------------------------------ */

/**
 * A review must reference exactly one qualifying transaction: booking XOR
 * order. Rating is a strict integer 1–5 (0, 6, negatives, decimals and
 * non-numeric strings all fail). The comment is optional; when present it is
 * trimmed once and must not be whitespace-only — customer text is never
 * rewritten beyond that.
 */
export const reviewCreateSchema = z
  .object({
    bookingId: z.string().uuid().optional(),
    orderId: z.string().uuid().optional(),
    rating: z.number().int().min(1).max(5),
    comment: z
      .string()
      .max(1000)
      .optional()
      .transform((v) => v?.trim())
      .refine((v) => v === undefined || v.length > 0, {
        message: 'Comment cannot be empty',
      }),
  })
  .refine((v) => Boolean(v.bookingId) !== Boolean(v.orderId), {
    message: 'Exactly one of bookingId or orderId is required',
  });

/* ------------------------------------------------------------------ */
/* Manual subscription payments (Phase 7B)                             */
/* ------------------------------------------------------------------ */

/**
 * Body for creating a manual subscription payment request. The client sends
 * only a payment method, a transaction reference and the receipt's storage
 * key — never an amount, price or currency: the server computes the payable
 * amount from the plan catalog so no client can manipulate the price.
 */
export const paymentRequestCreateSchema = z.object({
  paymentMethodId: z.string().uuid(),
  transactionReference: z
    .string()
    .transform((v) => v.trim())
    .refine((v) => v.length >= 4, { message: 'Transaction reference must be at least 4 characters' })
    .refine((v) => v.length <= 100, { message: 'Transaction reference must be at most 100 characters' }),
  receiptStorageKey: z
    .string()
    .transform((v) => v.trim())
    .refine((v) => v.length >= 1, { message: 'A payment receipt image is required' })
    .refine((v) => v.length <= 512, { message: 'Receipt reference is too long' }),
});

/** Admin payment-method fields for create/edit. Everything but the type is editable later. */
export const paymentMethodSchema = z.object({
  name: z.string().trim().min(2).max(60),
  type: z.enum(['EASYPAISA', 'JAZZCASH', 'BANK_TRANSFER']),
  accountTitle: z.string().trim().min(2).max(120),
  accountNumber: z.string().trim().min(4).max(40),
  iban: z
    .string()
    .trim()
    .max(34)
    .optional()
    .transform((v) => (v === undefined || v === '' ? null : v)),
  instructions: optionalText(1000),
  isActive: z.boolean().optional(),
  displayOrder: z.number().int().min(0).max(1000).optional(),
});

export const paymentMethodUpdateSchema = paymentMethodSchema.partial().refine(
  (data) => Object.keys(data).length > 0,
  { message: 'No changes provided' },
);

/** Admin rejection must carry a meaningful, non-empty reason. */
export const paymentRejectSchema = z.object({
  reason: z
    .string()
    .transform((v) => v.trim())
    .refine((v) => v.length >= 4, { message: 'A rejection reason is required' })
    .refine((v) => v.length <= 500, { message: 'Reason must be at most 500 characters' }),
});

/* ------------------------------------------------------------------ */
/* Customer → business payments (Phase 7C)                             */
/* ------------------------------------------------------------------ */

/** Trimmed transaction reference for manual proofs; empty means "not provided". */
const optionalReference = z
  .string()
  .transform((v) => v.trim())
  .refine((v) => v.length === 0 || v.length >= 4, { message: 'Transaction reference must be at least 4 characters' })
  .refine((v) => v.length <= 100, { message: 'Transaction reference must be at most 100 characters' });

/**
 * Body for submitting a booking payment (advance or outstanding balance).
 * Cash methods skip reference/receipt; manual digital methods require a
 * reference, and the receipt arrives as an opaque storage key from the
 * existing upload endpoint — never a URL the client typed.
 */
export const bookingPaymentCreateSchema = z.object({
  amountMinor: z.number().int().positive().max(99_999_999),
  paymentMethodId: z.string().uuid(),
  transactionReference: optionalReference.optional().default(''),
  receiptStorageKey: z
    .string()
    .trim()
    .max(512)
    .refine((v) => v.length === 0 || /^receipts\//.test(v), { message: 'Invalid receipt reference' })
    .optional()
    .default(''),
});

/** Same shape for order payments (manual digital proof of the order total). */
export const orderPaymentCreateSchema = bookingPaymentCreateSchema;

/** Business rejection of a customer payment — same rule as admin rejection. */
export const customerPaymentRejectSchema = paymentRejectSchema;

/** Owner fields for a business pay-in channel. CASH needs no account details. */
export const businessPaymentMethodSchema = z.object({
  type: z.enum(['CASH', 'EASYPAISA', 'JAZZCASH', 'BANK_TRANSFER', 'OTHER']),
  displayName: z.string().trim().min(2).max(60),
  accountTitle: z.string().trim().min(2).max(120),
  accountNumber: z
    .string()
    .trim()
    .max(40)
    .optional()
    .transform((v) => (v === undefined || v === '' ? null : v)),
  iban: z
    .string()
    .trim()
    .max(34)
    .optional()
    .transform((v) => (v === undefined || v === '' ? null : v)),
  instructions: optionalText(1000),
  isActive: z.boolean().optional(),
  displayOrder: z.number().int().min(0).max(1000).optional(),
});

export const businessPaymentMethodUpdateSchema = businessPaymentMethodSchema.partial().refine(
  (data) => Object.keys(data).length > 0,
  { message: 'No changes provided' },
);

/** Business delivery settings (Phase 7C). Fee is integer minor units. */
export const deliverySettingsSchema = z
  .object({
    deliveryEnabled: z.boolean(),
    codEnabled: z.boolean().optional(),
    deliveryFeeMinor: z.number().int().min(0).max(99_999_999).optional(),
  })
  .refine((d) => !d.deliveryEnabled || (d.deliveryFeeMinor !== undefined && d.deliveryFeeMinor > 0), {
    message: 'Enable delivery with a delivery fee greater than zero',
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
  REVIEW_CREATED: 'REVIEW_CREATED',
  SUBSCRIPTION_PAYMENT_SUBMITTED: 'SUBSCRIPTION_PAYMENT_SUBMITTED',
  SUBSCRIPTION_PAYMENT_APPROVED: 'SUBSCRIPTION_PAYMENT_APPROVED',
  SUBSCRIPTION_PAYMENT_REJECTED: 'SUBSCRIPTION_PAYMENT_REJECTED',
  BOOKING_PAYMENT_SUBMITTED: 'BOOKING_PAYMENT_SUBMITTED',
  BOOKING_PAYMENT_VERIFIED: 'BOOKING_PAYMENT_VERIFIED',
  BOOKING_PAYMENT_REJECTED: 'BOOKING_PAYMENT_REJECTED',
  ORDER_PAYMENT_SUBMITTED: 'ORDER_PAYMENT_SUBMITTED',
  ORDER_PAYMENT_VERIFIED: 'ORDER_PAYMENT_VERIFIED',
  ORDER_PAYMENT_REJECTED: 'ORDER_PAYMENT_REJECTED',
} as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES];

/** Explicit, safe notification input — never a raw domain object. */
export type NotificationInput = {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  entityType: 'Booking' | 'Order' | 'SubscriptionPaymentRequest' | 'BookingPayment' | 'OrderPayment' | 'Review';
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

/**
 * Conservative square around the anchor that fully contains the radius circle
 * (so it never excludes an in-radius business). Powers the SQL prefilter for
 * nearby queries — the exact Haversine distance remains authoritative in JS.
 */
export const boundingBoxKm = (
  lat: number,
  lng: number,
  radiusKm: number,
): { minLat: number; maxLat: number; minLng: number; maxLng: number } => {
  const dLat = radiusKm / 111.045;
  const dLng = radiusKm / (111.045 * Math.max(0.01, Math.cos((lat * Math.PI) / 180)));
  return {
    minLat: lat - dLat,
    maxLat: lat + dLat,
    minLng: lng - dLng,
    maxLng: lng + dLng,
  };
};

/* ------------------------------------------------------------------ */
/* Subscriptions (Phase 7A)                                            */
/* ------------------------------------------------------------------ */

/**
 * The commercial plan catalog. Single source of truth for plan pricing —
 * never hard-code a price (or 299900) anywhere else. The seed and the API's
 * plan-ensure helper upsert these rows idempotently; re-seeding never
 * clobbers admin-edited prices (the update is a no-op).
 */
export const PLAN_CATALOG = [
  {
    slug: 'nearbyorders-business',
    name: 'NearbyOrders Business',
    description: 'Everything a local business needs: appear in search, take bookings and orders, and manage your storefront.',
    monthlyPriceMinor: 299900,
    currency: 'PKR',
    trialDays: 30,
  },
] as const;

/** The subscription states that grant live platform access. */
export const LIVE_SUBSCRIPTION_STATUSES: readonly SubscriptionStatus[] = ['TRIAL', 'ACTIVE'];

/**
 * Adds one calendar month (Phase 7B renewal math). Calendar-accurate: Jan 31
 * + 1 month is Feb 28/29, never Mar 2/3 — so a business paying on the 31st
 * keeps the 31st (or the month's last day) as its renewal anchor.
 */
export const addCalendarMonths = (from: Date, months: number): Date => {
  const year = from.getUTCFullYear();
  const month = from.getUTCMonth() + months;
  // Day 0 of the month after `month` = last day of `month` (clamps 31 → 30/28).
  const lastDayOfTarget = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      year,
      month,
      Math.min(from.getUTCDate(), lastDayOfTarget),
      from.getUTCHours(),
      from.getUTCMinutes(),
      from.getUTCSeconds(),
      from.getUTCMilliseconds(),
    ),
  );
};

/**
 * Server-authoritative access evaluation for one subscription row.
 *
 * Lazy expiry: a TRIAL/ACTIVE row whose `currentPeriodEndAt` has passed is
 * treated as EXPIRED by every caller (and normalized opportunistically in the
 * endpoints). No cron is required for correct reads.
 */
export const evaluateSubscription = (
  row: {
    status: SubscriptionStatus;
    currentPeriodEndAt: Date;
  },
  now: Date = new Date(),
): SubscriptionStatus =>
  LIVE_SUBSCRIPTION_STATUSES.includes(row.status) && row.currentPeriodEndAt.getTime() <= now.getTime()
    ? 'EXPIRED'
    : row.status;

export type AuthUser = { id: string; role: Role };
