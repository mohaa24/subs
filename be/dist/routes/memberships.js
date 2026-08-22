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
// Membership writes touch the membership row plus several linked people, so we
// give those interactive transactions the same headroom as payment writes.
const MEMBERSHIP_WRITE_TRANSACTION_OPTIONS = {
    maxWait: 10000,
    timeout: 10000,
};
const paymentPeriods = ["Monthly", "Quarterly", "Annually"];
const membershipStatuses = ["Active", "Inactive"];
const maxZoneCode = 9;
const spouseRelations = ["Wife"];
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
    membershipStatus: zod_1.z.enum(membershipStatuses),
    hodPersonId: zod_1.z.string(),
    spousePersonId: zod_1.z.string().optional().nullable(),
    spouseRelationToHOH: zod_1.z.enum(spouseRelations).optional().nullable(),
    dependentPersons: zod_1.z.array(dependentSchema).optional(),
    isZakathEligible: zod_1.z.boolean().optional().nullable(),
    areaCode: zod_1.z.number().int().min(1).max(maxZoneCode).optional().nullable(),
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
const createSchema = baseSchema;
const updateSchema = baseSchema.partial();
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
function formatMembershipZoneSegment(areaCode) {
    return String(areaCode);
}
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
async function ensureZoneExists(organizationId, areaCode) {
    const org = await prisma_js_1.prisma.organization.findUnique({ where: { id: organizationId } });
    if (!org) {
        throw new Error("Organization not found");
    }
    const zone = await prisma_js_1.prisma.zone.findFirst({
        where: { organizationId, code: areaCode },
        select: { id: true },
    });
    if (!zone) {
        throw new Error("Selected zone was not found");
    }
}
async function nextMembershipNo(organizationId, areaCode) {
    const org = await prisma_js_1.prisma.organization.findUnique({ where: { id: organizationId } });
    const slug = org?.slug ?? "ORG";
    const zoneSegment = formatMembershipZoneSegment(areaCode);
    const prefix = `${slug}-${zoneSegment}`;
    const membershipNos = await prisma_js_1.prisma.membership.findMany({
        where: {
            organizationId,
            membershipNo: { startsWith: prefix },
        },
        select: { membershipNo: true },
    });
    const regex = new RegExp(`^${escapeRegExp(prefix)}(\\d{3,})$`);
    const maxSequence = membershipNos.reduce((highest, membership) => {
        const match = regex.exec(membership.membershipNo);
        if (!match)
            return highest;
        const sequence = Number.parseInt(match[1], 10);
        return Number.isNaN(sequence) ? highest : Math.max(highest, sequence);
    }, 0);
    return `${prefix}${String(maxSequence + 1).padStart(3, "0")}`;
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
    if (newIds.length === 0)
        return;
    // Most people in the household receive the same membership link, so write
    // that shared state once and then apply the smaller set of relation changes.
    // This avoids one person.update call per member, which was timing out on prod.
    await tx.person.updateMany({
        where: { id: { in: newIds } },
        data: {
            membershipId,
            relationToHOH: null,
        },
    });
    const personIdsByRelation = new Map();
    for (const assignment of assignments) {
        if (!assignment.relationToHOH)
            continue;
        const ids = personIdsByRelation.get(assignment.relationToHOH) ?? [];
        ids.push(assignment.personId);
        personIdsByRelation.set(assignment.relationToHOH, ids);
    }
    for (const [relationToHOH, personIds] of personIdsByRelation) {
        await tx.person.updateMany({
            where: { id: { in: personIds } },
            data: {
                relationToHOH,
            },
        });
    }
}
exports.membershipsRouter.get("/", async (req, res) => {
    const orgId = getOrgId(req);
    if (!orgId && req.auth.role !== "super_user")
        return res.status(400).json({ error: "Organization scope required" });
    const q = req.query.q?.trim() || "";
    const includeArchived = req.query.includeArchived === "true";
    const membershipType = req.query.membershipType?.trim() || "";
    const membershipStatus = req.query.membershipStatus?.trim() || "";
    const paymentPeriod = req.query.paymentPeriod?.trim() || "";
    const areaCode = Number.parseInt(String(req.query.areaCode ?? ""), 10);
    const zakathEligible = req.query.isZakathEligible?.trim() || "";
    const disability = req.query.disability?.trim() || "";
    const registeredFrom = req.query.registeredFrom?.trim() || "";
    const registeredTo = req.query.registeredTo?.trim() || "";
    const sort = req.query.sort?.trim() || "recent";
    const page = Math.max(1, parseInt(String(req.query.page), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit), 10) || 10));
    const where = {};
    if (orgId)
        where.organizationId = orgId;
    if (!includeArchived)
        where.isArchived = false;
    if (membershipType && ["Resident", "NonResident", "Widow", "Widower"].includes(membershipType)) {
        where.membershipType = membershipType;
    }
    if (membershipStatus && membershipStatuses.includes(membershipStatus)) {
        where.membershipStatus = membershipStatus;
    }
    if (paymentPeriod && paymentPeriods.includes(paymentPeriod)) {
        where.paymentPeriod = paymentPeriod;
    }
    if (Number.isInteger(areaCode) && areaCode > 0 && areaCode <= maxZoneCode)
        where.areaCode = areaCode;
    if (zakathEligible === "true")
        where.isZakathEligible = true;
    if (zakathEligible === "false")
        where.isZakathEligible = false;
    if (zakathEligible === "unset")
        where.isZakathEligible = null;
    if (disability === "true")
        where.disability = true;
    if (disability === "false")
        where.disability = false;
    if (registeredFrom || registeredTo) {
        const dateFilter = {};
        if (registeredFrom) {
            const from = new Date(registeredFrom);
            if (!Number.isNaN(from.getTime()))
                dateFilter.gte = from;
        }
        if (registeredTo) {
            const to = new Date(registeredTo);
            if (!Number.isNaN(to.getTime())) {
                to.setDate(to.getDate() + 1);
                dateFilter.lt = to;
            }
        }
        if (Object.keys(dateFilter).length > 0)
            where.dateOfRegistration = dateFilter;
    }
    if (q) {
        where.OR = [
            { membershipNo: { contains: q, mode: "insensitive" } },
            { hod: { fullName: { contains: q, mode: "insensitive" } } },
            { hod: { nameWithInitials: { contains: q, mode: "insensitive" } } },
            { hod: { mobileNumber: { contains: q, mode: "insensitive" } } },
            { hod: { whatsAppNumber: { contains: q, mode: "insensitive" } } },
        ];
    }
    const [items, total] = await Promise.all([
        prisma_js_1.prisma.membership.findMany({
            where,
            skip: (page - 1) * limit,
            take: limit,
            orderBy: sort === "name_asc"
                ? { hod: { nameWithInitials: "asc" } }
                : sort === "name_desc"
                    ? { hod: { nameWithInitials: "desc" } }
                    : sort === "oldest"
                        ? { dateOfRegistration: "asc" }
                        : { dateOfRegistration: "desc" },
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
        where: {
            organizationId: orgId,
            ...(q
                ? {
                    OR: [
                        { membershipNo: { contains: q, mode: "insensitive" } },
                        { hod: { fullName: { contains: q, mode: "insensitive" } } },
                        { hod: { nameWithInitials: { contains: q, mode: "insensitive" } } },
                        { hod: { mobileNumber: { contains: q, mode: "insensitive" } } },
                        { hod: { whatsAppNumber: { contains: q, mode: "insensitive" } } },
                    ],
                }
                : {}),
        },
        take: 20,
        select: {
            id: true,
            membershipNo: true,
            hod: { select: { fullName: true, nameWithInitials: true, mobileNumber: true, whatsAppNumber: true } },
        },
    });
    return res.json(list.map((member) => ({
        ...member,
        phoneNumber: member.hod?.mobileNumber || member.hod?.whatsAppNumber || null,
    })));
});
exports.membershipsRouter.get("/:id", async (req, res) => {
    const membership = await prisma_js_1.prisma.membership.findFirst({
        where: { id: req.params.id },
        include: {
            hod: true,
            spouse: true,
            dependents: { orderBy: { order: "asc" }, include: { person: true } },
            organization: { select: { id: true, name: true, slug: true, address: true } },
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
    const fallbackZone = parsed.data.areaCode == null
        ? await prisma_js_1.prisma.person.findUnique({ where: { id: parsed.data.hodPersonId }, select: { areaCode: true } })
        : null;
    const firstZone = parsed.data.areaCode == null && !fallbackZone?.areaCode
        ? await prisma_js_1.prisma.zone.findFirst({ where: { organizationId: orgId, isActive: true }, orderBy: { code: "asc" }, select: { code: true } })
        : null;
    const effectiveAreaCode = parsed.data.areaCode ?? fallbackZone?.areaCode ?? firstZone?.code;
    if (!effectiveAreaCode)
        return res.status(400).json({ error: "A zone is required to generate the membership number" });
    const dependentPersons = parsed.data.dependentPersons ?? [];
    const spousePersonId = parsed.data.spousePersonId ?? null;
    const spouseRelationToHOH = spousePersonId ? "Wife" : null;
    const assignments = buildAssignments(parsed.data.hodPersonId, spousePersonId, spouseRelationToHOH, dependentPersons);
    try {
        validateNoRoleDuplicates(assignments);
        await ensurePeopleAssignable(orgId, assignments, null);
        await ensureZoneExists(orgId, effectiveAreaCode);
    }
    catch (err) {
        return res.status(400).json({ error: err instanceof Error ? err.message : "Invalid household assignment" });
    }
    const membershipNo = await nextMembershipNo(orgId, effectiveAreaCode);
    const payload = {
        organizationId: orgId,
        membershipNo,
        dateOfRegistration: new Date(parsed.data.dateOfRegistration),
        membershipType: parsed.data.membershipType,
        membershipStatus: parsed.data.membershipStatus,
        hodPersonId: parsed.data.hodPersonId,
        spousePersonId,
        isZakathEligible: parsed.data.isZakathEligible ?? null,
        areaCode: effectiveAreaCode,
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
    }, MEMBERSHIP_WRITE_TRANSACTION_OPTIONS);
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
    const nextSpouseRelationToHOH = nextSpousePersonId ? "Wife" : null;
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
        if (parsed.data.areaCode !== undefined && parsed.data.areaCode !== null) {
            await ensureZoneExists(existing.organizationId, parsed.data.areaCode);
        }
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
    if (data.areaCode === null)
        delete data.areaCode;
    if (data.dateOfRegistration)
        data.dateOfRegistration = new Date(data.dateOfRegistration);
    if (data.membershipStatus !== undefined)
        data.membershipStatus = data.membershipStatus;
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
    }, MEMBERSHIP_WRITE_TRANSACTION_OPTIONS);
    return res.json(membership);
});
exports.membershipsRouter.patch("/:id/archive", async (req, res) => {
    const membership = await prisma_js_1.prisma.membership.findUnique({ where: { id: req.params.id } });
    if (!membership)
        return res.status(404).json({ error: "Membership not found" });
    const orgId = getOrgId(req);
    if (orgId && membership.organizationId !== orgId && req.auth.role !== "super_user") {
        return res.status(403).json({ error: "Forbidden" });
    }
    const isArchived = req.body.isArchived === true;
    const updated = await prisma_js_1.prisma.membership.update({
        where: { id: req.params.id },
        data: { isArchived },
        include: {
            hod: { select: { id: true, nameWithInitials: true, fullName: true } },
        },
    });
    return res.json(updated);
});
