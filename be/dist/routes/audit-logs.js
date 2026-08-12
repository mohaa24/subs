"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.auditLogsRouter = void 0;
const express_1 = require("express");
const prisma_js_1 = require("../lib/prisma.js");
const auth_js_1 = require("../middleware/auth.js");
exports.auditLogsRouter = (0, express_1.Router)();
exports.auditLogsRouter.use(auth_js_1.requireAuth);
exports.auditLogsRouter.use(auth_js_1.withOrgScope);
exports.auditLogsRouter.get("/", async (req, res) => {
    if (req.auth.role !== "admin" && req.auth.role !== "super_user") {
        return res.status(403).json({ error: "Only administrators can view audit logs" });
    }
    const organizationId = req.organizationId ?? req.query.organizationId;
    if (!organizationId && req.auth.role !== "super_user") {
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
    const where = {
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
        prisma_js_1.prisma.auditLog.findMany({
            where,
            skip: (page - 1) * limit,
            take: limit,
            orderBy: { createdAt: "desc" },
            include: { actor: { select: { id: true, email: true } } },
        }),
        prisma_js_1.prisma.auditLog.count({ where }),
        prisma_js_1.prisma.auditLog.groupBy({
            by: ["action"],
            where: organizationId ? { organizationId } : {},
            orderBy: { action: "asc" },
        }),
        prisma_js_1.prisma.auditLog.groupBy({
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
