import type { AccountingAccountType, AccountingJournalEntryType, AccountingJournalLineSide, Prisma } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";

export type AccountingTx = Prisma.TransactionClient;

const ZERO = new Decimal(0);
const CASH_ACCOUNT_KEY = "asset_cash_on_hand";
const BANK_ACCOUNT_KEY = "asset_bank_account";
const MEMBER_CREDIT_KEY = "liability_member_credit";
const GENERAL_EXPENSE_KEY = "expense_general";
const FUND_BALANCE_KEY = "equity_fund_balance";
const OTHER_INCOME_KEY = "income_other";

const DEFAULT_ACCOUNTS: Array<{
  name: string;
  accountType: AccountingAccountType;
  systemKey: string;
  description: string;
}> = [
  {
    name: "Cash on Hand",
    accountType: "asset",
    systemKey: CASH_ACCOUNT_KEY,
    description: "Default physical cash account",
  },
  {
    name: "Bank Account",
    accountType: "asset",
    systemKey: BANK_ACCOUNT_KEY,
    description: "Default bank or savings account",
  },
  {
    name: "Member Credit Liability",
    accountType: "liability",
    systemKey: MEMBER_CREDIT_KEY,
    description: "Unapplied member credit balance owed by the organization",
  },
  {
    name: "Fund Balance",
    accountType: "equity",
    systemKey: FUND_BALANCE_KEY,
    description: "Opening balance and retained fund balance",
  },
  {
    name: "Other Income",
    accountType: "income",
    systemKey: OTHER_INCOME_KEY,
    description: "Fallback income account",
  },
  {
    name: "General Expense",
    accountType: "expense",
    systemKey: GENERAL_EXPENSE_KEY,
    description: "Default expense account",
  },
];

type JournalLineInput = {
  accountId: string;
  side: AccountingJournalLineSide;
  amount: Decimal;
  memo?: string | null;
};

type SystemAccountInput = {
  name: string;
  accountType: AccountingAccountType;
  systemKey: string;
  description: string;
  isActive?: boolean;
};

function normalizeAmount(amount: Decimal | number | string) {
  return amount instanceof Decimal ? amount : new Decimal(amount);
}

function assertBalanced(lines: JournalLineInput[]) {
  const debit = lines
    .filter((line) => line.side === "debit")
    .reduce((sum, line) => sum.add(line.amount), ZERO);
  const credit = lines
    .filter((line) => line.side === "credit")
    .reduce((sum, line) => sum.add(line.amount), ZERO);

  if (!debit.equals(credit) || !debit.gt(ZERO)) {
    throw new Error("Accounting journal entry must have equal non-zero debit and credit totals");
  }
}

export function accountNormalBalance(accountType: AccountingAccountType): AccountingJournalLineSide {
  return accountType === "asset" || accountType === "expense" ? "debit" : "credit";
}

export function accountBalanceExpression(accountType: AccountingAccountType, debit: Decimal, credit: Decimal) {
  return accountNormalBalance(accountType) === "debit" ? debit.sub(credit) : credit.sub(debit);
}

async function nextAvailableAccountName(
  tx: AccountingTx,
  organizationId: string,
  baseName: string,
  excludeId?: string
) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = attempt === 0 ? baseName : `${baseName} ${attempt + 1}`;
    const existing = await tx.accountingAccount.findFirst({
      where: {
        organizationId,
        name: { equals: candidate, mode: "insensitive" },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
    if (!existing) return candidate;
  }

  return `${baseName} ${Date.now()}`;
}

async function ensureSystemAccount(tx: AccountingTx, organizationId: string, account: SystemAccountInput) {
  const existingByKey = await tx.accountingAccount.findUnique({
    where: {
      organizationId_systemKey: {
        organizationId,
        systemKey: account.systemKey,
      },
    },
  });

  if (existingByKey) {
    const safeName = await nextAvailableAccountName(tx, organizationId, account.name, existingByKey.id);
    return tx.accountingAccount.update({
      where: { id: existingByKey.id },
      data: {
        name: safeName,
        description: account.description,
        isActive: account.isActive ?? true,
      },
    });
  }

  const existingByName = await tx.accountingAccount.findFirst({
    where: {
      organizationId,
      name: { equals: account.name, mode: "insensitive" },
    },
  });

  if (existingByName && !existingByName.systemKey && existingByName.accountType === account.accountType) {
    return tx.accountingAccount.update({
      where: { id: existingByName.id },
      data: {
        systemKey: account.systemKey,
        description: account.description,
        isActive: account.isActive ?? true,
      },
    });
  }

  const name = existingByName
    ? await nextAvailableAccountName(tx, organizationId, `${account.name} (System)`)
    : account.name;

  return tx.accountingAccount.create({
    data: {
      organizationId,
      name,
      accountType: account.accountType,
      systemKey: account.systemKey,
      description: account.description,
      isActive: account.isActive ?? true,
    },
  });
}

export async function ensureDefaultAccountingAccounts(tx: AccountingTx, organizationId: string) {
  for (const account of DEFAULT_ACCOUNTS) {
    await ensureSystemAccount(tx, organizationId, account);
  }

  const dueTypes = await tx.dueType.findMany({
    where: { organizationId },
    select: { id: true, name: true, isActive: true },
  });

  for (const dueType of dueTypes) {
    await ensureSystemAccount(tx, organizationId, {
      name: `${dueType.name} Income`,
      accountType: "income",
      systemKey: dueTypeIncomeSystemKey(dueType.id),
      description: `Income recognized from ${dueType.name} dues`,
      isActive: dueType.isActive,
    });
  }
}

export function dueTypeIncomeSystemKey(dueTypeId: string) {
  return `income_due_type_${dueTypeId}`;
}

export async function getSystemAccount(tx: AccountingTx, organizationId: string, systemKey: string) {
  await ensureDefaultAccountingAccounts(tx, organizationId);
  const account = await tx.accountingAccount.findUnique({
    where: {
      organizationId_systemKey: {
        organizationId,
        systemKey,
      },
    },
  });
  if (!account) throw new Error(`Missing accounting system account ${systemKey}`);
  return account;
}

export async function getDueTypeIncomeAccount(
  tx: AccountingTx,
  input: { organizationId: string; dueTypeId?: string | null }
) {
  if (!input.dueTypeId) {
    return getSystemAccount(tx, input.organizationId, OTHER_INCOME_KEY);
  }

  await ensureDefaultAccountingAccounts(tx, input.organizationId);
  const account = await tx.accountingAccount.findUnique({
    where: {
      organizationId_systemKey: {
        organizationId: input.organizationId,
        systemKey: dueTypeIncomeSystemKey(input.dueTypeId),
      },
    },
  });
  return account ?? getSystemAccount(tx, input.organizationId, OTHER_INCOME_KEY);
}

export async function getPaymentDepositAccount(
  tx: AccountingTx,
  input: { organizationId: string; paymentMethod?: string | null }
) {
  const systemKey = input.paymentMethod === "bank_transfer" ? BANK_ACCOUNT_KEY : CASH_ACCOUNT_KEY;
  return getSystemAccount(tx, input.organizationId, systemKey);
}

export async function createJournalEntry(
  tx: AccountingTx,
  input: {
    organizationId: string;
    entryDate: Date;
    entryType: AccountingJournalEntryType;
    description: string;
    referenceType?: string | null;
    referenceId?: string | null;
    isSystemEntry?: boolean;
    createdByUserId?: string | null;
    lines: JournalLineInput[];
  }
) {
  const lines = input.lines
    .map((line) => ({ ...line, amount: normalizeAmount(line.amount) }))
    .filter((line) => line.amount.gt(ZERO));
  assertBalanced(lines);

  return tx.accountingJournalEntry.create({
    data: {
      organizationId: input.organizationId,
      entryDate: input.entryDate,
      entryType: input.entryType,
      description: input.description,
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
      isSystemEntry: input.isSystemEntry ?? false,
      createdByUserId: input.createdByUserId ?? null,
      lines: {
        create: lines.map((line) => ({
          organizationId: input.organizationId,
          accountId: line.accountId,
          side: line.side,
          amount: line.amount,
          memo: line.memo ?? null,
        })),
      },
    },
    include: {
      lines: { include: { account: true } },
      createdBy: { select: { id: true, email: true } },
    },
  });
}

export async function postPaymentAccountingEntry(
  tx: AccountingTx,
  input: {
    paymentId: string;
    organizationId: string;
    paymentDate: Date;
    paymentMethod?: string | null;
    directDueTypeId?: string | null;
    directAppliedAmount: Decimal;
    creditAmount: Decimal;
    createdByUserId?: string | null;
    description?: string;
  }
) {
  const paymentAmount = input.directAppliedAmount.add(input.creditAmount);
  if (!paymentAmount.gt(ZERO)) return null;

  const existing = await tx.accountingJournalEntry.findFirst({
    where: {
      organizationId: input.organizationId,
      entryType: "payment",
      referenceType: "payment",
      referenceId: input.paymentId,
    },
  });
  if (existing) return existing;

  const depositAccount = await getPaymentDepositAccount(tx, {
    organizationId: input.organizationId,
    paymentMethod: input.paymentMethod,
  });
  const memberCreditAccount = await getSystemAccount(tx, input.organizationId, MEMBER_CREDIT_KEY);
  const incomeAccount = input.directAppliedAmount.gt(ZERO)
    ? await getDueTypeIncomeAccount(tx, {
        organizationId: input.organizationId,
        dueTypeId: input.directDueTypeId,
      })
    : null;

  return createJournalEntry(tx, {
    organizationId: input.organizationId,
    entryDate: input.paymentDate,
    entryType: "payment",
    description: input.description ?? "Payment received",
    referenceType: "payment",
    referenceId: input.paymentId,
    isSystemEntry: true,
    createdByUserId: input.createdByUserId ?? null,
    lines: [
      {
        accountId: depositAccount.id,
        side: "debit",
        amount: paymentAmount,
      },
      ...(incomeAccount
        ? [
            {
              accountId: incomeAccount.id,
              side: "credit" as const,
              amount: input.directAppliedAmount,
            },
          ]
        : []),
      {
        accountId: memberCreditAccount.id,
        side: "credit",
        amount: input.creditAmount,
      },
    ],
  });
}

export async function postCreditApplicationAccountingEntry(
  tx: AccountingTx,
  input: {
    organizationId: string;
    paymentDueId: string;
    dueTypeId?: string | null;
    amount: Decimal;
    entryDate?: Date;
    sourcePaymentId?: string | null;
    createdByUserId?: string | null;
  }
) {
  if (!input.amount.gt(ZERO)) return null;

  const memberCreditAccount = await getSystemAccount(tx, input.organizationId, MEMBER_CREDIT_KEY);
  const incomeAccount = await getDueTypeIncomeAccount(tx, {
    organizationId: input.organizationId,
    dueTypeId: input.dueTypeId,
  });

  return createJournalEntry(tx, {
    organizationId: input.organizationId,
    entryDate: input.entryDate ?? new Date(),
    entryType: "credit_application",
    description: "Member credit applied to due",
    referenceType: input.sourcePaymentId ? "payment_credit_application" : "credit_application",
    referenceId: input.sourcePaymentId ?? input.paymentDueId,
    isSystemEntry: true,
    createdByUserId: input.createdByUserId ?? null,
    lines: [
      {
        accountId: memberCreditAccount.id,
        side: "debit",
        amount: input.amount,
      },
      {
        accountId: incomeAccount.id,
        side: "credit",
        amount: input.amount,
      },
    ],
  });
}

export async function postPaymentCorrectionEntries(
  tx: AccountingTx,
  input: {
    organizationId: string;
    paymentId: string;
    entryDate: Date;
    createdByUserId?: string | null;
    reason: string;
  }
) {
  const originalEntries = await tx.accountingJournalEntry.findMany({
    where: {
      organizationId: input.organizationId,
      referenceId: input.paymentId,
      entryType: { in: ["payment", "credit_application"] },
    },
    include: { lines: true },
  });

  for (const original of originalEntries) {
    const existingCorrection = await tx.accountingJournalEntry.findFirst({
      where: {
        organizationId: input.organizationId,
        entryType: "payment_correction",
        referenceType: "journal_entry",
        referenceId: original.id,
      },
    });
    if (existingCorrection) continue;

    await createJournalEntry(tx, {
      organizationId: input.organizationId,
      entryDate: input.entryDate,
      entryType: "payment_correction",
      description: `Payment correction: ${input.reason}`,
      referenceType: "journal_entry",
      referenceId: original.id,
      isSystemEntry: true,
      createdByUserId: input.createdByUserId ?? null,
      lines: original.lines.map((line) => ({
        accountId: line.accountId,
        side: line.side === "debit" ? "credit" : "debit",
        amount: line.amount,
        memo: `Correction for ${original.description}`,
      })),
    });
  }
}

export async function accountBalances(tx: AccountingTx, organizationId: string, asOf?: Date) {
  await ensureDefaultAccountingAccounts(tx, organizationId);
  const accounts = await tx.accountingAccount.findMany({
    where: { organizationId },
    orderBy: [{ accountType: "asc" }, { name: "asc" }],
  });
  const lines = await tx.accountingJournalLine.groupBy({
    by: ["accountId", "side"],
    where: {
      organizationId,
      ...(asOf ? { journalEntry: { entryDate: { lte: asOf } } } : {}),
    },
    _sum: { amount: true },
  });

  const totals = new Map<string, { debit: Decimal; credit: Decimal }>();
  for (const line of lines) {
    const existing = totals.get(line.accountId) ?? { debit: ZERO, credit: ZERO };
    if (line.side === "debit") {
      existing.debit = existing.debit.add(line._sum.amount ?? ZERO);
    } else {
      existing.credit = existing.credit.add(line._sum.amount ?? ZERO);
    }
    totals.set(line.accountId, existing);
  }

  return accounts.map((account) => {
    const total = totals.get(account.id) ?? { debit: ZERO, credit: ZERO };
    return {
      ...account,
      debitTotal: total.debit,
      creditTotal: total.credit,
      balance: accountBalanceExpression(account.accountType, total.debit, total.credit),
    };
  });
}

export const ACCOUNTING_SYSTEM_KEYS = {
  cash: CASH_ACCOUNT_KEY,
  bank: BANK_ACCOUNT_KEY,
  memberCredit: MEMBER_CREDIT_KEY,
  generalExpense: GENERAL_EXPENSE_KEY,
  fundBalance: FUND_BALANCE_KEY,
  otherIncome: OTHER_INCOME_KEY,
};
