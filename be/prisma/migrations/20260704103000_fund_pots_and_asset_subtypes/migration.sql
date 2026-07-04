-- CreateEnum
CREATE TYPE "AccountingAssetSubtype" AS ENUM ('cash_bank', 'receivable', 'other');

-- CreateEnum
CREATE TYPE "FundPotStatus" AS ENUM ('active', 'closed');

-- CreateEnum
CREATE TYPE "FundTransactionType" AS ENUM ('opening', 'collection', 'expense', 'surplus_transfer', 'deficit_transfer');

-- AlterTable
ALTER TABLE "AccountingAccount" ADD COLUMN "assetSubtype" "AccountingAssetSubtype" NOT NULL DEFAULT 'other';

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN "depositAccountId" TEXT;

-- Existing system cash and bank accounts should be usable as payment channels.
UPDATE "AccountingAccount"
SET "assetSubtype" = 'cash_bank'
WHERE "accountType" = 'asset'
  AND "systemKey" IN ('asset_cash_on_hand', 'asset_bank_account');

-- CreateTable
CREATE TABLE "FundPot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "FundPotStatus" NOT NULL DEFAULT 'active',
    "openingBalance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "fundAccountId" TEXT NOT NULL,
    "surplusAccountId" TEXT NOT NULL,
    "deficitAccountId" TEXT NOT NULL,
    "openingAssetAccountId" TEXT,
    "createdByUserId" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FundPot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FundTransaction" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fundPotId" TEXT NOT NULL,
    "transactionType" "FundTransactionType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "transactionDate" TIMESTAMP(3) NOT NULL,
    "assetAccountId" TEXT,
    "paidByName" TEXT,
    "paidByMembershipId" TEXT,
    "description" TEXT,
    "memo" TEXT,
    "journalEntryId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FundTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FundPot_organizationId_name_key" ON "FundPot"("organizationId", "name");

-- CreateIndex
CREATE INDEX "FundPot_organizationId_status_idx" ON "FundPot"("organizationId", "status");

-- CreateIndex
CREATE INDEX "FundPot_fundAccountId_idx" ON "FundPot"("fundAccountId");

-- CreateIndex
CREATE INDEX "FundTransaction_organizationId_transactionDate_idx" ON "FundTransaction"("organizationId", "transactionDate");

-- CreateIndex
CREATE INDEX "FundTransaction_fundPotId_transactionDate_idx" ON "FundTransaction"("fundPotId", "transactionDate");

-- CreateIndex
CREATE INDEX "FundTransaction_journalEntryId_idx" ON "FundTransaction"("journalEntryId");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_depositAccountId_fkey" FOREIGN KEY ("depositAccountId") REFERENCES "AccountingAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundPot" ADD CONSTRAINT "FundPot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundPot" ADD CONSTRAINT "FundPot_fundAccountId_fkey" FOREIGN KEY ("fundAccountId") REFERENCES "AccountingAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundPot" ADD CONSTRAINT "FundPot_surplusAccountId_fkey" FOREIGN KEY ("surplusAccountId") REFERENCES "AccountingAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundPot" ADD CONSTRAINT "FundPot_deficitAccountId_fkey" FOREIGN KEY ("deficitAccountId") REFERENCES "AccountingAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundPot" ADD CONSTRAINT "FundPot_openingAssetAccountId_fkey" FOREIGN KEY ("openingAssetAccountId") REFERENCES "AccountingAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundTransaction" ADD CONSTRAINT "FundTransaction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundTransaction" ADD CONSTRAINT "FundTransaction_fundPotId_fkey" FOREIGN KEY ("fundPotId") REFERENCES "FundPot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundTransaction" ADD CONSTRAINT "FundTransaction_assetAccountId_fkey" FOREIGN KEY ("assetAccountId") REFERENCES "AccountingAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundTransaction" ADD CONSTRAINT "FundTransaction_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "AccountingJournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
