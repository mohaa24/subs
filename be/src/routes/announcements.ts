import { randomUUID } from "node:crypto";
import { Router } from "express";
import { AnnouncementStatus, MembershipStatus, MessageEventType, MessageStatus, Permission, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, withOrgScope } from "../middleware/auth.js";
import { requirePermission } from "./permissions.js";
import { writeAuditLog } from "../lib/audit-log.js";
import {
  currentQuotaPeriod,
  estimateSmsSegments,
  getMessageUsage,
  normalizeRecipientPhone,
  renderMessageTemplate,
} from "../lib/message-templates.js";

export const announcementsRouter = Router();

announcementsRouter.use(requireAuth);
announcementsRouter.use(withOrgScope);
announcementsRouter.use(requirePermission(Permission.MANAGE_ANNOUNCEMENTS));

const ANNOUNCEMENT_VARIABLES = ["member_name", "membership_no", "organization_name", "total_outstanding_due"] as const;

function getOrgId(req: any): string | undefined {
  return req.organizationId ?? req.body?.organizationId ?? req.query?.organizationId;
}

function assertOrgAccess(req: any, organizationId: string) {
  return req.auth!.role === "super_user"
    ? getOrgId(req) === organizationId
    : req.auth!.organizationId === organizationId;
}

function validateAnnouncementBody(body: string) {
  const variables = [...body.matchAll(/{{\s*([a-zA-Z0-9_]+)\s*}}/g)].map((match) => match[1]);
  const invalid = variables.find((variable) => !ANNOUNCEMENT_VARIABLES.includes(variable as any));
  return invalid ? `Unsupported placeholder: {{${invalid}}}` : null;
}

const audienceSchema = z.object({
  allMembers: z.boolean().default(false),
  groupIds: z.array(z.string()).default([]),
  membershipIds: z.array(z.string()).default([]),
  excludedMembershipIds: z.array(z.string()).default([]),
});
type AnnouncementAudience = z.infer<typeof audienceSchema>;

const templateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional().nullable(),
  body: z.string().trim().min(1).max(2000),
});
const groupSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional().nullable(),
});
const createGroupSchema = groupSchema.extend({ membershipIds: z.array(z.string()).max(1000).default([]) });
const groupMembersSchema = z.object({ membershipIds: z.array(z.string()).min(1).max(1000) });
const emptyAudience = { allMembers: false, groupIds: [], membershipIds: [], excludedMembershipIds: [] };
const draftSchema = z.object({
  id: z.string().optional(),
  templateId: z.string().optional().nullable(),
  message: z.string().max(2000).default(""),
  audience: audienceSchema.default(emptyAudience),
});
const sendSchema = z.object({
  id: z.string().optional(),
  templateId: z.string().optional().nullable(),
  message: z.string().trim().min(1).max(2000),
  audience: audienceSchema,
  confirmedEstimatedSmsCount: z.number().int().min(1),
});

async function getOrganizationId(req: any) {
  const organizationId = getOrgId(req);
  if (!organizationId || !assertOrgAccess(req, organizationId)) return null;
  return organizationId;
}

async function resolveMembershipIds(organizationId: string, audience: AnnouncementAudience) {
  const selected = new Set<string>(audience.membershipIds);
  if (audience.allMembers) {
    const memberships = await prisma.membership.findMany({
      where: { organizationId, isArchived: false, membershipStatus: MembershipStatus.Active },
      select: { id: true },
    });
    memberships.forEach((membership) => selected.add(membership.id));
  }
  if (audience.groupIds.length) {
    const groups = await prisma.announcementGroup.findMany({
      where: { id: { in: audience.groupIds }, organizationId },
      select: {
        id: true,
        members: { select: { membershipId: true, person: { select: { membershipId: true, membershipsAsHod: { select: { id: true }, take: 1 } } } } },
      },
    });
    if (groups.length !== new Set(audience.groupIds).size) throw new Error("One or more groups are invalid");
    for (const group of groups) {
      for (const member of group.members) {
        const membershipId = member.membershipId ?? member.person?.membershipId ?? member.person?.membershipsAsHod[0]?.id;
        if (membershipId) selected.add(membershipId);
      }
    }
  }
  audience.excludedMembershipIds.forEach((id) => selected.delete(id));
  return [...selected];
}

async function resolveAudience(organizationId: string, audience: AnnouncementAudience, message: string) {
  const validationError = validateAnnouncementBody(message);
  if (validationError) throw new Error(validationError);
  const membershipIds = await resolveMembershipIds(organizationId, audience);
  const [organization, memberships, outstandingRows] = await Promise.all([
    prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } }),
    prisma.membership.findMany({
      where: { id: { in: membershipIds }, organizationId, isArchived: false, membershipStatus: MembershipStatus.Active },
      select: {
        id: true,
        membershipNo: true,
        hod: { select: { fullName: true, nameWithInitials: true, mobileNumber: true, whatsAppNumber: true } },
      },
      orderBy: { membershipNo: "asc" },
    }),
    prisma.paymentDue.groupBy({
      by: ["membershipId"],
      where: { membershipId: { in: membershipIds }, isSystemAdjustment: false },
      _sum: { amountDue: true, amountPaid: true },
    }),
  ]);
  if (!organization) throw new Error("Organization not found");
  const outstanding = new Map(outstandingRows.map((row) => [
    row.membershipId,
    Math.max(0, Number(row._sum.amountDue ?? 0) - Number(row._sum.amountPaid ?? 0)),
  ]));
  const missingPhone: Array<{ membershipId: string; membershipNo: string; memberName: string }> = [];
  const recipients = memberships.flatMap((membership) => {
    const memberName = membership.hod.nameWithInitials || membership.hod.fullName || membership.membershipNo;
    const rawPhone = membership.hod.mobileNumber?.trim() || membership.hod.whatsAppNumber?.trim();
    if (!rawPhone) {
      missingPhone.push({ membershipId: membership.id, membershipNo: membership.membershipNo, memberName });
      return [];
    }
    const messageBody = renderMessageTemplate(message, {
      member_name: memberName,
      membership_no: membership.membershipNo,
      organization_name: organization.name,
      total_outstanding_due: (outstanding.get(membership.id) ?? 0).toFixed(2),
    }).trim();
    return [{
      membershipId: membership.id,
      membershipNo: membership.membershipNo,
      memberName,
      recipientPhone: normalizeRecipientPhone(rawPhone),
      messageBody,
      estimatedSmsCount: estimateSmsSegments(messageBody),
    }];
  });
  return {
    selectedCount: memberships.length,
    eligibleCount: recipients.length,
    missingPhone,
    recipients,
    estimatedSmsCount: recipients.reduce((sum, recipient) => sum + recipient.estimatedSmsCount, 0),
  };
}

async function announcementList(organizationId: string) {
  const announcements = await prisma.announcement.findMany({
    where: { organizationId },
    orderBy: { updatedAt: "desc" },
    include: {
      template: { select: { id: true, name: true } },
      sentBy: { select: { id: true, email: true } },
      messages: { select: { status: true, smsCount: true } },
    },
  });
  return announcements.map(({ messages, ...announcement }) => {
    const consumedSmsCount = messages.reduce((sum, item) => sum + (item.smsCount ?? 0), 0);
    let displayStatus: AnnouncementStatus = announcement.status;
    if (announcement.status !== AnnouncementStatus.draft && messages.length) {
      const pending = messages.filter((item) => item.status === MessageStatus.pending || item.status === MessageStatus.submitted).length;
      const failed = messages.filter((item) => item.status === MessageStatus.failed).length;
      if (pending > 0) displayStatus = AnnouncementStatus.queued;
      else if (failed === messages.length) displayStatus = AnnouncementStatus.failed;
      else if (failed > 0) displayStatus = AnnouncementStatus.partially_failed;
      else displayStatus = AnnouncementStatus.sent;
    }
    return { ...announcement, status: displayStatus, consumedSmsCount };
  });
}

announcementsRouter.get("/announcement-templates", async (req, res) => {
  const organizationId = await getOrganizationId(req);
  if (!organizationId) return res.status(403).json({ error: "Organization scope required" });
  return res.json({
    allowedVariables: ANNOUNCEMENT_VARIABLES,
    items: await prisma.announcementTemplate.findMany({ where: { organizationId }, orderBy: { name: "asc" } }),
  });
});

announcementsRouter.post("/announcement-templates", async (req, res) => {
  const parsed = templateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid template", details: parsed.error.flatten() });
  const organizationId = await getOrganizationId(req);
  if (!organizationId) return res.status(403).json({ error: "Organization scope required" });
  const validationError = validateAnnouncementBody(parsed.data.body);
  if (validationError) return res.status(400).json({ error: validationError });
  try {
    const template = await prisma.announcementTemplate.create({
      data: { ...parsed.data, description: parsed.data.description || null, organizationId, createdByUserId: req.auth!.userId, updatedByUserId: req.auth!.userId },
    });
    return res.status(201).json(template);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return res.status(409).json({ error: "A template with this name already exists" });
    throw error;
  }
});

announcementsRouter.put("/announcement-templates/:id", async (req, res) => {
  const parsed = templateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid template", details: parsed.error.flatten() });
  const existing = await prisma.announcementTemplate.findUnique({ where: { id: req.params.id } });
  if (!existing || !assertOrgAccess(req, existing.organizationId)) return res.status(404).json({ error: "Template not found" });
  const validationError = validateAnnouncementBody(parsed.data.body);
  if (validationError) return res.status(400).json({ error: validationError });
  return res.json(await prisma.announcementTemplate.update({
    where: { id: existing.id },
    data: { ...parsed.data, description: parsed.data.description || null, updatedByUserId: req.auth!.userId },
  }));
});

announcementsRouter.delete("/announcement-templates/:id", async (req, res) => {
  const existing = await prisma.announcementTemplate.findUnique({ where: { id: req.params.id } });
  if (!existing || !assertOrgAccess(req, existing.organizationId)) return res.status(404).json({ error: "Template not found" });
  await prisma.announcementTemplate.delete({ where: { id: existing.id } });
  return res.status(204).send();
});

announcementsRouter.get("/announcement-members", async (req, res) => {
  const organizationId = await getOrganizationId(req);
  if (!organizationId) return res.status(403).json({ error: "Organization scope required" });
  const q = String(req.query.q ?? "").trim();
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
  const memberships = await prisma.membership.findMany({
    where: {
      organizationId,
      isArchived: false,
      membershipStatus: MembershipStatus.Active,
      ...(q ? { OR: [
        { membershipNo: { contains: q, mode: "insensitive" as const } },
        { hod: { fullName: { contains: q, mode: "insensitive" as const } } },
        { hod: { nameWithInitials: { contains: q, mode: "insensitive" as const } } },
      ] } : {}),
    },
    select: { id: true, membershipNo: true, hod: { select: { fullName: true, nameWithInitials: true, mobileNumber: true, whatsAppNumber: true } } },
    orderBy: { membershipNo: "asc" },
    take: limit,
  });
  return res.json({ items: memberships.map((item) => ({
    id: item.id,
    membershipNo: item.membershipNo,
    memberName: item.hod.nameWithInitials || item.hod.fullName,
    hasPhone: Boolean(item.hod.mobileNumber?.trim() || item.hod.whatsAppNumber?.trim()),
  })) });
});

announcementsRouter.get("/announcement-groups", async (req, res) => {
  const organizationId = await getOrganizationId(req);
  if (!organizationId) return res.status(403).json({ error: "Organization scope required" });
  const groups = await prisma.announcementGroup.findMany({ where: { organizationId }, orderBy: { name: "asc" }, include: { _count: { select: { members: true } } } });
  return res.json(groups.map(({ _count, ...group }) => ({ ...group, memberCount: _count.members })));
});

announcementsRouter.post("/announcement-groups", async (req, res) => {
  const parsed = createGroupSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid group", details: parsed.error.flatten() });
  const organizationId = await getOrganizationId(req);
  if (!organizationId) return res.status(403).json({ error: "Organization scope required" });
  const validMemberships = parsed.data.membershipIds.length
    ? await prisma.membership.findMany({ where: { id: { in: parsed.data.membershipIds }, organizationId }, select: { id: true } })
    : [];
  const group = await prisma.$transaction(async (tx) => {
    const created = await tx.announcementGroup.create({
      data: { name: parsed.data.name, description: parsed.data.description || null, organizationId, createdByUserId: req.auth!.userId },
    });
    if (validMemberships.length) {
      await tx.announcementGroupMember.createMany({ data: validMemberships.map((membership) => ({ groupId: created.id, membershipId: membership.id })) });
    }
    return created;
  });
  return res.status(201).json({ ...group, memberCount: validMemberships.length });
});

announcementsRouter.put("/announcement-groups/:id", async (req, res) => {
  const parsed = groupSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid group", details: parsed.error.flatten() });
  const group = await prisma.announcementGroup.findUnique({ where: { id: req.params.id } });
  if (!group || !assertOrgAccess(req, group.organizationId)) return res.status(404).json({ error: "Group not found" });
  return res.json(await prisma.announcementGroup.update({ where: { id: group.id }, data: { ...parsed.data, description: parsed.data.description || null } }));
});

announcementsRouter.delete("/announcement-groups/:id", async (req, res) => {
  const group = await prisma.announcementGroup.findUnique({ where: { id: req.params.id } });
  if (!group || !assertOrgAccess(req, group.organizationId)) return res.status(404).json({ error: "Group not found" });
  await prisma.announcementGroup.delete({ where: { id: group.id } });
  return res.status(204).send();
});

announcementsRouter.get("/announcement-groups/:id/members", async (req, res) => {
  const group = await prisma.announcementGroup.findUnique({
    where: { id: req.params.id },
    include: { members: { include: { membership: { include: { hod: true } }, person: { include: { membershipsAsHod: { include: { hod: true }, take: 1 } } } } } },
  });
  if (!group || !assertOrgAccess(req, group.organizationId)) return res.status(404).json({ error: "Group not found" });
  const members = group.members.flatMap((row) => {
    const membership = row.membership ?? row.person?.membershipsAsHod[0];
    return membership ? [{ id: row.id, membershipId: membership.id, membershipNo: membership.membershipNo, memberName: membership.hod.nameWithInitials || membership.hod.fullName }] : [];
  });
  return res.json([...new Map(members.map((member) => [member.membershipId, member])).values()]);
});

announcementsRouter.post("/announcement-groups/:id/members", async (req, res) => {
  const parsed = groupMembersSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid members", details: parsed.error.flatten() });
  const group = await prisma.announcementGroup.findUnique({ where: { id: req.params.id } });
  if (!group || !assertOrgAccess(req, group.organizationId)) return res.status(404).json({ error: "Group not found" });
  const valid = await prisma.membership.findMany({ where: { id: { in: parsed.data.membershipIds }, organizationId: group.organizationId }, select: { id: true } });
  await prisma.announcementGroupMember.createMany({ data: valid.map((membership) => ({ groupId: group.id, membershipId: membership.id })), skipDuplicates: true });
  return res.status(201).json({ added: valid.length });
});

announcementsRouter.delete("/announcement-groups/:id/members/:membershipId", async (req, res) => {
  const group = await prisma.announcementGroup.findUnique({ where: { id: req.params.id } });
  if (!group || !assertOrgAccess(req, group.organizationId)) return res.status(404).json({ error: "Group not found" });
  const legacyRows = await prisma.announcementGroupMember.findMany({
    where: { groupId: group.id, membershipId: null },
    select: { id: true, person: { select: { membershipId: true, membershipsAsHod: { select: { id: true }, take: 1 } } } },
  });
  const legacyIds = legacyRows
    .filter((row) => (row.person?.membershipId ?? row.person?.membershipsAsHod[0]?.id) === req.params.membershipId)
    .map((row) => row.id);
  await prisma.announcementGroupMember.deleteMany({
    where: { groupId: group.id, OR: [{ membershipId: req.params.membershipId }, { id: { in: legacyIds } }] },
  });
  return res.status(204).send();
});

announcementsRouter.get("/announcements/quota", async (req, res) => {
  const organizationId = await getOrganizationId(req);
  if (!organizationId) return res.status(403).json({ error: "Organization scope required" });
  return res.json(await getMessageUsage(organizationId));
});

announcementsRouter.post("/announcements/estimate", async (req, res) => {
  const parsed = draftSchema.safeParse(req.body);
  if (!parsed.success || !parsed.data.message.trim()) return res.status(400).json({ error: "Message and audience are required" });
  const organizationId = await getOrganizationId(req);
  if (!organizationId) return res.status(403).json({ error: "Organization scope required" });
  try {
    const [estimate, quota] = await Promise.all([resolveAudience(organizationId, parsed.data.audience, parsed.data.message.trim()), getMessageUsage(organizationId)]);
    return res.json({ selectedCount: estimate.selectedCount, eligibleCount: estimate.eligibleCount, missingPhone: estimate.missingPhone, estimatedSmsCount: estimate.estimatedSmsCount, quota, canSend: estimate.estimatedSmsCount > 0 && estimate.estimatedSmsCount <= quota.remaining });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Unable to estimate announcement" });
  }
});

announcementsRouter.get("/announcements", async (req, res) => {
  const organizationId = await getOrganizationId(req);
  if (!organizationId) return res.status(403).json({ error: "Organization scope required" });
  return res.json(await announcementList(organizationId));
});

announcementsRouter.get("/announcements/:id", async (req, res) => {
  const announcement = await prisma.announcement.findUnique({
    where: { id: req.params.id },
    include: {
      template: { select: { id: true, name: true } },
      sentBy: { select: { id: true, email: true } },
      recipients: { include: { messageQueue: { select: { status: true, smsCount: true, lastError: true } } }, orderBy: { membershipNo: "asc" } },
    },
  });
  if (!announcement || !assertOrgAccess(req, announcement.organizationId)) return res.status(404).json({ error: "Announcement not found" });
  return res.json(announcement);
});

announcementsRouter.post("/announcements/drafts", async (req, res) => {
  const parsed = draftSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid draft", details: parsed.error.flatten() });
  const organizationId = await getOrganizationId(req);
  if (!organizationId) return res.status(403).json({ error: "Organization scope required" });
  if (parsed.data.message.trim()) {
    const validationError = validateAnnouncementBody(parsed.data.message);
    if (validationError) return res.status(400).json({ error: validationError });
  }
  if (parsed.data.templateId) {
    const template = await prisma.announcementTemplate.findFirst({ where: { id: parsed.data.templateId, organizationId } });
    if (!template) return res.status(400).json({ error: "Template not found" });
  }
  const data = { templateId: parsed.data.templateId || null, message: parsed.data.message, audience: parsed.data.audience as Prisma.InputJsonValue, sentByUserId: req.auth!.userId };
  const existing = parsed.data.id ? await prisma.announcement.findFirst({ where: { id: parsed.data.id, organizationId, status: AnnouncementStatus.draft } }) : null;
  const announcement = existing
    ? await prisma.announcement.update({ where: { id: existing.id }, data })
    : await prisma.announcement.create({ data: { ...data, organizationId, status: AnnouncementStatus.draft } });
  return res.status(existing ? 200 : 201).json(announcement);
});

announcementsRouter.delete("/announcements/:id", async (req, res) => {
  const announcement = await prisma.announcement.findUnique({ where: { id: req.params.id } });
  if (!announcement || !assertOrgAccess(req, announcement.organizationId)) return res.status(404).json({ error: "Announcement not found" });
  if (announcement.status !== AnnouncementStatus.draft) return res.status(409).json({ error: "Only drafts can be deleted" });
  await prisma.announcement.delete({ where: { id: announcement.id } });
  return res.status(204).send();
});

announcementsRouter.post("/announcements/send", async (req, res) => {
  const parsed = sendSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid announcement", details: parsed.error.flatten() });
  const organizationId = await getOrganizationId(req);
  if (!organizationId) return res.status(403).json({ error: "Organization scope required" });
  try {
    const resolved = await resolveAudience(organizationId, parsed.data.audience, parsed.data.message);
    if (!resolved.eligibleCount) return res.status(400).json({ error: "None of the selected members has a mobile or WhatsApp number" });
    if (resolved.estimatedSmsCount !== parsed.data.confirmedEstimatedSmsCount) {
      return res.status(409).json({ error: "The quota estimate changed. Please review and confirm again.", estimatedSmsCount: resolved.estimatedSmsCount });
    }
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${organizationId} FOR UPDATE`;
      const period = currentQuotaPeriod();
      const [settings, accepted, reserved] = await Promise.all([
        tx.messageSettings.findUnique({ where: { organizationId } }),
        tx.messageQueue.aggregate({
          where: { organizationId, createdAt: { gte: period.start, lt: period.end }, providerMessageId: { not: null }, status: { in: [MessageStatus.submitted, MessageStatus.sent, MessageStatus.delivered, MessageStatus.failed] } },
          _sum: { smsCount: true },
        }),
        tx.messageQueue.aggregate({
          where: { organizationId, createdAt: { gte: period.start, lt: period.end }, status: MessageStatus.pending, deliveryEnabled: true },
          _sum: { estimatedSmsCount: true },
        }),
      ]);
      const monthlyQuota = settings?.monthlyQuota ?? 100;
      const used = accepted._sum.smsCount ?? 0;
      const reservedCount = reserved._sum.estimatedSmsCount ?? 0;
      const remaining = Math.max(0, monthlyQuota - used - reservedCount);
      if (resolved.estimatedSmsCount > remaining) {
        throw Object.assign(new Error(`This announcement needs ${resolved.estimatedSmsCount} SMS segments, but only ${remaining} are available.`), { code: "QUOTA_EXCEEDED", quota: { monthlyQuota, used, reserved: reservedCount, remaining } });
      }
      const existingDraft = parsed.data.id ? await tx.announcement.findFirst({ where: { id: parsed.data.id, organizationId, status: AnnouncementStatus.draft } }) : null;
      if (parsed.data.id && !existingDraft) throw new Error("Draft not found or already sent");
      const announcement = existingDraft
        ? await tx.announcement.update({
          where: { id: existingDraft.id },
          data: { templateId: parsed.data.templateId || null, message: parsed.data.message, audience: parsed.data.audience as Prisma.InputJsonValue, recipientCount: resolved.eligibleCount, estimatedSmsCount: resolved.estimatedSmsCount, sentAt: new Date(), sentByUserId: req.auth!.userId, status: AnnouncementStatus.queued },
        })
        : await tx.announcement.create({
          data: { organizationId, templateId: parsed.data.templateId || null, message: parsed.data.message, audience: parsed.data.audience as Prisma.InputJsonValue, recipientCount: resolved.eligibleCount, estimatedSmsCount: resolved.estimatedSmsCount, sentAt: new Date(), sentByUserId: req.auth!.userId, status: AnnouncementStatus.queued },
        });
      const queueRows = resolved.recipients.map((recipient) => ({
        id: randomUUID(), organizationId, announcementId: announcement.id, recipientPhone: recipient.recipientPhone,
        eventType: MessageEventType.ANNOUNCEMENT, messageBody: recipient.messageBody, estimatedSmsCount: recipient.estimatedSmsCount,
      }));
      await tx.messageQueue.createMany({ data: queueRows });
      await tx.announcementRecipient.createMany({
        data: resolved.recipients.map((recipient, index) => ({
          id: randomUUID(), announcementId: announcement.id, organizationId, membershipId: recipient.membershipId,
          membershipNo: recipient.membershipNo, memberName: recipient.memberName, recipientPhone: recipient.recipientPhone,
          messageBody: recipient.messageBody, estimatedSmsCount: recipient.estimatedSmsCount, messageQueueId: queueRows[index].id,
        })),
      });
      await writeAuditLog(tx, {
        organizationId,
        actorUserId: req.auth!.userId,
        action: "announcement.queued",
        entityType: "Announcement",
        entityId: announcement.id,
        summary: `Queued announcement for ${resolved.eligibleCount} member(s)`,
        metadata: { recipientCount: resolved.eligibleCount, missingPhoneCount: resolved.missingPhone.length, estimatedSmsCount: resolved.estimatedSmsCount },
      });
      return announcement;
    });
    return res.status(201).json({ ...result, missingPhoneCount: resolved.missingPhone.length });
  } catch (error: any) {
    if (error?.code === "QUOTA_EXCEEDED") return res.status(409).json({ error: error.message, code: error.code, quota: error.quota });
    return res.status(400).json({ error: error instanceof Error ? error.message : "Unable to send announcement" });
  }
});
