CREATE TYPE "PaymentDueAdjustmentType" AS ENUM ('due_edit', 'late_fee');

CREATE TABLE "PaymentDueAdjustment" (
  "id" TEXT NOT NULL,
  "paymentDueId" TEXT NOT NULL,
  "membershipId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "amountDelta" DECIMAL(12,2) NOT NULL,
  "adjustmentType" "PaymentDueAdjustmentType" NOT NULL,
  "reason" TEXT,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PaymentDueAdjustment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PaymentDueAdjustment_paymentDueId_createdAt_idx" ON "PaymentDueAdjustment"("paymentDueId", "createdAt");
CREATE INDEX "PaymentDueAdjustment_membershipId_createdAt_idx" ON "PaymentDueAdjustment"("membershipId", "createdAt");
CREATE INDEX "PaymentDueAdjustment_organizationId_createdAt_idx" ON "PaymentDueAdjustment"("organizationId", "createdAt");

ALTER TABLE "PaymentDueAdjustment"
ADD CONSTRAINT "PaymentDueAdjustment_paymentDueId_fkey"
FOREIGN KEY ("paymentDueId") REFERENCES "PaymentDue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PaymentDueAdjustment"
ADD CONSTRAINT "PaymentDueAdjustment_membershipId_fkey"
FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PaymentDueAdjustment"
ADD CONSTRAINT "PaymentDueAdjustment_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PaymentDueAdjustment"
ADD CONSTRAINT "PaymentDueAdjustment_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
