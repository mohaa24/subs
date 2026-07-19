"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.accountingRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const library_1 = require("@prisma/client/runtime/library");
const prisma_js_1 = require("../lib/prisma.js");
const auth_js_1 = require("../middleware/auth.js");
const accounting_js_1 = require("../lib/accounting.js");
exports.accountingRouter = (0, express_1.Router)();
exports.accountingRouter.use(auth_js_1.requireAuth);
exports.accountingRouter.use(auth_js_1.withOrgScope);
const accountTypes = ["asset", "liability", "equity", "income", "expense"];
const accountSubtypes = [
    "cash",
    "bank",
    "loan_receivable",
    "service_receivable",
    "other",
    "loan_payable",
    "service_payable",
    "other_liability",
    "general_fund",
    "project_fund",
    "operating_income",
    "project_fund_surplus",
    "operating_expense",
    "project_fund_deficit",
];
const accountSubtypesByType = {
    asset: ["cash", "bank", "loan_receivable", "service_receivable", "other"],
    liability: ["loan_payable", "service_payable", "other_liability"],
    equity: ["general_fund", "project_fund"],
    income: ["operating_income", "project_fund_surplus"],
    expense: ["operating_expense", "project_fund_deficit"],
};
const cashBankSubtypes = ["cash", "bank"];
const receivableSubtypes = ["loan_receivable", "service_receivable"];
const payableSubtypes = ["loan_payable", "service_payable"];
function getOrgId(req) {
    return req.organizationId ?? req.body?.organizationId ?? req.query?.organizationId;
}
function requireAccountingRole(req, res) {
    if (req.auth.role !== "admin" && req.auth.role !== "super_user") {
        res.status(403).json({ error: "Only admins can manage accounting" });
        return false;
    }
    return true;
}
function asyncRoute(handler) {
    return (req, res, next) => {
        Promise.resolve(handler(req, res, next)).catch((error) => {
            console.error("[Accounting] Route error:", error);
            if (!res.headersSent) {
                res.status(500).json({ error: "Accounting request failed" });
                return;
            }
            next(error);
        });
    };
}
function dateFromQuery(value, fallback) {
    if (typeof value !== "string" || !value.trim())
        return fallback;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}
function optionalDateFromQuery(value) {
    if (typeof value !== "string" || !value.trim())
        return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
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
function asNumber(value) {
    return Number(value.toFixed(2));
}
function serializeAccount(account) {
    return {
        ...account,
        debitTotal: account.debitTotal ? asNumber(account.debitTotal) : undefined,
        creditTotal: account.creditTotal ? asNumber(account.creditTotal) : undefined,
        balance: account.balance ? asNumber(account.balance) : undefined,
    };
}
function serializeJournalEntry(entry) {
    return {
        ...entry,
        entryDate: entry.entryDate.toISOString(),
        createdAt: entry.createdAt.toISOString(),
        lines: entry.lines?.map((line) => ({
            ...line,
            amount: Number(line.amount),
            createdAt: line.createdAt?.toISOString?.() ?? line.createdAt,
        })),
    };
}
const createAccountSchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(1).max(120),
    accountType: zod_1.z.enum(accountTypes),
    assetSubtype: zod_1.z.enum(accountSubtypes).optional(),
    description: zod_1.z.string().trim().max(500).optional().nullable(),
}).superRefine((data, ctx) => {
    if (data.assetSubtype && !accountSubtypesByType[data.accountType].includes(data.assetSubtype)) {
        ctx.addIssue({
            code: zod_1.z.ZodIssueCode.custom,
            path: ["assetSubtype"],
            message: "Selected subtype does not match the account type",
        });
    }
});
const updateAccountSchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(1).max(120).optional(),
    assetSubtype: zod_1.z.enum(accountSubtypes).optional(),
    description: zod_1.z.string().trim().max(500).optional().nullable(),
    isActive: zod_1.z.boolean().optional(),
});
const moneySchema = zod_1.z.number().positive("Amount must be greater than zero");
const expenseSchema = zod_1.z.object({
    sourceAccountId: zod_1.z.string().min(1),
    expenseAccountId: zod_1.z.string().min(1),
    amount: moneySchema,
    entryDate: zod_1.z.string().optional(),
    description: zod_1.z.string().trim().min(1).max(300),
    memo: zod_1.z.string().trim().max(500).optional().nullable(),
});
const incomeSchema = zod_1.z.object({
    destinationAccountId: zod_1.z.string().min(1),
    incomeAccountId: zod_1.z.string().min(1),
    amount: moneySchema,
    entryDate: zod_1.z.string().optional(),
    description: zod_1.z.string().trim().min(1).max(300),
    memo: zod_1.z.string().trim().max(500).optional().nullable(),
});
const transferSchema = zod_1.z.object({
    fromAccountId: zod_1.z.string().min(1),
    toAccountId: zod_1.z.string().min(1),
    amount: moneySchema,
    entryDate: zod_1.z.string().optional(),
    description: zod_1.z.string().trim().min(1).max(300),
});
const cashTransactionSchema = zod_1.z.object({
    accountId: zod_1.z.string().min(1),
    cashBankAccountId: zod_1.z.string().min(1),
    amount: moneySchema,
    transactionDate: zod_1.z.string().optional(),
    counterpartyName: zod_1.z.string().trim().min(1).max(160),
    counterpartyPhone: zod_1.z.string().trim().max(40).optional().nullable(),
    counterpartyMembershipId: zod_1.z.string().optional().nullable(),
    reference: zod_1.z.string().trim().max(120).optional().nullable(),
    description: zod_1.z.string().trim().max(500).optional().nullable(),
});
const cashReverseSchema = zod_1.z.object({
    reason: zod_1.z.string().trim().min(1, "Reversal reason is required").max(500),
});
const createFundSchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(1).max(120),
    description: zod_1.z.string().trim().max(500).optional().nullable(),
    managerName: zod_1.z.string().trim().max(160).optional().nullable(),
    periodStart: zod_1.z.string().optional().nullable(),
    periodEnd: zod_1.z.string().optional().nullable(),
    openingBalance: zod_1.z.number().min(0).optional(),
    openingAssetAccountId: zod_1.z.string().optional().nullable(),
}).superRefine((data, ctx) => {
    if ((data.openingBalance ?? 0) > 0 && !data.openingAssetAccountId) {
        ctx.addIssue({
            code: zod_1.z.ZodIssueCode.custom,
            path: ["openingAssetAccountId"],
            message: "Opening asset account is required when opening balance is greater than zero",
        });
    }
    const periodStart = data.periodStart ? new Date(data.periodStart) : null;
    const periodEnd = data.periodEnd ? new Date(data.periodEnd) : null;
    if (data.periodStart && (!periodStart || Number.isNaN(periodStart.getTime()))) {
        ctx.addIssue({
            code: zod_1.z.ZodIssueCode.custom,
            path: ["periodStart"],
            message: "Fund period start date is invalid",
        });
    }
    if (data.periodEnd && (!periodEnd || Number.isNaN(periodEnd.getTime()))) {
        ctx.addIssue({
            code: zod_1.z.ZodIssueCode.custom,
            path: ["periodEnd"],
            message: "Fund period end date is invalid",
        });
    }
    if (periodStart && periodEnd && periodStart > periodEnd) {
        ctx.addIssue({
            code: zod_1.z.ZodIssueCode.custom,
            path: ["periodEnd"],
            message: "Fund period end date must be after the start date",
        });
    }
});
const fundCollectionSchema = zod_1.z.object({
    amount: moneySchema,
    assetAccountId: zod_1.z.string().min(1),
    transactionDate: zod_1.z.string().optional(),
    paidByName: zod_1.z.string().trim().min(1).max(160),
    paidByPhone: zod_1.z.string().trim().max(40).optional().nullable(),
    paidByMembershipId: zod_1.z.string().optional().nullable(),
    memo: zod_1.z.string().trim().max(500).optional().nullable(),
});
const fundExpenseSchema = zod_1.z.object({
    amount: moneySchema,
    assetAccountId: zod_1.z.string().min(1),
    transactionDate: zod_1.z.string().optional(),
    description: zod_1.z.string().trim().min(1).max(300),
    memo: zod_1.z.string().trim().max(500).optional().nullable(),
});
const fundTransferSchema = zod_1.z.object({
    amount: zod_1.z.number().positive().optional().nullable(),
    transactionDate: zod_1.z.string().optional(),
    memo: zod_1.z.string().trim().max(500).optional().nullable(),
});
function requireAccountingAdmin(req, res, next) {
    if (!requireAccountingRole(req, res))
        return;
    next();
}
function fundDelta(type, amount) {
    if (type === "opening" || type === "collection" || type === "deficit_transfer")
        return amount;
    return amount.neg();
}
function fundTransferSignedAmount(type, amount) {
    if (type === "surplus_transfer")
        return amount;
    if (type === "deficit_transfer")
        return amount.neg();
    return new library_1.Decimal(0);
}
function summarizeFundTransactions(transactions, from, toEnd) {
    let opening = new library_1.Decimal(0);
    let received = new library_1.Decimal(0);
    let spent = new library_1.Decimal(0);
    let netTransferred = new library_1.Decimal(0);
    const fromStart = from ? startOfDay(from) : null;
    for (const txRow of transactions) {
        if (txRow.reversedAt)
            continue;
        const inPeriod = (!fromStart || txRow.transactionDate >= fromStart) &&
            (!toEnd || txRow.transactionDate <= toEnd);
        if (!inPeriod) {
            opening = opening.add(fundDelta(txRow.transactionType, txRow.amount));
            continue;
        }
        if (txRow.transactionType === "opening")
            opening = opening.add(txRow.amount);
        if (txRow.transactionType === "collection")
            received = received.add(txRow.amount);
        if (txRow.transactionType === "expense")
            spent = spent.add(txRow.amount);
        netTransferred = netTransferred.add(fundTransferSignedAmount(txRow.transactionType, txRow.amount));
    }
    const activeRemaining = opening.add(received).sub(spent).sub(netTransferred);
    return {
        opening: asNumber(opening),
        received: asNumber(received),
        spent: asNumber(spent),
        netTransferred: asNumber(netTransferred),
        activeRemaining: asNumber(activeRemaining),
    };
}
function summarizeFundReportTransactions(transactions, from, toEnd) {
    let openingBalance = new library_1.Decimal(0);
    let totalCollected = new library_1.Decimal(0);
    let totalSpent = new library_1.Decimal(0);
    let totalTransferred = new library_1.Decimal(0);
    const fromStart = from ? startOfDay(from) : null;
    for (const txRow of transactions) {
        if (txRow.reversedAt)
            continue;
        if (toEnd && txRow.transactionDate > toEnd)
            continue;
        if (fromStart && txRow.transactionDate < fromStart) {
            openingBalance = openingBalance.add(fundDelta(txRow.transactionType, txRow.amount));
            continue;
        }
        if (txRow.transactionType === "opening") {
            openingBalance = openingBalance.add(txRow.amount);
        }
        if (txRow.transactionType === "collection") {
            totalCollected = totalCollected.add(txRow.amount);
        }
        if (txRow.transactionType === "expense") {
            totalSpent = totalSpent.add(txRow.amount);
        }
        totalTransferred = totalTransferred.sub(fundTransferSignedAmount(txRow.transactionType, txRow.amount));
    }
    const remainingBalance = openingBalance.add(totalCollected).sub(totalSpent).add(totalTransferred);
    return {
        openingBalance: asNumber(openingBalance),
        totalCollected: asNumber(totalCollected),
        totalSpent: asNumber(totalSpent),
        totalTransferred: asNumber(totalTransferred),
        remainingBalance: asNumber(remainingBalance),
    };
}
function fundReportRange(query) {
    const period = typeof query.period === "string" ? query.period : "from_start";
    const now = new Date();
    if (period === "current_month") {
        return { from: startOfDay(new Date(now.getFullYear(), now.getMonth(), 1)), toEnd: endOfDay(now), period };
    }
    if (period === "current_year") {
        return { from: startOfDay(new Date(now.getFullYear(), 0, 1)), toEnd: endOfDay(now), period };
    }
    if (period === "custom") {
        return {
            from: optionalDateFromQuery(query.fromDate),
            toEnd: optionalDateFromQuery(query.toDate) ? endOfDay(optionalDateFromQuery(query.toDate)) : null,
            period,
        };
    }
    return { from: null, toEnd: null, period: "from_start" };
}
function fundReceiptNumberPrefix(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    return `F${year}${month}`;
}
async function generateFundReceiptNumber(tx, organizationId, transactionDate) {
    const prefix = fundReceiptNumberPrefix(transactionDate);
    const latest = await tx.fundTransaction.findFirst({
        where: { organizationId, receiptNumber: { startsWith: prefix } },
        orderBy: { receiptNumber: "desc" },
        select: { receiptNumber: true },
    });
    const previousSequence = latest?.receiptNumber
        ? parseInt(latest.receiptNumber.slice(prefix.length), 10) || 0
        : 0;
    return `${prefix}${String(previousSequence + 1).padStart(4, "0")}`;
}
async function fundBalance(tx, organizationId, fundPotId, beforeDate) {
    const transactions = await tx.fundTransaction.findMany({
        where: {
            organizationId,
            fundPotId,
            ...(beforeDate ? { transactionDate: { lt: beforeDate } } : {}),
        },
        select: { transactionType: true, amount: true, reversedAt: true },
    });
    return transactions.reduce((sum, txRow) => txRow.reversedAt ? sum : sum.add(fundDelta(txRow.transactionType, txRow.amount)), new library_1.Decimal(0));
}
async function requireCashBankAccount(tx, organizationId, accountId) {
    const account = await tx.accountingAccount.findFirst({
        where: {
            id: accountId,
            organizationId,
            accountType: "asset",
            assetSubtype: { in: cashBankSubtypes },
            isActive: true,
        },
    });
    if (!account)
        throw new Error("Account must be an active cash/bank asset account");
    return account;
}
async function nextAvailableAccountName(tx, organizationId, baseName) {
    for (let attempt = 0; attempt < 50; attempt += 1) {
        const name = attempt === 0 ? baseName : `${baseName} ${attempt + 1}`;
        const existing = await tx.accountingAccount.findFirst({
            where: { organizationId, name: { equals: name, mode: "insensitive" } },
            select: { id: true },
        });
        if (!existing)
            return name;
    }
    return `${baseName} ${Date.now()}`;
}
function serializeFundTransaction(txRow) {
    return {
        ...txRow,
        amount: Number(txRow.amount),
        transactionDate: txRow.transactionDate.toISOString(),
        createdAt: txRow.createdAt.toISOString(),
        reversedAt: txRow.reversedAt?.toISOString?.() ?? null,
    };
}
function buildFundReceipt(transaction, collectedByEmail) {
    return {
        receiptNumber: transaction.receiptNumber,
        transactionId: transaction.id,
        transactionDate: transaction.transactionDate.toISOString(),
        organizationName: transaction.organization.name,
        organizationReceiptLogoUrl: transaction.organization.receiptLogoUrl,
        fundName: transaction.fundPot.name,
        paidByName: transaction.paidByName,
        paidByPhone: transaction.paidByPhone,
        amount: Number(transaction.amount),
        receivedInto: transaction.assetAccount?.name ?? null,
        note: transaction.memo,
        collectedBy: collectedByEmail ?? null,
    };
}
function firstOfMonth(date = new Date()) {
    return startOfDay(new Date(date.getFullYear(), date.getMonth(), 1));
}
function firstOfYear(date = new Date()) {
    return startOfDay(new Date(date.getFullYear(), 0, 1));
}
function cashFlowRange(query) {
    const from = optionalDateFromQuery(query.fromDate) ?? firstOfYear();
    const toEnd = optionalDateFromQuery(query.toDate) ? endOfDay(optionalDateFromQuery(query.toDate)) : endOfDay(new Date());
    return { from, toEnd };
}
function cashDocumentPrefix(flowType, transactionDate) {
    const year = transactionDate.getFullYear();
    const month = String(transactionDate.getMonth() + 1).padStart(2, "0");
    return `${flowType === "cash_in" ? "RC" : "PV"}${year}${month}`;
}
async function generateCashDocumentNumber(tx, organizationId, flowType, transactionDate) {
    const prefix = cashDocumentPrefix(flowType, transactionDate);
    const latest = await tx.cashTransaction.findFirst({
        where: { organizationId, documentNumber: { startsWith: prefix } },
        orderBy: { documentNumber: "desc" },
        select: { documentNumber: true },
    });
    const previousSequence = latest?.documentNumber
        ? parseInt(latest.documentNumber.slice(prefix.length), 10) || 0
        : 0;
    return `${prefix}${String(previousSequence + 1).padStart(4, "0")}`;
}
function cashTransactionLabel(category) {
    if (category === "operating_income")
        return "Operating income";
    if (category === "receivable_payment")
        return "Receivable payment";
    if (category === "receivable_collection")
        return "Receivable collection";
    if (category === "operating_expense")
        return "Operating expense";
    if (category === "payable_recovery")
        return "Payable recovery";
    return "Payable payment";
}
function cashAccountWhere(flowType, category) {
    if (flowType === "cash_in" && category === "operating_income") {
        return {
            accountType: "income",
            assetSubtype: "operating_income",
            OR: [{ systemKey: null }, { NOT: { systemKey: { startsWith: "income_due_type_" } } }],
        };
    }
    if (category === "receivable_collection" || category === "receivable_payment") {
        return { accountType: "asset", assetSubtype: { in: receivableSubtypes } };
    }
    if (flowType === "cash_out" && category === "operating_expense") {
        return { accountType: "expense", assetSubtype: "operating_expense" };
    }
    return {
        accountType: "liability",
        assetSubtype: { in: payableSubtypes },
        OR: [{ systemKey: null }, { systemKey: { not: "liability_member_credit" } }],
    };
}
function isReceivableSubtype(subtype) {
    return receivableSubtypes.includes(subtype);
}
function isPayableSubtype(subtype) {
    return payableSubtypes.includes(subtype);
}
function accountSubtypeLabel(subtype) {
    if (!subtype)
        return null;
    return subtype.replace(/_/g, " ");
}
function cashAccountBalance(accountType, debit = new library_1.Decimal(0), credit = new library_1.Decimal(0)) {
    return (0, accounting_js_1.accountBalanceExpression)(accountType, debit, credit);
}
async function groupedAccountTotals(tx, organizationId, accountIds, from, toEnd) {
    if (!accountIds.length)
        return new Map();
    const rows = await tx.accountingJournalLine.groupBy({
        by: ["accountId", "side"],
        where: {
            organizationId,
            accountId: { in: accountIds },
            journalEntry: {
                ...(from || toEnd
                    ? {
                        entryDate: {
                            ...(from ? { gte: startOfDay(from) } : {}),
                            ...(toEnd ? { lte: toEnd } : {}),
                        },
                    }
                    : {}),
            },
        },
        _sum: { amount: true },
    });
    const totals = new Map();
    for (const row of rows) {
        const existing = totals.get(row.accountId) ?? { debit: new library_1.Decimal(0), credit: new library_1.Decimal(0) };
        if (row.side === "debit")
            existing.debit = existing.debit.add(row._sum.amount ?? new library_1.Decimal(0));
        else
            existing.credit = existing.credit.add(row._sum.amount ?? new library_1.Decimal(0));
        totals.set(row.accountId, existing);
    }
    return totals;
}
async function latestAccountActivity(tx, organizationId, accountIds) {
    const latest = new Map();
    await Promise.all(accountIds.map(async (accountId) => {
        const line = await tx.accountingJournalLine.findFirst({
            where: { organizationId, accountId },
            orderBy: [{ journalEntry: { entryDate: "desc" } }, { createdAt: "desc" }],
            select: { accountId: true, journalEntry: { select: { entryDate: true } } },
        });
        if (line)
            latest.set(accountId, line.journalEntry.entryDate.toISOString());
    }));
    return latest;
}
function serializeCashTransaction(txRow) {
    return {
        ...txRow,
        amount: Number(txRow.amount),
        transactionDate: txRow.transactionDate.toISOString(),
        createdAt: txRow.createdAt.toISOString(),
        reversedAt: txRow.reversedAt?.toISOString?.() ?? null,
    };
}
function cashRowFromAccount(account, periodTotals, monthTotals, latest) {
    const period = periodTotals.get(account.id) ?? new library_1.Decimal(0);
    const month = monthTotals.get(account.id) ?? new library_1.Decimal(0);
    return {
        id: account.id,
        name: account.name,
        accountType: account.accountType,
        assetSubtype: account.assetSubtype,
        systemKey: account.systemKey,
        isActive: account.isActive,
        periodTotal: asNumber(period),
        thisMonthTotal: asNumber(month),
        lastRecordedAt: latest.get(account.id) ?? null,
    };
}
async function groupedCashTransactionTotals(tx, organizationId, accountIds, flowType, category, from, toEnd) {
    if (!accountIds.length)
        return new Map();
    const rows = await tx.cashTransaction.groupBy({
        by: ["accountId"],
        where: {
            organizationId,
            accountId: { in: accountIds },
            flowType,
            category,
            reversedAt: null,
            transactionDate: { gte: from, lte: toEnd },
        },
        _sum: { amount: true },
    });
    return new Map(rows.map((row) => [row.accountId, row._sum.amount ?? new library_1.Decimal(0)]));
}
async function latestCashTransactionActivity(tx, organizationId, accountIds, flowType, category) {
    const latest = new Map();
    await Promise.all(accountIds.map(async (accountId) => {
        const txRow = await tx.cashTransaction.findFirst({
            where: { organizationId, accountId, flowType, category, reversedAt: null },
            orderBy: [{ transactionDate: "desc" }, { createdAt: "desc" }],
            select: { accountId: true, transactionDate: true },
        });
        if (txRow)
            latest.set(accountId, txRow.transactionDate.toISOString());
    }));
    return latest;
}
async function cashTransactionAmount(tx, organizationId, input) {
    const result = await tx.cashTransaction.aggregate({
        where: {
            organizationId,
            accountId: input.accountId,
            flowType: input.flowType,
            category: input.category,
            reversedAt: null,
            ...(input.from || input.toEnd
                ? {
                    transactionDate: {
                        ...(input.from ? { gte: input.from } : {}),
                        ...(input.toEnd ? { lte: input.toEnd } : {}),
                    },
                }
                : {}),
        },
        _sum: { amount: true },
        _count: { _all: true },
    });
    return {
        amount: result._sum.amount ?? new library_1.Decimal(0),
        count: result._count._all,
    };
}
async function cashAccountRows(tx, organizationId, flowType, category, from, toEnd, search) {
    const accounts = await tx.accountingAccount.findMany({
        where: {
            organizationId,
            isActive: true,
            ...cashAccountWhere(flowType, category),
            ...(search ? { name: { contains: search, mode: "insensitive" } } : {}),
        },
        orderBy: { name: "asc" },
    });
    const ids = accounts.map((account) => account.id);
    const [periodTotals, monthTotals, latest] = await Promise.all([
        groupedCashTransactionTotals(tx, organizationId, ids, flowType, category, from, toEnd),
        groupedCashTransactionTotals(tx, organizationId, ids, flowType, category, firstOfMonth(), endOfDay(new Date())),
        latestCashTransactionActivity(tx, organizationId, ids, flowType, category),
    ]);
    return accounts.map((account) => cashRowFromAccount(account, periodTotals, monthTotals, latest));
}
async function cashFundRows(tx, organizationId, flowType, from, toEnd, search) {
    const funds = await tx.fundPot.findMany({
        where: {
            organizationId,
            status: "active",
            ...(search ? { name: { contains: search, mode: "insensitive" } } : {}),
        },
        include: {
            transactions: {
                where: { transactionDate: { lte: toEnd } },
                orderBy: [{ transactionDate: "asc" }, { createdAt: "asc" }],
            },
        },
        orderBy: { name: "asc" },
    });
    const monthStart = firstOfMonth();
    const monthEnd = endOfDay(new Date());
    const targetType = flowType === "cash_in" ? "collection" : "expense";
    return funds.map((fund) => {
        const periodSummary = summarizeFundTransactions(fund.transactions, from, toEnd);
        const monthSummary = summarizeFundTransactions(fund.transactions, monthStart, monthEnd);
        const last = [...fund.transactions]
            .reverse()
            .find((txRow) => txRow.transactionType === targetType && !txRow.reversedAt);
        return {
            id: fund.id,
            name: fund.name,
            status: fund.status,
            periodTotal: flowType === "cash_in" ? periodSummary.opening + periodSummary.received : periodSummary.spent,
            thisMonthTotal: flowType === "cash_in" ? monthSummary.opening + monthSummary.received : monthSummary.spent,
            lastRecordedAt: last?.transactionDate.toISOString() ?? null,
            summary: periodSummary,
        };
    });
}
async function buildCashFlowOverview(req, res, flowType) {
    const orgId = getOrgId(req);
    if (!orgId)
        return res.status(400).json({ error: "Organization scope required" });
    const { from, toEnd } = cashFlowRange(req.query);
    const search = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const sections = flowType === "cash_in"
        ? [
            { key: "operating_income", title: "Operating Income" },
            { key: "project_fund_collection", title: "Special Fund Collections" },
            { key: "receivable_collection", title: "Receivable Collection" },
        ]
        : [
            { key: "operating_expense", title: "Operating Expenses" },
            { key: "project_fund_expense", title: "Special Fund Expenses" },
            { key: "payable_payment", title: "Payable Payments" },
        ];
    const data = await prisma_js_1.prisma.$transaction(async (tx) => {
        await (0, accounting_js_1.ensureDefaultAccountingAccounts)(tx, orgId);
        const operatingCategory = flowType === "cash_in" ? "operating_income" : "operating_expense";
        const balanceCategory = flowType === "cash_in" ? "receivable_collection" : "payable_payment";
        const [operatingRows, fundRows, balanceRows] = await Promise.all([
            cashAccountRows(tx, orgId, flowType, operatingCategory, from, toEnd, search),
            cashFundRows(tx, orgId, flowType, from, toEnd, search),
            cashAccountRows(tx, orgId, flowType, balanceCategory, from, toEnd, search),
        ]);
        const rowsByKey = flowType === "cash_in"
            ? { operating_income: operatingRows, project_fund_collection: fundRows, receivable_collection: balanceRows }
            : { operating_expense: operatingRows, project_fund_expense: fundRows, payable_payment: balanceRows };
        return sections.map((section) => {
            const rows = rowsByKey[section.key] ?? [];
            return {
                ...section,
                rows,
                total: Number(rows.reduce((sum, row) => sum + row.periodTotal, 0).toFixed(2)),
            };
        });
    });
    const totals = data.reduce((sum, section) => ({
        periodTotal: sum.periodTotal + section.total,
        accountCount: sum.accountCount + section.rows.length,
    }), { periodTotal: 0, accountCount: 0 });
    return res.json({
        flowType,
        fromDate: from.toISOString(),
        toDate: toEnd.toISOString(),
        sections: data,
        totals: { ...totals, periodTotal: Number(totals.periodTotal.toFixed(2)) },
    });
}
async function loadCashAccountDetail(req, res, flowType) {
    const orgId = getOrgId(req);
    if (!orgId)
        return res.status(400).json({ error: "Organization scope required" });
    const { from, toEnd } = cashFlowRange(req.query);
    const account = await prisma_js_1.prisma.accountingAccount.findFirst({
        where: { id: req.params.id, organizationId: orgId },
    });
    if (!account)
        return res.status(404).json({ error: "Account not found" });
    const detailCategory = isReceivableSubtype(account.assetSubtype)
        ? "receivable_collection"
        : isPayableSubtype(account.assetSubtype)
            ? "payable_payment"
            : flowType === "cash_in"
                ? "operating_income"
                : "operating_expense";
    const oppositeCategory = isReceivableSubtype(account.assetSubtype)
        ? "receivable_payment"
        : isPayableSubtype(account.assetSubtype)
            ? "payable_recovery"
            : null;
    const historyWhere = isReceivableSubtype(account.assetSubtype)
        ? {
            organizationId: orgId,
            accountId: account.id,
            OR: [
                { flowType: "cash_in", category: "receivable_collection" },
                { flowType: "cash_out", category: "receivable_payment" },
            ],
            transactionDate: { gte: from, lte: toEnd },
        }
        : isPayableSubtype(account.assetSubtype)
            ? {
                organizationId: orgId,
                accountId: account.id,
                OR: [
                    { flowType: "cash_out", category: "payable_payment" },
                    { flowType: "cash_in", category: "payable_recovery" },
                ],
                transactionDate: { gte: from, lte: toEnd },
            }
            : {
                organizationId: orgId,
                accountId: account.id,
                flowType,
                transactionDate: { gte: from, lte: toEnd },
            };
    const [allTotals, postedPeriod, postedMonth, postedAll, oppositePeriod, oppositeMonth, oppositeAll, history] = await prisma_js_1.prisma.$transaction(async (tx) => Promise.all([
        groupedAccountTotals(tx, orgId, [account.id], null, null),
        cashTransactionAmount(tx, orgId, { accountId: account.id, flowType, category: detailCategory, from, toEnd }),
        cashTransactionAmount(tx, orgId, { accountId: account.id, flowType, category: detailCategory, from: firstOfMonth(), toEnd: endOfDay(new Date()) }),
        cashTransactionAmount(tx, orgId, { accountId: account.id, flowType, category: detailCategory }),
        oppositeCategory
            ? cashTransactionAmount(tx, orgId, { accountId: account.id, flowType: flowType === "cash_in" ? "cash_out" : "cash_in", category: oppositeCategory, from, toEnd })
            : Promise.resolve({ amount: new library_1.Decimal(0), count: 0 }),
        oppositeCategory
            ? cashTransactionAmount(tx, orgId, { accountId: account.id, flowType: flowType === "cash_in" ? "cash_out" : "cash_in", category: oppositeCategory, from: firstOfMonth(), toEnd: endOfDay(new Date()) })
            : Promise.resolve({ amount: new library_1.Decimal(0), count: 0 }),
        oppositeCategory
            ? cashTransactionAmount(tx, orgId, { accountId: account.id, flowType: flowType === "cash_in" ? "cash_out" : "cash_in", category: oppositeCategory })
            : Promise.resolve({ amount: new library_1.Decimal(0), count: 0 }),
        tx.cashTransaction.findMany({
            where: historyWhere,
            include: {
                cashBankAccount: { select: { id: true, name: true } },
                counterpartyMembership: { select: { id: true, membershipNo: true, hod: { select: { fullName: true, nameWithInitials: true } } } },
                createdBy: { select: { email: true } },
                reversedBy: { select: { email: true } },
            },
            orderBy: [{ transactionDate: "desc" }, { createdAt: "desc" }],
            take: 100,
        }),
    ]));
    const all = allTotals.get(account.id) ?? { debit: new library_1.Decimal(0), credit: new library_1.Decimal(0) };
    const summary = account.accountType === "asset" && isReceivableSubtype(account.assetSubtype)
        ? {
            totalGiven: asNumber(oppositeAll.amount),
            totalCollected: asNumber(postedAll.amount),
            outstandingBalance: asNumber(oppositeAll.amount.sub(postedAll.amount)),
            periodTotal: asNumber(postedPeriod.amount.add(oppositePeriod.amount)),
            thisMonthTotal: asNumber(postedMonth.amount.add(oppositeMonth.amount)),
            transactionCount: postedPeriod.count + oppositePeriod.count,
        }
        : account.accountType === "liability" && isPayableSubtype(account.assetSubtype)
            ? {
                totalPayable: asNumber(oppositeAll.amount),
                totalPaid: asNumber(postedAll.amount),
                outstandingBalance: asNumber(oppositeAll.amount.sub(postedAll.amount)),
                periodTotal: asNumber(postedPeriod.amount.add(oppositePeriod.amount)),
                thisMonthTotal: asNumber(postedMonth.amount.add(oppositeMonth.amount)),
                transactionCount: postedPeriod.count + oppositePeriod.count,
            }
            : {
                periodTotal: asNumber(postedPeriod.amount),
                thisMonthTotal: asNumber(postedMonth.amount),
                transactionCount: postedPeriod.count,
            };
    return res.json({
        account: serializeAccount({ ...account, debitTotal: all.debit, creditTotal: all.credit, balance: cashAccountBalance(account.accountType, all.debit, all.credit) }),
        fromDate: from.toISOString(),
        toDate: toEnd.toISOString(),
        summary,
        history: history.map(serializeCashTransaction),
    });
}
async function createCashTransaction(req, res, flowType, category) {
    const orgId = getOrgId(req);
    if (!orgId)
        return res.status(400).json({ error: "Organization scope required" });
    const parsed = cashTransactionSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    }
    const amount = new library_1.Decimal(parsed.data.amount);
    const transactionDate = parsed.data.transactionDate ? new Date(parsed.data.transactionDate) : new Date();
    const transaction = await prisma_js_1.prisma.$transaction(async (tx) => {
        await (0, accounting_js_1.ensureDefaultAccountingAccounts)(tx, orgId);
        const [account, cashBankAccount] = await Promise.all([
            tx.accountingAccount.findFirst({
                where: { id: parsed.data.accountId, organizationId: orgId, isActive: true, ...cashAccountWhere(flowType, category) },
            }),
            tx.accountingAccount.findFirst({
                where: {
                    id: parsed.data.cashBankAccountId,
                    organizationId: orgId,
                    accountType: "asset",
                    assetSubtype: { in: cashBankSubtypes },
                    isActive: true,
                },
            }),
        ]);
        if (!account)
            throw new Error("Selected account is not valid for this cash flow");
        if (!cashBankAccount)
            throw new Error("Payment method must be an active cash/bank account");
        let counterpartyPhone = parsed.data.counterpartyPhone ?? null;
        if (parsed.data.counterpartyMembershipId) {
            const membership = await tx.membership.findFirst({
                where: { id: parsed.data.counterpartyMembershipId, organizationId: orgId },
                select: { id: true, hod: { select: { mobileNumber: true, whatsAppNumber: true } } },
            });
            if (!membership)
                throw new Error("Selected member was not found");
            counterpartyPhone = counterpartyPhone || membership.hod?.mobileNumber || membership.hod?.whatsAppNumber || null;
        }
        const documentNumber = await generateCashDocumentNumber(tx, orgId, flowType, transactionDate);
        const label = cashTransactionLabel(category);
        const description = parsed.data.description || `${label}: ${account.name}`;
        const lines = flowType === "cash_in"
            ? [
                { accountId: cashBankAccount.id, side: "debit", amount, memo: parsed.data.reference ?? null },
                { accountId: account.id, side: "credit", amount, memo: parsed.data.reference ?? null },
            ]
            : [
                { accountId: account.id, side: "debit", amount, memo: parsed.data.reference ?? null },
                { accountId: cashBankAccount.id, side: "credit", amount, memo: parsed.data.reference ?? null },
            ];
        const journalEntry = await (0, accounting_js_1.createJournalEntry)(tx, {
            organizationId: orgId,
            entryDate: transactionDate,
            entryType: category === "operating_expense" ? "expense" : "manual_adjustment",
            description,
            referenceType: category,
            isSystemEntry: false,
            createdByUserId: req.auth.userId,
            lines,
        });
        const cashTransaction = await tx.cashTransaction.create({
            data: {
                organizationId: orgId,
                flowType,
                category,
                accountId: account.id,
                cashBankAccountId: cashBankAccount.id,
                amount,
                transactionDate,
                counterpartyName: parsed.data.counterpartyName,
                counterpartyPhone,
                counterpartyMembershipId: parsed.data.counterpartyMembershipId || null,
                reference: parsed.data.reference ?? null,
                description,
                documentNumber,
                journalEntryId: journalEntry.id,
                createdByUserId: req.auth.userId,
            },
            include: { account: true, cashBankAccount: true, journalEntry: true },
        });
        await tx.accountingJournalEntry.update({
            where: { id: journalEntry.id },
            data: { referenceId: cashTransaction.id },
        });
        return cashTransaction;
    });
    return res.status(201).json(serializeCashTransaction(transaction));
}
function serializeFundPot(fund, summary) {
    return {
        ...fund,
        openingBalance: Number(fund.openingBalance),
        periodStart: fund.periodStart?.toISOString?.() ?? null,
        periodEnd: fund.periodEnd?.toISOString?.() ?? null,
        createdAt: fund.createdAt.toISOString(),
        updatedAt: fund.updatedAt.toISOString(),
        closedAt: fund.closedAt?.toISOString?.() ?? null,
        ...(summary ? { summary } : {}),
        transactions: fund.transactions?.map(serializeFundTransaction),
    };
}
exports.accountingRouter.get("/accounts", asyncRoute(async (req, res) => {
    const orgId = getOrgId(req);
    if (!orgId)
        return res.status(400).json({ error: "Organization scope required" });
    const includeInactive = req.query.includeInactive === "true";
    const accounts = await prisma_js_1.prisma.$transaction(async (tx) => {
        const balances = await (0, accounting_js_1.accountBalances)(tx, orgId);
        return includeInactive ? balances : balances.filter((account) => account.isActive);
    });
    return res.json(accounts.map(serializeAccount));
}));
exports.accountingRouter.post("/accounts", requireAccountingAdmin, asyncRoute(async (req, res) => {
    const orgId = getOrgId(req);
    if (!orgId)
        return res.status(400).json({ error: "Organization scope required" });
    const parsed = createAccountSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    }
    const existing = await prisma_js_1.prisma.$transaction(async (tx) => {
        await (0, accounting_js_1.ensureDefaultAccountingAccounts)(tx, orgId);
        return tx.accountingAccount.findFirst({
            where: {
                organizationId: orgId,
                name: { equals: parsed.data.name, mode: "insensitive" },
            },
        });
    });
    if (existing)
        return res.status(409).json({ error: "An account with this name already exists" });
    const account = await prisma_js_1.prisma.accountingAccount.create({
        data: {
            organizationId: orgId,
            name: parsed.data.name,
            accountType: parsed.data.accountType,
            assetSubtype: parsed.data.assetSubtype ?? (0, accounting_js_1.defaultAccountSubtype)(parsed.data.accountType),
            description: parsed.data.description ?? null,
            createdByUserId: req.auth.userId,
        },
    });
    return res.status(201).json(account);
}));
exports.accountingRouter.patch("/accounts/:id", requireAccountingAdmin, asyncRoute(async (req, res) => {
    const parsed = updateAccountSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    }
    const account = await prisma_js_1.prisma.accountingAccount.findUnique({ where: { id: req.params.id } });
    if (!account)
        return res.status(404).json({ error: "Account not found" });
    if (req.auth.role !== "super_user" && account.organizationId !== req.auth.organizationId) {
        return res.status(403).json({ error: "Forbidden" });
    }
    if (account.systemKey && parsed.data.name && parsed.data.name !== account.name) {
        return res.status(409).json({ error: "System accounts cannot be renamed" });
    }
    if (parsed.data.assetSubtype !== undefined && !accountSubtypesByType[account.accountType].includes(parsed.data.assetSubtype)) {
        return res.status(400).json({ error: "Selected subtype does not match the account type" });
    }
    const lineCount = await prisma_js_1.prisma.accountingJournalLine.count({ where: { accountId: account.id } });
    if (lineCount > 0 && parsed.data.isActive === false && account.systemKey) {
        return res.status(409).json({ error: "System accounts with activity cannot be archived" });
    }
    const updated = await prisma_js_1.prisma.accountingAccount.update({
        where: { id: account.id },
        data: {
            ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
            ...(parsed.data.assetSubtype !== undefined ? { assetSubtype: parsed.data.assetSubtype } : {}),
            ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
            ...(parsed.data.isActive !== undefined ? { isActive: parsed.data.isActive } : {}),
        },
    });
    return res.json(updated);
}));
exports.accountingRouter.get("/cash-in/overview", asyncRoute((req, res) => buildCashFlowOverview(req, res, "cash_in")));
exports.accountingRouter.get("/cash-out/overview", asyncRoute((req, res) => buildCashFlowOverview(req, res, "cash_out")));
exports.accountingRouter.get("/cash-in/accounts/:id", asyncRoute((req, res) => loadCashAccountDetail(req, res, "cash_in")));
exports.accountingRouter.get("/cash-out/accounts/:id", asyncRoute((req, res) => loadCashAccountDetail(req, res, "cash_out")));
exports.accountingRouter.post("/cash-in/operating-income", requireAccountingAdmin, asyncRoute((req, res) => createCashTransaction(req, res, "cash_in", "operating_income")));
exports.accountingRouter.post("/cash-in/receivable-collections", requireAccountingAdmin, asyncRoute((req, res) => createCashTransaction(req, res, "cash_in", "receivable_collection")));
exports.accountingRouter.post("/cash-in/receivable-payments", requireAccountingAdmin, asyncRoute((req, res) => createCashTransaction(req, res, "cash_out", "receivable_payment")));
exports.accountingRouter.post("/cash-out/operating-expenses", requireAccountingAdmin, asyncRoute((req, res) => createCashTransaction(req, res, "cash_out", "operating_expense")));
exports.accountingRouter.post("/cash-out/payable-recoveries", requireAccountingAdmin, asyncRoute((req, res) => createCashTransaction(req, res, "cash_in", "payable_recovery")));
exports.accountingRouter.post("/cash-out/payable-payments", requireAccountingAdmin, asyncRoute((req, res) => createCashTransaction(req, res, "cash_out", "payable_payment")));
exports.accountingRouter.post("/cash-transactions/:id/reverse", requireAccountingAdmin, asyncRoute(async (req, res) => {
    const orgId = getOrgId(req);
    if (!orgId)
        return res.status(400).json({ error: "Organization scope required" });
    const parsed = cashReverseSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    }
    const updated = await prisma_js_1.prisma.$transaction(async (tx) => {
        const transaction = await tx.cashTransaction.findFirst({
            where: { id: req.params.id, organizationId: orgId },
            include: { journalEntry: { include: { lines: true } } },
        });
        if (!transaction)
            throw new Error("Cash transaction not found");
        if (transaction.reversedAt)
            throw new Error("Cash transaction is already reversed");
        if (!transaction.journalEntry)
            throw new Error("Original journal entry was not found");
        await (0, accounting_js_1.createJournalEntry)(tx, {
            organizationId: orgId,
            entryDate: new Date(),
            entryType: "manual_adjustment",
            description: `Cash transaction reversal: ${parsed.data.reason}`,
            referenceType: "cash_transaction_reversal",
            referenceId: transaction.id,
            isSystemEntry: true,
            createdByUserId: req.auth.userId,
            lines: transaction.journalEntry.lines.map((line) => ({
                accountId: line.accountId,
                side: line.side === "debit" ? "credit" : "debit",
                amount: line.amount,
                memo: `Reversal for ${transaction.documentNumber ?? transaction.id}`,
            })),
        });
        return tx.cashTransaction.update({
            where: { id: transaction.id },
            data: {
                reversedAt: new Date(),
                reversedByUserId: req.auth.userId,
                reversalReason: parsed.data.reason,
            },
            include: { account: true, cashBankAccount: true, reversedBy: { select: { email: true } } },
        });
    });
    return res.json(serializeCashTransaction(updated));
}));
exports.accountingRouter.get("/funds", asyncRoute(async (req, res) => {
    const orgId = getOrgId(req);
    if (!orgId)
        return res.status(400).json({ error: "Organization scope required" });
    const from = optionalDateFromQuery(req.query.fromDate);
    const to = optionalDateFromQuery(req.query.toDate);
    const toEnd = to ? endOfDay(to) : null;
    const funds = await prisma_js_1.prisma.fundPot.findMany({
        where: { organizationId: orgId },
        include: {
            fundAccount: true,
            surplusAccount: true,
            deficitAccount: true,
            transactions: {
                where: {
                    ...(toEnd ? { transactionDate: { lte: toEnd } } : {}),
                },
                orderBy: { transactionDate: "asc" },
            },
        },
        orderBy: [{ status: "asc" }, { name: "asc" }],
    });
    const rows = funds.map((fund) => serializeFundPot(fund, summarizeFundTransactions(fund.transactions, from, toEnd)));
    return res.json(rows);
}));
exports.accountingRouter.get("/reports/fund-summary", asyncRoute(async (req, res) => {
    const orgId = getOrgId(req);
    if (!orgId)
        return res.status(400).json({ error: "Organization scope required" });
    const status = req.query.status === "active" || req.query.status === "closed" ? req.query.status : null;
    const fundId = typeof req.query.fundId === "string" && req.query.fundId.trim() ? req.query.fundId : null;
    const range = fundReportRange(req.query);
    const funds = await prisma_js_1.prisma.fundPot.findMany({
        where: {
            organizationId: orgId,
            ...(status ? { status } : {}),
            ...(fundId ? { id: fundId } : {}),
        },
        include: {
            transactions: {
                where: {
                    ...(range.toEnd ? { transactionDate: { lte: range.toEnd } } : {}),
                },
                orderBy: [{ transactionDate: "asc" }, { createdAt: "asc" }],
            },
        },
        orderBy: [{ status: "asc" }, { name: "asc" }],
    });
    const rows = funds.map((fund) => ({
        id: fund.id,
        name: fund.name,
        status: fund.status,
        managerName: fund.managerName,
        periodStart: fund.periodStart?.toISOString?.() ?? null,
        periodEnd: fund.periodEnd?.toISOString?.() ?? null,
        ...summarizeFundReportTransactions(fund.transactions, range.from, range.toEnd),
    }));
    const totals = rows.reduce((sum, row) => ({
        openingBalance: sum.openingBalance + row.openingBalance,
        totalCollected: sum.totalCollected + row.totalCollected,
        totalSpent: sum.totalSpent + row.totalSpent,
        totalTransferred: sum.totalTransferred + row.totalTransferred,
        remainingBalance: sum.remainingBalance + row.remainingBalance,
    }), { openingBalance: 0, totalCollected: 0, totalSpent: 0, totalTransferred: 0, remainingBalance: 0 });
    return res.json({
        rows,
        totals,
        period: range.period,
        fromDate: range.from?.toISOString?.() ?? null,
        toDate: range.toEnd?.toISOString?.() ?? null,
    });
}));
exports.accountingRouter.post("/funds", requireAccountingAdmin, asyncRoute(async (req, res) => {
    const orgId = getOrgId(req);
    if (!orgId)
        return res.status(400).json({ error: "Organization scope required" });
    const parsed = createFundSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    }
    const openingBalance = new library_1.Decimal(parsed.data.openingBalance ?? 0);
    const entryDate = new Date();
    const periodStart = parsed.data.periodStart ? startOfDay(new Date(parsed.data.periodStart)) : null;
    const periodEnd = parsed.data.periodEnd ? endOfDay(new Date(parsed.data.periodEnd)) : null;
    const fund = await prisma_js_1.prisma.$transaction(async (tx) => {
        await (0, accounting_js_1.ensureDefaultAccountingAccounts)(tx, orgId);
        const existingFund = await tx.fundPot.findFirst({
            where: { organizationId: orgId, name: { equals: parsed.data.name, mode: "insensitive" } },
            select: { id: true },
        });
        if (existingFund)
            throw new Error("A fund with this name already exists");
        const openingAssetAccount = openingBalance.gt(0)
            ? await requireCashBankAccount(tx, orgId, parsed.data.openingAssetAccountId)
            : null;
        const [fundAccountName, surplusAccountName, deficitAccountName] = await Promise.all([
            nextAvailableAccountName(tx, orgId, parsed.data.name),
            nextAvailableAccountName(tx, orgId, `${parsed.data.name} Surplus`),
            nextAvailableAccountName(tx, orgId, `${parsed.data.name} Deficit`),
        ]);
        const fundAccount = await tx.accountingAccount.create({
            data: {
                organizationId: orgId,
                name: fundAccountName,
                accountType: "equity",
                assetSubtype: "project_fund",
                description: `Restricted fund balance for ${parsed.data.name}`,
                systemKey: `fund_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                createdByUserId: req.auth.userId,
            },
        });
        const surplusAccount = await tx.accountingAccount.create({
            data: {
                organizationId: orgId,
                name: surplusAccountName,
                accountType: "income",
                assetSubtype: "project_fund_surplus",
                description: `Surplus transferred from ${parsed.data.name}`,
                systemKey: `fund_surplus_${fundAccount.id}`,
                createdByUserId: req.auth.userId,
            },
        });
        const deficitAccount = await tx.accountingAccount.create({
            data: {
                organizationId: orgId,
                name: deficitAccountName,
                accountType: "expense",
                assetSubtype: "project_fund_deficit",
                description: `Deficit transferred from ${parsed.data.name}`,
                systemKey: `fund_deficit_${fundAccount.id}`,
                createdByUserId: req.auth.userId,
            },
        });
        const createdFund = await tx.fundPot.create({
            data: {
                organizationId: orgId,
                name: parsed.data.name,
                description: parsed.data.description ?? null,
                managerName: parsed.data.managerName ?? null,
                periodStart,
                periodEnd,
                openingBalance,
                fundAccountId: fundAccount.id,
                surplusAccountId: surplusAccount.id,
                deficitAccountId: deficitAccount.id,
                openingAssetAccountId: openingAssetAccount?.id ?? null,
                createdByUserId: req.auth.userId,
            },
        });
        if (openingBalance.gt(0) && openingAssetAccount) {
            const journalEntry = await (0, accounting_js_1.createJournalEntry)(tx, {
                organizationId: orgId,
                entryDate,
                entryType: "opening_balance",
                description: `Opening balance for ${createdFund.name}`,
                referenceType: "fund_opening",
                referenceId: createdFund.id,
                isSystemEntry: true,
                createdByUserId: req.auth.userId,
                lines: [
                    { accountId: openingAssetAccount.id, side: "debit", amount: openingBalance },
                    { accountId: fundAccount.id, side: "credit", amount: openingBalance },
                ],
            });
            await tx.fundTransaction.create({
                data: {
                    organizationId: orgId,
                    fundPotId: createdFund.id,
                    transactionType: "opening",
                    amount: openingBalance,
                    transactionDate: entryDate,
                    assetAccountId: openingAssetAccount.id,
                    description: "Opening balance",
                    journalEntryId: journalEntry.id,
                    createdByUserId: req.auth.userId,
                },
            });
        }
        return tx.fundPot.findUniqueOrThrow({
            where: { id: createdFund.id },
            include: { fundAccount: true, surplusAccount: true, deficitAccount: true, transactions: true },
        });
    });
    return res.status(201).json(serializeFundPot(fund));
}));
exports.accountingRouter.get("/funds/:id", asyncRoute(async (req, res) => {
    const orgId = getOrgId(req);
    if (!orgId)
        return res.status(400).json({ error: "Organization scope required" });
    const fund = await prisma_js_1.prisma.fundPot.findFirst({
        where: { id: req.params.id, organizationId: orgId },
        include: {
            fundAccount: true,
            surplusAccount: true,
            deficitAccount: true,
            openingAssetAccount: true,
            transactions: {
                include: { assetAccount: true, journalEntry: true },
                orderBy: [{ transactionDate: "desc" }, { createdAt: "desc" }],
            },
        },
    });
    if (!fund)
        return res.status(404).json({ error: "Fund not found" });
    return res.json(serializeFundPot(fund, summarizeFundTransactions(fund.transactions)));
}));
exports.accountingRouter.post("/funds/:id/collections", requireAccountingAdmin, asyncRoute(async (req, res) => {
    const orgId = getOrgId(req);
    if (!orgId)
        return res.status(400).json({ error: "Organization scope required" });
    const parsed = fundCollectionSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    }
    const amount = new library_1.Decimal(parsed.data.amount);
    const transactionDate = parsed.data.transactionDate ? new Date(parsed.data.transactionDate) : new Date();
    const transaction = await prisma_js_1.prisma.$transaction(async (tx) => {
        const fund = await tx.fundPot.findFirst({
            where: { id: req.params.id, organizationId: orgId },
            include: { fundAccount: true },
        });
        if (!fund)
            throw new Error("Fund not found");
        if (fund.status === "closed")
            throw new Error("Closed funds cannot receive collections");
        const assetAccount = await requireCashBankAccount(tx, orgId, parsed.data.assetAccountId);
        let memberPhone = parsed.data.paidByPhone ?? null;
        if (parsed.data.paidByMembershipId) {
            const member = await tx.membership.findFirst({
                where: { id: parsed.data.paidByMembershipId, organizationId: orgId },
                select: {
                    id: true,
                    hod: { select: { mobileNumber: true, whatsAppNumber: true } },
                },
            });
            if (!member)
                throw new Error("Selected member was not found");
            memberPhone = memberPhone || member.hod?.mobileNumber || member.hod?.whatsAppNumber || null;
        }
        const receiptNumber = await generateFundReceiptNumber(tx, orgId, transactionDate);
        const journalEntry = await (0, accounting_js_1.createJournalEntry)(tx, {
            organizationId: orgId,
            entryDate: transactionDate,
            entryType: "transfer",
            description: `Collection received for ${fund.name}`,
            referenceType: "fund_collection",
            referenceId: fund.id,
            isSystemEntry: false,
            createdByUserId: req.auth.userId,
            lines: [
                { accountId: assetAccount.id, side: "debit", amount, memo: parsed.data.memo ?? null },
                { accountId: fund.fundAccountId, side: "credit", amount, memo: parsed.data.memo ?? null },
            ],
        });
        return tx.fundTransaction.create({
            data: {
                organizationId: orgId,
                fundPotId: fund.id,
                transactionType: "collection",
                amount,
                transactionDate,
                assetAccountId: assetAccount.id,
                paidByName: parsed.data.paidByName,
                paidByPhone: memberPhone,
                paidByMembershipId: parsed.data.paidByMembershipId ?? null,
                receiptNumber,
                memo: parsed.data.memo ?? null,
                journalEntryId: journalEntry.id,
                createdByUserId: req.auth.userId,
            },
            include: { assetAccount: true, journalEntry: true },
        });
    });
    return res.status(201).json(serializeFundTransaction(transaction));
}));
exports.accountingRouter.get("/fund-transactions/:id/receipt", asyncRoute(async (req, res) => {
    const orgId = getOrgId(req);
    if (!orgId)
        return res.status(400).json({ error: "Organization scope required" });
    const transaction = await prisma_js_1.prisma.fundTransaction.findFirst({
        where: {
            id: req.params.id,
            organizationId: orgId,
            transactionType: "collection",
        },
        include: {
            organization: { select: { name: true, receiptLogoUrl: true } },
            fundPot: { select: { name: true } },
            assetAccount: { select: { name: true } },
        },
    });
    if (!transaction || !transaction.receiptNumber) {
        return res.status(404).json({ error: "Fund collection receipt not found" });
    }
    const collectedBy = transaction.createdByUserId
        ? await prisma_js_1.prisma.user.findUnique({
            where: { id: transaction.createdByUserId },
            select: { email: true },
        })
        : null;
    return res.json(buildFundReceipt(transaction, collectedBy?.email ?? null));
}));
exports.accountingRouter.post("/funds/:id/expenses", requireAccountingAdmin, asyncRoute(async (req, res) => {
    const orgId = getOrgId(req);
    if (!orgId)
        return res.status(400).json({ error: "Organization scope required" });
    const parsed = fundExpenseSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    }
    const amount = new library_1.Decimal(parsed.data.amount);
    const transactionDate = parsed.data.transactionDate ? new Date(parsed.data.transactionDate) : new Date();
    const transaction = await prisma_js_1.prisma.$transaction(async (tx) => {
        const fund = await tx.fundPot.findFirst({
            where: { id: req.params.id, organizationId: orgId },
            include: { fundAccount: true },
        });
        if (!fund)
            throw new Error("Fund not found");
        if (fund.status === "closed")
            throw new Error("Closed funds cannot record expenses");
        const assetAccount = await requireCashBankAccount(tx, orgId, parsed.data.assetAccountId);
        const journalEntry = await (0, accounting_js_1.createJournalEntry)(tx, {
            organizationId: orgId,
            entryDate: transactionDate,
            entryType: "expense",
            description: parsed.data.description,
            referenceType: "fund_expense",
            referenceId: fund.id,
            isSystemEntry: false,
            createdByUserId: req.auth.userId,
            lines: [
                { accountId: fund.fundAccountId, side: "debit", amount, memo: parsed.data.memo ?? null },
                { accountId: assetAccount.id, side: "credit", amount, memo: parsed.data.memo ?? null },
            ],
        });
        return tx.fundTransaction.create({
            data: {
                organizationId: orgId,
                fundPotId: fund.id,
                transactionType: "expense",
                amount,
                transactionDate,
                assetAccountId: assetAccount.id,
                description: parsed.data.description,
                memo: parsed.data.memo ?? null,
                journalEntryId: journalEntry.id,
                createdByUserId: req.auth.userId,
            },
            include: { assetAccount: true, journalEntry: true },
        });
    });
    return res.status(201).json(serializeFundTransaction(transaction));
}));
exports.accountingRouter.post("/fund-transactions/:id/reverse", requireAccountingAdmin, asyncRoute(async (req, res) => {
    const orgId = getOrgId(req);
    if (!orgId)
        return res.status(400).json({ error: "Organization scope required" });
    const parsed = cashReverseSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    }
    const updated = await prisma_js_1.prisma.$transaction(async (tx) => {
        const transaction = await tx.fundTransaction.findFirst({
            where: { id: req.params.id, organizationId: orgId },
            include: { journalEntry: { include: { lines: true } } },
        });
        if (!transaction)
            throw new Error("Fund transaction not found");
        if (transaction.transactionType !== "collection" && transaction.transactionType !== "expense") {
            throw new Error("Only fund collections and expenses can be reversed");
        }
        if (transaction.reversedAt)
            throw new Error("Fund transaction is already reversed");
        if (!transaction.journalEntry)
            throw new Error("Original journal entry was not found");
        await (0, accounting_js_1.createJournalEntry)(tx, {
            organizationId: orgId,
            entryDate: new Date(),
            entryType: "manual_adjustment",
            description: `Special fund transaction reversal: ${parsed.data.reason}`,
            referenceType: "fund_transaction_reversal",
            referenceId: transaction.id,
            isSystemEntry: true,
            createdByUserId: req.auth.userId,
            lines: transaction.journalEntry.lines.map((line) => ({
                accountId: line.accountId,
                side: line.side === "debit" ? "credit" : "debit",
                amount: line.amount,
                memo: `Reversal for ${transaction.receiptNumber ?? transaction.id}`,
            })),
        });
        return tx.fundTransaction.update({
            where: { id: transaction.id },
            data: {
                reversedAt: new Date(),
                reversedByUserId: req.auth.userId,
                reversalReason: parsed.data.reason,
            },
            include: { assetAccount: true, journalEntry: true, reversedBy: { select: { email: true } } },
        });
    });
    return res.json(serializeFundTransaction(updated));
}));
async function transferFundBalance(tx, input) {
    const fund = await tx.fundPot.findFirst({
        where: { id: input.fundPotId, organizationId: input.organizationId },
        include: { fundAccount: true, surplusAccount: true, deficitAccount: true },
    });
    if (!fund)
        throw new Error("Fund not found");
    const balance = await fundBalance(tx, input.organizationId, fund.id);
    if (balance.equals(new library_1.Decimal(0)))
        return null;
    const isSurplus = balance.gt(new library_1.Decimal(0));
    const availableAmount = isSurplus ? balance : balance.abs();
    const amount = input.amount ?? availableAmount;
    if (amount.lte(new library_1.Decimal(0)) || amount.gt(availableAmount)) {
        throw new Error(`Transfer amount must be greater than zero and no more than ${availableAmount.toFixed(2)}`);
    }
    const transactionType = isSurplus ? "surplus_transfer" : "deficit_transfer";
    const journalEntry = await (0, accounting_js_1.createJournalEntry)(tx, {
        organizationId: input.organizationId,
        entryDate: input.transactionDate,
        entryType: "manual_adjustment",
        description: isSurplus
            ? `Surplus transferred from ${fund.name}`
            : `Deficit transferred from ${fund.name}`,
        referenceType: isSurplus ? "fund_surplus_transfer" : "fund_deficit_transfer",
        referenceId: fund.id,
        isSystemEntry: false,
        createdByUserId: input.userId,
        lines: isSurplus
            ? [
                { accountId: fund.fundAccountId, side: "debit", amount, memo: input.memo ?? null },
                { accountId: fund.surplusAccountId, side: "credit", amount, memo: input.memo ?? null },
            ]
            : [
                { accountId: fund.deficitAccountId, side: "debit", amount, memo: input.memo ?? null },
                { accountId: fund.fundAccountId, side: "credit", amount, memo: input.memo ?? null },
            ],
    });
    return tx.fundTransaction.create({
        data: {
            organizationId: input.organizationId,
            fundPotId: fund.id,
            transactionType,
            amount,
            transactionDate: input.transactionDate,
            description: isSurplus ? "Surplus transfer" : "Deficit transfer",
            memo: input.memo ?? null,
            journalEntryId: journalEntry.id,
            createdByUserId: input.userId,
        },
        include: { journalEntry: true },
    });
}
exports.accountingRouter.post("/funds/:id/transfer", requireAccountingAdmin, asyncRoute(async (req, res) => {
    const orgId = getOrgId(req);
    if (!orgId)
        return res.status(400).json({ error: "Organization scope required" });
    const parsed = fundTransferSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    }
    const transactionDate = parsed.data.transactionDate ? new Date(parsed.data.transactionDate) : new Date();
    let transaction;
    try {
        transaction = await prisma_js_1.prisma.$transaction(async (tx) => {
            const fund = await tx.fundPot.findFirst({
                where: { id: req.params.id, organizationId: orgId },
                select: { id: true, status: true },
            });
            if (!fund)
                throw new Error("Fund not found");
            if (fund.status === "closed")
                throw new Error("Closed funds cannot be transferred");
            return transferFundBalance(tx, {
                organizationId: orgId,
                fundPotId: fund.id,
                userId: req.auth.userId,
                transactionDate,
                amount: parsed.data.amount ? new library_1.Decimal(parsed.data.amount) : null,
                memo: parsed.data.memo ?? null,
            });
        });
    }
    catch (err) {
        if (err instanceof Error && err.message.startsWith("Transfer amount")) {
            return res.status(400).json({ error: err.message });
        }
        throw err;
    }
    if (!transaction)
        return res.status(409).json({ error: "There is no remaining balance to transfer" });
    return res.status(201).json(serializeFundTransaction(transaction));
}));
exports.accountingRouter.post("/funds/:id/close", requireAccountingAdmin, asyncRoute(async (req, res) => {
    const orgId = getOrgId(req);
    if (!orgId)
        return res.status(400).json({ error: "Organization scope required" });
    const parsed = fundTransferSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    }
    const transactionDate = parsed.data.transactionDate ? new Date(parsed.data.transactionDate) : new Date();
    const fund = await prisma_js_1.prisma.$transaction(async (tx) => {
        const existing = await tx.fundPot.findFirst({
            where: { id: req.params.id, organizationId: orgId },
            select: { id: true, status: true },
        });
        if (!existing)
            throw new Error("Fund not found");
        if (existing.status === "closed")
            throw new Error("Fund is already closed");
        await transferFundBalance(tx, {
            organizationId: orgId,
            fundPotId: existing.id,
            userId: req.auth.userId,
            transactionDate,
            memo: parsed.data.memo ?? null,
        });
        return tx.fundPot.update({
            where: { id: existing.id },
            data: { status: "closed", closedAt: new Date() },
            include: { fundAccount: true, surplusAccount: true, deficitAccount: true, transactions: true },
        });
    });
    return res.json(serializeFundPot(fund));
}));
exports.accountingRouter.post("/expenses", requireAccountingAdmin, asyncRoute(async (req, res) => {
    const orgId = getOrgId(req);
    if (!orgId)
        return res.status(400).json({ error: "Organization scope required" });
    const parsed = expenseSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    }
    const amount = new library_1.Decimal(parsed.data.amount);
    const entryDate = parsed.data.entryDate ? new Date(parsed.data.entryDate) : new Date();
    const [sourceAccount, expenseAccount] = await Promise.all([
        prisma_js_1.prisma.accountingAccount.findFirst({
            where: { id: parsed.data.sourceAccountId, organizationId: orgId, isActive: true },
        }),
        prisma_js_1.prisma.accountingAccount.findFirst({
            where: { id: parsed.data.expenseAccountId, organizationId: orgId, isActive: true },
        }),
    ]);
    if (!sourceAccount || sourceAccount.accountType !== "asset") {
        return res.status(400).json({ error: "Source account must be an active asset account" });
    }
    if (!expenseAccount || expenseAccount.accountType !== "expense") {
        return res.status(400).json({ error: "Expense account must be an active expense account" });
    }
    const entry = await prisma_js_1.prisma.$transaction(async (tx) => {
        await (0, accounting_js_1.ensureDefaultAccountingAccounts)(tx, orgId);
        return (0, accounting_js_1.createJournalEntry)(tx, {
            organizationId: orgId,
            entryDate,
            entryType: "expense",
            description: parsed.data.description,
            referenceType: "manual_expense",
            isSystemEntry: false,
            createdByUserId: req.auth.userId,
            lines: [
                { accountId: expenseAccount.id, side: "debit", amount, memo: parsed.data.memo ?? null },
                { accountId: sourceAccount.id, side: "credit", amount, memo: parsed.data.memo ?? null },
            ],
        });
    });
    return res.status(201).json(serializeJournalEntry(entry));
}));
exports.accountingRouter.post("/income", requireAccountingAdmin, asyncRoute(async (req, res) => {
    const orgId = getOrgId(req);
    if (!orgId)
        return res.status(400).json({ error: "Organization scope required" });
    const parsed = incomeSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    }
    const amount = new library_1.Decimal(parsed.data.amount);
    const entryDate = parsed.data.entryDate ? new Date(parsed.data.entryDate) : new Date();
    const [destinationAccount, incomeAccount] = await Promise.all([
        prisma_js_1.prisma.accountingAccount.findFirst({
            where: { id: parsed.data.destinationAccountId, organizationId: orgId, isActive: true },
        }),
        prisma_js_1.prisma.accountingAccount.findFirst({
            where: { id: parsed.data.incomeAccountId, organizationId: orgId, isActive: true },
        }),
    ]);
    if (!destinationAccount || destinationAccount.accountType !== "asset") {
        return res.status(400).json({ error: "Destination account must be an active asset account" });
    }
    if (!incomeAccount || incomeAccount.accountType !== "income") {
        return res.status(400).json({ error: "Income account must be an active income account" });
    }
    const entry = await prisma_js_1.prisma.$transaction(async (tx) => {
        await (0, accounting_js_1.ensureDefaultAccountingAccounts)(tx, orgId);
        return (0, accounting_js_1.createJournalEntry)(tx, {
            organizationId: orgId,
            entryDate,
            entryType: "manual_adjustment",
            description: parsed.data.description,
            referenceType: "manual_income",
            isSystemEntry: false,
            createdByUserId: req.auth.userId,
            lines: [
                { accountId: destinationAccount.id, side: "debit", amount, memo: parsed.data.memo ?? null },
                { accountId: incomeAccount.id, side: "credit", amount, memo: parsed.data.memo ?? null },
            ],
        });
    });
    return res.status(201).json(serializeJournalEntry(entry));
}));
exports.accountingRouter.post("/transfers", requireAccountingAdmin, asyncRoute(async (req, res) => {
    const orgId = getOrgId(req);
    if (!orgId)
        return res.status(400).json({ error: "Organization scope required" });
    const parsed = transferSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    }
    if (parsed.data.fromAccountId === parsed.data.toAccountId) {
        return res.status(400).json({ error: "Transfer accounts must be different" });
    }
    const amount = new library_1.Decimal(parsed.data.amount);
    const entryDate = parsed.data.entryDate ? new Date(parsed.data.entryDate) : new Date();
    const [fromAccount, toAccount] = await Promise.all([
        prisma_js_1.prisma.accountingAccount.findFirst({
            where: { id: parsed.data.fromAccountId, organizationId: orgId, isActive: true },
        }),
        prisma_js_1.prisma.accountingAccount.findFirst({
            where: { id: parsed.data.toAccountId, organizationId: orgId, isActive: true },
        }),
    ]);
    if (!fromAccount || fromAccount.accountType !== "asset") {
        return res.status(400).json({ error: "From account must be an active asset account" });
    }
    if (!toAccount || toAccount.accountType !== "asset") {
        return res.status(400).json({ error: "To account must be an active asset account" });
    }
    const entry = await prisma_js_1.prisma.$transaction(async (tx) => {
        await (0, accounting_js_1.ensureDefaultAccountingAccounts)(tx, orgId);
        return (0, accounting_js_1.createJournalEntry)(tx, {
            organizationId: orgId,
            entryDate,
            entryType: "transfer",
            description: parsed.data.description,
            referenceType: "account_transfer",
            isSystemEntry: false,
            createdByUserId: req.auth.userId,
            lines: [
                { accountId: toAccount.id, side: "debit", amount },
                { accountId: fromAccount.id, side: "credit", amount },
            ],
        });
    });
    return res.status(201).json(serializeJournalEntry(entry));
}));
exports.accountingRouter.get("/journal", asyncRoute(async (req, res) => {
    const orgId = getOrgId(req);
    if (!orgId)
        return res.status(400).json({ error: "Organization scope required" });
    const page = Math.max(1, parseInt(String(req.query.page), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit), 10) || 25));
    const entryType = typeof req.query.entryType === "string" ? req.query.entryType : undefined;
    const referenceType = typeof req.query.referenceType === "string" ? req.query.referenceType : undefined;
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const sortOrder = req.query.sortOrder === "asc" ? "asc" : "desc";
    const from = optionalDateFromQuery(req.query.fromDate);
    const to = optionalDateFromQuery(req.query.toDate);
    const where = { organizationId: orgId };
    if (entryType)
        where.entryType = entryType;
    if (referenceType)
        where.referenceType = referenceType;
    if (from || to) {
        where.entryDate = {
            ...(from ? { gte: startOfDay(from) } : {}),
            ...(to ? { lte: endOfDay(to) } : {}),
        };
    }
    if (search) {
        where.OR = [
            { description: { contains: search, mode: "insensitive" } },
            { referenceType: { contains: search, mode: "insensitive" } },
            { referenceId: { contains: search, mode: "insensitive" } },
            { createdBy: { email: { contains: search, mode: "insensitive" } } },
            { lines: { some: { memo: { contains: search, mode: "insensitive" } } } },
            { lines: { some: { account: { name: { contains: search, mode: "insensitive" } } } } },
        ];
    }
    const [items, total] = await Promise.all([
        prisma_js_1.prisma.accountingJournalEntry.findMany({
            where,
            skip: (page - 1) * limit,
            take: limit,
            orderBy: [{ entryDate: sortOrder }, { createdAt: sortOrder }],
            include: {
                createdBy: { select: { id: true, email: true } },
                lines: { include: { account: true }, orderBy: { createdAt: "asc" } },
            },
        }),
        prisma_js_1.prisma.accountingJournalEntry.count({ where }),
    ]);
    return res.json({ items: items.map(serializeJournalEntry), total, page, limit });
}));
exports.accountingRouter.get("/reports/profit-loss", asyncRoute(async (req, res) => {
    const orgId = getOrgId(req);
    if (!orgId)
        return res.status(400).json({ error: "Organization scope required" });
    const from = dateFromQuery(req.query.fromDate, new Date(new Date().getFullYear(), new Date().getMonth(), 1));
    const to = endOfDay(dateFromQuery(req.query.toDate, new Date()));
    const accounts = await prisma_js_1.prisma.accountingAccount.findMany({
        where: { organizationId: orgId, accountType: { in: ["income", "expense"] } },
        orderBy: [{ accountType: "asc" }, { name: "asc" }],
    });
    const lines = await prisma_js_1.prisma.accountingJournalLine.groupBy({
        by: ["accountId", "side"],
        where: {
            organizationId: orgId,
            journalEntry: { entryDate: { gte: from, lte: to } },
            account: { accountType: { in: ["income", "expense"] } },
        },
        _sum: { amount: true },
    });
    const totals = new Map();
    for (const line of lines) {
        const existing = totals.get(line.accountId) ?? { debit: new library_1.Decimal(0), credit: new library_1.Decimal(0) };
        if (line.side === "debit")
            existing.debit = existing.debit.add(line._sum.amount ?? new library_1.Decimal(0));
        else
            existing.credit = existing.credit.add(line._sum.amount ?? new library_1.Decimal(0));
        totals.set(line.accountId, existing);
    }
    const rows = accounts.map((account) => {
        const total = totals.get(account.id) ?? { debit: new library_1.Decimal(0), credit: new library_1.Decimal(0) };
        return {
            id: account.id,
            name: account.name,
            accountType: account.accountType,
            amount: asNumber((0, accounting_js_1.accountBalanceExpression)(account.accountType, total.debit, total.credit)),
        };
    }).filter((row) => Math.abs(row.amount) > 0.000001);
    const incomeTotal = rows
        .filter((row) => row.accountType === "income")
        .reduce((sum, row) => sum + row.amount, 0);
    const expenseTotal = rows
        .filter((row) => row.accountType === "expense")
        .reduce((sum, row) => sum + row.amount, 0);
    return res.json({
        fromDate: from.toISOString().slice(0, 10),
        toDate: to.toISOString().slice(0, 10),
        income: rows.filter((row) => row.accountType === "income"),
        expenses: rows.filter((row) => row.accountType === "expense"),
        incomeTotal: Number(incomeTotal.toFixed(2)),
        expenseTotal: Number(expenseTotal.toFixed(2)),
        netIncome: Number((incomeTotal - expenseTotal).toFixed(2)),
    });
}));
exports.accountingRouter.get("/reports/balance-sheet", asyncRoute(async (req, res) => {
    const orgId = getOrgId(req);
    if (!orgId)
        return res.status(400).json({ error: "Organization scope required" });
    const asOf = endOfDay(dateFromQuery(req.query.asOfDate, new Date()));
    const balances = await prisma_js_1.prisma.$transaction((tx) => (0, accounting_js_1.accountBalances)(tx, orgId, asOf));
    const rows = balances.map(serializeAccount).filter((account) => Math.abs(account.balance ?? 0) > 0.000001);
    const assets = rows.filter((account) => account.accountType === "asset");
    const liabilities = rows.filter((account) => account.accountType === "liability");
    const equity = rows.filter((account) => account.accountType === "equity");
    const currentEarnings = balances
        .filter((account) => account.accountType === "income" || account.accountType === "expense")
        .reduce((sum, account) => {
        const amount = account.accountType === "income" ? account.balance : account.balance.neg();
        return sum.add(amount);
    }, new library_1.Decimal(0));
    const assetTotal = assets.reduce((sum, account) => sum + Number(account.balance ?? 0), 0);
    const liabilityTotal = liabilities.reduce((sum, account) => sum + Number(account.balance ?? 0), 0);
    const equityTotal = equity.reduce((sum, account) => sum + Number(account.balance ?? 0), 0) + asNumber(currentEarnings);
    return res.json({
        asOfDate: asOf.toISOString().slice(0, 10),
        assets,
        liabilities,
        equity: [
            ...equity,
            {
                id: "current-earnings",
                name: "Current Year Earnings",
                accountType: "equity",
                balance: asNumber(currentEarnings),
            },
        ].filter((account) => Math.abs(Number(account.balance ?? 0)) > 0.000001),
        assetTotal: Number(assetTotal.toFixed(2)),
        liabilityTotal: Number(liabilityTotal.toFixed(2)),
        equityTotal: Number(equityTotal.toFixed(2)),
        liabilitiesAndEquityTotal: Number((liabilityTotal + equityTotal).toFixed(2)),
    });
}));
