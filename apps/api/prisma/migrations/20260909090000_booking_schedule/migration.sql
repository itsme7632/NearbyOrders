-- Phase 3A: real booking schedule on Booking.
-- startAt/endAt are UTC instants (Prisma timestamp(3)); bookingDate is the
-- business-local (Asia/Karachi) calendar date for date-based availability
-- queries. endAt is backfilled from startAt for pre-Phase-3A rows, which
-- carried no duration. Non-destructive: no rows are dropped.
ALTER TABLE "Booking" RENAME COLUMN "scheduledAt" TO "startAt";

-- CreateTable-like additions
ALTER TABLE "Booking" ADD COLUMN "bookingDate" DATE;
ALTER TABLE "Booking" ADD COLUMN "endAt" TIMESTAMP(3);

-- Backfill: bookingDate = PKT calendar date of the stored UTC instant.
UPDATE "Booking" SET
  "bookingDate" = ("startAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Karachi',
  "endAt" = "startAt";

ALTER TABLE "Booking" ALTER COLUMN "bookingDate" SET NOT NULL;
ALTER TABLE "Booking" ALTER COLUMN "endAt" SET NOT NULL;

-- CreateIndex
CREATE INDEX "Booking_businessId_bookingDate_idx" ON "Booking"("businessId", "bookingDate");
