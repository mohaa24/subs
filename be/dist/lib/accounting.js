"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ACCOUNTING_SYSTEM_KEYS = void 0;
exports.accountNormalBalance = accountNormalBalance;
exports.accountBalanceExpression = accountBalanceExpression;
exports.ensureDefaultAccountingAccounts = ensureDefaultAccountingAccounts;
exports.dueTypeIncomeSystemKey = dueTypeIncomeSystemKey;
exports.getSystemAccount = getSystemAccount;
exports.getDueTypeIncomeAccount = getDueTypeIncomeAccount;
exports.getPaymentDepositAccount = getPaymentDepositAccount;
exports.createJournalEntry = createJournalEntry;
exports.postPaymentAccountingEntry = postPaymentAccountingEntry;
exports.postCreditApplicationAccountingEntry = postCreditApplicationAccountingEntry;
exports.postPaymentCorrectionEntries = postPaymentCorrectionEntries;
exports.accountBalances = accountBalances;
const library_1 = require("@prisma/client/runtime/library");
const ZERO = new library_1.Decimal(0);
const CASH_ACCOUNT_KEY = "asset_cash_on_hand";
const BANK_ACCOUNT_KEY = "asset_bank_account";
const MEMBER_CREDIT_KEY = "liability_member_credit";
const GENERAL_EXPENSE_KEY = "expense_general";
const FUND_BALANCE_KEY = "equity_fund_balance";
const OTHER_INCOME_KEY = "income_other";
const DEFAULT_ACCOUNTS = [
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
function normalizeAmount(amount) {
    return amount instanceof library_1.Decimal ? amount : new library_1.Decimal(amount);
}
function assertBalanced(lines) {
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
function accountNormalBalance(accountType) {
    return accountType === "asset" || accountType === "expense" ? "debit" : "credit";
}
function accountBalanceExpression(accountType, debit, credit) {
    return accountNormalBalance(accountType) === "debit" ? debit.sub(credit) : credit.sub(debit);
}
async function nextAvailableAccountName(tx, organizationId, baseName, excludeId) {
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
        if (!existing)
            return candidate;
    }
    return `${baseName} ${Date.now()}`;
}
async function ensureSystemAccount(tx, organizationId, account) {
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
async function ensureDefaultAccountingAccounts(tx, organizationId) {
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
function dueTypeIncomeSystemKey(dueTypeId) {
    return `income_due_type_${dueTypeId}`;
}
async function getSystemAccount(tx, organizationId, systemKey) {
    await ensureDefaultAccountingAccounts(tx, organizationId);
    const account = await tx.accountingAccount.findUnique({
        where: {
            organizationId_systemKey: {
                organizationId,
                systemKey,
            },
        },
    });
    if (!account)
        throw new Error(`Missing accounting system account ${systemKey}`);
    return account;
}
async function getDueTypeIncomeAccount(tx, input) {
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
async function getPaymentDepositAccount(tx, input) {
    const systemKey = input.paymentMethod === "bank_transfer" ? BANK_ACCOUNT_KEY : CASH_ACCOUNT_KEY;
    return getSystemAccount(tx, input.organizationId, systemKey);
}
async function createJournalEntry(tx, input) {
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
async function postPaymentAccountingEntry(tx, input) {
    const paymentAmount = input.directAppliedAmount.add(input.creditAmount);
    if (!paymentAmount.gt(ZERO))
        return null;
    const existing = await tx.accountingJournalEntry.findFirst({
        where: {
            organizationId: input.organizationId,
            entryType: "payment",
            referenceType: "payment",
            referenceId: input.paymentId,
        },
    });
    if (existing)
        return existing;
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
                        side: "credit",
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
async function postCreditApplicationAccountingEntry(tx, input) {
    if (!input.amount.gt(ZERO))
        return null;
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
async function postPaymentCorrectionEntries(tx, input) {
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
        if (existingCorrection)
            continue;
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
async function accountBalances(tx, organizationId, asOf) {
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
    const totals = new Map();
    for (const line of lines) {
        const existing = totals.get(line.accountId) ?? { debit: ZERO, credit: ZERO };
        if (line.side === "debit") {
            existing.debit = existing.debit.add(line._sum.amount ?? ZERO);
        }
        else {
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
exports.ACCOUNTING_SYSTEM_KEYS = {
    cash: CASH_ACCOUNT_KEY,
    bank: BANK_ACCOUNT_KEY,
    memberCredit: MEMBER_CREDIT_KEY,
    generalExpense: GENERAL_EXPENSE_KEY,
    fundBalance: FUND_BALANCE_KEY,
    otherIncome: OTHER_INCOME_KEY,
};
