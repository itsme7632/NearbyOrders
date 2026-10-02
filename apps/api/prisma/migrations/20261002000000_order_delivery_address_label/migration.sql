-- Snapshot the address-book label on DELIVERY orders.
-- Additive only: existing orders remain valid with a NULL label.
ALTER TABLE "Order" ADD COLUMN "deliveryAddressLabel" TEXT;
