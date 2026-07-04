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
const assetSubtypes = ["cash_bank", "receivable", "other"];
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
    assetSubtype: zod_1.z.enum(assetSubtypes).optional(),
    description: zod_1.z.string().trim().max(500).optional().nullable(),
});
const updateAccountSchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(1).max(120).optional(),
    assetSubtype: zod_1.z.enum(assetSubtypes).optional(),
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
        if (toEnd && txRow.transactionDate > toEnd)
            continue;
        if (fromStart && txRow.transactionDate < fromStart) {
            openingBalance = openingBalance.add(fundDelta(txRow.transactionType, txRow.amount));
            continue;
        }
        if (txRow.transactionType === "opening" || txRow.transactionType === "collection") {
            totalCollected = totalCollected.add(txRow.amount);
        }
        if (txRow.transactionType === "expense") {
            totalSpent = totalSpent.add(txRow.amount);
        }
        totalTransferred = totalTransferred.add(fundTransferSignedAmount(txRow.transactionType, txRow.amount));
    }
    const remainingBalance = openingBalance.add(totalCollected).sub(totalSpent).sub(totalTransferred);
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
async function fundBalance(tx, organizationId, fundPotId, beforeDate) {
    const transactions = await tx.fundTransaction.findMany({
        where: {
            organizationId,
            fundPotId,
            ...(beforeDate ? { transactionDate: { lt: beforeDate } } : {}),
        },
        select: { transactionType: true, amount: true },
    });
    return transactions.reduce((sum, txRow) => sum.add(fundDelta(txRow.transactionType, txRow.amount)), new library_1.Decimal(0));
}
async function requireCashBankAccount(tx, organizationId, accountId) {
    const account = await tx.accountingAccount.findFirst({
        where: {
            id: accountId,
            organizationId,
            accountType: "asset",
            assetSubtype: "cash_bank",
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
    };
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
            assetSubtype: parsed.data.accountType === "asset" ? parsed.data.assetSubtype ?? "other" : "other",
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
    if (parsed.data.assetSubtype !== undefined && account.accountType !== "asset") {
        return res.status(400).json({ error: "Asset subtype can only be set on asset accounts" });
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
        if (parsed.data.paidByMembershipId) {
            const member = await tx.membership.findFirst({
                where: { id: parsed.data.paidByMembershipId, organizationId: orgId },
                select: { id: true },
            });
            if (!member)
                throw new Error("Selected member was not found");
        }
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
                paidByMembershipId: parsed.data.paidByMembershipId ?? null,
                memo: parsed.data.memo ?? null,
                journalEntryId: journalEntry.id,
                createdByUserId: req.auth.userId,
            },
            include: { assetAccount: true, journalEntry: true },
        });
    });
    return res.status(201).json(serializeFundTransaction(transaction));
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
    const amount = isSurplus ? balance : balance.abs();
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
    const transaction = await prisma_js_1.prisma.$transaction(async (tx) => {
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
            memo: parsed.data.memo ?? null,
        });
    });
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
