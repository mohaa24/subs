"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.announcementsRouter = void 0;
const node_crypto_1 = require("node:crypto");
const express_1 = require("express");
const client_1 = require("@prisma/client");
const zod_1 = require("zod");
const prisma_js_1 = require("../lib/prisma.js");
const auth_js_1 = require("../middleware/auth.js");
const permissions_js_1 = require("./permissions.js");
const audit_log_js_1 = require("../lib/audit-log.js");
const message_templates_js_1 = require("../lib/message-templates.js");
exports.announcementsRouter = (0, express_1.Router)();
exports.announcementsRouter.use(auth_js_1.requireAuth);
exports.announcementsRouter.use(auth_js_1.withOrgScope);
exports.announcementsRouter.use((0, permissions_js_1.requirePermission)(client_1.Permission.MANAGE_ANNOUNCEMENTS));
const ANNOUNCEMENT_VARIABLES = ["member_name", "membership_no", "organization_name", "total_outstanding_due"];
function getOrgId(req) {
    return req.organizationId ?? req.body?.organizationId ?? req.query?.organizationId;
}
function assertOrgAccess(req, organizationId) {
    return req.auth.role === "super_user"
        ? getOrgId(req) === organizationId
        : req.auth.organizationId === organizationId;
}
function validateAnnouncementBody(body) {
    const variables = [...body.matchAll(/{{\s*([a-zA-Z0-9_]+)\s*}}/g)].map((match) => match[1]);
    const invalid = variables.find((variable) => !ANNOUNCEMENT_VARIABLES.includes(variable));
    return invalid ? `Unsupported placeholder: {{${invalid}}}` : null;
}
const audienceSchema = zod_1.z.object({
    allMembers: zod_1.z.boolean().default(false),
    groupIds: zod_1.z.array(zod_1.z.string()).default([]),
    membershipIds: zod_1.z.array(zod_1.z.string()).default([]),
    excludedMembershipIds: zod_1.z.array(zod_1.z.string()).default([]),
});
const templateSchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(1).max(120),
    description: zod_1.z.string().trim().max(500).optional().nullable(),
    body: zod_1.z.string().trim().min(1).max(2000),
});
const groupSchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(1).max(120),
    description: zod_1.z.string().trim().max(500).optional().nullable(),
});
const createGroupSchema = groupSchema.extend({ membershipIds: zod_1.z.array(zod_1.z.string()).max(1000).default([]) });
const groupMembersSchema = zod_1.z.object({ membershipIds: zod_1.z.array(zod_1.z.string()).min(1).max(1000) });
const emptyAudience = { allMembers: false, groupIds: [], membershipIds: [], excludedMembershipIds: [] };
const draftSchema = zod_1.z.object({
    id: zod_1.z.string().optional(),
    templateId: zod_1.z.string().optional().nullable(),
    message: zod_1.z.string().max(2000).default(""),
    audience: audienceSchema.default(emptyAudience),
});
const sendSchema = zod_1.z.object({
    id: zod_1.z.string().optional(),
    templateId: zod_1.z.string().optional().nullable(),
    message: zod_1.z.string().trim().min(1).max(2000),
    audience: audienceSchema,
    confirmedEstimatedSmsCount: zod_1.z.number().int().min(1),
});
async function getOrganizationId(req) {
    const organizationId = getOrgId(req);
    if (!organizationId || !assertOrgAccess(req, organizationId))
        return null;
    return organizationId;
}
async function resolveMembershipIds(organizationId, audience) {
    const selected = new Set(audience.membershipIds);
    if (audience.allMembers) {
        const memberships = await prisma_js_1.prisma.membership.findMany({
            where: { organizationId, isArchived: false, membershipStatus: client_1.MembershipStatus.Active },
            select: { id: true },
        });
        memberships.forEach((membership) => selected.add(membership.id));
    }
    if (audience.groupIds.length) {
        const groups = await prisma_js_1.prisma.announcementGroup.findMany({
            where: { id: { in: audience.groupIds }, organizationId },
            select: {
                id: true,
                members: { select: { membershipId: true, person: { select: { membershipId: true, membershipsAsHod: { select: { id: true }, take: 1 } } } } },
            },
        });
        if (groups.length !== new Set(audience.groupIds).size)
            throw new Error("One or more groups are invalid");
        for (const group of groups) {
            for (const member of group.members) {
                const membershipId = member.membershipId ?? member.person?.membershipId ?? member.person?.membershipsAsHod[0]?.id;
                if (membershipId)
                    selected.add(membershipId);
            }
        }
    }
    audience.excludedMembershipIds.forEach((id) => selected.delete(id));
    return [...selected];
}
async function resolveAudience(organizationId, audience, message) {
    const validationError = validateAnnouncementBody(message);
    if (validationError)
        throw new Error(validationError);
    const membershipIds = await resolveMembershipIds(organizationId, audience);
    const [organization, memberships, outstandingRows] = await Promise.all([
        prisma_js_1.prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } }),
        prisma_js_1.prisma.membership.findMany({
            where: { id: { in: membershipIds }, organizationId, isArchived: false, membershipStatus: client_1.MembershipStatus.Active },
            select: {
                id: true,
                membershipNo: true,
                hod: { select: { fullName: true, nameWithInitials: true, mobileNumber: true, whatsAppNumber: true } },
            },
            orderBy: { membershipNo: "asc" },
        }),
        prisma_js_1.prisma.paymentDue.groupBy({
            by: ["membershipId"],
            where: { membershipId: { in: membershipIds }, isSystemAdjustment: false },
            _sum: { amountDue: true, amountPaid: true },
        }),
    ]);
    if (!organization)
        throw new Error("Organization not found");
    const outstanding = new Map(outstandingRows.map((row) => [
        row.membershipId,
        Math.max(0, Number(row._sum.amountDue ?? 0) - Number(row._sum.amountPaid ?? 0)),
    ]));
    const missingPhone = [];
    const recipients = memberships.flatMap((membership) => {
        const memberName = membership.hod.nameWithInitials || membership.hod.fullName || membership.membershipNo;
        const rawPhone = membership.hod.mobileNumber?.trim() || membership.hod.whatsAppNumber?.trim();
        if (!rawPhone) {
            missingPhone.push({ membershipId: membership.id, membershipNo: membership.membershipNo, memberName });
            return [];
        }
        const messageBody = (0, message_templates_js_1.renderMessageTemplate)(message, {
            member_name: memberName,
            membership_no: membership.membershipNo,
            organization_name: organization.name,
            total_outstanding_due: (outstanding.get(membership.id) ?? 0).toFixed(2),
        }).trim();
        return [{
                membershipId: membership.id,
                membershipNo: membership.membershipNo,
                memberName,
                recipientPhone: (0, message_templates_js_1.normalizeRecipientPhone)(rawPhone),
                messageBody,
                estimatedSmsCount: (0, message_templates_js_1.estimateSmsSegments)(messageBody),
            }];
    });
    return {
        selectedCount: memberships.length,
        eligibleCount: recipients.length,
        missingPhone,
        recipients,
        estimatedSmsCount: recipients.reduce((sum, recipient) => sum + recipient.estimatedSmsCount, 0),
        overLimitRecipients: recipients
            .filter((recipient) => recipient.estimatedSmsCount > message_templates_js_1.MAX_SMS_SEGMENTS)
            .map((recipient) => ({
            membershipId: recipient.membershipId,
            membershipNo: recipient.membershipNo,
            memberName: recipient.memberName,
            estimatedSmsCount: recipient.estimatedSmsCount,
        })),
    };
}
async function announcementList(organizationId) {
    const announcements = await prisma_js_1.prisma.announcement.findMany({
        where: { organizationId },
        orderBy: { updatedAt: "desc" },
        include: {
            template: { select: { id: true, name: true } },
            sentBy: { select: { id: true, email: true } },
            messages: { select: { status: true, smsCount: true, lastError: true } },
        },
    });
    return announcements.map(({ messages, ...announcement }) => {
        const consumedSmsCount = messages.reduce((sum, item) => sum + (item.smsCount ?? 0), 0);
        const sentCount = messages.filter((item) => item.status === client_1.MessageStatus.submitted || item.status === client_1.MessageStatus.sent || item.status === client_1.MessageStatus.delivered).length;
        const errorCount = messages.filter((item) => item.status === client_1.MessageStatus.failed || (item.status === client_1.MessageStatus.pending && Boolean(item.lastError))).length;
        const queuedCount = Math.max(0, messages.length - sentCount - errorCount);
        let displayStatus = announcement.status;
        if (announcement.status !== client_1.AnnouncementStatus.draft && messages.length) {
            if (errorCount > 0)
                displayStatus = sentCount > 0 ? client_1.AnnouncementStatus.partially_failed : client_1.AnnouncementStatus.failed;
            else if (queuedCount > 0)
                displayStatus = sentCount > 0 ? "partially_sent" : client_1.AnnouncementStatus.queued;
            else
                displayStatus = client_1.AnnouncementStatus.sent;
        }
        return { ...announcement, status: displayStatus, consumedSmsCount, sentCount, errorCount, queuedCount };
    });
}
exports.announcementsRouter.get("/announcement-templates", async (req, res) => {
    const organizationId = await getOrganizationId(req);
    if (!organizationId)
        return res.status(403).json({ error: "Organization scope required" });
    return res.json({
        allowedVariables: ANNOUNCEMENT_VARIABLES,
        items: await prisma_js_1.prisma.announcementTemplate.findMany({ where: { organizationId }, orderBy: { name: "asc" } }),
    });
});
exports.announcementsRouter.post("/announcement-templates", async (req, res) => {
    const parsed = templateSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: "Invalid template", details: parsed.error.flatten() });
    const organizationId = await getOrganizationId(req);
    if (!organizationId)
        return res.status(403).json({ error: "Organization scope required" });
    const validationError = validateAnnouncementBody(parsed.data.body);
    if (validationError)
        return res.status(400).json({ error: validationError });
    try {
        const template = await prisma_js_1.prisma.announcementTemplate.create({
            data: { ...parsed.data, description: parsed.data.description || null, organizationId, createdByUserId: req.auth.userId, updatedByUserId: req.auth.userId },
        });
        return res.status(201).json(template);
    }
    catch (error) {
        if (error instanceof client_1.Prisma.PrismaClientKnownRequestError && error.code === "P2002")
            return res.status(409).json({ error: "A template with this name already exists" });
        throw error;
    }
});
exports.announcementsRouter.put("/announcement-templates/:id", async (req, res) => {
    const parsed = templateSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: "Invalid template", details: parsed.error.flatten() });
    const existing = await prisma_js_1.prisma.announcementTemplate.findUnique({ where: { id: req.params.id } });
    if (!existing || !assertOrgAccess(req, existing.organizationId))
        return res.status(404).json({ error: "Template not found" });
    const validationError = validateAnnouncementBody(parsed.data.body);
    if (validationError)
        return res.status(400).json({ error: validationError });
    return res.json(await prisma_js_1.prisma.announcementTemplate.update({
        where: { id: existing.id },
        data: { ...parsed.data, description: parsed.data.description || null, updatedByUserId: req.auth.userId },
    }));
});
exports.announcementsRouter.delete("/announcement-templates/:id", async (req, res) => {
    const existing = await prisma_js_1.prisma.announcementTemplate.findUnique({ where: { id: req.params.id } });
    if (!existing || !assertOrgAccess(req, existing.organizationId))
        return res.status(404).json({ error: "Template not found" });
    await prisma_js_1.prisma.announcementTemplate.delete({ where: { id: existing.id } });
    return res.status(204).send();
});
exports.announcementsRouter.get("/announcement-members", async (req, res) => {
    const organizationId = await getOrganizationId(req);
    if (!organizationId)
        return res.status(403).json({ error: "Organization scope required" });
    const q = String(req.query.q ?? "").trim();
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
    const memberships = await prisma_js_1.prisma.membership.findMany({
        where: {
            organizationId,
            isArchived: false,
            membershipStatus: client_1.MembershipStatus.Active,
            ...(q ? { OR: [
                    { membershipNo: { contains: q, mode: "insensitive" } },
                    { hod: { fullName: { contains: q, mode: "insensitive" } } },
                    { hod: { nameWithInitials: { contains: q, mode: "insensitive" } } },
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
exports.announcementsRouter.get("/announcement-groups", async (req, res) => {
    const organizationId = await getOrganizationId(req);
    if (!organizationId)
        return res.status(403).json({ error: "Organization scope required" });
    const groups = await prisma_js_1.prisma.announcementGroup.findMany({ where: { organizationId }, orderBy: { name: "asc" }, include: { _count: { select: { members: true } } } });
    return res.json(groups.map(({ _count, ...group }) => ({ ...group, memberCount: _count.members })));
});
exports.announcementsRouter.post("/announcement-groups", async (req, res) => {
    const parsed = createGroupSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: "Invalid group", details: parsed.error.flatten() });
    const organizationId = await getOrganizationId(req);
    if (!organizationId)
        return res.status(403).json({ error: "Organization scope required" });
    const validMemberships = parsed.data.membershipIds.length
        ? await prisma_js_1.prisma.membership.findMany({ where: { id: { in: parsed.data.membershipIds }, organizationId }, select: { id: true } })
        : [];
    const group = await prisma_js_1.prisma.$transaction(async (tx) => {
        const created = await tx.announcementGroup.create({
            data: { name: parsed.data.name, description: parsed.data.description || null, organizationId, createdByUserId: req.auth.userId },
        });
        if (validMemberships.length) {
            await tx.announcementGroupMember.createMany({ data: validMemberships.map((membership) => ({ groupId: created.id, membershipId: membership.id })) });
        }
        return created;
    });
    return res.status(201).json({ ...group, memberCount: validMemberships.length });
});
exports.announcementsRouter.put("/announcement-groups/:id", async (req, res) => {
    const parsed = groupSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: "Invalid group", details: parsed.error.flatten() });
    const group = await prisma_js_1.prisma.announcementGroup.findUnique({ where: { id: req.params.id } });
    if (!group || !assertOrgAccess(req, group.organizationId))
        return res.status(404).json({ error: "Group not found" });
    return res.json(await prisma_js_1.prisma.announcementGroup.update({ where: { id: group.id }, data: { ...parsed.data, description: parsed.data.description || null } }));
});
exports.announcementsRouter.delete("/announcement-groups/:id", async (req, res) => {
    const group = await prisma_js_1.prisma.announcementGroup.findUnique({ where: { id: req.params.id } });
    if (!group || !assertOrgAccess(req, group.organizationId))
        return res.status(404).json({ error: "Group not found" });
    await prisma_js_1.prisma.announcementGroup.delete({ where: { id: group.id } });
    return res.status(204).send();
});
exports.announcementsRouter.get("/announcement-groups/:id/members", async (req, res) => {
    const group = await prisma_js_1.prisma.announcementGroup.findUnique({
        where: { id: req.params.id },
        include: { members: { include: { membership: { include: { hod: true } }, person: { include: { membershipsAsHod: { include: { hod: true }, take: 1 } } } } } },
    });
    if (!group || !assertOrgAccess(req, group.organizationId))
        return res.status(404).json({ error: "Group not found" });
    const members = group.members.flatMap((row) => {
        const membership = row.membership ?? row.person?.membershipsAsHod[0];
        return membership ? [{ id: row.id, membershipId: membership.id, membershipNo: membership.membershipNo, memberName: membership.hod.nameWithInitials || membership.hod.fullName }] : [];
    });
    return res.json([...new Map(members.map((member) => [member.membershipId, member])).values()]);
});
exports.announcementsRouter.post("/announcement-groups/:id/members", async (req, res) => {
    const parsed = groupMembersSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: "Invalid members", details: parsed.error.flatten() });
    const group = await prisma_js_1.prisma.announcementGroup.findUnique({ where: { id: req.params.id } });
    if (!group || !assertOrgAccess(req, group.organizationId))
        return res.status(404).json({ error: "Group not found" });
    const valid = await prisma_js_1.prisma.membership.findMany({ where: { id: { in: parsed.data.membershipIds }, organizationId: group.organizationId }, select: { id: true } });
    await prisma_js_1.prisma.announcementGroupMember.createMany({ data: valid.map((membership) => ({ groupId: group.id, membershipId: membership.id })), skipDuplicates: true });
    return res.status(201).json({ added: valid.length });
});
exports.announcementsRouter.delete("/announcement-groups/:id/members/:membershipId", async (req, res) => {
    const group = await prisma_js_1.prisma.announcementGroup.findUnique({ where: { id: req.params.id } });
    if (!group || !assertOrgAccess(req, group.organizationId))
        return res.status(404).json({ error: "Group not found" });
    const legacyRows = await prisma_js_1.prisma.announcementGroupMember.findMany({
        where: { groupId: group.id, membershipId: null },
        select: { id: true, person: { select: { membershipId: true, membershipsAsHod: { select: { id: true }, take: 1 } } } },
    });
    const legacyIds = legacyRows
        .filter((row) => (row.person?.membershipId ?? row.person?.membershipsAsHod[0]?.id) === req.params.membershipId)
        .map((row) => row.id);
    await prisma_js_1.prisma.announcementGroupMember.deleteMany({
        where: { groupId: group.id, OR: [{ membershipId: req.params.membershipId }, { id: { in: legacyIds } }] },
    });
    return res.status(204).send();
});
exports.announcementsRouter.get("/announcements/quota", async (req, res) => {
    const organizationId = await getOrganizationId(req);
    if (!organizationId)
        return res.status(403).json({ error: "Organization scope required" });
    return res.json(await (0, message_templates_js_1.getMessageUsage)(organizationId));
});
exports.announcementsRouter.post("/announcements/estimate", async (req, res) => {
    const parsed = draftSchema.safeParse(req.body);
    if (!parsed.success || !parsed.data.message.trim())
        return res.status(400).json({ error: "Message and audience are required" });
    const organizationId = await getOrganizationId(req);
    if (!organizationId)
        return res.status(403).json({ error: "Organization scope required" });
    try {
        const [estimate, quota] = await Promise.all([resolveAudience(organizationId, parsed.data.audience, parsed.data.message.trim()), (0, message_templates_js_1.getMessageUsage)(organizationId)]);
        return res.json({
            selectedCount: estimate.selectedCount,
            eligibleCount: estimate.eligibleCount,
            missingPhone: estimate.missingPhone,
            estimatedSmsCount: estimate.estimatedSmsCount,
            overLimitRecipients: estimate.overLimitRecipients,
            maximumSegmentsPerRecipient: message_templates_js_1.MAX_SMS_SEGMENTS,
            quota,
            canSend: estimate.estimatedSmsCount > 0 &&
                estimate.overLimitRecipients.length === 0 &&
                estimate.estimatedSmsCount <= quota.remaining,
        });
    }
    catch (error) {
        return res.status(400).json({ error: error instanceof Error ? error.message : "Unable to estimate announcement" });
    }
});
exports.announcementsRouter.get("/announcements", async (req, res) => {
    const organizationId = await getOrganizationId(req);
    if (!organizationId)
        return res.status(403).json({ error: "Organization scope required" });
    return res.json(await announcementList(organizationId));
});
exports.announcementsRouter.get("/announcements/:id", async (req, res) => {
    const announcement = await prisma_js_1.prisma.announcement.findUnique({
        where: { id: req.params.id },
        include: {
            template: { select: { id: true, name: true } },
            sentBy: { select: { id: true, email: true } },
            recipients: { include: { messageQueue: { select: { status: true, smsCount: true, lastError: true, providerStatus: true, lastAttemptAt: true } } }, orderBy: { membershipNo: "asc" } },
        },
    });
    if (!announcement || !assertOrgAccess(req, announcement.organizationId))
        return res.status(404).json({ error: "Announcement not found" });
    return res.json(announcement);
});
exports.announcementsRouter.post("/announcements/drafts", async (req, res) => {
    const parsed = draftSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: "Invalid draft", details: parsed.error.flatten() });
    const organizationId = await getOrganizationId(req);
    if (!organizationId)
        return res.status(403).json({ error: "Organization scope required" });
    if (parsed.data.message.trim()) {
        const validationError = validateAnnouncementBody(parsed.data.message);
        if (validationError)
            return res.status(400).json({ error: validationError });
    }
    if (parsed.data.templateId) {
        const template = await prisma_js_1.prisma.announcementTemplate.findFirst({ where: { id: parsed.data.templateId, organizationId } });
        if (!template)
            return res.status(400).json({ error: "Template not found" });
    }
    const data = { templateId: parsed.data.templateId || null, message: parsed.data.message, audience: parsed.data.audience, sentByUserId: req.auth.userId };
    const existing = parsed.data.id ? await prisma_js_1.prisma.announcement.findFirst({ where: { id: parsed.data.id, organizationId, status: client_1.AnnouncementStatus.draft } }) : null;
    const announcement = existing
        ? await prisma_js_1.prisma.announcement.update({ where: { id: existing.id }, data })
        : await prisma_js_1.prisma.announcement.create({ data: { ...data, organizationId, status: client_1.AnnouncementStatus.draft } });
    return res.status(existing ? 200 : 201).json(announcement);
});
exports.announcementsRouter.delete("/announcements/:id", async (req, res) => {
    const announcement = await prisma_js_1.prisma.announcement.findUnique({ where: { id: req.params.id } });
    if (!announcement || !assertOrgAccess(req, announcement.organizationId))
        return res.status(404).json({ error: "Announcement not found" });
    if (announcement.status !== client_1.AnnouncementStatus.draft)
        return res.status(409).json({ error: "Only drafts can be deleted" });
    await prisma_js_1.prisma.announcement.delete({ where: { id: announcement.id } });
    return res.status(204).send();
});
exports.announcementsRouter.post("/announcements/send", async (req, res) => {
    const parsed = sendSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: "Invalid announcement", details: parsed.error.flatten() });
    const organizationId = await getOrganizationId(req);
    if (!organizationId)
        return res.status(403).json({ error: "Organization scope required" });
    try {
        const resolved = await resolveAudience(organizationId, parsed.data.audience, parsed.data.message);
        if (!resolved.eligibleCount)
            return res.status(400).json({ error: "None of the selected members has a mobile or WhatsApp number" });
        if (resolved.overLimitRecipients.length) {
            return res.status(400).json({
                error: `Announcement messages are limited to ${message_templates_js_1.MAX_SMS_SEGMENTS} SMS segments per recipient`,
                overLimitRecipients: resolved.overLimitRecipients,
            });
        }
        if (resolved.estimatedSmsCount !== parsed.data.confirmedEstimatedSmsCount) {
            return res.status(409).json({ error: "The quota estimate changed. Please review and confirm again.", estimatedSmsCount: resolved.estimatedSmsCount });
        }
        const result = await prisma_js_1.prisma.$transaction(async (tx) => {
            await tx.$queryRaw `SELECT id FROM "Organization" WHERE id = ${organizationId} FOR UPDATE`;
            const period = (0, message_templates_js_1.currentQuotaPeriod)();
            const [settings, accepted, reserved] = await Promise.all([
                tx.messageSettings.findUnique({ where: { organizationId } }),
                tx.messageQueue.aggregate({
                    where: { organizationId, createdAt: { gte: period.start, lt: period.end }, providerMessageId: { not: null }, status: { in: [client_1.MessageStatus.submitted, client_1.MessageStatus.sent, client_1.MessageStatus.delivered, client_1.MessageStatus.failed] } },
                    _sum: { smsCount: true },
                }),
                tx.messageQueue.aggregate({
                    where: { organizationId, createdAt: { gte: period.start, lt: period.end }, status: client_1.MessageStatus.pending, deliveryEnabled: true },
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
            const existingDraft = parsed.data.id ? await tx.announcement.findFirst({ where: { id: parsed.data.id, organizationId, status: client_1.AnnouncementStatus.draft } }) : null;
            if (parsed.data.id && !existingDraft)
                throw new Error("Draft not found or already sent");
            const announcement = existingDraft
                ? await tx.announcement.update({
                    where: { id: existingDraft.id },
                    data: { templateId: parsed.data.templateId || null, message: parsed.data.message, audience: parsed.data.audience, recipientCount: resolved.eligibleCount, estimatedSmsCount: resolved.estimatedSmsCount, sentAt: new Date(), sentByUserId: req.auth.userId, status: client_1.AnnouncementStatus.queued },
                })
                : await tx.announcement.create({
                    data: { organizationId, templateId: parsed.data.templateId || null, message: parsed.data.message, audience: parsed.data.audience, recipientCount: resolved.eligibleCount, estimatedSmsCount: resolved.estimatedSmsCount, sentAt: new Date(), sentByUserId: req.auth.userId, status: client_1.AnnouncementStatus.queued },
                });
            const queueRows = resolved.recipients.map((recipient) => ({
                id: (0, node_crypto_1.randomUUID)(), organizationId, announcementId: announcement.id, recipientPhone: recipient.recipientPhone,
                eventType: client_1.MessageEventType.ANNOUNCEMENT, messageBody: recipient.messageBody, estimatedSmsCount: recipient.estimatedSmsCount,
            }));
            await tx.messageQueue.createMany({ data: queueRows });
            await tx.announcementRecipient.createMany({
                data: resolved.recipients.map((recipient, index) => ({
                    id: (0, node_crypto_1.randomUUID)(), announcementId: announcement.id, organizationId, membershipId: recipient.membershipId,
                    membershipNo: recipient.membershipNo, memberName: recipient.memberName, recipientPhone: recipient.recipientPhone,
                    messageBody: recipient.messageBody, estimatedSmsCount: recipient.estimatedSmsCount, messageQueueId: queueRows[index].id,
                })),
            });
            await (0, audit_log_js_1.writeAuditLog)(tx, {
                organizationId,
                actorUserId: req.auth.userId,
                action: "announcement.queued",
                entityType: "Announcement",
                entityId: announcement.id,
                summary: `Queued announcement for ${resolved.eligibleCount} member(s)`,
                metadata: { recipientCount: resolved.eligibleCount, missingPhoneCount: resolved.missingPhone.length, estimatedSmsCount: resolved.estimatedSmsCount },
            });
            return announcement;
        });
        return res.status(201).json({ ...result, missingPhoneCount: resolved.missingPhone.length });
    }
    catch (error) {
        if (error?.code === "QUOTA_EXCEEDED")
            return res.status(409).json({ error: error.message, code: error.code, quota: error.quota });
        return res.status(400).json({ error: error instanceof Error ? error.message : "Unable to send announcement" });
    }
});
