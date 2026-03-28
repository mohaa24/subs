ALTER TABLE "Person"
ADD COLUMN "areaCode" INTEGER;

ALTER TABLE "Person"
ADD CONSTRAINT "Person_areaCode_check"
CHECK ("areaCode" IS NULL OR "areaCode" >= 1);
