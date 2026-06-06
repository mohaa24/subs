import { Router } from "express";
import { z } from "zod";
import { Permission, UserRole } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import type { Request, Response, NextFunction } from "express";

export const permissionsRouter = Router();

permissionsRouter.use(requireAuth);

const putPermissionsSchema = z.object({
  permissions: z.array(z.string()),
});

export function requirePermission(permission: Permission) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) return res.status(401).json({ error: "Unauthorized" });
    if (req.auth.role === UserRole.super_user || req.auth.role === UserRole.admin) {
      return next();
    }
    const hasPermission = await prisma.userPermission.findFirst({
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

const validPermissions = Object.values(Permission) as string[];

permissionsRouter.get("/:id/permissions", requireAdmin, async (req, res) => {
  const { id } = req.params;
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return res.status(404).json({ error: "User not found" });
  const perms = await prisma.userPermission.findMany({
    where: { userId: id },
    select: { permission: true },
  });
  return res.json({ permissions: perms.map((p) => p.permission) });
});

permissionsRouter.put("/:id/permissions", requireAdmin, async (req, res) => {
  const parsed = putPermissionsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  }
  const { id } = req.params;
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return res.status(404).json({ error: "User not found" });
  const invalid = parsed.data.permissions.filter((p) => !validPermissions.includes(p));
  if (invalid.length > 0) {
    return res.status(400).json({ error: "Invalid permissions", invalid });
  }
  await prisma.$transaction([
    prisma.userPermission.deleteMany({ where: { userId: id } }),
    ...parsed.data.permissions.map((permission) =>
      prisma.userPermission.create({ data: { userId: id, permission: permission as Permission } })
    ),
  ]);
  const perms = await prisma.userPermission.findMany({
    where: { userId: id },
    select: { permission: true },
  });
  return res.json({ permissions: perms.map((p) => p.permission) });
});
