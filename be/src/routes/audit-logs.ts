import { Router } from "express";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requireAuth, withOrgScope } from "../middleware/auth.js";
import { requirePermission } from "./permissions.js";

export const auditLogsRouter = Router();

auditLogsRouter.use(requireAuth);
auditLogsRouter.use(withOrgScope);
auditLogsRouter.use(requirePermission("VIEW_AUDIT_LOG"));

auditLogsRouter.get("/", async (req, res) => {
  if (req.auth!.role !== "admin" && req.auth!.role !== "super_user") {
    return res.status(403).json({ error: "Only administrators can view audit logs" });
  }

  const organizationId = (req as any).organizationId ?? (req.query.organizationId as string | undefined);
  if (!organizationId && req.auth!.role !== "super_user") {
    return res.status(400).json({ error: "Organization scope required" });
  }

  const requestedPage = Number(req.query.page);
  const requestedLimit = Number(req.query.limit);
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? Math.floor(requestedPage) : 1;
  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(Math.floor(requestedLimit), 1), 100) : 25;
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const action = typeof req.query.action === "string" ? req.query.action.trim() : "";
  const entityType = typeof req.query.entityType === "string" ? req.query.entityType.trim() : "";
  const from = typeof req.query.from === "string" ? new Date(req.query.from) : null;
  const to = typeof req.query.to === "string" ? new Date(req.query.to) : null;

  const where: Prisma.AuditLogWhereInput = {
    ...(organizationId ? { organizationId } : {}),
    ...(action ? { action } : {}),
    ...(entityType ? { entityType } : {}),
    ...(q
      ? {
          OR: [
            { summary: { contains: q, mode: "insensitive" } },
            { action: { contains: q, mode: "insensitive" } },
            { entityType: { contains: q, mode: "insensitive" } },
            { entityId: { contains: q, mode: "insensitive" } },
            { actor: { email: { contains: q, mode: "insensitive" } } },
          ],
        }
      : {}),
    ...(from && !Number.isNaN(from.getTime()) || to && !Number.isNaN(to.getTime())
      ? {
          createdAt: {
            ...(from && !Number.isNaN(from.getTime()) ? { gte: from } : {}),
            ...(to && !Number.isNaN(to.getTime()) ? { lte: to } : {}),
          },
        }
      : {}),
  };

  const [items, total, actionGroups, entityGroups] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: { actor: { select: { id: true, email: true } } },
    }),
    prisma.auditLog.count({ where }),
    prisma.auditLog.groupBy({
      by: ["action"],
      where: organizationId ? { organizationId } : {},
      orderBy: { action: "asc" },
    }),
    prisma.auditLog.groupBy({
      by: ["entityType"],
      where: organizationId ? { organizationId } : {},
      orderBy: { entityType: "asc" },
    }),
  ]);

  return res.json({
    items,
    total,
    page,
    limit,
    pageCount: Math.max(1, Math.ceil(total / limit)),
    actions: actionGroups.map((group) => group.action),
    entityTypes: entityGroups.map((group) => group.entityType),
  });
});
