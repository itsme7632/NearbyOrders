-- Phase 15 (Admin Control Center): review moderation + moderation timestamps.
-- Non-destructive: adds a nullable column and a partial index for public reads.

ALTER TABLE "Review" ADD COLUMN "isHiddenAt" TIMESTAMP(3);

-- Partial index: public queries always filter isHiddenAt = NULL.
CREATE INDEX "Review_businessId_isHiddenAt_idx" ON "Review"("businessId", "isHiddenAt") WHERE "isHiddenAt" IS NULL;
