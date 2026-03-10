import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireAdmin, withOrgScope } from "../middleware/auth.js";

export const zonesRouter = Router();

zonesRouter.use(requireAuth);
zonesRouter.use(withOrgScope);

function getOrgId(req: any): string | undefined {
  return req.organizationId ?? req.body?.organizationId ?? req.query?.organizationId;
}

const createSchema = z.object({
  name: z.string().min(1).max(100),
  code: z.number().int().min(1),
  organizationId: z.string().optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  isActive: z.boolean().optional(),
});

zonesRouter.get("/", async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId && req.auth!.role !== "super_user")
    return res.status(400).json({ error: "Organization scope required" });

  const includeInactive = req.query.includeInactive === "true";
  const where: any = orgId ? { organizationId: orgId } : {};
  if (!includeInactive) where.isActive = true;

  const zones = await prisma.zone.findMany({
    where,
    orderBy: { code: "asc" },
  });
  return res.json(zones);
});

zonesRouter.post("/", requireAdmin, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

  const orgId = parsed.data.organizationId ?? getOrgId(req);
  if (!orgId) return res.status(400).json({ error: "Organization scope required" });
  if (req.auth!.role !== "super_user" && orgId !== req.auth!.organizationId)
    return res.status(403).json({ error: "Forbidden" });

  const existing = await prisma.zone.findUnique({
    where: { organizationId_code: { organizationId: orgId, code: parsed.data.code } },
  });
  if (existing) return res.status(409).json({ error: "A zone with this code already exists" });

  const zone = await prisma.zone.create({
    data: {
      organizationId: orgId,
      name: parsed.data.name,
      code: parsed.data.code,
    },
  });
  return res.status(201).json(zone);
});

zonesRouter.patch("/:id", requireAdmin, async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

  const zone = await prisma.zone.findUnique({ where: { id: req.params.id } });
  if (!zone) return res.status(404).json({ error: "Zone not found" });
  if (req.auth!.role !== "super_user" && zone.organizationId !== req.auth!.organizationId)
    return res.status(403).json({ error: "Forbidden" });

  const updated = await prisma.zone.update({
    where: { id: req.params.id },
    data: {
      ...(parsed.data.name !== undefined && { name: parsed.data.name }),
      ...(parsed.data.isActive !== undefined && { isActive: parsed.data.isActive }),
    },
  });
  return res.json(updated);
});

zonesRouter.delete("/:id", requireAdmin, async (req, res) => {
  const zone = await prisma.zone.findUnique({ where: { id: req.params.id } });
  if (!zone) return res.status(404).json({ error: "Zone not found" });
  if (req.auth!.role !== "super_user" && zone.organizationId !== req.auth!.organizationId)
    return res.status(403).json({ error: "Forbidden" });

  const usageCount = await prisma.membership.count({
    where: { organizationId: zone.organizationId, areaCode: zone.code },
  });
  if (usageCount > 0) {
    return res.status(409).json({
      error: `Cannot delete this zone — it is used by ${usageCount} membership${usageCount > 1 ? "s" : ""}. Deactivate it instead.`,
    });
  }

  await prisma.zone.delete({ where: { id: req.params.id } });
  return res.status(204).send();
});
