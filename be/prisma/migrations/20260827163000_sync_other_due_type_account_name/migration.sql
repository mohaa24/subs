-- Keep the system-managed income ledger for the editable "Other" due type
-- aligned with the due type's current display name.
UPDATE "AccountingAccount" AS account
SET
  "name" = due_type."name",
  "updatedAt" = CURRENT_TIMESTAMP
FROM "DueType" AS due_type
WHERE due_type."organizationId" = account."organizationId"
  AND due_type."systemKey" = 'other'
  AND account."systemKey" = 'income_due_type_' || due_type."id"
  AND lower(account."name") <> lower(due_type."name")
  AND NOT EXISTS (
    SELECT 1
    FROM "AccountingAccount" AS duplicate
    WHERE duplicate."organizationId" = account."organizationId"
      AND duplicate."id" <> account."id"
      AND lower(duplicate."name") = lower(due_type."name")
  );
