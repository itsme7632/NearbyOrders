-- CreateEnum
CREATE TYPE "TrialStatus" AS ENUM ('NOT_ELIGIBLE', 'ELIGIBLE', 'PENDING_REVIEW', 'ACTIVE', 'EXPIRED', 'CONVERTED');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED');

-- CreateEnum
CREATE TYPE "VerificationDocumentStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PromotionRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'ACTIVE', 'EXPIRED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "PaymentMethodType" ADD VALUE 'OTHER';

-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "trialAppliedAt" TIMESTAMP(3),
ADD COLUMN     "trialEligible" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "trialEndsAt" TIMESTAMP(3),
ADD COLUMN     "trialStartedAt" TIMESTAMP(3),
ADD COLUMN     "trialStatus" "TrialStatus" NOT NULL DEFAULT 'NOT_ELIGIBLE';

-- AlterTable
ALTER TABLE "BusinessSubscription" ADD COLUMN     "planNameSnapshot" TEXT,
ADD COLUMN     "planPriceMinorSnapshot" INTEGER;

-- AlterTable
ALTER TABLE "PaymentMethod" ADD COLUMN     "qrImageUrl" TEXT;

-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "benefits" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "billingInterval" TEXT NOT NULL DEFAULT 'monthly',
ADD COLUMN     "displayOrder" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "isHighlighted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "SubscriptionPaymentRequest" ADD COLUMN     "note" TEXT,
ADD COLUMN     "paidAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "VerificationApplication" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "status" "VerificationStatus" NOT NULL DEFAULT 'DRAFT',
    "legalName" TEXT,
    "publicName" TEXT,
    "ownerName" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "city" TEXT,
    "categoryId" TEXT,
    "description" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "registrationInfo" TEXT,
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reviewedByUserId" TEXT,
    "adminNotes" TEXT,
    "reviewerMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerificationApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationDocument" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "status" "VerificationDocumentStatus" NOT NULL DEFAULT 'PENDING',
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "note" TEXT,

    CONSTRAINT "VerificationDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Promotion" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "benefits" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "priceMinor" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'PKR',
    "durationDays" INTEGER,
    "requirements" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Promotion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromotionRequest" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "status" "PromotionRequestStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "reviewerMessage" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromotionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VerificationApplication_businessId_key" ON "VerificationApplication"("businessId");

-- CreateIndex
CREATE INDEX "VerificationApplication_status_submittedAt_idx" ON "VerificationApplication"("status", "submittedAt");

-- CreateIndex
CREATE INDEX "VerificationDocument_applicationId_status_idx" ON "VerificationDocument"("applicationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Promotion_slug_key" ON "Promotion"("slug");

-- CreateIndex
CREATE INDEX "Promotion_isActive_displayOrder_idx" ON "Promotion"("isActive", "displayOrder");

-- CreateIndex
CREATE INDEX "PromotionRequest_businessId_createdAt_idx" ON "PromotionRequest"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "PromotionRequest_status_createdAt_idx" ON "PromotionRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Plan_isActive_displayOrder_idx" ON "Plan"("isActive", "displayOrder");

-- CreateIndex
-- NOTE (phase 18): prisma regenerates the statement below on every `migrate
-- dev` because the schema declares @@index([businessId, isHiddenAt]) while
-- phase15 deliberately created it as a PARTIAL index (public queries always
-- filter `isHiddenAt IS NULL`). The partial index already exists with this
-- exact name on every database that ran phase15, so the plain CREATE INDEX
-- is intentionally omitted here — do not re-add it, or fresh databases will
-- fail with "relation already exists" and the partial optimization is lost.
-- (If a future change really needs a different Review index, drop the
-- partial one explicitly in that migration.)

-- AddForeignKey
ALTER TABLE "VerificationApplication" ADD CONSTRAINT "VerificationApplication_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationApplication" ADD CONSTRAINT "VerificationApplication_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationApplication" ADD CONSTRAINT "VerificationApplication_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationDocument" ADD CONSTRAINT "VerificationDocument_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "VerificationApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionRequest" ADD CONSTRAINT "PromotionRequest_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionRequest" ADD CONSTRAINT "PromotionRequest_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "Promotion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionRequest" ADD CONSTRAINT "PromotionRequest_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
