import { Router } from "express";
import { UserRole } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";

export const organizationsRouter = Router();

organizationsRouter.use(requireAuth);

const createSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9_-]+$/),
  defaultMembershipFee: z.number().min(0).optional(),
  isActive: z.boolean().optional(),
  logoUrl: z.string().optional(),
  contactPersonName: z.string().optional(),
  contactPersonPhone: z.string().optional(),
  whatsAppSenderNumber: z.string().optional(),
  address: z.string().optional(),
  joinDate: z.string().optional(),
  proRataMonthly: z.boolean().optional(),
  proRataQuarterly: z.boolean().optional(),
  proRataYearly: z.boolean().optional(),
  lateFeePercentage: z.number().min(0).max(100).optional(),
});

const superUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  slug: z.string().min(1).regex(/^[a-z0-9_-]+$/).optional(),
  defaultMembershipFee: z.number().min(0).optional(),
  isActive: z.boolean().optional(),
  logoUrl: z.string().optional().nullable(),
  contactPersonName: z.string().optional().nullable(),
  contactPersonPhone: z.string().optional().nullable(),
  whatsAppSenderNumber: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  joinDate: z.string().optional().nullable(),
  proRataMonthly: z.boolean().optional(),
  proRataQuarterly: z.boolean().optional(),
  proRataYearly: z.boolean().optional(),
  lateFeePercentage: z.number().min(0).max(100).optional(),
});

const adminUpdateSchema = z.object({
  defaultMembershipFee: z.number().min(0).optional(),
  contactPersonName: z.string().optional().nullable(),
  contactPersonPhone: z.string().optional().nullable(),
  whatsAppSenderNumber: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  proRataMonthly: z.boolean().optional(),
  proRataQuarterly: z.boolean().optional(),
  proRataYearly: z.boolean().optional(),
  lateFeePercentage: z.number().min(0).max(100).optional(),
});

function toOrgPayload(org: any, counts?: { adminsCount?: number; usersCount?: number }) {
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    defaultMembershipFee: Number(org.defaultMembershipFee),
    isActive: org.isActive,
    logoUrl: org.logoUrl ?? null,
    contactPersonName: org.contactPersonName ?? null,
    contactPersonPhone: org.contactPersonPhone ?? null,
    whatsAppSenderNumber: org.whatsAppSenderNumber ?? null,
    address: org.address ?? null,
    joinDate: org.joinDate ?? null,
    proRataMonthly: org.proRataMonthly ?? false,
    proRataQuarterly: org.proRataQuarterly ?? false,
    proRataYearly: org.proRataYearly ?? false,
    lateFeePercentage: Number(org.lateFeePercentage ?? 5),
    createdAt: org.createdAt,
    updatedAt: org.updatedAt,
    adminsCount: counts?.adminsCount ?? 0,
    usersCount: counts?.usersCount ?? 0,
    personsCount: org._count?.persons ?? 0,
    membershipsCount: org._count?.memberships ?? 0,
  };
}

organizationsRouter.get("/", async (req, res) => {
  if (req.auth!.role !== UserRole.super_user) return res.status(403).json({ error: "Forbidden" });

  const [orgs, roleCounts] = await Promise.all([
    prisma.organization.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { persons: true, memberships: true } } },
    }),
    prisma.user.groupBy({
      by: ["organizationId", "role"],
      where: {
        organizationId: { not: null },
        role: { in: [UserRole.admin, UserRole.user] },
      },
      _count: { _all: true },
    }),
  ]);

  const countsByOrg = new Map<string, { adminsCount: number; usersCount: number }>();
  for (const rc of roleCounts) {
    if (!rc.organizationId) continue;
    const current = countsByOrg.get(rc.organizationId) ?? { adminsCount: 0, usersCount: 0 };
    if (rc.role === UserRole.admin) current.adminsCount = rc._count._all;
    if (rc.role === UserRole.user) current.usersCount = rc._count._all;
    countsByOrg.set(rc.organizationId, current);
  }

  return res.json(orgs.map((org) => toOrgPayload(org, countsByOrg.get(org.id))));
});

organizationsRouter.get("/current", async (req, res) => {
  const orgId =
    req.auth!.role === UserRole.super_user
      ? (req.query.organizationId as string | undefined)
      : req.auth!.organizationId ?? undefined;
  if (!orgId) return res.status(400).json({ error: "organizationId required" });

  const [org, roleCounts] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: orgId },
      include: { _count: { select: { persons: true, memberships: true } } },
    }),
    prisma.user.groupBy({
      by: ["role"],
      where: {
        organizationId: orgId,
        role: { in: [UserRole.admin, UserRole.user] },
      },
      _count: { _all: true },
    }),
  ]);
  if (!org) return res.status(404).json({ error: "Organization not found" });

  let adminsCount = 0;
  let usersCount = 0;
  for (const rc of roleCounts) {
    if (rc.role === UserRole.admin) adminsCount = rc._count._all;
    if (rc.role === UserRole.user) usersCount = rc._count._all;
  }

  return res.json(toOrgPayload(org, { adminsCount, usersCount }));
});

organizationsRouter.get("/:id", async (req, res) => {
  if (req.auth!.role !== UserRole.super_user && req.auth!.organizationId !== req.params.id) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const [org, roleCounts] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { persons: true, memberships: true } } },
    }),
    prisma.user.groupBy({
      by: ["role"],
      where: {
        organizationId: req.params.id,
        role: { in: [UserRole.admin, UserRole.user] },
      },
      _count: { _all: true },
    }),
  ]);
  if (!org) return res.status(404).json({ error: "Organization not found" });

  let adminsCount = 0;
  let usersCount = 0;
  for (const rc of roleCounts) {
    if (rc.role === UserRole.admin) adminsCount = rc._count._all;
    if (rc.role === UserRole.user) usersCount = rc._count._all;
  }

  return res.json(toOrgPayload(org, { adminsCount, usersCount }));
});

organizationsRouter.post("/", async (req, res) => {
  if (req.auth!.role !== UserRole.super_user) return res.status(403).json({ error: "Forbidden" });

  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  }
  const existing = await prisma.organization.findUnique({ where: { slug: parsed.data.slug } });
  if (existing) return res.status(409).json({ error: "Slug already in use" });

  const org = await prisma.organization.create({
    data: {
      name: parsed.data.name,
      slug: parsed.data.slug,
      defaultMembershipFee: parsed.data.defaultMembershipFee ?? 0,
      isActive: parsed.data.isActive ?? true,
      logoUrl: parsed.data.logoUrl ?? null,
      contactPersonName: parsed.data.contactPersonName ?? null,
      contactPersonPhone: parsed.data.contactPersonPhone ?? null,
      whatsAppSenderNumber: parsed.data.whatsAppSenderNumber ?? null,
      address: parsed.data.address ?? null,
      joinDate: parsed.data.joinDate ? new Date(parsed.data.joinDate) : null,
      proRataMonthly: parsed.data.proRataMonthly ?? false,
      proRataQuarterly: parsed.data.proRataQuarterly ?? false,
      proRataYearly: parsed.data.proRataYearly ?? false,
      lateFeePercentage: parsed.data.lateFeePercentage ?? 5,
    },
  });
  return res.status(201).json(toOrgPayload(org));
});

organizationsRouter.patch("/:id", async (req, res) => {
  const isSuper = req.auth!.role === UserRole.super_user;
  const isOrgAdmin = req.auth!.role === UserRole.admin && req.auth!.organizationId === req.params.id;
  if (!isSuper && !isOrgAdmin) return res.status(403).json({ error: "Forbidden" });

  if (isSuper) {
    const parsed = superUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    }
    if (parsed.data.slug) {
      const existing = await prisma.organization.findFirst({
        where: { slug: parsed.data.slug, NOT: { id: req.params.id } },
      });
      if (existing) return res.status(409).json({ error: "Slug already in use" });
    }
    const data: any = { ...parsed.data };
    if (data.joinDate !== undefined) {
      data.joinDate = data.joinDate ? new Date(data.joinDate) : null;
    }
    const org = await prisma.organization.update({
      where: { id: req.params.id },
      data,
    });
    return res.json(toOrgPayload(org));
  }

  const parsed = adminUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  }
  const data: any = {};
  if (parsed.data.defaultMembershipFee !== undefined) data.defaultMembershipFee = parsed.data.defaultMembershipFee;
  if (parsed.data.contactPersonName !== undefined) data.contactPersonName = parsed.data.contactPersonName;
  if (parsed.data.contactPersonPhone !== undefined) data.contactPersonPhone = parsed.data.contactPersonPhone;
  if (parsed.data.whatsAppSenderNumber !== undefined) data.whatsAppSenderNumber = parsed.data.whatsAppSenderNumber;
  if (parsed.data.address !== undefined) data.address = parsed.data.address;
  if (parsed.data.proRataMonthly !== undefined) data.proRataMonthly = parsed.data.proRataMonthly;
  if (parsed.data.proRataQuarterly !== undefined) data.proRataQuarterly = parsed.data.proRataQuarterly;
  if (parsed.data.proRataYearly !== undefined) data.proRataYearly = parsed.data.proRataYearly;
  if (parsed.data.lateFeePercentage !== undefined) data.lateFeePercentage = parsed.data.lateFeePercentage;
  const org = await prisma.organization.update({
    where: { id: req.params.id },
    data,
  });
  return res.json(toOrgPayload(org));
});
