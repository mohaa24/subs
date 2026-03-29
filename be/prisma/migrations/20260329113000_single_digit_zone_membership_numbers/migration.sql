UPDATE "Zone"
SET "isActive" = TRUE,
    "updatedAt" = NOW()
WHERE "code" = 9
  AND "isActive" = FALSE;

INSERT INTO "Zone" ("id", "organizationId", "name", "code", "isActive", "createdAt", "updatedAt")
SELECT
  'zone9_auto_' || "id",
  "id",
  'Zone 9',
  9,
  TRUE,
  NOW(),
  NOW()
FROM "Organization"
WHERE NOT EXISTS (
  SELECT 1
  FROM "Zone"
  WHERE "Zone"."organizationId" = "Organization"."id"
    AND "Zone"."code" = 9
);

UPDATE "Membership"
SET "areaCode" = 9
WHERE "areaCode" BETWEEN 10 AND 24;

UPDATE "Person"
SET "areaCode" = 9
WHERE "areaCode" BETWEEN 10 AND 24;

DELETE FROM "Zone"
WHERE "code" BETWEEN 10 AND 24;

ALTER TABLE "Zone"
DROP CONSTRAINT IF EXISTS "Zone_code_check";

ALTER TABLE "Zone"
ADD CONSTRAINT "Zone_code_check"
CHECK ("code" BETWEEN 1 AND 9);

ALTER TABLE "Membership"
DROP CONSTRAINT IF EXISTS "Membership_areaCode_check";

ALTER TABLE "Membership"
ADD CONSTRAINT "Membership_areaCode_check"
CHECK ("areaCode" IS NULL OR "areaCode" BETWEEN 1 AND 9);

ALTER TABLE "Person"
DROP CONSTRAINT IF EXISTS "Person_areaCode_check";

ALTER TABLE "Person"
ADD CONSTRAINT "Person_areaCode_check"
CHECK ("areaCode" IS NULL OR "areaCode" BETWEEN 1 AND 9);
