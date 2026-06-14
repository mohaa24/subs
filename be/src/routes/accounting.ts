import { Router } from "express";
import { z } from "zod";
import type { AccountingAccountType } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "../lib/prisma.js";
import { requireAuth, withOrgScope } from "../middleware/auth.js";
import {
  accountBalanceExpression,
  accountBalances,
  createJournalEntry,
  ensureDefaultAccountingAccounts,
} from "../lib/accounting.js";

export const accountingRouter = Router();

accountingRouter.use(requireAuth);
accountingRouter.use(withOrgScope);

const accountTypes: AccountingAccountType[] = ["asset", "liability", "equity", "income", "expense"];

function getOrgId(req: any): string | undefined {
  return req.organizationId ?? req.body?.organizationId ?? req.query?.organizationId;
}

function requireAccountingRole(req: any, res: any) {
  if (req.auth!.role !== "admin" && req.auth!.role !== "super_user") {
    res.status(403).json({ error: "Only admins can access accounting" });
    return false;
  }
  return true;
}

function dateFromQuery(value: unknown, fallback: Date) {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function endOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

function asNumber(value: Decimal) {
  return Number(value.toFixed(2));
}

function serializeAccount(account: any) {
  return {
    ...account,
    debitTotal: account.debitTotal ? asNumber(account.debitTotal) : undefined,
    creditTotal: account.creditTotal ? asNumber(account.creditTotal) : undefined,
    balance: account.balance ? asNumber(account.balance) : undefined,
  };
}

function serializeJournalEntry(entry: any) {
  return {
    ...entry,
    entryDate: entry.entryDate.toISOString(),
    createdAt: entry.createdAt.toISOString(),
    lines: entry.lines?.map((line: any) => ({
      ...line,
      amount: Number(line.amount),
      createdAt: line.createdAt?.toISOString?.() ?? line.createdAt,
    })),
  };
}

const createAccountSchema = z.object({
  name: z.string().trim().min(1).max(120),
  accountType: z.enum(accountTypes as [AccountingAccountType, ...AccountingAccountType[]]),
  description: z.string().trim().max(500).optional().nullable(),
});

const updateAccountSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).optional().nullable(),
  isActive: z.boolean().optional(),
});

const moneySchema = z.number().positive("Amount must be greater than zero");

const expenseSchema = z.object({
  sourceAccountId: z.string().min(1),
  expenseAccountId: z.string().min(1),
  amount: moneySchema,
  entryDate: z.string().optional(),
  description: z.string().trim().min(1).max(300),
  memo: z.string().trim().max(500).optional().nullable(),
});

const transferSchema = z.object({
  fromAccountId: z.string().min(1),
  toAccountId: z.string().min(1),
  amount: moneySchema,
  entryDate: z.string().optional(),
  description: z.string().trim().min(1).max(300),
});

accountingRouter.use((req, res, next) => {
  if (!requireAccountingRole(req, res)) return;
  next();
});

accountingRouter.get("/accounts", async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ error: "Organization scope required" });

  const includeInactive = req.query.includeInactive === "true";
  const accounts = await prisma.$transaction(async (tx) => {
    const balances = await accountBalances(tx, orgId);
    return includeInactive ? balances : balances.filter((account) => account.isActive);
  });

  return res.json(accounts.map(serializeAccount));
});

accountingRouter.post("/accounts", async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ error: "Organization scope required" });

  const parsed = createAccountSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  }

  const existing = await prisma.$transaction(async (tx) => {
    await ensureDefaultAccountingAccounts(tx, orgId);
    return tx.accountingAccount.findFirst({
      where: {
        organizationId: orgId,
        name: { equals: parsed.data.name, mode: "insensitive" },
      },
    });
  });
  if (existing) return res.status(409).json({ error: "An account with this name already exists" });

  const account = await prisma.accountingAccount.create({
    data: {
      organizationId: orgId,
      name: parsed.data.name,
      accountType: parsed.data.accountType,
      description: parsed.data.description ?? null,
      createdByUserId: req.auth!.userId,
    },
  });

  return res.status(201).json(account);
});

accountingRouter.patch("/accounts/:id", async (req, res) => {
  const parsed = updateAccountSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  }

  const account = await prisma.accountingAccount.findUnique({ where: { id: req.params.id } });
  if (!account) return res.status(404).json({ error: "Account not found" });
  if (req.auth!.role !== "super_user" && account.organizationId !== req.auth!.organizationId) {
    return res.status(403).json({ error: "Forbidden" });
  }
  if (account.systemKey && parsed.data.name && parsed.data.name !== account.name) {
    return res.status(409).json({ error: "System accounts cannot be renamed" });
  }

  const lineCount = await prisma.accountingJournalLine.count({ where: { accountId: account.id } });
  if (lineCount > 0 && parsed.data.isActive === false && account.systemKey) {
    return res.status(409).json({ error: "System accounts with activity cannot be archived" });
  }

  const updated = await prisma.accountingAccount.update({
    where: { id: account.id },
    data: {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
      ...(parsed.data.isActive !== undefined ? { isActive: parsed.data.isActive } : {}),
    },
  });

  return res.json(updated);
});

accountingRouter.post("/expenses", async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ error: "Organization scope required" });

  const parsed = expenseSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  }

  const amount = new Decimal(parsed.data.amount);
  const entryDate = parsed.data.entryDate ? new Date(parsed.data.entryDate) : new Date();
  const [sourceAccount, expenseAccount] = await Promise.all([
    prisma.accountingAccount.findFirst({
      where: { id: parsed.data.sourceAccountId, organizationId: orgId, isActive: true },
    }),
    prisma.accountingAccount.findFirst({
      where: { id: parsed.data.expenseAccountId, organizationId: orgId, isActive: true },
    }),
  ]);

  if (!sourceAccount || sourceAccount.accountType !== "asset") {
    return res.status(400).json({ error: "Source account must be an active asset account" });
  }
  if (!expenseAccount || expenseAccount.accountType !== "expense") {
    return res.status(400).json({ error: "Expense account must be an active expense account" });
  }

  const entry = await prisma.$transaction(async (tx) => {
    await ensureDefaultAccountingAccounts(tx, orgId);
    return createJournalEntry(tx, {
      organizationId: orgId,
      entryDate,
      entryType: "expense",
      description: parsed.data.description,
      referenceType: "manual_expense",
      isSystemEntry: false,
      createdByUserId: req.auth!.userId,
      lines: [
        { accountId: expenseAccount.id, side: "debit", amount, memo: parsed.data.memo ?? null },
        { accountId: sourceAccount.id, side: "credit", amount, memo: parsed.data.memo ?? null },
      ],
    });
  });

  return res.status(201).json(serializeJournalEntry(entry));
});

accountingRouter.post("/transfers", async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ error: "Organization scope required" });

  const parsed = transferSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  }
  if (parsed.data.fromAccountId === parsed.data.toAccountId) {
    return res.status(400).json({ error: "Transfer accounts must be different" });
  }

  const amount = new Decimal(parsed.data.amount);
  const entryDate = parsed.data.entryDate ? new Date(parsed.data.entryDate) : new Date();
  const [fromAccount, toAccount] = await Promise.all([
    prisma.accountingAccount.findFirst({
      where: { id: parsed.data.fromAccountId, organizationId: orgId, isActive: true },
    }),
    prisma.accountingAccount.findFirst({
      where: { id: parsed.data.toAccountId, organizationId: orgId, isActive: true },
    }),
  ]);

  if (!fromAccount || fromAccount.accountType !== "asset") {
    return res.status(400).json({ error: "From account must be an active asset account" });
  }
  if (!toAccount || toAccount.accountType !== "asset") {
    return res.status(400).json({ error: "To account must be an active asset account" });
  }

  const entry = await prisma.$transaction(async (tx) => {
    await ensureDefaultAccountingAccounts(tx, orgId);
    return createJournalEntry(tx, {
      organizationId: orgId,
      entryDate,
      entryType: "transfer",
      description: parsed.data.description,
      referenceType: "account_transfer",
      isSystemEntry: false,
      createdByUserId: req.auth!.userId,
      lines: [
        { accountId: toAccount.id, side: "debit", amount },
        { accountId: fromAccount.id, side: "credit", amount },
      ],
    });
  });

  return res.status(201).json(serializeJournalEntry(entry));
});

accountingRouter.get("/journal", async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ error: "Organization scope required" });

  const page = Math.max(1, parseInt(String(req.query.page), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit), 10) || 25));
  const entryType = typeof req.query.entryType === "string" ? req.query.entryType : undefined;
  const where: any = { organizationId: orgId };
  if (entryType) where.entryType = entryType;

  const [items, total] = await Promise.all([
    prisma.accountingJournalEntry.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }],
      include: {
        createdBy: { select: { id: true, email: true } },
        lines: { include: { account: true }, orderBy: { createdAt: "asc" } },
      },
    }),
    prisma.accountingJournalEntry.count({ where }),
  ]);

  return res.json({ items: items.map(serializeJournalEntry), total, page, limit });
});

accountingRouter.get("/reports/profit-loss", async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ error: "Organization scope required" });

  const from = dateFromQuery(req.query.fromDate, new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const to = endOfDay(dateFromQuery(req.query.toDate, new Date()));

  const accounts = await prisma.accountingAccount.findMany({
    where: { organizationId: orgId, accountType: { in: ["income", "expense"] } },
    orderBy: [{ accountType: "asc" }, { name: "asc" }],
  });
  const lines = await prisma.accountingJournalLine.groupBy({
    by: ["accountId", "side"],
    where: {
      organizationId: orgId,
      journalEntry: { entryDate: { gte: from, lte: to } },
      account: { accountType: { in: ["income", "expense"] } },
    },
    _sum: { amount: true },
  });

  const totals = new Map<string, { debit: Decimal; credit: Decimal }>();
  for (const line of lines) {
    const existing = totals.get(line.accountId) ?? { debit: new Decimal(0), credit: new Decimal(0) };
    if (line.side === "debit") existing.debit = existing.debit.add(line._sum.amount ?? new Decimal(0));
    else existing.credit = existing.credit.add(line._sum.amount ?? new Decimal(0));
    totals.set(line.accountId, existing);
  }

  const rows = accounts.map((account) => {
    const total = totals.get(account.id) ?? { debit: new Decimal(0), credit: new Decimal(0) };
    return {
      id: account.id,
      name: account.name,
      accountType: account.accountType,
      amount: asNumber(accountBalanceExpression(account.accountType, total.debit, total.credit)),
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
});

accountingRouter.get("/reports/balance-sheet", async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ error: "Organization scope required" });

  const asOf = endOfDay(dateFromQuery(req.query.asOfDate, new Date()));
  const balances = await prisma.$transaction((tx) => accountBalances(tx, orgId, asOf));
  const rows = balances.map(serializeAccount).filter((account) => Math.abs(account.balance ?? 0) > 0.000001);
  const assets = rows.filter((account) => account.accountType === "asset");
  const liabilities = rows.filter((account) => account.accountType === "liability");
  const equity = rows.filter((account) => account.accountType === "equity");
  const currentEarnings = balances
    .filter((account) => account.accountType === "income" || account.accountType === "expense")
    .reduce((sum, account) => {
      const amount = account.accountType === "income" ? account.balance : account.balance.neg();
      return sum.add(amount);
    }, new Decimal(0));

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
});
