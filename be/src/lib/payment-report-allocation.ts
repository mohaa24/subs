import type { Prisma, PrismaClient } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";

type ReportingTx = PrismaClient | Prisma.TransactionClient;

export type PaymentAllocationInput = {
  id: string;
  amount: Decimal;
  paymentKind: "due" | "credit";
  paymentDueId: string | null;
  reversedAt: Date | null;
  paymentDue: {
    dueType: {
      id: string;
      name: string;
      systemKey: string | null;
      sortOrder: number;
    };
  } | null;
};

export type PaymentAllocationComponent = {
  key: string;
  dueTypeId: string | null;
  dueTypeName: string;
  dueTypeSystemKey: string | null;
  sortOrder: number;
  amount: Decimal;
  isCreditBalance: boolean;
};

const ZERO = new Decimal(0);

function minDecimal(left: Decimal, right: Decimal) {
  return left.lte(right) ? left : right;
}

function maxDecimal(left: Decimal, right: Decimal) {
  return left.gte(right) ? left : right;
}

/**
 * Resolves where each payment was allocated as of the report end date. If a
 * payment was reversed before that date, its allocation immediately before the
 * reversal is retained so the receipt and reversal can use the same breakdown.
 */
export async function loadPaymentAllocationBreakdowns(
  tx: ReportingTx,
  payments: PaymentAllocationInput[],
  reportEnd: Date
) {
  const paymentIds = payments.map((payment) => payment.id);
  if (paymentIds.length === 0) return new Map<string, PaymentAllocationComponent[]>();

  const [overpaymentRows, allocations] = await Promise.all([
    tx.membershipCreditLedger.groupBy({
      by: ["paymentId"],
      where: {
        paymentId: { in: paymentIds },
        entryType: "credit_overpayment",
      },
      _sum: { amountDelta: true },
    }),
    tx.membershipCreditAllocation.findMany({
      where: {
        sourcePaymentId: { in: paymentIds },
        createdAt: { lte: reportEnd },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        sourcePaymentId: true,
        amount: true,
        createdAt: true,
        reversedAt: true,
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

  const overpaymentByPaymentId = new Map<string, Decimal>();
  for (const row of overpaymentRows) {
    if (!row.paymentId) continue;
    overpaymentByPaymentId.set(
      row.paymentId,
      maxDecimal(row._sum.amountDelta ?? ZERO, ZERO)
    );
  }

  const allocationsByPaymentId = new Map<string, typeof allocations>();
  for (const allocation of allocations) {
    if (!allocation.sourcePaymentId) continue;
    const rows = allocationsByPaymentId.get(allocation.sourcePaymentId) ?? [];
    rows.push(allocation);
    allocationsByPaymentId.set(allocation.sourcePaymentId, rows);
  }

  const result = new Map<string, PaymentAllocationComponent[]>();
  for (const payment of payments) {
    const paymentAmount = new Decimal(payment.amount);
    const allocationCutoff = payment.reversedAt && payment.reversedAt <= reportEnd
      ? payment.reversedAt
      : reportEnd;
    const creditCreated = minDecimal(
      overpaymentByPaymentId.get(payment.id)
        ?? (payment.paymentKind === "credit" || !payment.paymentDueId ? paymentAmount : ZERO),
      paymentAmount
    );
    const directApplied = payment.paymentKind === "credit" || !payment.paymentDueId
      ? ZERO
      : maxDecimal(paymentAmount.sub(creditCreated), ZERO);
    const components: PaymentAllocationComponent[] = [];

    if (directApplied.gt(ZERO) && payment.paymentDue?.dueType) {
      const dueType = payment.paymentDue.dueType;
      components.push({
        key: `due-type-${dueType.id}`,
        dueTypeId: dueType.id,
        dueTypeName: dueType.name,
        dueTypeSystemKey: dueType.systemKey,
        sortOrder: dueType.sortOrder,
        amount: directApplied,
        isCreditBalance: false,
      });
    }

    let remainingCredit = maxDecimal(paymentAmount.sub(directApplied), ZERO);
    for (const allocation of allocationsByPaymentId.get(payment.id) ?? []) {
      const existedAtCutoff = allocation.createdAt <= allocationCutoff;
      const activeAtCutoff = !allocation.reversedAt || allocation.reversedAt >= allocationCutoff;
      if (!existedAtCutoff || !activeAtCutoff || !remainingCredit.gt(ZERO)) continue;

      const allocatedAmount = minDecimal(allocation.amount, remainingCredit);
      const dueType = allocation.paymentDue.dueType;
      components.push({
        key: `due-type-${dueType.id}`,
        dueTypeId: dueType.id,
        dueTypeName: dueType.name,
        dueTypeSystemKey: dueType.systemKey,
        sortOrder: dueType.sortOrder,
        amount: allocatedAmount,
        isCreditBalance: false,
      });
      remainingCredit = remainingCredit.sub(allocatedAmount);
    }

    if (remainingCredit.gt(ZERO)) {
      components.push({
        key: "credit-balance",
        dueTypeId: null,
        dueTypeName: "Credit balance",
        dueTypeSystemKey: null,
        sortOrder: Number.MAX_SAFE_INTEGER,
        amount: remainingCredit,
        isCreditBalance: true,
      });
    }

    const combined = new Map<string, PaymentAllocationComponent>();
    for (const component of components) {
      const existing = combined.get(component.key);
      if (existing) existing.amount = existing.amount.add(component.amount);
      else combined.set(component.key, { ...component });
    }
    result.set(payment.id, [...combined.values()]);
  }

  return result;
}
