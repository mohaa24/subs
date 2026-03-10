"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.paymentsRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const library_1 = require("@prisma/client/runtime/library");
const prisma_js_1 = require("../lib/prisma.js");
const auth_js_1 = require("../middleware/auth.js");
const message_queue_js_1 = require("../lib/message-queue.js");
const membership_credit_js_1 = require("../lib/membership-credit.js");
exports.paymentsRouter = (0, express_1.Router)();
exports.paymentsRouter.use(auth_js_1.requireAuth);
exports.paymentsRouter.use(auth_js_1.withOrgScope);
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
            organization: { select: { id: true, name: true } },
            collectedBy: { select: { email: true } },
        },
    });
    if (!payment)
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
    let remainingAfter = payment.paymentDue.amountDue;
    for (const duePayment of duePayments) {
        const overpayment = maxDecimal(overpaymentByPaymentId.get(duePayment.id) ?? new library_1.Decimal(0), new library_1.Decimal(0));
        const applied = maxDecimal(duePayment.amount.sub(overpayment), new library_1.Decimal(0));
        cumulativeApplied = cumulativeApplied.add(applied);
        if (duePayment.id === payment.id) {
            appliedToDue = applied;
            overpaymentToCredit = overpayment;
            remainingAfter = maxDecimal(payment.paymentDue.amountDue.sub(cumulativeApplied), new library_1.Decimal(0));
            break;
        }
    }
    return {
        paymentId: payment.id,
        paymentDate: payment.paymentDate.toISOString(),
        note: payment.note ?? null,
        period: payment.paymentDue.period,
        membershipId: payment.membership.id,
        membershipNo: payment.membership.membershipNo,
        memberName: payment.membership.hod.fullName || payment.membership.hod.nameWithInitials || "",
        organizationId: payment.organization.id,
        organizationName: payment.organization.name,
        collectedBy: payment.collectedBy.email,
        paidAmount: payment.amount.toNumber(),
        appliedToDue: appliedToDue.toNumber(),
        overpaymentToCredit: overpaymentToCredit.toNumber(),
        remainingAfter: remainingAfter.toNumber(),
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
        const existing = await prisma_js_1.prisma.paymentDue.findUnique({
            where: { membershipId_period: { membershipId: m.id, period } },
        });
        if (existing) {
            skipped++;
            continue;
        }
        const applied = await prisma_js_1.prisma.$transaction(async (tx) => {
            const due = await tx.paymentDue.create({
                data: {
                    membershipId: m.id,
                    organizationId: m.organizationId,
                    dueDate: targetDate,
                    period,
                    amountDue: m.totalContribution,
                    amountPaid: new library_1.Decimal(0),
                    status: "pending",
                },
            });
            return (0, membership_credit_js_1.applyAvailableCreditToDue)(tx, {
                dueId: due.id,
                createdByUserId: req.auth.userId,
                note: `Auto-applied member credit to ${period} due`,
            });
        });
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
// List dues for a membership (with optional status filter)
exports.paymentsRouter.get("/dues", async (req, res) => {
    const orgId = getOrgId(req);
    if (!orgId && req.auth.role !== "super_user")
        return res.status(400).json({ error: "Organization scope required" });
    const membershipId = req.query.membershipId;
    const status = req.query.status;
    const q = req.query.q?.trim() || "";
    const page = Math.max(1, parseInt(String(req.query.page), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit), 10) || 20));
    const where = {};
    if (orgId)
        where.organizationId = orgId;
    if (membershipId)
        where.membershipId = membershipId;
    if (status)
        where.status = status;
    if (q) {
        where.membership = {
            OR: [
                { hod: { fullName: { contains: q, mode: "insensitive" } } },
                { hod: { nameWithInitials: { contains: q, mode: "insensitive" } } },
                { membershipNo: { contains: q, mode: "insensitive" } },
            ],
        };
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
                        hod: { select: { fullName: true, nameWithInitials: true } },
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
    const [dues, creditBalance] = await Promise.all([
        prisma_js_1.prisma.paymentDue.findMany({
            where: { membershipId: membership.id },
            orderBy: { dueDate: "desc" },
        }),
        prisma_js_1.prisma.$transaction((tx) => (0, membership_credit_js_1.getMembershipCreditBalance)(tx, membership.id)),
    ]);
    const totalDue = dues.reduce((sum, d) => sum.add(d.amountDue), new library_1.Decimal(0));
    const totalPaid = dues.reduce((sum, d) => sum.add(d.amountPaid), new library_1.Decimal(0));
    const outstanding = totalDue.sub(totalPaid);
    const netOutstanding = outstanding.sub(creditBalance);
    const overdueCount = dues.filter((d) => d.status === "pending" || d.status === "partial" || d.status === "overdue").length;
    return res.json({
        membershipId: membership.id,
        membershipNo: membership.membershipNo,
        totalDue: totalDue.toNumber(),
        totalPaid: totalPaid.toNumber(),
        outstanding: outstanding.toNumber(),
        creditBalance: creditBalance.toNumber(),
        netOutstanding: netOutstanding.toNumber(),
        overdueCount,
        dues,
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
    const [entries, total, balance] = await prisma_js_1.prisma.$transaction(async (tx) => {
        const [items, count, credit] = await Promise.all([
            tx.membershipCreditLedger.findMany({
                where: { membershipId: membership.id },
                skip: (page - 1) * limit,
                take: limit,
                orderBy: { createdAt: "desc" },
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
    });
});
// Record a payment against a due
const recordPaymentSchema = zod_1.z.object({
    paymentDueId: zod_1.z.string(),
    amount: zod_1.z.number().positive(),
    paymentDate: zod_1.z.string().optional(),
    note: zod_1.z.string().optional(),
});
exports.paymentsRouter.post("/", async (req, res) => {
    const parsed = recordPaymentSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    const due = await prisma_js_1.prisma.paymentDue.findUnique({
        where: { id: parsed.data.paymentDueId },
        include: { membership: true },
    });
    if (!due)
        return res.status(404).json({ error: "Payment due not found" });
    if (req.auth.organizationId && due.organizationId !== req.auth.organizationId && req.auth.role !== "super_user") {
        return res.status(403).json({ error: "Forbidden" });
    }
    const paymentAmount = toDecimal(parsed.data.amount);
    const dueRemaining = due.amountDue.sub(due.amountPaid);
    const remaining = dueRemaining.gt(new library_1.Decimal(0)) ? dueRemaining : new library_1.Decimal(0);
    const appliedToDue = minDecimal(paymentAmount, remaining);
    const overpaymentAmount = paymentAmount.sub(appliedToDue);
    const nextPaid = due.amountPaid.add(appliedToDue);
    const payment = await prisma_js_1.prisma.$transaction(async (tx) => {
        const createdPayment = await tx.payment.create({
            data: {
                paymentDueId: due.id,
                membershipId: due.membershipId,
                organizationId: due.organizationId,
                amount: paymentAmount,
                paymentDate: parsed.data.paymentDate ? new Date(parsed.data.paymentDate) : new Date(),
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
        return createdPayment;
    });
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
    const page = Math.max(1, parseInt(String(req.query.page), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit), 10) || 20));
    const where = {};
    if (orgId)
        where.organizationId = orgId;
    if (membershipId)
        where.membershipId = membershipId;
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
            where: { membershipId: membership.id },
            skip: (page - 1) * limit,
            take: limit,
            orderBy: { paymentDate: "desc" },
            include: {
                paymentDue: { select: { period: true, amountDue: true } },
                collectedBy: { select: { id: true, email: true } },
            },
        }),
        prisma_js_1.prisma.payment.count({ where: { membershipId: membership.id } }),
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
        if (appliedToDue.gt(new library_1.Decimal(0))) {
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
            await tx.membershipCreditLedger.create({
                data: {
                    membershipId: payment.membershipId,
                    organizationId: payment.organizationId,
                    paymentId: payment.id,
                    paymentDueId: due.id,
                    amountDelta: overpaymentTotal.neg(),
                    entryType: "debit_adjustment",
                    note: `Reversal clawback: ${parsed.data.reason}`,
                    createdByUserId: req.auth.userId,
                },
            });
        }
    });
    return res.json({ success: true, message: "Payment reversed" });
});
// Edit due amount (admin only)
const editDueSchema = zod_1.z.object({
    amountDue: zod_1.z.number().positive("Amount must be positive"),
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
    if (req.auth.organizationId && due.organizationId !== req.auth.organizationId && req.auth.role !== "super_user") {
        return res.status(403).json({ error: "Forbidden" });
    }
    const newAmountDue = toDecimal(parsed.data.amountDue);
    let newStatus = "pending";
    if (due.amountPaid.gt(new library_1.Decimal(0)))
        newStatus = "partial";
    if (due.amountPaid.gte(newAmountDue))
        newStatus = "paid";
    const updated = await prisma_js_1.prisma.paymentDue.update({
        where: { id: due.id },
        data: {
            amountDue: newAmountDue,
            status: newStatus,
        },
        include: {
            membership: {
                select: {
                    membershipNo: true,
                    hod: { select: { fullName: true, nameWithInitials: true } },
                },
            },
        },
    });
    return res.json(updated);
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
    };
    if (orgId)
        where.organizationId = orgId;
    const payments = await prisma_js_1.prisma.payment.findMany({
        where,
        orderBy: [{ paymentDate: "asc" }, { createdAt: "asc" }],
        include: {
            membership: {
                select: {
                    membershipNo: true,
                    hod: { select: { fullName: true, nameWithInitials: true } },
                },
            },
            paymentDue: { select: { period: true } },
            collectedBy: { select: { email: true } },
            reversedBy: { select: { email: true } },
        },
    });
    const totalCollected = payments
        .filter((p) => !p.isReversed)
        .reduce((sum, p) => sum.add(p.amount), new library_1.Decimal(0));
    const totalReversed = payments
        .filter((p) => p.isReversed)
        .reduce((sum, p) => sum.add(p.amount), new library_1.Decimal(0));
    const format = req.query.format;
    if (format === "csv") {
        const headers = ["Date", "Member", "Membership No", "Period", "Amount", "Method/Note", "Collected By", "Status", "Reversal Reason"];
        const csvRows = payments.map((p) => {
            const row = [
                p.paymentDate.toISOString().slice(0, 10),
                p.membership.hod.fullName || p.membership.hod.nameWithInitials,
                p.membership.membershipNo,
                p.paymentDue.period,
                Number(p.amount).toFixed(2),
                (p.note ?? "").replace(/"/g, '""'),
                p.collectedBy.email,
                p.isReversed ? "Reversed" : "Active",
                p.isReversed ? (p.reversalReason ?? "").replace(/"/g, '""') : "",
            ];
            return row.map((v) => (v.includes(",") || v.includes('"') ? `"${v}"` : v)).join(",");
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
        totalCollected: totalCollected.toNumber(),
        totalReversed: totalReversed.toNumber(),
        netCollected: totalCollected.sub(totalReversed).toNumber(),
        payments: payments.map((p) => ({
            id: p.id,
            paymentDate: p.paymentDate.toISOString(),
            memberName: p.membership.hod.fullName || p.membership.hod.nameWithInitials,
            membershipNo: p.membership.membershipNo,
            period: p.paymentDue.period,
            amount: Number(p.amount),
            note: p.note,
            collectedBy: p.collectedBy.email,
            isReversed: p.isReversed,
            reversedAt: p.reversedAt?.toISOString() ?? null,
            reversalReason: p.reversalReason,
            reversedBy: p.reversedBy?.email ?? null,
        })),
    });
});
// Mark overdue dues (dues past dueDate still pending/partial)
exports.paymentsRouter.post("/mark-overdue", async (req, res) => {
    const orgId = getOrgId(req);
    const where = {
        status: { in: ["pending", "partial"] },
        dueDate: { lt: new Date() },
    };
    if (orgId)
        where.organizationId = orgId;
    const result = await prisma_js_1.prisma.paymentDue.updateMany({
        where,
        data: { status: "overdue" },
    });
    return res.json({ updated: result.count });
});
