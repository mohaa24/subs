import { Router } from "express";
import { UserRole } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { expandPermissions, PERMISSION_CATALOG, type PermissionKey } from "../lib/permission-catalog.js";
import type { Request, Response, NextFunction } from "express";

export const permissionsRouter = Router();
permissionsRouter.use(requireAuth);

export async function getUserPermissions(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      role: true,
      isActive: true,
      organizationRole: { select: { permissions: { select: { permission: true } } } },
    },
  });
  if (!user || !user.isActive) return [];
  if (user.role === UserRole.super_user || user.role === UserRole.admin) return PERMISSION_CATALOG.map((item) => item.key);
  const assigned = user.organizationRole?.permissions.map((item) => item.permission) ?? [];
  return expandPermissions(assigned);
}

export function requirePermission(permission: PermissionKey | string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) return res.status(401).json({ error: "Unauthorized" });
    if (req.auth.role === UserRole.super_user || req.auth.role === UserRole.admin) return next();
    const permissions = await getUserPermissions(req.auth.userId);
    if (!permissions.includes(permission)) {
      return res.status(403).json({ error: "You do not have permission to perform this action. Contact your organisation administrator." });
    }
    next();
  };
}

export function requireAnyPermission(...required: (PermissionKey | string)[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) return res.status(401).json({ error: "Unauthorized" });
    if (req.auth.role === UserRole.super_user || req.auth.role === UserRole.admin) return next();
    const permissions = await getUserPermissions(req.auth.userId);
    if (!required.some((permission) => permissions.includes(permission))) {
      return res.status(403).json({ error: "You do not have permission to perform this action. Contact your organisation administrator." });
    }
    next();
  };
}
