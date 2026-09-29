-- Rider + delivery lifecycle + multi-service bookings.
--
-- Additive only. No columns are dropped, no tables are renamed, no data is
-- deleted. All new columns are nullable or carry defaults, so existing rows
-- remain valid without a backfill for the additive parts.
--
-- The BookingServiceItem backfill below is deterministic and idempotent:
-- it inserts exactly one item per existing booking that has a serviceId,
-- snapshotting the service name, the booking's frozen price, and the
-- service duration. Bookings without a serviceId (legacy no-service rows)
-- are left untouched.

-- pgcrypto provides gen_random_uuid() for the backfill INSERT below.
-- IF NOT EXISTS makes this safe on databases that already have it.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- New enum values for the delivery lifecycle. Existing values are untouched.
ALTER TYPE "OrderStatus" ADD VALUE 'OUT_FOR_DELIVERY';
ALTER TYPE "OrderStatus" ADD VALUE 'DELIVERED';

-- Rider: owner-managed delivery riders (no login).
CREATE TABLE "Rider" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "photoUrl" TEXT,
    "note" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Rider_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Rider_businessId_isActive_idx" ON "Rider"("businessId", "isActive");

ALTER TABLE "Rider" ADD CONSTRAINT "Rider_businessId_fkey"
    FOREIGN KEY ("businessId") REFERENCES "Business"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Order rider assignment. SetNull on rider delete preserves order history.
ALTER TABLE "Order" ADD COLUMN "assignedRiderId" TEXT;
ALTER TABLE "Order" ADD COLUMN "riderAssignedAt" TIMESTAMP(3);

ALTER TABLE "Order" ADD CONSTRAINT "Order_assignedRiderId_fkey"
    FOREIGN KEY ("assignedRiderId") REFERENCES "Rider"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Booking: combined duration for multi-service bookings.
ALTER TABLE "Booking" ADD COLUMN "totalDurationMinutes" INTEGER;

-- BookingServiceItem: per-service snapshots within a booking.
CREATE TABLE "BookingServiceItem" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "serviceId" TEXT,
    "name" TEXT NOT NULL,
    "priceMinor" INTEGER NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingServiceItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BookingServiceItem_bookingId_idx" ON "BookingServiceItem"("bookingId");

ALTER TABLE "BookingServiceItem" ADD CONSTRAINT "BookingServiceItem_bookingId_fkey"
    FOREIGN KEY ("bookingId") REFERENCES "Booking"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BookingServiceItem" ADD CONSTRAINT "BookingServiceItem_serviceId_fkey"
    FOREIGN KEY ("serviceId") REFERENCES "Service"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: one BookingServiceItem per existing booking with a serviceId.
-- Snapshots the service name, the booking's frozen servicePriceMinor, and
-- the service's durationMinutes (0 if the service had none — the booking's
-- startAt/endAt remain the authoritative window for legacy rows).
-- Idempotent: the NOT EXISTS guard makes re-runs a no-op.
INSERT INTO "BookingServiceItem" ("id", "bookingId", "serviceId", "name", "priceMinor", "durationMinutes", "createdAt")
SELECT
    gen_random_uuid(),
    b."id",
    b."serviceId",
    COALESCE(s."name", 'Service'),
    b."servicePriceMinor",
    COALESCE(s."durationMinutes", 0),
    b."createdAt"
FROM "Booking" b
LEFT JOIN "Service" s ON s."id" = b."serviceId"
WHERE b."serviceId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "BookingServiceItem" i WHERE i."bookingId" = b."id"
  );

-- Backfill totalDurationMinutes for existing bookings from their items.
-- Legacy single-service bookings get their service duration; bookings
-- without items keep NULL (their startAt/endAt remain authoritative).
UPDATE "Booking" b
SET "totalDurationMinutes" = sub.total
FROM (
    SELECT "bookingId", SUM("durationMinutes") AS total
    FROM "BookingServiceItem"
    GROUP BY "bookingId"
) sub
WHERE b."id" = sub."bookingId"
  AND b."totalDurationMinutes" IS NULL;
