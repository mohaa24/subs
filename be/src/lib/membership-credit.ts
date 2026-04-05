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

  const nextPaid = due.amountPaid.add(applyAmount);

  await tx.paymentDue.update({
    where: { id: due.id },
    data: {
      amountPaid: nextPaid,
      status: dueStatusForAmounts(due.amountDue, nextPaid),
    },
  });

  await tx.membershipCreditLedger.create({
    data: {
      membershipId: due.membershipId,
      organizationId: due.organizationId,
      paymentDueId: due.id,
      amountDelta: applyAmount.neg(),
      entryType: "debit_auto_apply",
      note: input.note ?? `Auto-applied credit to due ${due.period}`,
      createdByUserId: input.createdByUserId ?? null,
    },
  });

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
