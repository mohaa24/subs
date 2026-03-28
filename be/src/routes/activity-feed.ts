import { Router, type Request } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, withOrgScope } from "../middleware/auth.js";
import { createRemarkActivityFeedItem, listActivityFeedItems } from "../lib/activity-feed.js";

export const activityFeedRouter = Router();

activityFeedRouter.use(requireAuth);
activityFeedRouter.use(withOrgScope);

const createRemarkSchema = z.object({
  entryType: z.literal("remark").optional(),
  body: z.string().trim().min(1),
  metadata: z.record(z.any()).optional().nullable(),
});

function getOrgId(req: Request & { organizationId?: string }) {
  return req.organizationId ?? req.body?.organizationId ?? req.query?.organizationId;
}

type ResolvedTarget =
  | { ok: true; target: { organizationId: string; personId?: string; membershipId?: string } }
  | { ok: false; error: { status: number; body: { error: string } } };

async function resolvePersonTarget(req: Request & { organizationId?: string }) {
  const person = await prisma.person.findUnique({
    where: { id: req.params.id },
    select: { id: true, organizationId: true },
  });
  if (!person) {
    return { ok: false, error: { status: 404, body: { error: "Person not found" } } } satisfies ResolvedTarget;
  }
  const requestedOrgId = getOrgId(req);
  if (
    (req.auth!.role !== "super_user" && person.organizationId !== req.auth!.organizationId) ||
    (requestedOrgId && requestedOrgId !== person.organizationId && req.auth!.role === "super_user")
  ) {
    return { ok: false, error: { status: 403, body: { error: "Forbidden" } } } satisfies ResolvedTarget;
  }
  return { ok: true, target: { organizationId: person.organizationId, personId: person.id } } satisfies ResolvedTarget;
}

async function resolveMembershipTarget(req: Request & { organizationId?: string }) {
  const membership = await prisma.membership.findUnique({
    where: { id: req.params.id },
    select: { id: true, organizationId: true },
  });
  if (!membership) {
    return { ok: false, error: { status: 404, body: { error: "Membership not found" } } } satisfies ResolvedTarget;
  }
  const requestedOrgId = getOrgId(req);
  if (
    (req.auth!.role !== "super_user" && membership.organizationId !== req.auth!.organizationId) ||
    (requestedOrgId && requestedOrgId !== membership.organizationId && req.auth!.role === "super_user")
  ) {
    return { ok: false, error: { status: 403, body: { error: "Forbidden" } } } satisfies ResolvedTarget;
  }
  return { ok: true, target: { organizationId: membership.organizationId, membershipId: membership.id } } satisfies ResolvedTarget;
}

activityFeedRouter.get("/persons/:id/feed", async (req, res) => {
  const resolved = await resolvePersonTarget(req as Request & { organizationId?: string });
  if (!resolved.ok) {
    return res.status(resolved.error.status).json(resolved.error.body);
  }

  const page = Math.max(1, parseInt(String(req.query.page), 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit), 10) || 10));
  const result = await listActivityFeedItems(resolved.target, page, limit);
  return res.json(result);
});

activityFeedRouter.post("/persons/:id/feed", async (req, res) => {
  const resolved = await resolvePersonTarget(req as Request & { organizationId?: string });
  if (!resolved.ok) {
    return res.status(resolved.error.status).json(resolved.error.body);
  }

  const parsed = createRemarkSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  }

  const item = await createRemarkActivityFeedItem(
    resolved.target,
    req.auth?.userId ?? null,
    parsed.data.body,
    parsed.data.metadata ?? null
  );
  return res.status(201).json(item);
});

activityFeedRouter.get("/memberships/:id/feed", async (req, res) => {
  const resolved = await resolveMembershipTarget(req as Request & { organizationId?: string });
  if (!resolved.ok) {
    return res.status(resolved.error.status).json(resolved.error.body);
  }

  const page = Math.max(1, parseInt(String(req.query.page), 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit), 10) || 10));
  const result = await listActivityFeedItems(resolved.target, page, limit);
  return res.json(result);
});

activityFeedRouter.post("/memberships/:id/feed", async (req, res) => {
  const resolved = await resolveMembershipTarget(req as Request & { organizationId?: string });
  if (!resolved.ok) {
    return res.status(resolved.error.status).json(resolved.error.body);
  }

  const parsed = createRemarkSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  }

  const item = await createRemarkActivityFeedItem(
    resolved.target,
    req.auth?.userId ?? null,
    parsed.data.body,
    parsed.data.metadata ?? null
  );
  return res.status(201).json(item);
});
