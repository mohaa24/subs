-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('super_user', 'admin', 'user');

-- CreateEnum
CREATE TYPE "ResidentType" AS ENUM ('ResidentSinceBirth', 'ResidentByMarriage', 'BusinessResidency', 'EmploymentResidency', 'EducationalResidency', 'FamilyMemberOfResident', 'NonResidentPerson');

-- CreateEnum
CREATE TYPE "LivingStatus" AS ENUM ('Active', 'Deceased', 'PermanentlyRelocated');

-- CreateEnum
CREATE TYPE "PersonTitle" AS ENUM ('Mr', 'Master', 'Miss', 'Mrs', 'Ms', 'Dr');

-- CreateEnum
CREATE TYPE "IdentityType" AS ENUM ('NIC', 'Passport', 'DrivingLicense');

-- CreateEnum
CREATE TYPE "BloodGroup" AS ENUM ('A_pos', 'A_neg', 'B_pos', 'B_neg', 'AB_pos', 'AB_neg', 'O_pos', 'O_neg');

-- CreateEnum
CREATE TYPE "RelationToHOH" AS ENUM ('spouse', 'child', 'other');

-- CreateEnum
CREATE TYPE "MaritalStatus" AS ENUM ('single', 'married', 'widower', 'widow');

-- CreateEnum
CREATE TYPE "MembershipType" AS ENUM ('Resident', 'NonResident', 'Widow', 'Widower');

-- CreateEnum
CREATE TYPE "PaymentPeriod" AS ENUM ('Monthly', 'Quarterly', 'Annually');

-- CreateEnum
CREATE TYPE "DueStatus" AS ENUM ('pending', 'partial', 'paid', 'overdue');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "defaultMembershipFee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "organizationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Person" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" "PersonTitle",
    "nameWithInitials" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "preferredName" TEXT,
    "residentType" "ResidentType",
    "gender" TEXT,
    "nicNumber" TEXT,
    "identityType" "IdentityType",
    "idNumber" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "bloodGroup" "BloodGroup",
    "maritalStatus" "MaritalStatus",
    "address" TEXT,
    "mobileNumber" TEXT,
    "whatsAppNumber" TEXT,
    "email" TEXT,
    "occupation" TEXT,
    "placeOfWork" TEXT,
    "highestQualificationType" TEXT,
    "highestQualificationTitle" TEXT,
    "permanentDisability" TEXT,
    "schoolName" TEXT,
    "relationToHOH" "RelationToHOH",
    "livingStatus" "LivingStatus" DEFAULT 'Active',
    "isMadarasaStudent" BOOLEAN NOT NULL DEFAULT false,
    "isDisabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "membershipNo" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "dateOfRegistration" TIMESTAMP(3) NOT NULL,
    "membershipType" "MembershipType" NOT NULL,
    "membershipStatus" TEXT NOT NULL,
    "hodPersonId" TEXT NOT NULL,
    "spousePersonId" TEXT,
    "land" BOOLEAN NOT NULL DEFAULT false,
    "houseOwnership" BOOLEAN NOT NULL DEFAULT false,
    "commercialProperties" BOOLEAN NOT NULL DEFAULT false,
    "toiletFacility" BOOLEAN NOT NULL DEFAULT false,
    "vehicleOwnership" BOOLEAN NOT NULL DEFAULT false,
    "waterAccessibility" BOOLEAN NOT NULL DEFAULT false,
    "electricity" BOOLEAN NOT NULL DEFAULT false,
    "paymentPeriod" "PaymentPeriod" NOT NULL,
    "membershipFee" DECIMAL(12,2) NOT NULL,
    "additionalVoluntaryContributions" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "membershipFeeDiscount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalContribution" DECIMAL(12,2) NOT NULL,
    "disability" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MembershipDependent" (
    "id" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MembershipDependent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentDue" (
    "id" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "period" TEXT NOT NULL,
    "amountDue" DECIMAL(12,2) NOT NULL,
    "amountPaid" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "DueStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentDue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "paymentDueId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "paymentDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "collectedByUserId" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "MembershipDependent_membershipId_personId_key" ON "MembershipDependent"("membershipId", "personId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentDue_membershipId_period_key" ON "PaymentDue"("membershipId", "period");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Person" ADD CONSTRAINT "Person_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_hodPersonId_fkey" FOREIGN KEY ("hodPersonId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_spousePersonId_fkey" FOREIGN KEY ("spousePersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipDependent" ADD CONSTRAINT "MembershipDependent_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipDependent" ADD CONSTRAINT "MembershipDependent_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentDue" ADD CONSTRAINT "PaymentDue_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentDue" ADD CONSTRAINT "PaymentDue_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_paymentDueId_fkey" FOREIGN KEY ("paymentDueId") REFERENCES "PaymentDue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_collectedByUserId_fkey" FOREIGN KEY ("collectedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
