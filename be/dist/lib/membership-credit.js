"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMembershipCreditBalance = getMembershipCreditBalance;
exports.addOverpaymentCreditEntry = addOverpaymentCreditEntry;
exports.applyAvailableCreditToDue = applyAvailableCreditToDue;
const library_1 = require("@prisma/client/runtime/library");
const ZERO = new library_1.Decimal(0);
function maxDecimal(a, b) {
    return a.gte(b) ? a : b;
}
function minDecimal(a, b) {
    return a.lte(b) ? a : b;
}
function dueStatusForAmounts(amountDue, amountPaid) {
    if (amountPaid.gte(amountDue))
        return "paid";
    if (amountPaid.gt(ZERO))
        return "partial";
    return "pending";
}
async function getMembershipCreditBalance(tx, membershipId) {
    const aggregate = await tx.membershipCreditLedger.aggregate({
        where: { membershipId },
        _sum: { amountDelta: true },
    });
    return aggregate._sum.amountDelta ?? ZERO;
}
async function addOverpaymentCreditEntry(tx, input) {
    if (!input.amount.gt(ZERO))
        return;
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
async function applyAvailableCreditToDue(tx, input) {
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
    if (!due)
        throw new Error("Due not found while applying member credit");
    const remaining = maxDecimal(due.amountDue.sub(due.amountPaid), ZERO);
    if (!remaining.gt(ZERO))
        return ZERO;
    const creditBalance = await getMembershipCreditBalance(tx, due.membershipId);
    const applyAmount = minDecimal(remaining, creditBalance);
    if (!applyAmount.gt(ZERO))
        return ZERO;
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
