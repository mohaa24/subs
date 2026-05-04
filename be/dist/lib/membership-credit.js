"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMembershipCreditBalance = getMembershipCreditBalance;
exports.addOverpaymentCreditEntry = addOverpaymentCreditEntry;
exports.applyAvailableCreditToDue = applyAvailableCreditToDue;
exports.applyAvailableCreditAcrossOutstandingDues = applyAvailableCreditAcrossOutstandingDues;
exports.moveNegativeCreditBalanceToDue = moveNegativeCreditBalanceToDue;
exports.restoreAutoAppliedCreditForPaymentReversal = restoreAutoAppliedCreditForPaymentReversal;
const library_1 = require("@prisma/client/runtime/library");
const due_types_js_1 = require("./due-types.js");
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
function isoDateOnly(date) {
    return date.toISOString().slice(0, 10);
}
function buildAutoApplyCreditNote(due) {
    if (due.isManual) {
        return due.reason?.trim()
            ? `Auto-applied member credit to manual due: ${due.reason.trim()}`
            : "Auto-applied member credit to manual due";
    }
    return `Auto-applied member credit to ${due.period} due`;
}
async function applyCreditLotsToDue(tx, input) {
    const remainingDue = maxDecimal(input.due.amountDue.sub(input.due.amountPaid), ZERO);
    if (!remainingDue.gt(ZERO))
        return ZERO;
    const availableCredit = input.availableLots.reduce((sum, lot) => sum.add(lot.remaining), ZERO);
    const applyAmount = minDecimal(remainingDue, availableCredit);
    if (!applyAmount.gt(ZERO))
        return ZERO;
    const nextPaid = input.due.amountPaid.add(applyAmount);
    let nextStatus = dueStatusForAmounts(input.due.amountDue, nextPaid);
    if (input.due.status === "overdue" && nextStatus !== "paid") {
        nextStatus = "overdue";
    }
    await tx.paymentDue.update({
        where: { id: input.due.id },
        data: {
            amountPaid: nextPaid,
            status: nextStatus,
        },
    });
    const ledgerRows = [];
    const allocationRows = [];
    let remainingToApply = applyAmount;
    for (const lot of input.availableLots) {
        if (!remainingToApply.gt(ZERO))
            break;
        if (!lot.remaining.gt(ZERO))
            continue;
        const consumed = minDecimal(lot.remaining, remainingToApply);
        if (!consumed.gt(ZERO))
            continue;
        ledgerRows.push({
            membershipId: input.due.membershipId,
            organizationId: input.due.organizationId,
            paymentId: lot.paymentId,
            paymentDueId: input.due.id,
            amountDelta: consumed.neg(),
            entryType: "debit_auto_apply",
            note: input.note ?? `Auto-applied credit to due ${input.due.period}`,
            createdByUserId: input.createdByUserId ?? null,
        });
        allocationRows.push({
            membershipId: input.due.membershipId,
            organizationId: input.due.organizationId,
            paymentDueId: input.due.id,
            sourcePaymentId: lot.paymentId,
            amount: consumed,
            createdByUserId: input.createdByUserId ?? null,
        });
        lot.remaining = lot.remaining.sub(consumed);
        remainingToApply = remainingToApply.sub(consumed);
    }
    if (remainingToApply.gt(ZERO)) {
        ledgerRows.push({
            membershipId: input.due.membershipId,
            organizationId: input.due.organizationId,
            paymentDueId: input.due.id,
            amountDelta: remainingToApply.neg(),
            entryType: "debit_auto_apply",
            note: input.note ?? `Auto-applied credit to due ${input.due.period}`,
            createdByUserId: input.createdByUserId ?? null,
        });
        allocationRows.push({
            membershipId: input.due.membershipId,
            organizationId: input.due.organizationId,
            paymentDueId: input.due.id,
            amount: remainingToApply,
            createdByUserId: input.createdByUserId ?? null,
        });
    }
    // Reversal and due-creation flows can fan one payment out into several lots.
    // Batching those audit inserts cuts many round-trips out of the interactive
    // transaction and helps avoid "transaction already closed" timeouts on prod.
    if (ledgerRows.length > 0) {
        await tx.membershipCreditLedger.createMany({ data: ledgerRows });
    }
    if (allocationRows.length > 0) {
        await tx.membershipCreditAllocation.createMany({ data: allocationRows });
    }
    input.due.amountPaid = nextPaid;
    input.due.status = nextStatus;
    return applyAmount;
}
async function getAvailableCreditLots(tx, membershipId) {
    const creditEntries = await tx.membershipCreditLedger.findMany({
        where: { membershipId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
            paymentId: true,
            amountDelta: true,
        },
    });
    const availableLots = [];
    for (const entry of creditEntries) {
        if (entry.amountDelta.gt(ZERO)) {
            availableLots.push({
                paymentId: entry.paymentId ?? null,
                remaining: entry.amountDelta,
            });
            continue;
        }
        if (!entry.amountDelta.lt(ZERO))
            continue;
        let remainingToConsume = entry.amountDelta.abs();
        for (const lot of availableLots) {
            if (!remainingToConsume.gt(ZERO))
                break;
            if (!lot.remaining.gt(ZERO))
                continue;
            const consumed = minDecimal(lot.remaining, remainingToConsume);
            lot.remaining = lot.remaining.sub(consumed);
            remainingToConsume = remainingToConsume.sub(consumed);
        }
    }
    return availableLots;
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
            paymentDueId: input.paymentDueId ?? null,
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
            reason: true,
            isManual: true,
            dueType: { select: { name: true } },
            amountDue: true,
            amountPaid: true,
            status: true,
        },
    });
    if (!due)
        throw new Error("Due not found while applying member credit");
    const availableLots = await getAvailableCreditLots(tx, due.membershipId);
    return applyCreditLotsToDue(tx, {
        due,
        availableLots,
        createdByUserId: input.createdByUserId ?? null,
        note: input.note ??
            `Manually allocated member credit to ${due.dueType.name || due.period}`,
    });
}
async function applyAvailableCreditAcrossOutstandingDues(tx, input) {
    // Reversal often ends with no usable credit left after clawback. Bail out
    // before loading dues/ledger details when there is nothing positive to apply.
    const creditBalance = await getMembershipCreditBalance(tx, input.membershipId);
    if (!creditBalance.gt(ZERO))
        return ZERO;
    // Credit settles the oldest outstanding dues first; UI sort order is only
    // presentation and should not change payment allocation behavior.
    // We also build the remaining credit lots once and reuse them across the
    // whole sweep so the server does not replay the full credit ledger for every
    // single due inside one interactive transaction.
    const openDues = await tx.paymentDue.findMany({
        where: {
            membershipId: input.membershipId,
            isSystemAdjustment: false,
            status: { in: ["pending", "partial", "overdue"] },
            dueType: { is: { autoAllocate: true } },
        },
        orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        select: {
            membershipId: true,
            organizationId: true,
            id: true,
            period: true,
            reason: true,
            isManual: true,
            dueType: { select: { name: true } },
            amountDue: true,
            amountPaid: true,
            status: true,
        },
    });
    if (openDues.length === 0)
        return ZERO;
    const availableLots = await getAvailableCreditLots(tx, input.membershipId);
    let remainingCredit = availableLots.reduce((sum, lot) => sum.add(lot.remaining), ZERO);
    if (!remainingCredit.gt(ZERO))
        return ZERO;
    let totalApplied = ZERO;
    for (const due of openDues) {
        if (!remainingCredit.gt(ZERO))
            break;
        const remaining = maxDecimal(due.amountDue.sub(due.amountPaid), ZERO);
        if (!remaining.gt(ZERO))
            continue;
        const applied = await applyCreditLotsToDue(tx, {
            due,
            availableLots,
            createdByUserId: input.createdByUserId ?? null,
            note: buildAutoApplyCreditNote(due),
        });
        totalApplied = totalApplied.add(applied);
        remainingCredit = maxDecimal(remainingCredit.sub(applied), ZERO);
    }
    return totalApplied;
}
async function moveNegativeCreditBalanceToDue(tx, input) {
    const creditBalance = await getMembershipCreditBalance(tx, input.membershipId);
    if (!creditBalance.lt(ZERO))
        return ZERO;
    const transferAmount = creditBalance.abs();
    const dueDate = input.dueDate ?? new Date();
    const otherDueType = await (0, due_types_js_1.getDueTypeBySystemKey)(tx, input.organizationId, "other");
    const due = await tx.paymentDue.create({
        data: {
            membershipId: input.membershipId,
            organizationId: input.organizationId,
            dueTypeId: otherDueType.id,
            dueDate,
            period: input.period?.trim() || `Credit transfer ${isoDateOnly(dueDate)}`,
            isManual: true,
            isSystemAdjustment: true,
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
            note: input.ledgerNote?.trim() ||
                `Negative credit balance moved to due ${due.period}`,
            createdByUserId: input.createdByUserId ?? null,
        },
    });
    return transferAmount;
}
async function restoreAutoAppliedCreditForPaymentReversal(tx, input) {
    const directAllocations = await tx.membershipCreditAllocation.findMany({
        where: {
            membershipId: input.membershipId,
            sourcePaymentId: input.paymentId,
            reversedAt: null,
        },
        select: {
            id: true,
            paymentDueId: true,
            amount: true,
        },
    });
    if (directAllocations.length > 0) {
        const restoredByDueId = new Map();
        for (const allocation of directAllocations) {
            restoredByDueId.set(allocation.paymentDueId, (restoredByDueId.get(allocation.paymentDueId) ?? ZERO).add(allocation.amount));
        }
        return restoreCreditIntoDues(tx, {
            membershipId: input.membershipId,
            organizationId: input.organizationId,
            paymentId: input.paymentId,
            createdByUserId: input.createdByUserId,
            reason: input.reason,
            restoredByDueId,
            allocationIds: directAllocations.map((allocation) => allocation.id),
        });
    }
    const directAutoApplyEntries = await tx.membershipCreditLedger.findMany({
        where: {
            membershipId: input.membershipId,
            paymentId: input.paymentId,
            entryType: "debit_auto_apply",
            paymentDueId: { not: null },
        },
        select: {
            paymentDueId: true,
            amountDelta: true,
        },
    });
    const directRestoredByDueId = new Map();
    for (const entry of directAutoApplyEntries) {
        if (!entry.paymentDueId)
            continue;
        directRestoredByDueId.set(entry.paymentDueId, (directRestoredByDueId.get(entry.paymentDueId) ?? ZERO).add(entry.amountDelta.abs()));
    }
    if (directRestoredByDueId.size > 0) {
        return restoreCreditIntoDues(tx, {
            membershipId: input.membershipId,
            organizationId: input.organizationId,
            paymentId: input.paymentId,
            createdByUserId: input.createdByUserId,
            reason: input.reason,
            restoredByDueId: directRestoredByDueId,
        });
    }
    const ledgerEntries = await tx.membershipCreditLedger.findMany({
        where: { membershipId: input.membershipId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
            id: true,
            paymentId: true,
            paymentDueId: true,
            amountDelta: true,
            entryType: true,
        },
    });
    const availableLots = [];
    const restoredByDueId = new Map();
    for (const entry of ledgerEntries) {
        if (entry.amountDelta.gt(ZERO)) {
            availableLots.push({
                paymentId: entry.paymentId ?? null,
                remaining: entry.amountDelta,
            });
            continue;
        }
        if (!entry.amountDelta.lt(ZERO))
            continue;
        let remainingToConsume = entry.amountDelta.abs();
        for (const lot of availableLots) {
            if (!remainingToConsume.gt(ZERO))
                break;
            if (!lot.remaining.gt(ZERO))
                continue;
            const consumed = minDecimal(lot.remaining, remainingToConsume);
            if (entry.entryType === "debit_auto_apply" &&
                entry.paymentDueId &&
                lot.paymentId === input.paymentId) {
                restoredByDueId.set(entry.paymentDueId, (restoredByDueId.get(entry.paymentDueId) ?? ZERO).add(consumed));
            }
            lot.remaining = lot.remaining.sub(consumed);
            remainingToConsume = remainingToConsume.sub(consumed);
        }
    }
    if (restoredByDueId.size === 0)
        return ZERO;
    return restoreCreditIntoDues(tx, {
        membershipId: input.membershipId,
        organizationId: input.organizationId,
        paymentId: input.paymentId,
        createdByUserId: input.createdByUserId,
        reason: input.reason,
        restoredByDueId,
    });
}
async function restoreCreditIntoDues(tx, input) {
    const affectedDueIds = Array.from(input.restoredByDueId.keys());
    const affectedDues = await tx.paymentDue.findMany({
        where: { id: { in: affectedDueIds } },
        select: {
            id: true,
            period: true,
            amountDue: true,
            amountPaid: true,
            status: true,
        },
    });
    const dueById = new Map(affectedDues.map((due) => [due.id, due]));
    let totalRestored = ZERO;
    const reversedAt = new Date();
    for (const dueId of affectedDueIds) {
        const due = dueById.get(dueId);
        const requestedRestore = input.restoredByDueId.get(dueId) ?? ZERO;
        if (!due || !requestedRestore.gt(ZERO))
            continue;
        const actualRestore = minDecimal(due.amountPaid, requestedRestore);
        if (!actualRestore.gt(ZERO))
            continue;
        const nextPaid = maxDecimal(due.amountPaid.sub(actualRestore), ZERO);
        let nextStatus = dueStatusForAmounts(due.amountDue, nextPaid);
        if (due.status === "overdue" && nextStatus !== "paid") {
            nextStatus = "overdue";
        }
        await tx.paymentDue.update({
            where: { id: due.id },
            data: {
                amountPaid: nextPaid,
                status: nextStatus,
            },
        });
        await tx.membershipCreditLedger.create({
            data: {
                membershipId: input.membershipId,
                organizationId: input.organizationId,
                paymentId: input.paymentId,
                paymentDueId: due.id,
                amountDelta: actualRestore,
                entryType: "credit_adjustment",
                note: `Restored auto-applied credit while reversing payment: ${input.reason}`,
                createdByUserId: input.createdByUserId ?? null,
            },
        });
        totalRestored = totalRestored.add(actualRestore);
    }
    if (input.allocationIds?.length) {
        await tx.membershipCreditAllocation.updateMany({
            where: { id: { in: input.allocationIds } },
            data: {
                reversedAt,
                reversedByUserId: input.createdByUserId ?? null,
                reversalReason: input.reason,
            },
        });
    }
    return totalRestored;
}
