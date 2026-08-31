import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "./prisma.js";
import { applyAvailableCreditAcrossOutstandingDues } from "./membership-credit.js";
import { getDueTypeBySystemKey } from "./due-types.js";
import {
  queuePaymentDueGenerated,
  queuePaymentOverdue,
  queueLateFeeApplied,
  queueOrgBillingDue,
} from "./message-queue.js";

// Monthly due generation can auto-apply credit across several older dues, so
// the cron path uses the same relaxed timeout as the interactive payment flows.
const CREDIT_SWEEP_TRANSACTION_OPTIONS = {
  maxWait: 10000,
  timeout: 10000,
} as const;

const SRI_LANKA_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const DAILY_CRON_MINUTE = 5;
const DUE_SMS_HOUR = 8;

function sriLankaDate(date = new Date()) {
  return new Date(date.getTime() + SRI_LANKA_OFFSET_MS);
}

function sriLankaDateParts(date = new Date()) {
  const local = sriLankaDate(date);
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth(),
    day: local.getUTCDate(),
  };
}

function sriLankaTimeAsUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute = 0
) {
  return new Date(Date.UTC(year, month, day, hour, minute) - SRI_LANKA_OFFSET_MS);
}

function nextDailyCronRun(now = new Date()) {
  const { year, month, day } = sriLankaDateParts(now);
  let next = sriLankaTimeAsUtc(year, month, day, 0, DAILY_CRON_MINUTE);
  if (next.getTime() <= now.getTime()) {
    next = sriLankaTimeAsUtc(year, month, day + 1, 0, DAILY_CRON_MINUTE);
  }
  return next;
}

function periodString(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function endOfDueMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}

function isPastDueGracePeriod(dueDate: Date, now = new Date()): boolean {
  return now > endOfDueMonth(dueDate);
}

export async function generateMonthlyDues() {
  const now = new Date();
  const { year, month } = sriLankaDateParts(now);
  const targetDate = new Date(Date.UTC(year, month, 1));
  const dueSmsSendAt = sriLankaTimeAsUtc(year, month, 1, DUE_SMS_HOUR);
  const period = periodString(targetDate);

  console.log(`[Cron] Generating dues for period ${period}`);

  const memberships = await prisma.membership.findMany({
    where: { membershipStatus: "Active", isArchived: false },
    include: {
      organization: true,
      hod: {
        select: {
          whatsAppNumber: true,
          mobileNumber: true,
          nameWithInitials: true,
          fullName: true,
        },
      },
    },
  });

  let created = 0;
  let skipped = 0;
  let autoAppliedCredit = new Decimal(0);

  for (const m of memberships) {
    const shouldGenerate =
      m.paymentPeriod === "Monthly" ||
      (m.paymentPeriod === "Quarterly" && targetDate.getMonth() % 3 === 0) ||
      (m.paymentPeriod === "Annually" && targetDate.getMonth() === 0);

    if (!shouldGenerate) { skipped++; continue; }

    const existing = await prisma.paymentDue.findFirst({
      where: { membershipId: m.id, period, isManual: false },
    });
    if (existing) { skipped++; continue; }

    const applied = await prisma.$transaction(async (tx) => {
      const subscriptionDueType = await getDueTypeBySystemKey(
        tx,
        m.organizationId,
        "subscription"
      );
      const due = await tx.paymentDue.create({
        data: {
          membershipId: m.id,
          organizationId: m.organizationId,
          dueTypeId: subscriptionDueType.id,
          dueDate: targetDate,
          period,
          amountDue: m.totalContribution,
          amountPaid: new Decimal(0),
          status: "pending",
        },
      });
      return applyAvailableCreditAcrossOutstandingDues(tx, {
        membershipId: m.id,
      });
    }, CREDIT_SWEEP_TRANSACTION_OPTIONS);
    created++;
    autoAppliedCredit = autoAppliedCredit.add(applied);

    const outstandingTotals = await prisma.paymentDue.aggregate({
      where: {
        membershipId: m.id,
        isSystemAdjustment: false,
      },
      _sum: {
        amountDue: true,
        amountPaid: true,
      },
    });
    const totalOutstanding = (outstandingTotals._sum.amountDue ?? new Decimal(0)).sub(
      outstandingTotals._sum.amountPaid ?? new Decimal(0)
    );

    const recipientPhone = m.hod?.mobileNumber || m.hod?.whatsAppNumber;
    if (m.hod && recipientPhone) {
      await queuePaymentDueGenerated(
        m.organizationId,
        recipientPhone,
        m.membershipNo,
        period,
        m.totalContribution.toFixed(2),
        (totalOutstanding.gt(0) ? totalOutstanding : new Decimal(0)).toFixed(2),
        m.hod.nameWithInitials || m.hod.fullName || "Member",
        "membership",
        dueSmsSendAt
      );
    }
  }

  console.log(
    `[Cron] Dues generated: ${created}, skipped: ${skipped}, auto-applied credit: ${autoAppliedCredit.toString()}`
  );
  return { created, skipped, period, autoAppliedCredit: autoAppliedCredit.toNumber() };
}

export async function applyLateFees() {
  const now = new Date();
  console.log(`[Cron] Checking for late fees...`);

  const orgs = await prisma.organization.findMany({
    where: { isActive: true },
    select: { id: true, lateFeePercentage: true },
  });
  const orgFeeMap = new Map(orgs.map((o) => [o.id, o.lateFeePercentage]));

  const overdueDues = await prisma.paymentDue.findMany({
    where: {
      isSystemAdjustment: false,
      status: { in: ["pending", "partial", "overdue"] },
      dueDate: { lt: now },
      lateFeeApplied: { equals: new Decimal(0) },
      OR: [
        { isManual: false },
        { periodStart: { not: null } },
        { periodEnd: { not: null } },
      ],
    },
    include: {
      membership: {
        select: { membershipNo: true, paymentPeriod: true, hod: { select: { whatsAppNumber: true } } },
      },
    },
  });

  let applied = 0;
  for (const due of overdueDues) {
    if (!isPastDueGracePeriod(due.dueDate, now)) continue;

    const feePercentage = orgFeeMap.get(due.organizationId) ?? new Decimal(5);
    const lateFee = due.amountDue.mul(feePercentage).div(100);
    if (lateFee.lte(new Decimal(0))) continue;

    await prisma.$transaction(async (tx) => {
      await tx.paymentDue.update({
        where: { id: due.id },
        data: {
          lateFeeApplied: lateFee,
          lateFeeDate: now,
          amountDue: due.amountDue.add(lateFee),
          status: "overdue",
        },
      });

      await tx.paymentDueAdjustment.create({
        data: {
          paymentDueId: due.id,
          membershipId: due.membershipId,
          organizationId: due.organizationId,
          amountDelta: lateFee,
          adjustmentType: "late_fee",
          reason: "Late fee applied automatically",
        },
      });
    });
    applied++;

    if (due.membership.hod?.whatsAppNumber) {
      await queueLateFeeApplied(
        due.organizationId,
        due.membership.hod.whatsAppNumber,
        due.membership.membershipNo,
        lateFee.toString()
      );
    }
  }

  console.log(`[Cron] Late fees applied: ${applied}`);
  return { applied };
}

export async function markOverdueDues() {
  const now = new Date();
  const dues = await prisma.paymentDue.findMany({
    where: {
      isSystemAdjustment: false,
      status: { in: ["pending", "partial"] },
      dueDate: { lt: now },
      OR: [
        { isManual: false },
        { periodStart: { not: null } },
        { periodEnd: { not: null } },
      ],
    },
    include: {
      membership: { select: { membershipNo: true, hod: { select: { whatsAppNumber: true } } } },
    },
  });

  let updated = 0;
  for (const due of dues) {
    if (!isPastDueGracePeriod(due.dueDate, now)) continue;

    await prisma.paymentDue.update({
      where: { id: due.id },
      data: { status: "overdue" },
    });
    updated++;

    if (due.membership.hod?.whatsAppNumber) {
      await queuePaymentOverdue(
        due.organizationId,
        due.membership.hod.whatsAppNumber,
        due.membership.membershipNo,
        due.period
      );
    }
  }

  console.log(`[Cron] Marked overdue: ${updated}`);
  return { updated };
}

export async function generateOrgBilling() {
  const year = new Date().getFullYear();
  console.log(`[Cron] Generating org billing for year ${year}`);

  const orgs = await prisma.organization.findMany({
    where: { isActive: true },
    select: { id: true, name: true, contactPersonPhone: true },
  });

  let created = 0;
  for (const org of orgs) {
    const existing = await prisma.organizationBilling.findUnique({
      where: { organizationId_year: { organizationId: org.id, year } },
    });
    if (existing) continue;

    await prisma.organizationBilling.create({
      data: { organizationId: org.id, year },
    });
    created++;

    if (org.contactPersonPhone) {
      await queueOrgBillingDue(org.id, org.contactPersonPhone, org.name, year);
    }
  }

  console.log(`[Cron] Org billing created: ${created}`);
  return { created };
}

export function startCronJobs() {
  async function runMonthlyCron() {
    const now = new Date();
    const sriLankaNow = sriLankaDate(now);
    if (sriLankaNow.getUTCDate() === 1) {
      try {
        await generateMonthlyDues();
        if (sriLankaNow.getUTCMonth() === 0) {
          await generateOrgBilling();
        }
      } catch (err) {
        console.error("[Cron] Monthly due generation failed:", err);
      }
    }

    try {
      await markOverdueDues();
      await applyLateFees();
    } catch (err) {
      console.error("[Cron] Late fee/overdue check failed:", err);
    }
  }

  const scheduleNextRun = () => {
    const nextRun = nextDailyCronRun();
    setTimeout(async () => {
      await runMonthlyCron();
      scheduleNextRun();
    }, nextRun.getTime() - Date.now());
    console.log(`[Cron] Next daily check: ${nextRun.toISOString()} (00:05 Asia/Colombo)`);
  };

  void runMonthlyCron();
  scheduleNextRun();

  console.log("[Cron] Cron jobs started (Asia/Colombo schedule; due SMS at 08:00)");
}
