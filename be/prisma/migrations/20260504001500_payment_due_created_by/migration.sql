-- Track who created a due so manual due entries can show the real user in statements.
ALTER TABLE "PaymentDue"
ADD COLUMN "createdByUserId" TEXT;

ALTER TABLE "PaymentDue"
ADD CONSTRAINT "PaymentDue_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

CREATE INDEX "PaymentDue_createdByUserId_idx" ON "PaymentDue"("createdByUserId");
