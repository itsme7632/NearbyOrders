-- Admin-curated free editorial features (Phase 20).
--
-- EditorialFeature is a FREE placement decided by the editorial/admin team
-- (e.g. "staff_pick"). It is deliberately separate from the paid Promotion
-- monetization lifecycle: it references no Promotion, no PromotionRequest and
-- no payment, so it can never activate or stand in for a paid promotion. A
-- feature is visible while startAt <= now < endAt.

-- CreateTable
CREATE TABLE "EditorialFeature" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "placementType" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EditorialFeature_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EditorialFeature_businessId_endAt_idx" ON "EditorialFeature"("businessId", "endAt");

-- CreateIndex
CREATE INDEX "EditorialFeature_endAt_startAt_idx" ON "EditorialFeature"("endAt", "startAt");

-- AddForeignKey
ALTER TABLE "EditorialFeature" ADD CONSTRAINT "EditorialFeature_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EditorialFeature" ADD CONSTRAINT "EditorialFeature_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
