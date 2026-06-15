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
    description: zod_1.z.string().trim().max(500).optional().nullable(),
});
const updateAccountSchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(1).max(120).optional(),
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
const transferSchema = zod_1.z.object({
    fromAccountId: zod_1.z.string().min(1),
    toAccountId: zod_1.z.string().min(1),
    amount: moneySchema,
    entryDate: zod_1.z.string().optional(),
    description: zod_1.z.string().trim().min(1).max(300),
});
function requireAccountingAdmin(req, res, next) {
    if (!requireAccountingRole(req, res))
        return;
    next();
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
    const lineCount = await prisma_js_1.prisma.accountingJournalLine.count({ where: { accountId: account.id } });
    if (lineCount > 0 && parsed.data.isActive === false && account.systemKey) {
        return res.status(409).json({ error: "System accounts with activity cannot be archived" });
    }
    const updated = await prisma_js_1.prisma.accountingAccount.update({
        where: { id: account.id },
        data: {
            ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
            ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
            ...(parsed.data.isActive !== undefined ? { isActive: parsed.data.isActive } : {}),
        },
    });
    return res.json(updated);
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
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const sortOrder = req.query.sortOrder === "asc" ? "asc" : "desc";
    const from = optionalDateFromQuery(req.query.fromDate);
    const to = optionalDateFromQuery(req.query.toDate);
    const where = { organizationId: orgId };
    if (entryType)
        where.entryType = entryType;
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
                name: "Current Earnings",
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
