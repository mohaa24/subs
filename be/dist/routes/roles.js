"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rolesRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const prisma_js_1 = require("../lib/prisma.js");
const auth_js_1 = require("../middleware/auth.js");
const permission_catalog_js_1 = require("../lib/permission-catalog.js");
exports.rolesRouter = (0, express_1.Router)();
exports.rolesRouter.use(auth_js_1.requireAuth);
exports.rolesRouter.use(auth_js_1.withOrgScope);
exports.rolesRouter.use(auth_js_1.requireAdmin);
const roleSchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(2).max(80),
    description: zod_1.z.string().trim().max(300).optional().nullable(),
    permissions: zod_1.z.array(zod_1.z.string()).default([]),
});
function getOrgId(req) {
    return req.organizationId ?? req.body?.organizationId ?? req.query?.organizationId;
}
function validatePermissions(permissions) {
    return permissions.filter((permission) => !permission_catalog_js_1.PERMISSION_KEYS.has(permission));
}
exports.rolesRouter.get("/catalog", (_req, res) => res.json(permission_catalog_js_1.PERMISSION_CATALOG));
exports.rolesRouter.get("/", async (req, res) => {
    const organizationId = getOrgId(req);
    if (!organizationId)
        return res.status(400).json({ error: "Organization scope required" });
    const roles = await prisma_js_1.prisma.organizationRole.findMany({
        where: { organizationId },
        include: {
            permissions: { select: { permission: true } },
            _count: { select: { users: true } },
        },
        orderBy: { name: "asc" },
    });
    return res.json(roles.map((role) => ({
        id: role.id,
        name: role.name,
        description: role.description,
        permissions: role.permissions.map((item) => item.permission),
        userCount: role._count.users,
        createdAt: role.createdAt,
        updatedAt: role.updatedAt,
    })));
});
exports.rolesRouter.post("/", async (req, res) => {
    const parsed = roleSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: "Invalid role details", details: parsed.error.flatten() });
    const organizationId = getOrgId(req);
    if (!organizationId)
        return res.status(400).json({ error: "Organization scope required" });
    const invalid = validatePermissions(parsed.data.permissions);
    if (invalid.length)
        return res.status(400).json({ error: "Invalid permissions", invalid });
    const permissions = (0, permission_catalog_js_1.expandPermissions)(parsed.data.permissions);
    try {
        const role = await prisma_js_1.prisma.organizationRole.create({
            data: {
                organizationId,
                name: parsed.data.name,
                description: parsed.data.description || null,
                permissions: { create: permissions.map((permission) => ({ permission })) },
            },
            include: { permissions: { select: { permission: true } } },
        });
        return res.status(201).json({ ...role, permissions: role.permissions.map((item) => item.permission), userCount: 0 });
    }
    catch (error) {
        if (error?.code === "P2002")
            return res.status(409).json({ error: "A role with this name already exists" });
        throw error;
    }
});
exports.rolesRouter.put("/:id", async (req, res) => {
    const parsed = roleSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: "Invalid role details", details: parsed.error.flatten() });
    const organizationId = getOrgId(req);
    const current = await prisma_js_1.prisma.organizationRole.findFirst({ where: { id: req.params.id, organizationId } });
    if (!current)
        return res.status(404).json({ error: "Role not found" });
    const invalid = validatePermissions(parsed.data.permissions);
    if (invalid.length)
        return res.status(400).json({ error: "Invalid permissions", invalid });
    const permissions = (0, permission_catalog_js_1.expandPermissions)(parsed.data.permissions);
    try {
        const role = await prisma_js_1.prisma.$transaction(async (tx) => {
            await tx.organizationRolePermission.deleteMany({ where: { roleId: current.id } });
            return tx.organizationRole.update({
                where: { id: current.id },
                data: {
                    name: parsed.data.name,
                    description: parsed.data.description || null,
                    permissions: { create: permissions.map((permission) => ({ permission })) },
                },
                include: { permissions: { select: { permission: true } }, _count: { select: { users: true } } },
            });
        });
        return res.json({ ...role, permissions: role.permissions.map((item) => item.permission), userCount: role._count.users });
    }
    catch (error) {
        if (error?.code === "P2002")
            return res.status(409).json({ error: "A role with this name already exists" });
        throw error;
    }
});
exports.rolesRouter.post("/:id/duplicate", async (req, res) => {
    const organizationId = getOrgId(req);
    const source = await prisma_js_1.prisma.organizationRole.findFirst({
        where: { id: req.params.id, organizationId },
        include: { permissions: true },
    });
    if (!source)
        return res.status(404).json({ error: "Role not found" });
    let name = `${source.name} Copy`;
    let suffix = 2;
    while (await prisma_js_1.prisma.organizationRole.findFirst({ where: { organizationId, name } }))
        name = `${source.name} Copy ${suffix++}`;
    const role = await prisma_js_1.prisma.organizationRole.create({
        data: {
            organizationId,
            name,
            description: source.description,
            permissions: { create: source.permissions.map(({ permission }) => ({ permission })) },
        },
        include: { permissions: true },
    });
    return res.status(201).json({ ...role, permissions: role.permissions.map((item) => item.permission), userCount: 0 });
});
exports.rolesRouter.delete("/:id", async (req, res) => {
    const organizationId = getOrgId(req);
    const role = await prisma_js_1.prisma.organizationRole.findFirst({
        where: { id: req.params.id, organizationId },
        include: { _count: { select: { users: true } } },
    });
    if (!role)
        return res.status(404).json({ error: "Role not found" });
    if (role._count.users)
        return res.status(409).json({ error: "Reassign this role's users before deleting it" });
    await prisma_js_1.prisma.organizationRole.delete({ where: { id: role.id } });
    return res.status(204).send();
});
