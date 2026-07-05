ALTER TYPE "AccountingAssetSubtype" ADD VALUE IF NOT EXISTS 'payable';
ALTER TYPE "AccountingAssetSubtype" ADD VALUE IF NOT EXISTS 'other_liability';
ALTER TYPE "AccountingAssetSubtype" ADD VALUE IF NOT EXISTS 'general_fund';
ALTER TYPE "AccountingAssetSubtype" ADD VALUE IF NOT EXISTS 'project_fund';
ALTER TYPE "AccountingAssetSubtype" ADD VALUE IF NOT EXISTS 'operating_income';
ALTER TYPE "AccountingAssetSubtype" ADD VALUE IF NOT EXISTS 'project_fund_surplus';
ALTER TYPE "AccountingAssetSubtype" ADD VALUE IF NOT EXISTS 'operating_expense';
ALTER TYPE "AccountingAssetSubtype" ADD VALUE IF NOT EXISTS 'project_fund_deficit';
