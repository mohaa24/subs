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
    const parsedWindowDays = Number(req.query?.windowDays);
    const windowDays = [1, 7, 14, 30].includes(parsedWindowDays) ? parsedWindowDays : 30;
    const rangeEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const rangeStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (windowDays - 1));
    const eighteenYearsAgo = new Date(now.getFullYear() - 18, now.getMonth(), now.getDate());
    const thirteenYearsAgo = new Date(now.getFullYear() - 13, now.getMonth(), now.getDate());
    const activePersonFilter = {
        isArchived: false,
        OR: [{ livingStatus: "Active" }, { livingStatus: null }],
    };
    const [totalHouseholds, totalHeadcount, adultsCount, youthCount, childrenCount, currentMonthDues, activePaymentsInPeriod, currentMonthOverpayments, currentOutstandingDues,] = await Promise.all([
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
            where: {
                ...orgFilter,
                dueDate: { gte: rangeStart, lt: rangeEnd },
            },
            select: { amountDue: true, amountPaid: true },
        }),
        prisma_js_1.prisma.payment.aggregate({
            where: {
                ...orgFilter,
                paymentDate: { gte: rangeStart, lt: rangeEnd },
                isReversed: false,
            },
            _count: { _all: true },
            _sum: { amount: true },
        }),
        prisma_js_1.prisma.membershipCreditLedger.aggregate({
            where: {
                ...orgFilter,
                entryType: "credit_overpayment",
                createdAt: { gte: rangeStart, lt: rangeEnd },
            },
            _sum: { amountDelta: true },
        }),
        prisma_js_1.prisma.paymentDue.findMany({
            where: {
                ...orgFilter,
                status: { not: "paid" },
            },
            select: { amountDue: true, amountPaid: true },
        }),
    ]);
    const totalDue = currentMonthDues.reduce((sum, d) => sum.add(d.amountDue), new library_1.Decimal(0));
    const outstandingThisMonth = currentMonthDues.reduce((sum, d) => sum.add(d.amountDue.sub(d.amountPaid)), new library_1.Decimal(0));
    const currentOutstanding = currentOutstandingDues.reduce((sum, d) => {
        const remaining = d.amountDue.sub(d.amountPaid);
        return remaining.gt(0) ? sum.add(remaining) : sum;
    }, new library_1.Decimal(0));
    const netCollectedInPeriod = activePaymentsInPeriod._sum.amount ?? new library_1.Decimal(0);
    const activePaymentCountInPeriod = activePaymentsInPeriod._count._all;
    const overpaymentsThisMonth = currentMonthOverpayments._sum.amountDelta ?? new library_1.Decimal(0);
    return res.json({
        totalHouseholds,
        totalHeadcount,
        adults: adultsCount,
        youth: youthCount,
        children: childrenCount,
        totalDueThisMonth: totalDue.toNumber(),
        collectedThisMonth: new library_1.Decimal(netCollectedInPeriod.toString()).toNumber(),
        netCollectedInPeriod: new library_1.Decimal(netCollectedInPeriod.toString()).toNumber(),
        outstandingThisMonth: outstandingThisMonth.toNumber(),
        currentOutstanding: currentOutstanding.toNumber(),
        overpaymentsThisMonth: new library_1.Decimal(overpaymentsThisMonth.toString()).toNumber(),
        activePaymentsInPeriod: activePaymentCountInPeriod,
        period: `${rangeStart.toISOString().slice(0, 10)}:${new Date(rangeEnd.getTime() - 1)
            .toISOString()
            .slice(0, 10)}`,
    });
});
