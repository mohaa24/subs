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
const createSchema = zod_1.z.object({
    organizationId: zod_1.z.string().optional(),
    dateOfRegistration: zod_1.z.string(),
    membershipType: zod_1.z.enum(["Resident", "NonResident", "Widow", "Widower"]),
    membershipStatus: zod_1.z.string().min(1),
    hodPersonId: zod_1.z.string(),
    spousePersonId: zod_1.z.string().optional().nullable(),
    dependentPersonIds: zod_1.z.array(zod_1.z.string()).optional(),
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
const updateSchema = createSchema.partial();
function getOrgId(req) {
    const orgId = req.organizationId ?? req.body?.organizationId ?? req.query?.organizationId;
    return orgId;
}
function toDecimal(n) {
    return new library_1.Decimal(n);
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
                hod: { select: { id: true, nameWithInitials: true, fullName: true, nicNumber: true } },
                spouse: { select: { id: true, nameWithInitials: true, fullName: true } },
                dependents: { include: { person: { select: { id: true, nameWithInitials: true, fullName: true } } } },
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
        paymentPeriod: parsed.data.paymentPeriod,
        membershipFee: toDecimal(parsed.data.membershipFee),
        additionalVoluntaryContributions: toDecimal(parsed.data.additionalVoluntaryContributions ?? 0),
        membershipFeeDiscount: toDecimal(parsed.data.membershipFeeDiscount ?? 0),
        totalContribution: toDecimal(parsed.data.totalContribution),
        disability: parsed.data.disability ?? false,
        createdByUserId: req.auth.userId,
    };
    const membership = await prisma_js_1.prisma.membership.create({
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
exports.membershipsRouter.patch("/:id", async (req, res) => {
    const existing = await prisma_js_1.prisma.membership.findUnique({
        where: { id: req.params.id },
        include: { dependents: true },
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
    const data = { ...parsed.data };
    delete data.organizationId;
    delete data.dependentPersonIds;
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
    if (parsed.data.dependentPersonIds !== undefined) {
        await prisma_js_1.prisma.membershipDependent.deleteMany({ where: { membershipId: req.params.id } });
        data.dependents = {
            create: parsed.data.dependentPersonIds.map((personId, order) => ({ personId, order })),
        };
    }
    const membership = await prisma_js_1.prisma.membership.update({
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
