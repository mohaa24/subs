-- CreateEnum
CREATE TYPE "Permission" AS ENUM ('MANAGE_PERSONS', 'VIEW_PERSONS', 'MANAGE_MEMBERSHIPS', 'VIEW_MEMBERSHIPS', 'COLLECT_PAYMENTS', 'VIEW_PAYMENTS', 'MANAGE_ANNOUNCEMENTS', 'MANAGE_DISTRIBUTIONS', 'VIEW_REPORTS');

-- CreateEnum
CREATE TYPE "FormType" AS ENUM ('Person', 'Membership');

-- CreateEnum
CREATE TYPE "FieldVisibility" AS ENUM ('Required', 'Optional', 'Hidden');

-- CreateEnum
CREATE TYPE "AnnouncementStatus" AS ENUM ('draft', 'sent', 'failed');

-- CreateEnum
CREATE TYPE "MessageEventType" AS ENUM ('DUE_GENERATED', 'PAYMENT_RECEIVED', 'PAYMENT_OVERDUE', 'LATE_FEE_APPLIED', 'ORG_BILLING_DUE', 'ANNOUNCEMENT');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('pending', 'sent', 'failed');

-- CreateEnum
CREATE TYPE "DistributionFrequency" AS ENUM ('Daily', 'Monthly', 'Yearly');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "address" TEXT,
ADD COLUMN     "contactPersonName" TEXT,
ADD COLUMN     "contactPersonPhone" TEXT,
ADD COLUMN     "joinDate" TIMESTAMP(3),
ADD COLUMN     "lateFeePercentage" DECIMAL(5,2) NOT NULL DEFAULT 5.0,
ADD COLUMN     "logoUrl" TEXT,
ADD COLUMN     "proRataMonthly" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "proRataQuarterly" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "proRataYearly" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "whatsAppSenderNumber" TEXT;

-- AlterTable
ALTER TABLE "PaymentDue" ADD COLUMN     "lateFeeApplied" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "lateFeeDate" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "locale" TEXT NOT NULL DEFAULT 'en',
ADD COLUMN     "phoneNumber" TEXT;

-- CreateTable
CREATE TABLE "OrganizationBilling" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "isPaid" BOOLEAN NOT NULL DEFAULT false,
    "paidAt" TIMESTAMP(3),
    "markedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationBilling_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPermission" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "permission" "Permission" NOT NULL,

    CONSTRAINT "UserPermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserBookmark" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "actionKey" TEXT NOT NULL,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserBookmark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormFieldConfig" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "formType" "FormType" NOT NULL,
    "fieldName" TEXT NOT NULL,
    "visibility" "FieldVisibility" NOT NULL DEFAULT 'Optional',
    "displayOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "FormFieldConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnnouncementGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "organizationId" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnnouncementGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnnouncementGroupMember" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,

    CONSTRAINT "AnnouncementGroupMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "groupId" TEXT,
    "organizationId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "sentByUserId" TEXT,
    "status" "AnnouncementStatus" NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageQueue" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "recipientPhone" TEXT NOT NULL,
    "eventType" "MessageEventType" NOT NULL,
    "messageBody" TEXT NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "MessageQueue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Distribution" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "organizationId" TEXT NOT NULL,
    "frequency" "DistributionFrequency" NOT NULL,
    "filterCriteria" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Distribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DistributionRecord" (
    "id" TEXT NOT NULL,
    "distributionId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "distributedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "distributedByUserId" TEXT,
    "distributionDate" TEXT NOT NULL,

    CONSTRAINT "DistributionRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationBilling_organizationId_year_key" ON "OrganizationBilling"("organizationId", "year");

-- CreateIndex
CREATE UNIQUE INDEX "UserPermission_userId_permission_key" ON "UserPermission"("userId", "permission");

-- CreateIndex
CREATE UNIQUE INDEX "UserBookmark_userId_actionKey_key" ON "UserBookmark"("userId", "actionKey");

-- CreateIndex
CREATE UNIQUE INDEX "FormFieldConfig_organizationId_formType_fieldName_key" ON "FormFieldConfig"("organizationId", "formType", "fieldName");

-- CreateIndex
CREATE UNIQUE INDEX "AnnouncementGroupMember_groupId_personId_key" ON "AnnouncementGroupMember"("groupId", "personId");

-- CreateIndex
CREATE UNIQUE INDEX "DistributionRecord_distributionId_personId_distributionDate_key" ON "DistributionRecord"("distributionId", "personId", "distributionDate");

-- AddForeignKey
ALTER TABLE "OrganizationBilling" ADD CONSTRAINT "OrganizationBilling_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationBilling" ADD CONSTRAINT "OrganizationBilling_markedByUserId_fkey" FOREIGN KEY ("markedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPermission" ADD CONSTRAINT "UserPermission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBookmark" ADD CONSTRAINT "UserBookmark_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormFieldConfig" ADD CONSTRAINT "FormFieldConfig_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnouncementGroup" ADD CONSTRAINT "AnnouncementGroup_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnouncementGroupMember" ADD CONSTRAINT "AnnouncementGroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "AnnouncementGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnouncementGroupMember" ADD CONSTRAINT "AnnouncementGroupMember_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "AnnouncementGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageQueue" ADD CONSTRAINT "MessageQueue_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Distribution" ADD CONSTRAINT "Distribution_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DistributionRecord" ADD CONSTRAINT "DistributionRecord_distributionId_fkey" FOREIGN KEY ("distributionId") REFERENCES "Distribution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DistributionRecord" ADD CONSTRAINT "DistributionRecord_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DistributionRecord" ADD CONSTRAINT "DistributionRecord_distributedByUserId_fkey" FOREIGN KEY ("distributedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
