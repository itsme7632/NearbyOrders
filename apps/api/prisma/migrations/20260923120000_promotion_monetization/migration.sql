-- Promotion monetization lifecycle (Phase 19).
--
-- Adds server-authoritative activation dates to PromotionRequest and a new
-- PromotionPaymentRequest table mirroring SubscriptionPaymentRequest: manual
-- promotion payments are verified by an admin, and only payment approval
-- (never application approval alone) activates a PAID promotion. A
-- zero-price promotion activates directly on application approval.
--
-- The lifecycle is:
--   PENDING (application) -> APPROVED (payment required, paid only)
--     -> payment PENDING -> payment APPROVED -> ACTIVE (dates set)
--     -> EXPIRED (server-side transition on access, never client-driven)
-- Rejection is possible at the application and payment stages.

-- AlterTable
ALTER TABLE "PromotionRequest" ADD COLUMN "activatedAt" TIMESTAMP(3),
ADD COLUMN "expiresAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PromotionPaymentRequest" (
    "id" TEXT NOT NULL,
    "promotionRequestId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "paymentMethodId" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'PKR',
    "transactionReference" TEXT NOT NULL,
    "receiptStorageKey" TEXT NOT NULL,
    "status" "PaymentRequestStatus" NOT NULL DEFAULT 'PENDING',
    "rejectionReason" TEXT,
    "paidAt" TIMESTAMP(3),
    "note" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromotionPaymentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PromotionPaymentRequest_promotionRequestId_submittedAt_idx" ON "PromotionPaymentRequest"("promotionRequestId", "submittedAt");

-- CreateIndex
CREATE INDEX "PromotionPaymentRequest_businessId_submittedAt_idx" ON "PromotionPaymentRequest"("businessId", "submittedAt");

-- CreateIndex
CREATE INDEX "PromotionPaymentRequest_status_submittedAt_idx" ON "PromotionPaymentRequest"("status", "submittedAt");

-- CreateIndex
CREATE INDEX "PromotionPaymentRequest_transactionReference_idx" ON "PromotionPaymentRequest"("transactionReference");

-- CreateIndex
CREATE INDEX "PromotionRequest_status_expiresAt_idx" ON "PromotionRequest"("status", "expiresAt");

-- AddForeignKey
ALTER TABLE "PromotionPaymentRequest" ADD CONSTRAINT "PromotionPaymentRequest_promotionRequestId_fkey" FOREIGN KEY ("promotionRequestId") REFERENCES "PromotionRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionPaymentRequest" ADD CONSTRAINT "PromotionPaymentRequest_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionPaymentRequest" ADD CONSTRAINT "PromotionPaymentRequest_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "PaymentMethod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionPaymentRequest" ADD CONSTRAINT "PromotionPaymentRequest_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
