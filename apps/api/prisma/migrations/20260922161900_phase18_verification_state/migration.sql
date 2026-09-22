-- CreateEnum
CREATE TYPE "BusinessVerificationState" AS ENUM ('NOT_SUBMITTED', 'PENDING', 'VERIFIED', 'REJECTED');

-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "verificationStatus" "BusinessVerificationState" NOT NULL DEFAULT 'NOT_SUBMITTED',
ADD COLUMN     "verifiedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "BusinessSubscription" ADD COLUMN     "trialEndingNotifiedAt" TIMESTAMP(3);

-- NOTE: intentionally no statement for CustomerAddress.updatedAt here. The
-- Phase 17 migration created that column with DEFAULT CURRENT_TIMESTAMP while
-- the schema declares @updatedAt without a default (pre-existing drift).
-- Dropping the default would not be additive, so it is left untouched: the
-- default never fires because Prisma always writes updatedAt explicitly.

-- NOTE: no CREATE INDEX for Review_businessId_isHiddenAt_idx. The Phase 15
-- migration already created it as a PARTIAL index (WHERE isHiddenAt IS NULL);
-- the schema comment above the @@index documents this intentional drift.
