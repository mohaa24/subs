CREATE TYPE "CashFlowType" AS ENUM ('cash_in', 'cash_out');

CREATE TYPE "CashTransactionCategory" AS ENUM (
  'operating_income',
  'receivable_collection',
  'operating_expense',
  'payable_payment'
);

CREATE TABLE "CashTransaction" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "flowType" "CashFlowType" NOT NULL,
  "category" "CashTransactionCategory" NOT NULL,
  "accountId" TEXT NOT NULL,
  "cashBankAccountId" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "transactionDate" TIMESTAMP(3) NOT NULL,
  "counterpartyName" TEXT,
  "counterpartyPhone" TEXT,
  "counterpartyMembershipId" TEXT,
  "reference" TEXT,
  "description" TEXT,
  "documentNumber" TEXT,
  "journalEntryId" TEXT,
  "reversedAt" TIMESTAMP(3),
  "reversedByUserId" TEXT,
  "reversalReason" TEXT,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CashTransaction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CashTransaction_organizationId_documentNumber_key"
ON "CashTransaction"("organizationId", "documentNumber");

CREATE INDEX "CashTransaction_organizationId_flowType_category_idx"
ON "CashTransaction"("organizationId", "flowType", "category");

CREATE INDEX "CashTransaction_organizationId_accountId_transactionDate_idx"
ON "CashTransaction"("organizationId", "accountId", "transactionDate");

CREATE INDEX "CashTransaction_journalEntryId_idx"
ON "CashTransaction"("journalEntryId");

CREATE INDEX "CashTransaction_counterpartyMembershipId_idx"
ON "CashTransaction"("counterpartyMembershipId");

ALTER TABLE "CashTransaction"
ADD CONSTRAINT "CashTransaction_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CashTransaction"
ADD CONSTRAINT "CashTransaction_accountId_fkey"
FOREIGN KEY ("accountId") REFERENCES "AccountingAccount"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CashTransaction"
ADD CONSTRAINT "CashTransaction_cashBankAccountId_fkey"
FOREIGN KEY ("cashBankAccountId") REFERENCES "AccountingAccount"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CashTransaction"
ADD CONSTRAINT "CashTransaction_counterpartyMembershipId_fkey"
FOREIGN KEY ("counterpartyMembershipId") REFERENCES "Membership"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CashTransaction"
ADD CONSTRAINT "CashTransaction_journalEntryId_fkey"
FOREIGN KEY ("journalEntryId") REFERENCES "AccountingJournalEntry"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CashTransaction"
ADD CONSTRAINT "CashTransaction_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CashTransaction"
ADD CONSTRAINT "CashTransaction_reversedByUserId_fkey"
FOREIGN KEY ("reversedByUserId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
