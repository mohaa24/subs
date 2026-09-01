import { Router } from "express";
import * as bcrypt from "bcryptjs";
import { z } from "zod";
import { UserRole } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireAdmin, withOrgScope } from "../middleware/auth.js";

export const usersRouter = Router();

usersRouter.use(requireAuth);
usersRouter.use(withOrgScope);

const createSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  role: z.enum(["admin", "user"]).default("user"),
  organizationId: z.string().optional(),
  phoneNumber: z.string().optional(),
  organizationRoleId: z.string().optional().nullable(),
});

const updateUserSchema = z.object({
  organizationRoleId: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
  phoneNumber: z.string().optional().nullable(),
});

const updateMeSchema = z.object({
  locale: z.enum(["en", "ta", "si"]).optional(),
  phoneNumber: z.string().optional().nullable(),
});

usersRouter.get("/", requireAdmin, async (req, res) => {
  const orgId = req.auth!.role === "super_user" ? ((req as any).organizationId ?? req.query.organizationId as string) : req.auth!.organizationId;
  const list = await prisma.user.findMany({
    where: orgId ? { organizationId: orgId } : {},
    select: {
      id: true, email: true, role: true, organizationId: true, phoneNumber: true, locale: true, isActive: true, organizationRoleId: true,
      createdAt: true, organization: { select: { id: true, name: true, slug: true } },
      organizationRole: { select: { id: true, name: true, permissions: { select: { permission: true } } } },
    },
  });
  return res.json(list);
});

usersRouter.patch("/me", async (req, res) => {
  const parsed = updateMeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  }
  const data: any = {};
  if (parsed.data.locale !== undefined) data.locale = parsed.data.locale;
  if (parsed.data.phoneNumber !== undefined) data.phoneNumber = parsed.data.phoneNumber;
  const user = await prisma.user.update({
    where: { id: req.auth!.userId },
    data,
    select: { id: true, email: true, role: true, locale: true, phoneNumber: true },
  });
  return res.json(user);
});

usersRouter.post("/", requireAdmin, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  }
  const isSuper = req.auth!.role === "super_user";
  if (!isSuper && parsed.data.role !== "user") return res.status(403).json({ error: "Organisation administrators can only create role-based users" });
  const orgId = parsed.data.organizationId ?? (isSuper ? (req as any).organizationId : req.auth!.organizationId);
  if (!orgId) return res.status(400).json({ error: "organizationId required" });
  // Schema restricts role to admin|user; super_user cannot be created via this endpoint
  const existing = await prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
  if (existing) return res.status(409).json({ error: "Email already in use" });
  const passwordHash = await bcrypt.hash(parsed.data.password, 10);
  if (parsed.data.role === "user" && !parsed.data.organizationRoleId) return res.status(400).json({ error: "Select a role for this user" });
  if (parsed.data.role === "user" && parsed.data.organizationRoleId) {
    const assignedRole = await prisma.organizationRole.findFirst({ where: { id: parsed.data.organizationRoleId, organizationId: orgId } });
    if (!assignedRole) return res.status(400).json({ error: "Selected role does not belong to this organisation" });
  }
  const user = await prisma.user.create({
    data: {
      email: parsed.data.email.toLowerCase(),
      passwordHash,
      role: parsed.data.role as UserRole,
      organizationId: orgId || null,
      phoneNumber: parsed.data.phoneNumber ?? null,
      organizationRoleId: parsed.data.role === "user" ? parsed.data.organizationRoleId ?? null : null,
    },
    select: { id: true, email: true, role: true, organizationId: true, phoneNumber: true, locale: true, isActive: true, organizationRoleId: true, organizationRole: { select: { id: true, name: true } } },
  });
  return res.status(201).json(user);
});

usersRouter.patch("/:id", requireAdmin, async (req, res) => {
  const parsed = updateUserSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  const orgId = req.auth!.role === "super_user" ? (req as any).organizationId : req.auth!.organizationId;
  const current = await prisma.user.findFirst({ where: { id: req.params.id, ...(orgId ? { organizationId: orgId } : {}) } });
  if (!current || current.role === "super_user") return res.status(404).json({ error: "User not found" });
  if (req.auth!.role !== "super_user" && current.role !== "user") return res.status(403).json({ error: "Organisation administrators can only manage role-based users" });
  if (current.role === "user" && parsed.data.organizationRoleId === null) return res.status(400).json({ error: "A role is required for this user" });
  if (parsed.data.organizationRoleId) {
    const assignedRole = await prisma.organizationRole.findFirst({ where: { id: parsed.data.organizationRoleId, organizationId: current.organizationId! } });
    if (!assignedRole) return res.status(400).json({ error: "Selected role does not belong to this organisation" });
  }
  const user = await prisma.user.update({
    where: { id: current.id },
    data: parsed.data,
    select: { id: true, email: true, role: true, organizationId: true, phoneNumber: true, locale: true, isActive: true, organizationRoleId: true, organizationRole: { select: { id: true, name: true } } },
  });
  return res.json(user);
});
