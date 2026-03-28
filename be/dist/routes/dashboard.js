"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dashboardRouter = void 0;
const express_1 = require("express");
const library_1 = require("@prisma/client/runtime/library");
const prisma_js_1 = require("../lib/prisma.js");
const auth_js_1 = require("../middleware/auth.js");
exports.dashboardRouter = (0, express_1.Router)();
exports.dashboardRouter.use(auth_js_1.requireAuth);
exports.dashboardRouter.use(auth_js_1.withOrgScope);
function getOrgId(req) {
    return req.organizationId ?? req.query?.organizationId;
}
exports.dashboardRouter.get("/", async (req, res) => {
    const orgId = getOrgId(req);
    if (!orgId && req.auth.role !== "super_user")
        return res.status(400).json({ error: "Organization scope required" });
    const orgFilter = orgId ? { organizationId: orgId } : {};
    const now = new Date();
    const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const eighteenYearsAgo = new Date(now.getFullYear() - 18, now.getMonth(), now.getDate());
    const thirteenYearsAgo = new Date(now.getFullYear() - 13, now.getMonth(), now.getDate());
    const activePersonFilter = {
        isArchived: false,
        OR: [{ livingStatus: "Active" }, { livingStatus: null }],
    };
    const [totalHouseholds, totalHeadcount, adultsCount, youthCount, childrenCount, currentMonthDues, currentMonthPayments,] = await Promise.all([
        prisma_js_1.prisma.membership.count({ where: { ...orgFilter, isArchived: false } }),
        prisma_js_1.prisma.person.count({ where: { ...orgFilter, ...activePersonFilter } }),
        prisma_js_1.prisma.person.count({
            where: {
                ...orgFilter,
                ...activePersonFilter,
                dateOfBirth: { lte: eighteenYearsAgo },
            },
        }),
        prisma_js_1.prisma.person.count({
            where: {
                ...orgFilter,
                ...activePersonFilter,
                dateOfBirth: { gt: eighteenYearsAgo, lte: thirteenYearsAgo },
            },
        }),
        prisma_js_1.prisma.person.count({
            where: {
                ...orgFilter,
                ...activePersonFilter,
                dateOfBirth: { gt: thirteenYearsAgo },
            },
        }),
        prisma_js_1.prisma.paymentDue.findMany({
            where: { ...orgFilter, period: currentPeriod },
            select: { amountDue: true, amountPaid: true },
        }),
        prisma_js_1.prisma.payment.aggregate({
            where: {
                ...orgFilter,
                paymentDate: { gte: monthStart, lt: monthEnd },
            },
            _sum: { amount: true },
        }),
    ]);
    const totalDue = currentMonthDues.reduce((sum, d) => sum.add(d.amountDue), new library_1.Decimal(0));
    const collectedThisMonth = currentMonthPayments._sum.amount ?? new library_1.Decimal(0);
    return res.json({
        totalHouseholds,
        totalHeadcount,
        adults: adultsCount,
        youth: youthCount,
        children: childrenCount,
        totalDueThisMonth: totalDue.toNumber(),
        collectedThisMonth: new library_1.Decimal(collectedThisMonth.toString()).toNumber(),
        period: currentPeriod,
    });
});
