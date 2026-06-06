import { Router } from "express";
import * as bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthPayload } from "../middleware/auth.js";

export const authRouter = Router();

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  }
  const { email, password } = parsed.data;
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    include: { organization: true },
  });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: "Invalid email or password" });
  }
  if (user.role !== "super_user" && (!user.organization || !user.organization.isActive)) {
    return res.status(403).json({ error: "Organization is inactive" });
  }
  const payload: AuthPayload = {
    userId: user.id,
    email: user.email,
    role: user.role,
    organizationId: user.organizationId,
  };
  const secret = process.env.JWT_SECRET || "dev-secret";
  const token = jwt.sign(payload, secret, { expiresIn: "7d" });
  return res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId,
      organization: user.organization
        ? {
            id: user.organization.id,
            name: user.organization.name,
            slug: user.organization.slug,
            defaultMembershipFee: Number(user.organization.defaultMembershipFee),
            isActive: user.organization.isActive,
          }
        : null,
    },
  });
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.auth!.userId },
    include: { organization: true, permissions: { select: { permission: true } } },
  });
  if (!user) return res.status(404).json({ error: "User not found" });
  return res.json({
    id: user.id,
    email: user.email,
    role: user.role,
    locale: user.locale,
    phoneNumber: user.phoneNumber,
    organizationId: user.organizationId,
    permissions: user.permissions.map((p: any) => p.permission),
    organization: user.organization
      ? {
          id: user.organization.id,
          name: user.organization.name,
          slug: user.organization.slug,
          defaultMembershipFee: Number(user.organization.defaultMembershipFee),
          isActive: user.organization.isActive,
        }
      : null,
  });
});
