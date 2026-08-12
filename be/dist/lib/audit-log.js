"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeAuditLog = writeAuditLog;
function writeAuditLog(tx, input) {
    return tx.auditLog.create({
        data: {
            organizationId: input.organizationId,
            actorUserId: input.actorUserId ?? null,
            action: input.action,
            entityType: input.entityType,
            entityId: input.entityId ?? null,
            summary: input.summary,
            metadata: input.metadata ?? undefined,
        },
    });
}
