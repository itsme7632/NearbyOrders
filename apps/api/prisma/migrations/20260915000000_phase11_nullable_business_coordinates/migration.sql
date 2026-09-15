-- Phase 11: business coordinates become optional. A business that has not
-- configured a real location must not carry invented (city-centre) coordinates.
ALTER TABLE "Business" ALTER COLUMN "latitude" DROP NOT NULL;
ALTER TABLE "Business" ALTER COLUMN "longitude" DROP NOT NULL;
