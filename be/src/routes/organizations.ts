import { Request, Response, Router } from "express";
import { UserRole } from "@prisma/client";
import multer from "multer";
import { promises as fs } from "fs";
import { dirname, join, resolve } from "path";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { ensureDefaultDueTypes } from "../lib/due-types.js";

export const organizationsRouter = Router();

organizationsRouter.use(requireAuth);

const uploadsDir = process.env.UPLOADS_DIR || resolve(process.cwd(), "uploads");
const receiptLogoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "image/png") return cb(null, true);
    cb(new Error("Receipt logo must be a PNG image"));
  },
});

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
    receiptLogoUrl: org.receiptLogoUrl ?? null,
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

  const org = await prisma.$transaction(async (tx) => {
    const created = await tx.organization.create({
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
    await ensureDefaultDueTypes(tx, created.id);
    return created;
  });
  return res.status(201).json(toOrgPayload(org));
});

function canManageOrgReceiptLogo(req: Request, orgId: string) {
  return req.auth!.role === UserRole.super_user ||
    (req.auth!.role === UserRole.admin && req.auth!.organizationId === orgId);
}

function runReceiptLogoUpload(req: Request, res: Response) {
  return new Promise<void>((resolveUpload, rejectUpload) => {
    receiptLogoUpload.single("file")(req, res, (err) => {
      if (err) rejectUpload(err);
      else resolveUpload();
    });
  });
}

function receiptLogoPublicPath(orgId: string, version = Date.now()) {
  return `/uploads/organizations/${orgId}/receipt-logo.png?v=${version}`;
}

function receiptLogoFilePath(orgId: string) {
  return join(uploadsDir, "organizations", orgId, "receipt-logo.png");
}

function isPngBuffer(buffer: Buffer) {
  return buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a;
}

organizationsRouter.post("/:id/receipt-logo", async (req, res) => {
  if (!canManageOrgReceiptLogo(req, req.params.id)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  try {
    await runReceiptLogoUpload(req, res);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to upload receipt logo";
    return res.status(400).json({ error: message });
  }

  const file = req.file;
  if (!file) return res.status(400).json({ error: "Receipt logo file is required" });
  if (!isPngBuffer(file.buffer)) {
    return res.status(400).json({ error: "Receipt logo must be a valid PNG image" });
  }

  const existing = await prisma.organization.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Organization not found" });

  const filePath = receiptLogoFilePath(req.params.id);
  await fs.mkdir(dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, file.buffer);

  const org = await prisma.organization.update({
    where: { id: req.params.id },
    data: { receiptLogoUrl: receiptLogoPublicPath(req.params.id) },
  });

  return res.json(toOrgPayload(org));
});

organizationsRouter.delete("/:id/receipt-logo", async (req, res) => {
  if (!canManageOrgReceiptLogo(req, req.params.id)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const existing = await prisma.organization.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Organization not found" });

  await fs.rm(receiptLogoFilePath(req.params.id), { force: true });
  const org = await prisma.organization.update({
    where: { id: req.params.id },
    data: { receiptLogoUrl: null },
  });

  return res.json(toOrgPayload(org));
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
