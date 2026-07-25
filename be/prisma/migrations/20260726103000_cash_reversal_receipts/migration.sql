ALTER TABLE "CashTransaction"
ADD COLUMN "reversalDocumentNumber" TEXT;

CREATE UNIQUE INDEX "CashTransaction_organizationId_reversalDocumentNumber_key"
ON "CashTransaction"("organizationId", "reversalDocumentNumber");
