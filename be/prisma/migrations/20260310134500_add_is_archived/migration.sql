-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "isArchived" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Person" ADD COLUMN     "isArchived" BOOLEAN NOT NULL DEFAULT false;
