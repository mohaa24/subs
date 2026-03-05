"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.messagesRouter = void 0;
const express_1 = require("express");
const prisma_js_1 = require("../lib/prisma.js");
const auth_js_1 = require("../middleware/auth.js");
exports.messagesRouter = (0, express_1.Router)();
exports.messagesRouter.use(auth_js_1.requireAuth);
exports.messagesRouter.use(auth_js_1.withOrgScope);
function getOrgId(req) {
    return req.organizationId ?? req.query?.organizationId;
}
exports.messagesRouter.get("/", async (req, res) => {
    const orgId = getOrgId(req);
    if (!orgId && req.auth.role !== "super_user")
        return res.status(400).json({ error: "Organization scope required" });
    const page = Math.max(1, parseInt(String(req.query.page), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit), 10) || 20));
    const status = req.query.status;
    const eventType = req.query.eventType;
    const where = {};
    if (orgId)
        where.organizationId = orgId;
    if (status)
        where.status = status;
    if (eventType)
        where.eventType = eventType;
    const [items, total] = await Promise.all([
        prisma_js_1.prisma.messageQueue.findMany({
            where,
            orderBy: { createdAt: "desc" },
            skip: (page - 1) * limit,
            take: limit,
        }),
        prisma_js_1.prisma.messageQueue.count({ where }),
    ]);
    return res.json({ items, total, page, limit });
});
exports.messagesRouter.post("/send", async (req, res) => {
    // Placeholder for WhatsApp API integration.
    // When the API docs are provided, this endpoint will consume from the queue
    // and send messages via the WhatsApp API.
    return res.json({ message: "WhatsApp integration pending. Messages are queued." });
});
