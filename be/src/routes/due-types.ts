import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireAdmin, withOrgScope } from "../middleware/auth.js";
import {
  DEFAULT_DUE_TYPE_DEFINITIONS,
  ensureDefaultDueTypes,
} from "../lib/due-types.js";

export const dueTypesRouter = Router();

dueTypesRouter.use(requireAuth);
dueTypesRouter.use(withOrgScope);

function getOrgId(req: any): string | undefined {
  return req.organizationId ?? req.body?.organizationId ?? req.query?.organizationId;
}

const protectedSystemKeys = new Set(["subscription"]);

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  autoAllocate: z.boolean().default(false),
  organizationId: z.string().optional(),
});

const updateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  autoAllocate: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

dueTypesRouter.get("/", async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId && req.auth!.role !== "super_user") {
    return res.status(400).json({ error: "Organization scope required" });
  }

  if (orgId) {
    await prisma.$transaction((tx) => ensureDefaultDueTypes(tx, orgId));
  }

  const includeInactive = req.query.includeInactive === "true";
  const where: any = orgId ? { organizationId: orgId } : {};
  if (!includeInactive) where.isActive = true;

  const dueTypes = await prisma.dueType.findMany({
    where,
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return res.json(dueTypes);
});

dueTypesRouter.post("/", requireAdmin, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  }

  const orgId = parsed.data.organizationId ?? getOrgId(req);
  if (!orgId) return res.status(400).json({ error: "Organization scope required" });
  if (req.auth!.role !== "super_user" && orgId !== req.auth!.organizationId) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const existing = await prisma.dueType.findFirst({
    where: {
      organizationId: orgId,
      name: { equals: parsed.data.name, mode: "insensitive" },
    },
  });
  if (existing) return res.status(409).json({ error: "A due type with this name already exists" });

  const dueType = await prisma.$transaction(async (tx) => {
    await ensureDefaultDueTypes(tx, orgId);
    const nextSortOrder = await tx.dueType.count({ where: { organizationId: orgId } });
    return tx.dueType.create({
      data: {
        organizationId: orgId,
        name: parsed.data.name,
        autoAllocate: parsed.data.autoAllocate,
        isActive: true,
        sortOrder: nextSortOrder,
      },
    });
  });

  return res.status(201).json(dueType);
});

dueTypesRouter.patch("/:id", requireAdmin, async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  }

  const dueType = await prisma.dueType.findUnique({ where: { id: req.params.id } });
  if (!dueType) return res.status(404).json({ error: "Due type not found" });
  if (req.auth!.role !== "super_user" && dueType.organizationId !== req.auth!.organizationId) {
    return res.status(403).json({ error: "Forbidden" });
  }

  if (dueType.systemKey && protectedSystemKeys.has(dueType.systemKey)) {
    return res.status(409).json({ error: "Subscription due type cannot be edited or archived" });
  }

  if (parsed.data.name && parsed.data.name.toLowerCase() !== dueType.name.toLowerCase()) {
    const existing = await prisma.dueType.findFirst({
      where: {
        organizationId: dueType.organizationId,
        name: { equals: parsed.data.name, mode: "insensitive" },
        NOT: { id: dueType.id },
      },
    });
    if (existing) return res.status(409).json({ error: "A due type with this name already exists" });
  }

  const updated = await prisma.dueType.update({
    where: { id: dueType.id },
    data: {
      ...(parsed.data.name !== undefined && { name: parsed.data.name }),
      ...(parsed.data.autoAllocate !== undefined && { autoAllocate: parsed.data.autoAllocate }),
      ...(parsed.data.isActive !== undefined && { isActive: parsed.data.isActive }),
    },
  });

  return res.json(updated);
});

export const defaultDueTypesForReference = DEFAULT_DUE_TYPE_DEFINITIONS;
