"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.queueMessage = queueMessage;
exports.queuePaymentDueGenerated = queuePaymentDueGenerated;
exports.queuePaymentReceived = queuePaymentReceived;
exports.queuePaymentOverdue = queuePaymentOverdue;
exports.queueLateFeeApplied = queueLateFeeApplied;
exports.queueOrgBillingDue = queueOrgBillingDue;
const client_1 = require("@prisma/client");
const prisma_js_1 = require("./prisma.js");
async function queueMessage(organizationId, recipientPhone, eventType, messageBody) {
    if (!recipientPhone || !recipientPhone.trim())
        return null;
    return prisma_js_1.prisma.messageQueue.create({
        data: { organizationId, recipientPhone, eventType, messageBody },
    });
}
async function queuePaymentDueGenerated(organizationId, recipientPhone, membershipNo, period, amount) {
    return queueMessage(organizationId, recipientPhone, client_1.MessageEventType.DUE_GENERATED, `Payment due generated for membership ${membershipNo}. Period: ${period}, Amount: ${amount}`);
}
async function queuePaymentReceived(organizationId, recipientPhone, membershipNo, amount) {
    return queueMessage(organizationId, recipientPhone, client_1.MessageEventType.PAYMENT_RECEIVED, `Payment of ${amount} received for membership ${membershipNo}. Thank you!`);
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
