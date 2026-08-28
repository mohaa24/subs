-- Preserve customized due-generation templates while adding the newly
-- supported total outstanding due placeholder to existing saved content.
UPDATE "MessageTemplate"
SET
  "body" = CASE
    WHEN position('{{organization_name}}' in "body") > 0 THEN
      replace(
        "body",
        '{{organization_name}}',
        'Total outstanding due: Rs. {{total_outstanding_due}}. {{organization_name}}'
      )
    ELSE "body" || ' Total outstanding due: Rs. {{total_outstanding_due}}.'
  END,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "eventType" = 'DUE_GENERATED'
  AND position('{{total_outstanding_due}}' in "body") = 0;
