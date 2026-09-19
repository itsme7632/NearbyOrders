-- Phase 17: customer experience completion.

-- Delivery address snapshot on placed orders: later edits to the customer's
-- address book never rewrite history on orders already placed.
ALTER TABLE "Order" ADD COLUMN "deliveryAddressText" TEXT;

-- Customer-saved (favorite) businesses: server-authoritative, unique pair.
CREATE TABLE "FavoriteBusiness" (
    "customerId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FavoriteBusiness_pkey" PRIMARY KEY ("customerId","businessId")
);

CREATE INDEX "FavoriteBusiness_customerId_createdAt_idx" ON "FavoriteBusiness"("customerId", "createdAt");

ALTER TABLE "FavoriteBusiness" ADD CONSTRAINT "FavoriteBusiness_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FavoriteBusiness" ADD CONSTRAINT "FavoriteBusiness_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Customer delivery addresses: at most one DEFAULT per customer.
CREATE TABLE "CustomerAddress" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "recipientName" TEXT NOT NULL,
    "phone" TEXT,
    "addressText" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerAddress_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CustomerAddress_customerId_isDefault_idx" ON "CustomerAddress"("customerId", "isDefault");

ALTER TABLE "CustomerAddress" ADD CONSTRAINT "CustomerAddress_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- At most one default address per customer (partial unique index).
CREATE UNIQUE INDEX "CustomerAddress_customerId_default_key" ON "CustomerAddress"("customerId") WHERE "isDefault";
