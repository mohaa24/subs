import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "../lib/prisma.js";
import {
  createJournalEntry,
  getDueTypeIncomeAccount,
  getSystemAccount,
  postPaymentAccountingEntry,
  ACCOUNTING_SYSTEM_KEYS,
} from "../lib/accounting.js";

const ZERO = new Decimal(0);
const APPLY_FLAG = "--apply";

function decimal(value: Decimal | number | string | null | undefined) {
  if (!value) return ZERO;
  return value instanceof Decimal ? value : new Decimal(value);
}

function minDecimal(a: Decimal, b: Decimal) {
  return a.lte(b) ? a : b;
}

function addMoney(summary: Record<string, Decimal>, key: string, amount: Decimal) {
  summary[key] = (summary[key] ?? ZERO).add(amount);
}

function addOrgMoney(summary: Map<string, Decimal>, organizationId: string, amount: Decimal) {
  summary.set(organizationId, (summary.get(organizationId) ?? ZERO).add(amount));
}

function money(value: Decimal) {
  return Number(value.toFixed(2));
}

async function existingHistoricalCreditApplication(input: {
  organizationId: string;
  referenceType: string;
  referenceId: string;
  description: string;
}) {
  return prisma.accountingJournalEntry.findFirst({
    where: {
      organizationId: input.organizationId,
      entryType: "credit_application",
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      description: input.description,
    },
    select: { id: true },
  });
}

async function loadSourceData() {
  const [payments, allocations, creditLedger, creditLedgerByOrg, creditAdjustments, currentEntries, currentLines] =
    await Promise.all([
      prisma.payment.findMany({
        where: { isReversed: false },
        orderBy: [{ paymentDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        include: {
          paymentDue: {
            select: {
              id: true,
              dueTypeId: true,
              dueType: { select: { name: true } },
            },
          },
          creditEntries: {
            where: { amountDelta: { gt: ZERO } },
            select: { amountDelta: true, entryType: true },
          },
        },
      }),
      prisma.membershipCreditAllocation.findMany({
        where: { reversedAt: null },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        include: {
          paymentDue: {
            select: {
              id: true,
              dueTypeId: true,
              dueType: { select: { name: true } },
            },
          },
        },
      }),
      prisma.membershipCreditLedger.aggregate({
        _count: true,
        _sum: { amountDelta: true },
      }),
      prisma.membershipCreditLedger.groupBy({
        by: ["organizationId"],
        _sum: { amountDelta: true },
      }),
      prisma.membershipCreditLedger.aggregate({
        where: {
          entryType: { in: ["credit_adjustment", "debit_adjustment"] },
        },
        _count: true,
        _sum: { amountDelta: true },
      }),
      prisma.accountingJournalEntry.count(),
      prisma.accountingJournalLine.count(),
    ]);

  return {
    payments,
    allocations,
    creditLedger,
    creditLedgerByOrg,
    creditAdjustments,
    currentEntries,
    currentLines,
  };
}

function paymentSplit(payment: Awaited<ReturnType<typeof loadSourceData>>["payments"][number]) {
  const amount = decimal(payment.amount);
  const positiveCreditLedger = payment.creditEntries.reduce(
    (sum, entry) => sum.add(entry.amountDelta),
    ZERO
  );
  const creditAmount =
    payment.paymentKind === "credit" || !payment.paymentDueId
      ? amount
      : minDecimal(positiveCreditLedger, amount);
  const directAppliedAmount = amount.sub(creditAmount);

  return { amount, creditAmount, directAppliedAmount };
}

async function dryRun() {
  const data = await loadSourceData();
  const totals: Record<string, Decimal> = {};
  let paymentEntriesToCreate = 0;
  let paymentEntriesExisting = 0;
  let creditApplicationsToCreate = 0;
  let creditApplicationsExisting = 0;
  let memberCreditReconciliationToCreate = 0;
  let memberCreditReconciliationExisting = 0;
  const plannedMemberCreditByOrg = new Map<string, Decimal>();

  const paymentEntryRows = await prisma.accountingJournalEntry.findMany({
    where: {
      entryType: "payment",
      referenceType: "payment",
      referenceId: { in: data.payments.map((payment) => payment.id) },
    },
    select: { referenceId: true },
  });
  const existingPaymentIds = new Set(paymentEntryRows.map((entry) => entry.referenceId));

  for (const payment of data.payments) {
    const split = paymentSplit(payment);
    addMoney(totals, "paymentCashOrBankDebit", split.amount);
    addMoney(totals, "directIncomeCredit", split.directAppliedAmount);
    addMoney(totals, "memberCreditCredit", split.creditAmount);
    addOrgMoney(plannedMemberCreditByOrg, payment.organizationId, split.creditAmount);

    if (existingPaymentIds.has(payment.id)) paymentEntriesExisting += 1;
    else paymentEntriesToCreate += 1;
  }

  for (const allocation of data.allocations) {
    const amount = decimal(allocation.amount);
    if (!amount.gt(ZERO)) continue;

    const referenceType = allocation.sourcePaymentId
      ? "historical_payment_credit_application"
      : "historical_credit_allocation";
    const referenceId = allocation.sourcePaymentId ?? allocation.id;
    const description = `Historical member credit applied to due ${allocation.paymentDueId} (${allocation.id})`;
    const existing = await existingHistoricalCreditApplication({
      organizationId: allocation.organizationId,
      referenceType,
      referenceId,
      description,
    });

    addMoney(totals, "memberCreditDebit", amount);
    addMoney(totals, "creditApplicationIncomeCredit", amount);
    addOrgMoney(plannedMemberCreditByOrg, allocation.organizationId, amount.neg());

    if (existing) creditApplicationsExisting += 1;
    else creditApplicationsToCreate += 1;
  }

  const actualMemberCreditByOrg = new Map(
    data.creditLedgerByOrg.map((row) => [row.organizationId, row._sum.amountDelta ?? ZERO])
  );
  const orgIds = new Set([...plannedMemberCreditByOrg.keys(), ...actualMemberCreditByOrg.keys()]);
  let plannedMemberCreditBalance = ZERO;
  let actualMemberCreditBalance = ZERO;
  let memberCreditReconciliationAmount = ZERO;
  for (const organizationId of orgIds) {
    const plannedForOrg = plannedMemberCreditByOrg.get(organizationId) ?? ZERO;
    const actualForOrg = actualMemberCreditByOrg.get(organizationId) ?? ZERO;
    const reconciliationForOrg = actualForOrg.sub(plannedForOrg);
    plannedMemberCreditBalance = plannedMemberCreditBalance.add(plannedForOrg);
    actualMemberCreditBalance = actualMemberCreditBalance.add(actualForOrg);
    memberCreditReconciliationAmount = memberCreditReconciliationAmount.add(reconciliationForOrg);
    if (reconciliationForOrg.equals(ZERO)) continue;

    const existingReconciliation = await prisma.accountingJournalEntry.findFirst({
      where: {
        organizationId,
        entryType: "manual_adjustment",
        referenceType: "historical_member_credit_reconciliation",
        referenceId: `membership-credit-ledger-total:${organizationId}`,
      },
      select: { id: true },
    });
    if (existingReconciliation) memberCreditReconciliationExisting += 1;
    else memberCreditReconciliationToCreate += 1;
  }

  return {
    mode: "dry-run",
    source: {
      activePayments: data.payments.length,
      activeCreditAllocations: data.allocations.length,
      existingAccountingEntries: data.currentEntries,
      existingAccountingLines: data.currentLines,
      creditLedgerRows: data.creditLedger._count,
      creditLedgerBalance: money(actualMemberCreditBalance),
      creditAdjustmentRows: data.creditAdjustments._count,
      creditAdjustmentNetAmount: money(data.creditAdjustments._sum.amountDelta ?? ZERO),
    },
    planned: {
      paymentEntriesToCreate,
      paymentEntriesExisting,
      creditApplicationsToCreate,
      creditApplicationsExisting,
      memberCreditReconciliationToCreate,
      memberCreditReconciliationExisting,
    },
    totals: {
      ...Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, money(value)])),
      plannedMemberCreditBalance: money(plannedMemberCreditBalance),
      memberCreditReconciliationAmount: money(memberCreditReconciliationAmount),
      finalMemberCreditBalanceAfterReconciliation: money(
        plannedMemberCreditBalance.add(memberCreditReconciliationAmount)
      ),
    },
    warnings: [
      data.creditAdjustments._count > 0
        ? "Credit adjustment ledger rows are reconciled as one historical Fund Balance adjustment rather than guessed individually."
        : null,
    ].filter(Boolean),
  };
}

async function applyBackfill() {
  const data = await loadSourceData();
  let paymentEntriesCreated = 0;
  let paymentEntriesSkipped = 0;
  let creditApplicationsCreated = 0;
  let creditApplicationsSkipped = 0;
  let memberCreditReconciliationCreated = 0;
  let memberCreditReconciliationSkipped = 0;

  for (const payment of data.payments) {
    const split = paymentSplit(payment);
    const existing = await prisma.accountingJournalEntry.findFirst({
      where: {
        organizationId: payment.organizationId,
        entryType: "payment",
        referenceType: "payment",
        referenceId: payment.id,
      },
      select: { id: true },
    });
    if (existing) {
      paymentEntriesSkipped += 1;
      continue;
    }

    await prisma.$transaction((tx) =>
      postPaymentAccountingEntry(tx, {
        paymentId: payment.id,
        organizationId: payment.organizationId,
        paymentDate: payment.paymentDate,
        paymentMethod: payment.paymentMethod,
        directDueTypeId: split.directAppliedAmount.gt(ZERO) ? payment.paymentDue?.dueTypeId : null,
        directAppliedAmount: split.directAppliedAmount,
        creditAmount: split.creditAmount,
        createdByUserId: payment.collectedByUserId,
        description:
          payment.paymentKind === "credit"
            ? "Historical credit payment received"
            : `Historical payment received for ${payment.paymentDue?.dueType?.name ?? "due"}`,
      })
    );
    paymentEntriesCreated += 1;
  }

  for (const allocation of data.allocations) {
    const amount = decimal(allocation.amount);
    if (!amount.gt(ZERO)) continue;

    const referenceType = allocation.sourcePaymentId
      ? "historical_payment_credit_application"
      : "historical_credit_allocation";
    const referenceId = allocation.sourcePaymentId ?? allocation.id;
    const description = `Historical member credit applied to due ${allocation.paymentDueId} (${allocation.id})`;
    const existing = await existingHistoricalCreditApplication({
      organizationId: allocation.organizationId,
      referenceType,
      referenceId,
      description,
    });
    if (existing) {
      creditApplicationsSkipped += 1;
      continue;
    }

    await prisma.$transaction(async (tx) => {
      const memberCreditAccount = await getSystemAccount(
        tx,
        allocation.organizationId,
        ACCOUNTING_SYSTEM_KEYS.memberCredit
      );
      const incomeAccount = await getDueTypeIncomeAccount(tx, {
        organizationId: allocation.organizationId,
        dueTypeId: allocation.paymentDue.dueTypeId,
      });

      await createJournalEntry(tx, {
        organizationId: allocation.organizationId,
        entryDate: allocation.createdAt,
        entryType: "credit_application",
        description,
        referenceType,
        referenceId,
        isSystemEntry: true,
        createdByUserId: allocation.createdByUserId,
        lines: [
          {
            accountId: memberCreditAccount.id,
            side: "debit",
            amount,
          },
          {
            accountId: incomeAccount.id,
            side: "credit",
            amount,
          },
        ],
      });
    });
    creditApplicationsCreated += 1;
  }

  const [creditLedgerBalanceByOrg, memberCreditLines] = await Promise.all([
    prisma.membershipCreditLedger.groupBy({
      by: ["organizationId"],
      _sum: { amountDelta: true },
    }),
    prisma.accountingJournalLine.findMany({
      where: {
        account: {
          systemKey: ACCOUNTING_SYSTEM_KEYS.memberCredit,
        },
      },
      select: { side: true, amount: true, organizationId: true },
    }),
  ]);
  const accountingMemberCreditByOrg = new Map<string, Decimal>();
  for (const line of memberCreditLines) {
    addOrgMoney(
      accountingMemberCreditByOrg,
      line.organizationId,
      line.side === "credit" ? line.amount : line.amount.neg()
    );
  }
  const targetMemberCreditByOrg = new Map(
    creditLedgerBalanceByOrg.map((row) => [row.organizationId, row._sum.amountDelta ?? ZERO])
  );
  const reconciliationOrgIds = new Set([
    ...accountingMemberCreditByOrg.keys(),
    ...targetMemberCreditByOrg.keys(),
  ]);

  for (const organizationId of reconciliationOrgIds) {
    const reconciliationAmount = (targetMemberCreditByOrg.get(organizationId) ?? ZERO).sub(
      accountingMemberCreditByOrg.get(organizationId) ?? ZERO
    );
    if (reconciliationAmount.equals(ZERO)) continue;

    const existingReconciliation = await prisma.accountingJournalEntry.findFirst({
      where: {
        organizationId,
        entryType: "manual_adjustment",
        referenceType: "historical_member_credit_reconciliation",
        referenceId: `membership-credit-ledger-total:${organizationId}`,
      },
      select: { id: true },
    });

    if (existingReconciliation) {
      memberCreditReconciliationSkipped += 1;
    } else {
      await prisma.$transaction(async (tx) => {
        const memberCreditAccount = await getSystemAccount(
          tx,
          organizationId,
          ACCOUNTING_SYSTEM_KEYS.memberCredit
        );
        const fundBalanceAccount = await getSystemAccount(
          tx,
          organizationId,
          ACCOUNTING_SYSTEM_KEYS.fundBalance
        );
        const amount = reconciliationAmount.abs();
        await createJournalEntry(tx, {
          organizationId: memberCreditAccount.organizationId,
          entryDate: new Date(),
          entryType: "manual_adjustment",
          description: "Historical member credit ledger reconciliation",
          referenceType: "historical_member_credit_reconciliation",
          referenceId: `membership-credit-ledger-total:${organizationId}`,
          isSystemEntry: true,
          lines:
            reconciliationAmount.gt(ZERO)
              ? [
                  { accountId: fundBalanceAccount.id, side: "debit", amount },
                  { accountId: memberCreditAccount.id, side: "credit", amount },
                ]
              : [
                  { accountId: memberCreditAccount.id, side: "debit", amount },
                  { accountId: fundBalanceAccount.id, side: "credit", amount },
                ],
        });
      });
      memberCreditReconciliationCreated += 1;
    }
  }

  const [finalEntries, finalLines] = await Promise.all([
    prisma.accountingJournalEntry.count(),
    prisma.accountingJournalLine.count(),
  ]);

  return {
    mode: "apply",
    created: {
      paymentEntriesCreated,
      creditApplicationsCreated,
      memberCreditReconciliationCreated,
    },
    skipped: {
      paymentEntriesSkipped,
      creditApplicationsSkipped,
      memberCreditReconciliationSkipped,
    },
    final: {
      accountingEntries: finalEntries,
      accountingLines: finalLines,
    },
  };
}

async function main() {
  const shouldApply = process.argv.includes(APPLY_FLAG);
  const result = shouldApply ? await applyBackfill() : await dryRun();
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
