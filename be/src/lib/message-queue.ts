import { MessageEventType } from "@prisma/client";
import { prisma } from "./prisma.js";

export async function queueMessage(
  organizationId: string,
  recipientPhone: string,
  eventType: MessageEventType,
  messageBody: string
) {
  if (!recipientPhone || !recipientPhone.trim()) return null;
  return prisma.messageQueue.create({
    data: { organizationId, recipientPhone, eventType, messageBody },
  });
}

export async function queuePaymentDueGenerated(
  organizationId: string,
  recipientPhone: string,
  membershipNo: string,
  period: string,
  amount: string
) {
  return queueMessage(
    organizationId,
    recipientPhone,
    MessageEventType.DUE_GENERATED,
    `Payment due generated for membership ${membershipNo}. Period: ${period}, Amount: ${amount}`
  );
}

export async function queuePaymentReceived(
  organizationId: string,
  recipientPhone: string,
  membershipNo: string,
  amount: string
) {
  return queueMessage(
    organizationId,
    recipientPhone,
    MessageEventType.PAYMENT_RECEIVED,
    `Payment of ${amount} received for membership ${membershipNo}. Thank you!`
  );
}

export async function queuePaymentOverdue(
  organizationId: string,
  recipientPhone: string,
  membershipNo: string,
  period: string
) {
  return queueMessage(
    organizationId,
    recipientPhone,
    MessageEventType.PAYMENT_OVERDUE,
    `Payment for membership ${membershipNo} (period: ${period}) is overdue. Please make payment soon.`
  );
}

export async function queueLateFeeApplied(
  organizationId: string,
  recipientPhone: string,
  membershipNo: string,
  lateFee: string
) {
  return queueMessage(
    organizationId,
    recipientPhone,
    MessageEventType.LATE_FEE_APPLIED,
    `A late fee of ${lateFee} has been applied to membership ${membershipNo}.`
  );
}

export async function queueOrgBillingDue(
  organizationId: string,
  recipientPhone: string,
  orgName: string,
  year: number
) {
  return queueMessage(
    organizationId,
    recipientPhone,
    MessageEventType.ORG_BILLING_DUE,
    `Organization billing for ${orgName} is due for year ${year}.`
  );
}
