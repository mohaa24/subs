import type { PaymentDue } from "@/lib/api";

export function getPaymentDueTitle(
  due: Pick<PaymentDue, "period" | "reason" | "dueType">
) {
  const reason = due.reason?.trim();
  return reason || due.dueType?.name || due.period;
}

export function getPaymentDueSubtitle(
  due: Pick<PaymentDue, "period" | "reason" | "dueType">
) {
  const reason = due.reason?.trim();
  if (reason) {
    const parts = [due.dueType?.name, due.period].filter(Boolean);
    return parts.join(" · ") || null;
  }

  if (due.dueType?.name && due.dueType.name !== due.period) {
    return due.period;
  }

  return null;
}
