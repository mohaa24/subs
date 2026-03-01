import { Router } from "express";
import * as bcrypt from "bcryptjs";
import { z } from "zod";
import { UserRole } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";

export const usersRouter = Router();

usersRouter.use(requireAuth);

const createSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  role: z.enum(["admin", "user"]),
  organizationId: z.string().optional(),
  phoneNumber: z.string().optional(),
});

const updateMeSchema = z.object({
  locale: z.enum(["en", "ta", "si"]).optional(),
  phoneNumber: z.string().optional().nullable(),
});

usersRouter.get("/", requireAdmin, async (req, res) => {
  const orgId = req.auth!.role === "super_user" ? (req.query.organizationId as string) : req.auth!.organizationId;
  const list = await prisma.user.findMany({
    where: orgId ? { organizationId: orgId } : {},
    select: {
      id: true, email: true, role: true, organizationId: true, phoneNumber: true, locale: true,
      createdAt: true, organization: { select: { id: true, name: true, slug: true } },
      permissions: { select: { permission: true } },
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
  const orgId = parsed.data.organizationId ?? (isSuper ? undefined : req.auth!.organizationId);
  if (!orgId) return res.status(400).json({ error: "organizationId required" });
  // Schema restricts role to admin|user; super_user cannot be created via this endpoint
  const existing = await prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
  if (existing) return res.status(409).json({ error: "Email already in use" });
  const passwordHash = await bcrypt.hash(parsed.data.password, 10);
  const user = await prisma.user.create({
    data: {
      email: parsed.data.email.toLowerCase(),
      passwordHash,
      role: parsed.data.role as UserRole,
      organizationId: orgId || null,
      phoneNumber: parsed.data.phoneNumber ?? null,
    },
    select: { id: true, email: true, role: true, organizationId: true, phoneNumber: true, locale: true },
  });
  return res.status(201).json(user);
});
