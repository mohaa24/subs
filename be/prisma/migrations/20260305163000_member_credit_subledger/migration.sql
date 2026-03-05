-- CreateEnum
CREATE TYPE "MembershipCreditEntryType" AS ENUM ('credit_overpayment', 'debit_auto_apply', 'credit_adjustment', 'debit_adjustment');

-- CreateTable
CREATE TABLE "MembershipCreditLedger" (
    "id" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "paymentId" TEXT,
    "paymentDueId" TEXT,
    "amountDelta" DECIMAL(12,2) NOT NULL,
    "entryType" "MembershipCreditEntryType" NOT NULL,
    "note" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MembershipCreditLedger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MembershipCreditLedger_membershipId_createdAt_idx" ON "MembershipCreditLedger"("membershipId", "createdAt");

-- CreateIndex
CREATE INDEX "MembershipCreditLedger_organizationId_createdAt_idx" ON "MembershipCreditLedger"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "MembershipCreditLedger" ADD CONSTRAINT "MembershipCreditLedger_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipCreditLedger" ADD CONSTRAINT "MembershipCreditLedger_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipCreditLedger" ADD CONSTRAINT "MembershipCreditLedger_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipCreditLedger" ADD CONSTRAINT "MembershipCreditLedger_paymentDueId_fkey" FOREIGN KEY ("paymentDueId") REFERENCES "PaymentDue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipCreditLedger" ADD CONSTRAINT "MembershipCreditLedger_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
