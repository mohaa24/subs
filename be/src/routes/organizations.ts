import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireSuperUser } from "../middleware/auth.js";

export const organizationsRouter = Router();

organizationsRouter.use(requireAuth);
organizationsRouter.use(requireSuperUser);

const createSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9_-]+$/),
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  slug: z.string().min(1).regex(/^[a-z0-9_-]+$/).optional(),
});

organizationsRouter.get("/", async (_req, res) => {
  const list = await prisma.organization.findMany({ orderBy: { name: "asc" } });
  return res.json(list);
});

organizationsRouter.get("/:id", async (req, res) => {
  const org = await prisma.organization.findUnique({ where: { id: req.params.id } });
  if (!org) return res.status(404).json({ error: "Organization not found" });
  return res.json(org);
});

organizationsRouter.post("/", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  }
  const existing = await prisma.organization.findUnique({ where: { slug: parsed.data.slug } });
  if (existing) return res.status(409).json({ error: "Slug already in use" });
  const org = await prisma.organization.create({ data: parsed.data });
  return res.status(201).json(org);
});

organizationsRouter.patch("/:id", async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  }
  if (parsed.data.slug) {
    const existing = await prisma.organization.findFirst({
      where: { slug: parsed.data.slug, NOT: { id: req.params.id } },
    });
    if (existing) return res.status(409).json({ error: "Slug already in use" });
  }
  const org = await prisma.organization.update({
    where: { id: req.params.id },
    data: parsed.data,
  });
  return res.json(org);
});
