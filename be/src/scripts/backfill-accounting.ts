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
  const [payments, allocations, creditAdjustments, currentEntries, currentLines] =
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
        where: {
          entryType: { in: ["credit_adjustment", "debit_adjustment"] },
        },
        _count: true,
        _sum: { amountDelta: true },
      }),
      prisma.accountingJournalEntry.count(),
      prisma.accountingJournalLine.count(),
    ]);

  return { payments, allocations, creditAdjustments, currentEntries, currentLines };
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

    if (existing) creditApplicationsExisting += 1;
    else creditApplicationsToCreate += 1;
  }

  return {
    mode: "dry-run",
    source: {
      activePayments: data.payments.length,
      activeCreditAllocations: data.allocations.length,
      existingAccountingEntries: data.currentEntries,
      existingAccountingLines: data.currentLines,
      creditAdjustmentRows: data.creditAdjustments._count,
      creditAdjustmentNetAmount: money(data.creditAdjustments._sum.amountDelta ?? ZERO),
    },
    planned: {
      paymentEntriesToCreate,
      paymentEntriesExisting,
      creditApplicationsToCreate,
      creditApplicationsExisting,
    },
    totals: Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, money(value)])),
    warnings: [
      data.creditAdjustments._count > 0
        ? "Credit adjustment ledger rows are reported but not backfilled by this first-pass script."
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

  const [finalEntries, finalLines] = await Promise.all([
    prisma.accountingJournalEntry.count(),
    prisma.accountingJournalLine.count(),
  ]);

  return {
    mode: "apply",
    created: {
      paymentEntriesCreated,
      creditApplicationsCreated,
    },
    skipped: {
      paymentEntriesSkipped,
      creditApplicationsSkipped,
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
