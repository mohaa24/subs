"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultDueTypesForReference = exports.dueTypesRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const prisma_js_1 = require("../lib/prisma.js");
const auth_js_1 = require("../middleware/auth.js");
const due_types_js_1 = require("../lib/due-types.js");
exports.dueTypesRouter = (0, express_1.Router)();
exports.dueTypesRouter.use(auth_js_1.requireAuth);
exports.dueTypesRouter.use(auth_js_1.withOrgScope);
function getOrgId(req) {
    return req.organizationId ?? req.body?.organizationId ?? req.query?.organizationId;
}
const protectedSystemKeys = new Set(["subscription"]);
const createSchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(1).max(100),
    autoAllocate: zod_1.z.boolean().default(false),
    organizationId: zod_1.z.string().optional(),
});
const updateSchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(1).max(100).optional(),
    autoAllocate: zod_1.z.boolean().optional(),
    isActive: zod_1.z.boolean().optional(),
});
exports.dueTypesRouter.get("/", async (req, res) => {
    const orgId = getOrgId(req);
    if (!orgId && req.auth.role !== "super_user") {
        return res.status(400).json({ error: "Organization scope required" });
    }
    if (orgId) {
        await prisma_js_1.prisma.$transaction((tx) => (0, due_types_js_1.ensureDefaultDueTypes)(tx, orgId));
    }
    const includeInactive = req.query.includeInactive === "true";
    const where = orgId ? { organizationId: orgId } : {};
    if (!includeInactive)
        where.isActive = true;
    const dueTypes = await prisma_js_1.prisma.dueType.findMany({
        where,
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    return res.json(dueTypes);
});
exports.dueTypesRouter.post("/", auth_js_1.requireAdmin, async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    }
    const orgId = parsed.data.organizationId ?? getOrgId(req);
    if (!orgId)
        return res.status(400).json({ error: "Organization scope required" });
    if (req.auth.role !== "super_user" && orgId !== req.auth.organizationId) {
        return res.status(403).json({ error: "Forbidden" });
    }
    const existing = await prisma_js_1.prisma.dueType.findFirst({
        where: {
            organizationId: orgId,
            name: { equals: parsed.data.name, mode: "insensitive" },
        },
    });
    if (existing)
        return res.status(409).json({ error: "A due type with this name already exists" });
    const dueType = await prisma_js_1.prisma.$transaction(async (tx) => {
        await (0, due_types_js_1.ensureDefaultDueTypes)(tx, orgId);
        const nextSortOrder = await tx.dueType.count({ where: { organizationId: orgId } });
        return tx.dueType.create({
            data: {
                organizationId: orgId,
                name: parsed.data.name,
                autoAllocate: parsed.data.autoAllocate,
                isActive: true,
                sortOrder: nextSortOrder,
            },
        });
    });
    return res.status(201).json(dueType);
});
exports.dueTypesRouter.patch("/:id", auth_js_1.requireAdmin, async (req, res) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    }
    const dueType = await prisma_js_1.prisma.dueType.findUnique({ where: { id: req.params.id } });
    if (!dueType)
        return res.status(404).json({ error: "Due type not found" });
    if (req.auth.role !== "super_user" && dueType.organizationId !== req.auth.organizationId) {
        return res.status(403).json({ error: "Forbidden" });
    }
    if (dueType.systemKey && protectedSystemKeys.has(dueType.systemKey)) {
        return res.status(409).json({ error: "Subscription due type cannot be edited or archived" });
    }
    if (parsed.data.name && parsed.data.name.toLowerCase() !== dueType.name.toLowerCase()) {
        const existing = await prisma_js_1.prisma.dueType.findFirst({
            where: {
                organizationId: dueType.organizationId,
                name: { equals: parsed.data.name, mode: "insensitive" },
                NOT: { id: dueType.id },
            },
        });
        if (existing)
            return res.status(409).json({ error: "A due type with this name already exists" });
    }
    const updated = await prisma_js_1.prisma.dueType.update({
        where: { id: dueType.id },
        data: {
            ...(parsed.data.name !== undefined && { name: parsed.data.name }),
            ...(parsed.data.autoAllocate !== undefined && { autoAllocate: parsed.data.autoAllocate }),
            ...(parsed.data.isActive !== undefined && { isActive: parsed.data.isActive }),
        },
    });
    return res.json(updated);
});
exports.defaultDueTypesForReference = due_types_js_1.DEFAULT_DUE_TYPE_DEFINITIONS;
