ALTER TABLE "PaymentDue"
ADD COLUMN "isManual" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "reason" TEXT,
ADD COLUMN "periodStart" TIMESTAMP(3),
ADD COLUMN "periodEnd" TIMESTAMP(3);

DROP INDEX IF EXISTS "PaymentDue_membershipId_period_key";

CREATE INDEX IF NOT EXISTS "PaymentDue_membershipId_period_idx"
ON "PaymentDue"("membershipId", "period");
