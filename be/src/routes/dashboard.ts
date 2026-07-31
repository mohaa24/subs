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

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

function formatDayKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function labelForDay(date: Date) {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function asNumber(value: Decimal) {
  return Number(value.toFixed(2));
}

function activityTone(kind: string) {
  if (kind === "income" || kind === "collection" || kind === "payment") return "emerald";
  if (kind === "expense") return "rose";
  if (kind === "fund") return "violet";
  return "blue";
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
  const financeWindowStart = startOfDay(rangeStart);
  const comparisonStart = addDays(financeWindowStart, -windowDays);
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
    activePaymentsInPeriod,
    currentMonthOverpayments,
    currentOutstandingDues,
    journalLines,
    payments,
    cashTransactions,
    fundTransactions,
    recentFeedItems,
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
      select: { amountDue: true, amountPaid: true, membershipId: true },
    }),

    prisma.payment.aggregate({
      where: {
        ...orgFilter,
        paymentDate: { gte: rangeStart, lt: rangeEnd },
        isReversed: false,
      },
      _count: { _all: true },
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

    prisma.paymentDue.findMany({
      where: {
        ...orgFilter,
        status: { not: "paid" },
      },
      select: { amountDue: true, amountPaid: true, membershipId: true },
    }),

    prisma.accountingJournalLine.findMany({
      where: {
        organizationId: orgId,
        journalEntry: { entryDate: { gte: financeWindowStart, lt: rangeEnd } },
        account: { accountType: { in: ["income", "expense"] } },
      },
      select: {
        amount: true,
        side: true,
        account: { select: { accountType: true } },
        journalEntry: { select: { entryDate: true } },
      },
    }),

    prisma.payment.findMany({
      where: {
        ...orgFilter,
        paymentDate: { gte: financeWindowStart, lt: rangeEnd },
      },
      orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }],
      take: 20,
      select: {
        id: true,
        amount: true,
        paymentDate: true,
        receiptNumber: true,
        paymentMethod: true,
        paymentKind: true,
        isReversed: true,
        reversalReason: true,
        membership: { select: { membershipNo: true, hod: { select: { fullName: true, nameWithInitials: true } } } },
        collectedBy: { select: { email: true } },
      },
    }),

    prisma.cashTransaction.findMany({
      where: {
        ...orgFilter,
        transactionDate: { gte: financeWindowStart, lt: rangeEnd },
      },
      orderBy: [{ transactionDate: "desc" }, { createdAt: "desc" }],
      take: 20,
      select: {
        id: true,
        amount: true,
        transactionDate: true,
        category: true,
        flowType: true,
        counterpartyName: true,
        description: true,
        documentNumber: true,
        createdBy: { select: { email: true } },
        reversedAt: true,
        accountId: true,
      },
    }),

    prisma.fundTransaction.findMany({
      where: {
        organizationId: orgId,
        transactionDate: { gte: financeWindowStart, lt: rangeEnd },
      },
      orderBy: [{ transactionDate: "desc" }, { createdAt: "desc" }],
      take: 20,
      select: {
        id: true,
        amount: true,
        transactionDate: true,
        transactionType: true,
        receiptNumber: true,
        paidByName: true,
        description: true,
        memo: true,
        reversedAt: true,
        fundPot: { select: { id: true, name: true } },
      },
    }),

    prisma.activityFeedItem.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        entryType: true,
        body: true,
        metadata: true,
        createdAt: true,
        createdBy: { select: { email: true } },
      },
    }),
  ]);

  const [previousPaymentsInPeriod, previousJournalLines, newHouseholds, newPeople, newAdults, newYouth, newChildren] = await Promise.all([
    prisma.payment.aggregate({
      where: { ...orgFilter, paymentDate: { gte: comparisonStart, lt: financeWindowStart }, isReversed: false },
      _sum: { amount: true },
    }),
    prisma.accountingJournalLine.findMany({
      where: {
        organizationId: orgId,
        journalEntry: { entryDate: { gte: comparisonStart, lt: financeWindowStart } },
        account: { accountType: { in: ["income", "expense"] } },
      },
      select: { amount: true, side: true, account: { select: { accountType: true } } },
    }),
    prisma.membership.count({ where: { ...orgFilter, isArchived: false, createdAt: { gte: financeWindowStart, lt: rangeEnd } } }),
    prisma.person.count({ where: { ...orgFilter, ...activePersonFilter, createdAt: { gte: financeWindowStart, lt: rangeEnd } } }),
    prisma.person.count({ where: { ...orgFilter, ...activePersonFilter, createdAt: { gte: financeWindowStart, lt: rangeEnd }, dateOfBirth: { lte: eighteenYearsAgo } } }),
    prisma.person.count({ where: { ...orgFilter, ...activePersonFilter, createdAt: { gte: financeWindowStart, lt: rangeEnd }, dateOfBirth: { gt: eighteenYearsAgo, lte: thirteenYearsAgo } } }),
    prisma.person.count({ where: { ...orgFilter, ...activePersonFilter, createdAt: { gte: financeWindowStart, lt: rangeEnd }, dateOfBirth: { gt: thirteenYearsAgo } } }),
  ]);

  const totalDue = currentMonthDues.reduce(
    (sum, d) => sum.add(d.amountDue),
    new Decimal(0)
  );
  const outstandingThisMonth = currentMonthDues.reduce(
    (sum, d) => sum.add(d.amountDue.sub(d.amountPaid)),
    new Decimal(0)
  );
  const currentOutstanding = currentOutstandingDues.reduce((sum, d) => {
    const remaining = d.amountDue.sub(d.amountPaid);
    return remaining.gt(0) ? sum.add(remaining) : sum;
  }, new Decimal(0));
  const netCollectedInPeriod = activePaymentsInPeriod._sum.amount ?? new Decimal(0);
  const activePaymentCountInPeriod = activePaymentsInPeriod._count._all;
  const overpaymentsThisMonth = currentMonthOverpayments._sum.amountDelta ?? new Decimal(0);

  type FinanceDay = {
    key: string;
    label: string;
    income: number;
    expense: number;
    memberCollection: number;
    cashIn: number;
    cashOut: number;
    outstanding: number;
  };

  const financeDays: FinanceDay[] = [];
  for (let i = 0; i < windowDays; i += 1) {
    const day = addDays(financeWindowStart, i);
    financeDays.push({
      key: formatDayKey(day),
      label: labelForDay(day),
      income: 0,
      expense: 0,
      memberCollection: 0,
      cashIn: 0,
      cashOut: 0,
      outstanding: 0,
    });
  }
  const bucketFor = (value: Date) => financeDays.find((day) => day.key === formatDayKey(value));

  for (const line of journalLines) {
    const bucket = bucketFor(line.journalEntry.entryDate);
    if (!bucket) continue;
    const amount = Number(line.amount);
    if (line.account.accountType === "income") {
      bucket.income += line.side === "credit" ? amount : 0;
    }
    if (line.account.accountType === "expense") {
      bucket.expense += line.side === "debit" ? amount : 0;
    }
  }

  for (const payment of payments) {
    if (payment.isReversed) continue;
    const bucket = bucketFor(payment.paymentDate);
    if (!bucket) continue;
    bucket.memberCollection += Number(payment.amount);
  }

  for (const transaction of cashTransactions) {
    if (transaction.reversedAt) continue;
    const bucket = bucketFor(transaction.transactionDate);
    if (!bucket) continue;
    const amount = Number(transaction.amount);
    const inflowCategories = new Set(["operating_income", "receivable_collection", "payable_borrowing", "payable_recovery"]);
    const outflowCategories = new Set(["operating_expense", "receivable_payment", "receivable_write_off", "payable_repayment", "payable_payment"]);
    if (inflowCategories.has(transaction.category)) bucket.cashIn += amount;
    if (outflowCategories.has(transaction.category)) bucket.cashOut += amount;
  }

  for (const transaction of fundTransactions) {
    if (transaction.reversedAt) continue;
    const bucket = bucketFor(transaction.transactionDate);
    if (!bucket) continue;
    const amount = Number(transaction.amount);
    if (transaction.transactionType === "collection") bucket.cashIn += amount;
    if (transaction.transactionType === "expense") bucket.cashOut += amount;
  }

  for (const day of financeDays) {
    day.outstanding = Number((day.expense + day.cashOut - day.income - day.cashIn).toFixed(2));
  }

  const financeTotals = financeDays.reduce((sum, day) => ({
    income: sum.income + day.income,
    expense: sum.expense + day.expense,
    memberCollection: sum.memberCollection + day.memberCollection,
    cashIn: sum.cashIn + day.cashIn,
    cashOut: sum.cashOut + day.cashOut,
  }), { income: 0, expense: 0, memberCollection: 0, cashIn: 0, cashOut: 0 });

  const currentDue = currentMonthDues.reduce((sum, d) => sum.add(d.amountDue), new Decimal(0));
  const collectionRate = currentDue.gt(0)
    ? Number(netCollectedInPeriod.div(currentDue).mul(100).toFixed(2))
    : 0;

  const previousFinancial = previousJournalLines.reduce((sum, line) => {
    const amount = Number(line.amount);
    if (line.account.accountType === "income" && line.side === "credit") sum.income += amount;
    if (line.account.accountType === "expense" && line.side === "debit") sum.expense += amount;
    return sum;
  }, { income: 0, expense: 0 });
  const outstandingMemberCount = new Set(
    currentOutstandingDues
      .filter((due) => due.amountDue.gt(due.amountPaid))
      .map((due) => due.membershipId)
  ).size;

  const recentActivity = [
    ...payments.slice(0, 8).map((payment) => ({
      id: `payment-${payment.id}`,
      type: payment.isReversed ? "payment_reversal" : "payment",
      title: payment.isReversed ? "Payment reversed" : "Member collection",
      description: `${payment.membership?.hod?.nameWithInitials ?? payment.membership?.hod?.fullName ?? payment.membership?.membershipNo ?? "Member"} • ${payment.receiptNumber ?? payment.id.slice(-8).toUpperCase()}`,
      amount: Number(payment.amount),
      occurredAt: payment.paymentDate.toISOString(),
      href: "/payments",
      tone: payment.isReversed ? "rose" : "emerald",
    })),
    ...cashTransactions.slice(0, 8).map((transaction) => ({
      id: `cash-${transaction.id}`,
      type: transaction.flowType === "cash_in" ? "cash_in" : "cash_out",
      title: transaction.category.replace(/_/g, " "),
      description: transaction.description ?? transaction.counterpartyName ?? transaction.documentNumber ?? "Cash transaction",
      amount: Number(transaction.amount),
      occurredAt: transaction.transactionDate.toISOString(),
      href: transaction.flowType === "cash_in" ? "/cash-in" : "/cash-out",
      tone: transaction.flowType === "cash_in" ? "blue" : "orange",
    })),
    ...fundTransactions.slice(0, 8).map((transaction) => ({
      id: `fund-${transaction.id}`,
      type: transaction.transactionType === "collection" ? "fund_collection" : "fund_expense",
      title: transaction.transactionType === "collection" ? "Fund collection" : "Fund expense",
      description: `${transaction.fundPot.name} • ${transaction.description ?? transaction.memo ?? transaction.paidByName ?? transaction.receiptNumber ?? "Fund transaction"}`,
      amount: Number(transaction.amount),
      occurredAt: transaction.transactionDate.toISOString(),
      href: `/funds/${transaction.fundPot.id}`,
      tone: transaction.transactionType === "collection" ? "violet" : "rose",
    })),
    ...recentFeedItems.map((item) => ({
      id: `feed-${item.id}`,
      type: item.entryType,
      title: item.body ?? "Activity",
      description: item.createdBy?.email ?? "System",
      amount: null,
      occurredAt: item.createdAt.toISOString(),
      href: null,
      tone: item.entryType === "remark" ? "slate" : "blue",
    })),
  ]
    .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
    .slice(0, 12);

  return res.json({
    totalHouseholds,
    totalHeadcount,
    adults: adultsCount,
    youth: youthCount,
    children: childrenCount,
    totalDueThisMonth: totalDue.toNumber(),
    collectedThisMonth: new Decimal(netCollectedInPeriod.toString()).toNumber(),
    netCollectedInPeriod: new Decimal(netCollectedInPeriod.toString()).toNumber(),
    outstandingThisMonth: outstandingThisMonth.toNumber(),
    currentOutstanding: currentOutstanding.toNumber(),
    overpaymentsThisMonth: new Decimal(overpaymentsThisMonth.toString()).toNumber(),
    activePaymentsInPeriod: activePaymentCountInPeriod,
    comparison: {
      previousMemberCollection: Number((previousPaymentsInPeriod._sum.amount ?? new Decimal(0)).toFixed(2)),
      previousIncome: Number(previousFinancial.income.toFixed(2)),
      previousExpense: Number(previousFinancial.expense.toFixed(2)),
      newHouseholds,
      newPeople,
      newAdults,
      newYouth,
      newChildren,
      outstandingMemberCount,
    },
    period: `${rangeStart.toISOString().slice(0, 10)}:${new Date(rangeEnd.getTime() - 1)
      .toISOString()
      .slice(0, 10)}`,
    financialOverview: {
      totalIncome: Number(financeTotals.income.toFixed(2)),
      totalExpense: Number(financeTotals.expense.toFixed(2)),
      netIncome: Number((financeTotals.income - financeTotals.expense).toFixed(2)),
      memberCollection: Number(financeTotals.memberCollection.toFixed(2)),
      collectionRate,
      series: financeDays.map((day) => ({
        label: day.label,
        memberCollection: Number(day.memberCollection.toFixed(2)),
        income: Number(day.income.toFixed(2)),
        expense: Number(day.expense.toFixed(2)),
        cashIn: Number(day.cashIn.toFixed(2)),
        cashOut: Number(day.cashOut.toFixed(2)),
        netIncome: Number((day.income - day.expense).toFixed(2)),
        outstanding: Number(day.outstanding.toFixed(2)),
      })),
    },
    recentActivity,
  });
});
