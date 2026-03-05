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

function periodString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
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

    const existing = await prisma.paymentDue.findUnique({
      where: { membershipId_period: { membershipId: m.id, period } },
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

// List dues for a membership (with optional status filter)
paymentsRouter.get("/dues", async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId && req.auth!.role !== "super_user")
    return res.status(400).json({ error: "Organization scope required" });

  const membershipId = req.query.membershipId as string | undefined;
  const status = req.query.status as DueStatus | undefined;
  const page = Math.max(1, parseInt(String(req.query.page), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit), 10) || 20));

  const where: any = {};
  if (orgId) where.organizationId = orgId;
  if (membershipId) where.membershipId = membershipId;
  if (status) where.status = status;

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

// Mark overdue dues (dues past dueDate still pending/partial)
paymentsRouter.post("/mark-overdue", async (req, res) => {
  const orgId = getOrgId(req);
  const where: any = {
    status: { in: ["pending", "partial"] },
    dueDate: { lt: new Date() },
  };
  if (orgId) where.organizationId = orgId;

  const result = await prisma.paymentDue.updateMany({
    where,
    data: { status: "overdue" },
  });

  return res.json({ updated: result.count });
});
