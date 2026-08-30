CREATE TYPE "OpeningBalanceMigrationKind" AS ENUM ('original', 'correction', 'replacement');

CREATE TYPE "OpeningBalanceMigrationStatus" AS ENUM ('draft', 'posted', 'reversed');

CREATE TABLE "OpeningBalanceMigration" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "cutoffDate" DATE NOT NULL,
  "description" TEXT NOT NULL,
  "kind" "OpeningBalanceMigrationKind" NOT NULL DEFAULT 'original',
  "status" "OpeningBalanceMigrationStatus" NOT NULL DEFAULT 'draft',
  "parentMigrationId" TEXT,
  "journalEntryId" TEXT,
  "reversalJournalEntryId" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "updatedByUserId" TEXT NOT NULL,
  "postedByUserId" TEXT,
  "reversedByUserId" TEXT,
  "correctionReason" TEXT,
  "reversalReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "postedAt" TIMESTAMP(3),
  "reversedAt" TIMESTAMP(3),
  CONSTRAINT "OpeningBalanceMigration_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OpeningBalanceMigrationLine" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "migrationId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "accountNameSnapshot" TEXT NOT NULL,
  "accountTypeSnapshot" "AccountingAccountType" NOT NULL,
  "accountSubtypeSnapshot" "AccountingAssetSubtype" NOT NULL,
  "systemKeySnapshot" TEXT,
  "isSystemCalculated" BOOLEAN NOT NULL DEFAULT false,
  "currentBalance" DECIMAL(14,2) NOT NULL,
  "verifiedBalance" DECIMAL(14,2) NOT NULL,
  "adjustmentDebit" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "adjustmentCredit" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OpeningBalanceMigrationLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OpeningBalanceMigration_journalEntryId_key" ON "OpeningBalanceMigration"("journalEntryId");
CREATE UNIQUE INDEX "OpeningBalanceMigration_reversalJournalEntryId_key" ON "OpeningBalanceMigration"("reversalJournalEntryId");
CREATE INDEX "OpeningBalanceMigration_organizationId_status_idx" ON "OpeningBalanceMigration"("organizationId", "status");
CREATE INDEX "OpeningBalanceMigration_organizationId_cutoffDate_idx" ON "OpeningBalanceMigration"("organizationId", "cutoffDate");
CREATE INDEX "OpeningBalanceMigration_parentMigrationId_idx" ON "OpeningBalanceMigration"("parentMigrationId");
CREATE UNIQUE INDEX "OpeningBalanceMigrationLine_migrationId_accountId_key" ON "OpeningBalanceMigrationLine"("migrationId", "accountId");
CREATE INDEX "OpeningBalanceMigrationLine_organizationId_accountId_idx" ON "OpeningBalanceMigrationLine"("organizationId", "accountId");

-- At most one posted, non-reversed baseline may exist for an organisation.
CREATE UNIQUE INDEX "OpeningBalanceMigration_one_active_baseline_per_org"
  ON "OpeningBalanceMigration"("organizationId")
  WHERE "kind" IN ('original', 'replacement') AND "status" = 'posted';

ALTER TABLE "OpeningBalanceMigration"
  ADD CONSTRAINT "OpeningBalanceMigration_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "OpeningBalanceMigration_parentMigrationId_fkey" FOREIGN KEY ("parentMigrationId") REFERENCES "OpeningBalanceMigration"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "OpeningBalanceMigration_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "AccountingJournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "OpeningBalanceMigration_reversalJournalEntryId_fkey" FOREIGN KEY ("reversalJournalEntryId") REFERENCES "AccountingJournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "OpeningBalanceMigration_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "OpeningBalanceMigration_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "OpeningBalanceMigration_postedByUserId_fkey" FOREIGN KEY ("postedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "OpeningBalanceMigration_reversedByUserId_fkey" FOREIGN KEY ("reversedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OpeningBalanceMigrationLine"
  ADD CONSTRAINT "OpeningBalanceMigrationLine_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "OpeningBalanceMigrationLine_migrationId_fkey" FOREIGN KEY ("migrationId") REFERENCES "OpeningBalanceMigration"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "OpeningBalanceMigrationLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "AccountingAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
