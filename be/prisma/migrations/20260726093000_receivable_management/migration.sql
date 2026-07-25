ALTER TABLE "AccountingAccount"
ADD COLUMN "counterpartyName" TEXT,
ADD COLUMN "counterpartyPhone" TEXT,
ADD COLUMN "counterpartyMembershipId" TEXT,
ADD COLUMN "closedAt" TIMESTAMP(3);

CREATE INDEX "AccountingAccount_counterpartyMembershipId_idx" ON "AccountingAccount"("counterpartyMembershipId");

ALTER TABLE "AccountingAccount"
ADD CONSTRAINT "AccountingAccount_counterpartyMembershipId_fkey"
FOREIGN KEY ("counterpartyMembershipId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;
