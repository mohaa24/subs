import { Router } from "express";
import { z } from "zod";
import { DistributionFrequency } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requireAuth, withOrgScope } from "../middleware/auth.js";

export const distributionsRouter = Router();

distributionsRouter.use(requireAuth);
distributionsRouter.use(withOrgScope);

function getOrgId(req: any): string | undefined {
  return req.organizationId ?? req.body?.organizationId ?? req.query?.organizationId;
}

function getCurrentDistributionDate(frequency: DistributionFrequency): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  if (frequency === DistributionFrequency.Once) return "once";
  if (frequency === DistributionFrequency.Daily) return `${y}-${m}-${d}`;
  if (frequency === DistributionFrequency.Monthly) return `${y}-${m}`;
  return String(y);
}

function buildEligibleWhere(
  organizationId: string,
  filterCriteria: unknown
): Prisma.PersonWhereInput {
  const where: Prisma.PersonWhereInput = { organizationId };
  if (!filterCriteria || typeof filterCriteria !== "object") return where;
  const fc = filterCriteria as Record<string, unknown>;

  if (typeof fc.isDisabled === "boolean") where.isDisabled = fc.isDisabled;
  if (typeof fc.isMadarasaStudent === "boolean") where.isMadarasaStudent = fc.isMadarasaStudent;
  if (typeof fc.membershipType === "string" && fc.membershipType) {
    where.membership = { membershipType: fc.membershipType as any };
  }
  if (typeof fc.minAge === "number" || typeof fc.maxAge === "number") {
    const now = new Date();
    const dob: { gte?: Date; lte?: Date } = {};
    // minAge 18 => person >= 18 => birthDate <= today - 18 years
    if (typeof fc.minAge === "number") {
      dob.lte = new Date(now.getFullYear() - fc.minAge, now.getMonth(), now.getDate());
    }
    // maxAge 65 => person <= 65 => birthDate >= today - 65 years
    if (typeof fc.maxAge === "number") {
      dob.gte = new Date(now.getFullYear() - fc.maxAge - 1, now.getMonth(), now.getDate() + 1);
    }
    where.dateOfBirth = dob;
  }
  return where;
}

const createSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  frequency: z.enum(["Once", "Daily", "Monthly", "Yearly"]),
  filterCriteria: z.record(z.any()).optional(),
  isActive: z.boolean().optional(),
});

const updateSchema = createSchema.partial();

const scanSchema = z.object({
  personId: z.string().min(1),
});

distributionsRouter.get("/", async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId && req.auth!.role !== "super_user")
    return res.status(400).json({ error: "Organization scope required" });
  const where: { organizationId?: string } = {};
  if (orgId) where.organizationId = orgId;
  const distributions = await prisma.distribution.findMany({
    where,
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      description: true,
      organizationId: true,
      frequency: true,
      filterCriteria: true,
      isActive: true,
      createdByUserId: true,
      createdAt: true,
    },
  });
  return res.json(distributions);
});

distributionsRouter.post("/", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  const orgId = getOrgId(req);
  if (!orgId && req.auth!.role !== "super_user")
    return res.status(400).json({ error: "Organization scope required" });
  if (req.auth!.organizationId && orgId !== req.auth!.organizationId)
    return res.status(403).json({ error: "Forbidden" });

  const dist = await prisma.distribution.create({
    data: {
      organizationId: orgId!,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      frequency: parsed.data.frequency as DistributionFrequency,
      filterCriteria: parsed.data.filterCriteria ?? undefined,
      isActive: parsed.data.isActive ?? true,
      createdByUserId: req.auth!.userId,
    },
    select: {
      id: true,
      name: true,
      description: true,
      organizationId: true,
      frequency: true,
      filterCriteria: true,
      isActive: true,
      createdByUserId: true,
      createdAt: true,
    },
  });
  return res.status(201).json(dist);
});

distributionsRouter.delete("/:id", async (req, res) => {
  const dist = await prisma.distribution.findUnique({ where: { id: req.params.id } });
  if (!dist) return res.status(404).json({ error: "Distribution not found" });
  if (req.auth!.organizationId && dist.organizationId !== req.auth!.organizationId && req.auth!.role !== "super_user")
    return res.status(403).json({ error: "Forbidden" });
  await prisma.distributionRecord.deleteMany({ where: { distributionId: dist.id } });
  await prisma.distribution.delete({ where: { id: dist.id } });
  return res.status(204).send();
});

distributionsRouter.post("/:id/complete", async (req, res) => {
  const dist = await prisma.distribution.findUnique({ where: { id: req.params.id } });
  if (!dist) return res.status(404).json({ error: "Distribution not found" });
  if (req.auth!.organizationId && dist.organizationId !== req.auth!.organizationId && req.auth!.role !== "super_user")
    return res.status(403).json({ error: "Forbidden" });
  const updated = await prisma.distribution.update({
    where: { id: dist.id },
    data: { isActive: false },
  });
  return res.json(updated);
});

distributionsRouter.patch("/:id", async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  const dist = await prisma.distribution.findUnique({ where: { id: req.params.id } });
  if (!dist) return res.status(404).json({ error: "Distribution not found" });
  if (req.auth!.organizationId && dist.organizationId !== req.auth!.organizationId && req.auth!.role !== "super_user")
    return res.status(403).json({ error: "Forbidden" });

  const updated = await prisma.distribution.update({
    where: { id: req.params.id },
    data: {
      ...(parsed.data.name !== undefined && { name: parsed.data.name }),
      ...(parsed.data.description !== undefined && { description: parsed.data.description ?? null }),
      ...(parsed.data.frequency !== undefined && { frequency: parsed.data.frequency as DistributionFrequency }),
      ...(parsed.data.filterCriteria !== undefined && { filterCriteria: parsed.data.filterCriteria ?? undefined }),
      ...(parsed.data.isActive !== undefined && { isActive: parsed.data.isActive }),
    },
    select: {
      id: true,
      name: true,
      description: true,
      organizationId: true,
      frequency: true,
      filterCriteria: true,
      isActive: true,
      createdByUserId: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return res.json(updated);
});

distributionsRouter.get("/:id", async (req, res) => {
  const dist = await prisma.distribution.findUnique({ where: { id: req.params.id } });
  if (!dist) return res.status(404).json({ error: "Distribution not found" });
  if (req.auth!.organizationId && dist.organizationId !== req.auth!.organizationId && req.auth!.role !== "super_user")
    return res.status(403).json({ error: "Forbidden" });

  const currentDate = getCurrentDistributionDate(dist.frequency);
  const eligibleWhere = buildEligibleWhere(dist.organizationId, dist.filterCriteria);

  const [totalEligible, totalDistributed] = await Promise.all([
    prisma.person.count({ where: eligibleWhere }),
    prisma.distributionRecord.count({
      where: {
        distributionId: dist.id,
        distributionDate: currentDate,
      },
    }),
  ]);

  return res.json({
    ...dist,
    totalEligible,
    totalDistributed,
    currentCycleDate: currentDate,
  });
});

distributionsRouter.post("/:id/scan", async (req, res) => {
  const parsed = scanSchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

  const dist = await prisma.distribution.findUnique({ where: { id: req.params.id } });
  if (!dist) return res.status(404).json({ error: "Distribution not found" });
  if (req.auth!.organizationId && dist.organizationId !== req.auth!.organizationId && req.auth!.role !== "super_user")
    return res.status(403).json({ error: "Forbidden" });

  const person = await prisma.person.findFirst({
    where: { id: parsed.data.personId, organizationId: dist.organizationId },
  });
  if (!person) return res.status(404).json({ error: "Person not found" });

  const distributionDate = getCurrentDistributionDate(dist.frequency);
  const existing = await prisma.distributionRecord.findUnique({
    where: {
      distributionId_personId_distributionDate: {
        distributionId: dist.id,
        personId: parsed.data.personId,
        distributionDate,
      },
    },
  });

  if (existing) {
    return res.json({
      success: false,
      alreadyDistributed: true,
      person: { name: person.fullName || person.nameWithInitials },
    });
  }

  await prisma.distributionRecord.create({
    data: {
      distributionId: dist.id,
      personId: parsed.data.personId,
      distributionDate,
      distributedByUserId: req.auth!.userId,
    },
  });

  return res.json({
    success: true,
    person: { name: person.fullName || person.nameWithInitials },
  });
});

distributionsRouter.get("/:id/records", async (req, res) => {
  const dist = await prisma.distribution.findUnique({ where: { id: req.params.id } });
  if (!dist) return res.status(404).json({ error: "Distribution not found" });
  if (req.auth!.organizationId && dist.organizationId !== req.auth!.organizationId && req.auth!.role !== "super_user")
    return res.status(403).json({ error: "Forbidden" });

  const page = Math.max(1, parseInt(String(req.query.page), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit), 10) || 10));
  const distributionDate = (req.query.distributionDate as string) || getCurrentDistributionDate(dist.frequency);

  const [records, total] = await Promise.all([
    prisma.distributionRecord.findMany({
      where: { distributionId: dist.id, distributionDate },
      include: { person: { select: { id: true, fullName: true, nameWithInitials: true } } },
      orderBy: { distributedAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.distributionRecord.count({
      where: { distributionId: dist.id, distributionDate },
    }),
  ]);

  const items = records.map((r) => ({
    id: r.id,
    personId: r.personId,
    personName: r.person.fullName || r.person.nameWithInitials,
    distributedAt: r.distributedAt,
    distributionDate: r.distributionDate,
  }));

  return res.json({ items, total, page, limit });
});

distributionsRouter.get("/:id/report", async (req, res) => {
  const dist = await prisma.distribution.findUnique({ where: { id: req.params.id } });
  if (!dist) return res.status(404).json({ error: "Distribution not found" });
  if (req.auth!.organizationId && dist.organizationId !== req.auth!.organizationId && req.auth!.role !== "super_user")
    return res.status(403).json({ error: "Forbidden" });

  const currentDate = getCurrentDistributionDate(dist.frequency);
  const eligibleWhere = buildEligibleWhere(dist.organizationId, dist.filterCriteria);

  const [totalEligible, totalDistributed] = await Promise.all([
    prisma.person.count({ where: eligibleWhere }),
    prisma.distributionRecord.count({
      where: {
        distributionId: dist.id,
        distributionDate: currentDate,
      },
    }),
  ]);

  const totalPending = Math.max(0, totalEligible - totalDistributed);
  const completionPercentage = totalEligible > 0 ? Math.round((totalDistributed / totalEligible) * 100) : 0;

  return res.json({
    distributionId: dist.id,
    name: dist.name,
    currentCycleDate: currentDate,
    totalEligible,
    totalDistributed,
    totalPending,
    completionPercentage,
  });
});
