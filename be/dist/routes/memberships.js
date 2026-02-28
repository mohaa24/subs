"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.membershipsRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const library_1 = require("@prisma/client/runtime/library");
const prisma_js_1 = require("../lib/prisma.js");
const auth_js_1 = require("../middleware/auth.js");
exports.membershipsRouter = (0, express_1.Router)();
exports.membershipsRouter.use(auth_js_1.requireAuth);
exports.membershipsRouter.use(auth_js_1.withOrgScope);
const paymentPeriods = ["Monthly", "Quarterly", "Annually"];
const spouseRelations = ["Husband", "Wife"];
const relationToHohOptions = [
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
const dependentGroups = ["children", "other"];
const dependentSchema = zod_1.z.object({
    personId: zod_1.z.string(),
    relationToHOH: zod_1.z.enum(relationToHohOptions),
    group: zod_1.z.enum(dependentGroups),
});
const baseSchema = zod_1.z.object({
    organizationId: zod_1.z.string().optional(),
    dateOfRegistration: zod_1.z.string(),
    membershipType: zod_1.z.enum(["Resident", "NonResident", "Widow", "Widower"]),
    membershipStatus: zod_1.z.string().min(1),
    hodPersonId: zod_1.z.string(),
    spousePersonId: zod_1.z.string().optional().nullable(),
    spouseRelationToHOH: zod_1.z.enum(spouseRelations).optional().nullable(),
    dependentPersons: zod_1.z.array(dependentSchema).optional(),
    land: zod_1.z.boolean().optional(),
    houseOwnership: zod_1.z.boolean().optional(),
    commercialProperties: zod_1.z.boolean().optional(),
    toiletFacility: zod_1.z.boolean().optional(),
    vehicleOwnership: zod_1.z.boolean().optional(),
    waterAccessibility: zod_1.z.boolean().optional(),
    electricity: zod_1.z.boolean().optional(),
    paymentPeriod: zod_1.z.enum(paymentPeriods),
    membershipFee: zod_1.z.number().min(0),
    additionalVoluntaryContributions: zod_1.z.number().min(0).optional(),
    membershipFeeDiscount: zod_1.z.number().min(0).optional(),
    totalContribution: zod_1.z.number().min(0),
    disability: zod_1.z.boolean().optional(),
});
const createSchema = baseSchema.superRefine((data, ctx) => {
    if (data.spousePersonId && !data.spouseRelationToHOH) {
        ctx.addIssue({
            code: zod_1.z.ZodIssueCode.custom,
            path: ["spouseRelationToHOH"],
            message: "spouseRelationToHOH is required when spousePersonId is set",
        });
    }
});
const updateSchema = baseSchema.partial().superRefine((data, ctx) => {
    if (data.spousePersonId && !data.spouseRelationToHOH) {
        ctx.addIssue({
            code: zod_1.z.ZodIssueCode.custom,
            path: ["spouseRelationToHOH"],
            message: "spouseRelationToHOH is required when spousePersonId is set",
        });
    }
});
function getOrgId(req) {
    const orgId = req.organizationId ?? req.body?.organizationId ?? req.query?.organizationId;
    return orgId;
}
function toDecimal(n) {
    return new library_1.Decimal(n);
}
function defaultDependentRelation(group) {
    return group === "children" ? "Son" : "Cousin";
}
function buildAssignments(hodPersonId, spousePersonId, spouseRelationToHOH, dependentPersons) {
    const assignments = [{ personId: hodPersonId, relationToHOH: null }];
    if (spousePersonId && spouseRelationToHOH) {
        assignments.push({ personId: spousePersonId, relationToHOH: spouseRelationToHOH });
    }
    assignments.push(...dependentPersons.map((dep) => ({ personId: dep.personId, relationToHOH: dep.relationToHOH })));
    return assignments;
}
function validateNoRoleDuplicates(assignments) {
    const ids = assignments.map((a) => a.personId);
    if (new Set(ids).size !== ids.length) {
        throw new Error("A person cannot be assigned to multiple roles in the same membership");
    }
}
async function ensurePeopleAssignable(orgId, assignments, currentMembershipId) {
    const personIds = assignments.map((a) => a.personId);
    const people = await prisma_js_1.prisma.person.findMany({
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
    const memberships = await prisma_js_1.prisma.membership.findMany({
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
        const conflicted = new Set();
        for (const m of memberships) {
            if (personIdsSet.has(m.hodPersonId))
                conflicted.add(m.hodPersonId);
            if (m.spousePersonId && personIdsSet.has(m.spousePersonId))
                conflicted.add(m.spousePersonId);
            for (const dep of m.dependents) {
                if (personIdsSet.has(dep.personId))
                    conflicted.add(dep.personId);
            }
        }
        if (conflicted.size > 0) {
            const conflictPerson = people.find((p) => conflicted.has(p.id));
            throw new Error(`${conflictPerson?.fullName ?? "A selected person"} already belongs to another membership`);
        }
    }
}
async function nextMembershipNo(organizationId) {
    const org = await prisma_js_1.prisma.organization.findUnique({ where: { id: organizationId } });
    const slug = org?.slug ?? "ORG";
    const year = new Date().getFullYear();
    const count = await prisma_js_1.prisma.membership.count({
        where: { organizationId, membershipNo: { startsWith: `${slug}-${year}-` } },
    });
    return `${slug}-${year}-${String(count + 1).padStart(5, "0")}`;
}
async function applyPersonLinks(tx, membershipId, oldPersonIds, assignments) {
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
exports.membershipsRouter.get("/", async (req, res) => {
    const orgId = getOrgId(req);
    if (!orgId && req.auth.role !== "super_user")
        return res.status(400).json({ error: "Organization scope required" });
    const q = req.query.q?.trim() || "";
    const page = Math.max(1, parseInt(String(req.query.page), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit), 10) || 10));
    const where = {};
    if (orgId)
        where.organizationId = orgId;
    if (q) {
        where.OR = [
            { membershipNo: { contains: q, mode: "insensitive" } },
            { hod: { fullName: { contains: q, mode: "insensitive" } } },
            { hod: { nameWithInitials: { contains: q, mode: "insensitive" } } },
        ];
    }
    const [items, total] = await Promise.all([
        prisma_js_1.prisma.membership.findMany({
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
        prisma_js_1.prisma.membership.count({ where }),
    ]);
    return res.json({ items, total, page, limit });
});
exports.membershipsRouter.get("/lookup", async (req, res) => {
    const orgId = getOrgId(req);
    if (!orgId && req.auth.role !== "super_user")
        return res.status(400).json({ error: "Organization scope required" });
    const q = req.query.q?.trim() || "";
    const list = await prisma_js_1.prisma.membership.findMany({
        where: { organizationId: orgId, membershipNo: { contains: q, mode: "insensitive" } },
        take: 20,
        select: { id: true, membershipNo: true, hod: { select: { fullName: true } } },
    });
    return res.json(list);
});
exports.membershipsRouter.get("/:id", async (req, res) => {
    const membership = await prisma_js_1.prisma.membership.findFirst({
        where: { id: req.params.id },
        include: {
            hod: true,
            spouse: true,
            dependents: { orderBy: { order: "asc" }, include: { person: true } },
            organization: { select: { id: true, name: true, slug: true } },
            createdBy: { select: { id: true, email: true } },
        },
    });
    if (!membership)
        return res.status(404).json({ error: "Membership not found" });
    if (req.auth.organizationId && membership.organizationId !== req.auth.organizationId && req.auth.role !== "super_user") {
        return res.status(403).json({ error: "Forbidden" });
    }
    return res.json(membership);
});
exports.membershipsRouter.post("/", async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    }
    const orgId = parsed.data.organizationId ?? req.organizationId ?? req.auth.organizationId;
    if (!orgId)
        return res.status(400).json({ error: "organizationId required" });
    if (req.auth.role !== "super_user" && orgId !== req.auth.organizationId) {
        return res.status(403).json({ error: "Forbidden" });
    }
    const dependentPersons = parsed.data.dependentPersons ?? [];
    const spousePersonId = parsed.data.spousePersonId ?? null;
    const spouseRelationToHOH = parsed.data.spouseRelationToHOH ?? null;
    const assignments = buildAssignments(parsed.data.hodPersonId, spousePersonId, spouseRelationToHOH, dependentPersons);
    try {
        validateNoRoleDuplicates(assignments);
        await ensurePeopleAssignable(orgId, assignments, null);
    }
    catch (err) {
        return res.status(400).json({ error: err instanceof Error ? err.message : "Invalid household assignment" });
    }
    const membershipNo = await nextMembershipNo(orgId);
    const payload = {
        organizationId: orgId,
        membershipNo,
        dateOfRegistration: new Date(parsed.data.dateOfRegistration),
        membershipType: parsed.data.membershipType,
        membershipStatus: parsed.data.membershipStatus,
        hodPersonId: parsed.data.hodPersonId,
        spousePersonId,
        land: parsed.data.land ?? false,
        houseOwnership: parsed.data.houseOwnership ?? false,
        commercialProperties: parsed.data.commercialProperties ?? false,
        toiletFacility: parsed.data.toiletFacility ?? false,
        vehicleOwnership: parsed.data.vehicleOwnership ?? false,
        waterAccessibility: parsed.data.waterAccessibility ?? false,
        electricity: parsed.data.electricity ?? false,
        paymentPeriod: parsed.data.paymentPeriod,
        membershipFee: toDecimal(parsed.data.membershipFee),
        additionalVoluntaryContributions: toDecimal(parsed.data.additionalVoluntaryContributions ?? 0),
        membershipFeeDiscount: toDecimal(parsed.data.membershipFeeDiscount ?? 0),
        totalContribution: toDecimal(parsed.data.totalContribution),
        disability: parsed.data.disability ?? false,
        createdByUserId: req.auth.userId,
    };
    const membership = await prisma_js_1.prisma.$transaction(async (tx) => {
        const created = await tx.membership.create({
            data: {
                ...payload,
                dependents: {
                    create: dependentPersons.map((dep, order) => ({
                        personId: dep.personId,
                        group: dep.group,
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
exports.membershipsRouter.patch("/:id", async (req, res) => {
    const existing = await prisma_js_1.prisma.membership.findUnique({
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
    if (!existing)
        return res.status(404).json({ error: "Membership not found" });
    if (req.auth.organizationId && existing.organizationId !== req.auth.organizationId && req.auth.role !== "super_user") {
        return res.status(403).json({ error: "Forbidden" });
    }
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    }
    const nextHodPersonId = parsed.data.hodPersonId ?? existing.hodPersonId;
    const nextSpousePersonId = parsed.data.spousePersonId !== undefined ? parsed.data.spousePersonId ?? null : existing.spousePersonId;
    let nextSpouseRelationToHOH = null;
    if (nextSpousePersonId) {
        if (parsed.data.spouseRelationToHOH) {
            nextSpouseRelationToHOH = parsed.data.spouseRelationToHOH;
        }
        else if (existing.spouse?.id === nextSpousePersonId && existing.spouse?.relationToHOH) {
            nextSpouseRelationToHOH = existing.spouse.relationToHOH;
        }
        else {
            return res.status(400).json({ error: "spouseRelationToHOH is required when spousePersonId is set" });
        }
    }
    const nextDependentPersons = parsed.data.dependentPersons ??
        existing.dependents.map((dep) => ({
            personId: dep.personId,
            group: dep.group,
            relationToHOH: dep.person.relationToHOH ?? defaultDependentRelation(dep.group),
        }));
    const assignments = buildAssignments(nextHodPersonId, nextSpousePersonId, nextSpouseRelationToHOH, nextDependentPersons);
    try {
        validateNoRoleDuplicates(assignments);
        await ensurePeopleAssignable(existing.organizationId, assignments, existing.id);
    }
    catch (err) {
        return res.status(400).json({ error: err instanceof Error ? err.message : "Invalid household assignment" });
    }
    const oldPersonIds = [
        existing.hodPersonId,
        ...(existing.spousePersonId ? [existing.spousePersonId] : []),
        ...existing.dependents.map((d) => d.personId),
    ];
    const data = { ...parsed.data };
    delete data.organizationId;
    delete data.dependentPersons;
    delete data.spouseRelationToHOH;
    if (data.dateOfRegistration)
        data.dateOfRegistration = new Date(data.dateOfRegistration);
    if (data.membershipFee !== undefined)
        data.membershipFee = toDecimal(data.membershipFee);
    if (data.additionalVoluntaryContributions !== undefined)
        data.additionalVoluntaryContributions = toDecimal(data.additionalVoluntaryContributions);
    if (data.membershipFeeDiscount !== undefined)
        data.membershipFeeDiscount = toDecimal(data.membershipFeeDiscount);
    if (data.totalContribution !== undefined)
        data.totalContribution = toDecimal(data.totalContribution);
    const membership = await prisma_js_1.prisma.$transaction(async (tx) => {
        const updated = await tx.membership.update({
            where: { id: req.params.id },
            data: {
                ...data,
                spousePersonId: nextSpousePersonId,
                dependents: parsed.data.dependentPersons !== undefined
                    ? {
                        deleteMany: {},
                        create: nextDependentPersons.map((dep, order) => ({
                            personId: dep.personId,
                            group: dep.group,
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
