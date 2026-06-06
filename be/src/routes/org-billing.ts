import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireSuperUser } from "../middleware/auth.js";

export const orgBillingRouter = Router();

orgBillingRouter.use(requireAuth);

orgBillingRouter.get("/:id/billing", requireSuperUser, async (req, res) => {
  const orgId = req.params.id;
  const billing = await prisma.organizationBilling.findMany({
    where: { organizationId: orgId },
    orderBy: { year: "desc" },
    include: { markedBy: { select: { id: true, email: true } } },
  });
  return res.json(billing);
});

orgBillingRouter.patch("/:id/billing/:billingId", requireSuperUser, async (req, res) => {
  const { billingId } = req.params;
  const existing = await prisma.organizationBilling.findUnique({ where: { id: billingId } });
  if (!existing) return res.status(404).json({ error: "Billing record not found" });

  const updated = await prisma.organizationBilling.update({
    where: { id: billingId },
    data: {
      isPaid: !existing.isPaid,
      paidAt: !existing.isPaid ? new Date() : null,
      markedByUserId: !existing.isPaid ? req.auth!.userId : null,
    },
    include: { markedBy: { select: { id: true, email: true } } },
  });
  return res.json(updated);
});
