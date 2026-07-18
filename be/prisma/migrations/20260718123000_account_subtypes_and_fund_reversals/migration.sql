-- Split broad account subtypes into concrete cash/bank, receivable, and payable categories.
ALTER TYPE "AccountingAssetSubtype" RENAME TO "AccountingAssetSubtype_old";

CREATE TYPE "AccountingAssetSubtype" AS ENUM (
  'cash',
  'bank',
  'loan_receivable',
  'service_receivable',
  'other',
  'loan_payable',
  'service_payable',
  'other_liability',
  'general_fund',
  'project_fund',
  'operating_income',
  'project_fund_surplus',
  'operating_expense',
  'project_fund_deficit'
);

ALTER TABLE "AccountingAccount" ALTER COLUMN "assetSubtype" DROP DEFAULT;

ALTER TABLE "AccountingAccount"
ALTER COLUMN "assetSubtype" TYPE "AccountingAssetSubtype"
USING (
  CASE
    WHEN "assetSubtype"::text = 'cash_bank'
      THEN CASE
        WHEN "systemKey" = 'asset_bank_account' OR "name" ILIKE '%bank%' THEN 'bank'
        ELSE 'cash'
      END
    WHEN "assetSubtype"::text = 'receivable' THEN 'service_receivable'
    WHEN "assetSubtype"::text = 'payable' THEN 'service_payable'
    ELSE "assetSubtype"::text
  END
)::"AccountingAssetSubtype";

ALTER TABLE "AccountingAccount" ALTER COLUMN "assetSubtype" SET DEFAULT 'other';

DROP TYPE "AccountingAssetSubtype_old";

-- Track reversals on Special Fund transactions.
ALTER TABLE "FundTransaction"
ADD COLUMN "reversedAt" TIMESTAMP(3),
ADD COLUMN "reversedByUserId" TEXT,
ADD COLUMN "reversalReason" TEXT;

CREATE INDEX "FundTransaction_reversedByUserId_idx" ON "FundTransaction"("reversedByUserId");

ALTER TABLE "FundTransaction"
ADD CONSTRAINT "FundTransaction_reversedByUserId_fkey"
FOREIGN KEY ("reversedByUserId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
