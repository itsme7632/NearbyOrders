-- Phase 7B: manual subscription payments.
-- PaymentMethod: admin-managed manual pay-in channels (Easypaisa / JazzCash /
-- bank transfer). SubscriptionPaymentRequest: business-submitted payment proof
-- reviewed by an admin before a subscription becomes ACTIVE.

-- CreateEnum
CREATE TYPE "PaymentMethodType" AS ENUM ('EASYPAISA', 'JAZZCASH', 'BANK_TRANSFER');

-- CreateEnum
CREATE TYPE "PaymentRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "PaymentMethod" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "PaymentMethodType" NOT NULL,
    "accountTitle" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "iban" TEXT,
    "instructions" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentMethod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionPaymentRequest" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "paymentMethodId" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'PKR',
    "transactionReference" TEXT NOT NULL,
    "receiptStorageKey" TEXT NOT NULL,
    "status" "PaymentRequestStatus" NOT NULL DEFAULT 'PENDING',
    "rejectionReason" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionPaymentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentMethod_isActive_displayOrder_idx" ON "PaymentMethod"("isActive", "displayOrder");

-- CreateIndex
CREATE INDEX "SubscriptionPaymentRequest_businessId_submittedAt_idx" ON "SubscriptionPaymentRequest"("businessId", "submittedAt");

-- CreateIndex
CREATE INDEX "SubscriptionPaymentRequest_status_submittedAt_idx" ON "SubscriptionPaymentRequest"("status", "submittedAt");

-- CreateIndex
CREATE INDEX "SubscriptionPaymentRequest_transactionReference_idx" ON "SubscriptionPaymentRequest"("transactionReference");

-- CreateIndex
CREATE INDEX "SubscriptionPaymentRequest_subscriptionId_idx" ON "SubscriptionPaymentRequest"("subscriptionId");

-- AddForeignKey
ALTER TABLE "SubscriptionPaymentRequest" ADD CONSTRAINT "SubscriptionPaymentRequest_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionPaymentRequest" ADD CONSTRAINT "SubscriptionPaymentRequest_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "BusinessSubscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionPaymentRequest" ADD CONSTRAINT "SubscriptionPaymentRequest_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "PaymentMethod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionPaymentRequest" ADD CONSTRAINT "SubscriptionPaymentRequest_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
