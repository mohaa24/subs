"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.organizationsRouter = void 0;
const express_1 = require("express");
const client_1 = require("@prisma/client");
const zod_1 = require("zod");
const prisma_js_1 = require("../lib/prisma.js");
const auth_js_1 = require("../middleware/auth.js");
const due_types_js_1 = require("../lib/due-types.js");
exports.organizationsRouter = (0, express_1.Router)();
exports.organizationsRouter.use(auth_js_1.requireAuth);
const createSchema = zod_1.z.object({
    name: zod_1.z.string().min(1),
    slug: zod_1.z.string().min(1).regex(/^[a-z0-9_-]+$/),
    defaultMembershipFee: zod_1.z.number().min(0).optional(),
    isActive: zod_1.z.boolean().optional(),
    logoUrl: zod_1.z.string().optional(),
    contactPersonName: zod_1.z.string().optional(),
    contactPersonPhone: zod_1.z.string().optional(),
    whatsAppSenderNumber: zod_1.z.string().optional(),
    address: zod_1.z.string().optional(),
    joinDate: zod_1.z.string().optional(),
    proRataMonthly: zod_1.z.boolean().optional(),
    proRataQuarterly: zod_1.z.boolean().optional(),
    proRataYearly: zod_1.z.boolean().optional(),
    lateFeePercentage: zod_1.z.number().min(0).max(100).optional(),
});
const superUpdateSchema = zod_1.z.object({
    name: zod_1.z.string().min(1).optional(),
    slug: zod_1.z.string().min(1).regex(/^[a-z0-9_-]+$/).optional(),
    defaultMembershipFee: zod_1.z.number().min(0).optional(),
    isActive: zod_1.z.boolean().optional(),
    logoUrl: zod_1.z.string().optional().nullable(),
    contactPersonName: zod_1.z.string().optional().nullable(),
    contactPersonPhone: zod_1.z.string().optional().nullable(),
    whatsAppSenderNumber: zod_1.z.string().optional().nullable(),
    address: zod_1.z.string().optional().nullable(),
    joinDate: zod_1.z.string().optional().nullable(),
    proRataMonthly: zod_1.z.boolean().optional(),
    proRataQuarterly: zod_1.z.boolean().optional(),
    proRataYearly: zod_1.z.boolean().optional(),
    lateFeePercentage: zod_1.z.number().min(0).max(100).optional(),
});
const adminUpdateSchema = zod_1.z.object({
    defaultMembershipFee: zod_1.z.number().min(0).optional(),
    contactPersonName: zod_1.z.string().optional().nullable(),
    contactPersonPhone: zod_1.z.string().optional().nullable(),
    whatsAppSenderNumber: zod_1.z.string().optional().nullable(),
    address: zod_1.z.string().optional().nullable(),
    proRataMonthly: zod_1.z.boolean().optional(),
    proRataQuarterly: zod_1.z.boolean().optional(),
    proRataYearly: zod_1.z.boolean().optional(),
    lateFeePercentage: zod_1.z.number().min(0).max(100).optional(),
});
function toOrgPayload(org, counts) {
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
exports.organizationsRouter.get("/", async (req, res) => {
    if (req.auth.role !== client_1.UserRole.super_user)
        return res.status(403).json({ error: "Forbidden" });
    const [orgs, roleCounts] = await Promise.all([
        prisma_js_1.prisma.organization.findMany({
            orderBy: { name: "asc" },
            include: { _count: { select: { persons: true, memberships: true } } },
        }),
        prisma_js_1.prisma.user.groupBy({
            by: ["organizationId", "role"],
            where: {
                organizationId: { not: null },
                role: { in: [client_1.UserRole.admin, client_1.UserRole.user] },
            },
            _count: { _all: true },
        }),
    ]);
    const countsByOrg = new Map();
    for (const rc of roleCounts) {
        if (!rc.organizationId)
            continue;
        const current = countsByOrg.get(rc.organizationId) ?? { adminsCount: 0, usersCount: 0 };
        if (rc.role === client_1.UserRole.admin)
            current.adminsCount = rc._count._all;
        if (rc.role === client_1.UserRole.user)
            current.usersCount = rc._count._all;
        countsByOrg.set(rc.organizationId, current);
    }
    return res.json(orgs.map((org) => toOrgPayload(org, countsByOrg.get(org.id))));
});
exports.organizationsRouter.get("/current", async (req, res) => {
    const orgId = req.auth.role === client_1.UserRole.super_user
        ? req.query.organizationId
        : req.auth.organizationId ?? undefined;
    if (!orgId)
        return res.status(400).json({ error: "organizationId required" });
    const [org, roleCounts] = await Promise.all([
        prisma_js_1.prisma.organization.findUnique({
            where: { id: orgId },
            include: { _count: { select: { persons: true, memberships: true } } },
        }),
        prisma_js_1.prisma.user.groupBy({
            by: ["role"],
            where: {
                organizationId: orgId,
                role: { in: [client_1.UserRole.admin, client_1.UserRole.user] },
            },
            _count: { _all: true },
        }),
    ]);
    if (!org)
        return res.status(404).json({ error: "Organization not found" });
    let adminsCount = 0;
    let usersCount = 0;
    for (const rc of roleCounts) {
        if (rc.role === client_1.UserRole.admin)
            adminsCount = rc._count._all;
        if (rc.role === client_1.UserRole.user)
            usersCount = rc._count._all;
    }
    return res.json(toOrgPayload(org, { adminsCount, usersCount }));
});
exports.organizationsRouter.get("/:id", async (req, res) => {
    if (req.auth.role !== client_1.UserRole.super_user && req.auth.organizationId !== req.params.id) {
        return res.status(403).json({ error: "Forbidden" });
    }
    const [org, roleCounts] = await Promise.all([
        prisma_js_1.prisma.organization.findUnique({
            where: { id: req.params.id },
            include: { _count: { select: { persons: true, memberships: true } } },
        }),
        prisma_js_1.prisma.user.groupBy({
            by: ["role"],
            where: {
                organizationId: req.params.id,
                role: { in: [client_1.UserRole.admin, client_1.UserRole.user] },
            },
            _count: { _all: true },
        }),
    ]);
    if (!org)
        return res.status(404).json({ error: "Organization not found" });
    let adminsCount = 0;
    let usersCount = 0;
    for (const rc of roleCounts) {
        if (rc.role === client_1.UserRole.admin)
            adminsCount = rc._count._all;
        if (rc.role === client_1.UserRole.user)
            usersCount = rc._count._all;
    }
    return res.json(toOrgPayload(org, { adminsCount, usersCount }));
});
exports.organizationsRouter.post("/", async (req, res) => {
    if (req.auth.role !== client_1.UserRole.super_user)
        return res.status(403).json({ error: "Forbidden" });
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    }
    const existing = await prisma_js_1.prisma.organization.findUnique({ where: { slug: parsed.data.slug } });
    if (existing)
        return res.status(409).json({ error: "Slug already in use" });
    const org = await prisma_js_1.prisma.$transaction(async (tx) => {
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
        await (0, due_types_js_1.ensureDefaultDueTypes)(tx, created.id);
        return created;
    });
    return res.status(201).json(toOrgPayload(org));
});
exports.organizationsRouter.patch("/:id", async (req, res) => {
    const isSuper = req.auth.role === client_1.UserRole.super_user;
    const isOrgAdmin = req.auth.role === client_1.UserRole.admin && req.auth.organizationId === req.params.id;
    if (!isSuper && !isOrgAdmin)
        return res.status(403).json({ error: "Forbidden" });
    if (isSuper) {
        const parsed = superUpdateSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
        }
        if (parsed.data.slug) {
            const existing = await prisma_js_1.prisma.organization.findFirst({
                where: { slug: parsed.data.slug, NOT: { id: req.params.id } },
            });
            if (existing)
                return res.status(409).json({ error: "Slug already in use" });
        }
        const data = { ...parsed.data };
        if (data.joinDate !== undefined) {
            data.joinDate = data.joinDate ? new Date(data.joinDate) : null;
        }
        const org = await prisma_js_1.prisma.organization.update({
            where: { id: req.params.id },
            data,
        });
        return res.json(toOrgPayload(org));
    }
    const parsed = adminUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    }
    const data = {};
    if (parsed.data.defaultMembershipFee !== undefined)
        data.defaultMembershipFee = parsed.data.defaultMembershipFee;
    if (parsed.data.contactPersonName !== undefined)
        data.contactPersonName = parsed.data.contactPersonName;
    if (parsed.data.contactPersonPhone !== undefined)
        data.contactPersonPhone = parsed.data.contactPersonPhone;
    if (parsed.data.whatsAppSenderNumber !== undefined)
        data.whatsAppSenderNumber = parsed.data.whatsAppSenderNumber;
    if (parsed.data.address !== undefined)
        data.address = parsed.data.address;
    if (parsed.data.proRataMonthly !== undefined)
        data.proRataMonthly = parsed.data.proRataMonthly;
    if (parsed.data.proRataQuarterly !== undefined)
        data.proRataQuarterly = parsed.data.proRataQuarterly;
    if (parsed.data.proRataYearly !== undefined)
        data.proRataYearly = parsed.data.proRataYearly;
    if (parsed.data.lateFeePercentage !== undefined)
        data.lateFeePercentage = parsed.data.lateFeePercentage;
    const org = await prisma_js_1.prisma.organization.update({
        where: { id: req.params.id },
        data,
    });
    return res.json(toOrgPayload(org));
});
