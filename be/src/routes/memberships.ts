import { Router } from "express";
import { z } from "zod";
import { MembershipType, PaymentPeriod } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "../lib/prisma.js";
import { requireAuth, withOrgScope } from "../middleware/auth.js";

export const membershipsRouter = Router();

membershipsRouter.use(requireAuth);
membershipsRouter.use(withOrgScope);

const paymentPeriods: PaymentPeriod[] = ["Monthly", "Quarterly", "Annually"];

const createSchema = z.object({
  organizationId: z.string().optional(),
  dateOfRegistration: z.string(),
  membershipType: z.enum(["Resident", "NonResident", "Widow", "Widower"] as [MembershipType, ...MembershipType[]]),
  membershipStatus: z.string().min(1),
  hodPersonId: z.string(),
  spousePersonId: z.string().optional().nullable(),
  dependentPersonIds: z.array(z.string()).optional(),
  land: z.boolean().optional(),
  houseOwnership: z.boolean().optional(),
  commercialProperties: z.boolean().optional(),
  toiletFacility: z.boolean().optional(),
  vehicleOwnership: z.boolean().optional(),
  waterAccessibility: z.boolean().optional(),
  electricity: z.boolean().optional(),
  paymentPeriod: z.enum(paymentPeriods as unknown as [string, ...string[]]),
  membershipFee: z.number().min(0),
  additionalVoluntaryContributions: z.number().min(0).optional(),
  membershipFeeDiscount: z.number().min(0).optional(),
  totalContribution: z.number().min(0),
  disability: z.boolean().optional(),
});

const updateSchema = createSchema.partial();

function getOrgId(req: { organizationId?: string; auth?: { organizationId: string | null; role: string }; query?: { organizationId?: string }; body?: { organizationId?: string } }) {
  const orgId = req.organizationId ?? req.body?.organizationId ?? req.query?.organizationId;
  return orgId as string | undefined;
}

function toDecimal(n: number) {
  return new Decimal(n);
}

async function nextMembershipNo(organizationId: string): Promise<string> {
  const org = await prisma.organization.findUnique({ where: { id: organizationId } });
  const slug = org?.slug ?? "ORG";
  const year = new Date().getFullYear();
  const count = await prisma.membership.count({
    where: { organizationId, membershipNo: { startsWith: `${slug}-${year}-` } },
  });
  return `${slug}-${year}-${String(count + 1).padStart(5, "0")}`;
}

membershipsRouter.get("/", async (req, res) => {
  const orgId = getOrgId(req as any);
  if (!orgId && req.auth!.role !== "super_user") return res.status(400).json({ error: "Organization scope required" });
  const q = (req.query.q as string)?.trim() || "";
  const page = Math.max(1, parseInt(String(req.query.page), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit), 10) || 10));
  const where: { organizationId?: string; OR?: Array<{ membershipNo?: { contains: string; mode: "insensitive" }; hod?: { fullName?: { contains: string; mode: "insensitive" }; nameWithInitials?: { contains: string; mode: "insensitive" } } }> } = {};
  if (orgId) where.organizationId = orgId;
  if (q) {
    where.OR = [
      { membershipNo: { contains: q, mode: "insensitive" } },
      { hod: { fullName: { contains: q, mode: "insensitive" } } },
      { hod: { nameWithInitials: { contains: q, mode: "insensitive" } } },
    ];
  }
  const [items, total] = await Promise.all([
    prisma.membership.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { dateOfRegistration: "desc" },
      include: {
        hod: { select: { id: true, nameWithInitials: true, fullName: true, nicNumber: true } },
        spouse: { select: { id: true, nameWithInitials: true, fullName: true } },
        dependents: { include: { person: { select: { id: true, nameWithInitials: true, fullName: true } } } },
      },
    }),
    prisma.membership.count({ where }),
  ]);
  return res.json({ items, total, page, limit });
});

membershipsRouter.get("/lookup", async (req, res) => {
  const orgId = getOrgId(req as any);
  if (!orgId && req.auth!.role !== "super_user") return res.status(400).json({ error: "Organization scope required" });
  const q = (req.query.q as string)?.trim() || "";
  const list = await prisma.membership.findMany({
    where: { organizationId: orgId!, membershipNo: { contains: q, mode: "insensitive" } },
    take: 20,
    select: { id: true, membershipNo: true, hod: { select: { fullName: true } } },
  });
  return res.json(list);
});

membershipsRouter.get("/:id", async (req, res) => {
  const membership = await prisma.membership.findFirst({
    where: { id: req.params.id },
    include: {
      hod: true,
      spouse: true,
      dependents: { orderBy: { order: "asc" }, include: { person: true } },
      organization: { select: { id: true, name: true, slug: true } },
      createdBy: { select: { id: true, email: true } },
    },
  });
  if (!membership) return res.status(404).json({ error: "Membership not found" });
  if (req.auth!.organizationId && membership.organizationId !== req.auth!.organizationId && req.auth!.role !== "super_user") {
    return res.status(403).json({ error: "Forbidden" });
  }
  return res.json(membership);
});

membershipsRouter.post("/", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  }
  const orgId = parsed.data.organizationId ?? (req as any).organizationId ?? req.auth!.organizationId;
  if (!orgId) return res.status(400).json({ error: "organizationId required" });
  if (req.auth!.role !== "super_user" && orgId !== req.auth!.organizationId) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const membershipNo = await nextMembershipNo(orgId);
  const dependentPersonIds = parsed.data.dependentPersonIds ?? [];
  const payload = {
    organizationId: orgId,
    membershipNo,
    dateOfRegistration: new Date(parsed.data.dateOfRegistration),
    membershipType: parsed.data.membershipType,
    membershipStatus: parsed.data.membershipStatus,
    hodPersonId: parsed.data.hodPersonId,
    spousePersonId: parsed.data.spousePersonId || null,
    land: parsed.data.land ?? false,
    houseOwnership: parsed.data.houseOwnership ?? false,
    commercialProperties: parsed.data.commercialProperties ?? false,
    toiletFacility: parsed.data.toiletFacility ?? false,
    vehicleOwnership: parsed.data.vehicleOwnership ?? false,
    waterAccessibility: parsed.data.waterAccessibility ?? false,
    electricity: parsed.data.electricity ?? false,
    paymentPeriod: parsed.data.paymentPeriod as PaymentPeriod,
    membershipFee: toDecimal(parsed.data.membershipFee),
    additionalVoluntaryContributions: toDecimal(parsed.data.additionalVoluntaryContributions ?? 0),
    membershipFeeDiscount: toDecimal(parsed.data.membershipFeeDiscount ?? 0),
    totalContribution: toDecimal(parsed.data.totalContribution),
    disability: parsed.data.disability ?? false,
    createdByUserId: req.auth!.userId,
  };
  const membership = await prisma.membership.create({
    data: {
      ...payload,
      dependents: {
        create: dependentPersonIds.map((personId, order) => ({ personId, order })),
      },
    },
    include: {
      hod: true,
      spouse: true,
      dependents: { include: { person: true } },
    },
  });
  return res.status(201).json(membership);
});

membershipsRouter.patch("/:id", async (req, res) => {
  const existing = await prisma.membership.findUnique({
    where: { id: req.params.id },
    include: { dependents: true },
  });
  if (!existing) return res.status(404).json({ error: "Membership not found" });
  if (req.auth!.organizationId && existing.organizationId !== req.auth!.organizationId && req.auth!.role !== "super_user") {
    return res.status(403).json({ error: "Forbidden" });
  }
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  }
  const data: any = { ...parsed.data };
  delete data.organizationId;
  delete data.dependentPersonIds;
  if (data.dateOfRegistration) data.dateOfRegistration = new Date(data.dateOfRegistration);
  if (data.membershipFee !== undefined) data.membershipFee = toDecimal(data.membershipFee);
  if (data.additionalVoluntaryContributions !== undefined) data.additionalVoluntaryContributions = toDecimal(data.additionalVoluntaryContributions);
  if (data.membershipFeeDiscount !== undefined) data.membershipFeeDiscount = toDecimal(data.membershipFeeDiscount);
  if (data.totalContribution !== undefined) data.totalContribution = toDecimal(data.totalContribution);
  if (parsed.data.dependentPersonIds !== undefined) {
    await prisma.membershipDependent.deleteMany({ where: { membershipId: req.params.id } });
    data.dependents = {
      create: parsed.data.dependentPersonIds.map((personId, order) => ({ personId, order })),
    };
  }
  const membership = await prisma.membership.update({
    where: { id: req.params.id },
    data,
    include: {
      hod: true,
      spouse: true,
      dependents: { include: { person: true } },
    },
  });
  return res.json(membership);
});
