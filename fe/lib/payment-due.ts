import type { PaymentDue } from "@/lib/api";

type PaymentDueDisplayInput = Pick<
  PaymentDue,
  "period" | "reason" | "dueType" | "isManual"
>;

function getReasonLineValue(due: PaymentDueDisplayInput) {
  const reason = due.reason?.trim();
  if (reason) return reason;

  if (!due.isManual && due.dueType?.systemKey === "subscription") {
    return due.period;
  }

  return due.dueType?.name || due.period;
}

export function getPaymentDueTitle(due: PaymentDueDisplayInput) {
  return getReasonLineValue(due);
}

export function getPaymentDueSubtitle(due: PaymentDueDisplayInput) {
  const hasExplicitReason = Boolean(due.reason?.trim());
  const hasDerivedSubscriptionReason =
    !due.isManual && due.dueType?.systemKey === "subscription";

  if (hasExplicitReason || hasDerivedSubscriptionReason) {
    return due.dueType?.name || null;
  }

  return null;
}

export function getPaymentDuePeriodLine(due: PaymentDueDisplayInput) {
  return due.period || null;
}

