import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma.js";
import { UserRole } from "@prisma/client";

export interface AuthPayload {
  userId: string;
  email: string;
  role: UserRole;
  organizationId: string | null;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthPayload;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const secret = process.env.JWT_SECRET || "dev-secret";
    const decoded = jwt.verify(token, secret) as AuthPayload;
    req.auth = decoded;
    if (decoded.role !== UserRole.super_user) {
      if (!decoded.organizationId) {
        return res.status(403).json({ error: "Organization scope required" });
      }
      const org = await prisma.organization.findUnique({
        where: { id: decoded.organizationId },
        select: { isActive: true },
      });
      if (!org || !org.isActive) {
        return res.status(403).json({ error: "Organization is inactive" });
      }
      const currentUser = await prisma.user.findUnique({ where: { id: decoded.userId }, select: { isActive: true } });
      if (!currentUser?.isActive) return res.status(403).json({ error: "Your user account is inactive" });
    }
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) return res.status(401).json({ error: "Unauthorized" });
    if (!roles.includes(req.auth.role)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  };
}

export function requireSuperUser(req: Request, res: Response, next: NextFunction) {
  return requireRole(UserRole.super_user)(req, res, next);
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  return requireRole(UserRole.super_user, UserRole.admin)(req, res, next);
}

export function withOrgScope(req: Request, _res: Response, next: NextFunction) {
  if (req.auth?.role === UserRole.super_user) {
    const selectedOrganizationId = req.header("x-organization-id")?.trim();
    (req as Request & { organizationId?: string }).organizationId = selectedOrganizationId || undefined;
  } else if (req.auth?.organizationId) {
    (req as Request & { organizationId?: string }).organizationId = req.auth.organizationId;
  }
  next();
}
