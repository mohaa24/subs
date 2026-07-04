import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import type { AccountingAccountType, AccountingAssetSubtype, FundTransactionType, Prisma } from "@prisma/client";
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
const assetSubtypes: AccountingAssetSubtype[] = ["cash_bank", "receivable", "other"];

function getOrgId(req: any): string | undefined {
  return req.organizationId ?? req.body?.organizationId ?? req.query?.organizationId;
}

function requireAccountingRole(req: any, res: any) {
  if (req.auth!.role !== "admin" && req.auth!.role !== "super_user") {
    res.status(403).json({ error: "Only admins can manage accounting" });
    return false;
  }
  return true;
}

function asyncRoute(handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
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

function dateFromQuery(value: unknown, fallback: Date) {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function optionalDateFromQuery(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
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
  assetSubtype: z.enum(assetSubtypes as [AccountingAssetSubtype, ...AccountingAssetSubtype[]]).optional(),
  description: z.string().trim().max(500).optional().nullable(),
});

const updateAccountSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  assetSubtype: z.enum(assetSubtypes as [AccountingAssetSubtype, ...AccountingAssetSubtype[]]).optional(),
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

const incomeSchema = z.object({
  destinationAccountId: z.string().min(1),
  incomeAccountId: z.string().min(1),
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

const createFundSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional().nullable(),
  openingBalance: z.number().min(0).optional(),
  openingAssetAccountId: z.string().optional().nullable(),
}).superRefine((data, ctx) => {
  if ((data.openingBalance ?? 0) > 0 && !data.openingAssetAccountId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["openingAssetAccountId"],
      message: "Opening asset account is required when opening balance is greater than zero",
    });
  }
});

const fundCollectionSchema = z.object({
  amount: moneySchema,
  assetAccountId: z.string().min(1),
  transactionDate: z.string().optional(),
  paidByName: z.string().trim().min(1).max(160),
  paidByMembershipId: z.string().optional().nullable(),
  memo: z.string().trim().max(500).optional().nullable(),
});

const fundExpenseSchema = z.object({
  amount: moneySchema,
  assetAccountId: z.string().min(1),
  transactionDate: z.string().optional(),
  description: z.string().trim().min(1).max(300),
  memo: z.string().trim().max(500).optional().nullable(),
});

const fundTransferSchema = z.object({
  transactionDate: z.string().optional(),
  memo: z.string().trim().max(500).optional().nullable(),
});

function requireAccountingAdmin(req: Request, res: Response, next: NextFunction) {
  if (!requireAccountingRole(req, res)) return;
  next();
}

function fundDelta(type: FundTransactionType, amount: Decimal) {
  if (type === "opening" || type === "collection" || type === "deficit_transfer") return amount;
  return amount.neg();
}

function fundTransferSignedAmount(type: FundTransactionType, amount: Decimal) {
  if (type === "surplus_transfer") return amount;
  if (type === "deficit_transfer") return amount.neg();
  return new Decimal(0);
}

async function fundBalance(
  tx: Prisma.TransactionClient,
  organizationId: string,
  fundPotId: string,
  beforeDate?: Date | null
) {
  const transactions = await tx.fundTransaction.findMany({
    where: {
      organizationId,
      fundPotId,
      ...(beforeDate ? { transactionDate: { lt: beforeDate } } : {}),
    },
    select: { transactionType: true, amount: true },
  });

  return transactions.reduce(
    (sum, txRow) => sum.add(fundDelta(txRow.transactionType, txRow.amount)),
    new Decimal(0)
  );
}

async function requireCashBankAccount(
  tx: Prisma.TransactionClient,
  organizationId: string,
  accountId: string
) {
  const account = await tx.accountingAccount.findFirst({
    where: {
      id: accountId,
      organizationId,
      accountType: "asset",
      assetSubtype: "cash_bank",
      isActive: true,
    },
  });
  if (!account) throw new Error("Account must be an active cash/bank asset account");
  return account;
}

async function nextAvailableAccountName(
  tx: Prisma.TransactionClient,
  organizationId: string,
  baseName: string
) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const name = attempt === 0 ? baseName : `${baseName} ${attempt + 1}`;
    const existing = await tx.accountingAccount.findFirst({
      where: { organizationId, name: { equals: name, mode: "insensitive" } },
      select: { id: true },
    });
    if (!existing) return name;
  }
  return `${baseName} ${Date.now()}`;
}

function serializeFundTransaction(txRow: any) {
  return {
    ...txRow,
    amount: Number(txRow.amount),
    transactionDate: txRow.transactionDate.toISOString(),
    createdAt: txRow.createdAt.toISOString(),
  };
}

function serializeFundPot(fund: any, summary?: any) {
  return {
    ...fund,
    openingBalance: Number(fund.openingBalance),
    createdAt: fund.createdAt.toISOString(),
    updatedAt: fund.updatedAt.toISOString(),
    closedAt: fund.closedAt?.toISOString?.() ?? null,
    ...(summary ? { summary } : {}),
    transactions: fund.transactions?.map(serializeFundTransaction),
  };
}

accountingRouter.get("/accounts", asyncRoute(async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ error: "Organization scope required" });

  const includeInactive = req.query.includeInactive === "true";
  const accounts = await prisma.$transaction(async (tx) => {
    const balances = await accountBalances(tx, orgId);
    return includeInactive ? balances : balances.filter((account) => account.isActive);
  });

  return res.json(accounts.map(serializeAccount));
}));

accountingRouter.post("/accounts", requireAccountingAdmin, asyncRoute(async (req, res) => {
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
      assetSubtype: parsed.data.accountType === "asset" ? parsed.data.assetSubtype ?? "other" : "other",
      description: parsed.data.description ?? null,
      createdByUserId: req.auth!.userId,
    },
  });

  return res.status(201).json(account);
}));

accountingRouter.patch("/accounts/:id", requireAccountingAdmin, asyncRoute(async (req, res) => {
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
  if (parsed.data.assetSubtype !== undefined && account.accountType !== "asset") {
    return res.status(400).json({ error: "Asset subtype can only be set on asset accounts" });
  }

  const lineCount = await prisma.accountingJournalLine.count({ where: { accountId: account.id } });
  if (lineCount > 0 && parsed.data.isActive === false && account.systemKey) {
    return res.status(409).json({ error: "System accounts with activity cannot be archived" });
  }

  const updated = await prisma.accountingAccount.update({
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

accountingRouter.get("/funds", asyncRoute(async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ error: "Organization scope required" });

  const from = optionalDateFromQuery(req.query.fromDate);
  const to = optionalDateFromQuery(req.query.toDate);
  const toEnd = to ? endOfDay(to) : null;

  const funds = await prisma.fundPot.findMany({
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

  const rows = funds.map((fund) => {
    let opening = new Decimal(0);
    let received = new Decimal(0);
    let spent = new Decimal(0);
    let netTransferred = new Decimal(0);

    for (const txRow of fund.transactions) {
      const inPeriod =
        (!from || txRow.transactionDate >= startOfDay(from)) &&
        (!toEnd || txRow.transactionDate <= toEnd);

      if (!inPeriod) {
        opening = opening.add(fundDelta(txRow.transactionType, txRow.amount));
        continue;
      }

      if (txRow.transactionType === "opening") opening = opening.add(txRow.amount);
      if (txRow.transactionType === "collection") received = received.add(txRow.amount);
      if (txRow.transactionType === "expense") spent = spent.add(txRow.amount);
      netTransferred = netTransferred.add(fundTransferSignedAmount(txRow.transactionType, txRow.amount));
    }

    const activeRemaining = opening.add(received).sub(spent).sub(netTransferred);
    return serializeFundPot(fund, {
      opening: asNumber(opening),
      received: asNumber(received),
      spent: asNumber(spent),
      netTransferred: asNumber(netTransferred),
      activeRemaining: asNumber(activeRemaining),
    });
  });

  return res.json(rows);
}));

accountingRouter.post("/funds", requireAccountingAdmin, asyncRoute(async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ error: "Organization scope required" });

  const parsed = createFundSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  }

  const openingBalance = new Decimal(parsed.data.openingBalance ?? 0);
  const entryDate = new Date();

  const fund = await prisma.$transaction(async (tx) => {
    await ensureDefaultAccountingAccounts(tx, orgId);

    const existingFund = await tx.fundPot.findFirst({
      where: { organizationId: orgId, name: { equals: parsed.data.name, mode: "insensitive" } },
      select: { id: true },
    });
    if (existingFund) throw new Error("A fund with this name already exists");

    const openingAssetAccount = openingBalance.gt(0)
      ? await requireCashBankAccount(tx, orgId, parsed.data.openingAssetAccountId!)
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
        createdByUserId: req.auth!.userId,
      },
    });
    const surplusAccount = await tx.accountingAccount.create({
      data: {
        organizationId: orgId,
        name: surplusAccountName,
        accountType: "income",
        description: `Surplus transferred from ${parsed.data.name}`,
        systemKey: `fund_surplus_${fundAccount.id}`,
        createdByUserId: req.auth!.userId,
      },
    });
    const deficitAccount = await tx.accountingAccount.create({
      data: {
        organizationId: orgId,
        name: deficitAccountName,
        accountType: "expense",
        description: `Deficit transferred from ${parsed.data.name}`,
        systemKey: `fund_deficit_${fundAccount.id}`,
        createdByUserId: req.auth!.userId,
      },
    });

    const createdFund = await tx.fundPot.create({
      data: {
        organizationId: orgId,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        openingBalance,
        fundAccountId: fundAccount.id,
        surplusAccountId: surplusAccount.id,
        deficitAccountId: deficitAccount.id,
        openingAssetAccountId: openingAssetAccount?.id ?? null,
        createdByUserId: req.auth!.userId,
      },
    });

    if (openingBalance.gt(0) && openingAssetAccount) {
      const journalEntry = await createJournalEntry(tx, {
        organizationId: orgId,
        entryDate,
        entryType: "opening_balance",
        description: `Opening balance for ${createdFund.name}`,
        referenceType: "fund_opening",
        referenceId: createdFund.id,
        isSystemEntry: true,
        createdByUserId: req.auth!.userId,
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
          createdByUserId: req.auth!.userId,
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

accountingRouter.get("/funds/:id", asyncRoute(async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ error: "Organization scope required" });

  const fund = await prisma.fundPot.findFirst({
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
  if (!fund) return res.status(404).json({ error: "Fund not found" });

  const activeRemaining = await prisma.$transaction((tx) => fundBalance(tx, orgId, fund.id));
  return res.json(serializeFundPot(fund, { activeRemaining: asNumber(activeRemaining) }));
}));

accountingRouter.post("/funds/:id/collections", requireAccountingAdmin, asyncRoute(async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ error: "Organization scope required" });

  const parsed = fundCollectionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  }

  const amount = new Decimal(parsed.data.amount);
  const transactionDate = parsed.data.transactionDate ? new Date(parsed.data.transactionDate) : new Date();

  const transaction = await prisma.$transaction(async (tx) => {
    const fund = await tx.fundPot.findFirst({
      where: { id: req.params.id, organizationId: orgId },
      include: { fundAccount: true },
    });
    if (!fund) throw new Error("Fund not found");
    if (fund.status === "closed") throw new Error("Closed funds cannot receive collections");

    const assetAccount = await requireCashBankAccount(tx, orgId, parsed.data.assetAccountId);
    if (parsed.data.paidByMembershipId) {
      const member = await tx.membership.findFirst({
        where: { id: parsed.data.paidByMembershipId, organizationId: orgId },
        select: { id: true },
      });
      if (!member) throw new Error("Selected member was not found");
    }

    const journalEntry = await createJournalEntry(tx, {
      organizationId: orgId,
      entryDate: transactionDate,
      entryType: "transfer",
      description: `Collection received for ${fund.name}`,
      referenceType: "fund_collection",
      referenceId: fund.id,
      isSystemEntry: false,
      createdByUserId: req.auth!.userId,
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
        createdByUserId: req.auth!.userId,
      },
      include: { assetAccount: true, journalEntry: true },
    });
  });

  return res.status(201).json(serializeFundTransaction(transaction));
}));

accountingRouter.post("/funds/:id/expenses", requireAccountingAdmin, asyncRoute(async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ error: "Organization scope required" });

  const parsed = fundExpenseSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  }

  const amount = new Decimal(parsed.data.amount);
  const transactionDate = parsed.data.transactionDate ? new Date(parsed.data.transactionDate) : new Date();

  const transaction = await prisma.$transaction(async (tx) => {
    const fund = await tx.fundPot.findFirst({
      where: { id: req.params.id, organizationId: orgId },
      include: { fundAccount: true },
    });
    if (!fund) throw new Error("Fund not found");
    if (fund.status === "closed") throw new Error("Closed funds cannot record expenses");

    const assetAccount = await requireCashBankAccount(tx, orgId, parsed.data.assetAccountId);
    const journalEntry = await createJournalEntry(tx, {
      organizationId: orgId,
      entryDate: transactionDate,
      entryType: "expense",
      description: parsed.data.description,
      referenceType: "fund_expense",
      referenceId: fund.id,
      isSystemEntry: false,
      createdByUserId: req.auth!.userId,
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
        createdByUserId: req.auth!.userId,
      },
      include: { assetAccount: true, journalEntry: true },
    });
  });

  return res.status(201).json(serializeFundTransaction(transaction));
}));

async function transferFundBalance(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    fundPotId: string;
    userId: string;
    transactionDate: Date;
    memo?: string | null;
  }
) {
  const fund = await tx.fundPot.findFirst({
    where: { id: input.fundPotId, organizationId: input.organizationId },
    include: { fundAccount: true, surplusAccount: true, deficitAccount: true },
  });
  if (!fund) throw new Error("Fund not found");

  const balance = await fundBalance(tx, input.organizationId, fund.id);
  if (balance.equals(new Decimal(0))) return null;

  const isSurplus = balance.gt(new Decimal(0));
  const amount = isSurplus ? balance : balance.abs();
  const transactionType: FundTransactionType = isSurplus ? "surplus_transfer" : "deficit_transfer";
  const journalEntry = await createJournalEntry(tx, {
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

accountingRouter.post("/funds/:id/transfer", requireAccountingAdmin, asyncRoute(async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ error: "Organization scope required" });

  const parsed = fundTransferSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  }

  const transactionDate = parsed.data.transactionDate ? new Date(parsed.data.transactionDate) : new Date();
  const transaction = await prisma.$transaction(async (tx) => {
    const fund = await tx.fundPot.findFirst({
      where: { id: req.params.id, organizationId: orgId },
      select: { id: true, status: true },
    });
    if (!fund) throw new Error("Fund not found");
    if (fund.status === "closed") throw new Error("Closed funds cannot be transferred");
    return transferFundBalance(tx, {
      organizationId: orgId,
      fundPotId: fund.id,
      userId: req.auth!.userId,
      transactionDate,
      memo: parsed.data.memo ?? null,
    });
  });

  if (!transaction) return res.status(409).json({ error: "There is no remaining balance to transfer" });
  return res.status(201).json(serializeFundTransaction(transaction));
}));

accountingRouter.post("/funds/:id/close", requireAccountingAdmin, asyncRoute(async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ error: "Organization scope required" });

  const parsed = fundTransferSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  }

  const transactionDate = parsed.data.transactionDate ? new Date(parsed.data.transactionDate) : new Date();
  const fund = await prisma.$transaction(async (tx) => {
    const existing = await tx.fundPot.findFirst({
      where: { id: req.params.id, organizationId: orgId },
      select: { id: true, status: true },
    });
    if (!existing) throw new Error("Fund not found");
    if (existing.status === "closed") throw new Error("Fund is already closed");

    await transferFundBalance(tx, {
      organizationId: orgId,
      fundPotId: existing.id,
      userId: req.auth!.userId,
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

accountingRouter.post("/expenses", requireAccountingAdmin, asyncRoute(async (req, res) => {
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
}));

accountingRouter.post("/income", requireAccountingAdmin, asyncRoute(async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ error: "Organization scope required" });

  const parsed = incomeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  }

  const amount = new Decimal(parsed.data.amount);
  const entryDate = parsed.data.entryDate ? new Date(parsed.data.entryDate) : new Date();
  const [destinationAccount, incomeAccount] = await Promise.all([
    prisma.accountingAccount.findFirst({
      where: { id: parsed.data.destinationAccountId, organizationId: orgId, isActive: true },
    }),
    prisma.accountingAccount.findFirst({
      where: { id: parsed.data.incomeAccountId, organizationId: orgId, isActive: true },
    }),
  ]);

  if (!destinationAccount || destinationAccount.accountType !== "asset") {
    return res.status(400).json({ error: "Destination account must be an active asset account" });
  }
  if (!incomeAccount || incomeAccount.accountType !== "income") {
    return res.status(400).json({ error: "Income account must be an active income account" });
  }

  const entry = await prisma.$transaction(async (tx) => {
    await ensureDefaultAccountingAccounts(tx, orgId);
    return createJournalEntry(tx, {
      organizationId: orgId,
      entryDate,
      entryType: "manual_adjustment",
      description: parsed.data.description,
      referenceType: "manual_income",
      isSystemEntry: false,
      createdByUserId: req.auth!.userId,
      lines: [
        { accountId: destinationAccount.id, side: "debit", amount, memo: parsed.data.memo ?? null },
        { accountId: incomeAccount.id, side: "credit", amount, memo: parsed.data.memo ?? null },
      ],
    });
  });

  return res.status(201).json(serializeJournalEntry(entry));
}));

accountingRouter.post("/transfers", requireAccountingAdmin, asyncRoute(async (req, res) => {
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
}));

accountingRouter.get("/journal", asyncRoute(async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ error: "Organization scope required" });

  const page = Math.max(1, parseInt(String(req.query.page), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit), 10) || 25));
  const entryType = typeof req.query.entryType === "string" ? req.query.entryType : undefined;
  const referenceType = typeof req.query.referenceType === "string" ? req.query.referenceType : undefined;
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const sortOrder = req.query.sortOrder === "asc" ? "asc" : "desc";
  const from = optionalDateFromQuery(req.query.fromDate);
  const to = optionalDateFromQuery(req.query.toDate);
  const where: any = { organizationId: orgId };
  if (entryType) where.entryType = entryType;
  if (referenceType) where.referenceType = referenceType;
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
    prisma.accountingJournalEntry.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: [{ entryDate: sortOrder }, { createdAt: sortOrder }],
      include: {
        createdBy: { select: { id: true, email: true } },
        lines: { include: { account: true }, orderBy: { createdAt: "asc" } },
      },
    }),
    prisma.accountingJournalEntry.count({ where }),
  ]);

  return res.json({ items: items.map(serializeJournalEntry), total, page, limit });
}));

accountingRouter.get("/reports/profit-loss", asyncRoute(async (req, res) => {
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
}));

accountingRouter.get("/reports/balance-sheet", asyncRoute(async (req, res) => {
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
}));
