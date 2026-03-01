"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.announcementsRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const client_1 = require("@prisma/client");
const prisma_js_1 = require("../lib/prisma.js");
const auth_js_1 = require("../middleware/auth.js");
exports.announcementsRouter = (0, express_1.Router)();
exports.announcementsRouter.use(auth_js_1.requireAuth);
exports.announcementsRouter.use(auth_js_1.withOrgScope);
function getOrgId(req) {
    return req.organizationId ?? req.body?.organizationId ?? req.query?.organizationId;
}
const createGroupSchema = zod_1.z.object({
    name: zod_1.z.string().min(1),
    description: zod_1.z.string().optional(),
});
const addMembersSchema = zod_1.z.object({
    personIds: zod_1.z.array(zod_1.z.string()),
});
const sendAnnouncementSchema = zod_1.z.object({
    groupId: zod_1.z.string().optional(),
    message: zod_1.z.string().min(1),
    sendToAll: zod_1.z.boolean().optional(),
});
exports.announcementsRouter.get("/announcement-groups", async (req, res) => {
    const orgId = getOrgId(req);
    if (!orgId && req.auth.role !== "super_user")
        return res.status(400).json({ error: "Organization scope required" });
    const where = {};
    if (orgId)
        where.organizationId = orgId;
    const groups = await prisma_js_1.prisma.announcementGroup.findMany({
        where,
        orderBy: { name: "asc" },
        select: { id: true, name: true, description: true, organizationId: true, createdByUserId: true, createdAt: true },
    });
    return res.json(groups);
});
exports.announcementsRouter.post("/announcement-groups", async (req, res) => {
    const parsed = createGroupSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    const orgId = getOrgId(req);
    if (!orgId && req.auth.role !== "super_user")
        return res.status(400).json({ error: "Organization scope required" });
    if (req.auth.role !== "super_user" && orgId !== req.auth.organizationId)
        return res.status(403).json({ error: "Forbidden" });
    const group = await prisma_js_1.prisma.announcementGroup.create({
        data: {
            organizationId: orgId,
            name: parsed.data.name,
            description: parsed.data.description ?? null,
            createdByUserId: req.auth.userId,
        },
        select: { id: true, name: true, description: true, organizationId: true, createdByUserId: true, createdAt: true },
    });
    return res.status(201).json(group);
});
exports.announcementsRouter.delete("/announcement-groups/:id", async (req, res) => {
    const group = await prisma_js_1.prisma.announcementGroup.findUnique({ where: { id: req.params.id } });
    if (!group)
        return res.status(404).json({ error: "Group not found" });
    if (req.auth.organizationId && group.organizationId !== req.auth.organizationId && req.auth.role !== "super_user")
        return res.status(403).json({ error: "Forbidden" });
    await prisma_js_1.prisma.announcementGroup.delete({ where: { id: req.params.id } });
    return res.status(204).send();
});
exports.announcementsRouter.get("/announcement-groups/:id/members", async (req, res) => {
    const group = await prisma_js_1.prisma.announcementGroup.findUnique({
        where: { id: req.params.id },
        include: { members: { include: { person: true } } },
    });
    if (!group)
        return res.status(404).json({ error: "Group not found" });
    if (req.auth.organizationId && group.organizationId !== req.auth.organizationId && req.auth.role !== "super_user")
        return res.status(403).json({ error: "Forbidden" });
    const members = group.members.map((m) => ({
        id: m.id,
        personId: m.personId,
        person: m.person,
    }));
    return res.json(members);
});
exports.announcementsRouter.post("/announcement-groups/:id/members", async (req, res) => {
    const parsed = addMembersSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    const group = await prisma_js_1.prisma.announcementGroup.findUnique({ where: { id: req.params.id } });
    if (!group)
        return res.status(404).json({ error: "Group not found" });
    if (req.auth.organizationId && group.organizationId !== req.auth.organizationId && req.auth.role !== "super_user")
        return res.status(403).json({ error: "Forbidden" });
    const persons = await prisma_js_1.prisma.person.findMany({
        where: { id: { in: parsed.data.personIds }, organizationId: group.organizationId },
        select: { id: true },
    });
    const validIds = new Set(persons.map((p) => p.id));
    const created = await prisma_js_1.prisma.announcementGroupMember.createMany({
        data: parsed.data.personIds.filter((id) => validIds.has(id)).map((personId) => ({ groupId: group.id, personId })),
        skipDuplicates: true,
    });
    const members = await prisma_js_1.prisma.announcementGroupMember.findMany({
        where: { groupId: group.id },
        include: { person: true },
    });
    return res.status(201).json(members);
});
exports.announcementsRouter.delete("/announcement-groups/:id/members/:personId", async (req, res) => {
    const { id, personId } = req.params;
    const group = await prisma_js_1.prisma.announcementGroup.findUnique({ where: { id } });
    if (!group)
        return res.status(404).json({ error: "Group not found" });
    if (req.auth.organizationId && group.organizationId !== req.auth.organizationId && req.auth.role !== "super_user")
        return res.status(403).json({ error: "Forbidden" });
    const deleted = await prisma_js_1.prisma.announcementGroupMember.deleteMany({ where: { groupId: id, personId } });
    if (deleted.count === 0)
        return res.status(404).json({ error: "Member not found" });
    return res.status(204).send();
});
exports.announcementsRouter.get("/announcements", async (req, res) => {
    const orgId = getOrgId(req);
    if (!orgId && req.auth.role !== "super_user")
        return res.status(400).json({ error: "Organization scope required" });
    const where = {};
    if (orgId)
        where.organizationId = orgId;
    const announcements = await prisma_js_1.prisma.announcement.findMany({
        where,
        orderBy: { createdAt: "desc" },
        include: { group: { select: { id: true, name: true } } },
    });
    return res.json(announcements);
});
exports.announcementsRouter.post("/announcements", async (req, res) => {
    const parsed = sendAnnouncementSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    const orgId = getOrgId(req);
    if (!orgId && req.auth.role !== "super_user")
        return res.status(400).json({ error: "Organization scope required" });
    if (req.auth.organizationId && orgId !== req.auth.organizationId)
        return res.status(403).json({ error: "Forbidden" });
    let recipientPhones = [];
    if (parsed.data.sendToAll) {
        const memberships = await prisma_js_1.prisma.membership.findMany({
            where: { organizationId: orgId },
            select: { hod: { select: { whatsAppNumber: true } } },
        });
        recipientPhones = memberships
            .map((m) => m.hod.whatsAppNumber)
            .filter((n) => !!n && n.trim().length > 0);
    }
    else if (parsed.data.groupId) {
        const members = await prisma_js_1.prisma.announcementGroupMember.findMany({
            where: { groupId: parsed.data.groupId, group: { organizationId: orgId } },
            include: { person: { select: { whatsAppNumber: true } } },
        });
        recipientPhones = members
            .map((m) => m.person.whatsAppNumber)
            .filter((n) => !!n && n.trim().length > 0);
    }
    else {
        return res.status(400).json({ error: "Either groupId or sendToAll is required" });
    }
    recipientPhones = [...new Set(recipientPhones)];
    const orgIdVal = orgId;
    const [announcement] = await prisma_js_1.prisma.$transaction([
        prisma_js_1.prisma.announcement.create({
            data: {
                groupId: parsed.data.groupId ?? null,
                organizationId: orgIdVal,
                message: parsed.data.message,
                sentAt: new Date(),
                sentByUserId: req.auth.userId,
                status: "sent",
            },
        }),
        ...recipientPhones.map((phone) => prisma_js_1.prisma.messageQueue.create({
            data: {
                organizationId: orgIdVal,
                recipientPhone: phone,
                eventType: client_1.MessageEventType.ANNOUNCEMENT,
                messageBody: parsed.data.message,
            },
        })),
    ]);
    return res.status(201).json(announcement);
});
