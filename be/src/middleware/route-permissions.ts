import type { NextFunction, Request, Response } from "express";
import { requirePermission } from "../routes/permissions.js";

export type PermissionResolver = (req: Request) => string | null;

export function enforceRoutePermissions(resolve: PermissionResolver) {
  return (req: Request, res: Response, next: NextFunction) => {
    const permission = resolve(req);
    if (!permission) return next();
    return requirePermission(permission)(req, res, next);
  };
}

export function readWritePermissions(read: string, create: string, edit = create): PermissionResolver {
  return (req) => {
    if (req.method === "GET" || req.method === "HEAD") return read;
    if (req.method === "POST") return create;
    return edit;
  };
}
