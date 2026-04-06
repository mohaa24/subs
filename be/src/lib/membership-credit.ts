import type { DueStatus, Prisma } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";

const ZERO = new Decimal(0);

export type CreditLedgerTx = Prisma.TransactionClient;

function maxDecimal(a: Decimal, b: Decimal): Decimal {
  return a.gte(b) ? a : b;
}

function minDecimal(a: Decimal, b: Decimal): Decimal {
  return a.lte(b) ? a : b;
}

function dueStatusForAmounts(amountDue: Decimal, amountPaid: Decimal): DueStatus {
  if (amountPaid.gte(amountDue)) return "paid";
  if (amountPaid.gt(ZERO)) return "partial";
  return "pending";
}

function isoDateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

export async function getMembershipCreditBalance(tx: CreditLedgerTx, membershipId: string): Promise<Decimal> {
  const aggregate = await tx.membershipCreditLedger.aggregate({
    where: { membershipId },
    _sum: { amountDelta: true },
  });
  return aggregate._sum.amountDelta ?? ZERO;
}

export async function addOverpaymentCreditEntry(
  tx: CreditLedgerTx,
  input: {
    membershipId: string;
    organizationId: string;
    paymentId: string;
    paymentDueId: string;
    amount: Decimal;
    createdByUserId?: string | null;
    note?: string | null;
  }
): Promise<void> {
  if (!input.amount.gt(ZERO)) return;

  await tx.membershipCreditLedger.create({
    data: {
      membershipId: input.membershipId,
      organizationId: input.organizationId,
      paymentId: input.paymentId,
      paymentDueId: input.paymentDueId,
      amountDelta: input.amount,
      entryType: "credit_overpayment",
      note: input.note ?? "Overpayment moved to member credit",
      createdByUserId: input.createdByUserId ?? null,
    },
  });
}

export async function applyAvailableCreditToDue(
  tx: CreditLedgerTx,
  input: {
    dueId: string;
    createdByUserId?: string | null;
    note?: string | null;
  }
): Promise<Decimal> {
  const due = await tx.paymentDue.findUnique({
    where: { id: input.dueId },
    select: {
      id: true,
      membershipId: true,
      organizationId: true,
      period: true,
      amountDue: true,
      amountPaid: true,
    },
  });

  if (!due) throw new Error("Due not found while applying member credit");

  const remaining = maxDecimal(due.amountDue.sub(due.amountPaid), ZERO);
  if (!remaining.gt(ZERO)) return ZERO;

  const creditBalance = await getMembershipCreditBalance(tx, due.membershipId);
  const applyAmount = minDecimal(remaining, creditBalance);
  if (!applyAmount.gt(ZERO)) return ZERO;

  const creditEntries = await tx.membershipCreditLedger.findMany({
    where: { membershipId: due.membershipId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      paymentId: true,
      amountDelta: true,
    },
  });

  const availableLots: Array<{ paymentId: string | null; remaining: Decimal }> = [];
  for (const entry of creditEntries) {
    if (entry.amountDelta.gt(ZERO)) {
      availableLots.push({
        paymentId: entry.paymentId ?? null,
        remaining: entry.amountDelta,
      });
      continue;
    }

    if (!entry.amountDelta.lt(ZERO)) continue;

    let remainingToConsume = entry.amountDelta.abs();
    for (const lot of availableLots) {
      if (!remainingToConsume.gt(ZERO)) break;
      if (!lot.remaining.gt(ZERO)) continue;

      const consumed = minDecimal(lot.remaining, remainingToConsume);
      lot.remaining = lot.remaining.sub(consumed);
      remainingToConsume = remainingToConsume.sub(consumed);
    }
  }

  const nextPaid = due.amountPaid.add(applyAmount);

  await tx.paymentDue.update({
    where: { id: due.id },
    data: {
      amountPaid: nextPaid,
      status: dueStatusForAmounts(due.amountDue, nextPaid),
    },
  });

  let remainingToApply = applyAmount;
  for (const lot of availableLots) {
    if (!remainingToApply.gt(ZERO)) break;
    if (!lot.remaining.gt(ZERO)) continue;

    const consumed = minDecimal(lot.remaining, remainingToApply);
    if (!consumed.gt(ZERO)) continue;

    await tx.membershipCreditLedger.create({
      data: {
        membershipId: due.membershipId,
        organizationId: due.organizationId,
        paymentId: lot.paymentId,
        paymentDueId: due.id,
        amountDelta: consumed.neg(),
        entryType: "debit_auto_apply",
        note: input.note ?? `Auto-applied credit to due ${due.period}`,
        createdByUserId: input.createdByUserId ?? null,
      },
    });

    lot.remaining = lot.remaining.sub(consumed);
    remainingToApply = remainingToApply.sub(consumed);
  }

  if (remainingToApply.gt(ZERO)) {
    await tx.membershipCreditLedger.create({
      data: {
        membershipId: due.membershipId,
        organizationId: due.organizationId,
        paymentDueId: due.id,
        amountDelta: remainingToApply.neg(),
        entryType: "debit_auto_apply",
        note: input.note ?? `Auto-applied credit to due ${due.period}`,
        createdByUserId: input.createdByUserId ?? null,
      },
    });
  }

  return applyAmount;
}

export async function moveNegativeCreditBalanceToDue(
  tx: CreditLedgerTx,
  input: {
    membershipId: string;
    organizationId: string;
    createdByUserId?: string | null;
    dueDate?: Date;
    period?: string | null;
    dueReason?: string | null;
    ledgerNote?: string | null;
  }
): Promise<Decimal> {
  const creditBalance = await getMembershipCreditBalance(tx, input.membershipId);
  if (!creditBalance.lt(ZERO)) return ZERO;

  const transferAmount = creditBalance.abs();
  const dueDate = input.dueDate ?? new Date();

  const due = await tx.paymentDue.create({
    data: {
      membershipId: input.membershipId,
      organizationId: input.organizationId,
      dueDate,
      period: input.period?.trim() || `Credit transfer ${isoDateOnly(dueDate)}`,
      isManual: true,
      reason: input.dueReason?.trim() || "Credit Balance Transfer",
      amountDue: transferAmount,
      amountPaid: ZERO,
      status: "pending",
    },
  });

  await tx.membershipCreditLedger.create({
    data: {
      membershipId: input.membershipId,
      organizationId: input.organizationId,
      paymentDueId: due.id,
      amountDelta: transferAmount,
      entryType: "credit_adjustment",
      note:
        input.ledgerNote?.trim() ||
        `Negative credit balance moved to due ${due.period}`,
      createdByUserId: input.createdByUserId ?? null,
    },
  });

  return transferAmount;
}

export async function restoreAutoAppliedCreditForPaymentReversal(
  tx: CreditLedgerTx,
  input: {
    membershipId: string;
    organizationId: string;
    paymentId: string;
    createdByUserId?: string | null;
    reason: string;
  }
): Promise<Decimal> {
  const directAutoApplyEntries = await tx.membershipCreditLedger.findMany({
    where: {
      membershipId: input.membershipId,
      paymentId: input.paymentId,
      entryType: "debit_auto_apply",
      paymentDueId: { not: null },
    },
    select: {
      paymentDueId: true,
      amountDelta: true,
    },
  });

  const directRestoredByDueId = new Map<string, Decimal>();
  for (const entry of directAutoApplyEntries) {
    if (!entry.paymentDueId) continue;
    directRestoredByDueId.set(
      entry.paymentDueId,
      (directRestoredByDueId.get(entry.paymentDueId) ?? ZERO).add(entry.amountDelta.abs())
    );
  }

  if (directRestoredByDueId.size > 0) {
    return restoreCreditIntoDues(tx, {
      membershipId: input.membershipId,
      organizationId: input.organizationId,
      paymentId: input.paymentId,
      createdByUserId: input.createdByUserId,
      reason: input.reason,
      restoredByDueId: directRestoredByDueId,
    });
  }

  const ledgerEntries = await tx.membershipCreditLedger.findMany({
    where: { membershipId: input.membershipId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      paymentId: true,
      paymentDueId: true,
      amountDelta: true,
      entryType: true,
    },
  });

  const availableLots: Array<{ paymentId: string | null; remaining: Decimal }> = [];
  const restoredByDueId = new Map<string, Decimal>();

  for (const entry of ledgerEntries) {
    if (entry.amountDelta.gt(ZERO)) {
      availableLots.push({
        paymentId: entry.paymentId ?? null,
        remaining: entry.amountDelta,
      });
      continue;
    }

    if (!entry.amountDelta.lt(ZERO)) continue;

    let remainingToConsume = entry.amountDelta.abs();
    for (const lot of availableLots) {
      if (!remainingToConsume.gt(ZERO)) break;
      if (!lot.remaining.gt(ZERO)) continue;

      const consumed = minDecimal(lot.remaining, remainingToConsume);
      if (
        entry.entryType === "debit_auto_apply" &&
        entry.paymentDueId &&
        lot.paymentId === input.paymentId
      ) {
        restoredByDueId.set(
          entry.paymentDueId,
          (restoredByDueId.get(entry.paymentDueId) ?? ZERO).add(consumed)
        );
      }

      lot.remaining = lot.remaining.sub(consumed);
      remainingToConsume = remainingToConsume.sub(consumed);
    }
  }

  if (restoredByDueId.size === 0) return ZERO;

  return restoreCreditIntoDues(tx, {
    membershipId: input.membershipId,
    organizationId: input.organizationId,
    paymentId: input.paymentId,
    createdByUserId: input.createdByUserId,
    reason: input.reason,
    restoredByDueId,
  });
}

async function restoreCreditIntoDues(
  tx: CreditLedgerTx,
  input: {
    membershipId: string;
    organizationId: string;
    paymentId: string;
    createdByUserId?: string | null;
    reason: string;
    restoredByDueId: Map<string, Decimal>;
  }
): Promise<Decimal> {
  const affectedDueIds = Array.from(input.restoredByDueId.keys());
  const affectedDues = await tx.paymentDue.findMany({
    where: { id: { in: affectedDueIds } },
    select: {
      id: true,
      period: true,
      amountDue: true,
      amountPaid: true,
      status: true,
    },
  });
  const dueById = new Map(affectedDues.map((due) => [due.id, due]));

  let totalRestored = ZERO;

  for (const dueId of affectedDueIds) {
    const due = dueById.get(dueId);
    const requestedRestore = input.restoredByDueId.get(dueId) ?? ZERO;
    if (!due || !requestedRestore.gt(ZERO)) continue;

    const actualRestore = minDecimal(due.amountPaid, requestedRestore);
    if (!actualRestore.gt(ZERO)) continue;

    const nextPaid = maxDecimal(due.amountPaid.sub(actualRestore), ZERO);
    let nextStatus = dueStatusForAmounts(due.amountDue, nextPaid);
    if (due.status === "overdue" && nextStatus !== "paid") {
      nextStatus = "overdue";
    }

    await tx.paymentDue.update({
      where: { id: due.id },
      data: {
        amountPaid: nextPaid,
        status: nextStatus,
      },
    });

    await tx.membershipCreditLedger.create({
      data: {
        membershipId: input.membershipId,
        organizationId: input.organizationId,
        paymentId: input.paymentId,
        paymentDueId: due.id,
        amountDelta: actualRestore,
        entryType: "credit_adjustment",
        note: `Restored auto-applied credit while reversing payment: ${input.reason}`,
        createdByUserId: input.createdByUserId ?? null,
      },
    });

    totalRestored = totalRestored.add(actualRestore);
  }

  return totalRestored;
}
