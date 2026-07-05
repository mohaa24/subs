ALTER TABLE "FundTransaction" ADD COLUMN "paidByPhone" TEXT;
ALTER TABLE "FundTransaction" ADD COLUMN "receiptNumber" TEXT;

UPDATE "AccountingAccount"
SET "assetSubtype" = CASE
  WHEN "accountType" = 'asset' AND "assetSubtype" = 'other' THEN 'other'
  WHEN "accountType" = 'liability' AND "systemKey" = 'liability_member_credit' THEN 'payable'::"AccountingAssetSubtype"
  WHEN "accountType" = 'liability' THEN 'other_liability'::"AccountingAssetSubtype"
  WHEN "accountType" = 'equity' AND "systemKey" LIKE 'fund_%' THEN 'project_fund'::"AccountingAssetSubtype"
  WHEN "accountType" = 'equity' THEN 'general_fund'::"AccountingAssetSubtype"
  WHEN "accountType" = 'income' AND "systemKey" LIKE 'fund_surplus_%' THEN 'project_fund_surplus'::"AccountingAssetSubtype"
  WHEN "accountType" = 'income' THEN 'operating_income'::"AccountingAssetSubtype"
  WHEN "accountType" = 'expense' AND "systemKey" LIKE 'fund_deficit_%' THEN 'project_fund_deficit'::"AccountingAssetSubtype"
  WHEN "accountType" = 'expense' THEN 'operating_expense'::"AccountingAssetSubtype"
  ELSE "assetSubtype"
END;

CREATE UNIQUE INDEX "FundTransaction_organizationId_receiptNumber_key" ON "FundTransaction"("organizationId", "receiptNumber");
