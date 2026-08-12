import type { Prisma } from "@prisma/client";

type AuditWriter = Pick<Prisma.TransactionClient, "auditLog">;

export type AuditLogInput = {
  organizationId: string;
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
  metadata?: Prisma.InputJsonValue | null;
};

export function writeAuditLog(tx: AuditWriter, input: AuditLogInput) {
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
