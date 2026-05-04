CREATE TABLE "DueType" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "systemKey" TEXT,
  "autoAllocate" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DueType_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DueType_organizationId_name_key" ON "DueType"("organizationId", "name");
CREATE UNIQUE INDEX "DueType_organizationId_systemKey_key" ON "DueType"("organizationId", "systemKey");

ALTER TABLE "DueType"
ADD CONSTRAINT "DueType_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "DueType" (
  "id",
  "organizationId",
  "name",
  "systemKey",
  "autoAllocate",
  "isActive",
  "sortOrder",
  "createdAt",
  "updatedAt"
)
SELECT
  'dt_' || md5(o."id" || def."systemKey"),
  o."id",
  def."name",
  def."systemKey",
  def."autoAllocate",
  true,
  def."sortOrder",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Organization" o
CROSS JOIN (
  VALUES
    ('Subscription', 'subscription', true, 0),
    ('Shramadana', 'shramadana', false, 1),
    ('Mahasabha', 'mahasabha', false, 2),
    ('Taraweeh', 'taraweeh', true, 3),
    ('Other', 'other', false, 4)
) AS def("name", "systemKey", "autoAllocate", "sortOrder")
ON CONFLICT ("organizationId", "systemKey") DO NOTHING;

ALTER TABLE "PaymentDue"
ADD COLUMN "dueTypeId" TEXT;

UPDATE "PaymentDue" pd
SET "dueTypeId" = dt."id"
FROM "DueType" dt
WHERE dt."organizationId" = pd."organizationId"
  AND dt."systemKey" = CASE
    WHEN pd."isManual" = false THEN 'subscription'
    ELSE 'other'
  END;

ALTER TABLE "PaymentDue"
ALTER COLUMN "dueTypeId" SET NOT NULL;

ALTER TABLE "PaymentDue"
ADD CONSTRAINT "PaymentDue_dueTypeId_fkey"
FOREIGN KEY ("dueTypeId") REFERENCES "DueType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "PaymentDue_dueTypeId_dueDate_idx" ON "PaymentDue"("dueTypeId", "dueDate");
