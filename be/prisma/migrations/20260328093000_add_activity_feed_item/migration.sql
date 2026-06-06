CREATE TYPE "ActivityFeedEntryType" AS ENUM (
  'remark',
  'document_generated',
  'image_added',
  'system_event'
);

CREATE TYPE "ActivityFeedActorType" AS ENUM (
  'user',
  'system'
);

CREATE TABLE "ActivityFeedItem" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "personId" TEXT,
  "membershipId" TEXT,
  "entryType" "ActivityFeedEntryType" NOT NULL,
  "actorType" "ActivityFeedActorType" NOT NULL,
  "body" TEXT,
  "metadata" JSONB,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ActivityFeedItem_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ActivityFeedItem"
ADD CONSTRAINT "ActivityFeedItem_target_check"
CHECK (
  ("personId" IS NOT NULL AND "membershipId" IS NULL)
  OR
  ("personId" IS NULL AND "membershipId" IS NOT NULL)
);

ALTER TABLE "ActivityFeedItem"
ADD CONSTRAINT "ActivityFeedItem_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ActivityFeedItem"
ADD CONSTRAINT "ActivityFeedItem_personId_fkey"
FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ActivityFeedItem"
ADD CONSTRAINT "ActivityFeedItem_membershipId_fkey"
FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ActivityFeedItem"
ADD CONSTRAINT "ActivityFeedItem_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "ActivityFeedItem_organizationId_createdAt_idx" ON "ActivityFeedItem"("organizationId", "createdAt");
CREATE INDEX "ActivityFeedItem_personId_createdAt_idx" ON "ActivityFeedItem"("personId", "createdAt");
CREATE INDEX "ActivityFeedItem_membershipId_createdAt_idx" ON "ActivityFeedItem"("membershipId", "createdAt");
