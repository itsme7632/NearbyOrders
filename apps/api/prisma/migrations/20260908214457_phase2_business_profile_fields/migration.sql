-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "email" TEXT,
ADD COLUMN     "imageUrl" TEXT,
ADD COLUMN     "isVerified" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "imageUrl" TEXT;
