import { Router } from "express";
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
  const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const eighteenYearsAgo = new Date(now.getFullYear() - 18, now.getMonth(), now.getDate());
  const eightYearsAgo = new Date(now.getFullYear() - 8, now.getMonth(), now.getDate());

  const [
    totalMembers,
    childrenCount,
    teenagerCount,
    currentMonthDues,
    currentMonthPayments,
  ] = await Promise.all([
    prisma.person.count({ where: orgFilter }),

    prisma.person.count({
      where: {
        ...orgFilter,
        dateOfBirth: { gt: eightYearsAgo },
      },
    }),

    prisma.person.count({
      where: {
        ...orgFilter,
        dateOfBirth: { gt: eighteenYearsAgo, lte: eightYearsAgo },
      },
    }),

    prisma.paymentDue.findMany({
      where: { ...orgFilter, period: currentPeriod },
      select: { amountDue: true, amountPaid: true },
    }),

    prisma.payment.aggregate({
      where: {
        ...orgFilter,
        paymentDate: { gte: monthStart, lt: monthEnd },
      },
      _sum: { amount: true },
    }),
  ]);

  const totalDue = currentMonthDues.reduce(
    (sum, d) => sum.add(d.amountDue),
    new Decimal(0)
  );
  const collectedThisMonth = currentMonthPayments._sum.amount ?? new Decimal(0);

  return res.json({
    totalMembers,
    children: childrenCount,
    teenagers: teenagerCount,
    totalDueThisMonth: totalDue.toNumber(),
    collectedThisMonth: new Decimal(collectedThisMonth.toString()).toNumber(),
    period: currentPeriod,
  });
});
