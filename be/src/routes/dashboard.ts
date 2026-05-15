import { Router } from "express";
import { Prisma } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "../lib/prisma.js";
import { requireAuth, withOrgScope } from "../middleware/auth.js";

export const dashboardRouter = Router();

dashboardRouter.use(requireAuth);
dashboardRouter.use(withOrgScope);

function getOrgId(req: any): string | undefined {
  return req.organizationId ?? req.query?.organizationId;
}

dashboardRouter.get("/", async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId && req.auth!.role !== "super_user")
    return res.status(400).json({ error: "Organization scope required" });

  const orgFilter: any = orgId ? { organizationId: orgId } : {};
  const now = new Date();
  const parsedWindowDays = Number(req.query?.windowDays);
  const windowDays = [1, 7, 14, 30].includes(parsedWindowDays) ? parsedWindowDays : 30;
  const rangeEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const rangeStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (windowDays - 1));

  const eighteenYearsAgo = new Date(now.getFullYear() - 18, now.getMonth(), now.getDate());
  const thirteenYearsAgo = new Date(now.getFullYear() - 13, now.getMonth(), now.getDate());
  const activePersonFilter: Prisma.PersonWhereInput = {
    isArchived: false,
    OR: [{ livingStatus: "Active" }, { livingStatus: null }],
  };

  const [
    totalHouseholds,
    totalHeadcount,
    adultsCount,
    youthCount,
    childrenCount,
    currentMonthDues,
    currentMonthPayments,
    currentMonthOverpayments,
  ] = await Promise.all([
    prisma.membership.count({ where: { ...orgFilter, isArchived: false } }),

    prisma.person.count({ where: { ...orgFilter, ...activePersonFilter } }),

    prisma.person.count({
      where: {
        ...orgFilter,
        ...activePersonFilter,
        dateOfBirth: { lte: eighteenYearsAgo },
      },
    }),

    prisma.person.count({
      where: {
        ...orgFilter,
        ...activePersonFilter,
        dateOfBirth: { gt: eighteenYearsAgo, lte: thirteenYearsAgo },
      },
    }),

    prisma.person.count({
      where: {
        ...orgFilter,
        ...activePersonFilter,
        dateOfBirth: { gt: thirteenYearsAgo },
      },
    }),

    prisma.paymentDue.findMany({
      where: {
        ...orgFilter,
        dueDate: { gte: rangeStart, lt: rangeEnd },
      },
      select: { amountDue: true, amountPaid: true },
    }),

    prisma.payment.aggregate({
      where: {
        ...orgFilter,
        paymentDate: { gte: rangeStart, lt: rangeEnd },
      },
      _sum: { amount: true },
    }),

    prisma.membershipCreditLedger.aggregate({
      where: {
        ...orgFilter,
        entryType: "credit_overpayment",
        createdAt: { gte: rangeStart, lt: rangeEnd },
      },
      _sum: { amountDelta: true },
    }),
  ]);

  const totalDue = currentMonthDues.reduce(
    (sum, d) => sum.add(d.amountDue),
    new Decimal(0)
  );
  const outstandingThisMonth = currentMonthDues.reduce(
    (sum, d) => sum.add(d.amountDue.sub(d.amountPaid)),
    new Decimal(0)
  );
  const collectedThisMonth = currentMonthPayments._sum.amount ?? new Decimal(0);
  const overpaymentsThisMonth = currentMonthOverpayments._sum.amountDelta ?? new Decimal(0);

  return res.json({
    totalHouseholds,
    totalHeadcount,
    adults: adultsCount,
    youth: youthCount,
    children: childrenCount,
    totalDueThisMonth: totalDue.toNumber(),
    collectedThisMonth: new Decimal(collectedThisMonth.toString()).toNumber(),
    outstandingThisMonth: outstandingThisMonth.toNumber(),
    overpaymentsThisMonth: new Decimal(overpaymentsThisMonth.toString()).toNumber(),
    period: `${rangeStart.toISOString().slice(0, 10)}:${new Date(rangeEnd.getTime() - 1)
      .toISOString()
      .slice(0, 10)}`,
  });
});
