"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.permissionsRouter = void 0;
exports.getUserPermissions = getUserPermissions;
exports.requirePermission = requirePermission;
exports.requireAnyPermission = requireAnyPermission;
const express_1 = require("express");
const client_1 = require("@prisma/client");
const prisma_js_1 = require("../lib/prisma.js");
const auth_js_1 = require("../middleware/auth.js");
const permission_catalog_js_1 = require("../lib/permission-catalog.js");
exports.permissionsRouter = (0, express_1.Router)();
exports.permissionsRouter.use(auth_js_1.requireAuth);
async function getUserPermissions(userId) {
    const user = await prisma_js_1.prisma.user.findUnique({
        where: { id: userId },
        select: {
            role: true,
            isActive: true,
            organizationRole: { select: { permissions: { select: { permission: true } } } },
        },
    });
    if (!user || !user.isActive)
        return [];
    if (user.role === client_1.UserRole.super_user || user.role === client_1.UserRole.admin)
        return permission_catalog_js_1.PERMISSION_CATALOG.map((item) => item.key);
    const assigned = user.organizationRole?.permissions.map((item) => item.permission) ?? [];
    return (0, permission_catalog_js_1.expandPermissions)(assigned);
}
function requirePermission(permission) {
    return async (req, res, next) => {
        if (!req.auth)
            return res.status(401).json({ error: "Unauthorized" });
        if (req.auth.role === client_1.UserRole.super_user || req.auth.role === client_1.UserRole.admin)
            return next();
        const permissions = await getUserPermissions(req.auth.userId);
        if (!permissions.includes(permission)) {
            return res.status(403).json({ error: "You do not have permission to perform this action. Contact your organisation administrator." });
        }
        next();
    };
}
function requireAnyPermission(...required) {
    return async (req, res, next) => {
        if (!req.auth)
            return res.status(401).json({ error: "Unauthorized" });
        if (req.auth.role === client_1.UserRole.super_user || req.auth.role === client_1.UserRole.admin)
            return next();
        const permissions = await getUserPermissions(req.auth.userId);
        if (!required.some((permission) => permissions.includes(permission))) {
            return res.status(403).json({ error: "You do not have permission to perform this action. Contact your organisation administrator." });
        }
        next();
    };
}
