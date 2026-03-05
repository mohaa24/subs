import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "./prisma.js";
import { applyAvailableCreditToDue } from "./membership-credit.js";
import {
  queuePaymentDueGenerated,
  queuePaymentOverdue,
  queueLateFeeApplied,
  queueOrgBillingDue,
} from "./message-queue.js";

function periodString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export async function generateMonthlyDues() {
  const now = new Date();
  const targetDate = new Date(now.getFullYear(), now.getMonth(), 1);
  const period = periodString(targetDate);

  console.log(`[Cron] Generating dues for period ${period}`);

  const memberships = await prisma.membership.findMany({
    where: { membershipStatus: "Active" },
    include: {
      organization: true,
      hod: { select: { whatsAppNumber: true } },
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

    const existing = await prisma.paymentDue.findUnique({
      where: { membershipId_period: { membershipId: m.id, period } },
    });
    if (existing) { skipped++; continue; }

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
        note: `Auto-applied member credit to ${period} due`,
      });
    });
    created++;
    autoAppliedCredit = autoAppliedCredit.add(applied);

    if (m.hod?.whatsAppNumber) {
      await queuePaymentDueGenerated(
        m.organizationId,
        m.hod.whatsAppNumber,
        m.membershipNo,
        period,
        m.totalContribution.toString()
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
      status: { in: ["pending", "partial", "overdue"] },
      dueDate: { lt: now },
      lateFeeApplied: { equals: new Decimal(0) },
    },
    include: {
      membership: {
        select: { membershipNo: true, paymentPeriod: true, hod: { select: { whatsAppNumber: true } } },
      },
    },
  });

  let applied = 0;
  for (const due of overdueDues) {
    const dueDate = new Date(due.dueDate);
    let gracePeriodEnd: Date;

    if (due.membership.paymentPeriod === "Monthly") {
      gracePeriodEnd = new Date(dueDate.getFullYear(), dueDate.getMonth() + 1, 0);
    } else {
      gracePeriodEnd = new Date(dueDate.getFullYear(), dueDate.getMonth() + 1, 0);
    }

    if (now <= gracePeriodEnd) continue;

    const feePercentage = orgFeeMap.get(due.organizationId) ?? new Decimal(5);
    const lateFee = due.amountDue.mul(feePercentage).div(100);

    await prisma.paymentDue.update({
      where: { id: due.id },
      data: {
        lateFeeApplied: lateFee,
        lateFeeDate: now,
        amountDue: due.amountDue.add(lateFee),
        status: "overdue",
      },
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
      status: { in: ["pending", "partial"] },
      dueDate: { lt: now },
    },
    include: {
      membership: { select: { membershipNo: true, hod: { select: { whatsAppNumber: true } } } },
    },
  });

  let updated = 0;
  for (const due of dues) {
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
  const ONE_HOUR = 60 * 60 * 1000;
  const ONE_DAY = 24 * ONE_HOUR;

  async function runMonthlyCron() {
    const now = new Date();
    if (now.getDate() === 1) {
      try {
        await generateMonthlyDues();
        if (now.getMonth() === 0) {
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

  runMonthlyCron();

  setInterval(runMonthlyCron, ONE_DAY);

  console.log("[Cron] Cron jobs started (daily check interval)");
}
