-- Add a flag for internal reconciliation dues so they can stay out of
-- member-facing balances and tables.
ALTER TABLE "PaymentDue"
ADD COLUMN "isSystemAdjustment" BOOLEAN NOT NULL DEFAULT false;

-- Track which due consumed credit from which source payment so reversals can
-- reopen the exact due instead of replaying ledger history heuristically.
CREATE TABLE "MembershipCreditAllocation" (
  "id" TEXT NOT NULL,
  "membershipId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "paymentDueId" TEXT NOT NULL,
  "sourcePaymentId" TEXT,
  "amount" DECIMAL(12,2) NOT NULL,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reversedAt" TIMESTAMP(3),
  "reversedByUserId" TEXT,
  "reversalReason" TEXT,

  CONSTRAINT "MembershipCreditAllocation_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "MembershipCreditAllocation"
ADD CONSTRAINT "MembershipCreditAllocation_membershipId_fkey"
FOREIGN KEY ("membershipId") REFERENCES "Membership"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MembershipCreditAllocation"
ADD CONSTRAINT "MembershipCreditAllocation_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MembershipCreditAllocation"
ADD CONSTRAINT "MembershipCreditAllocation_paymentDueId_fkey"
FOREIGN KEY ("paymentDueId") REFERENCES "PaymentDue"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MembershipCreditAllocation"
ADD CONSTRAINT "MembershipCreditAllocation_sourcePaymentId_fkey"
FOREIGN KEY ("sourcePaymentId") REFERENCES "Payment"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MembershipCreditAllocation"
ADD CONSTRAINT "MembershipCreditAllocation_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MembershipCreditAllocation"
ADD CONSTRAINT "MembershipCreditAllocation_reversedByUserId_fkey"
FOREIGN KEY ("reversedByUserId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "MembershipCreditAllocation_membershipId_createdAt_idx"
ON "MembershipCreditAllocation"("membershipId", "createdAt");

CREATE INDEX "MembershipCreditAllocation_paymentDueId_createdAt_idx"
ON "MembershipCreditAllocation"("paymentDueId", "createdAt");

CREATE INDEX "MembershipCreditAllocation_sourcePaymentId_createdAt_idx"
ON "MembershipCreditAllocation"("sourcePaymentId", "createdAt");
