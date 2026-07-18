ALTER TYPE "CashTransactionCategory" ADD VALUE IF NOT EXISTS 'receivable_payment';
ALTER TYPE "CashTransactionCategory" ADD VALUE IF NOT EXISTS 'payable_recovery';
