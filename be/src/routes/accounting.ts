import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import type {
  AccountingAccount,
  AccountingAccountType,
  AccountingAssetSubtype,
  CashFlowType,
  CashTransactionCategory,
  BankingTransactionType,
  FundTransactionType,
  Prisma,
} from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "../lib/prisma.js";
import { requireAuth, withOrgScope } from "../middleware/auth.js";
import { enforceRoutePermissions } from "../middleware/route-permissions.js";
import {
  accountBalanceExpression,
  accountBalances,
  BAD_DEBT_EXPENSE_KEY,
  createJournalEntry,
  defaultAccountSubtype,
  dueTypeIncomeAccountName,
  ensureDefaultAccountingAccounts,
  getSystemAccount,
  ACCOUNTING_SYSTEM_KEYS,
} from "../lib/accounting.js";
import { writeAuditLog } from "../lib/audit-log.js";
import { loadPaymentAllocationBreakdowns } from "../lib/payment-report-allocation.js";

export const accountingRouter = Router();

accountingRouter.use(requireAuth);
accountingRouter.use(withOrgScope);
accountingRouter.use(enforceRoutePermissions((req) => {
  const path = req.path;
  if (path.startsWith("/reports/")) return "VIEW_FINANCIAL_REPORTS";
  if (path === "/journal") return "VIEW_JOURNALS";
  if (path.startsWith("/accounts")) return req.method === "GET" ? "VIEW_CHART_OF_ACCOUNTS" : "MANAGE_CHART_OF_ACCOUNTS";
  if (path.startsWith("/cash-in")) {
    if (req.method === "GET") return "VIEW_CASH_IN";
    if (path.includes("receivable")) return "MANAGE_RECEIVABLES";
    if (path.includes("payable")) return "MANAGE_PAYABLES";
    return "RECEIVE_OPERATING_INCOME";
  }
  if (path.startsWith("/cash-out")) {
    if (req.method === "GET") return "VIEW_CASH_OUT";
    if (path.includes("payable")) return "MANAGE_PAYABLES";
    return "PAY_OPERATING_EXPENSE";
  }
  if (path.startsWith("/cash-transactions/") && path.endsWith("/reverse")) return "REVERSE_CASH_TRANSACTION";
  if (path.startsWith("/receivables")) return req.method === "GET" ? "VIEW_RECEIVABLES" : "MANAGE_RECEIVABLES";
  if (path.startsWith("/payables")) return req.method === "GET" ? "VIEW_PAYABLES" : "MANAGE_PAYABLES";
  if (path.startsWith("/funds") || path.startsWith("/fund-transactions")) return req.method === "GET" ? "VIEW_SPECIAL_FUNDS" : "MANAGE_SPECIAL_FUNDS";
  if (path.startsWith("/banking") || path === "/transfers") return req.method === "GET" ? "VIEW_BANKING" : "MANAGE_BANKING";
  if (path === "/income") return "RECEIVE_OPERATING_INCOME";
  if (path === "/expenses") return "PAY_OPERATING_EXPENSE";
  return "VIEW_CHART_OF_ACCOUNTS";
}));

const accountTypes: AccountingAccountType[] = ["asset", "liability", "equity", "income", "expense"];
const accountSubtypes: AccountingAssetSubtype[] = [
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
const accountSubtypesByType: Record<AccountingAccountType, AccountingAssetSubtype[]> = {
  asset: ["cash", "bank", "loan_receivable", "service_receivable", "other"],
  liability: ["loan_payable", "service_payable", "other_liability"],
  equity: ["general_fund", "project_fund"],
  income: ["operating_income", "project_fund_surplus"],
  expense: ["operating_expense", "project_fund_deficit"],
};

const cashBankSubtypes: AccountingAssetSubtype[] = ["cash", "bank"];
const receivableSubtypes: AccountingAssetSubtype[] = ["loan_receivable", "service_receivable"];
const payableSubtypes: AccountingAssetSubtype[] = ["loan_payable", "service_payable"];
const payableBorrowingCategories: CashTransactionCategory[] = ["payable_borrowing", "payable_recovery"];
const payableRepaymentCategories: CashTransactionCategory[] = ["payable_repayment", "payable_payment"];
type CashTransactionCategoryFilter = CashTransactionCategory | CashTransactionCategory[];

function categoryFilter(category: CashTransactionCategoryFilter) {
  return Array.isArray(category) ? { in: category } : category;
}

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
        const statusCode = typeof (error as any)?.statusCode === "number" ? (error as any).statusCode : 500;
        res.status(statusCode).json({ error: statusCode === 500 ? "Accounting request failed" : (error as any)?.message ?? "Accounting request failed" });
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

function localDateString(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function asNumber(value: Decimal) {
  return Number(value.toFixed(2));
}

const moduleManagedAccountSubtypes = new Set<AccountingAssetSubtype>([
  "loan_receivable",
  "service_receivable",
  "loan_payable",
  "service_payable",
  "project_fund",
  "project_fund_surplus",
  "project_fund_deficit",
]);

function isAccountNameEditable(account: Pick<AccountingAccount, "systemKey" | "assetSubtype">) {
  return !account.systemKey && !moduleManagedAccountSubtypes.has(account.assetSubtype);
}

function serializeAccount(account: any) {
  return {
    ...account,
    nameEditable: isAccountNameEditable(account),
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
  assetSubtype: z.enum(accountSubtypes as [AccountingAssetSubtype, ...AccountingAssetSubtype[]]).optional(),
  description: z.string().trim().max(500).optional().nullable(),
}).superRefine((data, ctx) => {
  if (data.assetSubtype && !accountSubtypesByType[data.accountType].includes(data.assetSubtype)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["assetSubtype"],
      message: "Selected subtype does not match the account type",
    });
  }
});

const updateAccountSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  assetSubtype: z.enum(accountSubtypes as [AccountingAssetSubtype, ...AccountingAssetSubtype[]]).optional(),
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

const cashTransactionSchema = z.object({
  accountId: z.string().min(1),
  cashBankAccountId: z.string().min(1),
  amount: moneySchema,
  transactionDate: z.string().optional(),
  counterpartyName: z.string().trim().min(1).max(160),
  counterpartyPhone: z.string().trim().max(40).optional().nullable(),
  counterpartyMembershipId: z.string().optional().nullable(),
  reference: z.string().trim().max(120).optional().nullable(),
  description: z.string().trim().max(500).optional().nullable(),
});

const cashReverseSchema = z.object({
  reason: z.string().trim().min(1, "Reversal reason is required").max(500),
});

const bankingAccountSchema = z.object({
  name: z.string().trim().min(1).max(120),
  assetSubtype: z.enum(["cash", "bank"]),
  bankName: z.string().trim().max(120).optional().nullable(),
  accountNumber: z.string().trim().max(80).optional().nullable(),
  description: z.string().trim().max(500).optional().nullable(),
});

const bankingTransactionSchema = z.object({
  transactionType: z.enum(["deposit", "withdrawal", "cash_transfer", "bank_transfer"]),
  sourceAccountId: z.string().min(1),
  destinationAccountId: z.string().min(1),
  amount: moneySchema,
  transactionDate: z.string().optional(),
  description: z.string().trim().max(500).optional().nullable(),
  reference: z.string().trim().max(120).optional().nullable(),
});

const bankingReverseSchema = z.object({
  reason: z.enum(["Incorrect Amount", "Incorrect Account", "Duplicate Entry", "Entered by Mistake", "Other"]),
  note: z.string().trim().max(500).optional().nullable(),
});

const createReceivableSchema = z.object({
  name: z.string().trim().min(1).max(120),
  assetSubtype: z.literal("loan_receivable"),
  counterpartyName: z.string().trim().max(160).optional().nullable(),
  counterpartyPhone: z.string().trim().max(40).optional().nullable(),
  counterpartyMembershipId: z.string().optional().nullable(),
  description: z.string().trim().max(500).optional().nullable(),
});

const createPayableSchema = z.object({
  name: z.string().trim().min(1).max(120),
  assetSubtype: z.literal("loan_payable"),
  counterpartyName: z.string().trim().max(160).optional().nullable(),
  counterpartyPhone: z.string().trim().max(40).optional().nullable(),
  counterpartyMembershipId: z.string().optional().nullable(),
  description: z.string().trim().max(500).optional().nullable(),
});

const createFundSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional().nullable(),
  managerName: z.string().trim().max(160).optional().nullable(),
  periodStart: z.string().optional().nullable(),
  periodEnd: z.string().optional().nullable(),
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
  const periodStart = data.periodStart ? new Date(data.periodStart) : null;
  const periodEnd = data.periodEnd ? new Date(data.periodEnd) : null;
  if (data.periodStart && (!periodStart || Number.isNaN(periodStart.getTime()))) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["periodStart"],
      message: "Fund period start date is invalid",
    });
  }
  if (data.periodEnd && (!periodEnd || Number.isNaN(periodEnd.getTime()))) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["periodEnd"],
      message: "Fund period end date is invalid",
    });
  }
  if (periodStart && periodEnd && periodStart > periodEnd) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["periodEnd"],
      message: "Fund period end date must be after the start date",
    });
  }
});

const fundCollectionSchema = z.object({
  amount: moneySchema,
  assetAccountId: z.string().min(1),
  transactionDate: z.string().optional(),
  paidByName: z.string().trim().min(1).max(160),
  paidByPhone: z.string().trim().max(40).optional().nullable(),
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
  amount: z.number().positive().optional().nullable(),
  transactionDate: z.string().optional(),
  memo: z.string().trim().max(500).optional().nullable(),
});

function requireAccountingAdmin(req: Request, res: Response, next: NextFunction) {
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

function summarizeFundTransactions(
  transactions: Array<{ transactionType: FundTransactionType; amount: Decimal; transactionDate: Date; reversedAt?: Date | null }>,
  from?: Date | null,
  toEnd?: Date | null
) {
  let opening = new Decimal(0);
  let received = new Decimal(0);
  let spent = new Decimal(0);
  let netTransferred = new Decimal(0);
  const fromStart = from ? startOfDay(from) : null;

  for (const txRow of transactions) {
    if (txRow.reversedAt) continue;
    const inPeriod =
      (!fromStart || txRow.transactionDate >= fromStart) &&
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
  return {
    opening: asNumber(opening),
    received: asNumber(received),
    spent: asNumber(spent),
    netTransferred: asNumber(netTransferred),
    activeRemaining: asNumber(activeRemaining),
  };
}

function summarizeFundReportTransactions(
  transactions: Array<{ transactionType: FundTransactionType; amount: Decimal; transactionDate: Date; reversedAt?: Date | null }>,
  from?: Date | null,
  toEnd?: Date | null
) {
  let openingBalance = new Decimal(0);
  let totalCollected = new Decimal(0);
  let totalSpent = new Decimal(0);
  let totalTransferred = new Decimal(0);
  const fromStart = from ? startOfDay(from) : null;

  for (const txRow of transactions) {
    if (txRow.reversedAt) continue;
    if (toEnd && txRow.transactionDate > toEnd) continue;
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

function fundReportRange(query: Request["query"]) {
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
      toEnd: optionalDateFromQuery(query.toDate) ? endOfDay(optionalDateFromQuery(query.toDate)!) : null,
      period,
    };
  }
  return { from: null, toEnd: null, period: "from_start" };
}

function fundReceiptNumberPrefix(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `F${year}${month}`;
}

async function generateFundReceiptNumber(
  tx: Prisma.TransactionClient,
  organizationId: string,
  transactionDate: Date
) {
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
    select: { transactionType: true, amount: true, reversedAt: true },
  });

  return transactions.reduce(
    (sum, txRow) => txRow.reversedAt ? sum : sum.add(fundDelta(txRow.transactionType, txRow.amount)),
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
      assetSubtype: { in: cashBankSubtypes },
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
    reversedAt: txRow.reversedAt?.toISOString?.() ?? null,
  };
}

function buildFundReceipt(transaction: any, collectedByEmail?: string | null) {
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

function cashTransactionTitle(category: CashTransactionCategory, reversal = false) {
  if (reversal) return "CASH TRANSACTION REVERSAL RECEIPT";
  if (category === "receivable_collection") return "RECEIVABLE REPAYMENT RECEIPT";
  if (category === "receivable_payment") return "RECEIVABLE PAYMENT VOUCHER";
  if (category === "receivable_write_off") return "RECEIVABLE WRITE OFF RECEIPT";
  if (category === "operating_income") return "INCOME RECEIPT";
  if (category === "operating_expense") return "EXPENSE PAYMENT VOUCHER";
  if (category === "payable_borrowing" || category === "payable_recovery") return "PAYABLE BORROWING RECEIPT";
  return "PAYABLE SETTLEMENT VOUCHER";
}

function cashTransactionCounterpartyLabel(category: CashTransactionCategory) {
  if (category === "receivable_write_off") return "Written Off Against";
  if (category === "receivable_payment" || category === "payable_repayment" || category === "payable_payment" || category === "operating_expense") return "Paid To";
  return "Received From";
}

function cashTransactionAmountLabel(category: CashTransactionCategory, reversal = false) {
  if (reversal) return "Reversed Amount";
  if (category === "receivable_write_off") return "Written Off";
  if (category === "payable_borrowing" || category === "payable_recovery") return "Borrowed";
  if (category === "receivable_payment" || category === "payable_payment" || category === "operating_expense") return "Paid";
  if (category === "payable_repayment") return "Settled";
  return "Received";
}

function buildCashTransactionReceipt(transaction: any, createdByEmail?: string | null, reversal = false) {
  return {
    receiptNumber: reversal ? transaction.reversalDocumentNumber : transaction.documentNumber,
    originalReceiptNumber: reversal ? transaction.documentNumber : null,
    transactionId: transaction.id,
    transactionDate: (reversal ? transaction.reversedAt : transaction.transactionDate).toISOString(),
    organizationName: transaction.organization.name,
    organizationReceiptLogoUrl: transaction.organization.receiptLogoUrl,
    accountName: transaction.account.name,
    counterpartyName: transaction.category === "receivable_write_off" ? transaction.account.name : transaction.counterpartyName,
    counterpartyPhone: transaction.counterpartyPhone,
    amount: Number(transaction.amount),
    paymentMethod: reversal
      ? "System Reversal"
      : transaction.category === "receivable_write_off"
        ? "Bad Debt Write-Off Expense"
        : transaction.cashBankAccount?.name ?? null,
    reference: transaction.reference,
    description: transaction.description,
    reversalReason: reversal ? transaction.reversalReason : null,
    collectedBy: createdByEmail ?? null,
    receiptTitle: cashTransactionTitle(transaction.category, reversal),
    counterpartyLabel: cashTransactionCounterpartyLabel(transaction.category),
    amountLabel: cashTransactionAmountLabel(transaction.category, reversal),
  };
}

function firstOfMonth(date = new Date()) {
  return startOfDay(new Date(date.getFullYear(), date.getMonth(), 1));
}

function firstOfYear(date = new Date()) {
  return startOfDay(new Date(date.getFullYear(), 0, 1));
}

function cashFlowRange(query: Request["query"]) {
  const from = optionalDateFromQuery(query.fromDate) ?? firstOfYear();
  const toEnd = optionalDateFromQuery(query.toDate) ? endOfDay(optionalDateFromQuery(query.toDate)!) : endOfDay(new Date());
  return { from, toEnd };
}

function cashDocumentPrefix(flowType: CashFlowType, transactionDate: Date) {
  const year = transactionDate.getFullYear();
  const month = String(transactionDate.getMonth() + 1).padStart(2, "0");
  return `${flowType === "cash_in" ? "RC" : "PV"}${year}${month}`;
}

async function generateCashDocumentNumber(
  tx: Prisma.TransactionClient,
  organizationId: string,
  flowType: CashFlowType,
  transactionDate: Date
) {
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

async function generateCashReversalDocumentNumber(
  tx: Prisma.TransactionClient,
  organizationId: string,
  reversalDate: Date
) {
  const year = reversalDate.getFullYear();
  const month = String(reversalDate.getMonth() + 1).padStart(2, "0");
  const prefix = `RV${year}${month}`;
  const latest = await tx.cashTransaction.findFirst({
    where: { organizationId, reversalDocumentNumber: { startsWith: prefix } },
    orderBy: { reversalDocumentNumber: "desc" },
    select: { reversalDocumentNumber: true },
  });
  const previousSequence = latest?.reversalDocumentNumber
    ? parseInt(latest.reversalDocumentNumber.slice(prefix.length), 10) || 0
    : 0;
  return `${prefix}${String(previousSequence + 1).padStart(4, "0")}`;
}

async function generateReceivableWriteOffDocumentNumber(
  tx: Prisma.TransactionClient,
  organizationId: string,
  transactionDate: Date
) {
  const year = transactionDate.getFullYear();
  const month = String(transactionDate.getMonth() + 1).padStart(2, "0");
  const prefix = `WO${year}${month}`;
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

function cashTransactionLabel(category: CashTransactionCategory) {
  if (category === "operating_income") return "Operating income";
  if (category === "receivable_payment") return "Receivable payment";
  if (category === "receivable_collection") return "Receivable collection";
  if (category === "receivable_write_off") return "Write off";
  if (category === "operating_expense") return "Operating expense";
  if (category === "payable_borrowing" || category === "payable_recovery") return "Borrowed";
  return "Settled";
}

function cashAccountWhere(flowType: CashFlowType, category: CashTransactionCategoryFilter): Prisma.AccountingAccountWhereInput {
  const categories = Array.isArray(category) ? category : [category];
  if (flowType === "cash_in" && categories.includes("operating_income")) {
    return {
      accountType: "income",
      assetSubtype: "operating_income",
      OR: [{ systemKey: null }, { NOT: { systemKey: { startsWith: "income_due_type_" } } }],
    };
  }
  if (categories.some((value) => value === "receivable_collection" || value === "receivable_payment" || value === "receivable_write_off")) {
    return { accountType: "asset", assetSubtype: { in: receivableSubtypes } };
  }
  if (flowType === "cash_out" && categories.includes("operating_expense")) {
    return {
      accountType: "expense",
      assetSubtype: "operating_expense",
      OR: [{ systemKey: null }, { systemKey: { not: BAD_DEBT_EXPENSE_KEY } }],
    };
  }
  return {
    accountType: "liability",
    assetSubtype: { in: payableSubtypes },
    OR: [{ systemKey: null }, { systemKey: { not: "liability_member_credit" } }],
  };
}

function isReceivableSubtype(subtype: AccountingAssetSubtype) {
  return receivableSubtypes.includes(subtype);
}

function isPayableSubtype(subtype: AccountingAssetSubtype) {
  return payableSubtypes.includes(subtype);
}

function accountSubtypeLabel(subtype?: AccountingAssetSubtype | null) {
  if (!subtype) return null;
  return subtype.replace(/_/g, " ");
}

function cashAccountBalance(accountType: AccountingAccountType, debit = new Decimal(0), credit = new Decimal(0)) {
  return accountBalanceExpression(accountType, debit, credit);
}

async function groupedAccountTotals(
  tx: Prisma.TransactionClient,
  organizationId: string,
  accountIds: string[],
  from?: Date | null,
  toEnd?: Date | null
) {
  if (!accountIds.length) return new Map<string, { debit: Decimal; credit: Decimal }>();
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

  const totals = new Map<string, { debit: Decimal; credit: Decimal }>();
  for (const row of rows) {
    const existing = totals.get(row.accountId) ?? { debit: new Decimal(0), credit: new Decimal(0) };
    if (row.side === "debit") existing.debit = existing.debit.add(row._sum.amount ?? new Decimal(0));
    else existing.credit = existing.credit.add(row._sum.amount ?? new Decimal(0));
    totals.set(row.accountId, existing);
  }
  return totals;
}

async function latestAccountActivity(
  tx: Prisma.TransactionClient,
  organizationId: string,
  accountIds: string[]
) {
  const latest = new Map<string, string>();
  await Promise.all(accountIds.map(async (accountId) => {
    const line = await tx.accountingJournalLine.findFirst({
      where: { organizationId, accountId },
      orderBy: [{ journalEntry: { entryDate: "desc" } }, { createdAt: "desc" }],
      select: { accountId: true, journalEntry: { select: { entryDate: true } } },
    });
    if (line) latest.set(accountId, line.journalEntry.entryDate.toISOString());
  }));
  return latest;
}

function serializeCashTransaction(txRow: any) {
  return {
    ...txRow,
    amount: Number(txRow.amount),
    transactionDate: txRow.transactionDate.toISOString(),
    createdAt: txRow.createdAt.toISOString(),
    reversedAt: txRow.reversedAt?.toISOString?.() ?? null,
  };
}

function cashRowFromAccount(
  account: AccountingAccount,
  periodTotals: Map<string, Decimal>,
  monthTotals: Map<string, Decimal>,
  latest: Map<string, string>
) {
  const period = periodTotals.get(account.id) ?? new Decimal(0);
  const month = monthTotals.get(account.id) ?? new Decimal(0);
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

async function groupedCashTransactionTotals(
  tx: Prisma.TransactionClient,
  organizationId: string,
  accountIds: string[],
  flowType: CashFlowType,
  category: CashTransactionCategoryFilter,
  from: Date,
  toEnd: Date
) {
  if (!accountIds.length) return new Map<string, Decimal>();
  const rows = await tx.cashTransaction.groupBy({
    by: ["accountId"],
    where: {
      organizationId,
      accountId: { in: accountIds },
      flowType,
      category: categoryFilter(category),
      reversedAt: null,
      transactionDate: { gte: from, lte: toEnd },
    },
    _sum: { amount: true },
  });

  return new Map(rows.map((row) => [row.accountId, row._sum.amount ?? new Decimal(0)]));
}

async function latestCashTransactionActivity(
  tx: Prisma.TransactionClient,
  organizationId: string,
  accountIds: string[],
  flowType: CashFlowType,
  category: CashTransactionCategoryFilter
) {
  const latest = new Map<string, string>();
  await Promise.all(accountIds.map(async (accountId) => {
    const txRow = await tx.cashTransaction.findFirst({
      where: { organizationId, accountId, flowType, category: categoryFilter(category), reversedAt: null },
      orderBy: [{ transactionDate: "desc" }, { createdAt: "desc" }],
      select: { accountId: true, transactionDate: true },
    });
    if (txRow) latest.set(accountId, txRow.transactionDate.toISOString());
  }));
  return latest;
}

async function cashTransactionAmount(
  tx: Prisma.TransactionClient,
  organizationId: string,
  input: {
    accountId: string;
    flowType: CashFlowType;
    category: CashTransactionCategoryFilter;
    from?: Date | null;
    toEnd?: Date | null;
  }
) {
  const result = await tx.cashTransaction.aggregate({
    where: {
      organizationId,
      accountId: input.accountId,
      flowType: input.flowType,
      category: categoryFilter(input.category),
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
    amount: result._sum.amount ?? new Decimal(0),
    count: result._count._all,
  };
}

function receivableAccountTypeLabel(subtype?: AccountingAssetSubtype | null) {
  if (subtype === "loan_receivable") return "Loan";
  if (subtype === "service_receivable") return "Service";
  return "Receivable";
}

function receivableAccountWhere(status: string | null, search: string, type: string | null): Prisma.AccountingAccountWhereInput {
  return {
    accountType: "asset",
    assetSubtype: type === "loan_receivable" || type === "service_receivable" ? type : { in: receivableSubtypes },
    ...(status === "closed"
      ? { OR: [{ isActive: false }, { closedAt: { not: null } }] }
      : status === "all"
        ? {}
        : { isActive: true, closedAt: null }),
    ...(search ? { name: { contains: search, mode: "insensitive" } } : {}),
  };
}

async function openingBalanceAccountAdjustments(
  tx: Prisma.TransactionClient,
  organizationId: string,
  accountIds: string[],
  range?: { from?: Date | null; toEnd?: Date | null },
  creditNormal = false
) {
  const rows = await tx.accountingJournalLine.groupBy({
    by: ["accountId", "side"],
    where: {
      organizationId,
      accountId: { in: accountIds },
      journalEntry: {
        entryType: "opening_balance",
        referenceType: {
          in: [
            "opening_balance_migration",
            "opening_balance_correction",
            "opening_balance_replacement",
            "opening_balance_reversal",
          ],
        },
        ...(range?.from || range?.toEnd
          ? {
              entryDate: {
                ...(range.from ? { gte: range.from } : {}),
                ...(range.toEnd ? { lte: range.toEnd } : {}),
              },
            }
          : {}),
      },
    },
    _sum: { amount: true },
  });
  const values = new Map<string, Decimal>();
  for (const row of rows) {
    const amount = row._sum.amount ?? new Decimal(0);
    const signed = creditNormal
      ? row.side === "credit" ? amount : amount.neg()
      : row.side === "debit" ? amount : amount.neg();
    values.set(row.accountId, (values.get(row.accountId) ?? new Decimal(0)).add(signed));
  }
  return values;
}

async function receivableSums(
  tx: Prisma.TransactionClient,
  organizationId: string,
  accountIds: string[],
  range?: { from?: Date | null; toEnd?: Date | null }
) {
  if (!accountIds.length) return { given: new Map<string, Decimal>(), repaid: new Map<string, Decimal>(), writeOff: new Map<string, Decimal>() };
  const [rows, openingAdjustments] = await Promise.all([tx.cashTransaction.groupBy({
    by: ["accountId", "category"],
    where: {
      organizationId,
      accountId: { in: accountIds },
      reversedAt: null,
      OR: [
        { flowType: "cash_out", category: "receivable_payment" },
        { flowType: "cash_in", category: "receivable_collection" },
        { flowType: "cash_out", category: "receivable_write_off" },
      ],
      ...(range?.from || range?.toEnd
        ? {
            transactionDate: {
              ...(range.from ? { gte: range.from } : {}),
              ...(range.toEnd ? { lte: range.toEnd } : {}),
            },
          }
        : {}),
    },
    _sum: { amount: true },
  }), openingBalanceAccountAdjustments(tx, organizationId, accountIds, range)]);
  const given = new Map<string, Decimal>();
  const repaid = new Map<string, Decimal>();
  const writeOff = new Map<string, Decimal>();
  for (const row of rows) {
    const target = row.category === "receivable_payment" ? given : row.category === "receivable_collection" ? repaid : writeOff;
    target.set(row.accountId, row._sum?.amount ?? new Decimal(0));
  }
  for (const [accountId, amount] of openingAdjustments) {
    if (amount.gte(0)) given.set(accountId, (given.get(accountId) ?? new Decimal(0)).add(amount));
    else repaid.set(accountId, (repaid.get(accountId) ?? new Decimal(0)).add(amount.abs()));
  }
  return { given, repaid, writeOff };
}

function receivableBalance(given?: Decimal, repaid?: Decimal, writeOff?: Decimal) {
  return (given ?? new Decimal(0)).sub(repaid ?? new Decimal(0)).sub(writeOff ?? new Decimal(0));
}

function payableAccountTypeLabel(subtype?: AccountingAssetSubtype | null) {
  if (subtype === "loan_payable") return "Borrowing";
  if (subtype === "service_payable") return "Service";
  return "Payable";
}

function payableAccountWhere(status: string | null, search: string, type: string | null): Prisma.AccountingAccountWhereInput {
  return {
    accountType: "liability",
    assetSubtype: type === "loan_payable" || type === "service_payable" ? type : { in: payableSubtypes },
    AND: [{ OR: [{ systemKey: null }, { systemKey: { not: "liability_member_credit" } }] }],
    ...(status === "closed"
      ? { OR: [{ isActive: false }, { closedAt: { not: null } }] }
      : status === "all"
        ? {}
        : { isActive: true, closedAt: null }),
    ...(search ? { name: { contains: search, mode: "insensitive" } } : {}),
  };
}

async function payableSums(
  tx: Prisma.TransactionClient,
  organizationId: string,
  accountIds: string[],
  range?: { from?: Date | null; toEnd?: Date | null }
) {
  if (!accountIds.length) return { borrowed: new Map<string, Decimal>(), settled: new Map<string, Decimal>() };
  const [rows, openingAdjustments] = await Promise.all([tx.cashTransaction.groupBy({
    by: ["accountId", "category"],
    where: {
      organizationId,
      accountId: { in: accountIds },
      reversedAt: null,
      OR: [
        { flowType: "cash_in", category: { in: payableBorrowingCategories } },
        { flowType: "cash_out", category: { in: payableRepaymentCategories } },
      ],
      ...(range?.from || range?.toEnd
        ? { transactionDate: { ...(range.from ? { gte: range.from } : {}), ...(range.toEnd ? { lte: range.toEnd } : {}) } }
        : {}),
    },
    _sum: { amount: true },
  }), openingBalanceAccountAdjustments(tx, organizationId, accountIds, range, true)]);
  const borrowed = new Map<string, Decimal>();
  const settled = new Map<string, Decimal>();
  for (const row of rows) {
    const target = payableBorrowingCategories.includes(row.category) ? borrowed : settled;
    target.set(row.accountId, row._sum?.amount ?? new Decimal(0));
  }
  for (const [accountId, amount] of openingAdjustments) {
    if (amount.gte(0)) borrowed.set(accountId, (borrowed.get(accountId) ?? new Decimal(0)).add(amount));
    else settled.set(accountId, (settled.get(accountId) ?? new Decimal(0)).add(amount.abs()));
  }
  return { borrowed, settled };
}

function payableBalance(borrowed?: Decimal, settled?: Decimal) {
  return (borrowed ?? new Decimal(0)).sub(settled ?? new Decimal(0));
}

async function buildPayableRows(
  tx: Prisma.TransactionClient,
  organizationId: string,
  input: { from: Date; toEnd: Date; search: string; type: string | null; status: string | null; sort: string }
) {
  const accounts = await tx.accountingAccount.findMany({
    where: { organizationId, ...payableAccountWhere(input.status, input.search, input.type) },
    orderBy: { name: "asc" },
  });
  const ids = accounts.map((account) => account.id);
  const openingEnd = new Date(input.from.getTime() - 1);
  const [opening, period] = await Promise.all([
    payableSums(tx, organizationId, ids, { toEnd: openingEnd }),
    payableSums(tx, organizationId, ids, { from: input.from, toEnd: input.toEnd }),
  ]);
  const rows = accounts.map((account) => {
    const openingBalance = payableBalance(opening.borrowed.get(account.id), opening.settled.get(account.id));
    const totalBorrowed = period.borrowed.get(account.id) ?? new Decimal(0);
    const totalSettled = period.settled.get(account.id) ?? new Decimal(0);
    return {
      id: account.id,
      name: account.name,
      accountType: payableAccountTypeLabel(account.assetSubtype),
      assetSubtype: account.assetSubtype,
      counterpartyName: account.counterpartyName,
      counterpartyPhone: account.counterpartyPhone,
      openingBalance: asNumber(openingBalance),
      totalBorrowed: asNumber(totalBorrowed),
      totalSettled: asNumber(totalSettled),
      outstandingBalance: asNumber(openingBalance.add(totalBorrowed).sub(totalSettled)),
      status: account.isActive && !account.closedAt ? "active" : "closed",
    };
  });
  rows.sort((a, b) => {
    if (input.sort === "outstanding_desc") return b.outstandingBalance - a.outstandingBalance;
    if (input.sort === "borrowed_desc") return b.totalBorrowed - a.totalBorrowed;
    if (input.sort === "settled_desc") return b.totalSettled - a.totalSettled;
    return a.name.localeCompare(b.name);
  });
  return rows;
}

async function payableDetail(tx: Prisma.TransactionClient, organizationId: string, accountId: string, from: Date, toEnd: Date) {
  const account = await tx.accountingAccount.findFirst({
    where: { id: accountId, organizationId, accountType: "liability", assetSubtype: { in: payableSubtypes } },
    include: { counterpartyMembership: { select: { id: true, membershipNo: true, hod: { select: { fullName: true, nameWithInitials: true } } } } },
  });
  if (!account) return null;
  const [opening, period, history] = await Promise.all([
    payableSums(tx, organizationId, [account.id], { toEnd: new Date(from.getTime() - 1) }),
    payableSums(tx, organizationId, [account.id], { from, toEnd }),
    tx.cashTransaction.findMany({
      where: {
        organizationId,
        accountId: account.id,
        OR: [
          { flowType: "cash_in", category: { in: payableBorrowingCategories } },
          { flowType: "cash_out", category: { in: payableRepaymentCategories } },
        ],
        transactionDate: { gte: from, lte: toEnd },
      },
      include: {
        cashBankAccount: { select: { id: true, name: true, assetSubtype: true } },
        counterpartyMembership: { select: { id: true, membershipNo: true, hod: { select: { fullName: true, nameWithInitials: true } } } },
        createdBy: { select: { email: true } },
        reversedBy: { select: { email: true } },
      },
      orderBy: [{ transactionDate: "asc" }, { createdAt: "asc" }],
      take: 300,
    }),
  ]);
  const openingBalance = payableBalance(opening.borrowed.get(account.id), opening.settled.get(account.id));
  let runningBalance = openingBalance;
  const serializedHistory = history.map((transaction) => {
    if (!transaction.reversedAt) {
      runningBalance = payableBorrowingCategories.includes(transaction.category)
        ? runningBalance.add(transaction.amount)
        : runningBalance.sub(transaction.amount);
    }
    return {
      ...serializeCashTransaction(transaction),
      transactionLabel: payableBorrowingCategories.includes(transaction.category) ? "Borrowed" : "Settled",
      paymentMethod: transaction.cashBankAccount?.name ?? null,
      balance: asNumber(runningBalance),
      status: transaction.reversedAt ? "reversed" : "posted",
    };
  }).reverse();
  const totalBorrowed = period.borrowed.get(account.id) ?? new Decimal(0);
  const totalSettled = period.settled.get(account.id) ?? new Decimal(0);
  return {
    account: { ...serializeAccount(account), accountTypeLabel: payableAccountTypeLabel(account.assetSubtype), status: account.isActive && !account.closedAt ? "active" : "closed", closedAt: account.closedAt?.toISOString?.() ?? null },
    fromDate: from.toISOString(),
    toDate: toEnd.toISOString(),
    summary: {
      totalBorrowed: asNumber(totalBorrowed),
      totalSettled: asNumber(totalSettled),
      outstandingBalance: asNumber(openingBalance.add(totalBorrowed).sub(totalSettled)),
    },
    history: serializedHistory,
  };
}

async function buildReceivableRows(
  tx: Prisma.TransactionClient,
  organizationId: string,
  input: { from: Date; toEnd: Date; search: string; type: string | null; status: string | null; sort: string }
) {
  const accounts = await tx.accountingAccount.findMany({
    where: {
      organizationId,
      ...receivableAccountWhere(input.status, input.search, input.type),
    },
    orderBy: { name: "asc" },
  });
  const ids = accounts.map((account) => account.id);
  const openingEnd = new Date(input.from.getTime() - 1);
  const [
    { given: openingGiven, repaid: openingRepaid, writeOff: openingWriteOffs },
    { given: periodGiven, repaid: periodRepaid, writeOff: periodWriteOffs },
  ] = await Promise.all([
    receivableSums(tx, organizationId, ids, { toEnd: openingEnd }),
    receivableSums(tx, organizationId, ids, { from: input.from, toEnd: input.toEnd }),
  ]);

  const rows = accounts.map((account) => {
    const openingBalance = receivableBalance(openingGiven.get(account.id), openingRepaid.get(account.id), openingWriteOffs.get(account.id));
    const totalGiven = periodGiven.get(account.id) ?? new Decimal(0);
    const totalRepaid = periodRepaid.get(account.id) ?? new Decimal(0);
    const periodWriteOff = periodWriteOffs.get(account.id) ?? new Decimal(0);
    const outstandingBalance = openingBalance.add(totalGiven).sub(totalRepaid).sub(periodWriteOff);
    return {
      id: account.id,
      name: account.name,
      accountType: receivableAccountTypeLabel(account.assetSubtype),
      assetSubtype: account.assetSubtype,
      counterpartyName: account.counterpartyName,
      counterpartyPhone: account.counterpartyPhone,
      openingBalance: asNumber(openingBalance),
      totalGiven: asNumber(totalGiven),
      totalRepaid: asNumber(totalRepaid),
      outstandingBalance: asNumber(outstandingBalance),
      status: account.isActive && !account.closedAt ? "active" : "closed",
    };
  });

  rows.sort((a, b) => {
    if (input.sort === "outstanding_desc") return b.outstandingBalance - a.outstandingBalance;
    if (input.sort === "given_desc") return b.totalGiven - a.totalGiven;
    if (input.sort === "repaid_desc") return b.totalRepaid - a.totalRepaid;
    return a.name.localeCompare(b.name);
  });

  return rows;
}

async function receivableDetail(tx: Prisma.TransactionClient, organizationId: string, accountId: string, from: Date, toEnd: Date) {
  const account = await tx.accountingAccount.findFirst({
    where: { id: accountId, organizationId, accountType: "asset", assetSubtype: { in: receivableSubtypes } },
    include: { counterpartyMembership: { select: { id: true, membershipNo: true, hod: { select: { fullName: true, nameWithInitials: true } } } } },
  });
  if (!account) return null;

  const [
    { given: openingGiven, repaid: openingRepaid, writeOff: openingWriteOffs },
    { given: periodGiven, repaid: periodRepaid, writeOff: periodWriteOffs },
    history,
  ] = await Promise.all([
    receivableSums(tx, organizationId, [account.id], { toEnd: new Date(from.getTime() - 1) }),
    receivableSums(tx, organizationId, [account.id], { from, toEnd }),
    tx.cashTransaction.findMany({
      where: {
        organizationId,
        accountId: account.id,
        OR: [
          { flowType: "cash_out", category: "receivable_payment" },
          { flowType: "cash_in", category: "receivable_collection" },
          { flowType: "cash_out", category: "receivable_write_off" },
        ],
        transactionDate: { gte: from, lte: toEnd },
      },
      include: {
        cashBankAccount: { select: { id: true, name: true, assetSubtype: true } },
        counterpartyMembership: { select: { id: true, membershipNo: true, hod: { select: { fullName: true, nameWithInitials: true } } } },
        createdBy: { select: { email: true } },
        reversedBy: { select: { email: true } },
      },
      orderBy: [{ transactionDate: "asc" }, { createdAt: "asc" }],
      take: 300,
    }),
  ]);

  const openingBalance = receivableBalance(openingGiven.get(account.id), openingRepaid.get(account.id), openingWriteOffs.get(account.id));
  let runningBalance = openingBalance;
  const serializedHistory = history.map((transaction) => {
    if (!transaction.reversedAt) {
      runningBalance = transaction.category === "receivable_payment"
        ? runningBalance.add(transaction.amount)
        : runningBalance.sub(transaction.amount);
    }
    const transactionLabel =
      transaction.category === "receivable_payment"
        ? "Given"
        : transaction.category === "receivable_collection"
          ? "Repaid"
          : "Write Off";
    return {
      ...serializeCashTransaction(transaction),
      transactionLabel,
      paymentMethod: transaction.category === "receivable_write_off" ? "Bad Debt Write-Off Expense" : transaction.cashBankAccount?.name ?? null,
      balance: asNumber(runningBalance),
      status: transaction.reversedAt ? "reversed" : "posted",
    };
  }).reverse();

  const totalGiven = periodGiven.get(account.id) ?? new Decimal(0);
  const totalRepaid = periodRepaid.get(account.id) ?? new Decimal(0);
  const totalWriteOff = periodWriteOffs.get(account.id) ?? new Decimal(0);
  return {
    account: {
      ...serializeAccount(account),
      accountTypeLabel: receivableAccountTypeLabel(account.assetSubtype),
      status: account.isActive && !account.closedAt ? "active" : "closed",
      closedAt: account.closedAt?.toISOString?.() ?? null,
    },
    fromDate: from.toISOString(),
    toDate: toEnd.toISOString(),
    summary: {
      totalGiven: asNumber(totalGiven),
      totalRepaid: asNumber(totalRepaid),
      outstandingBalance: asNumber(openingBalance.add(totalGiven).sub(totalRepaid).sub(totalWriteOff)),
    },
    history: serializedHistory,
  };
}

async function cashAccountRows(
  tx: Prisma.TransactionClient,
  organizationId: string,
  flowType: CashFlowType,
  category: CashTransactionCategoryFilter,
  from: Date,
  toEnd: Date,
  search?: string
) {
  const accounts = await tx.accountingAccount.findMany({
    where: {
      organizationId,
      isActive: true,
      ...cashAccountWhere(flowType, category),
      ...(flowType === "cash_in" && category === "operating_income"
        ? { NOT: { systemKey: "income_other" } }
        : {}),
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

async function cashFundRows(
  tx: Prisma.TransactionClient,
  organizationId: string,
  flowType: CashFlowType,
  from: Date,
  toEnd: Date,
  search?: string
) {
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

async function buildCashFlowOverview(req: Request, res: Response, flowType: CashFlowType) {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ error: "Organization scope required" });
  const { from, toEnd } = cashFlowRange(req.query);
  const search = typeof req.query.q === "string" ? req.query.q.trim() : "";

  const sections = flowType === "cash_in"
    ? [
        { key: "operating_income" as const, title: "Operating Income" },
        { key: "project_fund_collection" as const, title: "Special Fund Collections" },
        { key: "receivable_collection" as const, title: "Receivable Collection" },
      ]
    : [
        { key: "operating_expense" as const, title: "Operating Expenses" },
        { key: "project_fund_expense" as const, title: "Special Fund Expenses" },
        { key: "payable_repayment" as const, title: "Payable Repayments" },
      ];

  const data = await prisma.$transaction(async (tx) => {
    await ensureDefaultAccountingAccounts(tx, orgId);
    const operatingCategory = flowType === "cash_in" ? "operating_income" : "operating_expense";
    const balanceCategory = flowType === "cash_in" ? "receivable_collection" : payableRepaymentCategories;
    const [operatingRows, fundRows, balanceRows] = await Promise.all([
      cashAccountRows(tx, orgId, flowType, operatingCategory, from, toEnd, search),
      cashFundRows(tx, orgId, flowType, from, toEnd, search),
      cashAccountRows(tx, orgId, flowType, balanceCategory, from, toEnd, search),
    ]);
    const rowsByKey: Record<string, Array<{ periodTotal: number }>> = flowType === "cash_in"
      ? { operating_income: operatingRows, project_fund_collection: fundRows, receivable_collection: balanceRows }
      : { operating_expense: operatingRows, project_fund_expense: fundRows, payable_repayment: balanceRows };
    return sections.map((section) => {
      const rows = rowsByKey[section.key] ?? [];
      return {
        ...section,
        rows,
        total: Number(rows.reduce((sum, row) => sum + row.periodTotal, 0).toFixed(2)),
      };
    });
  });

  const totals = data.reduce(
    (sum, section) => ({
      periodTotal: sum.periodTotal + section.total,
      accountCount: sum.accountCount + section.rows.length,
    }),
    { periodTotal: 0, accountCount: 0 }
  );

  return res.json({
    flowType,
    fromDate: from.toISOString(),
    toDate: toEnd.toISOString(),
    sections: data,
    totals: { ...totals, periodTotal: Number(totals.periodTotal.toFixed(2)) },
  });
}

async function loadCashAccountDetail(req: Request, res: Response, flowType: CashFlowType) {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ error: "Organization scope required" });
  const { from, toEnd } = cashFlowRange(req.query);

  const account = await prisma.accountingAccount.findFirst({
    where: { id: req.params.id, organizationId: orgId },
  });
  if (!account) return res.status(404).json({ error: "Account not found" });

  const detailCategory =
    isReceivableSubtype(account.assetSubtype)
      ? "receivable_collection"
      : isPayableSubtype(account.assetSubtype)
        ? payableRepaymentCategories
        : flowType === "cash_in"
          ? "operating_income"
          : "operating_expense";
  const oppositeCategory =
    isReceivableSubtype(account.assetSubtype)
      ? "receivable_payment" as const
      : isPayableSubtype(account.assetSubtype)
        ? payableBorrowingCategories
        : null;
  const historyWhere: Prisma.CashTransactionWhereInput =
    isReceivableSubtype(account.assetSubtype)
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
              { flowType: "cash_out", category: { in: payableRepaymentCategories } },
              { flowType: "cash_in", category: { in: payableBorrowingCategories } },
            ],
            transactionDate: { gte: from, lte: toEnd },
          }
        : {
            organizationId: orgId,
            accountId: account.id,
            flowType,
            transactionDate: { gte: from, lte: toEnd },
          };

  const [allTotals, postedPeriod, postedMonth, postedAll, oppositePeriod, oppositeMonth, oppositeAll, history] = await prisma.$transaction(async (tx) => Promise.all([
    groupedAccountTotals(tx, orgId, [account.id], null, null),
    cashTransactionAmount(tx, orgId, { accountId: account.id, flowType, category: detailCategory, from, toEnd }),
    cashTransactionAmount(tx, orgId, { accountId: account.id, flowType, category: detailCategory, from: firstOfMonth(), toEnd: endOfDay(new Date()) }),
    cashTransactionAmount(tx, orgId, { accountId: account.id, flowType, category: detailCategory }),
    oppositeCategory
      ? cashTransactionAmount(tx, orgId, { accountId: account.id, flowType: flowType === "cash_in" ? "cash_out" : "cash_in", category: oppositeCategory, from, toEnd })
      : Promise.resolve({ amount: new Decimal(0), count: 0 }),
    oppositeCategory
      ? cashTransactionAmount(tx, orgId, { accountId: account.id, flowType: flowType === "cash_in" ? "cash_out" : "cash_in", category: oppositeCategory, from: firstOfMonth(), toEnd: endOfDay(new Date()) })
      : Promise.resolve({ amount: new Decimal(0), count: 0 }),
    oppositeCategory
      ? cashTransactionAmount(tx, orgId, { accountId: account.id, flowType: flowType === "cash_in" ? "cash_out" : "cash_in", category: oppositeCategory })
      : Promise.resolve({ amount: new Decimal(0), count: 0 }),
    tx.cashTransaction.findMany({
      where: historyWhere,
      include: {
        cashBankAccount: { select: { id: true, name: true, assetSubtype: true } },
        counterpartyMembership: { select: { id: true, membershipNo: true, hod: { select: { fullName: true, nameWithInitials: true } } } },
        createdBy: { select: { email: true } },
        reversedBy: { select: { email: true } },
      },
      orderBy: [{ transactionDate: "desc" }, { createdAt: "desc" }],
      take: 100,
    }),
  ]));

  const all = allTotals.get(account.id) ?? { debit: new Decimal(0), credit: new Decimal(0) };
  const summary =
    account.accountType === "asset" && isReceivableSubtype(account.assetSubtype)
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
            totalBorrowed: asNumber(oppositeAll.amount),
            totalRepaid: asNumber(postedAll.amount),
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

async function createCashTransaction(
  req: Request,
  res: Response,
  flowType: CashFlowType,
  category: CashTransactionCategory
) {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ error: "Organization scope required" });
  const parsed = cashTransactionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  }

  const amount = new Decimal(parsed.data.amount);
  const transactionDate = parsed.data.transactionDate ? new Date(parsed.data.transactionDate) : new Date();

  const transaction = await prisma.$transaction(async (tx) => {
    await ensureDefaultAccountingAccounts(tx, orgId);
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
    if (!account) throw new Error("Selected account is not valid for this cash flow");
    if (!cashBankAccount) throw new Error("Payment method must be an active cash/bank account");

    let counterpartyPhone = parsed.data.counterpartyPhone ?? null;
    if (parsed.data.counterpartyMembershipId) {
      const membership = await tx.membership.findFirst({
        where: { id: parsed.data.counterpartyMembershipId, organizationId: orgId },
        select: { id: true, hod: { select: { mobileNumber: true, whatsAppNumber: true } } },
      });
      if (!membership) throw new Error("Selected member was not found");
      counterpartyPhone = counterpartyPhone || membership.hod?.mobileNumber || membership.hod?.whatsAppNumber || null;
    }

    const documentNumber = await generateCashDocumentNumber(tx, orgId, flowType, transactionDate);
    const label = cashTransactionLabel(category);
    const description = parsed.data.description || `${label}: ${account.name}`;
    const lines =
      flowType === "cash_in"
        ? [
            { accountId: cashBankAccount.id, side: "debit" as const, amount, memo: parsed.data.reference ?? null },
            { accountId: account.id, side: "credit" as const, amount, memo: parsed.data.reference ?? null },
          ]
        : [
            { accountId: account.id, side: "debit" as const, amount, memo: parsed.data.reference ?? null },
            { accountId: cashBankAccount.id, side: "credit" as const, amount, memo: parsed.data.reference ?? null },
          ];

    const journalEntry = await createJournalEntry(tx, {
      organizationId: orgId,
      entryDate: transactionDate,
      entryType: category === "operating_expense" ? "expense" : "manual_adjustment",
      description,
      referenceType: category,
      isSystemEntry: false,
      createdByUserId: req.auth!.userId,
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
        createdByUserId: req.auth!.userId,
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

function serializeFundPot(fund: any, summary?: any) {
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

  const account = await prisma.$transaction(async (tx) => {
    const created = await tx.accountingAccount.create({
      data: {
        organizationId: orgId,
        name: parsed.data.name,
        accountType: parsed.data.accountType,
        assetSubtype: parsed.data.assetSubtype ?? defaultAccountSubtype(parsed.data.accountType),
        description: parsed.data.description ?? null,
        createdByUserId: req.auth!.userId,
      },
    });
    await writeAuditLog(tx, {
      organizationId: orgId,
      actorUserId: req.auth!.userId,
      action: "finance.account.created",
      entityType: "accounting_account",
      entityId: created.id,
      summary: `Created account ${created.name}`,
      metadata: { accountType: created.accountType, assetSubtype: created.assetSubtype },
    });
    return created;
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
  if (parsed.data.name && parsed.data.name !== account.name && !isAccountNameEditable(account)) {
    return res.status(409).json({ error: "System-managed accounts cannot be renamed" });
  }
  if (parsed.data.assetSubtype !== undefined && !accountSubtypesByType[account.accountType].includes(parsed.data.assetSubtype)) {
    return res.status(400).json({ error: "Selected subtype does not match the account type" });
  }

  const lineCount = await prisma.accountingJournalLine.count({ where: { accountId: account.id } });
  if (lineCount > 0 && parsed.data.isActive === false && account.systemKey) {
    return res.status(409).json({ error: "System accounts with activity cannot be archived" });
  }

  if (parsed.data.name && parsed.data.name !== account.name) {
    const duplicate = await prisma.accountingAccount.findFirst({
      where: {
        organizationId: account.organizationId,
        id: { not: account.id },
        name: { equals: parsed.data.name, mode: "insensitive" },
      },
      select: { id: true },
    });
    if (duplicate) return res.status(409).json({ error: "An account with this name already exists" });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.accountingAccount.update({
      where: { id: account.id },
      data: {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.assetSubtype !== undefined ? { assetSubtype: parsed.data.assetSubtype } : {}),
        ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
        ...(parsed.data.isActive !== undefined ? { isActive: parsed.data.isActive } : {}),
      },
    });
    await writeAuditLog(tx, {
      organizationId: account.organizationId,
      actorUserId: req.auth!.userId,
      action: "finance.account.updated",
      entityType: "accounting_account",
      entityId: account.id,
      summary: `Updated account ${next.name}`,
      metadata: { changedFields: Object.keys(parsed.data) },
    });
    return next;
  });

  return res.json(updated);
}));

accountingRouter.get("/cash-in/overview", asyncRoute((req, res) => buildCashFlowOverview(req, res, "cash_in")));
accountingRouter.get("/cash-out/overview", asyncRoute((req, res) => buildCashFlowOverview(req, res, "cash_out")));

accountingRouter.get("/cash-in/accounts/:id", asyncRoute((req, res) => loadCashAccountDetail(req, res, "cash_in")));
accountingRouter.get("/cash-out/accounts/:id", asyncRoute((req, res) => loadCashAccountDetail(req, res, "cash_out")));

accountingRouter.get("/receivables/overview", asyncRoute(async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ error: "Organization scope required" });
  const { from, toEnd } = cashFlowRange(req.query);
  const search = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const type = typeof req.query.type === "string" && req.query.type !== "all" ? req.query.type : null;
  const status = typeof req.query.status === "string" ? req.query.status : "active";
  const sort = typeof req.query.sort === "string" ? req.query.sort : "name_asc";

  const rows = await prisma.$transaction(async (tx) => {
    await ensureDefaultAccountingAccounts(tx, orgId);
    return buildReceivableRows(tx, orgId, { from, toEnd, search, type, status, sort });
  });

  const totals = rows.reduce((sum, row) => ({
    openingBalance: sum.openingBalance + row.openingBalance,
    totalGiven: sum.totalGiven + row.totalGiven,
    totalRepaid: sum.totalRepaid + row.totalRepaid,
    outstandingBalance: sum.outstandingBalance + row.outstandingBalance,
  }), { openingBalance: 0, totalGiven: 0, totalRepaid: 0, outstandingBalance: 0 });

  return res.json({
    fromDate: from.toISOString(),
    toDate: toEnd.toISOString(),
    totals: {
      openingBalance: Number(totals.openingBalance.toFixed(2)),
      totalGiven: Number(totals.totalGiven.toFixed(2)),
      totalRepaid: Number(totals.totalRepaid.toFixed(2)),
      outstandingBalance: Number(totals.outstandingBalance.toFixed(2)),
    },
    rows,
  });
}));

accountingRouter.post("/receivables", requireAccountingAdmin, asyncRoute(async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ error: "Organization scope required" });
  const parsed = createReceivableSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  }

  const account = await prisma.$transaction(async (tx) => {
    await ensureDefaultAccountingAccounts(tx, orgId);
    const duplicate = await tx.accountingAccount.findFirst({
      where: { organizationId: orgId, name: { equals: parsed.data.name, mode: "insensitive" } },
      select: { id: true },
    });
    if (duplicate) {
      const error = new Error("An account with this name already exists");
      (error as any).statusCode = 409;
      throw error;
    }
    if (parsed.data.counterpartyMembershipId) {
      const member = await tx.membership.findFirst({
        where: { id: parsed.data.counterpartyMembershipId, organizationId: orgId },
        select: { id: true },
      });
      if (!member) {
        const error = new Error("Selected member was not found");
        (error as any).statusCode = 400;
        throw error;
      }
    }
    const created = await tx.accountingAccount.create({
      data: {
        organizationId: orgId,
        name: parsed.data.name,
        accountType: "asset",
        assetSubtype: parsed.data.assetSubtype,
        counterpartyName: parsed.data.counterpartyName || null,
        counterpartyPhone: parsed.data.counterpartyPhone || null,
        counterpartyMembershipId: parsed.data.counterpartyMembershipId || null,
        description: parsed.data.description || null,
        createdByUserId: req.auth!.userId,
      },
    });
    await writeAuditLog(tx, {
      organizationId: orgId,
      actorUserId: req.auth!.userId,
      action: "finance.receivable.created",
      entityType: "accounting_account",
      entityId: created.id,
      summary: `Created receivable ${created.name}`,
      metadata: { assetSubtype: created.assetSubtype, counterpartyMembershipId: created.counterpartyMembershipId },
    });
    return created;
  });

  return res.status(201).json(serializeAccount(account));
}));

accountingRouter.get("/receivables/:id", asyncRoute(async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ error: "Organization scope required" });
  const { from, toEnd } = cashFlowRange(req.query);
  const detail = await prisma.$transaction((tx) => receivableDetail(tx, orgId, req.params.id, from, toEnd));
  if (!detail) return res.status(404).json({ error: "Receivable account not found" });
  return res.json(detail);
}));

accountingRouter.post("/receivables/:id/close", requireAccountingAdmin, asyncRoute(async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ error: "Organization scope required" });

  const result = await prisma.$transaction(async (tx) => {
    await ensureDefaultAccountingAccounts(tx, orgId);
    const account = await tx.accountingAccount.findFirst({
      where: { id: req.params.id, organizationId: orgId, accountType: "asset", assetSubtype: { in: receivableSubtypes } },
    });
    if (!account) throw new Error("Receivable account not found");
    if (!account.isActive || account.closedAt) throw new Error("Receivable account is already closed");

    const { given, repaid, writeOff } = await receivableSums(tx, orgId, [account.id]);
    const outstanding = receivableBalance(given.get(account.id), repaid.get(account.id), writeOff.get(account.id));
    if (outstanding.lt(0)) {
      const amount = asNumber(outstanding.abs());
      const error = new Error(`This account has an overpayment of Rs. ${amount.toFixed(2)}. Please refund the overpayment before closing the account`);
      (error as any).statusCode = 409;
      throw error;
    }

    let journalEntryId: string | null = null;
    if (outstanding.gt(0)) {
      const badDebt = await getSystemAccount(tx, orgId, BAD_DEBT_EXPENSE_KEY);
      const cashOnHand = await getSystemAccount(tx, orgId, "asset_cash_on_hand");
      const transactionDate = new Date();
      const documentNumber = await generateReceivableWriteOffDocumentNumber(tx, orgId, transactionDate);
      const entry = await createJournalEntry(tx, {
        organizationId: orgId,
        entryDate: transactionDate,
        entryType: "expense",
        description: `Bad debt write-off: ${account.name}`,
        referenceType: "receivable_write_off",
        referenceId: account.id,
        isSystemEntry: true,
        createdByUserId: req.auth!.userId,
        lines: [
          { accountId: badDebt.id, side: "debit", amount: outstanding, memo: account.name },
          { accountId: account.id, side: "credit", amount: outstanding, memo: "Receivable account closure" },
        ],
      });
      const writeOffTransaction = await tx.cashTransaction.create({
        data: {
          organizationId: orgId,
          flowType: "cash_out",
          category: "receivable_write_off",
          accountId: account.id,
          cashBankAccountId: cashOnHand.id,
          amount: outstanding,
          transactionDate,
          counterpartyName: account.name,
          counterpartyPhone: account.counterpartyPhone ?? null,
          counterpartyMembershipId: account.counterpartyMembershipId ?? null,
          reference: `Bad debt write-off for ${account.name}`,
          description: `Write off ${account.name}`,
          documentNumber,
          journalEntryId: entry.id,
          createdByUserId: req.auth!.userId,
        },
      });
      await tx.accountingJournalEntry.update({
        where: { id: entry.id },
        data: { referenceId: writeOffTransaction.id },
      });
      journalEntryId = entry.id;
    }

    const updated = await tx.accountingAccount.update({
      where: { id: account.id },
      data: { isActive: false, closedAt: new Date() },
    });
    await writeAuditLog(tx, {
      organizationId: orgId,
      actorUserId: req.auth!.userId,
      action: "finance.receivable.closed",
      entityType: "accounting_account",
      entityId: account.id,
      summary: `Closed receivable ${account.name}`,
      metadata: { writtenOffAmount: outstanding.gt(0) ? outstanding.toFixed(2) : "0.00" },
    });
    return { account: serializeAccount(updated), outstandingBalance: asNumber(outstanding.gt(0) ? new Decimal(0) : outstanding), journalEntryId };
  });

  return res.json(result);
}));

accountingRouter.get("/payables/overview", asyncRoute(async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ error: "Organization scope required" });
  const { from, toEnd } = cashFlowRange(req.query);
  const search = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const type = typeof req.query.type === "string" && req.query.type !== "all" ? req.query.type : null;
  const status = typeof req.query.status === "string" ? req.query.status : "active";
  const sort = typeof req.query.sort === "string" ? req.query.sort : "name_asc";
  const rows = await prisma.$transaction(async (tx) => {
    await ensureDefaultAccountingAccounts(tx, orgId);
    return buildPayableRows(tx, orgId, { from, toEnd, search, type, status, sort });
  });
  const totals = rows.reduce((sum, row) => ({
    openingBalance: sum.openingBalance + row.openingBalance,
    totalBorrowed: sum.totalBorrowed + row.totalBorrowed,
    totalSettled: sum.totalSettled + row.totalSettled,
    outstandingBalance: sum.outstandingBalance + row.outstandingBalance,
  }), { openingBalance: 0, totalBorrowed: 0, totalSettled: 0, outstandingBalance: 0 });
  return res.json({
    fromDate: from.toISOString(),
    toDate: toEnd.toISOString(),
    totals: Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, Number(value.toFixed(2))])),
    rows,
  });
}));

accountingRouter.post("/payables", requireAccountingAdmin, asyncRoute(async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ error: "Organization scope required" });
  const parsed = createPayableSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  const account = await prisma.$transaction(async (tx) => {
    await ensureDefaultAccountingAccounts(tx, orgId);
    const duplicate = await tx.accountingAccount.findFirst({
      where: { organizationId: orgId, name: { equals: parsed.data.name, mode: "insensitive" } },
      select: { id: true },
    });
    if (duplicate) {
      const error = new Error("An account with this name already exists");
      (error as any).statusCode = 409;
      throw error;
    }
    if (parsed.data.counterpartyMembershipId) {
      const member = await tx.membership.findFirst({ where: { id: parsed.data.counterpartyMembershipId, organizationId: orgId }, select: { id: true } });
      if (!member) {
        const error = new Error("Selected member was not found");
        (error as any).statusCode = 400;
        throw error;
      }
    }
    const created = await tx.accountingAccount.create({
      data: {
        organizationId: orgId,
        name: parsed.data.name,
        accountType: "liability",
        assetSubtype: parsed.data.assetSubtype,
        counterpartyName: parsed.data.counterpartyName || null,
        counterpartyPhone: parsed.data.counterpartyPhone || null,
        counterpartyMembershipId: parsed.data.counterpartyMembershipId || null,
        description: parsed.data.description || null,
        createdByUserId: req.auth!.userId,
      },
    });
    await writeAuditLog(tx, {
      organizationId: orgId,
      actorUserId: req.auth!.userId,
      action: "finance.payable.created",
      entityType: "accounting_account",
      entityId: created.id,
      summary: `Created payable ${created.name}`,
      metadata: { assetSubtype: created.assetSubtype, counterpartyMembershipId: created.counterpartyMembershipId },
    });
    return created;
  });
  return res.status(201).json(serializeAccount(account));
}));

accountingRouter.get("/payables/:id", asyncRoute(async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ error: "Organization scope required" });
  const { from, toEnd } = cashFlowRange(req.query);
  const detail = await prisma.$transaction((tx) => payableDetail(tx, orgId, req.params.id, from, toEnd));
  if (!detail) return res.status(404).json({ error: "Payable account not found" });
  return res.json(detail);
}));

accountingRouter.post("/payables/:id/close", requireAccountingAdmin, asyncRoute(async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ error: "Organization scope required" });
  const account = await prisma.$transaction(async (tx) => {
    const payable = await tx.accountingAccount.findFirst({
      where: { id: req.params.id, organizationId: orgId, accountType: "liability", assetSubtype: { in: payableSubtypes } },
    });
    if (!payable) throw new Error("Payable account not found");
    if (!payable.isActive || payable.closedAt) throw new Error("Payable account is already closed");
    const { borrowed, settled } = await payableSums(tx, orgId, [payable.id]);
    const outstanding = payableBalance(borrowed.get(payable.id), settled.get(payable.id));
    if (outstanding.gt(0)) {
      const error = new Error(`This account has an outstanding balance of Rs. ${outstanding.toFixed(2)}. Please settle it before closing the account`);
      (error as any).statusCode = 409;
      throw error;
    }
    if (outstanding.lt(0)) {
      const error = new Error(`This account has an overpayment of Rs. ${outstanding.abs().toFixed(2)}. Please correct it before closing the account`);
      (error as any).statusCode = 409;
      throw error;
    }
    const updated = await tx.accountingAccount.update({ where: { id: payable.id }, data: { isActive: false, closedAt: new Date() } });
    await writeAuditLog(tx, {
      organizationId: orgId,
      actorUserId: req.auth!.userId,
      action: "finance.payable.closed",
      entityType: "accounting_account",
      entityId: payable.id,
      summary: `Closed payable ${payable.name}`,
    });
    return updated;
  });
  return res.json({ account: serializeAccount(account) });
}));

accountingRouter.post("/cash-in/operating-income", requireAccountingAdmin, asyncRoute((req, res) =>
  createCashTransaction(req, res, "cash_in", "operating_income")
));

accountingRouter.post("/cash-in/receivable-collections", requireAccountingAdmin, asyncRoute((req, res) =>
  createCashTransaction(req, res, "cash_in", "receivable_collection")
));

accountingRouter.post("/cash-in/receivable-payments", requireAccountingAdmin, asyncRoute((req, res) =>
  createCashTransaction(req, res, "cash_out", "receivable_payment")
));

accountingRouter.post("/cash-out/operating-expenses", requireAccountingAdmin, asyncRoute((req, res) =>
  createCashTransaction(req, res, "cash_out", "operating_expense")
));

accountingRouter.post("/cash-in/payable-borrowings", requireAccountingAdmin, asyncRoute((req, res) =>
  createCashTransaction(req, res, "cash_in", "payable_borrowing")
));

accountingRouter.post("/cash-out/payable-repayments", requireAccountingAdmin, asyncRoute((req, res) =>
  createCashTransaction(req, res, "cash_out", "payable_repayment")
));

accountingRouter.post("/cash-out/payable-recoveries", requireAccountingAdmin, asyncRoute((req, res) =>
  createCashTransaction(req, res, "cash_in", "payable_borrowing")
));

accountingRouter.post("/cash-out/payable-payments", requireAccountingAdmin, asyncRoute((req, res) =>
  createCashTransaction(req, res, "cash_out", "payable_repayment")
));

accountingRouter.post("/cash-transactions/:id/reverse", requireAccountingAdmin, asyncRoute(async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ error: "Organization scope required" });
  const parsed = cashReverseSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const transaction = await tx.cashTransaction.findFirst({
      where: { id: req.params.id, organizationId: orgId },
      include: { account: true, journalEntry: { include: { lines: true } } },
    });
    if (!transaction) throw new Error("Cash transaction not found");
    if (transaction.reversedAt) throw new Error("Cash transaction is already reversed");
    if (!transaction.journalEntry) throw new Error("Original journal entry was not found");
    const accountRequiresActiveStatus = transaction.category === "receivable_payment"
      || transaction.category === "receivable_collection"
      || transaction.category === "receivable_write_off"
      || transaction.category === "payable_borrowing"
      || transaction.category === "payable_repayment"
      || transaction.category === "payable_payment"
      || transaction.category === "payable_recovery";
    if (accountRequiresActiveStatus && (!transaction.account?.isActive || transaction.account.closedAt)) {
      const error = new Error("Closed receivable and payable accounts cannot have entries reversed");
      (error as any).statusCode = 409;
      throw error;
    }

    const reversedAt = new Date();
    const reversalDocumentNumber = await generateCashReversalDocumentNumber(tx, orgId, reversedAt);

    await createJournalEntry(tx, {
      organizationId: orgId,
      entryDate: reversedAt,
      entryType: "manual_adjustment",
      description: `Cash transaction reversal ${reversalDocumentNumber}: ${parsed.data.reason}`,
      referenceType: "cash_transaction_reversal",
      referenceId: transaction.id,
      isSystemEntry: true,
      createdByUserId: req.auth!.userId,
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
        reversedAt,
        reversedByUserId: req.auth!.userId,
        reversalReason: parsed.data.reason,
        reversalDocumentNumber,
      },
      include: { account: true, cashBankAccount: true, reversedBy: { select: { email: true } } },
    });
  });

  return res.json(serializeCashTransaction(updated));
}));

accountingRouter.get("/cash-transactions/:id/receipt", asyncRoute(async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ error: "Organization scope required" });
  const reversal = req.query.type === "reversal";

  const transaction = await prisma.cashTransaction.findFirst({
    where: { id: req.params.id, organizationId: orgId },
    include: {
      organization: { select: { name: true, receiptLogoUrl: true } },
      account: { select: { name: true } },
      cashBankAccount: { select: { name: true } },
      createdBy: { select: { email: true } },
      reversedBy: { select: { email: true } },
    },
  });
  if (!transaction) return res.status(404).json({ error: "Cash transaction not found" });
  if (reversal && (!transaction.reversalDocumentNumber || !transaction.reversedAt)) {
    return res.status(404).json({ error: "Reversal receipt not found" });
  }
  if (!reversal && !transaction.documentNumber) {
    return res.status(404).json({ error: "Cash transaction receipt not found" });
  }

  return res.json(buildCashTransactionReceipt(
    transaction,
    reversal ? transaction.reversedBy?.email ?? null : transaction.createdBy?.email ?? null,
    reversal
  ));
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

  const rows = funds.map((fund) => serializeFundPot(fund, summarizeFundTransactions(fund.transactions, from, toEnd)));

  return res.json(rows);
}));

accountingRouter.get("/reports/fund-summary", asyncRoute(async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ error: "Organization scope required" });

  const status = req.query.status === "active" || req.query.status === "closed" ? req.query.status : null;
  const fundId = typeof req.query.fundId === "string" && req.query.fundId.trim() ? req.query.fundId : null;
  const range = fundReportRange(req.query);

  const funds = await prisma.fundPot.findMany({
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

  const totals = rows.reduce(
    (sum, row) => ({
      openingBalance: sum.openingBalance + row.openingBalance,
      totalCollected: sum.totalCollected + row.totalCollected,
      totalSpent: sum.totalSpent + row.totalSpent,
      totalTransferred: sum.totalTransferred + row.totalTransferred,
      remainingBalance: sum.remainingBalance + row.remainingBalance,
    }),
    { openingBalance: 0, totalCollected: 0, totalSpent: 0, totalTransferred: 0, remainingBalance: 0 }
  );

  return res.json({
    rows,
    totals,
    period: range.period,
    fromDate: range.from?.toISOString?.() ?? null,
    toDate: range.toEnd?.toISOString?.() ?? null,
  });
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
  const periodStart = parsed.data.periodStart ? startOfDay(new Date(parsed.data.periodStart)) : null;
  const periodEnd = parsed.data.periodEnd ? endOfDay(new Date(parsed.data.periodEnd)) : null;

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
        assetSubtype: "project_fund",
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
        assetSubtype: "project_fund_surplus",
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
        assetSubtype: "project_fund_deficit",
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
        managerName: parsed.data.managerName ?? null,
        periodStart,
        periodEnd,
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

    const result = await tx.fundPot.findUniqueOrThrow({
      where: { id: createdFund.id },
      include: { fundAccount: true, surplusAccount: true, deficitAccount: true, transactions: true },
    });
    await writeAuditLog(tx, {
      organizationId: orgId,
      actorUserId: req.auth!.userId,
      action: "finance.fund.created",
      entityType: "fund_pot",
      entityId: createdFund.id,
      summary: `Created special fund ${createdFund.name}`,
      metadata: { openingBalance: openingBalance.toFixed(2) },
    });
    return result;
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

  return res.json(serializeFundPot(fund, summarizeFundTransactions(fund.transactions)));
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
    let memberPhone = parsed.data.paidByPhone ?? null;
    if (parsed.data.paidByMembershipId) {
      const member = await tx.membership.findFirst({
        where: { id: parsed.data.paidByMembershipId, organizationId: orgId },
        select: {
          id: true,
          hod: { select: { mobileNumber: true, whatsAppNumber: true } },
        },
      });
      if (!member) throw new Error("Selected member was not found");
      memberPhone = memberPhone || member.hod?.mobileNumber || member.hod?.whatsAppNumber || null;
    }
    const receiptNumber = await generateFundReceiptNumber(tx, orgId, transactionDate);

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
        paidByPhone: memberPhone,
        paidByMembershipId: parsed.data.paidByMembershipId ?? null,
        receiptNumber,
        memo: parsed.data.memo ?? null,
        journalEntryId: journalEntry.id,
        createdByUserId: req.auth!.userId,
      },
      include: { assetAccount: true, journalEntry: true },
    });
  });

  return res.status(201).json(serializeFundTransaction(transaction));
}));

accountingRouter.get("/fund-transactions/:id/receipt", asyncRoute(async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ error: "Organization scope required" });

  const transaction = await prisma.fundTransaction.findFirst({
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
    ? await prisma.user.findUnique({
        where: { id: transaction.createdByUserId },
        select: { email: true },
      })
    : null;

  return res.json(buildFundReceipt(transaction, collectedBy?.email ?? null));
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

accountingRouter.post("/fund-transactions/:id/reverse", requireAccountingAdmin, asyncRoute(async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ error: "Organization scope required" });

  const parsed = cashReverseSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const transaction = await tx.fundTransaction.findFirst({
      where: { id: req.params.id, organizationId: orgId },
      include: { journalEntry: { include: { lines: true } } },
    });
    if (!transaction) throw new Error("Fund transaction not found");
    if (transaction.transactionType !== "collection" && transaction.transactionType !== "expense") {
      throw new Error("Only fund collections and expenses can be reversed");
    }
    if (transaction.reversedAt) throw new Error("Fund transaction is already reversed");
    if (!transaction.journalEntry) throw new Error("Original journal entry was not found");

    await createJournalEntry(tx, {
      organizationId: orgId,
      entryDate: new Date(),
      entryType: "manual_adjustment",
      description: `Special fund transaction reversal: ${parsed.data.reason}`,
      referenceType: "fund_transaction_reversal",
      referenceId: transaction.id,
      isSystemEntry: true,
      createdByUserId: req.auth!.userId,
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
        reversedByUserId: req.auth!.userId,
        reversalReason: parsed.data.reason,
      },
      include: { assetAccount: true, journalEntry: true, reversedBy: { select: { email: true } } },
    });
  });

  return res.json(serializeFundTransaction(updated));
}));

async function transferFundBalance(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    fundPotId: string;
    userId: string;
    transactionDate: Date;
    amount?: Decimal | null;
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
  const availableAmount = isSurplus ? balance : balance.abs();
  const amount = input.amount ?? availableAmount;
  if (amount.lte(new Decimal(0)) || amount.gt(availableAmount)) {
    throw new Error(`Transfer amount must be greater than zero and no more than ${availableAmount.toFixed(2)}`);
  }
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
  let transaction;
  try {
    transaction = await prisma.$transaction(async (tx) => {
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
        amount: parsed.data.amount ? new Decimal(parsed.data.amount) : null,
        memo: parsed.data.memo ?? null,
      });
    });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Transfer amount")) {
      return res.status(400).json({ error: err.message });
    }
    throw err;
  }

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

    const updated = await tx.fundPot.update({
      where: { id: existing.id },
      data: { status: "closed", closedAt: new Date() },
      include: { fundAccount: true, surplusAccount: true, deficitAccount: true, transactions: true },
    });
    await writeAuditLog(tx, {
      organizationId: orgId,
      actorUserId: req.auth!.userId,
      action: "finance.fund.closed",
      entityType: "fund_pot",
      entityId: existing.id,
      summary: `Closed special fund ${updated.name}`,
    });
    return updated;
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

function bankingAccountStatus(account: AccountingAccount) {
  return account.isActive && !account.closedAt ? "active" : "closed";
}

async function bankingLineTotals(
  tx: Prisma.TransactionClient,
  organizationId: string,
  accountIds: string[],
  range: { before?: Date; from?: Date; toEnd?: Date }
) {
  if (!accountIds.length) return new Map<string, { debit: Decimal; credit: Decimal }>();
  const rows = await tx.accountingJournalLine.groupBy({
    by: ["accountId", "side"],
    where: {
      organizationId,
      accountId: { in: accountIds },
      journalEntry: {
        entryDate: range.before
          ? { lt: range.before }
          : { ...(range.from ? { gte: range.from } : {}), ...(range.toEnd ? { lte: range.toEnd } : {}) },
      },
    },
    _sum: { amount: true },
  });
  const totals = new Map<string, { debit: Decimal; credit: Decimal }>();
  for (const row of rows) {
    const current = totals.get(row.accountId) ?? { debit: new Decimal(0), credit: new Decimal(0) };
    if (row.side === "debit") current.debit = current.debit.add(row._sum.amount ?? new Decimal(0));
    else current.credit = current.credit.add(row._sum.amount ?? new Decimal(0));
    totals.set(row.accountId, current);
  }
  return totals;
}

function bankingBalance(totals?: { debit: Decimal; credit: Decimal }) {
  return (totals?.debit ?? new Decimal(0)).sub(totals?.credit ?? new Decimal(0));
}

async function generateBankingReceiptNumber(tx: Prisma.TransactionClient, organizationId: string, date: Date, prefix: "BK" | "BR") {
  const key = `${prefix}${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}`;
  const latest = await tx.bankingTransaction.findFirst({
    where: { organizationId, receiptNumber: { startsWith: key } },
    orderBy: { receiptNumber: "desc" },
    select: { receiptNumber: true },
  });
  const sequence = latest?.receiptNumber ? Number(latest.receiptNumber.slice(key.length)) || 0 : 0;
  return `${key}${String(sequence + 1).padStart(4, "0")}`;
}

function bankingTransactionLabel(type: BankingTransactionType, reversal = false) {
  const label = type === "deposit" ? "Deposit" : type === "withdrawal" ? "Withdrawal" : "Transfer";
  return reversal ? `Reversal of ${label}` : label;
}

function buildBankingReceipt(transaction: any) {
  return {
    receiptNumber: transaction.receiptNumber,
    originalReceiptNumber: transaction.isReversal ? transaction.reversalOf?.receiptNumber ?? null : null,
    transactionId: transaction.id,
    transactionDate: transaction.transactionDate.toISOString(),
    organizationName: transaction.organization.name,
    organizationReceiptLogoUrl: transaction.organization.receiptLogoUrl,
    accountName: transaction.sourceAccount.name,
    counterpartyName: transaction.destinationAccount.name,
    amount: Number(transaction.amount),
    paymentMethod: `${transaction.sourceAccount.assetSubtype === "bank" ? "Bank" : "Cash"} to ${transaction.destinationAccount.assetSubtype === "bank" ? "Bank" : "Cash"}`,
    reference: transaction.reference,
    description: transaction.description,
    reversalReason: transaction.isReversal ? transaction.reversalOf?.reversalReason ?? null : null,
    collectedBy: transaction.createdBy?.email ?? null,
    receiptTitle: transaction.isReversal ? "BANKING REVERSAL RECEIPT" : "BANKING TRANSFER RECEIPT",
    counterpartyLabel: "Transferred To",
    amountLabel: transaction.isReversal ? "Reversed Amount" : "Transfer Amount",
  };
}

function bankingSource(referenceType?: string | null) {
  if (referenceType === "payment" || referenceType === "payment_credit_application") return "Members";
  if (referenceType?.startsWith("receivable_")) return "Receivable";
  if (referenceType?.startsWith("payable_")) return "Payable";
  if (referenceType === "operating_income" || referenceType === "manual_income") return "Income";
  if (referenceType === "operating_expense" || referenceType === "manual_expense" || referenceType === "receivable_write_off") return "Expense";
  if (referenceType?.startsWith("fund_")) return "Special Funds";
  return "Accounting";
}

function bankingOpenHref(referenceType?: string | null, referenceId?: string | null) {
  if (referenceType === "payment") return "/payments";
  if (referenceType?.startsWith("receivable_") && referenceId) return `/receivables/${referenceId}`;
  if (referenceType?.startsWith("payable_") && referenceId) return `/payables/${referenceId}`;
  if (referenceType === "operating_income" && referenceId) return `/cash-in/accounts/${referenceId}`;
  if (referenceType === "operating_expense" && referenceId) return `/cash-out/accounts/${referenceId}`;
  if (referenceType?.startsWith("fund_") && referenceId) return `/funds/${referenceId}`;
  return "/accounting";
}

accountingRouter.get("/banking/overview", asyncRoute(async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ error: "Organization scope required" });
  const { from, toEnd } = cashFlowRange(req.query);
  const search = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const type = req.query.type === "cash" || req.query.type === "bank" ? req.query.type : null;
  const status = typeof req.query.status === "string" ? req.query.status : "active";
  const sort = typeof req.query.sort === "string" ? req.query.sort : "name_asc";
  const data = await prisma.$transaction(async (tx) => {
    await ensureDefaultAccountingAccounts(tx, orgId);
    const accounts = await tx.accountingAccount.findMany({
      where: {
        organizationId: orgId, accountType: "asset", assetSubtype: type ?? { in: cashBankSubtypes },
        ...(status === "closed" ? { OR: [{ isActive: false }, { closedAt: { not: null } }] } : status === "all" ? {} : { isActive: true, closedAt: null }),
        ...(search ? { name: { contains: search, mode: "insensitive" } } : {}),
      },
      orderBy: { name: "asc" },
    });
    const ids = accounts.map((account) => account.id);
    const [opening, period, current] = await Promise.all([
      bankingLineTotals(tx, orgId, ids, { before: from }),
      bankingLineTotals(tx, orgId, ids, { from, toEnd }),
      bankingLineTotals(tx, orgId, ids, { toEnd }),
    ]);
    const rows = accounts.map((account) => {
      const periodTotals = period.get(account.id);
      return {
        ...serializeAccount(account),
        accountTypeLabel: account.assetSubtype === "bank" ? "Bank" : "Cash",
        status: bankingAccountStatus(account),
        openingBalance: asNumber(bankingBalance(opening.get(account.id))),
        cashIn: asNumber(periodTotals?.debit ?? new Decimal(0)),
        cashOut: asNumber(periodTotals?.credit ?? new Decimal(0)),
        currentBalance: asNumber(bankingBalance(current.get(account.id))),
      };
    });
    if (sort === "balance_desc") rows.sort((a, b) => b.currentBalance - a.currentBalance);
    if (sort === "balance_asc") rows.sort((a, b) => a.currentBalance - b.currentBalance);
    return rows;
  });
  const totals = data.reduce((sum, row) => ({
    openingBalance: sum.openingBalance + row.openingBalance, cashIn: sum.cashIn + row.cashIn,
    cashOut: sum.cashOut + row.cashOut, currentBalance: sum.currentBalance + row.currentBalance,
  }), { openingBalance: 0, cashIn: 0, cashOut: 0, currentBalance: 0 });
  return res.json({ fromDate: from.toISOString(), toDate: toEnd.toISOString(), totals, rows: data });
}));

accountingRouter.post("/banking/accounts", requireAccountingAdmin, asyncRoute(async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ error: "Organization scope required" });
  const parsed = bankingAccountSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  const account = await prisma.$transaction(async (tx) => {
    await ensureDefaultAccountingAccounts(tx, orgId);
    const duplicate = await tx.accountingAccount.findFirst({ where: { organizationId: orgId, name: { equals: parsed.data.name, mode: "insensitive" } }, select: { id: true } });
    if (duplicate) { const error = new Error("An account with this name already exists"); (error as any).statusCode = 409; throw error; }
    const created = await tx.accountingAccount.create({ data: { organizationId: orgId, name: parsed.data.name, accountType: "asset", assetSubtype: parsed.data.assetSubtype, bankName: parsed.data.bankName || null, accountNumber: parsed.data.accountNumber || null, description: parsed.data.description || null, createdByUserId: req.auth!.userId } });
    await writeAuditLog(tx, {
      organizationId: orgId,
      actorUserId: req.auth!.userId,
      action: "finance.banking_account.created",
      entityType: "accounting_account",
      entityId: created.id,
      summary: `Created ${created.assetSubtype} account ${created.name}`,
      metadata: { assetSubtype: created.assetSubtype },
    });
    return created;
  });
  return res.status(201).json(serializeAccount(account));
}));

accountingRouter.get("/banking/:id", asyncRoute(async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ error: "Organization scope required" });
  const { from, toEnd } = cashFlowRange(req.query);
  const data = await prisma.$transaction(async (tx) => {
    const account = await tx.accountingAccount.findFirst({ where: { id: req.params.id, organizationId: orgId, accountType: "asset", assetSubtype: { in: cashBankSubtypes } } });
    if (!account) return null;
    const [opening, current, entries] = await Promise.all([
      bankingLineTotals(tx, orgId, [account.id], { before: from }),
      bankingLineTotals(tx, orgId, [account.id], { toEnd }),
      tx.accountingJournalEntry.findMany({
        where: { organizationId: orgId, entryDate: { gte: from, lte: toEnd }, lines: { some: { accountId: account.id } } },
        include: { lines: { include: { account: { select: { id: true, name: true, accountType: true, assetSubtype: true } } } }, createdBy: { select: { email: true } }, bankingTransactions: { include: { sourceAccount: { select: { name: true } }, destinationAccount: { select: { name: true } }, reversedBy: { select: { email: true } }, reversal: { select: { id: true, receiptNumber: true } }, reversalOf: { select: { id: true, receiptNumber: true } } } } },
        orderBy: [{ entryDate: "asc" }, { createdAt: "asc" }],
      }),
    ]);
    const entryIds = entries.map((entry) => entry.id);
    const [relatedCashTransactions, relatedFundTransactions] = await Promise.all([
      tx.cashTransaction.findMany({
        where: { organizationId: orgId, journalEntryId: { in: entryIds } },
        select: { id: true, journalEntryId: true, accountId: true, category: true, documentNumber: true, reversedAt: true, reversalReason: true, reversalDocumentNumber: true, reversedBy: { select: { email: true } } },
      }),
      tx.fundTransaction.findMany({
        where: { organizationId: orgId, journalEntryId: { in: entryIds } },
        select: { id: true, journalEntryId: true, receiptNumber: true, reversedAt: true, reversalReason: true, reversedBy: { select: { email: true } } },
      }),
    ]);
    const cashTransactionByJournal = new Map(relatedCashTransactions.map((transaction) => [transaction.journalEntryId, transaction]));
    const fundTransactionByJournal = new Map(relatedFundTransactions.map((transaction) => [transaction.journalEntryId, transaction]));
    let balance = bankingBalance(opening.get(account.id));
    const activity = entries.map((entry) => {
      const ownLine = entry.lines.find((line) => line.accountId === account.id)!;
      const amount = new Decimal(ownLine.amount);
      balance = ownLine.side === "debit" ? balance.add(amount) : balance.sub(amount);
      const banking = entry.bankingTransactions[0];
      const cashTransaction = cashTransactionByJournal.get(entry.id);
      const fundTransaction = fundTransactionByJournal.get(entry.id);
      const sourceTransaction = cashTransaction ?? fundTransaction;
      const otherAccounts = entry.lines.filter((line) => line.accountId !== account.id).map((line) => line.account.name).join(", ");
      const source = banking ? "Banking" : bankingSource(entry.referenceType);
      return {
        id: entry.id, transactionDate: entry.entryDate.toISOString(), source,
        description: banking ? `${bankingTransactionLabel(banking.transactionType, banking.isReversal)}${banking.description ? `: ${banking.description}` : ` ${banking.sourceAccount.name} to ${banking.destinationAccount.name}`}` : `${otherAccounts || entry.description}${entry.description && otherAccounts ? ` - ${entry.description}` : ""}`,
        amount: asNumber(amount), direction: ownLine.side === "debit" ? "in" : "out", balance: asNumber(balance),
        status: banking?.reversedAt || sourceTransaction?.reversedAt ? "reversed" : "posted", actionedBy: banking?.createdByUserId ? entry.createdBy?.email ?? "System" : entry.createdBy?.email ?? "System",
        receiptNumber: banking?.receiptNumber ?? cashTransaction?.documentNumber ?? fundTransaction?.receiptNumber ?? null, receiptTransactionId: banking?.id ?? null,
        reversalReason: banking?.reversalReason ?? sourceTransaction?.reversalReason ?? null, reversedAt: banking?.reversedAt?.toISOString() ?? sourceTransaction?.reversedAt?.toISOString() ?? null,
        reversedBy: banking?.reversedBy?.email ?? sourceTransaction?.reversedBy?.email ?? null, linkedReversalReceipt: banking?.reversal?.receiptNumber ?? banking?.reversalOf?.receiptNumber ?? cashTransaction?.reversalDocumentNumber ?? null,
        linkedReversalTransactionId: banking?.reversal?.id ?? banking?.reversalOf?.id ?? null,
        bankingTransactionId: banking?.id ?? null, canReverse: Boolean(banking && !banking.reversedAt && !banking.isReversal && account.isActive),
        openHref: banking ? null : cashTransaction?.category.startsWith("receivable_") ? `/receivables/${cashTransaction.accountId}` : cashTransaction?.category.startsWith("payable_") ? `/payables/${cashTransaction.accountId}` : cashTransaction?.category === "operating_income" ? `/cash-in/accounts/${cashTransaction.accountId}` : cashTransaction?.category === "operating_expense" ? `/cash-out/accounts/${cashTransaction.accountId}` : bankingOpenHref(entry.referenceType, entry.referenceId),
      };
    }).reverse();
    const period = activity.reduce((sum, item) => ({ cashIn: item.direction === "in" ? sum.cashIn + item.amount : sum.cashIn, cashOut: item.direction === "out" ? sum.cashOut + item.amount : sum.cashOut }), { cashIn: 0, cashOut: 0 });
    return { account: { ...serializeAccount(account), accountTypeLabel: account.assetSubtype === "bank" ? "Bank" : "Cash", status: bankingAccountStatus(account) }, summary: { openingBalance: asNumber(bankingBalance(opening.get(account.id))), cashIn: period.cashIn, cashOut: period.cashOut, currentBalance: asNumber(bankingBalance(current.get(account.id))) }, activity };
  });
  if (!data) return res.status(404).json({ error: "Cash or bank account not found" });
  return res.json(data);
}));

accountingRouter.post("/banking/transactions", requireAccountingAdmin, asyncRoute(async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ error: "Organization scope required" });
  const parsed = bankingTransactionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  if (parsed.data.sourceAccountId === parsed.data.destinationAccountId) return res.status(400).json({ error: "Source and destination accounts must be different" });
  const date = parsed.data.transactionDate ? new Date(parsed.data.transactionDate) : new Date();
  const result = await prisma.$transaction(async (tx) => {
    const accounts = await tx.accountingAccount.findMany({ where: { id: { in: [parsed.data.sourceAccountId, parsed.data.destinationAccountId] }, organizationId: orgId, accountType: "asset", assetSubtype: { in: cashBankSubtypes }, isActive: true } });
    const source = accounts.find((account) => account.id === parsed.data.sourceAccountId);
    const destination = accounts.find((account) => account.id === parsed.data.destinationAccountId);
    if (!source || !destination) throw new Error("Select active cash or bank accounts");
    const valid = (parsed.data.transactionType === "deposit" && source.assetSubtype === "cash" && destination.assetSubtype === "bank")
      || (parsed.data.transactionType === "withdrawal" && source.assetSubtype === "bank" && destination.assetSubtype === "cash")
      || (parsed.data.transactionType === "cash_transfer" && source.assetSubtype === "cash" && destination.assetSubtype === "cash")
      || (parsed.data.transactionType === "bank_transfer" && source.assetSubtype === "bank" && destination.assetSubtype === "bank");
    if (!valid) { const error = new Error("Selected accounts do not match this banking action"); (error as any).statusCode = 400; throw error; }
    const amount = new Decimal(parsed.data.amount);
    const receiptNumber = await generateBankingReceiptNumber(tx, orgId, date, "BK");
    const transaction = await tx.bankingTransaction.create({ data: { organizationId: orgId, transactionType: parsed.data.transactionType, sourceAccountId: source.id, destinationAccountId: destination.id, amount, transactionDate: date, description: parsed.data.description || null, reference: parsed.data.reference || null, receiptNumber, createdByUserId: req.auth!.userId } });
    const entry = await createJournalEntry(tx, { organizationId: orgId, entryDate: date, entryType: "transfer", description: parsed.data.description || `${bankingTransactionLabel(parsed.data.transactionType)}: ${source.name} to ${destination.name}`, referenceType: "banking_transaction", referenceId: transaction.id, isSystemEntry: false, createdByUserId: req.auth!.userId, lines: [{ accountId: destination.id, side: "debit", amount }, { accountId: source.id, side: "credit", amount }] });
    return tx.bankingTransaction.update({ where: { id: transaction.id }, data: { journalEntryId: entry.id }, include: { sourceAccount: true, destinationAccount: true } });
  });
  return res.status(201).json(result);
}));

accountingRouter.post("/banking/transactions/:id/reverse", requireAccountingAdmin, asyncRoute(async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ error: "Organization scope required" });
  const parsed = bankingReverseSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  const result = await prisma.$transaction(async (tx) => {
    const original = await tx.bankingTransaction.findFirst({ where: { id: req.params.id, organizationId: orgId }, include: { sourceAccount: true, destinationAccount: true, reversal: true } });
    if (!original) throw new Error("Banking transaction not found");
    if (original.isReversal || original.reversedAt || original.reversal) throw new Error("Banking transaction is already reversed");
    if (!original.sourceAccount.isActive || !original.destinationAccount.isActive) { const error = new Error("Closed cash or bank accounts cannot have entries reversed"); (error as any).statusCode = 409; throw error; }
    const date = new Date();
    const receiptNumber = await generateBankingReceiptNumber(tx, orgId, date, "BR");
    const reversal = await tx.bankingTransaction.create({ data: { organizationId: orgId, transactionType: original.transactionType, sourceAccountId: original.destinationAccountId, destinationAccountId: original.sourceAccountId, amount: original.amount, transactionDate: date, description: parsed.data.note || `Reversal of ${original.receiptNumber}`, reference: original.reference, receiptNumber, reversalOfId: original.id, isReversal: true, createdByUserId: req.auth!.userId } });
    const entry = await createJournalEntry(tx, { organizationId: orgId, entryDate: date, entryType: "manual_adjustment", description: `Reversal of ${bankingTransactionLabel(original.transactionType)} ${original.receiptNumber}: ${parsed.data.reason}`, referenceType: "banking_transaction_reversal", referenceId: reversal.id, isSystemEntry: true, createdByUserId: req.auth!.userId, lines: [{ accountId: original.sourceAccountId, side: "debit", amount: original.amount }, { accountId: original.destinationAccountId, side: "credit", amount: original.amount }] });
    await tx.bankingTransaction.update({ where: { id: original.id }, data: { reversedAt: date, reversedByUserId: req.auth!.userId, reversalReason: parsed.data.note ? `${parsed.data.reason}: ${parsed.data.note}` : parsed.data.reason } });
    return tx.bankingTransaction.update({ where: { id: reversal.id }, data: { journalEntryId: entry.id } });
  });
  return res.status(201).json(result);
}));

accountingRouter.get("/banking/transactions/:id/receipt", asyncRoute(async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ error: "Organization scope required" });
  const transaction = await prisma.bankingTransaction.findFirst({
    where: { id: req.params.id, organizationId: orgId },
    include: {
      organization: { select: { name: true, receiptLogoUrl: true } },
      sourceAccount: { select: { name: true, assetSubtype: true } },
      destinationAccount: { select: { name: true, assetSubtype: true } },
      createdBy: { select: { email: true } },
      reversalOf: { select: { receiptNumber: true, reversalReason: true } },
    },
  });
  if (!transaction?.receiptNumber) return res.status(404).json({ error: "Banking receipt not found" });
  return res.json(buildBankingReceipt(transaction));
}));

accountingRouter.post("/banking/:id/close", requireAccountingAdmin, asyncRoute(async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ error: "Organization scope required" });
  const account = await prisma.$transaction(async (tx) => {
    const current = await tx.accountingAccount.findFirst({ where: { id: req.params.id, organizationId: orgId, accountType: "asset", assetSubtype: { in: cashBankSubtypes } } });
    if (!current) throw new Error("Cash or bank account not found");
    if (!current.isActive || current.closedAt) throw new Error("Account is already closed");
    const totals = await bankingLineTotals(tx, orgId, [current.id], { toEnd: endOfDay(new Date()) });
    const balance = bankingBalance(totals.get(current.id));
    if (!balance.eq(0)) { const error = new Error(balance.gt(0) ? `This account has a balance of Rs. ${balance.toFixed(2)}. Please transfer before closing the account` : `This account has an overdraft of Rs. ${balance.abs().toFixed(2)}. Please clear before closing the account`); (error as any).statusCode = 409; throw error; }
    const updated = await tx.accountingAccount.update({ where: { id: current.id }, data: { isActive: false, closedAt: new Date() } });
    await writeAuditLog(tx, {
      organizationId: orgId,
      actorUserId: req.auth!.userId,
      action: "finance.banking_account.closed",
      entityType: "accounting_account",
      entityId: current.id,
      summary: `Closed ${current.assetSubtype} account ${current.name}`,
    });
    return updated;
  });
  return res.json({ account: serializeAccount(account) });
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

  const from = startOfDay(dateFromQuery(req.query.fromDate, new Date(new Date().getFullYear(), new Date().getMonth(), 1)));
  const to = endOfDay(dateFromQuery(req.query.toDate, new Date()));
  if (from > to) return res.status(400).json({ error: "From date must be on or before to date" });

  const [organization, accounts] = await Promise.all([
    prisma.organization.findUnique({ where: { id: orgId }, select: { name: true } }),
    prisma.accountingAccount.findMany({
      where: { organizationId: orgId, accountType: { in: ["income", "expense"] } },
      orderBy: [{ accountType: "asc" }, { assetSubtype: "asc" }, { name: "asc" }],
    }),
  ]);
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
      assetSubtype: account.assetSubtype,
      systemKey: account.systemKey,
      amount: asNumber(accountBalanceExpression(account.accountType, total.debit, total.credit)),
    };
  }).filter((row) => Math.abs(row.amount) > 0.000001);

  const incomeTotal = rows
    .filter((row) => row.accountType === "income")
    .reduce((sum, row) => sum + row.amount, 0);
  const expenseTotal = rows
    .filter((row) => row.accountType === "expense")
    .reduce((sum, row) => sum + row.amount, 0);

  const categoryTotal = (accountType: "income" | "expense", assetSubtype: string) => rows
    .filter((row) => row.accountType === accountType && row.assetSubtype === assetSubtype)
    .reduce((sum, row) => sum + row.amount, 0);

  return res.json({
    organizationName: organization?.name ?? "Organization",
    fromDate: localDateString(from),
    toDate: localDateString(to),
    currency: "LKR",
    generatedAt: new Date().toISOString(),
    generatedBy: req.auth!.email,
    income: rows.filter((row) => row.accountType === "income"),
    expenses: rows.filter((row) => row.accountType === "expense"),
    incomeTotal: Number(incomeTotal.toFixed(2)),
    expenseTotal: Number(expenseTotal.toFixed(2)),
    netIncome: Number((incomeTotal - expenseTotal).toFixed(2)),
    categories: {
      operatingIncome: Number(categoryTotal("income", "operating_income").toFixed(2)),
      specialFundSurplus: Number(categoryTotal("income", "project_fund_surplus").toFixed(2)),
      operatingExpenses: Number(categoryTotal("expense", "operating_expense").toFixed(2)),
      specialFundDeficit: Number(categoryTotal("expense", "project_fund_deficit").toFixed(2)),
    },
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

accountingRouter.get("/reports/cash-movement", asyncRoute(async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ error: "Organization scope required" });

  const from = startOfDay(dateFromQuery(req.query.fromDate, new Date(new Date().getFullYear(), new Date().getMonth(), 1)));
  const to = endOfDay(dateFromQuery(req.query.toDate, new Date()));
  if (from > to) return res.status(400).json({ error: "From date must be on or before to date" });

  const [organization, accounts] = await Promise.all([
    prisma.organization.findUnique({ where: { id: orgId }, select: { name: true } }),
    prisma.accountingAccount.findMany({
      where: { organizationId: orgId, accountType: "asset", assetSubtype: { in: ["cash", "bank"] } },
      orderBy: [{ assetSubtype: "asc" }, { name: "asc" }],
      select: { id: true, name: true, assetSubtype: true, systemKey: true },
    }),
  ]);
  const accountIds = accounts.map((account) => account.id);
  const [openingLines, entries, memberPayments] = await Promise.all([
    prisma.accountingJournalLine.groupBy({
      by: ["accountId", "side"],
      where: {
        organizationId: orgId,
        accountId: { in: accountIds },
        journalEntry: { entryDate: { lt: from } },
      },
      _sum: { amount: true },
    }),
    prisma.accountingJournalEntry.findMany({
      where: {
        organizationId: orgId,
        entryDate: { gte: from, lte: to },
        lines: { some: { accountId: { in: accountIds } } },
      },
      orderBy: [{ entryDate: "asc" }, { createdAt: "asc" }],
      include: { lines: { include: { account: { select: { id: true, name: true, accountType: true, assetSubtype: true } } } } },
    }),
    prisma.payment.findMany({
      where: {
        organizationId: orgId,
        AND: [
          {
            OR: [
              { paymentDate: { gte: from, lte: to } },
              { reversedAt: { gte: from, lte: to } },
            ],
          },
          {
            OR: [
              { paymentDueId: null },
              { paymentDue: { is: { isSystemAdjustment: false } } },
            ],
          },
        ],
      },
      include: {
        paymentDue: {
          select: {
            dueType: {
              select: { id: true, name: true, systemKey: true, sortOrder: true },
            },
          },
        },
      },
    }),
  ]);

  const zeroAccountValues = () => Object.fromEntries(accounts.map((account) => [account.id, 0])) as Record<string, number>;
  const openingByAccount = zeroAccountValues();
  for (const line of openingLines) {
    const amount = Number(line._sum.amount ?? 0);
    openingByAccount[line.accountId] += line.side === "debit" ? amount : -amount;
  }

  type MovementSection = "received" | "paid" | "transfer";
  type MovementRow = { key: string; group: string; description: string; total: number; accounts: Record<string, number> };
  const receivedRows = new Map<string, MovementRow>();
  const paidRows = new Map<string, MovementRow>();
  const transferRows: MovementRow[] = [];
  const movementByAccount = zeroAccountValues();

  function movementGroupForAccount(
    account: { accountType: AccountingAccountType; assetSubtype: AccountingAssetSubtype },
    section: Exclude<MovementSection, "transfer">
  ) {
    if (section === "received") {
      if (account.accountType === "equity" && account.assetSubtype === "project_fund") return "Special Fund Collections";
      if (account.accountType === "asset" && receivableSubtypes.includes(account.assetSubtype)) return "Receivable Repayments";
      if (account.accountType === "liability" && payableSubtypes.includes(account.assetSubtype)) return "Other Money Received";
      return "Operating Income";
    }
    if (account.accountType === "equity" && account.assetSubtype === "project_fund") return "Special Fund Expenses";
    if (account.accountType === "liability" && payableSubtypes.includes(account.assetSubtype)) return "Payable Repayments";
    if (account.accountType === "asset" && receivableSubtypes.includes(account.assetSubtype)) return "Receivable Advances";
    return "Operating Expenses";
  }

  function addMovement(
    target: Map<string, MovementRow>,
    group: string,
    description: string,
    amount: number,
    accountValues: Record<string, number>
  ) {
    const key = `${group}::${description}`;
    const row = target.get(key) ?? { key, group, description, total: 0, accounts: zeroAccountValues() };
    row.total += amount;
    for (const account of accounts) row.accounts[account.id] += accountValues[account.id] ?? 0;
    target.set(key, row);
  }

  for (const entry of entries) {
    const cashLines = entry.lines.filter((line) => accountIds.includes(line.accountId));
    const signedValues = zeroAccountValues();
    for (const line of cashLines) {
      const signed = (line.side === "debit" ? 1 : -1) * Number(line.amount);
      signedValues[line.accountId] += signed;
      movementByAccount[line.accountId] += signed;
    }
    const net = Object.values(signedValues).reduce((sum, amount) => sum + amount, 0);
    // Opening balances change the cash/bank position but are not operating
    // receipts, payments, or internal transfers.
    if (entry.entryType === "opening_balance") continue;
    const isTransfer = cashLines.length > 1 && Math.abs(net) < 0.005;

    if (isTransfer) {
      transferRows.push({
        key: entry.id,
        group: "Internal Transfers",
        description: entry.description,
        total: 0,
        accounts: signedValues,
      });
      continue;
    }

    // Member receipts and their corrections are classified below using the
    // payment's due/credit allocation rather than a slash-joined journal label.
    if (entry.entryType === "payment" || entry.entryType === "payment_correction") continue;

    const isReversal = Boolean(entry.referenceType?.includes("reversal") || entry.referenceType === "journal_entry");
    const section: Exclude<MovementSection, "transfer"> = isReversal
      ? net < 0 ? "received" : "paid"
      : net >= 0 ? "received" : "paid";
    const logicalSign = isReversal ? -1 : 1;
    const balancingSide = net >= 0 ? "credit" : "debit";
    const counterpartLines = entry.lines.filter((line) =>
      !accountIds.includes(line.accountId) && line.side === balancingSide
    );
    const directionalCashLines = cashLines.filter((line) => {
      const signed = (line.side === "debit" ? 1 : -1) * Number(line.amount);
      return net >= 0 ? signed > 0 : signed < 0;
    });
    const cashWeightTotal = directionalCashLines.reduce((sum, line) => sum + Number(line.amount), 0);

    for (const line of counterpartLines) {
      const amount = logicalSign * Number(line.amount);
      const accountValues = zeroAccountValues();
      for (const cashLine of directionalCashLines) {
        const weight = cashWeightTotal > 0 ? Number(cashLine.amount) / cashWeightTotal : 0;
        accountValues[cashLine.accountId] += amount * weight;
      }
      const group = movementGroupForAccount(line.account, section);
      addMovement(section === "received" ? receivedRows : paidRows, group, line.account.name, amount, accountValues);
    }
  }

  const paymentAllocationBreakdowns = await loadPaymentAllocationBreakdowns(prisma, memberPayments, to);
  const cashAccount = accounts.find((account) => account.systemKey === ACCOUNTING_SYSTEM_KEYS.cash);
  const bankAccount = accounts.find((account) => account.systemKey === ACCOUNTING_SYSTEM_KEYS.bank);
  const isWithinReportPeriod = (date: Date | null) => Boolean(date && date >= from && date <= to);

  function addMemberPaymentMovement(payment: typeof memberPayments[number], sign: 1 | -1) {
    const depositAccountId = payment.depositAccountId
      ?? (payment.paymentMethod === "bank_transfer" ? bankAccount?.id : cashAccount?.id);
    if (!depositAccountId || !accountIds.includes(depositAccountId)) return;

    for (const component of paymentAllocationBreakdowns.get(payment.id) ?? []) {
      const description = component.isCreditBalance
        ? "Member Credit Liability"
        : dueTypeIncomeAccountName({ name: component.dueTypeName, systemKey: component.dueTypeSystemKey });
      const amount = sign * component.amount.toNumber();
      const accountValues = zeroAccountValues();
      accountValues[depositAccountId] = amount;
      addMovement(receivedRows, "Operating Income", description, amount, accountValues);
    }
  }

  for (const payment of memberPayments) {
    if (isWithinReportPeriod(payment.paymentDate)) addMemberPaymentMovement(payment, 1);
    if (payment.isReversed && isWithinReportPeriod(payment.reversedAt)) addMemberPaymentMovement(payment, -1);
  }

  const normalizeRow = (row: MovementRow) => ({
    ...row,
    total: Number(row.total.toFixed(2)),
    accounts: Object.fromEntries(Object.entries(row.accounts).map(([id, amount]) => [id, Number(amount.toFixed(2))])),
  });
  const received = [...receivedRows.values()].map(normalizeRow).filter((row) => Math.abs(row.total) >= 0.005);
  const paid = [...paidRows.values()].map(normalizeRow).filter((row) => Math.abs(row.total) >= 0.005);
  const transfers = transferRows.map(normalizeRow);
  const receivedByAccount = zeroAccountValues();
  const paidByAccount = zeroAccountValues();
  const transferByAccount = zeroAccountValues();
  for (const row of received) for (const account of accounts) receivedByAccount[account.id] += row.accounts[account.id];
  for (const row of paid) for (const account of accounts) paidByAccount[account.id] += row.accounts[account.id];
  for (const row of transfers) for (const account of accounts) transferByAccount[account.id] += row.accounts[account.id];
  const closingByAccount = Object.fromEntries(accounts.map((account) => [
    account.id,
    Number((openingByAccount[account.id] + movementByAccount[account.id]).toFixed(2)),
  ]));
  const sumValues = (values: Record<string, number>) => Object.values(values).reduce((sum, amount) => sum + amount, 0);
  const moneyReceived = received.reduce((sum, row) => sum + row.total, 0);
  const moneyPaid = paid.reduce((sum, row) => sum + row.total, 0);

  return res.json({
    organizationName: organization?.name ?? "Organization",
    fromDate: localDateString(from),
    toDate: localDateString(to),
    currency: "LKR",
    generatedAt: new Date().toISOString(),
    generatedBy: req.auth!.email,
    accounts,
    summary: {
      openingBalance: Number(sumValues(openingByAccount).toFixed(2)),
      moneyReceived: Number(moneyReceived.toFixed(2)),
      moneyPaid: Number(moneyPaid.toFixed(2)),
      netCashMovement: Number((moneyReceived - moneyPaid).toFixed(2)),
      closingBalance: Number(sumValues(closingByAccount).toFixed(2)),
    },
    openingByAccount,
    receivedByAccount,
    paidByAccount,
    transferByAccount,
    closingByAccount,
    received,
    paid,
    transfers,
  });
}));

accountingRouter.get("/reports/income-accounts", asyncRoute(async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ error: "Organization scope required" });

  const accounts = await prisma.accountingAccount.findMany({
    where: {
      organizationId: orgId,
      accountType: "income",
      assetSubtype: "operating_income",
      OR: [{ systemKey: null }, { NOT: { systemKey: { startsWith: "income_due_type_" } } }],
    },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    select: { id: true, name: true, accountType: true, assetSubtype: true, systemKey: true, isActive: true },
  });

  return res.json(accounts);
}));

accountingRouter.get("/reports/income-account", asyncRoute(async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ error: "Organization scope required" });

  const accountId = typeof req.query.accountId === "string" ? req.query.accountId.trim() : "";
  if (!accountId) return res.status(400).json({ error: "Account is required" });

  const from = startOfDay(dateFromQuery(req.query.fromDate, new Date(new Date().getFullYear(), new Date().getMonth(), 1)));
  const to = endOfDay(dateFromQuery(req.query.toDate, new Date()));
  if (from > to) return res.status(400).json({ error: "From date must be on or before to date" });

  const [organization, account, transactions] = await Promise.all([
    prisma.organization.findUnique({ where: { id: orgId }, select: { name: true } }),
    prisma.accountingAccount.findFirst({
      where: {
        id: accountId,
        organizationId: orgId,
        accountType: "income",
        assetSubtype: "operating_income",
        OR: [{ systemKey: null }, { NOT: { systemKey: { startsWith: "income_due_type_" } } }],
      },
      select: { id: true, name: true, assetSubtype: true, systemKey: true },
    }),
    prisma.cashTransaction.findMany({
      where: {
        organizationId: orgId,
        accountId,
        flowType: "cash_in",
        OR: [
          { transactionDate: { gte: from, lte: to } },
          { reversedAt: { gte: from, lte: to } },
        ],
      },
      include: {
        cashBankAccount: { select: { id: true, name: true } },
        createdBy: { select: { email: true } },
        reversedBy: { select: { email: true } },
      },
      orderBy: [{ transactionDate: "asc" }, { createdAt: "asc" }],
    }),
  ]);

  if (!account) return res.status(404).json({ error: "Income account not found" });

  const receiptTransactions = transactions.filter((transaction) =>
    transaction.transactionDate >= from && transaction.transactionDate <= to
  );
  const reversalTransactions = transactions.filter((transaction) =>
    transaction.reversedAt && transaction.reversedAt >= from && transaction.reversedAt <= to
  );

  const receivedInto = new Map<string, { accountId: string; accountName: string; amount: number }>();
  for (const transaction of receiptTransactions) {
    const existing = receivedInto.get(transaction.cashBankAccountId) ?? {
      accountId: transaction.cashBankAccountId,
      accountName: transaction.cashBankAccount.name,
      amount: 0,
    };
    existing.amount += Number(transaction.amount);
    receivedInto.set(transaction.cashBankAccountId, existing);
  }

  type IncomeMovement = {
    key: string;
    type: "receipt" | "reversal";
    movementDate: Date;
    enteredAt: Date;
    documentNumber: string | null;
    linkedDocumentNumber: string | null;
    receivedInto: string;
    enteredBy: string | null;
    amount: number;
    status: "posted" | "reversed" | "reversal";
    reversalReason: string | null;
    relatedDate: Date | null;
  };

  const movements: IncomeMovement[] = [];
  for (const transaction of receiptTransactions) {
    movements.push({
      key: `receipt-${transaction.id}`,
      type: "receipt",
      movementDate: transaction.transactionDate,
      enteredAt: transaction.createdAt,
      documentNumber: transaction.documentNumber,
      linkedDocumentNumber: transaction.reversedAt ? transaction.reversalDocumentNumber : null,
      receivedInto: transaction.cashBankAccount.name,
      enteredBy: transaction.createdBy?.email ?? null,
      amount: Number(transaction.amount),
      status: transaction.reversedAt ? "reversed" : "posted",
      reversalReason: transaction.reversalReason,
      relatedDate: transaction.reversedAt,
    });
  }
  for (const transaction of reversalTransactions) {
    movements.push({
      key: `reversal-${transaction.id}`,
      type: "reversal",
      movementDate: transaction.reversedAt!,
      enteredAt: transaction.reversedAt!,
      documentNumber: transaction.reversalDocumentNumber,
      linkedDocumentNumber: transaction.documentNumber,
      receivedInto: transaction.cashBankAccount.name,
      enteredBy: transaction.reversedBy?.email ?? transaction.createdBy?.email ?? null,
      amount: -Number(transaction.amount),
      status: "reversal",
      reversalReason: transaction.reversalReason,
      relatedDate: transaction.transactionDate,
    });
  }

  movements.sort((left, right) => {
    const byDate = left.movementDate.getTime() - right.movementDate.getTime();
    if (byDate !== 0) return byDate;
    const byEntered = left.enteredAt.getTime() - right.enteredAt.getTime();
    if (byEntered !== 0) return byEntered;
    return left.type === "receipt" ? -1 : 1;
  });

  let runningTotal = 0;
  const serializedMovements = movements.map((movement) => {
    runningTotal += movement.amount;
    return {
      ...movement,
      movementDate: movement.movementDate.toISOString(),
      enteredAt: movement.enteredAt.toISOString(),
      relatedDate: movement.relatedDate?.toISOString() ?? null,
      amount: Number(movement.amount.toFixed(2)),
      runningTotal: Number(runningTotal.toFixed(2)),
    };
  });

  const totalReceived = receiptTransactions.reduce((sum, transaction) => sum + Number(transaction.amount), 0);
  const amountReversed = reversalTransactions.reduce((sum, transaction) => sum + Number(transaction.amount), 0);
  const accountCategory = account.assetSubtype === "operating_income"
    ? "Operating Income"
    : account.assetSubtype === "project_fund_surplus"
      ? "Project Fund Surplus"
      : "Income";

  return res.json({
    organizationName: organization?.name ?? "Organization",
    account: { ...account, category: accountCategory },
    fromDate: localDateString(from),
    toDate: localDateString(to),
    currency: "LKR",
    generatedAt: new Date().toISOString(),
    summary: {
      totalReceived: Number(totalReceived.toFixed(2)),
      amountReversed: Number(amountReversed.toFixed(2)),
      netReceived: Number((totalReceived - amountReversed).toFixed(2)),
      postedCount: receiptTransactions.filter((transaction) => !transaction.reversedAt).length,
      receiptCount: receiptTransactions.length,
      reversalCount: reversalTransactions.length,
      movementCount: serializedMovements.length,
    },
    receivedInto: [...receivedInto.values()]
      .map((item) => ({ ...item, amount: Number(item.amount.toFixed(2)) }))
      .sort((left, right) => left.accountName.localeCompare(right.accountName)),
    movements: serializedMovements,
  });
}));

accountingRouter.get("/reports/expense-accounts", asyncRoute(async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ error: "Organization scope required" });

  const accounts = await prisma.accountingAccount.findMany({
    where: {
      organizationId: orgId,
      accountType: "expense",
      assetSubtype: "operating_expense",
      OR: [{ systemKey: null }, { systemKey: { not: BAD_DEBT_EXPENSE_KEY } }],
    },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    select: { id: true, name: true, accountType: true, assetSubtype: true, systemKey: true, isActive: true },
  });

  return res.json(accounts);
}));

accountingRouter.get("/reports/expense-account", asyncRoute(async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(400).json({ error: "Organization scope required" });

  const accountId = typeof req.query.accountId === "string" ? req.query.accountId.trim() : "";
  if (!accountId) return res.status(400).json({ error: "Account is required" });

  const from = startOfDay(dateFromQuery(req.query.fromDate, new Date(new Date().getFullYear(), new Date().getMonth(), 1)));
  const to = endOfDay(dateFromQuery(req.query.toDate, new Date()));
  if (from > to) return res.status(400).json({ error: "From date must be on or before to date" });

  const [organization, account, transactions] = await Promise.all([
    prisma.organization.findUnique({ where: { id: orgId }, select: { name: true } }),
    prisma.accountingAccount.findFirst({
      where: {
        id: accountId,
        organizationId: orgId,
        accountType: "expense",
        assetSubtype: "operating_expense",
        OR: [{ systemKey: null }, { systemKey: { not: BAD_DEBT_EXPENSE_KEY } }],
      },
      select: { id: true, name: true, assetSubtype: true, systemKey: true },
    }),
    prisma.cashTransaction.findMany({
      where: {
        organizationId: orgId,
        accountId,
        flowType: "cash_out",
        OR: [
          { transactionDate: { gte: from, lte: to } },
          { reversedAt: { gte: from, lte: to } },
        ],
      },
      include: {
        cashBankAccount: { select: { id: true, name: true } },
        createdBy: { select: { email: true } },
        reversedBy: { select: { email: true } },
      },
      orderBy: [{ transactionDate: "asc" }, { createdAt: "asc" }],
    }),
  ]);

  if (!account) return res.status(404).json({ error: "Expense account not found" });

  const paymentTransactions = transactions.filter((transaction) =>
    transaction.transactionDate >= from && transaction.transactionDate <= to
  );
  const reversalTransactions = transactions.filter((transaction) =>
    transaction.reversedAt && transaction.reversedAt >= from && transaction.reversedAt <= to
  );

  const paidFrom = new Map<string, { accountId: string; accountName: string; amount: number }>();
  for (const transaction of paymentTransactions) {
    const existing = paidFrom.get(transaction.cashBankAccountId) ?? {
      accountId: transaction.cashBankAccountId,
      accountName: transaction.cashBankAccount.name,
      amount: 0,
    };
    existing.amount += Number(transaction.amount);
    paidFrom.set(transaction.cashBankAccountId, existing);
  }

  type ExpenseMovement = {
    key: string;
    type: "receipt" | "reversal";
    movementDate: Date;
    enteredAt: Date;
    documentNumber: string | null;
    linkedDocumentNumber: string | null;
    receivedInto: string;
    enteredBy: string | null;
    amount: number;
    status: "posted" | "reversed" | "reversal";
    reversalReason: string | null;
    relatedDate: Date | null;
  };

  const movements: ExpenseMovement[] = [];
  for (const transaction of paymentTransactions) {
    movements.push({
      key: `payment-${transaction.id}`,
      type: "receipt",
      movementDate: transaction.transactionDate,
      enteredAt: transaction.createdAt,
      documentNumber: transaction.documentNumber,
      linkedDocumentNumber: transaction.reversedAt ? transaction.reversalDocumentNumber : null,
      receivedInto: transaction.cashBankAccount.name,
      enteredBy: transaction.createdBy?.email ?? null,
      amount: Number(transaction.amount),
      status: transaction.reversedAt ? "reversed" : "posted",
      reversalReason: transaction.reversalReason,
      relatedDate: transaction.reversedAt,
    });
  }
  for (const transaction of reversalTransactions) {
    movements.push({
      key: `reversal-${transaction.id}`,
      type: "reversal",
      movementDate: transaction.reversedAt!,
      enteredAt: transaction.reversedAt!,
      documentNumber: transaction.reversalDocumentNumber,
      linkedDocumentNumber: transaction.documentNumber,
      receivedInto: transaction.cashBankAccount.name,
      enteredBy: transaction.reversedBy?.email ?? transaction.createdBy?.email ?? null,
      amount: -Number(transaction.amount),
      status: "reversal",
      reversalReason: transaction.reversalReason,
      relatedDate: transaction.transactionDate,
    });
  }

  movements.sort((left, right) => {
    const byDate = left.movementDate.getTime() - right.movementDate.getTime();
    if (byDate !== 0) return byDate;
    const byEntered = left.enteredAt.getTime() - right.enteredAt.getTime();
    if (byEntered !== 0) return byEntered;
    return left.type === "receipt" ? -1 : 1;
  });

  let runningTotal = 0;
  const serializedMovements = movements.map((movement) => {
    runningTotal += movement.amount;
    return {
      ...movement,
      movementDate: movement.movementDate.toISOString(),
      enteredAt: movement.enteredAt.toISOString(),
      relatedDate: movement.relatedDate?.toISOString() ?? null,
      amount: Number(movement.amount.toFixed(2)),
      runningTotal: Number(runningTotal.toFixed(2)),
    };
  });

  const totalPaid = paymentTransactions.reduce((sum, transaction) => sum + Number(transaction.amount), 0);
  const amountReversed = reversalTransactions.reduce((sum, transaction) => sum + Number(transaction.amount), 0);

  return res.json({
    organizationName: organization?.name ?? "Organization",
    account: { ...account, category: "Operating Expenses" },
    fromDate: localDateString(from),
    toDate: localDateString(to),
    currency: "LKR",
    generatedAt: new Date().toISOString(),
    summary: {
      totalReceived: Number(totalPaid.toFixed(2)),
      amountReversed: Number(amountReversed.toFixed(2)),
      netReceived: Number((totalPaid - amountReversed).toFixed(2)),
      postedCount: paymentTransactions.filter((transaction) => !transaction.reversedAt).length,
      receiptCount: paymentTransactions.length,
      reversalCount: reversalTransactions.length,
      movementCount: serializedMovements.length,
    },
    receivedInto: [...paidFrom.values()]
      .map((item) => ({ ...item, amount: Number(item.amount.toFixed(2)) }))
      .sort((left, right) => left.accountName.localeCompare(right.accountName)),
    movements: serializedMovements,
  });
}));
