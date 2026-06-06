import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, withOrgScope } from "../middleware/auth.js";

export const messagesRouter = Router();

messagesRouter.use(requireAuth);
messagesRouter.use(withOrgScope);

function getOrgId(req: any): string | undefined {
  return req.organizationId ?? req.query?.organizationId;
}

messagesRouter.get("/", async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId && req.auth!.role !== "super_user")
    return res.status(400).json({ error: "Organization scope required" });

  const page = Math.max(1, parseInt(String(req.query.page), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit), 10) || 20));
  const status = req.query.status as string | undefined;
  const eventType = req.query.eventType as string | undefined;

  const where: any = {};
  if (orgId) where.organizationId = orgId;
  if (status) where.status = status;
  if (eventType) where.eventType = eventType;

  const [items, total] = await Promise.all([
    prisma.messageQueue.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.messageQueue.count({ where }),
  ]);

  return res.json({ items, total, page, limit });
});

messagesRouter.post("/send", async (req, res) => {
  // Placeholder for WhatsApp API integration.
  // When the API docs are provided, this endpoint will consume from the queue
  // and send messages via the WhatsApp API.
  return res.json({ message: "WhatsApp integration pending. Messages are queued." });
});
