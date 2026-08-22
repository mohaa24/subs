ALTER TYPE "MessageStatus" ADD VALUE IF NOT EXISTS 'submitted';
ALTER TYPE "MessageStatus" ADD VALUE IF NOT EXISTS 'delivered';

ALTER TABLE "MessageQueue"
ADD COLUMN "deliveredAt" TIMESTAMP(3),
ADD COLUMN "providerMessageId" TEXT,
ADD COLUMN "providerStatus" TEXT,
ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "lastAttemptAt" TIMESTAMP(3),
ADD COLUMN "nextAttemptAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "lastError" TEXT,
ADD COLUMN "smsCount" INTEGER,
ADD COLUMN "cost" DECIMAL(12,4),
ADD COLUMN "deliveryEnabled" BOOLEAN NOT NULL DEFAULT false;

-- Existing queue rows were created before a live SMS provider was connected.
-- Keep them as history and allow delivery only for rows created after deployment.
ALTER TABLE "MessageQueue" ALTER COLUMN "deliveryEnabled" SET DEFAULT true;

CREATE INDEX "MessageQueue_deliveryEnabled_status_nextAttemptAt_idx" ON "MessageQueue"("deliveryEnabled", "status", "nextAttemptAt");
CREATE INDEX "MessageQueue_providerMessageId_idx" ON "MessageQueue"("providerMessageId");

CREATE TABLE "MessageSettings" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "monthlyQuota" INTEGER NOT NULL DEFAULT 100,
  "updatedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MessageSettings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MessageTemplate" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "eventType" "MessageEventType" NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "body" TEXT NOT NULL,
  "updatedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MessageTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MessageSettings_organizationId_key" ON "MessageSettings"("organizationId");
CREATE UNIQUE INDEX "MessageTemplate_organizationId_eventType_key" ON "MessageTemplate"("organizationId", "eventType");
CREATE INDEX "MessageTemplate_organizationId_enabled_idx" ON "MessageTemplate"("organizationId", "enabled");

ALTER TABLE "MessageSettings"
ADD CONSTRAINT "MessageSettings_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MessageTemplate"
ADD CONSTRAINT "MessageTemplate_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
