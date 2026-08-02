ALTER TABLE "AccountingAccount"
ADD COLUMN "bankName" TEXT,
ADD COLUMN "accountNumber" TEXT;

CREATE TYPE "BankingTransactionType" AS ENUM ('deposit', 'withdrawal', 'cash_transfer', 'bank_transfer');

CREATE TABLE "BankingTransaction" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "transactionType" "BankingTransactionType" NOT NULL,
  "sourceAccountId" TEXT NOT NULL,
  "destinationAccountId" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "transactionDate" TIMESTAMP(3) NOT NULL,
  "description" TEXT,
  "reference" TEXT,
  "receiptNumber" TEXT,
  "journalEntryId" TEXT,
  "reversedAt" TIMESTAMP(3),
  "reversedByUserId" TEXT,
  "reversalReason" TEXT,
  "reversalOfId" TEXT,
  "isReversal" BOOLEAN NOT NULL DEFAULT false,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "BankingTransaction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BankingTransaction_reversalOfId_key" ON "BankingTransaction"("reversalOfId");
CREATE UNIQUE INDEX "BankingTransaction_organizationId_receiptNumber_key" ON "BankingTransaction"("organizationId", "receiptNumber");
CREATE INDEX "BankingTransaction_organizationId_transactionDate_idx" ON "BankingTransaction"("organizationId", "transactionDate");
CREATE INDEX "BankingTransaction_sourceAccountId_transactionDate_idx" ON "BankingTransaction"("sourceAccountId", "transactionDate");
CREATE INDEX "BankingTransaction_destinationAccountId_transactionDate_idx" ON "BankingTransaction"("destinationAccountId", "transactionDate");
CREATE INDEX "BankingTransaction_journalEntryId_idx" ON "BankingTransaction"("journalEntryId");
CREATE INDEX "BankingTransaction_reversedByUserId_idx" ON "BankingTransaction"("reversedByUserId");
CREATE INDEX "BankingTransaction_createdByUserId_idx" ON "BankingTransaction"("createdByUserId");

ALTER TABLE "BankingTransaction"
ADD CONSTRAINT "BankingTransaction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "BankingTransaction_sourceAccountId_fkey" FOREIGN KEY ("sourceAccountId") REFERENCES "AccountingAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "BankingTransaction_destinationAccountId_fkey" FOREIGN KEY ("destinationAccountId") REFERENCES "AccountingAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "BankingTransaction_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "AccountingJournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "BankingTransaction_reversedByUserId_fkey" FOREIGN KEY ("reversedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "BankingTransaction_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "BankingTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "BankingTransaction_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
