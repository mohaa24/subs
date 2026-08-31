import { MessageEventType, Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";
import {
  getTemplateDefinition,
  queueTemplatedMessage,
} from "./message-templates.js";

type MessageWriter = Pick<
  Prisma.TransactionClient,
  "messageQueue" | "messageTemplate" | "organization"
>;

export function membershipIdOnly(membershipNo: string) {
  const numericSuffix = membershipNo.trim().match(/(\d+)$/)?.[1];
  if (numericSuffix) return numericSuffix;
  const parts = membershipNo.split("-").filter(Boolean);
  return parts.at(-1) ?? membershipNo;
}

export async function queueMessage(
  organizationId: string,
  recipientPhone: string,
  eventType: MessageEventType,
  messageBody: string
) {
  if (!recipientPhone || !recipientPhone.trim()) return null;
  const definition = getTemplateDefinition(eventType);
  if (!definition?.available) return null;
  return prisma.messageQueue.create({
    data: { organizationId, recipientPhone, eventType, messageBody },
  });
}

export async function queuePaymentDueGenerated(
  organizationId: string,
  recipientPhone: string,
  membershipNo: string,
  period: string,
  amount: string,
  outstandingAmount: string,
  memberName = "Member",
  dueType = "membership",
  nextAttemptAt?: Date
) {
  return queueTemplatedMessage(prisma as unknown as MessageWriter, {
    organizationId,
    recipientPhone,
    eventType: MessageEventType.DUE_GENERATED,
    variables: {
      membership_no: membershipIdOnly(membershipNo),
      member_name: memberName,
      due_type: dueType,
      period,
      amount,
      total_outstanding_due: outstandingAmount,
    },
    nextAttemptAt,
  });
}

export async function queuePaymentReceived(
  tx: MessageWriter,
  input: {
    organizationId: string;
    recipientPhone: string;
    membershipNo: string;
    memberName: string;
    amount: string;
    receiptNumber: string;
    outstandingAmount: string;
  }
) {
  return queueTemplatedMessage(tx, {
    organizationId: input.organizationId,
    recipientPhone: input.recipientPhone,
    eventType: MessageEventType.PAYMENT_RECEIVED,
    variables: {
      membership_no: membershipIdOnly(input.membershipNo),
      member_name: input.memberName,
      amount: input.amount,
      receipt_number: input.receiptNumber,
      total_outstanding_due: input.outstandingAmount,
    },
  });
}

export async function queuePaymentReminder(
  tx: MessageWriter,
  input: {
    organizationId: string;
    recipientPhone: string;
    membershipNo: string;
    memberName: string;
    outstandingAmount: string;
  }
) {
  return queueTemplatedMessage(tx, {
    organizationId: input.organizationId,
    recipientPhone: input.recipientPhone,
    eventType: MessageEventType.PAYMENT_REMINDER,
    variables: {
      membership_no: membershipIdOnly(input.membershipNo),
      member_name: input.memberName,
      outstanding_amount: input.outstandingAmount,
    },
  });
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
