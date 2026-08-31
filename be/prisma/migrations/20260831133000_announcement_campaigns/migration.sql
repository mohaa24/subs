ALTER TYPE "AnnouncementStatus" ADD VALUE IF NOT EXISTS 'scheduled';
ALTER TYPE "AnnouncementStatus" ADD VALUE IF NOT EXISTS 'queued';
ALTER TYPE "AnnouncementStatus" ADD VALUE IF NOT EXISTS 'partially_failed';

ALTER TABLE "AnnouncementGroupMember"
  ALTER COLUMN "personId" DROP NOT NULL,
  ADD COLUMN "membershipId" TEXT;

ALTER TABLE "Announcement"
  ADD COLUMN "templateId" TEXT,
  ADD COLUMN "audience" JSONB,
  ADD COLUMN "recipientCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "estimatedSmsCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "scheduledAt" TIMESTAMP(3);

ALTER TABLE "MessageQueue"
  ADD COLUMN "estimatedSmsCount" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "announcementId" TEXT;

CREATE TABLE "AnnouncementTemplate" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "body" TEXT NOT NULL,
  "createdByUserId" TEXT,
  "updatedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AnnouncementTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AnnouncementRecipient" (
  "id" TEXT NOT NULL,
  "announcementId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "membershipId" TEXT,
  "membershipNo" TEXT NOT NULL,
  "memberName" TEXT NOT NULL,
  "recipientPhone" TEXT NOT NULL,
  "messageBody" TEXT NOT NULL,
  "estimatedSmsCount" INTEGER NOT NULL DEFAULT 1,
  "messageQueueId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnnouncementRecipient_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AnnouncementGroupMember_groupId_membershipId_key"
  ON "AnnouncementGroupMember"("groupId", "membershipId");
CREATE INDEX "AnnouncementGroupMember_membershipId_idx"
  ON "AnnouncementGroupMember"("membershipId");
CREATE INDEX "Announcement_organizationId_createdAt_idx"
  ON "Announcement"("organizationId", "createdAt");
CREATE INDEX "Announcement_organizationId_status_idx"
  ON "Announcement"("organizationId", "status");
CREATE UNIQUE INDEX "AnnouncementTemplate_organizationId_name_key"
  ON "AnnouncementTemplate"("organizationId", "name");
CREATE INDEX "AnnouncementTemplate_organizationId_updatedAt_idx"
  ON "AnnouncementTemplate"("organizationId", "updatedAt");
CREATE UNIQUE INDEX "AnnouncementRecipient_messageQueueId_key"
  ON "AnnouncementRecipient"("messageQueueId");
CREATE UNIQUE INDEX "AnnouncementRecipient_announcementId_membershipId_key"
  ON "AnnouncementRecipient"("announcementId", "membershipId");
CREATE INDEX "AnnouncementRecipient_announcementId_idx"
  ON "AnnouncementRecipient"("announcementId");
CREATE INDEX "AnnouncementRecipient_organizationId_createdAt_idx"
  ON "AnnouncementRecipient"("organizationId", "createdAt");
CREATE INDEX "MessageQueue_announcementId_idx"
  ON "MessageQueue"("announcementId");

ALTER TABLE "AnnouncementGroupMember"
  ADD CONSTRAINT "AnnouncementGroupMember_membershipId_fkey"
  FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Announcement"
  ADD CONSTRAINT "Announcement_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "AnnouncementTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Announcement"
  ADD CONSTRAINT "Announcement_sentByUserId_fkey"
  FOREIGN KEY ("sentByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AnnouncementTemplate"
  ADD CONSTRAINT "AnnouncementTemplate_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AnnouncementTemplate"
  ADD CONSTRAINT "AnnouncementTemplate_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AnnouncementTemplate"
  ADD CONSTRAINT "AnnouncementTemplate_updatedByUserId_fkey"
  FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AnnouncementRecipient"
  ADD CONSTRAINT "AnnouncementRecipient_announcementId_fkey"
  FOREIGN KEY ("announcementId") REFERENCES "Announcement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AnnouncementRecipient"
  ADD CONSTRAINT "AnnouncementRecipient_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AnnouncementRecipient"
  ADD CONSTRAINT "AnnouncementRecipient_membershipId_fkey"
  FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AnnouncementRecipient"
  ADD CONSTRAINT "AnnouncementRecipient_messageQueueId_fkey"
  FOREIGN KEY ("messageQueueId") REFERENCES "MessageQueue"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MessageQueue"
  ADD CONSTRAINT "MessageQueue_announcementId_fkey"
  FOREIGN KEY ("announcementId") REFERENCES "Announcement"("id") ON DELETE SET NULL ON UPDATE CASCADE;
