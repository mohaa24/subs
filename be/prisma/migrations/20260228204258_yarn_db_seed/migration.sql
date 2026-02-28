-- CreateEnum
CREATE TYPE "DependentGroup" AS ENUM ('children', 'other');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "RelationToHOH" ADD VALUE 'Husband';
ALTER TYPE "RelationToHOH" ADD VALUE 'Wife';
ALTER TYPE "RelationToHOH" ADD VALUE 'Son';
ALTER TYPE "RelationToHOH" ADD VALUE 'Daughter';
ALTER TYPE "RelationToHOH" ADD VALUE 'AdoptedSon';
ALTER TYPE "RelationToHOH" ADD VALUE 'AdoptedDaughter';
ALTER TYPE "RelationToHOH" ADD VALUE 'Father';
ALTER TYPE "RelationToHOH" ADD VALUE 'Mother';
ALTER TYPE "RelationToHOH" ADD VALUE 'StepFather';
ALTER TYPE "RelationToHOH" ADD VALUE 'StepMother';
ALTER TYPE "RelationToHOH" ADD VALUE 'Brother';
ALTER TYPE "RelationToHOH" ADD VALUE 'Sister';
ALTER TYPE "RelationToHOH" ADD VALUE 'Grandfather';
ALTER TYPE "RelationToHOH" ADD VALUE 'Grandmother';
ALTER TYPE "RelationToHOH" ADD VALUE 'Grandson';
ALTER TYPE "RelationToHOH" ADD VALUE 'Granddaughter';
ALTER TYPE "RelationToHOH" ADD VALUE 'SonInLaw';
ALTER TYPE "RelationToHOH" ADD VALUE 'DaughterInLaw';
ALTER TYPE "RelationToHOH" ADD VALUE 'Uncle';
ALTER TYPE "RelationToHOH" ADD VALUE 'Aunt';
ALTER TYPE "RelationToHOH" ADD VALUE 'Nephew';
ALTER TYPE "RelationToHOH" ADD VALUE 'Niece';
ALTER TYPE "RelationToHOH" ADD VALUE 'Cousin';
ALTER TYPE "RelationToHOH" ADD VALUE 'FatherInLaw';
ALTER TYPE "RelationToHOH" ADD VALUE 'MotherInLaw';

-- AlterTable
ALTER TABLE "MembershipDependent" ADD COLUMN     "group" "DependentGroup" NOT NULL DEFAULT 'other';

-- AlterTable
ALTER TABLE "Person" ADD COLUMN     "membershipId" TEXT;

-- AddForeignKey
ALTER TABLE "Person" ADD CONSTRAINT "Person_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;
