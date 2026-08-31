"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.membershipIdOnly = membershipIdOnly;
exports.queueMessage = queueMessage;
exports.queuePaymentDueGenerated = queuePaymentDueGenerated;
exports.queuePaymentReceived = queuePaymentReceived;
exports.queuePaymentReminder = queuePaymentReminder;
exports.queuePaymentOverdue = queuePaymentOverdue;
exports.queueLateFeeApplied = queueLateFeeApplied;
exports.queueOrgBillingDue = queueOrgBillingDue;
const client_1 = require("@prisma/client");
const prisma_js_1 = require("./prisma.js");
const message_templates_js_1 = require("./message-templates.js");
function membershipIdOnly(membershipNo) {
    const numericSuffix = membershipNo.trim().match(/(\d+)$/)?.[1];
    if (numericSuffix)
        return numericSuffix;
    const parts = membershipNo.split("-").filter(Boolean);
    return parts.at(-1) ?? membershipNo;
}
async function queueMessage(organizationId, recipientPhone, eventType, messageBody) {
    if (!recipientPhone || !recipientPhone.trim())
        return null;
    const definition = (0, message_templates_js_1.getTemplateDefinition)(eventType);
    if (!definition?.available)
        return null;
    return prisma_js_1.prisma.messageQueue.create({
        data: { organizationId, recipientPhone, eventType, messageBody },
    });
}
async function queuePaymentDueGenerated(organizationId, recipientPhone, membershipNo, period, amount, outstandingAmount, memberName = "Member", dueType = "membership", nextAttemptAt) {
    return (0, message_templates_js_1.queueTemplatedMessage)(prisma_js_1.prisma, {
        organizationId,
        recipientPhone,
        eventType: client_1.MessageEventType.DUE_GENERATED,
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
async function queuePaymentReceived(tx, input) {
    return (0, message_templates_js_1.queueTemplatedMessage)(tx, {
        organizationId: input.organizationId,
        recipientPhone: input.recipientPhone,
        eventType: client_1.MessageEventType.PAYMENT_RECEIVED,
        variables: {
            membership_no: membershipIdOnly(input.membershipNo),
            member_name: input.memberName,
            amount: input.amount,
            receipt_number: input.receiptNumber,
            total_outstanding_due: input.outstandingAmount,
        },
    });
}
async function queuePaymentReminder(tx, input) {
    return (0, message_templates_js_1.queueTemplatedMessage)(tx, {
        organizationId: input.organizationId,
        recipientPhone: input.recipientPhone,
        eventType: client_1.MessageEventType.PAYMENT_REMINDER,
        variables: {
            membership_no: membershipIdOnly(input.membershipNo),
            member_name: input.memberName,
            outstanding_amount: input.outstandingAmount,
        },
    });
}
async function queuePaymentOverdue(organizationId, recipientPhone, membershipNo, period) {
    return queueMessage(organizationId, recipientPhone, client_1.MessageEventType.PAYMENT_OVERDUE, `Payment for membership ${membershipNo} (period: ${period}) is overdue. Please make payment soon.`);
}
async function queueLateFeeApplied(organizationId, recipientPhone, membershipNo, lateFee) {
    return queueMessage(organizationId, recipientPhone, client_1.MessageEventType.LATE_FEE_APPLIED, `A late fee of ${lateFee} has been applied to membership ${membershipNo}.`);
}
async function queueOrgBillingDue(organizationId, recipientPhone, orgName, year) {
    return queueMessage(organizationId, recipientPhone, client_1.MessageEventType.ORG_BILLING_DUE, `Organization billing for ${orgName} is due for year ${year}.`);
}
