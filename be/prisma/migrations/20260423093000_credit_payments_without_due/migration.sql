-- Add standalone credit payments without forcing a synthetic due row.
CREATE TYPE "PaymentKind" AS ENUM ('due', 'credit');

ALTER TABLE "Payment"
ADD COLUMN     "paymentKind" "PaymentKind" NOT NULL DEFAULT 'due',
ALTER COLUMN   "paymentDueId" DROP NOT NULL;
