CREATE TYPE "PaymentMethod" AS ENUM ('cash', 'bank_transfer', 'card', 'other');

ALTER TABLE "Payment"
ADD COLUMN "receiptNumber" TEXT,
ADD COLUMN "paymentMethod" "PaymentMethod",
ADD COLUMN "outstandingAfterPayment" DECIMAL(12, 2),
ADD COLUMN "creditBalanceAfterPayment" DECIMAL(12, 2);

CREATE UNIQUE INDEX "Payment_organizationId_receiptNumber_key"
ON "Payment"("organizationId", "receiptNumber");
