import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requireAuth, withOrgScope } from "../middleware/auth.js";

export const reportsRouter = Router();

reportsRouter.use(requireAuth);
reportsRouter.use(withOrgScope);

function getOrgId(req: any): string | undefined {
  return req.organizationId ?? req.body?.organizationId ?? req.query?.organizationId;
}

function buildPersonWhere(orgId: string, filters: Record<string, unknown>): Prisma.PersonWhereInput {
  const where: Prisma.PersonWhereInput = { organizationId: orgId };

  if (typeof filters.isDisabled === "boolean") where.isDisabled = filters.isDisabled;
  if (typeof filters.isMadarasaStudent === "boolean") where.isMadarasaStudent = filters.isMadarasaStudent;
  if (typeof filters.membershipType === "string" && filters.membershipType) {
    where.membership = { membershipType: filters.membershipType as any };
  }
  if (typeof filters.minAge === "number" || typeof filters.maxAge === "number") {
    const now = new Date();
    const dob: { gte?: Date; lte?: Date } = {};
    if (typeof filters.minAge === "number") {
      dob.lte = new Date(now.getFullYear() - filters.minAge, now.getMonth(), now.getDate());
    }
    if (typeof filters.maxAge === "number") {
      dob.gte = new Date(now.getFullYear() - filters.maxAge - 1, now.getMonth(), now.getDate() + 1);
    }
    where.dateOfBirth = dob;
  }
  return where;
}

async function getMemberCreditLiabilityRows(orgId: string) {
  const grouped = await prisma.membershipCreditLedger.groupBy({
    by: ["membershipId"],
    where: { organizationId: orgId },
    _sum: { amountDelta: true },
  });

  const balances = grouped
    .map((entry) => ({
      membershipId: entry.membershipId,
      creditBalance: Number(entry._sum.amountDelta ?? 0),
    }))
    .filter((entry) => entry.creditBalance > 0);

  if (balances.length === 0) return [];

  const memberships = await prisma.membership.findMany({
    where: {
      organizationId: orgId,
      id: { in: balances.map((entry) => entry.membershipId) },
    },
    select: {
      id: true,
      membershipNo: true,
      membershipType: true,
      membershipStatus: true,
      hod: { select: { fullName: true, nameWithInitials: true } },
    },
  });

  const membershipMap = new Map(memberships.map((membership) => [membership.id, membership]));

  return balances
    .map((entry) => {
      const membership = membershipMap.get(entry.membershipId);
      return {
        membershipId: entry.membershipId,
        membershipNo: membership?.membershipNo ?? "",
        membershipType: membership?.membershipType ?? "",
        membershipStatus: membership?.membershipStatus ?? "",
        hodName: membership?.hod.fullName || membership?.hod.nameWithInitials || "",
        creditBalance: Number(entry.creditBalance.toFixed(2)),
      };
    })
    .sort((a, b) => {
      if (b.creditBalance !== a.creditBalance) return b.creditBalance - a.creditBalance;
      return a.membershipNo.localeCompare(b.membershipNo);
    });
}

const querySchema = z.object({
  entity: z.enum(["persons", "memberships", "payments", "distributions", "memberCredits"]),
  filters: z.record(z.any()).optional(),
});

reportsRouter.post("/query", async (req, res) => {
  const parsed = querySchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  const orgId = getOrgId(req);
  if (!orgId && req.auth!.role !== "super_user")
    return res.status(400).json({ error: "Organization scope required" });
  if (req.auth!.organizationId && orgId !== req.auth!.organizationId && req.auth!.role !== "super_user")
    return res.status(403).json({ error: "Forbidden" });

  const filters = (parsed.data.filters || {}) as Record<string, unknown>;

  switch (parsed.data.entity) {
    case "persons": {
      const where = buildPersonWhere(orgId!, filters);
      const persons = await prisma.person.findMany({
        where,
        select: { id: true, fullName: true, nameWithInitials: true, dateOfBirth: true, isDisabled: true, isMadarasaStudent: true, membershipId: true },
        take: 500,
      });
      return res.json(persons);
    }
    case "memberships": {
      const where: Prisma.MembershipWhereInput = { organizationId: orgId! };
      if (typeof filters.membershipType === "string" && filters.membershipType) {
        where.membershipType = filters.membershipType as any;
      }
      const memberships = await prisma.membership.findMany({
        where,
        include: { hod: { select: { fullName: true, nameWithInitials: true } } },
        take: 500,
      });
      return res.json(memberships);
    }
    case "payments": {
      const where: Prisma.PaymentWhereInput = { organizationId: orgId! };
      if (typeof filters.paymentStatus === "string") {
        if (filters.paymentStatus === "paid") {
          where.paymentDue = { status: "paid" };
        } else if (filters.paymentStatus === "pending") {
          where.paymentDue = { status: "pending" };
        } else if (filters.paymentStatus === "overdue") {
          where.paymentDue = { status: "overdue" };
        }
      } else {
        where.OR = [
          { paymentDueId: null },
          { paymentDue: { is: { isSystemAdjustment: false } } },
        ];
      }
      const payments = await prisma.payment.findMany({
        where,
        include: {
          membership: { select: { membershipNo: true } },
          paymentDue: { select: { period: true, amountDue: true } },
        },
        orderBy: { paymentDate: "desc" },
        take: 500,
      });
      return res.json(payments);
    }
    case "distributions": {
      const distId = typeof filters.distributionId === "string" ? filters.distributionId : undefined;
      if (!distId) return res.status(400).json({ error: "distributionId filter required for distributions entity" });
      const dist = await prisma.distribution.findFirst({
        where: { id: distId, organizationId: orgId! },
      });
      if (!dist) return res.status(404).json({ error: "Distribution not found" });
      const records = await prisma.distributionRecord.findMany({
        where: { distributionId: distId },
        include: { person: { select: { fullName: true, nameWithInitials: true } } },
        orderBy: { distributedAt: "desc" },
        take: 500,
      });
      return res.json(records.map((r) => ({ ...r, personName: r.person.fullName || r.person.nameWithInitials })));
    }
    case "memberCredits": {
      const rows = await getMemberCreditLiabilityRows(orgId!);
      return res.json(rows);
    }
    default:
      return res.status(400).json({ error: "Invalid entity" });
  }
});

reportsRouter.get("/export", async (req, res) => {
  const entity = req.query.entity as string;
  let filters: Record<string, unknown> = {};
  try {
    if (typeof req.query.filters === "string") filters = JSON.parse(req.query.filters);
  } catch {
    return res.status(400).json({ error: "Invalid filters JSON" });
  }

  const orgId = getOrgId(req);
  if (!orgId && req.auth!.role !== "super_user")
    return res.status(400).json({ error: "Organization scope required" });
  if (req.auth!.organizationId && orgId !== req.auth!.organizationId && req.auth!.role !== "super_user")
    return res.status(403).json({ error: "Forbidden" });

  const validEntities = ["persons", "memberships", "payments", "distributions", "memberCredits"];
  if (!validEntities.includes(entity))
    return res.status(400).json({ error: "Invalid entity", valid: validEntities });

  let rows: Record<string, unknown>[] = [];
  let headers: string[] = [];

  switch (entity) {
    case "persons": {
      const where = buildPersonWhere(orgId!, filters);
      const persons = await prisma.person.findMany({ where, take: 10000 });
      headers = ["id", "fullName", "nameWithInitials", "dateOfBirth", "isDisabled", "isMadarasaStudent"];
      rows = persons.map((p) => ({
        id: p.id,
        fullName: p.fullName,
        nameWithInitials: p.nameWithInitials,
        dateOfBirth: p.dateOfBirth?.toISOString().slice(0, 10) ?? "",
        isDisabled: p.isDisabled,
        isMadarasaStudent: p.isMadarasaStudent,
      }));
      break;
    }
    case "memberships": {
      const where: Prisma.MembershipWhereInput = { organizationId: orgId! };
      if (typeof filters.membershipType === "string") where.membershipType = filters.membershipType as any;
      const memberships = await prisma.membership.findMany({
        where,
        include: { hod: { select: { fullName: true } } },
        take: 10000,
      });
      headers = ["id", "membershipNo", "membershipType", "membershipStatus", "hodName"];
      rows = memberships.map((m) => ({
        id: m.id,
        membershipNo: m.membershipNo,
        membershipType: m.membershipType,
        membershipStatus: m.membershipStatus,
        hodName: m.hod.fullName,
      }));
      break;
    }
    case "payments": {
      const where: Prisma.PaymentWhereInput = { organizationId: orgId! };
      if (typeof filters.paymentStatus === "string") {
        where.paymentDue = { status: filters.paymentStatus as any };
      } else {
        where.OR = [
          { paymentDueId: null },
          { paymentDue: { is: { isSystemAdjustment: false } } },
        ];
      }
      const payments = await prisma.payment.findMany({
        where,
        include: { membership: true, paymentDue: true },
        take: 10000,
      });
      headers = ["id", "membershipNo", "period", "amount", "paymentDate"];
      rows = payments.map((p) => ({
        id: p.id,
        membershipNo: p.membership.membershipNo,
        period: p.paymentDue?.period ?? "Credit Payment",
        amount: Number(p.amount),
        paymentDate: p.paymentDate.toISOString().slice(0, 10),
      }));
      break;
    }
    case "distributions": {
      const distId = typeof filters.distributionId === "string" ? filters.distributionId : undefined;
      if (!distId) return res.status(400).json({ error: "distributionId filter required" });
      const records = await prisma.distributionRecord.findMany({
        where: { distributionId: distId },
        include: { person: true },
        take: 10000,
      });
      headers = ["id", "personId", "personName", "distributionDate", "distributedAt"];
      rows = records.map((r) => ({
        id: r.id,
        personId: r.personId,
        personName: r.person.fullName || r.person.nameWithInitials,
        distributionDate: r.distributionDate,
        distributedAt: r.distributedAt.toISOString(),
      }));
      break;
    }
    case "memberCredits": {
      const liabilities = await getMemberCreditLiabilityRows(orgId!);
      headers = ["membershipId", "membershipNo", "membershipType", "membershipStatus", "hodName", "creditBalance"];
      rows = liabilities.map((item) => ({
        membershipId: item.membershipId,
        membershipNo: item.membershipNo,
        membershipType: item.membershipType,
        membershipStatus: item.membershipStatus,
        hodName: item.hodName,
        creditBalance: item.creditBalance.toFixed(2),
      }));
      break;
    }
  }

  const csvHeader = headers.join(",");
  const csvRows = rows.map((r) =>
    headers.map((h) => {
      const v = r[h];
      const s = v === null || v === undefined ? "" : String(v);
      return s.includes(",") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(",")
  );
  const csv = [csvHeader, ...csvRows].join("\n");

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="${entity}-export.csv"`);
  return res.send(csv);
});

reportsRouter.get("/distributions/:id", async (req, res) => {
  const dist = await prisma.distribution.findUnique({ where: { id: req.params.id } });
  if (!dist) return res.status(404).json({ error: "Distribution not found" });
  if (req.auth!.organizationId && dist.organizationId !== req.auth!.organizationId && req.auth!.role !== "super_user")
    return res.status(403).json({ error: "Forbidden" });

  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  let currentDate: string;
  if (dist.frequency === "Daily") currentDate = `${y}-${m}-${d}`;
  else if (dist.frequency === "Monthly") currentDate = `${y}-${m}`;
  else currentDate = String(y);

  const personWhere: Prisma.PersonWhereInput = { organizationId: dist.organizationId };
  const fc = dist.filterCriteria as Record<string, unknown> | null;
  if (fc) {
    if (typeof fc.isDisabled === "boolean") personWhere.isDisabled = fc.isDisabled;
    if (typeof fc.isMadarasaStudent === "boolean") personWhere.isMadarasaStudent = fc.isMadarasaStudent;
    if (typeof fc.membershipType === "string" && fc.membershipType) {
      personWhere.membership = { membershipType: fc.membershipType as any };
    }
    if (typeof fc.minAge === "number" || typeof fc.maxAge === "number") {
      const dob: { gte?: Date; lte?: Date } = {};
      if (typeof fc.minAge === "number") dob.lte = new Date(y - fc.minAge, now.getMonth(), now.getDate());
      if (typeof fc.maxAge === "number") dob.gte = new Date(y - fc.maxAge - 1, now.getMonth(), now.getDate() + 1);
      personWhere.dateOfBirth = dob;
    }
  }

  const [totalEligible, currentCycleRecords] = await Promise.all([
    prisma.person.count({ where: personWhere }),
    prisma.distributionRecord.findMany({
      where: { distributionId: dist.id, distributionDate: currentDate },
      include: { person: { select: { fullName: true, nameWithInitials: true } } },
    }),
  ]);
  const totalDistributed = currentCycleRecords.length;
  const totalPending = Math.max(0, totalEligible - totalDistributed);
  const completionPercentage = totalEligible > 0 ? Math.round((totalDistributed / totalEligible) * 100) : 0;

  const records = currentCycleRecords.map((r) => ({
    id: r.id,
    personId: r.personId,
    personName: r.person.fullName || r.person.nameWithInitials,
    distributedAt: r.distributedAt,
    distributionDate: r.distributionDate,
  }));

  return res.json({
    distributionId: dist.id,
    name: dist.name,
    totalEligible,
    totalDistributed,
    totalPending,
    completionPercentage,
    records,
  });
});
