"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.messagesRouter = void 0;
const express_1 = require("express");
const client_1 = require("@prisma/client");
const zod_1 = require("zod");
const prisma_js_1 = require("../lib/prisma.js");
const auth_js_1 = require("../middleware/auth.js");
const permissions_js_1 = require("./permissions.js");
const textlk_js_1 = require("../lib/textlk.js");
const message_templates_js_1 = require("../lib/message-templates.js");
const audit_log_js_1 = require("../lib/audit-log.js");
exports.messagesRouter = (0, express_1.Router)();
exports.messagesRouter.use(auth_js_1.requireAuth);
exports.messagesRouter.use(auth_js_1.withOrgScope);
function getOrgId(req) {
    return req.organizationId ?? req.query?.organizationId;
}
async function loadSettingsPayload(organizationId) {
    const [organization, settings, savedTemplates, usage] = await Promise.all([
        prisma_js_1.prisma.organization.findUnique({
            where: { id: organizationId },
            select: { id: true, name: true },
        }),
        prisma_js_1.prisma.messageSettings.findUnique({ where: { organizationId } }),
        prisma_js_1.prisma.messageTemplate.findMany({ where: { organizationId } }),
        (0, message_templates_js_1.getMessageUsage)(organizationId),
    ]);
    if (!organization)
        return null;
    const byEvent = new Map(savedTemplates.map((template) => [template.eventType, template]));
    return {
        organization,
        monthlyQuota: settings?.monthlyQuota ?? 100,
        usage,
        templates: message_templates_js_1.MESSAGE_TEMPLATE_DEFINITIONS.map((definition) => {
            const saved = byEvent.get(definition.eventType);
            return {
                eventType: definition.eventType,
                label: definition.label,
                description: definition.description,
                available: definition.available,
                enabled: definition.available && (saved?.enabled ?? definition.defaultEnabled),
                body: saved?.body ?? definition.defaultBody,
                allowedVariables: definition.allowedVariables,
            };
        }),
    };
}
exports.messagesRouter.get("/settings", (0, permissions_js_1.requirePermission)("VIEW_SMS_SETTINGS"), async (req, res) => {
    const organizationId = getOrgId(req);
    if (!organizationId)
        return res.status(400).json({ error: "organizationId required" });
    const payload = await loadSettingsPayload(organizationId);
    if (!payload)
        return res.status(404).json({ error: "Organization not found" });
    return res.json(payload);
});
const updateSettingsSchema = zod_1.z.object({
    organizationId: zod_1.z.string().min(1),
    monthlyQuota: zod_1.z.number().int().min(0).max(1_000_000),
    templates: zod_1.z.array(zod_1.z.object({
        eventType: zod_1.z.nativeEnum(client_1.MessageEventType),
        enabled: zod_1.z.boolean(),
        body: zod_1.z.string().trim().min(1).max(2000),
    })),
});
exports.messagesRouter.put("/settings", (0, permissions_js_1.requirePermission)("MANAGE_SMS_TEMPLATES"), async (req, res) => {
    const parsed = updateSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: "Invalid settings", details: parsed.error.flatten() });
    }
    const organization = await prisma_js_1.prisma.organization.findUnique({
        where: { id: parsed.data.organizationId },
        select: { id: true, name: true },
    });
    if (!organization)
        return res.status(404).json({ error: "Organization not found" });
    for (const template of parsed.data.templates) {
        const definition = (0, message_templates_js_1.getTemplateDefinition)(template.eventType);
        if (!definition?.available && template.enabled) {
            return res.status(400).json({ error: `${definition?.label ?? template.eventType} is not available yet` });
        }
        const validationError = (0, message_templates_js_1.validateTemplateBody)(template.eventType, template.body);
        if (validationError)
            return res.status(400).json({ error: validationError });
    }
    const existingSettings = await prisma_js_1.prisma.messageSettings.findUnique({ where: { organizationId: parsed.data.organizationId } });
    const monthlyQuota = req.auth.role === "super_user" ? parsed.data.monthlyQuota : existingSettings?.monthlyQuota ?? 100;
    await prisma_js_1.prisma.$transaction(async (tx) => {
        await tx.messageSettings.upsert({
            where: { organizationId: parsed.data.organizationId },
            create: {
                organizationId: parsed.data.organizationId,
                monthlyQuota,
                updatedByUserId: req.auth.userId,
            },
            update: {
                monthlyQuota,
                updatedByUserId: req.auth.userId,
            },
        });
        for (const template of parsed.data.templates) {
            const definition = (0, message_templates_js_1.getTemplateDefinition)(template.eventType);
            await tx.messageTemplate.upsert({
                where: {
                    organizationId_eventType: {
                        organizationId: parsed.data.organizationId,
                        eventType: template.eventType,
                    },
                },
                create: {
                    organizationId: parsed.data.organizationId,
                    eventType: template.eventType,
                    enabled: Boolean(definition?.available && template.enabled),
                    body: template.body,
                    updatedByUserId: req.auth.userId,
                },
                update: {
                    enabled: Boolean(definition?.available && template.enabled),
                    body: template.body,
                    updatedByUserId: req.auth.userId,
                },
            });
        }
        await (0, audit_log_js_1.writeAuditLog)(tx, {
            organizationId: parsed.data.organizationId,
            actorUserId: req.auth.userId,
            action: "message_settings.updated",
            entityType: "MessageSettings",
            entityId: parsed.data.organizationId,
            summary: `Updated SMS settings for ${organization.name}`,
            metadata: {
                monthlyQuota,
                enabledEvents: parsed.data.templates.filter((template) => template.enabled).map((template) => template.eventType),
            },
        });
    });
    return res.json(await loadSettingsPayload(parsed.data.organizationId));
});
exports.messagesRouter.get("/", (0, permissions_js_1.requirePermission)("VIEW_SMS_SETTINGS"), async (req, res) => {
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
exports.messagesRouter.get("/provider/status", auth_js_1.requireSuperUser, async (_req, res) => {
    const configured = Boolean(process.env.TEXTLK_API_TOKEN?.trim());
    if (!configured)
        return res.json({ configured: false, workerEnabled: false });
    try {
        const balance = await (0, textlk_js_1.getTextLkBalance)();
        return res.json({
            configured: true,
            workerEnabled: process.env.TEXTLK_MESSAGE_WORKER_ENABLED === "true",
            balance,
        });
    }
    catch (error) {
        return res.status(502).json({
            configured: true,
            workerEnabled: process.env.TEXTLK_MESSAGE_WORKER_ENABLED === "true",
            error: error instanceof Error ? error.message : "Unable to connect to Text.lk",
        });
    }
});
