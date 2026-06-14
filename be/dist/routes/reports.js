"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reportsRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const prisma_js_1 = require("../lib/prisma.js");
const auth_js_1 = require("../middleware/auth.js");
exports.reportsRouter = (0, express_1.Router)();
exports.reportsRouter.use(auth_js_1.requireAuth);
exports.reportsRouter.use(auth_js_1.withOrgScope);
function getOrgId(req) {
    return req.organizationId ?? req.body?.organizationId ?? req.query?.organizationId;
}
function getStringFilterValues(filters, key, legacyKey) {
    const raw = filters[key] ?? (legacyKey ? filters[legacyKey] : undefined);
    if (Array.isArray(raw)) {
        return raw.filter((value) => typeof value === "string" && value.trim().length > 0);
    }
    if (typeof raw === "string" && raw.trim())
        return [raw.trim()];
    return [];
}
function getNumberFilterValues(filters, key, legacyKey) {
    const raw = filters[key] ?? (legacyKey ? filters[legacyKey] : undefined);
    const values = Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw];
    return values
        .map((value) => {
        if (typeof value === "number")
            return value;
        if (typeof value === "string" && value.trim())
            return Number.parseInt(value, 10);
        return Number.NaN;
    })
        .filter((value) => Number.isInteger(value));
}
function buildMembershipWhere(filters) {
    const membershipWhere = {};
    const membershipTypes = getStringFilterValues(filters, "membershipTypes", "membershipType");
    const membershipZones = getNumberFilterValues(filters, "membershipZones", "areaCode");
    const membershipStatuses = getStringFilterValues(filters, "membershipStatuses", "membershipStatus");
    if (membershipTypes.length > 0)
        membershipWhere.membershipType = { in: membershipTypes };
    if (membershipZones.length > 0)
        membershipWhere.areaCode = { in: membershipZones };
    if (membershipStatuses.length > 0)
        membershipWhere.membershipStatus = { in: membershipStatuses };
    return membershipWhere;
}
function buildPersonWhere(orgId, filters) {
    const where = { organizationId: orgId };
    const membershipWhere = buildMembershipWhere(filters);
    if (typeof filters.isDisabled === "boolean")
        where.isDisabled = filters.isDisabled;
    if (typeof filters.isMadarasaStudent === "boolean")
        where.isMadarasaStudent = filters.isMadarasaStudent;
    if (Object.keys(membershipWhere).length > 0)
        where.membership = membershipWhere;
    if (typeof filters.minAge === "number" || typeof filters.maxAge === "number") {
        const now = new Date();
        const dob = {};
        if (typeof filters.minAge === "number") {
            dob.lte = new Date(now.getFullYear() - filters.minAge, now.getMonth(), now.getDate());
        }
        if (typeof filters.maxAge === "number") {
            dob.gte = new Date(now.getFullYear() - filters.maxAge - 1, now.getMonth(), now.getDate() + 1);
        }
        where.dateOfBirth = dob;
    }
    return where;
}
function formatZoneLabel(areaCode, zoneMap) {
    if (areaCode === null || areaCode === undefined)
        return "";
    const zoneName = zoneMap.get(areaCode);
    return zoneName ? `${areaCode} - ${zoneName}` : String(areaCode);
}
function getAgeOnDate(dateOfBirth, today = new Date()) {
    if (!dateOfBirth)
        return null;
    if (Number.isNaN(dateOfBirth.getTime()))
        return null;
    let age = today.getFullYear() - dateOfBirth.getFullYear();
    const monthDiff = today.getMonth() - dateOfBirth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dateOfBirth.getDate()))
        age--;
    return age;
}
function isCountableMember(person) {
    if (!person)
        return false;
    if (person.isArchived)
        return false;
    return !person.livingStatus || person.livingStatus === "Active";
}
async function getMembershipDataRows(orgId, filters) {
    const where = {
        organizationId: orgId,
        ...buildMembershipWhere(filters),
    };
    const [memberships, zones] = await Promise.all([
        prisma_js_1.prisma.membership.findMany({
            where,
            include: {
                hod: {
                    select: {
                        fullName: true,
                        nameWithInitials: true,
                        dateOfBirth: true,
                        livingStatus: true,
                        isArchived: true,
                    },
                },
                spouse: {
                    select: {
                        fullName: true,
                        nameWithInitials: true,
                        dateOfBirth: true,
                        livingStatus: true,
                        isArchived: true,
                    },
                },
                dependents: {
                    select: {
                        group: true,
                        person: {
                            select: {
                                fullName: true,
                                nameWithInitials: true,
                                dateOfBirth: true,
                                livingStatus: true,
                                isArchived: true,
                            },
                        },
                    },
                },
            },
            orderBy: { membershipNo: "asc" },
            take: 10000,
        }),
        prisma_js_1.prisma.zone.findMany({
            where: { organizationId: orgId },
            select: { code: true, name: true },
            orderBy: { code: "asc" },
        }),
    ]);
    const zoneMap = new Map(zones.map((zone) => [zone.code, zone.name]));
    const today = new Date();
    return memberships.map((membership) => {
        const rawPeople = [
            membership.hod,
            membership.spouse,
            ...membership.dependents.map((dependent) => dependent.person),
        ];
        const people = rawPeople.filter((person) => isCountableMember(person));
        const adults = people.filter((person) => {
            const age = getAgeOnDate(person.dateOfBirth, today);
            return age === null || age >= 18;
        }).length;
        const youth = people.filter((person) => {
            const age = getAgeOnDate(person.dateOfBirth, today);
            return age !== null && age >= 13 && age <= 17;
        }).length;
        const children = people.filter((person) => {
            const age = getAgeOnDate(person.dateOfBirth, today);
            return age !== null && age >= 0 && age <= 12;
        }).length;
        return {
            id: membership.id,
            membershipNo: membership.membershipNo,
            memberZone: formatZoneLabel(membership.areaCode, zoneMap),
            nameWithInitials: membership.hod?.nameWithInitials ??
                membership.hod?.fullName ??
                membership.membershipNo,
            fullName: membership.hod?.fullName ??
                membership.hod?.nameWithInitials ??
                membership.membershipNo,
            membershipType: membership.membershipType,
            membershipStatus: membership.membershipStatus,
            totalHeadcount: people.length,
            adults,
            youth,
            children,
            paymentPeriod: membership.paymentPeriod,
            membershipFee: Number(membership.membershipFee),
            discountAmount: Number(membership.membershipFeeDiscount),
            voluntaryContributionAmount: Number(membership.additionalVoluntaryContributions),
            totalContribution: Number(membership.totalContribution),
        };
    });
}
async function getOutstandingBalanceRows(orgId, filters) {
    const areaCode = typeof filters.areaCode === "number"
        ? filters.areaCode
        : typeof filters.areaCode === "string" && filters.areaCode
            ? Number.parseInt(filters.areaCode, 10)
            : null;
    const where = {
        organizationId: orgId,
        isSystemAdjustment: false,
        status: { in: ["pending", "partial", "overdue"] },
        ...(Number.isInteger(areaCode) ? { membership: { areaCode: areaCode } } : {}),
    };
    const [dues, zones] = await Promise.all([
        prisma_js_1.prisma.paymentDue.findMany({
            where,
            select: {
                membershipId: true,
                amountDue: true,
                amountPaid: true,
                membership: {
                    select: {
                        membershipNo: true,
                        areaCode: true,
                        hod: { select: { nameWithInitials: true, fullName: true } },
                    },
                },
            },
        }),
        prisma_js_1.prisma.zone.findMany({
            where: { organizationId: orgId },
            select: { code: true, name: true },
            orderBy: { code: "asc" },
        }),
    ]);
    const zoneMap = new Map(zones.map((zone) => [zone.code, zone.name]));
    const rowsByMembership = new Map();
    for (const due of dues) {
        const remaining = Number(due.amountDue) - Number(due.amountPaid);
        if (remaining <= 0)
            continue;
        const existing = rowsByMembership.get(due.membershipId);
        if (existing) {
            existing.totalOutstanding += remaining;
            continue;
        }
        rowsByMembership.set(due.membershipId, {
            membershipId: due.membershipId,
            memberName: due.membership.hod?.nameWithInitials ??
                due.membership.hod?.fullName ??
                due.membership.membershipNo,
            zone: formatZoneLabel(due.membership.areaCode, zoneMap),
            membershipNo: due.membership.membershipNo,
            totalOutstanding: remaining,
        });
    }
    return [...rowsByMembership.values()]
        .filter((row) => row.totalOutstanding > 0)
        .map((row) => ({
        ...row,
        totalOutstanding: Number(row.totalOutstanding.toFixed(2)),
    }))
        .sort((a, b) => {
        if (b.totalOutstanding !== a.totalOutstanding)
            return b.totalOutstanding - a.totalOutstanding;
        return a.membershipNo.localeCompare(b.membershipNo);
    });
}
async function getOutstandingBreakdownRows(orgId, filters) {
    const areaCode = typeof filters.areaCode === "number"
        ? filters.areaCode
        : typeof filters.areaCode === "string" && filters.areaCode
            ? Number.parseInt(filters.areaCode, 10)
            : null;
    const dueTypeId = typeof filters.dueTypeId === "string" && filters.dueTypeId ? filters.dueTypeId : null;
    const dueTypeWhere = {
        organizationId: orgId,
        ...(dueTypeId ? { id: dueTypeId } : {}),
    };
    const dueTypes = await prisma_js_1.prisma.dueType.findMany({
        where: dueTypeWhere,
        select: { id: true, name: true, sortOrder: true },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    const dueTypeNameById = new Map(dueTypes.map((dueType) => [dueType.id, dueType.name]));
    const where = {
        organizationId: orgId,
        isSystemAdjustment: false,
        status: { in: ["pending", "partial", "overdue"] },
        ...(dueTypeId ? { dueTypeId } : {}),
        ...(Number.isInteger(areaCode) ? { membership: { areaCode: areaCode } } : {}),
    };
    const [dues, zones] = await Promise.all([
        prisma_js_1.prisma.paymentDue.findMany({
            where,
            select: {
                membershipId: true,
                dueTypeId: true,
                amountDue: true,
                amountPaid: true,
                membership: {
                    select: {
                        membershipNo: true,
                        areaCode: true,
                        hod: { select: { nameWithInitials: true, fullName: true } },
                    },
                },
            },
        }),
        prisma_js_1.prisma.zone.findMany({
            where: { organizationId: orgId },
            select: { code: true, name: true },
            orderBy: { code: "asc" },
        }),
    ]);
    const zoneMap = new Map(zones.map((zone) => [zone.code, zone.name]));
    const rowsByMembership = new Map();
    for (const due of dues) {
        const remaining = Number(due.amountDue) - Number(due.amountPaid);
        if (remaining <= 0)
            continue;
        const dueTypeName = dueTypeNameById.get(due.dueTypeId);
        if (!dueTypeName)
            continue;
        const existing = rowsByMembership.get(due.membershipId);
        if (existing) {
            existing.totalOutstanding += remaining;
            existing.dueTypeAmounts[dueTypeName] =
                Number((existing.dueTypeAmounts[dueTypeName] || 0)) + remaining;
            continue;
        }
        rowsByMembership.set(due.membershipId, {
            membershipId: due.membershipId,
            memberName: due.membership.hod?.nameWithInitials ??
                due.membership.hod?.fullName ??
                due.membership.membershipNo,
            zone: formatZoneLabel(due.membership.areaCode, zoneMap),
            membershipNo: due.membership.membershipNo,
            totalOutstanding: remaining,
            dueTypeAmounts: {
                [dueTypeName]: remaining,
            },
        });
    }
    return {
        dueTypeColumns: dueTypes.map((dueType) => dueType.name),
        rows: [...rowsByMembership.values()]
            .filter((row) => row.totalOutstanding > 0)
            .map((row) => ({
            ...row,
            totalOutstanding: Number(row.totalOutstanding.toFixed(2)),
            dueTypeAmounts: Object.fromEntries(Object.entries(row.dueTypeAmounts).map(([name, amount]) => [name, Number(amount.toFixed(2))])),
        }))
            .sort((a, b) => {
            if (b.totalOutstanding !== a.totalOutstanding)
                return b.totalOutstanding - a.totalOutstanding;
            return a.membershipNo.localeCompare(b.membershipNo);
        }),
    };
}
async function getMemberCreditLiabilityRows(orgId) {
    const grouped = await prisma_js_1.prisma.membershipCreditLedger.groupBy({
        by: ["membershipId"],
        where: { organizationId: orgId },
        _sum: { amountDelta: true },
    });
    const balances = grouped
        .map((entry) => ({
        membershipId: entry.membershipId,
        creditBalance: Number(entry._sum.amountDelta ?? 0),
    }))
        .filter((entry) => entry.creditBalance > 0);
    if (balances.length === 0)
        return [];
    const memberships = await prisma_js_1.prisma.membership.findMany({
        where: {
            organizationId: orgId,
            id: { in: balances.map((entry) => entry.membershipId) },
        },
        select: {
            id: true,
            membershipNo: true,
            membershipType: true,
            membershipStatus: true,
            hod: { select: { fullName: true, nameWithInitials: true } },
        },
    });
    const membershipMap = new Map(memberships.map((membership) => [membership.id, membership]));
    return balances
        .map((entry) => {
        const membership = membershipMap.get(entry.membershipId);
        return {
            membershipId: entry.membershipId,
            membershipNo: membership?.membershipNo ?? "",
            membershipType: membership?.membershipType ?? "",
            membershipStatus: membership?.membershipStatus ?? "",
            hodName: membership?.hod.fullName || membership?.hod.nameWithInitials || "",
            creditBalance: Number(entry.creditBalance.toFixed(2)),
        };
    })
        .sort((a, b) => {
        if (b.creditBalance !== a.creditBalance)
            return b.creditBalance - a.creditBalance;
        return a.membershipNo.localeCompare(b.membershipNo);
    });
}
const querySchema = zod_1.z.object({
    entity: zod_1.z.enum([
        "persons",
        "memberships",
        "payments",
        "distributions",
        "memberCredits",
        "outstandingBalances",
        "outstandingBreakdown",
    ]),
    filters: zod_1.z.record(zod_1.z.any()).optional(),
});
exports.reportsRouter.post("/query", async (req, res) => {
    const parsed = querySchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    const orgId = getOrgId(req);
    if (!orgId && req.auth.role !== "super_user")
        return res.status(400).json({ error: "Organization scope required" });
    if (req.auth.organizationId && orgId !== req.auth.organizationId && req.auth.role !== "super_user")
        return res.status(403).json({ error: "Forbidden" });
    const filters = (parsed.data.filters || {});
    switch (parsed.data.entity) {
        case "persons": {
            const where = buildPersonWhere(orgId, filters);
            const persons = await prisma_js_1.prisma.person.findMany({
                where,
                select: { id: true, fullName: true, nameWithInitials: true, dateOfBirth: true, isDisabled: true, isMadarasaStudent: true, membershipId: true },
                take: 500,
            });
            return res.json(persons);
        }
        case "memberships": {
            const memberships = await getMembershipDataRows(orgId, filters);
            return res.json(memberships.slice(0, 500));
        }
        case "payments": {
            const where = { organizationId: orgId };
            if (typeof filters.paymentStatus === "string") {
                if (filters.paymentStatus === "paid") {
                    where.paymentDue = { status: "paid" };
                }
                else if (filters.paymentStatus === "pending") {
                    where.paymentDue = { status: "pending" };
                }
                else if (filters.paymentStatus === "overdue") {
                    where.paymentDue = { status: "overdue" };
                }
            }
            else {
                where.OR = [
                    { paymentDueId: null },
                    { paymentDue: { is: { isSystemAdjustment: false } } },
                ];
            }
            const payments = await prisma_js_1.prisma.payment.findMany({
                where,
                include: {
                    membership: { select: { membershipNo: true } },
                    paymentDue: { select: { period: true, amountDue: true } },
                },
                orderBy: { paymentDate: "desc" },
                take: 500,
            });
            return res.json(payments);
        }
        case "distributions": {
            const distId = typeof filters.distributionId === "string" ? filters.distributionId : undefined;
            if (!distId)
                return res.status(400).json({ error: "distributionId filter required for distributions entity" });
            const dist = await prisma_js_1.prisma.distribution.findFirst({
                where: { id: distId, organizationId: orgId },
            });
            if (!dist)
                return res.status(404).json({ error: "Distribution not found" });
            const records = await prisma_js_1.prisma.distributionRecord.findMany({
                where: { distributionId: distId },
                include: { person: { select: { fullName: true, nameWithInitials: true } } },
                orderBy: { distributedAt: "desc" },
                take: 500,
            });
            return res.json(records.map((r) => ({ ...r, personName: r.person.fullName || r.person.nameWithInitials })));
        }
        case "memberCredits": {
            const rows = await getMemberCreditLiabilityRows(orgId);
            return res.json(rows);
        }
        case "outstandingBalances": {
            const rows = await getOutstandingBalanceRows(orgId, filters);
            return res.json(rows);
        }
        case "outstandingBreakdown": {
            const { rows } = await getOutstandingBreakdownRows(orgId, filters);
            return res.json(rows);
        }
        default:
            return res.status(400).json({ error: "Invalid entity" });
    }
});
exports.reportsRouter.get("/export", async (req, res) => {
    const entity = req.query.entity;
    let filters = {};
    try {
        if (typeof req.query.filters === "string")
            filters = JSON.parse(req.query.filters);
    }
    catch {
        return res.status(400).json({ error: "Invalid filters JSON" });
    }
    const orgId = getOrgId(req);
    if (!orgId && req.auth.role !== "super_user")
        return res.status(400).json({ error: "Organization scope required" });
    if (req.auth.organizationId && orgId !== req.auth.organizationId && req.auth.role !== "super_user")
        return res.status(403).json({ error: "Forbidden" });
    const validEntities = [
        "persons",
        "memberships",
        "payments",
        "distributions",
        "memberCredits",
        "outstandingBalances",
        "outstandingBreakdown",
    ];
    if (!validEntities.includes(entity))
        return res.status(400).json({ error: "Invalid entity", valid: validEntities });
    let rows = [];
    let headers = [];
    switch (entity) {
        case "persons": {
            const where = buildPersonWhere(orgId, filters);
            const persons = await prisma_js_1.prisma.person.findMany({ where, take: 10000 });
            headers = ["id", "fullName", "nameWithInitials", "dateOfBirth", "isDisabled", "isMadarasaStudent"];
            rows = persons.map((p) => ({
                id: p.id,
                fullName: p.fullName,
                nameWithInitials: p.nameWithInitials,
                dateOfBirth: p.dateOfBirth?.toISOString().slice(0, 10) ?? "",
                isDisabled: p.isDisabled,
                isMadarasaStudent: p.isMadarasaStudent,
            }));
            break;
        }
        case "memberships": {
            const memberships = await getMembershipDataRows(orgId, filters);
            headers = [
                "membershipNo",
                "memberZone",
                "nameWithInitials",
                "fullName",
                "membershipType",
                "membershipStatus",
                "totalHeadcount",
                "adults",
                "youth",
                "children",
                "paymentPeriod",
                "membershipFee",
                "discountAmount",
                "voluntaryContributionAmount",
                "totalContribution",
            ];
            rows = memberships.map((membership) => ({
                membershipNo: membership.membershipNo,
                memberZone: membership.memberZone,
                nameWithInitials: membership.nameWithInitials,
                fullName: membership.fullName,
                membershipType: membership.membershipType,
                membershipStatus: membership.membershipStatus,
                totalHeadcount: membership.totalHeadcount,
                adults: membership.adults,
                youth: membership.youth,
                children: membership.children,
                paymentPeriod: membership.paymentPeriod,
                membershipFee: membership.membershipFee.toFixed(2),
                discountAmount: membership.discountAmount.toFixed(2),
                voluntaryContributionAmount: membership.voluntaryContributionAmount.toFixed(2),
                totalContribution: membership.totalContribution.toFixed(2),
            }));
            break;
        }
        case "payments": {
            const where = { organizationId: orgId };
            if (typeof filters.paymentStatus === "string") {
                where.paymentDue = { status: filters.paymentStatus };
            }
            else {
                where.OR = [
                    { paymentDueId: null },
                    { paymentDue: { is: { isSystemAdjustment: false } } },
                ];
            }
            const payments = await prisma_js_1.prisma.payment.findMany({
                where,
                include: { membership: true, paymentDue: true },
                take: 10000,
            });
            headers = ["id", "membershipNo", "period", "amount", "paymentDate"];
            rows = payments.map((p) => ({
                id: p.id,
                membershipNo: p.membership.membershipNo,
                period: p.paymentDue?.period ?? "Credit Payment",
                amount: Number(p.amount),
                paymentDate: p.paymentDate.toISOString().slice(0, 10),
            }));
            break;
        }
        case "distributions": {
            const distId = typeof filters.distributionId === "string" ? filters.distributionId : undefined;
            if (!distId)
                return res.status(400).json({ error: "distributionId filter required" });
            const records = await prisma_js_1.prisma.distributionRecord.findMany({
                where: { distributionId: distId },
                include: { person: true },
                take: 10000,
            });
            headers = ["id", "personId", "personName", "distributionDate", "distributedAt"];
            rows = records.map((r) => ({
                id: r.id,
                personId: r.personId,
                personName: r.person.fullName || r.person.nameWithInitials,
                distributionDate: r.distributionDate,
                distributedAt: r.distributedAt.toISOString(),
            }));
            break;
        }
        case "memberCredits": {
            const liabilities = await getMemberCreditLiabilityRows(orgId);
            headers = ["membershipId", "membershipNo", "membershipType", "membershipStatus", "hodName", "creditBalance"];
            rows = liabilities.map((item) => ({
                membershipId: item.membershipId,
                membershipNo: item.membershipNo,
                membershipType: item.membershipType,
                membershipStatus: item.membershipStatus,
                hodName: item.hodName,
                creditBalance: item.creditBalance.toFixed(2),
            }));
            break;
        }
        case "outstandingBalances": {
            const rowsData = await getOutstandingBalanceRows(orgId, filters);
            headers = ["memberName", "zone", "membershipNo", "totalOutstanding"];
            rows = rowsData.map((item) => ({
                memberName: item.memberName,
                zone: item.zone,
                membershipNo: item.membershipNo,
                totalOutstanding: item.totalOutstanding.toFixed(2),
            }));
            break;
        }
        case "outstandingBreakdown": {
            const report = await getOutstandingBreakdownRows(orgId, filters);
            headers = ["memberName", "zone", "membershipNo", ...report.dueTypeColumns, "totalOutstanding"];
            rows = report.rows.map((item) => ({
                memberName: item.memberName,
                zone: item.zone,
                membershipNo: item.membershipNo,
                totalOutstanding: item.totalOutstanding.toFixed(2),
                ...Object.fromEntries(report.dueTypeColumns.map((column) => [
                    column,
                    Number(item.dueTypeAmounts[column] || 0).toFixed(2),
                ])),
            }));
            break;
        }
    }
    const csvHeader = headers.join(",");
    const csvRows = rows.map((r) => headers.map((h) => {
        const v = r[h];
        const s = v === null || v === undefined ? "" : String(v);
        return s.includes(",") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(","));
    const csv = [csvHeader, ...csvRows].join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${entity}-export.csv"`);
    return res.send(csv);
});
exports.reportsRouter.get("/distributions/:id", async (req, res) => {
    const dist = await prisma_js_1.prisma.distribution.findUnique({ where: { id: req.params.id } });
    if (!dist)
        return res.status(404).json({ error: "Distribution not found" });
    if (req.auth.organizationId && dist.organizationId !== req.auth.organizationId && req.auth.role !== "super_user")
        return res.status(403).json({ error: "Forbidden" });
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    let currentDate;
    if (dist.frequency === "Daily")
        currentDate = `${y}-${m}-${d}`;
    else if (dist.frequency === "Monthly")
        currentDate = `${y}-${m}`;
    else
        currentDate = String(y);
    const personWhere = { organizationId: dist.organizationId };
    const fc = dist.filterCriteria;
    if (fc) {
        if (typeof fc.isDisabled === "boolean")
            personWhere.isDisabled = fc.isDisabled;
        if (typeof fc.isMadarasaStudent === "boolean")
            personWhere.isMadarasaStudent = fc.isMadarasaStudent;
        if (typeof fc.membershipType === "string" && fc.membershipType) {
            personWhere.membership = { membershipType: fc.membershipType };
        }
        if (typeof fc.minAge === "number" || typeof fc.maxAge === "number") {
            const dob = {};
            if (typeof fc.minAge === "number")
                dob.lte = new Date(y - fc.minAge, now.getMonth(), now.getDate());
            if (typeof fc.maxAge === "number")
                dob.gte = new Date(y - fc.maxAge - 1, now.getMonth(), now.getDate() + 1);
            personWhere.dateOfBirth = dob;
        }
    }
    const [totalEligible, currentCycleRecords] = await Promise.all([
        prisma_js_1.prisma.person.count({ where: personWhere }),
        prisma_js_1.prisma.distributionRecord.findMany({
            where: { distributionId: dist.id, distributionDate: currentDate },
            include: { person: { select: { fullName: true, nameWithInitials: true } } },
        }),
    ]);
    const totalDistributed = currentCycleRecords.length;
    const totalPending = Math.max(0, totalEligible - totalDistributed);
    const completionPercentage = totalEligible > 0 ? Math.round((totalDistributed / totalEligible) * 100) : 0;
    const records = currentCycleRecords.map((r) => ({
        id: r.id,
        personId: r.personId,
        personName: r.person.fullName || r.person.nameWithInitials,
        distributedAt: r.distributedAt,
        distributionDate: r.distributionDate,
    }));
    return res.json({
        distributionId: dist.id,
        name: dist.name,
        totalEligible,
        totalDistributed,
        totalPending,
        completionPercentage,
        records,
    });
});
