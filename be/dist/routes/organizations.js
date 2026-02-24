"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.organizationsRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const prisma_js_1 = require("../lib/prisma.js");
const auth_js_1 = require("../middleware/auth.js");
exports.organizationsRouter = (0, express_1.Router)();
exports.organizationsRouter.use(auth_js_1.requireAuth);
exports.organizationsRouter.use(auth_js_1.requireSuperUser);
const createSchema = zod_1.z.object({
    name: zod_1.z.string().min(1),
    slug: zod_1.z.string().min(1).regex(/^[a-z0-9_-]+$/),
});
const updateSchema = zod_1.z.object({
    name: zod_1.z.string().min(1).optional(),
    slug: zod_1.z.string().min(1).regex(/^[a-z0-9_-]+$/).optional(),
});
exports.organizationsRouter.get("/", async (_req, res) => {
    const list = await prisma_js_1.prisma.organization.findMany({ orderBy: { name: "asc" } });
    return res.json(list);
});
exports.organizationsRouter.get("/:id", async (req, res) => {
    const org = await prisma_js_1.prisma.organization.findUnique({ where: { id: req.params.id } });
    if (!org)
        return res.status(404).json({ error: "Organization not found" });
    return res.json(org);
});
exports.organizationsRouter.post("/", async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    }
    const existing = await prisma_js_1.prisma.organization.findUnique({ where: { slug: parsed.data.slug } });
    if (existing)
        return res.status(409).json({ error: "Slug already in use" });
    const org = await prisma_js_1.prisma.organization.create({ data: parsed.data });
    return res.status(201).json(org);
});
exports.organizationsRouter.patch("/:id", async (req, res) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    }
    if (parsed.data.slug) {
        const existing = await prisma_js_1.prisma.organization.findFirst({
            where: { slug: parsed.data.slug, NOT: { id: req.params.id } },
        });
        if (existing)
            return res.status(409).json({ error: "Slug already in use" });
    }
    const org = await prisma_js_1.prisma.organization.update({
        where: { id: req.params.id },
        data: parsed.data,
    });
    return res.json(org);
});
