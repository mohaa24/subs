"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activityFeedRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const prisma_js_1 = require("../lib/prisma.js");
const auth_js_1 = require("../middleware/auth.js");
const activity_feed_js_1 = require("../lib/activity-feed.js");
exports.activityFeedRouter = (0, express_1.Router)();
exports.activityFeedRouter.use(auth_js_1.requireAuth);
exports.activityFeedRouter.use(auth_js_1.withOrgScope);
const createRemarkSchema = zod_1.z.object({
    entryType: zod_1.z.literal("remark").optional(),
    body: zod_1.z.string().trim().min(1),
    metadata: zod_1.z.record(zod_1.z.any()).optional().nullable(),
});
function getOrgId(req) {
    return req.organizationId ?? req.body?.organizationId ?? req.query?.organizationId;
}
async function resolvePersonTarget(req) {
    const person = await prisma_js_1.prisma.person.findUnique({
        where: { id: req.params.id },
        select: { id: true, organizationId: true },
    });
    if (!person) {
        return { ok: false, error: { status: 404, body: { error: "Person not found" } } };
    }
    const requestedOrgId = getOrgId(req);
    if ((req.auth.role !== "super_user" && person.organizationId !== req.auth.organizationId) ||
        (requestedOrgId && requestedOrgId !== person.organizationId && req.auth.role === "super_user")) {
        return { ok: false, error: { status: 403, body: { error: "Forbidden" } } };
    }
    return { ok: true, target: { organizationId: person.organizationId, personId: person.id } };
}
async function resolveMembershipTarget(req) {
    const membership = await prisma_js_1.prisma.membership.findUnique({
        where: { id: req.params.id },
        select: { id: true, organizationId: true },
    });
    if (!membership) {
        return { ok: false, error: { status: 404, body: { error: "Membership not found" } } };
    }
    const requestedOrgId = getOrgId(req);
    if ((req.auth.role !== "super_user" && membership.organizationId !== req.auth.organizationId) ||
        (requestedOrgId && requestedOrgId !== membership.organizationId && req.auth.role === "super_user")) {
        return { ok: false, error: { status: 403, body: { error: "Forbidden" } } };
    }
    return { ok: true, target: { organizationId: membership.organizationId, membershipId: membership.id } };
}
exports.activityFeedRouter.get("/persons/:id/feed", async (req, res) => {
    const resolved = await resolvePersonTarget(req);
    if (!resolved.ok) {
        return res.status(resolved.error.status).json(resolved.error.body);
    }
    const page = Math.max(1, parseInt(String(req.query.page), 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit), 10) || 10));
    const result = await (0, activity_feed_js_1.listActivityFeedItems)(resolved.target, page, limit);
    return res.json(result);
});
exports.activityFeedRouter.post("/persons/:id/feed", async (req, res) => {
    const resolved = await resolvePersonTarget(req);
    if (!resolved.ok) {
        return res.status(resolved.error.status).json(resolved.error.body);
    }
    const parsed = createRemarkSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    }
    const item = await (0, activity_feed_js_1.createRemarkActivityFeedItem)(resolved.target, req.auth?.userId ?? null, parsed.data.body, parsed.data.metadata ?? null);
    return res.status(201).json(item);
});
exports.activityFeedRouter.get("/memberships/:id/feed", async (req, res) => {
    const resolved = await resolveMembershipTarget(req);
    if (!resolved.ok) {
        return res.status(resolved.error.status).json(resolved.error.body);
    }
    const page = Math.max(1, parseInt(String(req.query.page), 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit), 10) || 10));
    const result = await (0, activity_feed_js_1.listActivityFeedItems)(resolved.target, page, limit);
    return res.json(result);
});
exports.activityFeedRouter.post("/memberships/:id/feed", async (req, res) => {
    const resolved = await resolveMembershipTarget(req);
    if (!resolved.ok) {
        return res.status(resolved.error.status).json(resolved.error.body);
    }
    const parsed = createRemarkSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    }
    const item = await (0, activity_feed_js_1.createRemarkActivityFeedItem)(resolved.target, req.auth?.userId ?? null, parsed.data.body, parsed.data.metadata ?? null);
    return res.status(201).json(item);
});
