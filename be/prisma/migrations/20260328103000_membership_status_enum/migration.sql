CREATE TYPE "MembershipStatus" AS ENUM ('Active', 'Inactive');

ALTER TABLE "Membership"
ALTER COLUMN "membershipStatus" DROP DEFAULT;

ALTER TABLE "Membership"
ALTER COLUMN "membershipStatus" TYPE "MembershipStatus"
USING (
  CASE
    WHEN "membershipStatus" = 'Inactive' THEN 'Inactive'::"MembershipStatus"
    ELSE 'Active'::"MembershipStatus"
  END
);

ALTER TABLE "Membership"
ALTER COLUMN "membershipStatus" SET DEFAULT 'Active';
