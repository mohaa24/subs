import { Router } from "express";
import { prisma } from "../lib/prisma.js";

export const publicMembershipExportRouter = Router();

publicMembershipExportRouter.get("/public/memberships/:id/export", async (req, res) => {
  const membership = await prisma.membership.findFirst({
    where: { id: req.params.id },
    include: {
      hod: true,
      spouse: true,
      dependents: { orderBy: { order: "asc" }, include: { person: true } },
      organization: { select: { id: true, name: true, slug: true, address: true } },
      createdBy: { select: { id: true, email: true } },
    },
  });

  if (!membership) {
    return res.status(404).json({ error: "Membership not found" });
  }

  const zones = await prisma.zone.findMany({
    where: { organizationId: membership.organizationId },
    orderBy: { code: "asc" },
  });

  return res.json({ membership, zones });
});
