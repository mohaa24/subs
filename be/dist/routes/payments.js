"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.paymentsRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const client_1 = require("@prisma/client");
const library_1 = require("@prisma/client/runtime/library");
const prisma_js_1 = require("../lib/prisma.js");
const auth_js_1 = require("../middleware/auth.js");
const message_queue_js_1 = require("../lib/message-queue.js");
const membership_credit_js_1 = require("../lib/membership-credit.js");
const due_types_js_1 = require("../lib/due-types.js");
const accounting_js_1 = require("../lib/accounting.js");
exports.paymentsRouter = (0, express_1.Router)();
exports.paymentsRouter.use(auth_js_1.requireAuth);
exports.paymentsRouter.use(auth_js_1.withOrgScope);
// Prisma interactive transactions default to 5 seconds. The payment flows below
// can now touch several dues plus credit-ledger/allocation rows in one request,
// so we give the optimized sweep a little headroom for real server/DB latency.
const CREDIT_SWEEP_TRANSACTION_OPTIONS = {
    maxWait: 10000,
    timeout: 10000,
};
function getOrgId(req) {
    return req.organizationId ?? req.body?.organizationId ?? req.query?.organizationId;
}
function toDecimal(n) {
    return new library_1.Decimal(n);
}
function minDecimal(a, b) {
    return a.lte(b) ? a : b;
}
function maxDecimal(a, b) {
    return a.gte(b) ? a : b;
}
function periodString(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
}
function dateOnlyString(date) {
    return date.toISOString().slice(0, 10);
}
function endOfDueMonth(date) {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}
function isPastDueGracePeriod(dueDate, now = new Date()) {
    return now > endOfDueMonth(dueDate);
}
function nonSystemAdjustmentOrStandaloneCreditFilter() {
    return {
        OR: [
            { paymentDueId: null },
            { paymentDue: { is: { isSystemAdjustment: false } } },
        ],
    };
}
function buildOrganizationPaymentHistoryWhere(options) {
    const and = [nonSystemAdjustmentOrStandaloneCreditFilter()];
    if (options.organizationId) {
        and.push({ organizationId: options.organizationId });
    }
    if (options.membershipId) {
        and.push({ membershipId: options.membershipId });
    }
    if (options.q) {
        and.push({
            OR: [
                {
                    membership: {
                        OR: [
                            { hod: { fullName: { contains: options.q, mode: "insensitive" } } },
                            { hod: { nameWithInitials: { contains: options.q, mode: "insensitive" } } },
                            { membershipNo: { contains: options.q, mode: "insensitive" } },
                        ],
                    },
                },
                { paymentDue: { period: { contains: options.q, mode: "insensitive" } } },
                { paymentDue: { dueType: { name: { contains: options.q, mode: "insensitive" } } } },
                { receiptNumber: { contains: options.q, mode: "insensitive" } },
                { note: { contains: options.q, mode: "insensitive" } },
                { collectedBy: { email: { contains: options.q, mode: "insensitive" } } },
            ],
        });
    }
    return { AND: and };
}
const CREDIT_PAYMENT_REFERENCE = "Credit Payment";
const CREDIT_PAYMENT_LEDGER_NOTE = "Member payment added to credit before due allocation";
const paymentMethodSchema = zod_1.z.enum(["cash", "bank_transfer", "card", "other"]);
const PAYMENT_METHOD_LABELS = {
    cash: "Cash",
    bank_transfer: "Bank Transfer",
    card: "Card",
    other: "Other",
};
function parseOptionalDate(value) {
    if (typeof value !== "string" || !value.trim())
        return null;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}
function buildManualDuePeriod(start, end) {
    if (start && end)
        return `${dateOnlyString(start)} to ${dateOnlyString(end)}`;
    if (start)
        return `From ${dateOnlyString(start)}`;
    if (end)
        return `Until ${dateOnlyString(end)}`;
    return "Manual due";
}
function describeDueEntry(isManual) {
    return isManual ? "Manual Due Added" : "Due Generated";
}
function describeDueAdjustment(type, amountDelta) {
    if (type === "late_fee")
        return "Late Fee Applied";
    return amountDelta.gte(new library_1.Decimal(0)) ? "Due Increased" : "Due Reduced";
}
function getPaymentMethodLabel(method) {
    return method ? PAYMENT_METHOD_LABELS[method] : null;
}
function formatZoneLabel(areaCode, zoneMap) {
    if (areaCode === null || areaCode === undefined)
        return "";
    const zoneName = zoneMap.get(areaCode);
    return zoneName ? `${areaCode}-${zoneName}` : String(areaCode);
}
function extractMembershipId(membershipNo) {
    const normalized = membershipNo?.trim();
    if (!normalized)
        return "";
    const match = normalized.match(/(\d+)\s*$/);
    return match?.[1] ?? normalized;
}
function extractLegacyPaymentMethod(note) {
    const normalized = note?.trim();
    if (!normalized)
        return null;
    for (const [method, label] of Object.entries(PAYMENT_METHOD_LABELS)) {
        if (normalized === label || normalized.startsWith(`${label} — `)) {
            return method;
        }
    }
    return null;
}
function stripLegacyPaymentMethod(note) {
    const normalized = note?.trim();
    if (!normalized)
        return null;
    const method = extractLegacyPaymentMethod(normalized);
    if (!method)
        return normalized;
    const label = PAYMENT_METHOD_LABELS[method];
    if (normalized === label)
        return null;
    if (normalized.startsWith(`${label} — `)) {
        return normalized.slice(label.length + 3).trim() || null;
    }
    return normalized;
}
function receiptNumberPrefix(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    return `${year}${month}`;
}
async function generateReceiptNumber(tx, organizationId, paymentDate) {
    const prefix = receiptNumberPrefix(paymentDate);
    const latest = await tx.payment.findFirst({
        where: {
            organizationId,
            receiptNumber: {
                startsWith: prefix,
            },
        },
        orderBy: {
            receiptNumber: "desc",
        },
        select: {
            receiptNumber: true,
        },
    });
    const previousSequence = latest?.receiptNumber
        ? parseInt(latest.receiptNumber.slice(prefix.length), 10) || 0
        : 0;
    return `${prefix}${String(previousSequence + 1).padStart(4, "0")}`;
}
async function loadReceiptBalanceSnapshot(tx, membershipId) {
    const [dues, creditBalance] = await Promise.all([
        tx.paymentDue.findMany({
            where: {
                membershipId,
                isSystemAdjustment: false,
            },
            select: {
                amountDue: true,
                amountPaid: true,
            },
        }),
        (0, membership_credit_js_1.getMembershipCreditBalance)(tx, membershipId),
    ]);
    const outstandingAfterPayment = dues.reduce((sum, due) => sum.add(maxDecimal(due.amountDue.sub(due.amountPaid), new library_1.Decimal(0))), new library_1.Decimal(0));
    const creditBalanceAfterPayment = creditBalance.gt(new library_1.Decimal(0))
        ? creditBalance
        : new library_1.Decimal(0);
    return {
        outstandingAfterPayment,
        creditBalanceAfterPayment,
    };
}
async function getCurrentReceiptBalanceSnapshot(membershipId) {
    const snapshot = await prisma_js_1.prisma.$transaction((tx) => loadReceiptBalanceSnapshot(tx, membershipId));
    return {
        outstandingAfterPayment: snapshot.outstandingAfterPayment.toNumber(),
        creditBalanceAfterPayment: snapshot.creditBalanceAfterPayment.toNumber(),
    };
}
function isReceiptNumberConflict(error) {
    if (!(error instanceof client_1.Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
        return false;
    }
    const target = Array.isArray(error.meta?.target)
        ? error.meta.target.map(String)
        : [];
    return target.includes("receiptNumber");
}
async function withReceiptNumberRetry(operation) {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            return await operation();
        }
        catch (error) {
            if (isReceiptNumberConflict(error)) {
                lastError = error;
                continue;
            }
            throw error;
        }
    }
    throw lastError;
}
async function buildReceiptForPayment(paymentId) {
    const payment = await prisma_js_1.prisma.payment.findUnique({
        where: { id: paymentId },
        include: {
            paymentDue: { select: { id: true, period: true, amountDue: true } },
            membership: {
                select: {
                    id: true,
                    membershipNo: true,
                    hod: { select: { fullName: true, nameWithInitials: true } },
                },
            },
            organization: { select: { id: true, name: true, receiptLogoUrl: true } },
            collectedBy: { select: { email: true } },
        },
    });
    if (!payment)
        return null;
    const paymentMethod = payment.paymentMethod ?? extractLegacyPaymentMethod(payment.note);
    const receiptNote = stripLegacyPaymentMethod(payment.note);
    const receiptNumber = payment.receiptNumber ?? payment.id.slice(-8).toUpperCase();
    const balanceSnapshot = payment.outstandingAfterPayment !== null && payment.creditBalanceAfterPayment !== null
        ? {
            outstandingAfterPayment: payment.outstandingAfterPayment.toNumber(),
            creditBalanceAfterPayment: payment.creditBalanceAfterPayment.toNumber(),
        }
        : await getCurrentReceiptBalanceSnapshot(payment.membership.id);
    const memberName = payment.membership.hod.nameWithInitials || payment.membership.hod.fullName || "";
    if (payment.paymentKind === "credit" || !payment.paymentDueId) {
        return {
            paymentKind: "credit",
            paymentId: payment.id,
            receiptNumber,
            paymentDate: payment.paymentDate.toISOString(),
            note: receiptNote,
            period: CREDIT_PAYMENT_REFERENCE,
            membershipId: payment.membership.id,
            membershipNo: payment.membership.membershipNo,
            memberName,
            organizationId: payment.organization.id,
            organizationName: payment.organization.name,
            organizationReceiptLogoUrl: payment.organization.receiptLogoUrl,
            collectedBy: payment.collectedBy.email,
            paymentMethod: getPaymentMethodLabel(paymentMethod),
            paidAmount: payment.amount.toNumber(),
            appliedToDue: 0,
            overpaymentToCredit: payment.amount.toNumber(),
            remainingAfter: balanceSnapshot.outstandingAfterPayment,
            outstandingAfterPayment: balanceSnapshot.outstandingAfterPayment,
            creditBalanceAfterPayment: balanceSnapshot.creditBalanceAfterPayment,
        };
    }
    const receiptDue = payment.paymentDue;
    if (!receiptDue)
        return null;
    const duePayments = await prisma_js_1.prisma.payment.findMany({
        where: { paymentDueId: payment.paymentDueId },
        select: { id: true, amount: true, paymentDate: true, createdAt: true },
        orderBy: [{ paymentDate: "asc" }, { createdAt: "asc" }],
    });
    const duePaymentIds = duePayments.map((p) => p.id);
    const overpaymentRows = await prisma_js_1.prisma.membershipCreditLedger.groupBy({
        by: ["paymentId"],
        where: {
            paymentId: { in: duePaymentIds },
            entryType: "credit_overpayment",
        },
        _sum: { amountDelta: true },
    });
    const overpaymentByPaymentId = new Map();
    for (const row of overpaymentRows) {
        if (!row.paymentId)
            continue;
        overpaymentByPaymentId.set(row.paymentId, row._sum.amountDelta ?? new library_1.Decimal(0));
    }
    let cumulativeApplied = new library_1.Decimal(0);
    let appliedToDue = new library_1.Decimal(0);
    let overpaymentToCredit = new library_1.Decimal(0);
    let remainingAfter = receiptDue.amountDue;
    for (const duePayment of duePayments) {
        const overpayment = maxDecimal(overpaymentByPaymentId.get(duePayment.id) ?? new library_1.Decimal(0), new library_1.Decimal(0));
        const applied = maxDecimal(duePayment.amount.sub(overpayment), new library_1.Decimal(0));
        cumulativeApplied = cumulativeApplied.add(applied);
        if (duePayment.id === payment.id) {
            appliedToDue = applied;
            overpaymentToCredit = overpayment;
            remainingAfter = maxDecimal(receiptDue.amountDue.sub(cumulativeApplied), new library_1.Decimal(0));
            break;
        }
    }
    return {
        paymentKind: "due",
        paymentId: payment.id,
        receiptNumber,
        paymentDate: payment.paymentDate.toISOString(),
        note: receiptNote,
        period: receiptDue.period,
        membershipId: payment.membership.id,
        membershipNo: payment.membership.membershipNo,
        memberName,
        organizationId: payment.organization.id,
        organizationName: payment.organization.name,
        organizationReceiptLogoUrl: payment.organization.receiptLogoUrl,
        collectedBy: payment.collectedBy.email,
        paymentMethod: getPaymentMethodLabel(paymentMethod),
        paidAmount: payment.amount.toNumber(),
        appliedToDue: appliedToDue.toNumber(),
        overpaymentToCredit: overpaymentToCredit.toNumber(),
        remainingAfter: remainingAfter.toNumber(),
        outstandingAfterPayment: balanceSnapshot.outstandingAfterPayment,
        creditBalanceAfterPayment: balanceSnapshot.creditBalanceAfterPayment,
    };
}
// Generate dues for the current month (or a given month) for all active memberships in an org.
// Idempotent — skips memberships that already have a due for that period.
exports.paymentsRouter.post("/generate-dues", async (req, res) => {
    const orgId = getOrgId(req);
    if (!orgId && req.auth.role !== "super_user")
        return res.status(400).json({ error: "Organization scope required" });
    const now = new Date();
    const targetDate = req.body?.period
        ? new Date(req.body.period + "-01")
        : new Date(now.getFullYear(), now.getMonth(), 1);
    const period = periodString(targetDate);
    const where = { membershipStatus: "Active" };
    if (orgId)
        where.organizationId = orgId;
    const memberships = await prisma_js_1.prisma.membership.findMany({ where });
    let created = 0;
    let skipped = 0;
    let autoAppliedCredit = new library_1.Decimal(0);
    for (const m of memberships) {
        const shouldGenerate = m.paymentPeriod === "Monthly" ||
            (m.paymentPeriod === "Quarterly" && targetDate.getMonth() % 3 === 0) ||
            (m.paymentPeriod === "Annually" && targetDate.getMonth() === 0);
        if (!shouldGenerate) {
            skipped++;
            continue;
        }
        const existing = await prisma_js_1.prisma.paymentDue.findFirst({
            where: { membershipId: m.id, period, isManual: false },
        });
        if (existing) {
            skipped++;
            continue;
        }
        const applied = await prisma_js_1.prisma.$transaction(async (tx) => {
            const subscriptionDueType = await (0, due_types_js_1.getDueTypeBySystemKey)(tx, m.organizationId, "subscription");
            const due = await tx.paymentDue.create({
                data: {
                    membershipId: m.id,
                    organizationId: m.organizationId,
                    dueTypeId: subscriptionDueType.id,
                    dueDate: targetDate,
                    period,
                    amountDue: m.totalContribution,
                    amountPaid: new library_1.Decimal(0),
                    status: "pending",
                },
            });
            return (0, membership_credit_js_1.applyAvailableCreditAcrossOutstandingDues)(tx, {
                membershipId: m.id,
                createdByUserId: req.auth.userId,
            });
        }, CREDIT_SWEEP_TRANSACTION_OPTIONS);
        created++;
        autoAppliedCredit = autoAppliedCredit.add(applied);
    }
    return res.json({
        created,
        skipped,
        period,
        autoAppliedCredit: autoAppliedCredit.toNumber(),
    });
});
const createManualDueSchema = zod_1.z.object({
    membershipId: zod_1.z.string().min(1),
    dueTypeId: zod_1.z.string().min(1),
    amountDue: zod_1.z.number().positive("Amount must be greater than zero"),
    reason: zod_1.z.string().trim().optional().nullable(),
    periodFrom: zod_1.z.string().optional().nullable(),
    periodTo: zod_1.z.string().optional().nullable(),
});
exports.paymentsRouter.post("/dues", async (req, res) => {
    if (req.auth.role !== "admin" && req.auth.role !== "super_user") {
        return res.status(403).json({ error: "Only admins can create manual dues" });
    }
    const parsed = createManualDueSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    }
    const membership = await prisma_js_1.prisma.membership.findUnique({
        where: { id: parsed.data.membershipId },
        select: { id: true, organizationId: true, membershipNo: true },
    });
    if (!membership)
        return res.status(404).json({ error: "Membership not found" });
    if (req.auth.organizationId && membership.organizationId !== req.auth.organizationId && req.auth.role !== "super_user") {
        return res.status(403).json({ error: "Forbidden" });
    }
    const periodStart = parseOptionalDate(parsed.data.periodFrom);
    const periodEnd = parseOptionalDate(parsed.data.periodTo);
    if (parsed.data.periodFrom && !periodStart)
        return res.status(400).json({ error: "Invalid period start" });
    if (parsed.data.periodTo && !periodEnd)
        return res.status(400).json({ error: "Invalid period end" });
    if (periodStart && periodEnd && periodEnd < periodStart) {
        return res.status(400).json({ error: "Period end must be on or after period start" });
    }
    const period = buildManualDuePeriod(periodStart, periodEnd);
    const dueDate = periodEnd ?? periodStart ?? new Date();
    const normalizedReason = parsed.data.reason?.trim() ? parsed.data.reason.trim() : null;
    const dueType = await prisma_js_1.prisma.dueType.findUnique({
        where: { id: parsed.data.dueTypeId },
        select: {
            id: true,
            organizationId: true,
            autoAllocate: true,
            isActive: true,
        },
    });
    if (!dueType || dueType.organizationId !== membership.organizationId) {
        return res.status(404).json({ error: "Due type not found" });
    }
    if (!dueType.isActive) {
        return res.status(409).json({ error: "Archived due types cannot be used for new dues" });
    }
    const created = await prisma_js_1.prisma.$transaction(async (tx) => {
        const due = await tx.paymentDue.create({
            data: {
                membershipId: membership.id,
                organizationId: membership.organizationId,
                dueTypeId: dueType.id,
                createdByUserId: req.auth.userId,
                dueDate,
                period,
                isManual: true,
                reason: normalizedReason,
                periodStart,
                periodEnd,
                amountDue: toDecimal(parsed.data.amountDue),
                amountPaid: new library_1.Decimal(0),
                status: "pending",
            },
            include: {
                membership: {
                    select: {
                        membershipNo: true,
                        hod: { select: { fullName: true, nameWithInitials: true } },
                    },
                },
                dueType: {
                    select: {
                        id: true,
                        name: true,
                        autoAllocate: true,
                        isActive: true,
                        systemKey: true,
                    },
                },
            },
        });
        const autoAppliedCredit = dueType.autoAllocate
            ? await (0, membership_credit_js_1.applyAvailableCreditAcrossOutstandingDues)(tx, {
                membershipId: membership.id,
                createdByUserId: req.auth.userId,
            })
            : new library_1.Decimal(0);
        return { due, autoAppliedCredit };
    }, CREDIT_SWEEP_TRANSACTION_OPTIONS);
    return res.status(201).json({
        ...created.due,
        autoAppliedCredit: created.autoAppliedCredit.toNumber(),
    });
});
// List dues for a membership (with optional status filter)
exports.paymentsRouter.get("/dues", async (req, res) => {
    const orgId = getOrgId(req);
    if (!orgId && req.auth.role !== "super_user")
        return res.status(400).json({ error: "Organization scope required" });
    const membershipId = req.query.membershipId;
    const status = req.query.status;
    const dueTypeId = req.query.dueTypeId?.trim();
    const q = req.query.q?.trim() || "";
    const page = Math.max(1, parseInt(String(req.query.page), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit), 10) || 20));
    const where = {};
    if (orgId)
        where.organizationId = orgId;
    if (membershipId)
        where.membershipId = membershipId;
    where.isSystemAdjustment = false;
    if (status)
        where.status = status;
    if (dueTypeId)
        where.dueTypeId = dueTypeId;
    if (q) {
        where.OR = [
            {
                membership: {
                    OR: [
                        { hod: { fullName: { contains: q, mode: "insensitive" } } },
                        { hod: { nameWithInitials: { contains: q, mode: "insensitive" } } },
                        { membershipNo: { contains: q, mode: "insensitive" } },
                    ],
                },
            },
            { dueType: { name: { contains: q, mode: "insensitive" } } },
        ];
    }
    const [items, total] = await Promise.all([
        prisma_js_1.prisma.paymentDue.findMany({
            where,
            skip: (page - 1) * limit,
            take: limit,
            orderBy: { dueDate: "desc" },
            include: {
                membership: {
                    select: {
                        membershipNo: true,
                        areaCode: true,
                        hod: { select: { fullName: true, nameWithInitials: true } },
                    },
                },
                dueType: {
                    select: {
                        id: true,
                        name: true,
                        autoAllocate: true,
                        isActive: true,
                        systemKey: true,
                    },
                },
            },
        }),
        prisma_js_1.prisma.paymentDue.count({ where }),
    ]);
    return res.json({ items, total, page, limit });
});
// Get outstanding balance for a membership
exports.paymentsRouter.get("/balance/:membershipId", async (req, res) => {
    const membership = await prisma_js_1.prisma.membership.findUnique({
        where: { id: req.params.membershipId },
        select: { id: true, organizationId: true, membershipNo: true },
    });
    if (!membership)
        return res.status(404).json({ error: "Membership not found" });
    if (req.auth.organizationId && membership.organizationId !== req.auth.organizationId && req.auth.role !== "super_user") {
        return res.status(403).json({ error: "Forbidden" });
    }
    const [dues, creditBalance, paymentTotals] = await Promise.all([
        prisma_js_1.prisma.paymentDue.findMany({
            where: { membershipId: membership.id, isSystemAdjustment: false },
            orderBy: { dueDate: "desc" },
            include: {
                dueType: {
                    select: {
                        id: true,
                        name: true,
                        autoAllocate: true,
                        isActive: true,
                        systemKey: true,
                    },
                },
            },
        }),
        prisma_js_1.prisma.$transaction((tx) => (0, membership_credit_js_1.getMembershipCreditBalance)(tx, membership.id)),
        prisma_js_1.prisma.payment.aggregate({
            where: {
                membershipId: membership.id,
                isReversed: false,
                ...nonSystemAdjustmentOrStandaloneCreditFilter(),
            },
            _sum: { amount: true },
        }),
    ]);
    const totalDue = dues.reduce((sum, d) => sum.add(d.amountDue), new library_1.Decimal(0));
    const totalPaid = paymentTotals._sum.amount ?? new library_1.Decimal(0);
    const settledAgainstDues = dues.reduce((sum, d) => sum.add(d.amountPaid), new library_1.Decimal(0));
    const currentDueOutstanding = totalDue.sub(settledAgainstDues);
    const availableCredit = creditBalance.gt(new library_1.Decimal(0)) ? creditBalance : new library_1.Decimal(0);
    const netOutstanding = currentDueOutstanding.sub(availableCredit);
    const overdueCount = dues.filter((d) => d.status === "pending" || d.status === "partial" || d.status === "overdue").length;
    return res.json({
        membershipId: membership.id,
        membershipNo: membership.membershipNo,
        totalDue: totalDue.toNumber(),
        totalPaid: totalPaid.toNumber(),
        outstanding: currentDueOutstanding.toNumber(),
        creditBalance: availableCredit.toNumber(),
        netOutstanding: netOutstanding.toNumber(),
        overdueCount,
        dues,
    });
});
exports.paymentsRouter.get("/statement/:membershipId", async (req, res) => {
    const membership = await prisma_js_1.prisma.membership.findUnique({
        where: { id: req.params.membershipId },
        select: { id: true, organizationId: true, membershipNo: true },
    });
    if (!membership)
        return res.status(404).json({ error: "Membership not found" });
    if (req.auth.organizationId && membership.organizationId !== req.auth.organizationId && req.auth.role !== "super_user") {
        return res.status(403).json({ error: "Forbidden" });
    }
    const [dues, adjustments, payments] = await Promise.all([
        prisma_js_1.prisma.paymentDue.findMany({
            where: { membershipId: membership.id, isSystemAdjustment: false },
            orderBy: [{ createdAt: "asc" }, { dueDate: "asc" }],
            select: {
                id: true,
                period: true,
                reason: true,
                dueType: { select: { name: true } },
                createdBy: { select: { email: true } },
                isManual: true,
                amountDue: true,
                createdAt: true,
            },
        }),
        prisma_js_1.prisma.paymentDueAdjustment.findMany({
            where: {
                membershipId: membership.id,
                paymentDue: { is: { isSystemAdjustment: false } },
            },
            orderBy: { createdAt: "asc" },
            include: {
                paymentDue: { select: { id: true, period: true, dueType: { select: { name: true } } } },
                createdBy: { select: { email: true } },
            },
        }),
        prisma_js_1.prisma.payment.findMany({
            where: {
                membershipId: membership.id,
                ...nonSystemAdjustmentOrStandaloneCreditFilter(),
            },
            orderBy: [{ paymentDate: "asc" }, { createdAt: "asc" }],
            include: {
                paymentDue: { select: { id: true, period: true, dueType: { select: { name: true } } } },
                collectedBy: { select: { email: true } },
                reversedBy: { select: { email: true } },
            },
        }),
    ]);
    const adjustmentTotalsByDueId = new Map();
    for (const adjustment of adjustments) {
        adjustmentTotalsByDueId.set(adjustment.paymentDueId, (adjustmentTotalsByDueId.get(adjustment.paymentDueId) ?? new library_1.Decimal(0)).add(adjustment.amountDelta));
    }
    const rawEntries = [];
    for (const due of dues) {
        const originalAmountDue = due.amountDue.sub(adjustmentTotalsByDueId.get(due.id) ?? new library_1.Decimal(0));
        rawEntries.push({
            id: `due-${due.id}`,
            occurredAt: due.createdAt,
            createdAt: due.createdAt,
            sortOrder: 0,
            entryType: "due",
            action: describeDueEntry(due.isManual),
            dueType: due.dueType?.name ?? null,
            detail: due.period,
            description: describeDueEntry(due.isManual),
            reference: due.dueType?.name ? `${due.dueType.name} · ${due.period}` : due.period,
            note: due.reason ?? null,
            debit: originalAmountDue.gt(new library_1.Decimal(0)) ? originalAmountDue : new library_1.Decimal(0),
            credit: new library_1.Decimal(0),
            actor: due.createdBy?.email ?? null,
            paymentId: null,
            paymentDueId: due.id,
            receiptAvailable: false,
            reversible: false,
        });
    }
    for (const adjustment of adjustments) {
        if (adjustment.adjustmentType === "late_fee" &&
            adjustment.amountDelta.equals(new library_1.Decimal(0))) {
            continue;
        }
        const debit = adjustment.amountDelta.gte(new library_1.Decimal(0)) ? adjustment.amountDelta : new library_1.Decimal(0);
        const credit = adjustment.amountDelta.lt(new library_1.Decimal(0))
            ? adjustment.amountDelta.abs()
            : new library_1.Decimal(0);
        rawEntries.push({
            id: `adjustment-${adjustment.id}`,
            occurredAt: adjustment.createdAt,
            createdAt: adjustment.createdAt,
            sortOrder: 1,
            entryType: "due_adjustment",
            action: describeDueAdjustment(adjustment.adjustmentType, adjustment.amountDelta),
            dueType: adjustment.paymentDue.dueType?.name ?? null,
            detail: adjustment.paymentDue.period,
            description: describeDueAdjustment(adjustment.adjustmentType, adjustment.amountDelta),
            reference: adjustment.paymentDue.period,
            note: adjustment.reason ?? null,
            debit,
            credit,
            actor: adjustment.createdBy?.email ?? "System",
            paymentId: null,
            paymentDueId: adjustment.paymentDueId,
            receiptAvailable: false,
            reversible: false,
        });
    }
    for (const payment of payments) {
        const isCreditPayment = payment.paymentKind === "credit" || !payment.paymentDueId;
        rawEntries.push({
            id: `payment-${payment.id}`,
            occurredAt: payment.paymentDate,
            createdAt: payment.createdAt,
            sortOrder: 2,
            entryType: "payment",
            action: isCreditPayment ? "Credit Payment Received" : "Payment Received",
            dueType: isCreditPayment ? "Credit" : payment.paymentDue?.dueType?.name ?? null,
            detail: isCreditPayment ? CREDIT_PAYMENT_REFERENCE : payment.paymentDue?.period ?? null,
            description: isCreditPayment ? "Credit Payment Received" : "Payment Received",
            reference: isCreditPayment ? CREDIT_PAYMENT_REFERENCE : payment.paymentDue?.period ?? null,
            note: payment.note ?? null,
            debit: new library_1.Decimal(0),
            credit: payment.amount,
            actor: payment.collectedBy?.email ?? null,
            paymentId: payment.id,
            paymentDueId: payment.paymentDueId,
            receiptAvailable: true,
            reversible: !payment.isReversed,
        });
        if (payment.isReversed && payment.reversedAt) {
            rawEntries.push({
                id: `payment-reversal-${payment.id}`,
                occurredAt: payment.reversedAt,
                createdAt: payment.createdAt,
                sortOrder: 3,
                entryType: "payment_reversal",
                action: isCreditPayment ? "Credit Payment Reversed" : "Payment Reversed",
                dueType: isCreditPayment ? "Credit" : payment.paymentDue?.dueType?.name ?? null,
                detail: isCreditPayment ? CREDIT_PAYMENT_REFERENCE : payment.paymentDue?.period ?? null,
                description: isCreditPayment ? "Credit Payment Reversed" : "Payment Reversed",
                reference: isCreditPayment ? CREDIT_PAYMENT_REFERENCE : payment.paymentDue?.period ?? null,
                note: payment.reversalReason ?? null,
                debit: payment.amount,
                credit: new library_1.Decimal(0),
                actor: payment.reversedBy?.email ?? "System",
                paymentId: payment.id,
                paymentDueId: payment.paymentDueId,
                receiptAvailable: false,
                reversible: false,
            });
        }
    }
    rawEntries.sort((a, b) => {
        const at = a.occurredAt.getTime() - b.occurredAt.getTime();
        if (at !== 0)
            return at;
        const ct = a.createdAt.getTime() - b.createdAt.getTime();
        if (ct !== 0)
            return ct;
        if (a.sortOrder !== b.sortOrder)
            return a.sortOrder - b.sortOrder;
        return a.id.localeCompare(b.id);
    });
    let runningBalance = new library_1.Decimal(0);
    const items = rawEntries.map((entry) => {
        runningBalance = runningBalance.add(entry.debit).sub(entry.credit);
        return {
            id: entry.id,
            entryType: entry.entryType,
            occurredAt: entry.occurredAt.toISOString(),
            action: entry.action,
            dueType: entry.dueType,
            detail: entry.detail,
            description: entry.description,
            reference: entry.reference,
            note: entry.note,
            debit: entry.debit.toNumber(),
            credit: entry.credit.toNumber(),
            balance: runningBalance.toNumber(),
            actor: entry.actor,
            paymentId: entry.paymentId,
            paymentDueId: entry.paymentDueId,
            receiptAvailable: entry.receiptAvailable,
            reversible: entry.reversible,
        };
    });
    return res.json({
        membershipId: membership.id,
        membershipNo: membership.membershipNo,
        items,
        total: items.length,
    });
});
// List credit ledger entries for a membership
exports.paymentsRouter.get("/credit/:membershipId", async (req, res) => {
    const membership = await prisma_js_1.prisma.membership.findUnique({
        where: { id: req.params.membershipId },
        select: { id: true, organizationId: true, membershipNo: true },
    });
    if (!membership)
        return res.status(404).json({ error: "Membership not found" });
    if (req.auth.organizationId && membership.organizationId !== req.auth.organizationId && req.auth.role !== "super_user") {
        return res.status(403).json({ error: "Forbidden" });
    }
    const page = Math.max(1, parseInt(String(req.query.page), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit), 10) || 20));
    const order = req.query.order === "asc" ? "asc" : "desc";
    const [entries, total, balance] = await prisma_js_1.prisma.$transaction(async (tx) => {
        const [items, count, credit] = await Promise.all([
            tx.membershipCreditLedger.findMany({
                where: { membershipId: membership.id },
                skip: (page - 1) * limit,
                take: limit,
                orderBy: [{ createdAt: order }, { id: order }],
                include: {
                    paymentDue: { select: { id: true, period: true } },
                    payment: { select: { id: true, amount: true, paymentDate: true } },
                    createdBy: { select: { id: true, email: true } },
                },
            }),
            tx.membershipCreditLedger.count({ where: { membershipId: membership.id } }),
            (0, membership_credit_js_1.getMembershipCreditBalance)(tx, membership.id),
        ]);
        return [items, count, credit];
    });
    return res.json({
        membershipId: membership.id,
        membershipNo: membership.membershipNo,
        balance: balance.toNumber(),
        entries,
        total,
        page,
        limit,
        order,
    });
});
exports.paymentsRouter.post("/credit/:membershipId/rebalance-negative", async (req, res) => {
    if (req.auth.role !== "admin" && req.auth.role !== "super_user") {
        return res.status(403).json({ error: "Only admins can rebalance negative credit" });
    }
    const membership = await prisma_js_1.prisma.membership.findUnique({
        where: { id: req.params.membershipId },
        select: { id: true, organizationId: true, membershipNo: true },
    });
    if (!membership)
        return res.status(404).json({ error: "Membership not found" });
    if (req.auth.organizationId &&
        membership.organizationId !== req.auth.organizationId &&
        req.auth.role !== "super_user") {
        return res.status(403).json({ error: "Forbidden" });
    }
    const transferred = await prisma_js_1.prisma.$transaction((tx) => (0, membership_credit_js_1.moveNegativeCreditBalanceToDue)(tx, {
        membershipId: membership.id,
        organizationId: membership.organizationId,
        createdByUserId: req.auth.userId,
        dueDate: new Date(),
        dueReason: "Credit Balance Transfer",
        ledgerNote: "Negative credit balance moved to due by manual reconciliation",
    }));
    return res.json({
        membershipId: membership.id,
        membershipNo: membership.membershipNo,
        transferred: transferred.toNumber(),
        changed: transferred.gt(new library_1.Decimal(0)),
    });
});
// Record a payment either against a due or directly into member credit.
const recordPaymentSchema = zod_1.z
    .object({
    paymentKind: zod_1.z.enum(["due", "credit"]).default("due"),
    paymentDueId: zod_1.z.string().optional(),
    membershipId: zod_1.z.string().optional(),
    amount: zod_1.z.number().positive(),
    paymentDate: zod_1.z.string().optional(),
    paymentMethod: paymentMethodSchema.optional(),
    note: zod_1.z.string().optional(),
})
    .superRefine((data, ctx) => {
    if (data.paymentKind === "credit") {
        if (!data.membershipId) {
            ctx.addIssue({
                code: zod_1.z.ZodIssueCode.custom,
                path: ["membershipId"],
                message: "membershipId is required for credit payments",
            });
        }
        if (data.paymentDueId) {
            ctx.addIssue({
                code: zod_1.z.ZodIssueCode.custom,
                path: ["paymentDueId"],
                message: "paymentDueId is not allowed for credit payments",
            });
        }
        return;
    }
    if (!data.paymentDueId) {
        ctx.addIssue({
            code: zod_1.z.ZodIssueCode.custom,
            path: ["paymentDueId"],
            message: "paymentDueId is required for due payments",
        });
    }
    if (data.membershipId) {
        ctx.addIssue({
            code: zod_1.z.ZodIssueCode.custom,
            path: ["membershipId"],
            message: "membershipId is not allowed for due payments",
        });
    }
});
exports.paymentsRouter.post("/", async (req, res) => {
    const parsed = recordPaymentSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    const paymentAmount = toDecimal(parsed.data.amount);
    const paymentMethod = parsed.data.paymentMethod ?? "cash";
    if (parsed.data.paymentKind === "credit") {
        const membership = await prisma_js_1.prisma.membership.findUnique({
            where: { id: parsed.data.membershipId },
            select: {
                id: true,
                organizationId: true,
                membershipNo: true,
                hod: { select: { whatsAppNumber: true } },
            },
        });
        if (!membership)
            return res.status(404).json({ error: "Membership not found" });
        if (req.auth.organizationId &&
            membership.organizationId !== req.auth.organizationId &&
            req.auth.role !== "super_user") {
            return res.status(403).json({ error: "Forbidden" });
        }
        try {
            const payment = await withReceiptNumberRetry(() => prisma_js_1.prisma.$transaction(async (tx) => {
                const paymentDate = parsed.data.paymentDate
                    ? new Date(parsed.data.paymentDate)
                    : new Date();
                const receiptNumber = await generateReceiptNumber(tx, membership.organizationId, paymentDate);
                const createdPayment = await tx.payment.create({
                    data: {
                        paymentDueId: null,
                        membershipId: membership.id,
                        organizationId: membership.organizationId,
                        receiptNumber,
                        paymentKind: "credit",
                        paymentMethod,
                        amount: paymentAmount,
                        paymentDate,
                        collectedByUserId: req.auth.userId,
                        note: parsed.data.note ?? null,
                    },
                });
                await (0, membership_credit_js_1.addOverpaymentCreditEntry)(tx, {
                    membershipId: membership.id,
                    organizationId: membership.organizationId,
                    paymentId: createdPayment.id,
                    paymentDueId: null,
                    amount: paymentAmount,
                    createdByUserId: req.auth.userId,
                    note: CREDIT_PAYMENT_LEDGER_NOTE,
                });
                await (0, accounting_js_1.postPaymentAccountingEntry)(tx, {
                    paymentId: createdPayment.id,
                    organizationId: membership.organizationId,
                    paymentDate,
                    paymentMethod,
                    directDueTypeId: null,
                    directAppliedAmount: new library_1.Decimal(0),
                    creditAmount: paymentAmount,
                    createdByUserId: req.auth.userId,
                    description: "Credit payment received",
                });
                await (0, membership_credit_js_1.applyAvailableCreditAcrossOutstandingDues)(tx, {
                    membershipId: membership.id,
                    createdByUserId: req.auth.userId,
                });
                const snapshot = await loadReceiptBalanceSnapshot(tx, membership.id);
                return tx.payment.update({
                    where: { id: createdPayment.id },
                    data: {
                        outstandingAfterPayment: snapshot.outstandingAfterPayment,
                        creditBalanceAfterPayment: snapshot.creditBalanceAfterPayment,
                    },
                });
            }, CREDIT_SWEEP_TRANSACTION_OPTIONS));
            if (membership.hod?.whatsAppNumber) {
                (0, message_queue_js_1.queuePaymentReceived)(membership.organizationId, membership.hod.whatsAppNumber, membership.membershipNo, paymentAmount.toString()).catch(() => { });
            }
            return res.status(201).json(payment);
        }
        catch (error) {
            console.error("Credit payment record error:", error);
            return res.status(500).json({ error: "Failed to record credit payment" });
        }
    }
    const due = await prisma_js_1.prisma.paymentDue.findUnique({
        where: { id: parsed.data.paymentDueId },
        include: { membership: true, dueType: true },
    });
    if (!due)
        return res.status(404).json({ error: "Payment due not found" });
    if (due.isSystemAdjustment) {
        return res.status(409).json({ error: "System adjustment dues cannot be paid manually" });
    }
    if (req.auth.organizationId && due.organizationId !== req.auth.organizationId && req.auth.role !== "super_user") {
        return res.status(403).json({ error: "Forbidden" });
    }
    const dueRemaining = due.amountDue.sub(due.amountPaid);
    const remaining = dueRemaining.gt(new library_1.Decimal(0)) ? dueRemaining : new library_1.Decimal(0);
    const appliedToDue = minDecimal(paymentAmount, remaining);
    const overpaymentAmount = paymentAmount.sub(appliedToDue);
    const nextPaid = due.amountPaid.add(appliedToDue);
    const payment = await withReceiptNumberRetry(() => prisma_js_1.prisma.$transaction(async (tx) => {
        const paymentDate = parsed.data.paymentDate
            ? new Date(parsed.data.paymentDate)
            : new Date();
        const receiptNumber = await generateReceiptNumber(tx, due.organizationId, paymentDate);
        const createdPayment = await tx.payment.create({
            data: {
                paymentDueId: due.id,
                membershipId: due.membershipId,
                organizationId: due.organizationId,
                receiptNumber,
                paymentKind: "due",
                paymentMethod,
                amount: paymentAmount,
                paymentDate,
                collectedByUserId: req.auth.userId,
                note: parsed.data.note ?? null,
            },
        });
        if (appliedToDue.gt(new library_1.Decimal(0))) {
            let newStatus = "partial";
            if (nextPaid.gte(due.amountDue))
                newStatus = "paid";
            await tx.paymentDue.update({
                where: { id: due.id },
                data: { amountPaid: nextPaid, status: newStatus },
            });
        }
        if (overpaymentAmount.gt(new library_1.Decimal(0))) {
            await (0, membership_credit_js_1.addOverpaymentCreditEntry)(tx, {
                membershipId: due.membershipId,
                organizationId: due.organizationId,
                paymentId: createdPayment.id,
                paymentDueId: due.id,
                amount: overpaymentAmount,
                createdByUserId: req.auth.userId,
                note: "Excess amount moved to member credit",
            });
        }
        await (0, accounting_js_1.postPaymentAccountingEntry)(tx, {
            paymentId: createdPayment.id,
            organizationId: due.organizationId,
            paymentDate,
            paymentMethod,
            directDueTypeId: due.dueTypeId,
            directAppliedAmount: appliedToDue,
            creditAmount: overpaymentAmount,
            createdByUserId: req.auth.userId,
            description: `Payment received for ${due.dueType?.name ?? "due"}`,
        });
        if (overpaymentAmount.gt(new library_1.Decimal(0))) {
            await (0, membership_credit_js_1.applyAvailableCreditAcrossOutstandingDues)(tx, {
                membershipId: due.membershipId,
                createdByUserId: req.auth.userId,
            });
        }
        const snapshot = await loadReceiptBalanceSnapshot(tx, due.membershipId);
        return tx.payment.update({
            where: { id: createdPayment.id },
            data: {
                outstandingAfterPayment: snapshot.outstandingAfterPayment,
                creditBalanceAfterPayment: snapshot.creditBalanceAfterPayment,
            },
        });
    }, CREDIT_SWEEP_TRANSACTION_OPTIONS));
    const membership = await prisma_js_1.prisma.membership.findUnique({
        where: { id: due.membershipId },
        select: { membershipNo: true, hod: { select: { whatsAppNumber: true } } },
    });
    if (membership?.hod?.whatsAppNumber) {
        (0, message_queue_js_1.queuePaymentReceived)(due.organizationId, membership.hod.whatsAppNumber, membership.membershipNo, paymentAmount.toString()).catch(() => { });
    }
    return res.status(201).json(payment);
});
// Organization-scoped payment history
exports.paymentsRouter.get("/history", async (req, res) => {
    const orgId = getOrgId(req);
    if (!orgId && req.auth.role !== "super_user")
        return res.status(400).json({ error: "Organization scope required" });
    const membershipId = req.query.membershipId;
    const q = req.query.q?.trim() || "";
    const page = Math.max(1, parseInt(String(req.query.page), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit), 10) || 20));
    const where = buildOrganizationPaymentHistoryWhere({
        organizationId: orgId,
        membershipId,
        q: q || undefined,
    });
    const [items, total] = await Promise.all([
        prisma_js_1.prisma.payment.findMany({
            where,
            skip: (page - 1) * limit,
            take: limit,
            orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }],
            include: {
                membership: {
                    select: {
                        id: true,
                        membershipNo: true,
                        areaCode: true,
                        hod: { select: { fullName: true, nameWithInitials: true } },
                    },
                },
                paymentDue: { select: { id: true, period: true, amountDue: true } },
                collectedBy: { select: { id: true, email: true } },
            },
        }),
        prisma_js_1.prisma.payment.count({ where }),
    ]);
    return res.json({ items, total, page, limit });
});
// Reconstruct receipt details for any past payment from existing records
exports.paymentsRouter.get("/receipt/:paymentId", async (req, res) => {
    const receipt = await buildReceiptForPayment(req.params.paymentId);
    if (!receipt)
        return res.status(404).json({ error: "Payment not found" });
    if (req.auth.organizationId &&
        receipt.organizationId !== req.auth.organizationId &&
        req.auth.role !== "super_user") {
        return res.status(403).json({ error: "Forbidden" });
    }
    return res.json(receipt);
});
// Transaction history for a membership
exports.paymentsRouter.get("/history/:membershipId", async (req, res) => {
    const membership = await prisma_js_1.prisma.membership.findUnique({
        where: { id: req.params.membershipId },
        select: { id: true, organizationId: true },
    });
    if (!membership)
        return res.status(404).json({ error: "Membership not found" });
    if (req.auth.organizationId && membership.organizationId !== req.auth.organizationId && req.auth.role !== "super_user") {
        return res.status(403).json({ error: "Forbidden" });
    }
    const page = Math.max(1, parseInt(String(req.query.page), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit), 10) || 20));
    const [items, total] = await Promise.all([
        prisma_js_1.prisma.payment.findMany({
            where: {
                membershipId: membership.id,
                ...nonSystemAdjustmentOrStandaloneCreditFilter(),
            },
            skip: (page - 1) * limit,
            take: limit,
            orderBy: { paymentDate: "desc" },
            include: {
                paymentDue: { select: { period: true, amountDue: true } },
                collectedBy: { select: { id: true, email: true } },
            },
        }),
        prisma_js_1.prisma.payment.count({
            where: {
                membershipId: membership.id,
                ...nonSystemAdjustmentOrStandaloneCreditFilter(),
            },
        }),
    ]);
    return res.json({ items, total, page, limit });
});
// Reverse a payment (admin only)
const reversePaymentSchema = zod_1.z.object({
    reason: zod_1.z.string().min(1, "Reversal reason is required"),
});
exports.paymentsRouter.post("/:id/reverse", async (req, res) => {
    if (req.auth.role !== "admin" && req.auth.role !== "super_user") {
        return res.status(403).json({ error: "Only admins can reverse payments" });
    }
    const parsed = reversePaymentSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    const payment = await prisma_js_1.prisma.payment.findUnique({
        where: { id: req.params.id },
        include: { paymentDue: true },
    });
    if (!payment)
        return res.status(404).json({ error: "Payment not found" });
    if (payment.isReversed)
        return res.status(409).json({ error: "Payment is already reversed" });
    if (req.auth.organizationId && payment.organizationId !== req.auth.organizationId && req.auth.role !== "super_user") {
        return res.status(403).json({ error: "Forbidden" });
    }
    const paymentAmount = payment.amount;
    const due = payment.paymentDue;
    await prisma_js_1.prisma.$transaction(async (tx) => {
        await tx.payment.update({
            where: { id: payment.id },
            data: {
                isReversed: true,
                reversedAt: new Date(),
                reversedByUserId: req.auth.userId,
                reversalReason: parsed.data.reason,
            },
        });
        const overpaymentEntries = await tx.membershipCreditLedger.findMany({
            where: { paymentId: payment.id, entryType: "credit_overpayment" },
        });
        const overpaymentTotal = overpaymentEntries.reduce((sum, e) => sum.add(e.amountDelta), new library_1.Decimal(0));
        const appliedToDue = paymentAmount.sub(overpaymentTotal);
        if (due && appliedToDue.gt(new library_1.Decimal(0))) {
            const newPaid = maxDecimal(due.amountPaid.sub(appliedToDue), new library_1.Decimal(0));
            let newStatus = "pending";
            if (newPaid.gt(new library_1.Decimal(0)))
                newStatus = "partial";
            if (newPaid.gte(due.amountDue))
                newStatus = "paid";
            if (due.status === "overdue" && newStatus !== "paid")
                newStatus = "overdue";
            await tx.paymentDue.update({
                where: { id: due.id },
                data: { amountPaid: newPaid, status: newStatus },
            });
        }
        if (overpaymentTotal.gt(new library_1.Decimal(0))) {
            await (0, membership_credit_js_1.restoreAutoAppliedCreditForPaymentReversal)(tx, {
                membershipId: payment.membershipId,
                organizationId: payment.organizationId,
                paymentId: payment.id,
                createdByUserId: req.auth.userId,
                reason: parsed.data.reason,
            });
        }
        if (overpaymentTotal.gt(new library_1.Decimal(0))) {
            await tx.membershipCreditLedger.create({
                data: {
                    membershipId: payment.membershipId,
                    organizationId: payment.organizationId,
                    paymentId: payment.id,
                    paymentDueId: due?.id ?? null,
                    amountDelta: overpaymentTotal.neg(),
                    entryType: "debit_adjustment",
                    note: `Reversal clawback: ${parsed.data.reason}`,
                    createdByUserId: req.auth.userId,
                },
            });
        }
        // A reversal can finish with zero usable credit after restored allocations
        // and the clawback cancel each other out. Skipping the final sweep in that
        // case avoids the most expensive part of the transaction for no benefit.
        const remainingCredit = await (0, membership_credit_js_1.getMembershipCreditBalance)(tx, payment.membershipId);
        if (remainingCredit.gt(new library_1.Decimal(0))) {
            await (0, membership_credit_js_1.applyAvailableCreditAcrossOutstandingDues)(tx, {
                membershipId: payment.membershipId,
                createdByUserId: req.auth.userId,
            });
        }
        await (0, accounting_js_1.postPaymentCorrectionEntries)(tx, {
            organizationId: payment.organizationId,
            paymentId: payment.id,
            entryDate: new Date(),
            createdByUserId: req.auth.userId,
            reason: parsed.data.reason,
        });
    }, CREDIT_SWEEP_TRANSACTION_OPTIONS);
    return res.json({ success: true, message: "Payment reversed" });
});
// Edit due amount (admin only)
const editDueSchema = zod_1.z.object({
    amountDue: zod_1.z.number().min(0, "Amount must be zero or greater"),
    reason: zod_1.z.string().min(1, "Reason is required"),
});
exports.paymentsRouter.patch("/dues/:id", async (req, res) => {
    if (req.auth.role !== "admin" && req.auth.role !== "super_user") {
        return res.status(403).json({ error: "Only admins can edit dues" });
    }
    const parsed = editDueSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    const due = await prisma_js_1.prisma.paymentDue.findUnique({ where: { id: req.params.id } });
    if (!due)
        return res.status(404).json({ error: "Due not found" });
    if (due.isSystemAdjustment) {
        return res.status(409).json({ error: "System adjustment dues cannot be edited" });
    }
    if (req.auth.organizationId && due.organizationId !== req.auth.organizationId && req.auth.role !== "super_user") {
        return res.status(403).json({ error: "Forbidden" });
    }
    const newAmountDue = toDecimal(parsed.data.amountDue);
    const amountDelta = newAmountDue.sub(due.amountDue);
    const updated = await prisma_js_1.prisma.$transaction(async (tx) => {
        const normalizedAmountPaid = minDecimal(due.amountPaid, newAmountDue);
        const excessSettledAmount = maxDecimal(due.amountPaid.sub(normalizedAmountPaid), new library_1.Decimal(0));
        let newStatus = "pending";
        if (normalizedAmountPaid.gt(new library_1.Decimal(0)))
            newStatus = "partial";
        if (normalizedAmountPaid.gte(newAmountDue))
            newStatus = "paid";
        if (due.status === "overdue" && newStatus !== "paid")
            newStatus = "overdue";
        const nextDue = await tx.paymentDue.update({
            where: { id: due.id },
            data: {
                amountDue: newAmountDue,
                amountPaid: normalizedAmountPaid,
                status: newStatus,
            },
            include: {
                membership: {
                    select: {
                        membershipNo: true,
                        hod: { select: { fullName: true, nameWithInitials: true } },
                    },
                },
                dueType: {
                    select: {
                        id: true,
                        name: true,
                        autoAllocate: true,
                        isActive: true,
                        systemKey: true,
                    },
                },
            },
        });
        if (!amountDelta.equals(new library_1.Decimal(0))) {
            await tx.paymentDueAdjustment.create({
                data: {
                    paymentDueId: due.id,
                    membershipId: due.membershipId,
                    organizationId: due.organizationId,
                    amountDelta,
                    adjustmentType: "due_edit",
                    reason: parsed.data.reason,
                    createdByUserId: req.auth.userId,
                },
            });
        }
        if (excessSettledAmount.gt(new library_1.Decimal(0))) {
            await tx.membershipCreditLedger.create({
                data: {
                    membershipId: due.membershipId,
                    organizationId: due.organizationId,
                    paymentDueId: due.id,
                    amountDelta: excessSettledAmount,
                    entryType: "credit_adjustment",
                    note: `Excess settled amount moved to member credit after due reduction: ${parsed.data.reason}`,
                    createdByUserId: req.auth.userId,
                },
            });
        }
        const autoAppliedCredit = await (0, membership_credit_js_1.applyAvailableCreditAcrossOutstandingDues)(tx, {
            membershipId: due.membershipId,
            createdByUserId: req.auth.userId,
        });
        return {
            ...nextDue,
            autoAppliedCredit: autoAppliedCredit.toNumber(),
        };
    }, CREDIT_SWEEP_TRANSACTION_OPTIONS);
    return res.json(updated);
});
exports.paymentsRouter.post("/dues/:id/apply-credit", async (req, res) => {
    if (req.auth.role !== "admin" && req.auth.role !== "super_user") {
        return res.status(403).json({ error: "Only admins can allocate credit to dues" });
    }
    const due = await prisma_js_1.prisma.paymentDue.findUnique({
        where: { id: req.params.id },
        include: {
            dueType: {
                select: {
                    id: true,
                    name: true,
                    autoAllocate: true,
                },
            },
        },
    });
    if (!due)
        return res.status(404).json({ error: "Due not found" });
    if (due.isSystemAdjustment) {
        return res.status(409).json({ error: "System adjustment dues cannot receive manual credit allocation" });
    }
    if (req.auth.organizationId &&
        due.organizationId !== req.auth.organizationId &&
        req.auth.role !== "super_user") {
        return res.status(403).json({ error: "Forbidden" });
    }
    if (due.status === "paid" || !maxDecimal(due.amountDue.sub(due.amountPaid), new library_1.Decimal(0)).gt(new library_1.Decimal(0))) {
        return res.status(409).json({ error: "This due is already fully paid" });
    }
    const applied = await prisma_js_1.prisma.$transaction((tx) => (0, membership_credit_js_1.applyAvailableCreditToDue)(tx, {
        dueId: due.id,
        createdByUserId: req.auth.userId,
        note: `Manually allocated member credit to ${due.dueType.name}`,
    }), CREDIT_SWEEP_TRANSACTION_OPTIONS);
    if (!applied.gt(new library_1.Decimal(0))) {
        return res.status(409).json({ error: "No available credit balance to allocate" });
    }
    return res.json({ success: true, applied: applied.toNumber() });
});
// Periodic payment report (date range)
exports.paymentsRouter.get("/report/periodic", async (req, res) => {
    const orgId = getOrgId(req);
    if (!orgId && req.auth.role !== "super_user")
        return res.status(400).json({ error: "Organization scope required" });
    const fromDate = req.query.fromDate;
    const toDate = req.query.toDate;
    if (!fromDate || !toDate)
        return res.status(400).json({ error: "fromDate and toDate are required" });
    const from = new Date(fromDate);
    const to = new Date(toDate);
    to.setHours(23, 59, 59, 999);
    const where = {
        paymentDate: { gte: from, lte: to },
        ...nonSystemAdjustmentOrStandaloneCreditFilter(),
    };
    if (orgId)
        where.organizationId = orgId;
    const [payments, zones] = await Promise.all([
        prisma_js_1.prisma.payment.findMany({
            where,
            orderBy: [{ paymentDate: "asc" }, { createdAt: "asc" }],
            include: {
                membership: {
                    select: {
                        membershipNo: true,
                        areaCode: true,
                        hod: { select: { fullName: true, nameWithInitials: true } },
                    },
                },
                paymentDue: { select: { period: true, dueType: { select: { name: true, sortOrder: true } } } },
                collectedBy: { select: { email: true } },
                reversedBy: { select: { email: true } },
            },
        }),
        prisma_js_1.prisma.zone.findMany({
            where: orgId ? { organizationId: orgId } : {},
            select: { code: true, name: true },
        }),
    ]);
    const zoneMap = new Map(zones.map((zone) => [zone.code, zone.name]));
    const grossCollected = payments.reduce((sum, p) => sum.add(p.amount), new library_1.Decimal(0));
    const totalReversed = payments
        .filter((p) => p.isReversed)
        .reduce((sum, p) => sum.add(p.amount), new library_1.Decimal(0));
    const netCollected = grossCollected.sub(totalReversed);
    const dueTypeTotals = new Map();
    const activePayments = payments.filter((p) => !p.isReversed);
    const activePaymentIds = activePayments.map((p) => p.id);
    function addDueTypeTotal(dueTypeName, amount, sortOrder) {
        if (!amount.gt(new library_1.Decimal(0)))
            return;
        const existing = dueTypeTotals.get(dueTypeName);
        if (existing) {
            existing.amount = existing.amount.add(amount);
            existing.sortOrder = Math.min(existing.sortOrder, sortOrder);
        }
        else {
            dueTypeTotals.set(dueTypeName, { amount, sortOrder });
        }
    }
    const [overpaymentRows, creditAllocations] = activePaymentIds.length > 0
        ? await Promise.all([
            prisma_js_1.prisma.membershipCreditLedger.groupBy({
                by: ["paymentId"],
                where: {
                    paymentId: { in: activePaymentIds },
                    entryType: "credit_overpayment",
                },
                _sum: { amountDelta: true },
            }),
            prisma_js_1.prisma.membershipCreditAllocation.findMany({
                where: {
                    sourcePaymentId: { in: activePaymentIds },
                    reversedAt: null,
                },
                orderBy: [{ createdAt: "asc" }, { id: "asc" }],
                select: {
                    sourcePaymentId: true,
                    amount: true,
                    paymentDue: {
                        select: {
                            dueType: { select: { name: true, sortOrder: true } },
                        },
                    },
                },
            }),
        ])
        : [[], []];
    const overpaymentByPaymentId = new Map();
    for (const row of overpaymentRows) {
        if (!row.paymentId)
            continue;
        overpaymentByPaymentId.set(row.paymentId, maxDecimal(row._sum.amountDelta ?? new library_1.Decimal(0), new library_1.Decimal(0)));
    }
    const allocationsByPaymentId = new Map();
    for (const allocation of creditAllocations) {
        if (!allocation.sourcePaymentId)
            continue;
        const existing = allocationsByPaymentId.get(allocation.sourcePaymentId) ?? [];
        existing.push(allocation);
        allocationsByPaymentId.set(allocation.sourcePaymentId, existing);
    }
    for (const payment of activePayments) {
        const paymentAmount = new library_1.Decimal(payment.amount);
        const creditCreated = minDecimal(overpaymentByPaymentId.get(payment.id) ??
            (payment.paymentKind === "credit" || !payment.paymentDueId ? paymentAmount : new library_1.Decimal(0)), paymentAmount);
        const directApplied = payment.paymentKind === "credit" || !payment.paymentDueId
            ? new library_1.Decimal(0)
            : maxDecimal(paymentAmount.sub(creditCreated), new library_1.Decimal(0));
        if (directApplied.gt(new library_1.Decimal(0))) {
            addDueTypeTotal(payment.paymentDue?.dueType?.name ?? "Unknown", directApplied, payment.paymentDue?.dueType?.sortOrder ?? Number.MAX_SAFE_INTEGER - 1);
        }
        let remainingCredit = maxDecimal(paymentAmount.sub(directApplied), new library_1.Decimal(0));
        for (const allocation of allocationsByPaymentId.get(payment.id) ?? []) {
            if (!remainingCredit.gt(new library_1.Decimal(0)))
                break;
            const allocatedAmount = minDecimal(allocation.amount, remainingCredit);
            addDueTypeTotal(allocation.paymentDue.dueType?.name ?? "Unknown", allocatedAmount, allocation.paymentDue.dueType?.sortOrder ?? Number.MAX_SAFE_INTEGER - 1);
            remainingCredit = remainingCredit.sub(allocatedAmount);
        }
        addDueTypeTotal("Credit balance", remainingCredit, Number.MAX_SAFE_INTEGER);
    }
    const dueTypeSummary = [...dueTypeTotals.entries()]
        .map(([dueType, value]) => ({
        dueType,
        amount: value.amount.toNumber(),
        sortOrder: value.sortOrder,
    }))
        .filter((item) => Math.abs(item.amount) > 0.000001)
        .sort((a, b) => {
        if (a.sortOrder !== b.sortOrder)
            return a.sortOrder - b.sortOrder;
        if (a.dueType === "Credit balance")
            return 1;
        if (b.dueType === "Credit balance")
            return -1;
        return a.dueType.localeCompare(b.dueType);
    });
    const format = req.query.format;
    if (format === "csv") {
        const headers = [
            "Date",
            "Name with Initials",
            "Zone",
            "Membership ID",
            "Amount",
            "Payment Method",
            "Receipt No",
            "Collected By",
            "Status",
            "Reversal Reason",
            "Reversed By",
            "Note",
        ];
        const csvRows = payments.map((p) => {
            const paymentMethod = getPaymentMethodLabel(p.paymentMethod ?? extractLegacyPaymentMethod(p.note));
            const receiptNumber = p.receiptNumber ?? p.id.slice(-8).toUpperCase();
            const membershipId = extractMembershipId(p.membership.membershipNo);
            const zone = formatZoneLabel(p.membership.areaCode, zoneMap);
            const row = [
                p.paymentDate.toISOString().slice(0, 10),
                p.membership.hod.nameWithInitials || p.membership.hod.fullName,
                zone,
                membershipId,
                Number(p.amount).toFixed(2),
                paymentMethod ?? "",
                receiptNumber,
                p.collectedBy.email,
                p.isReversed ? "Reversed" : "Active",
                p.isReversed ? (p.reversalReason ?? "").replace(/"/g, '""') : "",
                p.isReversed ? (p.reversedBy?.email ?? "").replace(/"/g, '""') : "",
                (p.note ?? "").replace(/"/g, '""'),
            ];
            return row
                .map((value) => String(value))
                .map((v) => (v.includes(",") || v.includes('"') || v.includes("\n") ? `"${v.replace(/"/g, '""')}"` : v))
                .join(",");
        });
        const csv = [headers.join(","), ...csvRows].join("\n");
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", `attachment; filename="payment-report-${fromDate}-to-${toDate}.csv"`);
        return res.send(csv);
    }
    return res.json({
        fromDate,
        toDate,
        totalPayments: payments.length,
        activePayments: payments.filter((p) => !p.isReversed).length,
        reversedPayments: payments.filter((p) => p.isReversed).length,
        totalCollected: grossCollected.toNumber(),
        totalReversed: totalReversed.toNumber(),
        netCollected: netCollected.toNumber(),
        dueTypeSummary,
        payments: payments.map((p) => ({
            id: p.id,
            paymentDate: p.paymentDate.toISOString(),
            memberName: p.membership.hod.nameWithInitials || p.membership.hod.fullName,
            fullName: p.membership.hod.fullName,
            membershipNo: p.membership.membershipNo,
            membershipId: extractMembershipId(p.membership.membershipNo),
            zone: formatZoneLabel(p.membership.areaCode, zoneMap),
            dueType: p.paymentKind === "credit" || !p.paymentDueId
                ? "Credit balance"
                : p.paymentDue?.dueType?.name ?? "Unknown",
            period: p.paymentDue?.period ?? (p.paymentKind === "credit" ? CREDIT_PAYMENT_REFERENCE : "—"),
            amount: Number(p.amount),
            paymentMethod: getPaymentMethodLabel(p.paymentMethod ?? extractLegacyPaymentMethod(p.note)),
            receiptNumber: p.receiptNumber ?? p.id.slice(-8).toUpperCase(),
            note: p.note,
            collectedBy: p.collectedBy.email,
            isReversed: p.isReversed,
            reversedAt: p.reversedAt?.toISOString() ?? null,
            reversalReason: p.reversalReason,
            reversedBy: p.reversedBy?.email ?? null,
        })),
    });
});
// Mark overdue dues after the due month closes.
exports.paymentsRouter.post("/mark-overdue", async (req, res) => {
    const now = new Date();
    const orgId = getOrgId(req);
    const where = {
        isSystemAdjustment: false,
        status: { in: ["pending", "partial"] },
        dueDate: { lt: now },
        OR: [
            { isManual: false },
            { periodStart: { not: null } },
            { periodEnd: { not: null } },
        ],
    };
    if (orgId)
        where.organizationId = orgId;
    const dues = await prisma_js_1.prisma.paymentDue.findMany({
        where,
        select: { id: true, dueDate: true },
    });
    const overdueIds = dues
        .filter((due) => isPastDueGracePeriod(due.dueDate, now))
        .map((due) => due.id);
    if (overdueIds.length > 0) {
        await prisma_js_1.prisma.paymentDue.updateMany({
            where: { id: { in: overdueIds } },
            data: { status: "overdue" },
        });
    }
    return res.json({ updated: overdueIds.length });
});
