import { Router } from "express";
import { z } from "zod";
import { DueStatus } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "../lib/prisma.js";
import { requireAuth, withOrgScope } from "../middleware/auth.js";
import { queuePaymentReceived } from "../lib/message-queue.js";
import {
  addOverpaymentCreditEntry,
  applyAvailableCreditToDue,
  getMembershipCreditBalance,
} from "../lib/membership-credit.js";

export const paymentsRouter = Router();

paymentsRouter.use(requireAuth);
paymentsRouter.use(withOrgScope);

function getOrgId(req: any): string | undefined {
  return req.organizationId ?? req.body?.organizationId ?? req.query?.organizationId;
}

function toDecimal(n: number) {
  return new Decimal(n);
}

function minDecimal(a: Decimal, b: Decimal): Decimal {
  return a.lte(b) ? a : b;
}

function maxDecimal(a: Decimal, b: Decimal): Decimal {
  return a.gte(b) ? a : b;
}

function periodString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function dateOnlyString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseOptionalDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function buildManualDuePeriod(start: Date | null, end: Date | null) {
  if (start && end) return `${dateOnlyString(start)} to ${dateOnlyString(end)}`;
  if (start) return `From ${dateOnlyString(start)}`;
  if (end) return `Until ${dateOnlyString(end)}`;
  return "Manual due";
}

async function buildReceiptForPayment(paymentId: string) {
  const payment = await prisma.payment.findUnique({
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
  if (!payment) return null;

  const duePayments = await prisma.payment.findMany({
    where: { paymentDueId: payment.paymentDueId },
    select: { id: true, amount: true, paymentDate: true, createdAt: true },
    orderBy: [{ paymentDate: "asc" }, { createdAt: "asc" }],
  });

  const duePaymentIds = duePayments.map((p) => p.id);
  const overpaymentRows = await prisma.membershipCreditLedger.groupBy({
    by: ["paymentId"],
    where: {
      paymentId: { in: duePaymentIds },
      entryType: "credit_overpayment",
    },
    _sum: { amountDelta: true },
  });
  const overpaymentByPaymentId = new Map<string, Decimal>();
  for (const row of overpaymentRows) {
    if (!row.paymentId) continue;
    overpaymentByPaymentId.set(row.paymentId, row._sum.amountDelta ?? new Decimal(0));
  }

  let cumulativeApplied = new Decimal(0);
  let appliedToDue = new Decimal(0);
  let overpaymentToCredit = new Decimal(0);
  let remainingAfter = payment.paymentDue.amountDue;

  for (const duePayment of duePayments) {
    const overpayment = maxDecimal(
      overpaymentByPaymentId.get(duePayment.id) ?? new Decimal(0),
      new Decimal(0)
    );
    const applied = maxDecimal(duePayment.amount.sub(overpayment), new Decimal(0));
    cumulativeApplied = cumulativeApplied.add(applied);

    if (duePayment.id === payment.id) {
      appliedToDue = applied;
      overpaymentToCredit = overpayment;
      remainingAfter = maxDecimal(
        payment.paymentDue.amountDue.sub(cumulativeApplied),
        new Decimal(0)
      );
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
paymentsRouter.post("/generate-dues", async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId && req.auth!.role !== "super_user")
    return res.status(400).json({ error: "Organization scope required" });

  const now = new Date();
  const targetDate = req.body?.period
    ? new Date(req.body.period + "-01")
    : new Date(now.getFullYear(), now.getMonth(), 1);
  const period = periodString(targetDate);

  const where: any = { membershipStatus: "Active" };
  if (orgId) where.organizationId = orgId;

  const memberships = await prisma.membership.findMany({ where });

  let created = 0;
  let skipped = 0;
  let autoAppliedCredit = new Decimal(0);

  for (const m of memberships) {
    const shouldGenerate =
      m.paymentPeriod === "Monthly" ||
      (m.paymentPeriod === "Quarterly" && targetDate.getMonth() % 3 === 0) ||
      (m.paymentPeriod === "Annually" && targetDate.getMonth() === 0);

    if (!shouldGenerate) {
      skipped++;
      continue;
    }

    const existing = await prisma.paymentDue.findFirst({
      where: { membershipId: m.id, period, isManual: false },
    });
    if (existing) {
      skipped++;
      continue;
    }

    const applied = await prisma.$transaction(async (tx) => {
      const due = await tx.paymentDue.create({
        data: {
          membershipId: m.id,
          organizationId: m.organizationId,
          dueDate: targetDate,
          period,
          amountDue: m.totalContribution,
          amountPaid: new Decimal(0),
          status: "pending",
        },
      });
      return applyAvailableCreditToDue(tx, {
        dueId: due.id,
        createdByUserId: req.auth!.userId,
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

const createManualDueSchema = z.object({
  membershipId: z.string().min(1),
  amountDue: z.number().positive("Amount must be greater than zero"),
  reason: z.string().trim().optional().nullable(),
  periodFrom: z.string().optional().nullable(),
  periodTo: z.string().optional().nullable(),
});

paymentsRouter.post("/dues", async (req, res) => {
  if (req.auth!.role !== "admin" && req.auth!.role !== "super_user") {
    return res.status(403).json({ error: "Only admins can create manual dues" });
  }

  const parsed = createManualDueSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  }

  const membership = await prisma.membership.findUnique({
    where: { id: parsed.data.membershipId },
    select: { id: true, organizationId: true, membershipNo: true },
  });
  if (!membership) return res.status(404).json({ error: "Membership not found" });
  if (req.auth!.organizationId && membership.organizationId !== req.auth!.organizationId && req.auth!.role !== "super_user") {
    return res.status(403).json({ error: "Forbidden" });
  }

  const periodStart = parseOptionalDate(parsed.data.periodFrom);
  const periodEnd = parseOptionalDate(parsed.data.periodTo);
  if (parsed.data.periodFrom && !periodStart) return res.status(400).json({ error: "Invalid period start" });
  if (parsed.data.periodTo && !periodEnd) return res.status(400).json({ error: "Invalid period end" });
  if (periodStart && periodEnd && periodEnd < periodStart) {
    return res.status(400).json({ error: "Period end must be on or after period start" });
  }

  const period = buildManualDuePeriod(periodStart, periodEnd);
  const dueDate = periodEnd ?? periodStart ?? new Date();
  const normalizedReason = parsed.data.reason?.trim() ? parsed.data.reason.trim() : null;

  const created = await prisma.$transaction(async (tx) => {
    const due = await tx.paymentDue.create({
      data: {
        membershipId: membership.id,
        organizationId: membership.organizationId,
        dueDate,
        period,
        isManual: true,
        reason: normalizedReason,
        periodStart,
        periodEnd,
        amountDue: toDecimal(parsed.data.amountDue),
        amountPaid: new Decimal(0),
        status: "pending",
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
    const autoAppliedCredit = await applyAvailableCreditToDue(tx, {
      dueId: due.id,
      createdByUserId: req.auth!.userId,
      note: normalizedReason
        ? `Auto-applied member credit to manual due: ${normalizedReason}`
        : "Auto-applied member credit to manual due",
    });
    return { due, autoAppliedCredit };
  });

  return res.status(201).json({
    ...created.due,
    autoAppliedCredit: created.autoAppliedCredit.toNumber(),
  });
});

// List dues for a membership (with optional status filter)
paymentsRouter.get("/dues", async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId && req.auth!.role !== "super_user")
    return res.status(400).json({ error: "Organization scope required" });

  const membershipId = req.query.membershipId as string | undefined;
  const status = req.query.status as DueStatus | undefined;
  const q = (req.query.q as string)?.trim() || "";
  const page = Math.max(1, parseInt(String(req.query.page), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit), 10) || 20));

  const where: any = {};
  if (orgId) where.organizationId = orgId;
  if (membershipId) where.membershipId = membershipId;
  if (status) where.status = status;
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
    prisma.paymentDue.findMany({
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
    prisma.paymentDue.count({ where }),
  ]);

  return res.json({ items, total, page, limit });
});

// Get outstanding balance for a membership
paymentsRouter.get("/balance/:membershipId", async (req, res) => {
  const membership = await prisma.membership.findUnique({
    where: { id: req.params.membershipId },
    select: { id: true, organizationId: true, membershipNo: true },
  });
  if (!membership) return res.status(404).json({ error: "Membership not found" });
  if (req.auth!.organizationId && membership.organizationId !== req.auth!.organizationId && req.auth!.role !== "super_user") {
    return res.status(403).json({ error: "Forbidden" });
  }

  const [dues, creditBalance] = await Promise.all([
    prisma.paymentDue.findMany({
      where: { membershipId: membership.id },
      orderBy: { dueDate: "desc" },
    }),
    prisma.$transaction((tx) => getMembershipCreditBalance(tx, membership.id)),
  ]);

  const totalDue = dues.reduce((sum, d) => sum.add(d.amountDue), new Decimal(0));
  const totalPaid = dues.reduce((sum, d) => sum.add(d.amountPaid), new Decimal(0));
  const outstanding = totalDue.sub(totalPaid);
  const netOutstanding = outstanding.sub(creditBalance);
  const overdueCount = dues.filter(
    (d) => d.status === "pending" || d.status === "partial" || d.status === "overdue"
  ).length;

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
paymentsRouter.get("/credit/:membershipId", async (req, res) => {
  const membership = await prisma.membership.findUnique({
    where: { id: req.params.membershipId },
    select: { id: true, organizationId: true, membershipNo: true },
  });
  if (!membership) return res.status(404).json({ error: "Membership not found" });
  if (req.auth!.organizationId && membership.organizationId !== req.auth!.organizationId && req.auth!.role !== "super_user") {
    return res.status(403).json({ error: "Forbidden" });
  }

  const page = Math.max(1, parseInt(String(req.query.page), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit), 10) || 20));

  const [entries, total, balance] = await prisma.$transaction(async (tx) => {
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
      getMembershipCreditBalance(tx, membership.id),
    ]);
    return [items, count, credit] as const;
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
const recordPaymentSchema = z.object({
  paymentDueId: z.string(),
  amount: z.number().positive(),
  paymentDate: z.string().optional(),
  note: z.string().optional(),
});

paymentsRouter.post("/", async (req, res) => {
  const parsed = recordPaymentSchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

  const due = await prisma.paymentDue.findUnique({
    where: { id: parsed.data.paymentDueId },
    include: { membership: true },
  });
  if (!due) return res.status(404).json({ error: "Payment due not found" });
  if (req.auth!.organizationId && due.organizationId !== req.auth!.organizationId && req.auth!.role !== "super_user") {
    return res.status(403).json({ error: "Forbidden" });
  }

  const paymentAmount = toDecimal(parsed.data.amount);
  const dueRemaining = due.amountDue.sub(due.amountPaid);
  const remaining = dueRemaining.gt(new Decimal(0)) ? dueRemaining : new Decimal(0);
  const appliedToDue = minDecimal(paymentAmount, remaining);
  const overpaymentAmount = paymentAmount.sub(appliedToDue);
  const nextPaid = due.amountPaid.add(appliedToDue);

  const payment = await prisma.$transaction(async (tx) => {
    const createdPayment = await tx.payment.create({
      data: {
        paymentDueId: due.id,
        membershipId: due.membershipId,
        organizationId: due.organizationId,
        amount: paymentAmount,
        paymentDate: parsed.data.paymentDate ? new Date(parsed.data.paymentDate) : new Date(),
        collectedByUserId: req.auth!.userId,
        note: parsed.data.note ?? null,
      },
    });

    if (appliedToDue.gt(new Decimal(0))) {
      let newStatus: DueStatus = "partial";
      if (nextPaid.gte(due.amountDue)) newStatus = "paid";

      await tx.paymentDue.update({
        where: { id: due.id },
        data: { amountPaid: nextPaid, status: newStatus },
      });
    }

    if (overpaymentAmount.gt(new Decimal(0))) {
      await addOverpaymentCreditEntry(tx, {
        membershipId: due.membershipId,
        organizationId: due.organizationId,
        paymentId: createdPayment.id,
        paymentDueId: due.id,
        amount: overpaymentAmount,
        createdByUserId: req.auth!.userId,
        note: "Excess amount moved to member credit",
      });
    }

    return createdPayment;
  });

  const membership = await prisma.membership.findUnique({
    where: { id: due.membershipId },
    select: { membershipNo: true, hod: { select: { whatsAppNumber: true } } },
  });
  if (membership?.hod?.whatsAppNumber) {
    queuePaymentReceived(
      due.organizationId,
      membership.hod.whatsAppNumber,
      membership.membershipNo,
      paymentAmount.toString()
    ).catch(() => {});
  }

  return res.status(201).json(payment);
});

// Organization-scoped payment history
paymentsRouter.get("/history", async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId && req.auth!.role !== "super_user")
    return res.status(400).json({ error: "Organization scope required" });

  const membershipId = req.query.membershipId as string | undefined;
  const page = Math.max(1, parseInt(String(req.query.page), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit), 10) || 20));

  const where: any = {};
  if (orgId) where.organizationId = orgId;
  if (membershipId) where.membershipId = membershipId;

  const [items, total] = await Promise.all([
    prisma.payment.findMany({
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
    prisma.payment.count({ where }),
  ]);

  return res.json({ items, total, page, limit });
});

// Reconstruct receipt details for any past payment from existing records
paymentsRouter.get("/receipt/:paymentId", async (req, res) => {
  const receipt = await buildReceiptForPayment(req.params.paymentId);
  if (!receipt) return res.status(404).json({ error: "Payment not found" });

  if (
    req.auth!.organizationId &&
    receipt.organizationId !== req.auth!.organizationId &&
    req.auth!.role !== "super_user"
  ) {
    return res.status(403).json({ error: "Forbidden" });
  }

  return res.json(receipt);
});

// Transaction history for a membership
paymentsRouter.get("/history/:membershipId", async (req, res) => {
  const membership = await prisma.membership.findUnique({
    where: { id: req.params.membershipId },
    select: { id: true, organizationId: true },
  });
  if (!membership) return res.status(404).json({ error: "Membership not found" });
  if (req.auth!.organizationId && membership.organizationId !== req.auth!.organizationId && req.auth!.role !== "super_user") {
    return res.status(403).json({ error: "Forbidden" });
  }

  const page = Math.max(1, parseInt(String(req.query.page), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit), 10) || 20));

  const [items, total] = await Promise.all([
    prisma.payment.findMany({
      where: { membershipId: membership.id },
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { paymentDate: "desc" },
      include: {
        paymentDue: { select: { period: true, amountDue: true } },
        collectedBy: { select: { id: true, email: true } },
      },
    }),
    prisma.payment.count({ where: { membershipId: membership.id } }),
  ]);

  return res.json({ items, total, page, limit });
});

// Reverse a payment (admin only)
const reversePaymentSchema = z.object({
  reason: z.string().min(1, "Reversal reason is required"),
});

paymentsRouter.post("/:id/reverse", async (req, res) => {
  if (req.auth!.role !== "admin" && req.auth!.role !== "super_user") {
    return res.status(403).json({ error: "Only admins can reverse payments" });
  }

  const parsed = reversePaymentSchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

  const payment = await prisma.payment.findUnique({
    where: { id: req.params.id },
    include: { paymentDue: true },
  });
  if (!payment) return res.status(404).json({ error: "Payment not found" });
  if (payment.isReversed) return res.status(409).json({ error: "Payment is already reversed" });
  if (req.auth!.organizationId && payment.organizationId !== req.auth!.organizationId && req.auth!.role !== "super_user") {
    return res.status(403).json({ error: "Forbidden" });
  }

  const paymentAmount = payment.amount;
  const due = payment.paymentDue;

  await prisma.$transaction(async (tx) => {
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        isReversed: true,
        reversedAt: new Date(),
        reversedByUserId: req.auth!.userId,
        reversalReason: parsed.data.reason,
      },
    });

    const overpaymentEntries = await tx.membershipCreditLedger.findMany({
      where: { paymentId: payment.id, entryType: "credit_overpayment" },
    });
    const overpaymentTotal = overpaymentEntries.reduce(
      (sum, e) => sum.add(e.amountDelta),
      new Decimal(0)
    );
    const appliedToDue = paymentAmount.sub(overpaymentTotal);

    if (appliedToDue.gt(new Decimal(0))) {
      const newPaid = maxDecimal(due.amountPaid.sub(appliedToDue), new Decimal(0));
      let newStatus: DueStatus = "pending";
      if (newPaid.gt(new Decimal(0))) newStatus = "partial";
      if (newPaid.gte(due.amountDue)) newStatus = "paid";
      if (due.status === "overdue" && newStatus !== "paid") newStatus = "overdue";

      await tx.paymentDue.update({
        where: { id: due.id },
        data: { amountPaid: newPaid, status: newStatus },
      });
    }

    if (overpaymentTotal.gt(new Decimal(0))) {
      await tx.membershipCreditLedger.create({
        data: {
          membershipId: payment.membershipId,
          organizationId: payment.organizationId,
          paymentId: payment.id,
          paymentDueId: due.id,
          amountDelta: overpaymentTotal.neg(),
          entryType: "debit_adjustment",
          note: `Reversal clawback: ${parsed.data.reason}`,
          createdByUserId: req.auth!.userId,
        },
      });
    }
  });

  return res.json({ success: true, message: "Payment reversed" });
});

// Edit due amount (admin only)
const editDueSchema = z.object({
  amountDue: z.number().min(0, "Amount must be zero or greater"),
  reason: z.string().min(1, "Reason is required"),
});

paymentsRouter.patch("/dues/:id", async (req, res) => {
  if (req.auth!.role !== "admin" && req.auth!.role !== "super_user") {
    return res.status(403).json({ error: "Only admins can edit dues" });
  }

  const parsed = editDueSchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });

  const due = await prisma.paymentDue.findUnique({ where: { id: req.params.id } });
  if (!due) return res.status(404).json({ error: "Due not found" });
  if (req.auth!.organizationId && due.organizationId !== req.auth!.organizationId && req.auth!.role !== "super_user") {
    return res.status(403).json({ error: "Forbidden" });
  }

  const newAmountDue = toDecimal(parsed.data.amountDue);
  let newStatus: DueStatus = "pending";
  if (due.amountPaid.gt(new Decimal(0))) newStatus = "partial";
  if (due.amountPaid.gte(newAmountDue)) newStatus = "paid";

  const updated = await prisma.paymentDue.update({
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
paymentsRouter.get("/report/periodic", async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId && req.auth!.role !== "super_user")
    return res.status(400).json({ error: "Organization scope required" });

  const fromDate = req.query.fromDate as string | undefined;
  const toDate = req.query.toDate as string | undefined;
  if (!fromDate || !toDate) return res.status(400).json({ error: "fromDate and toDate are required" });

  const from = new Date(fromDate);
  const to = new Date(toDate);
  to.setHours(23, 59, 59, 999);

  const where: any = {
    paymentDate: { gte: from, lte: to },
  };
  if (orgId) where.organizationId = orgId;

  const payments = await prisma.payment.findMany({
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
    .reduce((sum, p) => sum.add(p.amount), new Decimal(0));
  const totalReversed = payments
    .filter((p) => p.isReversed)
    .reduce((sum, p) => sum.add(p.amount), new Decimal(0));

  const format = req.query.format as string | undefined;
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
paymentsRouter.post("/mark-overdue", async (req, res) => {
  const orgId = getOrgId(req);
  const where: any = {
    status: { in: ["pending", "partial"] },
    dueDate: { lt: new Date() },
    OR: [
      { isManual: false },
      { periodStart: { not: null } },
      { periodEnd: { not: null } },
    ],
  };
  if (orgId) where.organizationId = orgId;

  const result = await prisma.paymentDue.updateMany({
    where,
    data: { status: "overdue" },
  });

  return res.json({ updated: result.count });
});
