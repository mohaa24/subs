import { Router } from "express";
import { z } from "zod";
import { MembershipType, MembershipStatus, PaymentPeriod, RelationToHOH, DependentGroup, Prisma } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "../lib/prisma.js";
import { requireAuth, withOrgScope } from "../middleware/auth.js";

export const membershipsRouter = Router();

membershipsRouter.use(requireAuth);
membershipsRouter.use(withOrgScope);

const paymentPeriods: PaymentPeriod[] = ["Monthly", "Quarterly", "Annually"];
const membershipStatuses: MembershipStatus[] = ["Active", "Inactive"];
const maxZoneCode = 9;
const spouseRelations: RelationToHOH[] = ["Wife"];
const relationToHohOptions: RelationToHOH[] = [
  "Husband",
  "Wife",
  "Son",
  "Daughter",
  "AdoptedSon",
  "AdoptedDaughter",
  "Father",
  "Mother",
  "StepFather",
  "StepMother",
  "Brother",
  "Sister",
  "Grandfather",
  "Grandmother",
  "Grandson",
  "Granddaughter",
  "SonInLaw",
  "DaughterInLaw",
  "Uncle",
  "Aunt",
  "Nephew",
  "Niece",
  "Cousin",
  "FatherInLaw",
  "MotherInLaw",
];
const dependentGroups: DependentGroup[] = ["children", "other"];

const dependentSchema = z.object({
  personId: z.string(),
  relationToHOH: z.enum(relationToHohOptions as unknown as [string, ...string[]]),
  group: z.enum(dependentGroups as unknown as [string, ...string[]]),
});

const baseSchema = z.object({
  organizationId: z.string().optional(),
  dateOfRegistration: z.string(),
  membershipType: z.enum(["Resident", "NonResident", "Widow", "Widower"] as [MembershipType, ...MembershipType[]]),
  membershipStatus: z.enum(membershipStatuses as unknown as [string, ...string[]]),
  hodPersonId: z.string(),
  spousePersonId: z.string().optional().nullable(),
  spouseRelationToHOH: z.enum(spouseRelations as unknown as [string, ...string[]]).optional().nullable(),
  dependentPersons: z.array(dependentSchema).optional(),
  isZakathEligible: z.boolean().optional().nullable(),
  areaCode: z.number().int().min(1).max(maxZoneCode),
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

const createSchema = baseSchema;

const updateSchema = baseSchema.partial();

type DependentInput = z.infer<typeof dependentSchema>;
type PersonAssignment = { personId: string; relationToHOH: RelationToHOH | null };

function getOrgId(req: { organizationId?: string; auth?: { organizationId: string | null; role: string }; query?: { organizationId?: string }; body?: { organizationId?: string } }) {
  const orgId = req.organizationId ?? req.body?.organizationId ?? req.query?.organizationId;
  return orgId as string | undefined;
}

function toDecimal(n: number) {
  return new Decimal(n);
}

function defaultDependentRelation(group: DependentGroup): RelationToHOH {
  return group === "children" ? "Son" : "Cousin";
}

function buildAssignments(
  hodPersonId: string,
  spousePersonId: string | null,
  spouseRelationToHOH: RelationToHOH | null,
  dependentPersons: DependentInput[]
): PersonAssignment[] {
  const assignments: PersonAssignment[] = [{ personId: hodPersonId, relationToHOH: null }];
  if (spousePersonId && spouseRelationToHOH) {
    assignments.push({ personId: spousePersonId, relationToHOH: spouseRelationToHOH });
  }
  assignments.push(
    ...dependentPersons.map((dep) => ({ personId: dep.personId, relationToHOH: dep.relationToHOH as RelationToHOH }))
  );
  return assignments;
}

function validateNoRoleDuplicates(assignments: PersonAssignment[]) {
  const ids = assignments.map((a) => a.personId);
  if (new Set(ids).size !== ids.length) {
    throw new Error("A person cannot be assigned to multiple roles in the same membership");
  }
}

async function ensurePeopleAssignable(
  orgId: string,
  assignments: PersonAssignment[],
  currentMembershipId: string | null
) {
  const personIds = assignments.map((a) => a.personId);
  const people = await prisma.person.findMany({
    where: { id: { in: personIds } },
    select: { id: true, fullName: true, organizationId: true, membershipId: true },
  });

  if (people.length !== personIds.length) {
    throw new Error("One or more selected people were not found");
  }

  for (const p of people) {
    if (p.organizationId !== orgId) {
      throw new Error("One or more selected people belong to a different organization");
    }
    if (p.membershipId && p.membershipId !== currentMembershipId) {
      throw new Error(`${p.fullName} already belongs to another membership`);
    }
  }

  const personIdsSet = new Set(personIds);
  const memberships = await prisma.membership.findMany({
    where: {
      organizationId: orgId,
      ...(currentMembershipId ? { NOT: { id: currentMembershipId } } : {}),
      OR: [
        { hodPersonId: { in: personIds } },
        { spousePersonId: { in: personIds } },
        { dependents: { some: { personId: { in: personIds } } } },
      ],
    },
    select: {
      id: true,
      hodPersonId: true,
      spousePersonId: true,
      dependents: { select: { personId: true } },
    },
  });

  if (memberships.length > 0) {
    const conflicted = new Set<string>();
    for (const m of memberships) {
      if (personIdsSet.has(m.hodPersonId)) conflicted.add(m.hodPersonId);
      if (m.spousePersonId && personIdsSet.has(m.spousePersonId)) conflicted.add(m.spousePersonId);
      for (const dep of m.dependents) {
        if (personIdsSet.has(dep.personId)) conflicted.add(dep.personId);
      }
    }
    if (conflicted.size > 0) {
      const conflictPerson = people.find((p) => conflicted.has(p.id));
      throw new Error(`${conflictPerson?.fullName ?? "A selected person"} already belongs to another membership`);
    }
  }
}

function formatMembershipZoneSegment(areaCode: number): string {
  return String(areaCode);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function ensureZoneExists(organizationId: string, areaCode: number) {
  const org = await prisma.organization.findUnique({ where: { id: organizationId } });
  if (!org) {
    throw new Error("Organization not found");
  }
  const zone = await prisma.zone.findFirst({
    where: { organizationId, code: areaCode },
    select: { id: true },
  });
  if (!zone) {
    throw new Error("Selected zone was not found");
  }
}

async function nextMembershipNo(organizationId: string, areaCode: number): Promise<string> {
  const org = await prisma.organization.findUnique({ where: { id: organizationId } });
  const slug = org?.slug ?? "ORG";
  const zoneSegment = formatMembershipZoneSegment(areaCode);
  const prefix = `${slug}-${zoneSegment}`;
  const membershipNos = await prisma.membership.findMany({
    where: {
      organizationId,
      membershipNo: { startsWith: prefix },
    },
    select: { membershipNo: true },
  });
  const regex = new RegExp(`^${escapeRegExp(prefix)}(\\d{3,})$`);
  const maxSequence = membershipNos.reduce((highest, membership) => {
    const match = regex.exec(membership.membershipNo);
    if (!match) return highest;
    const sequence = Number.parseInt(match[1], 10);
    return Number.isNaN(sequence) ? highest : Math.max(highest, sequence);
  }, 0);
  return `${prefix}${String(maxSequence + 1).padStart(3, "0")}`;
}

async function applyPersonLinks(
  tx: Prisma.TransactionClient,
  membershipId: string,
  oldPersonIds: string[],
  assignments: PersonAssignment[]
) {
  const newIds = assignments.map((a) => a.personId);
  const removedIds = oldPersonIds.filter((id) => !newIds.includes(id));
  if (removedIds.length > 0) {
    await tx.person.updateMany({
      where: { id: { in: removedIds } },
      data: { membershipId: null, relationToHOH: null },
    });
  }

  for (const assignment of assignments) {
    await tx.person.update({
      where: { id: assignment.personId },
      data: {
        membershipId,
        relationToHOH: assignment.relationToHOH,
      },
    });
  }
}

membershipsRouter.get("/", async (req, res) => {
  const orgId = getOrgId(req as any);
  if (!orgId && req.auth!.role !== "super_user") return res.status(400).json({ error: "Organization scope required" });
  const q = (req.query.q as string)?.trim() || "";
  const includeArchived = req.query.includeArchived === "true";
  const membershipType = (req.query.membershipType as string)?.trim() || "";
  const membershipStatus = (req.query.membershipStatus as string)?.trim() || "";
  const paymentPeriod = (req.query.paymentPeriod as string)?.trim() || "";
  const areaCode = Number.parseInt(String(req.query.areaCode ?? ""), 10);
  const zakathEligible = (req.query.isZakathEligible as string)?.trim() || "";
  const disability = (req.query.disability as string)?.trim() || "";
  const registeredFrom = (req.query.registeredFrom as string)?.trim() || "";
  const registeredTo = (req.query.registeredTo as string)?.trim() || "";
  const page = Math.max(1, parseInt(String(req.query.page), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit), 10) || 10));
  const where: any = {};
  if (orgId) where.organizationId = orgId;
  if (!includeArchived) where.isArchived = false;
  if (membershipType && (["Resident", "NonResident", "Widow", "Widower"] as string[]).includes(membershipType)) {
    where.membershipType = membershipType;
  }
  if (membershipStatus && membershipStatuses.includes(membershipStatus as MembershipStatus)) {
    where.membershipStatus = membershipStatus as MembershipStatus;
  }
  if (paymentPeriod && paymentPeriods.includes(paymentPeriod as PaymentPeriod)) {
    where.paymentPeriod = paymentPeriod as PaymentPeriod;
  }
  if (Number.isInteger(areaCode) && areaCode > 0 && areaCode <= maxZoneCode) where.areaCode = areaCode;
  if (zakathEligible === "true") where.isZakathEligible = true;
  if (zakathEligible === "false") where.isZakathEligible = false;
  if (zakathEligible === "unset") where.isZakathEligible = null;
  if (disability === "true") where.disability = true;
  if (disability === "false") where.disability = false;
  if (registeredFrom || registeredTo) {
    const dateFilter: { gte?: Date; lt?: Date } = {};
    if (registeredFrom) {
      const from = new Date(registeredFrom);
      if (!Number.isNaN(from.getTime())) dateFilter.gte = from;
    }
    if (registeredTo) {
      const to = new Date(registeredTo);
      if (!Number.isNaN(to.getTime())) {
        to.setDate(to.getDate() + 1);
        dateFilter.lt = to;
      }
    }
    if (Object.keys(dateFilter).length > 0) where.dateOfRegistration = dateFilter;
  }
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
        hod: { select: { id: true, nameWithInitials: true, fullName: true, nicNumber: true, relationToHOH: true } },
        spouse: { select: { id: true, nameWithInitials: true, fullName: true, relationToHOH: true } },
        dependents: {
          include: {
            person: { select: { id: true, nameWithInitials: true, fullName: true, relationToHOH: true } },
          },
        },
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
      organization: { select: { id: true, name: true, slug: true, address: true } },
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

  const dependentPersons = parsed.data.dependentPersons ?? [];
  const spousePersonId = parsed.data.spousePersonId ?? null;
  const spouseRelationToHOH: RelationToHOH | null = spousePersonId ? "Wife" : null;
  const assignments = buildAssignments(parsed.data.hodPersonId, spousePersonId, spouseRelationToHOH as RelationToHOH | null, dependentPersons);

  try {
    validateNoRoleDuplicates(assignments);
    await ensurePeopleAssignable(orgId, assignments, null);
    await ensureZoneExists(orgId, parsed.data.areaCode);
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : "Invalid household assignment" });
  }

  const membershipNo = await nextMembershipNo(orgId, parsed.data.areaCode);
  const payload = {
    organizationId: orgId,
    membershipNo,
    dateOfRegistration: new Date(parsed.data.dateOfRegistration),
    membershipType: parsed.data.membershipType,
    membershipStatus: parsed.data.membershipStatus as MembershipStatus,
    hodPersonId: parsed.data.hodPersonId,
    spousePersonId,
    isZakathEligible: parsed.data.isZakathEligible ?? null,
    areaCode: parsed.data.areaCode,
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

  const membership = await prisma.$transaction(async (tx) => {
    const created = await tx.membership.create({
      data: {
        ...payload,
        dependents: {
          create: dependentPersons.map((dep, order) => ({
            personId: dep.personId,
            group: dep.group as DependentGroup,
            order,
          })),
        },
      },
      include: {
        hod: true,
        spouse: true,
        dependents: { include: { person: true } },
      },
    });
    await applyPersonLinks(tx, created.id, [], assignments);
    return created;
  });

  return res.status(201).json(membership);
});

membershipsRouter.patch("/:id", async (req, res) => {
  const existing = await prisma.membership.findUnique({
    where: { id: req.params.id },
    include: {
      spouse: { select: { id: true, relationToHOH: true } },
      dependents: {
        include: {
          person: { select: { id: true, relationToHOH: true } },
        },
      },
    },
  });
  if (!existing) return res.status(404).json({ error: "Membership not found" });
  if (req.auth!.organizationId && existing.organizationId !== req.auth!.organizationId && req.auth!.role !== "super_user") {
    return res.status(403).json({ error: "Forbidden" });
  }

  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  }

  const nextHodPersonId = parsed.data.hodPersonId ?? existing.hodPersonId;
  const nextSpousePersonId =
    parsed.data.spousePersonId !== undefined ? parsed.data.spousePersonId ?? null : existing.spousePersonId;

  const nextSpouseRelationToHOH: RelationToHOH | null = nextSpousePersonId ? "Wife" : null;

  const nextDependentPersons: DependentInput[] =
    parsed.data.dependentPersons ??
    existing.dependents.map((dep) => ({
      personId: dep.personId,
      group: dep.group,
      relationToHOH: (dep.person.relationToHOH as RelationToHOH | null) ?? defaultDependentRelation(dep.group),
    }));

  const assignments = buildAssignments(
    nextHodPersonId,
    nextSpousePersonId,
    nextSpouseRelationToHOH,
    nextDependentPersons
  );

  try {
    validateNoRoleDuplicates(assignments);
    await ensurePeopleAssignable(existing.organizationId, assignments, existing.id);
    if (parsed.data.areaCode !== undefined) {
      await ensureZoneExists(existing.organizationId, parsed.data.areaCode);
    }
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : "Invalid household assignment" });
  }

  const oldPersonIds = [
    existing.hodPersonId,
    ...(existing.spousePersonId ? [existing.spousePersonId] : []),
    ...existing.dependents.map((d) => d.personId),
  ];

  const data: any = { ...parsed.data };
  delete data.organizationId;
  delete data.dependentPersons;
  delete data.spouseRelationToHOH;

  if (data.dateOfRegistration) data.dateOfRegistration = new Date(data.dateOfRegistration);
  if (data.membershipStatus !== undefined) data.membershipStatus = data.membershipStatus as MembershipStatus;
  if (data.membershipFee !== undefined) data.membershipFee = toDecimal(data.membershipFee);
  if (data.additionalVoluntaryContributions !== undefined) data.additionalVoluntaryContributions = toDecimal(data.additionalVoluntaryContributions);
  if (data.membershipFeeDiscount !== undefined) data.membershipFeeDiscount = toDecimal(data.membershipFeeDiscount);
  if (data.totalContribution !== undefined) data.totalContribution = toDecimal(data.totalContribution);

  const membership = await prisma.$transaction(async (tx) => {
    const updated = await tx.membership.update({
      where: { id: req.params.id },
      data: {
        ...data,
        spousePersonId: nextSpousePersonId,
        dependents:
          parsed.data.dependentPersons !== undefined
            ? {
                deleteMany: {},
                create: nextDependentPersons.map((dep, order) => ({
                  personId: dep.personId,
                  group: dep.group as DependentGroup,
                  order,
                })),
              }
            : undefined,
      },
      include: {
        hod: true,
        spouse: true,
        dependents: { include: { person: true } },
      },
    });
    await applyPersonLinks(tx, updated.id, oldPersonIds, assignments);
    return updated;
  });

  return res.json(membership);
});

membershipsRouter.patch("/:id/archive", async (req, res) => {
  const membership = await prisma.membership.findUnique({ where: { id: req.params.id } });
  if (!membership) return res.status(404).json({ error: "Membership not found" });
  const orgId = getOrgId(req as any);
  if (orgId && membership.organizationId !== orgId && req.auth!.role !== "super_user") {
    return res.status(403).json({ error: "Forbidden" });
  }
  const isArchived = req.body.isArchived === true;
  const updated = await prisma.membership.update({
    where: { id: req.params.id },
    data: { isArchived },
    include: {
      hod: { select: { id: true, nameWithInitials: true, fullName: true } },
    },
  });
  return res.json(updated);
});
