-- CreateEnum
CREATE TYPE "ServiceAdvanceType" AS ENUM ('NONE', 'FIXED', 'PERCENTAGE');

-- CreateEnum
CREATE TYPE "CustomerPaymentMethodType" AS ENUM ('CASH', 'EASYPAISA', 'JAZZCASH', 'BANK_TRANSFER', 'OTHER');

-- CreateEnum
CREATE TYPE "CustomerPaymentStatus" AS ENUM ('UNPAID', 'PENDING_VERIFICATION', 'PAID', 'FAILED');

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "advanceRequiredMinor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "amountPaidMinor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "servicePriceMinor" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "codEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "deliveryEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "deliveryFeeMinor" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "deliveryFeeMinor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "paymentMethodId" TEXT,
ADD COLUMN     "totalMinor" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Service" ADD COLUMN     "advanceAmountMinor" INTEGER,
ADD COLUMN     "advancePercent" INTEGER,
ADD COLUMN     "advanceType" "ServiceAdvanceType" NOT NULL DEFAULT 'NONE';

-- CreateTable
CREATE TABLE "BusinessPaymentMethod" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "type" "CustomerPaymentMethodType" NOT NULL,
    "displayName" TEXT NOT NULL,
    "accountTitle" TEXT NOT NULL,
    "accountNumber" TEXT,
    "iban" TEXT,
    "instructions" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessPaymentMethod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingPayment" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'PKR',
    "paymentMethodId" TEXT,
    "status" "CustomerPaymentStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "transactionReference" TEXT,
    "receiptStorageKey" TEXT,
    "rejectionReason" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3),
    "verifiedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BookingPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderPayment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'PKR',
    "method" "CustomerPaymentMethodType" NOT NULL,
    "paymentMethodId" TEXT,
    "status" "CustomerPaymentStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "transactionReference" TEXT,
    "receiptStorageKey" TEXT,
    "rejectionReason" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3),
    "verifiedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BusinessPaymentMethod_businessId_isActive_displayOrder_idx" ON "BusinessPaymentMethod"("businessId", "isActive", "displayOrder");

-- CreateIndex
CREATE INDEX "BookingPayment_businessId_status_submittedAt_idx" ON "BookingPayment"("businessId", "status", "submittedAt");

-- CreateIndex
CREATE INDEX "BookingPayment_bookingId_submittedAt_idx" ON "BookingPayment"("bookingId", "submittedAt");

-- CreateIndex
CREATE INDEX "BookingPayment_customerId_createdAt_idx" ON "BookingPayment"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "OrderPayment_businessId_status_submittedAt_idx" ON "OrderPayment"("businessId", "status", "submittedAt");

-- CreateIndex
CREATE INDEX "OrderPayment_orderId_submittedAt_idx" ON "OrderPayment"("orderId", "submittedAt");

-- CreateIndex
CREATE INDEX "OrderPayment_customerId_createdAt_idx" ON "OrderPayment"("customerId", "createdAt");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "BusinessPaymentMethod"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessPaymentMethod" ADD CONSTRAINT "BusinessPaymentMethod_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingPayment" ADD CONSTRAINT "BookingPayment_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingPayment" ADD CONSTRAINT "BookingPayment_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingPayment" ADD CONSTRAINT "BookingPayment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingPayment" ADD CONSTRAINT "BookingPayment_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "BusinessPaymentMethod"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingPayment" ADD CONSTRAINT "BookingPayment_verifiedByUserId_fkey" FOREIGN KEY ("verifiedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderPayment" ADD CONSTRAINT "OrderPayment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderPayment" ADD CONSTRAINT "OrderPayment_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderPayment" ADD CONSTRAINT "OrderPayment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderPayment" ADD CONSTRAINT "OrderPayment_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "BusinessPaymentMethod"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderPayment" ADD CONSTRAINT "OrderPayment_verifiedByUserId_fkey" FOREIGN KEY ("verifiedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
