import type { PaymentDue } from "@/lib/api";

export function getPaymentDueTitle(due: Pick<PaymentDue, "period" | "reason">) {
  const reason = due.reason?.trim();
  return reason || due.period;
}

export function getPaymentDueSubtitle(due: Pick<PaymentDue, "period" | "reason">) {
  const reason = due.reason?.trim();
  return reason ? due.period : null;
}
