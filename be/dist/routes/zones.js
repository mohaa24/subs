"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.zonesRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const prisma_js_1 = require("../lib/prisma.js");
const auth_js_1 = require("../middleware/auth.js");
exports.zonesRouter = (0, express_1.Router)();
exports.zonesRouter.use(auth_js_1.requireAuth);
exports.zonesRouter.use(auth_js_1.withOrgScope);
const maxZoneCode = 9;
function getOrgId(req) {
    return req.organizationId ?? req.body?.organizationId ?? req.query?.organizationId;
}
const createSchema = zod_1.z.object({
    name: zod_1.z.string().min(1).max(100),
    code: zod_1.z.number().int().min(1).max(maxZoneCode),
    organizationId: zod_1.z.string().optional(),
});
const updateSchema = zod_1.z.object({
    name: zod_1.z.string().min(1).max(100).optional(),
    isActive: zod_1.z.boolean().optional(),
});
exports.zonesRouter.get("/", async (req, res) => {
    const orgId = getOrgId(req);
    if (!orgId && req.auth.role !== "super_user")
        return res.status(400).json({ error: "Organization scope required" });
    const includeInactive = req.query.includeInactive === "true";
    const where = orgId ? { organizationId: orgId } : {};
    if (!includeInactive)
        where.isActive = true;
    const zones = await prisma_js_1.prisma.zone.findMany({
        where,
        orderBy: { code: "asc" },
    });
    return res.json(zones);
});
exports.zonesRouter.post("/", auth_js_1.requireAdmin, async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    const orgId = parsed.data.organizationId ?? getOrgId(req);
    if (!orgId)
        return res.status(400).json({ error: "Organization scope required" });
    if (req.auth.role !== "super_user" && orgId !== req.auth.organizationId)
        return res.status(403).json({ error: "Forbidden" });
    const existing = await prisma_js_1.prisma.zone.findUnique({
        where: { organizationId_code: { organizationId: orgId, code: parsed.data.code } },
    });
    if (existing)
        return res.status(409).json({ error: "A zone with this code already exists" });
    const zone = await prisma_js_1.prisma.zone.create({
        data: {
            organizationId: orgId,
            name: parsed.data.name,
            code: parsed.data.code,
        },
    });
    return res.status(201).json(zone);
});
exports.zonesRouter.patch("/:id", auth_js_1.requireAdmin, async (req, res) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    const zone = await prisma_js_1.prisma.zone.findUnique({ where: { id: req.params.id } });
    if (!zone)
        return res.status(404).json({ error: "Zone not found" });
    if (req.auth.role !== "super_user" && zone.organizationId !== req.auth.organizationId)
        return res.status(403).json({ error: "Forbidden" });
    const updated = await prisma_js_1.prisma.zone.update({
        where: { id: req.params.id },
        data: {
            ...(parsed.data.name !== undefined && { name: parsed.data.name }),
            ...(parsed.data.isActive !== undefined && { isActive: parsed.data.isActive }),
        },
    });
    return res.json(updated);
});
exports.zonesRouter.delete("/:id", auth_js_1.requireAdmin, async (req, res) => {
    const zone = await prisma_js_1.prisma.zone.findUnique({ where: { id: req.params.id } });
    if (!zone)
        return res.status(404).json({ error: "Zone not found" });
    if (req.auth.role !== "super_user" && zone.organizationId !== req.auth.organizationId)
        return res.status(403).json({ error: "Forbidden" });
    const [membershipUsageCount, personUsageCount] = await Promise.all([
        prisma_js_1.prisma.membership.count({
            where: { organizationId: zone.organizationId, areaCode: zone.code },
        }),
        prisma_js_1.prisma.person.count({
            where: { organizationId: zone.organizationId, areaCode: zone.code },
        }),
    ]);
    const usageCount = membershipUsageCount + personUsageCount;
    if (usageCount > 0) {
        return res.status(409).json({
            error: `Cannot delete this zone because it is used by ${usageCount} record${usageCount > 1 ? "s" : ""} (${membershipUsageCount} membership${membershipUsageCount === 1 ? "" : "s"}, ${personUsageCount} person${personUsageCount === 1 ? "" : "s"}). Deactivate it instead.`,
        });
    }
    await prisma_js_1.prisma.zone.delete({ where: { id: req.params.id } });
    return res.status(204).send();
});
