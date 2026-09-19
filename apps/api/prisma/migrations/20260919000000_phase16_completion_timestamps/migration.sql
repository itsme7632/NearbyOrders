-- Phase 16: completion timestamps for honest revenue analytics.
-- Set once when a row reaches COMPLETED; existing completed rows are
-- backfilled from updatedAt (the transition instant, as good an estimate
-- as the data retains). NULL means the row never completed.

ALTER TABLE "Order"   ADD COLUMN "completedAt" TIMESTAMP(3);
ALTER TABLE "Booking" ADD COLUMN "completedAt" TIMESTAMP(3);

UPDATE "Order"   SET "completedAt" = "updatedAt" WHERE status = 'COMPLETED';
UPDATE "Booking" SET "completedAt" = "updatedAt" WHERE status = 'COMPLETED';

CREATE INDEX "Order_businessId_completedAt_idx"   ON "Order"("businessId", "completedAt");
CREATE INDEX "Booking_businessId_completedAt_idx" ON "Booking"("businessId", "completedAt");
