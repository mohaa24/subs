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
function startOfDay(date) {
    const next = new Date(date);
    next.setHours(0, 0, 0, 0);
    return next;
}
function endOfDay(date) {
    const next = new Date(date);
    next.setHours(23, 59, 59, 999);
    return next;
}
function formatDayKey(date) {
    return date.toISOString().slice(0, 10);
}
function labelForDay(date) {
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function addDays(date, days) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
}
function asNumber(value) {
    return Number(value.toFixed(2));
}
function activityTone(kind) {
    if (kind === "income" || kind === "collection" || kind === "payment")
        return "emerald";
    if (kind === "expense")
        return "rose";
    if (kind === "fund")
        return "violet";
    return "blue";
}
exports.dashboardRouter.get("/activity", async (req, res) => {
    const orgId = getOrgId(req);
    if (!orgId && req.auth.role !== "super_user") {
        return res.status(400).json({ error: "Organization scope required" });
    }
    const orgFilter = orgId ? { organizationId: orgId } : {};
    const requestedPage = Number(req.query?.page);
    const requestedPageSize = Number(req.query?.pageSize);
    const page = Number.isFinite(requestedPage) && requestedPage > 0 ? Math.floor(requestedPage) : 1;
    const pageSize = Number.isFinite(requestedPageSize) ? Math.min(Math.max(Math.floor(requestedPageSize), 1), 100) : 25;
    const [payments, cashTransactions, fundTransactions, feedItems] = await Promise.all([
        prisma_js_1.prisma.payment.findMany({
            where: orgFilter,
            orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }],
            take: 500,
            select: {
                id: true, amount: true, paymentDate: true, receiptNumber: true, isReversed: true,
                membership: { select: { membershipNo: true, hod: { select: { fullName: true, nameWithInitials: true } } } },
            },
        }),
        prisma_js_1.prisma.cashTransaction.findMany({
            where: orgFilter,
            orderBy: [{ transactionDate: "desc" }, { createdAt: "desc" }],
            take: 500,
            select: {
                id: true, amount: true, transactionDate: true, category: true, flowType: true,
                counterpartyName: true, description: true, documentNumber: true, reversedAt: true, reversalReason: true,
            },
        }),
        prisma_js_1.prisma.fundTransaction.findMany({
            where: orgFilter,
            orderBy: [{ transactionDate: "desc" }, { createdAt: "desc" }],
            take: 500,
            select: {
                id: true, amount: true, transactionDate: true, transactionType: true, receiptNumber: true,
                paidByName: true, description: true, memo: true, reversedAt: true, reversalReason: true,
                fundPot: { select: { id: true, name: true } },
            },
        }),
        prisma_js_1.prisma.activityFeedItem.findMany({
            where: orgFilter,
            orderBy: { createdAt: "desc" },
            take: 500,
            select: { id: true, entryType: true, body: true, createdAt: true, createdBy: { select: { email: true } } },
        }),
    ]);
    const items = [
        ...payments.map((payment) => ({
            id: `payment-${payment.id}`,
            type: payment.isReversed ? "payment_reversal" : "payment",
            title: payment.isReversed ? "Payment reversed" : "Member collection",
            description: `${payment.membership?.hod?.nameWithInitials ?? payment.membership?.hod?.fullName ?? payment.membership?.membershipNo ?? "Member"} • ${payment.receiptNumber ?? payment.id.slice(-8).toUpperCase()}`,
            amount: Number(payment.amount), occurredAt: payment.paymentDate.toISOString(), tone: payment.isReversed ? "rose" : "emerald",
        })),
        ...cashTransactions.flatMap((transaction) => [{
                id: `cash-${transaction.id}`,
                type: transaction.flowType === "cash_in" ? "cash_in" : "cash_out",
                title: transaction.category.replace(/_/g, " "),
                description: transaction.description ?? transaction.counterpartyName ?? transaction.documentNumber ?? "Cash transaction",
                amount: Number(transaction.amount), occurredAt: transaction.transactionDate.toISOString(),
                tone: transaction.flowType === "cash_in" ? "blue" : "orange",
            }, ...(transaction.reversedAt ? [{
                    id: `cash-reversal-${transaction.id}`,
                    type: "cash_reversal",
                    title: "Cash transaction reversed",
                    description: `${transaction.documentNumber ?? transaction.category.replace(/_/g, " ")} • ${transaction.reversalReason ?? "No reason recorded"}`,
                    amount: Number(transaction.amount), occurredAt: transaction.reversedAt.toISOString(), tone: "rose",
                }] : [])]),
        ...fundTransactions.flatMap((transaction) => [{
                id: `fund-${transaction.id}`,
                type: transaction.transactionType === "collection" ? "fund_collection" : "fund_expense",
                title: transaction.transactionType === "collection" ? "Fund collection" : "Fund expense",
                description: `${transaction.fundPot.name} • ${transaction.description ?? transaction.memo ?? transaction.paidByName ?? transaction.receiptNumber ?? "Fund transaction"}`,
                amount: Number(transaction.amount), occurredAt: transaction.transactionDate.toISOString(),
                tone: transaction.transactionType === "collection" ? "violet" : "rose",
            }, ...(transaction.reversedAt ? [{
                    id: `fund-reversal-${transaction.id}`,
                    type: "fund_reversal",
                    title: "Fund transaction reversed",
                    description: `${transaction.fundPot.name} • ${transaction.reversalReason ?? "No reason recorded"}`,
                    amount: Number(transaction.amount), occurredAt: transaction.reversedAt.toISOString(), tone: "rose",
                }] : [])]),
        ...feedItems.map((item) => ({
            id: `feed-${item.id}`, type: item.entryType, title: item.body ?? "Activity",
            description: item.createdBy?.email ?? "System", amount: null, occurredAt: item.createdAt.toISOString(),
            tone: item.entryType === "remark" ? "slate" : "blue",
        })),
    ].sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
    const total = items.length;
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, pageCount);
    const offset = (safePage - 1) * pageSize;
    return res.json({ page: safePage, pageSize, total, pageCount, items: items.slice(offset, offset + pageSize) });
});
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
    const financeWindowStart = startOfDay(rangeStart);
    const comparisonStart = addDays(financeWindowStart, -windowDays);
    const eighteenYearsAgo = new Date(now.getFullYear() - 18, now.getMonth(), now.getDate());
    const thirteenYearsAgo = new Date(now.getFullYear() - 13, now.getMonth(), now.getDate());
    const activePersonFilter = {
        isArchived: false,
        OR: [{ livingStatus: "Active" }, { livingStatus: null }],
    };
    const [totalHouseholds, totalHeadcount, adultsCount, youthCount, childrenCount, currentMonthDues, activePaymentsInPeriod, currentMonthOverpayments, currentOutstandingDues, journalLines, payments, cashTransactions, fundTransactions, recentFeedItems,] = await Promise.all([
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
            select: { amountDue: true, amountPaid: true, membershipId: true },
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
            select: { amountDue: true, amountPaid: true, membershipId: true },
        }),
        prisma_js_1.prisma.accountingJournalLine.findMany({
            where: {
                organizationId: orgId,
                journalEntry: { entryDate: { gte: financeWindowStart, lt: rangeEnd } },
                account: { accountType: { in: ["income", "expense"] } },
            },
            select: {
                amount: true,
                side: true,
                account: { select: { accountType: true } },
                journalEntry: { select: { entryDate: true } },
            },
        }),
        prisma_js_1.prisma.payment.findMany({
            where: {
                ...orgFilter,
                OR: [
                    { paymentDate: { gte: financeWindowStart, lt: rangeEnd } },
                    { reversedAt: { gte: financeWindowStart, lt: rangeEnd } },
                ],
            },
            orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }],
            select: {
                id: true,
                amount: true,
                paymentDate: true,
                receiptNumber: true,
                paymentMethod: true,
                paymentKind: true,
                isReversed: true,
                reversedAt: true,
                reversalReason: true,
                membership: { select: { membershipNo: true, hod: { select: { fullName: true, nameWithInitials: true } } } },
                collectedBy: { select: { email: true } },
            },
        }),
        prisma_js_1.prisma.cashTransaction.findMany({
            where: {
                ...orgFilter,
                OR: [
                    { transactionDate: { gte: financeWindowStart, lt: rangeEnd } },
                    { reversedAt: { gte: financeWindowStart, lt: rangeEnd } },
                ],
            },
            orderBy: [{ transactionDate: "desc" }, { createdAt: "desc" }],
            select: {
                id: true,
                amount: true,
                transactionDate: true,
                category: true,
                flowType: true,
                counterpartyName: true,
                description: true,
                documentNumber: true,
                createdBy: { select: { email: true } },
                reversedAt: true,
                reversalReason: true,
                accountId: true,
            },
        }),
        prisma_js_1.prisma.fundTransaction.findMany({
            where: {
                organizationId: orgId,
                OR: [
                    { transactionDate: { gte: financeWindowStart, lt: rangeEnd } },
                    { reversedAt: { gte: financeWindowStart, lt: rangeEnd } },
                ],
            },
            orderBy: [{ transactionDate: "desc" }, { createdAt: "desc" }],
            select: {
                id: true,
                amount: true,
                transactionDate: true,
                transactionType: true,
                receiptNumber: true,
                paidByName: true,
                description: true,
                memo: true,
                reversedAt: true,
                reversalReason: true,
                fundPot: { select: { id: true, name: true } },
            },
        }),
        prisma_js_1.prisma.activityFeedItem.findMany({
            where: { organizationId: orgId },
            orderBy: { createdAt: "desc" },
            take: 10,
            select: {
                id: true,
                entryType: true,
                body: true,
                metadata: true,
                createdAt: true,
                createdBy: { select: { email: true } },
            },
        }),
    ]);
    const [previousPaymentsInPeriod, previousJournalLines, newHouseholds, newPeople, newAdults, newYouth, newChildren] = await Promise.all([
        prisma_js_1.prisma.payment.aggregate({
            where: { ...orgFilter, paymentDate: { gte: comparisonStart, lt: financeWindowStart }, isReversed: false },
            _sum: { amount: true },
        }),
        prisma_js_1.prisma.accountingJournalLine.findMany({
            where: {
                organizationId: orgId,
                journalEntry: { entryDate: { gte: comparisonStart, lt: financeWindowStart } },
                account: { accountType: { in: ["income", "expense"] } },
            },
            select: { amount: true, side: true, account: { select: { accountType: true } } },
        }),
        prisma_js_1.prisma.membership.count({ where: { ...orgFilter, isArchived: false, createdAt: { gte: financeWindowStart, lt: rangeEnd } } }),
        prisma_js_1.prisma.person.count({ where: { ...orgFilter, ...activePersonFilter, createdAt: { gte: financeWindowStart, lt: rangeEnd } } }),
        prisma_js_1.prisma.person.count({ where: { ...orgFilter, ...activePersonFilter, createdAt: { gte: financeWindowStart, lt: rangeEnd }, dateOfBirth: { lte: eighteenYearsAgo } } }),
        prisma_js_1.prisma.person.count({ where: { ...orgFilter, ...activePersonFilter, createdAt: { gte: financeWindowStart, lt: rangeEnd }, dateOfBirth: { gt: eighteenYearsAgo, lte: thirteenYearsAgo } } }),
        prisma_js_1.prisma.person.count({ where: { ...orgFilter, ...activePersonFilter, createdAt: { gte: financeWindowStart, lt: rangeEnd }, dateOfBirth: { gt: thirteenYearsAgo } } }),
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
    const financeDays = [];
    for (let i = 0; i < windowDays; i += 1) {
        const day = addDays(financeWindowStart, i);
        financeDays.push({
            key: formatDayKey(day),
            label: labelForDay(day),
            income: 0,
            expense: 0,
            memberCollection: 0,
            cashIn: 0,
            cashOut: 0,
            outstanding: 0,
        });
    }
    const bucketFor = (value) => financeDays.find((day) => day.key === formatDayKey(value));
    for (const line of journalLines) {
        const bucket = bucketFor(line.journalEntry.entryDate);
        if (!bucket)
            continue;
        const amount = Number(line.amount);
        if (line.account.accountType === "income") {
            bucket.income += line.side === "credit" ? amount : -amount;
        }
        if (line.account.accountType === "expense") {
            bucket.expense += line.side === "debit" ? amount : -amount;
        }
    }
    for (const payment of payments) {
        const amount = Number(payment.amount);
        const paymentBucket = bucketFor(payment.paymentDate);
        if (paymentBucket) {
            paymentBucket.memberCollection += amount;
            paymentBucket.cashIn += amount;
        }
        if (payment.isReversed && payment.reversedAt) {
            const reversalBucket = bucketFor(payment.reversedAt);
            if (reversalBucket)
                reversalBucket.cashOut += amount;
        }
    }
    for (const transaction of cashTransactions) {
        const amount = Number(transaction.amount);
        const inflowCategories = new Set(["operating_income", "receivable_collection", "payable_borrowing", "payable_recovery"]);
        const outflowCategories = new Set(["operating_expense", "receivable_payment", "receivable_write_off", "payable_repayment", "payable_payment"]);
        const transactionBucket = bucketFor(transaction.transactionDate);
        const isInflow = inflowCategories.has(transaction.category);
        const isOutflow = outflowCategories.has(transaction.category);
        if (transactionBucket && isInflow)
            transactionBucket.cashIn += amount;
        if (transactionBucket && isOutflow)
            transactionBucket.cashOut += amount;
        if (transaction.reversedAt) {
            const reversalBucket = bucketFor(transaction.reversedAt);
            if (reversalBucket && isInflow)
                reversalBucket.cashOut += amount;
            if (reversalBucket && isOutflow)
                reversalBucket.cashIn += amount;
        }
    }
    for (const transaction of fundTransactions) {
        const amount = Number(transaction.amount);
        const transactionBucket = bucketFor(transaction.transactionDate);
        if (transactionBucket && transaction.transactionType === "collection")
            transactionBucket.cashIn += amount;
        if (transactionBucket && transaction.transactionType === "expense")
            transactionBucket.cashOut += amount;
        if (transaction.reversedAt) {
            const reversalBucket = bucketFor(transaction.reversedAt);
            if (reversalBucket && transaction.transactionType === "collection")
                reversalBucket.cashOut += amount;
            if (reversalBucket && transaction.transactionType === "expense")
                reversalBucket.cashIn += amount;
        }
    }
    for (const day of financeDays) {
        day.outstanding = Number((day.expense + day.cashOut - day.income - day.cashIn).toFixed(2));
    }
    const financeTotals = financeDays.reduce((sum, day) => ({
        income: sum.income + day.income,
        expense: sum.expense + day.expense,
        memberCollection: sum.memberCollection + day.memberCollection,
        cashIn: sum.cashIn + day.cashIn,
        cashOut: sum.cashOut + day.cashOut,
    }), { income: 0, expense: 0, memberCollection: 0, cashIn: 0, cashOut: 0 });
    const currentDue = currentMonthDues.reduce((sum, d) => sum.add(d.amountDue), new library_1.Decimal(0));
    const collectionRate = currentDue.gt(0)
        ? Number(netCollectedInPeriod.div(currentDue).mul(100).toFixed(2))
        : 0;
    const previousFinancial = previousJournalLines.reduce((sum, line) => {
        const amount = Number(line.amount);
        if (line.account.accountType === "income" && line.side === "credit")
            sum.income += amount;
        if (line.account.accountType === "expense" && line.side === "debit")
            sum.expense += amount;
        return sum;
    }, { income: 0, expense: 0 });
    const outstandingMemberCount = new Set(currentOutstandingDues
        .filter((due) => due.amountDue.gt(due.amountPaid))
        .map((due) => due.membershipId)).size;
    const recentActivity = [
        ...payments.slice(0, 8).map((payment) => ({
            id: `payment-${payment.id}`,
            type: payment.isReversed ? "payment_reversal" : "payment",
            title: payment.isReversed ? "Payment reversed" : "Member collection",
            description: `${payment.membership?.hod?.nameWithInitials ?? payment.membership?.hod?.fullName ?? payment.membership?.membershipNo ?? "Member"} • ${payment.receiptNumber ?? payment.id.slice(-8).toUpperCase()}`,
            amount: Number(payment.amount),
            occurredAt: payment.paymentDate.toISOString(),
            href: "/payments",
            tone: payment.isReversed ? "rose" : "emerald",
        })),
        ...cashTransactions.slice(0, 8).flatMap((transaction) => [{
                id: `cash-${transaction.id}`,
                type: transaction.flowType === "cash_in" ? "cash_in" : "cash_out",
                title: transaction.category.replace(/_/g, " "),
                description: transaction.description ?? transaction.counterpartyName ?? transaction.documentNumber ?? "Cash transaction",
                amount: Number(transaction.amount),
                occurredAt: transaction.transactionDate.toISOString(),
                href: transaction.flowType === "cash_in" ? "/cash-in" : "/cash-out",
                tone: transaction.flowType === "cash_in" ? "blue" : "orange",
            }, ...(transaction.reversedAt ? [{
                    id: `cash-reversal-${transaction.id}`,
                    type: "cash_reversal",
                    title: "Cash transaction reversed",
                    description: `${transaction.documentNumber ?? transaction.category.replace(/_/g, " ")} • ${transaction.reversalReason ?? "No reason recorded"}`,
                    amount: Number(transaction.amount), occurredAt: transaction.reversedAt.toISOString(), href: transaction.flowType === "cash_in" ? "/cash-in" : "/cash-out", tone: "rose",
                }] : [])]),
        ...fundTransactions.slice(0, 8).flatMap((transaction) => [{
                id: `fund-${transaction.id}`,
                type: transaction.transactionType === "collection" ? "fund_collection" : "fund_expense",
                title: transaction.transactionType === "collection" ? "Fund collection" : "Fund expense",
                description: `${transaction.fundPot.name} • ${transaction.description ?? transaction.memo ?? transaction.paidByName ?? transaction.receiptNumber ?? "Fund transaction"}`,
                amount: Number(transaction.amount),
                occurredAt: transaction.transactionDate.toISOString(),
                href: `/funds/${transaction.fundPot.id}`,
                tone: transaction.transactionType === "collection" ? "violet" : "rose",
            }, ...(transaction.reversedAt ? [{
                    id: `fund-reversal-${transaction.id}`,
                    type: "fund_reversal",
                    title: "Fund transaction reversed",
                    description: `${transaction.fundPot.name} • ${transaction.reversalReason ?? "No reason recorded"}`,
                    amount: Number(transaction.amount), occurredAt: transaction.reversedAt.toISOString(), href: `/funds/${transaction.fundPot.id}`, tone: "rose",
                }] : [])]),
        ...recentFeedItems.map((item) => ({
            id: `feed-${item.id}`,
            type: item.entryType,
            title: item.body ?? "Activity",
            description: item.createdBy?.email ?? "System",
            amount: null,
            occurredAt: item.createdAt.toISOString(),
            href: null,
            tone: item.entryType === "remark" ? "slate" : "blue",
        })),
    ]
        .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
        .slice(0, 12);
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
        comparison: {
            previousMemberCollection: Number((previousPaymentsInPeriod._sum.amount ?? new library_1.Decimal(0)).toFixed(2)),
            previousIncome: Number(previousFinancial.income.toFixed(2)),
            previousExpense: Number(previousFinancial.expense.toFixed(2)),
            newHouseholds,
            newPeople,
            newAdults,
            newYouth,
            newChildren,
            outstandingMemberCount,
        },
        period: `${rangeStart.toISOString().slice(0, 10)}:${new Date(rangeEnd.getTime() - 1)
            .toISOString()
            .slice(0, 10)}`,
        financialOverview: {
            totalIncome: Number(financeTotals.income.toFixed(2)),
            totalExpense: Number(financeTotals.expense.toFixed(2)),
            netIncome: Number((financeTotals.income - financeTotals.expense).toFixed(2)),
            memberCollection: Number(financeTotals.memberCollection.toFixed(2)),
            collectionRate,
            series: financeDays.map((day) => ({
                label: day.label,
                memberCollection: Number(day.memberCollection.toFixed(2)),
                income: Number(day.income.toFixed(2)),
                expense: Number(day.expense.toFixed(2)),
                cashIn: Number(day.cashIn.toFixed(2)),
                cashOut: Number(day.cashOut.toFixed(2)),
                netIncome: Number((day.income - day.expense).toFixed(2)),
                outstanding: Number(day.outstanding.toFixed(2)),
            })),
        },
        recentActivity,
    });
});
