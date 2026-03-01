"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.permissionsRouter = void 0;
exports.requirePermission = requirePermission;
const express_1 = require("express");
const zod_1 = require("zod");
const client_1 = require("@prisma/client");
const prisma_js_1 = require("../lib/prisma.js");
const auth_js_1 = require("../middleware/auth.js");
exports.permissionsRouter = (0, express_1.Router)();
exports.permissionsRouter.use(auth_js_1.requireAuth);
const putPermissionsSchema = zod_1.z.object({
    permissions: zod_1.z.array(zod_1.z.string()),
});
function requirePermission(permission) {
    return async (req, res, next) => {
        if (!req.auth)
            return res.status(401).json({ error: "Unauthorized" });
        if (req.auth.role === client_1.UserRole.super_user || req.auth.role === client_1.UserRole.admin) {
            return next();
        }
        const hasPermission = await prisma_js_1.prisma.userPermission.findFirst({
            where: {
                userId: req.auth.userId,
                permission,
            },
        });
        if (!hasPermission) {
            return res.status(403).json({ error: "Forbidden" });
        }
        next();
    };
}
const validPermissions = Object.values(client_1.Permission);
exports.permissionsRouter.get("/:id/permissions", auth_js_1.requireAdmin, async (req, res) => {
    const { id } = req.params;
    const user = await prisma_js_1.prisma.user.findUnique({ where: { id } });
    if (!user)
        return res.status(404).json({ error: "User not found" });
    const perms = await prisma_js_1.prisma.userPermission.findMany({
        where: { userId: id },
        select: { permission: true },
    });
    return res.json({ permissions: perms.map((p) => p.permission) });
});
exports.permissionsRouter.put("/:id/permissions", auth_js_1.requireAdmin, async (req, res) => {
    const parsed = putPermissionsSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    }
    const { id } = req.params;
    const user = await prisma_js_1.prisma.user.findUnique({ where: { id } });
    if (!user)
        return res.status(404).json({ error: "User not found" });
    const invalid = parsed.data.permissions.filter((p) => !validPermissions.includes(p));
    if (invalid.length > 0) {
        return res.status(400).json({ error: "Invalid permissions", invalid });
    }
    await prisma_js_1.prisma.$transaction([
        prisma_js_1.prisma.userPermission.deleteMany({ where: { userId: id } }),
        ...parsed.data.permissions.map((permission) => prisma_js_1.prisma.userPermission.create({ data: { userId: id, permission: permission } })),
    ]);
    const perms = await prisma_js_1.prisma.userPermission.findMany({
        where: { userId: id },
        select: { permission: true },
    });
    return res.json({ permissions: perms.map((p) => p.permission) });
});
