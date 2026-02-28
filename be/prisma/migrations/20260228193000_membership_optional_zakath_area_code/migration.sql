-- AlterTable
ALTER TABLE "Membership"
ADD COLUMN     "isZakathEligible" BOOLEAN,
ADD COLUMN     "areaCode" INTEGER;

ALTER TABLE "Membership"
ADD CONSTRAINT "Membership_areaCode_check"
CHECK ("areaCode" IS NULL OR ("areaCode" >= 1 AND "areaCode" <= 6));
