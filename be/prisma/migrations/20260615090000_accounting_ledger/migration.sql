-- CreateEnum
CREATE TYPE "AccountingAccountType" AS ENUM ('asset', 'liability', 'equity', 'income', 'expense');

-- CreateEnum
CREATE TYPE "AccountingJournalEntryType" AS ENUM ('opening_balance', 'payment', 'payment_correction', 'credit_application', 'expense', 'transfer', 'manual_adjustment');

-- CreateEnum
CREATE TYPE "AccountingJournalLineSide" AS ENUM ('debit', 'credit');

-- CreateTable
CREATE TABLE "AccountingAccount" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accountType" "AccountingAccountType" NOT NULL,
    "systemKey" TEXT,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountingAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountingJournalEntry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "entryDate" TIMESTAMP(3) NOT NULL,
    "entryType" "AccountingJournalEntryType" NOT NULL,
    "description" TEXT NOT NULL,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "isSystemEntry" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountingJournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountingJournalLine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "journalEntryId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "side" "AccountingJournalLineSide" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "memo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountingJournalLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AccountingAccount_organizationId_name_key" ON "AccountingAccount"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "AccountingAccount_organizationId_systemKey_key" ON "AccountingAccount"("organizationId", "systemKey");

-- CreateIndex
CREATE INDEX "AccountingAccount_organizationId_accountType_idx" ON "AccountingAccount"("organizationId", "accountType");

-- CreateIndex
CREATE INDEX "AccountingJournalEntry_organizationId_entryDate_idx" ON "AccountingJournalEntry"("organizationId", "entryDate");

-- CreateIndex
CREATE INDEX "AccountingJournalEntry_organizationId_referenceType_referenceId_idx" ON "AccountingJournalEntry"("organizationId", "referenceType", "referenceId");

-- CreateIndex
CREATE INDEX "AccountingJournalLine_organizationId_accountId_createdAt_idx" ON "AccountingJournalLine"("organizationId", "accountId", "createdAt");

-- CreateIndex
CREATE INDEX "AccountingJournalLine_journalEntryId_idx" ON "AccountingJournalLine"("journalEntryId");

-- AddForeignKey
ALTER TABLE "AccountingAccount" ADD CONSTRAINT "AccountingAccount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingAccount" ADD CONSTRAINT "AccountingAccount_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingJournalEntry" ADD CONSTRAINT "AccountingJournalEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingJournalEntry" ADD CONSTRAINT "AccountingJournalEntry_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingJournalLine" ADD CONSTRAINT "AccountingJournalLine_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingJournalLine" ADD CONSTRAINT "AccountingJournalLine_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "AccountingJournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingJournalLine" ADD CONSTRAINT "AccountingJournalLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "AccountingAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
