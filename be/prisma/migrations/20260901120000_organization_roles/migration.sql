-- Organization-scoped named roles replace direct per-user permissions.
CREATE TABLE "OrganizationRole" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OrganizationRole_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrganizationRolePermission" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    CONSTRAINT "OrganizationRolePermission_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "User" ADD COLUMN "organizationRoleId" TEXT;
ALTER TABLE "User" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;

CREATE UNIQUE INDEX "OrganizationRole_organizationId_name_key" ON "OrganizationRole"("organizationId", "name");
CREATE INDEX "OrganizationRole_organizationId_idx" ON "OrganizationRole"("organizationId");
CREATE UNIQUE INDEX "OrganizationRolePermission_roleId_permission_key" ON "OrganizationRolePermission"("roleId", "permission");
CREATE INDEX "OrganizationRolePermission_permission_idx" ON "OrganizationRolePermission"("permission");

ALTER TABLE "OrganizationRole" ADD CONSTRAINT "OrganizationRole_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrganizationRolePermission" ADD CONSTRAINT "OrganizationRolePermission_roleId_fkey"
  FOREIGN KEY ("roleId") REFERENCES "OrganizationRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "User" ADD CONSTRAINT "User_organizationRoleId_fkey"
  FOREIGN KEY ("organizationRoleId") REFERENCES "OrganizationRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Give every existing normal user a clean named role with full organisation
-- access. Platform admins and super users keep their existing account role.
INSERT INTO "OrganizationRole" ("id", "organizationId", "name", "description", "createdAt", "updatedAt")
SELECT 'role_' || md5(o."id" || ':full-access'), o."id", 'Full Access',
       'Full organisation access for existing users. Permissions can be narrowed later.',
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Organization" o
WHERE EXISTS (
  SELECT 1 FROM "User" u WHERE u."organizationId" = o."id" AND u."role" = 'user'
);

INSERT INTO "OrganizationRolePermission" ("id", "roleId", "permission")
SELECT 'rp_' || md5(r."id" || ':' || p.permission), r."id", p.permission
FROM "OrganizationRole" r
CROSS JOIN (VALUES
  ('VIEW_DASHBOARD'), ('ADD_ACTIVITY_NOTE'),
  ('VIEW_PERSONS'), ('CREATE_PERSON'), ('EDIT_PERSON'),
  ('VIEW_MEMBERSHIPS'), ('CREATE_MEMBERSHIP'), ('EDIT_MEMBERSHIP'),
  ('VIEW_MEMBER_DUES'), ('GENERATE_MEMBER_DUES'), ('MANAGE_MEMBER_DUES'),
  ('VIEW_MEMBER_PAYMENTS'), ('RECEIVE_MEMBER_PAYMENT'), ('REVERSE_MEMBER_PAYMENT'), ('SEND_MEMBER_MESSAGE'),
  ('VIEW_CASH_IN'), ('RECEIVE_OPERATING_INCOME'), ('VIEW_CASH_OUT'), ('PAY_OPERATING_EXPENSE'), ('REVERSE_CASH_TRANSACTION'),
  ('VIEW_BANKING'), ('MANAGE_BANKING'), ('VIEW_SPECIAL_FUNDS'), ('MANAGE_SPECIAL_FUNDS'),
  ('VIEW_RECEIVABLES'), ('MANAGE_RECEIVABLES'), ('VIEW_PAYABLES'), ('MANAGE_PAYABLES'),
  ('VIEW_CHART_OF_ACCOUNTS'), ('MANAGE_CHART_OF_ACCOUNTS'), ('VIEW_JOURNALS'),
  ('VIEW_ANNOUNCEMENTS'), ('MANAGE_ANNOUNCEMENTS'),
  ('VIEW_DISTRIBUTIONS'), ('MANAGE_DISTRIBUTIONS'),
  ('VIEW_MEMBER_REPORTS'), ('EXPORT_MEMBER_REPORTS'), ('VIEW_FINANCIAL_REPORTS'), ('EXPORT_FINANCIAL_REPORTS'),
  ('VIEW_USERS'), ('MANAGE_USERS'), ('MANAGE_ROLES'),
  ('VIEW_ORGANIZATION_SETTINGS'), ('EDIT_ORGANIZATION_SETTINGS'),
  ('MANAGE_DUE_TYPES'), ('MANAGE_ZONES'), ('MANAGE_FORM_SETTINGS'),
  ('VIEW_SMS_SETTINGS'), ('MANAGE_SMS_TEMPLATES'), ('VIEW_AUDIT_LOG')
) AS p(permission);

UPDATE "User" u
SET "organizationRoleId" = 'role_' || md5(u."organizationId" || ':full-access')
WHERE u."role" = 'user' AND u."organizationId" IS NOT NULL;

DROP TABLE "UserPermission";
DROP TYPE "Permission";
