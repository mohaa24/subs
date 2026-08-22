import { Router } from "express";
import { MessageEventType } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAdmin, requireAuth, requireSuperUser, withOrgScope } from "../middleware/auth.js";
import { getTextLkBalance } from "../lib/textlk.js";
import {
  getMessageUsage,
  getTemplateDefinition,
  MESSAGE_TEMPLATE_DEFINITIONS,
  validateTemplateBody,
} from "../lib/message-templates.js";
import { writeAuditLog } from "../lib/audit-log.js";

export const messagesRouter = Router();

messagesRouter.use(requireAuth);
messagesRouter.use(withOrgScope);

function getOrgId(req: any): string | undefined {
  return req.organizationId ?? req.query?.organizationId;
}

async function loadSettingsPayload(organizationId: string) {
  const [organization, settings, savedTemplates, usage] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true },
    }),
    prisma.messageSettings.findUnique({ where: { organizationId } }),
    prisma.messageTemplate.findMany({ where: { organizationId } }),
    getMessageUsage(organizationId),
  ]);
  if (!organization) return null;
  const byEvent = new Map(savedTemplates.map((template) => [template.eventType, template]));
  return {
    organization,
    monthlyQuota: settings?.monthlyQuota ?? 100,
    usage,
    templates: MESSAGE_TEMPLATE_DEFINITIONS.map((definition) => {
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

messagesRouter.get("/settings", requireAdmin, async (req, res) => {
  const organizationId = getOrgId(req);
  if (!organizationId) return res.status(400).json({ error: "organizationId required" });
  const payload = await loadSettingsPayload(organizationId);
  if (!payload) return res.status(404).json({ error: "Organization not found" });
  return res.json(payload);
});

const updateSettingsSchema = z.object({
  organizationId: z.string().min(1),
  monthlyQuota: z.number().int().min(0).max(1_000_000),
  templates: z.array(
    z.object({
      eventType: z.nativeEnum(MessageEventType),
      enabled: z.boolean(),
      body: z.string().trim().min(1).max(2000),
    })
  ),
});

messagesRouter.put("/settings", requireSuperUser, async (req, res) => {
  const parsed = updateSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid settings", details: parsed.error.flatten() });
  }
  const organization = await prisma.organization.findUnique({
    where: { id: parsed.data.organizationId },
    select: { id: true, name: true },
  });
  if (!organization) return res.status(404).json({ error: "Organization not found" });

  for (const template of parsed.data.templates) {
    const definition = getTemplateDefinition(template.eventType);
    if (!definition?.available && template.enabled) {
      return res.status(400).json({ error: `${definition?.label ?? template.eventType} is not available yet` });
    }
    const validationError = validateTemplateBody(template.eventType, template.body);
    if (validationError) return res.status(400).json({ error: validationError });
  }

  await prisma.$transaction(async (tx) => {
    await tx.messageSettings.upsert({
      where: { organizationId: parsed.data.organizationId },
      create: {
        organizationId: parsed.data.organizationId,
        monthlyQuota: parsed.data.monthlyQuota,
        updatedByUserId: req.auth!.userId,
      },
      update: {
        monthlyQuota: parsed.data.monthlyQuota,
        updatedByUserId: req.auth!.userId,
      },
    });
    for (const template of parsed.data.templates) {
      const definition = getTemplateDefinition(template.eventType);
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
          updatedByUserId: req.auth!.userId,
        },
        update: {
          enabled: Boolean(definition?.available && template.enabled),
          body: template.body,
          updatedByUserId: req.auth!.userId,
        },
      });
    }
    await writeAuditLog(tx, {
      organizationId: parsed.data.organizationId,
      actorUserId: req.auth!.userId,
      action: "message_settings.updated",
      entityType: "MessageSettings",
      entityId: parsed.data.organizationId,
      summary: `Updated SMS settings for ${organization.name}`,
      metadata: {
        monthlyQuota: parsed.data.monthlyQuota,
        enabledEvents: parsed.data.templates.filter((template) => template.enabled).map((template) => template.eventType),
      },
    });
  });

  return res.json(await loadSettingsPayload(parsed.data.organizationId));
});

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

messagesRouter.get("/provider/status", requireSuperUser, async (_req, res) => {
  const configured = Boolean(process.env.TEXTLK_API_TOKEN?.trim());
  if (!configured) return res.json({ configured: false, workerEnabled: false });

  try {
    const balance = await getTextLkBalance();
    return res.json({
      configured: true,
      workerEnabled: process.env.TEXTLK_MESSAGE_WORKER_ENABLED === "true",
      balance,
    });
  } catch (error) {
    return res.status(502).json({
      configured: true,
      workerEnabled: process.env.TEXTLK_MESSAGE_WORKER_ENABLED === "true",
      error: error instanceof Error ? error.message : "Unable to connect to Text.lk",
    });
  }
});
