CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "summary" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuditLog_organizationId_createdAt_idx" ON "AuditLog"("organizationId", "createdAt");
CREATE INDEX "AuditLog_organizationId_action_createdAt_idx" ON "AuditLog"("organizationId", "action", "createdAt");
CREATE INDEX "AuditLog_organizationId_entityType_entityId_idx" ON "AuditLog"("organizationId", "entityType", "entityId");
CREATE INDEX "AuditLog_actorUserId_createdAt_idx" ON "AuditLog"("actorUserId", "createdAt");

ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Preserve the existing finance history so the audit screen is useful immediately.
INSERT INTO "AuditLog" (
    "id",
    "organizationId",
    "actorUserId",
    "action",
    "entityType",
    "entityId",
    "summary",
    "metadata",
    "createdAt"
)
SELECT
    'audit_journal_' || entry."id",
    entry."organizationId",
    entry."createdByUserId",
    'finance.' || COALESCE(entry."referenceType", entry."entryType"::text),
    COALESCE(entry."referenceType", 'accounting_journal_entry'),
    COALESCE(entry."referenceId", entry."id"),
    entry."description",
    jsonb_strip_nulls(jsonb_build_object(
        'journalEntryId', entry."id",
        'entryType', entry."entryType"::text,
        'referenceType', entry."referenceType",
        'isSystemEntry', entry."isSystemEntry"
    )),
    entry."createdAt"
FROM "AccountingJournalEntry" AS entry;
