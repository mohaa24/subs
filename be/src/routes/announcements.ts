import { Router } from "express";
import { z } from "zod";
import { MessageEventType } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requireAuth, withOrgScope } from "../middleware/auth.js";

export const announcementsRouter = Router();

announcementsRouter.use(requireAuth);
announcementsRouter.use(withOrgScope);

function getOrgId(req: any): string | undefined {
  return req.organizationId ?? req.body?.organizationId ?? req.query?.organizationId;
}

const createGroupSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
});

const addMembersSchema = z.object({
  personIds: z.array(z.string()),
});

const sendAnnouncementSchema = z.object({
  groupId: z.string().optional(),
  message: z.string().min(1),
  sendToAll: z.boolean().optional(),
});

announcementsRouter.get("/announcement-groups", async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId && req.auth!.role !== "super_user")
    return res.status(400).json({ error: "Organization scope required" });
  const where: { organizationId?: string } = {};
  if (orgId) where.organizationId = orgId;
  const groups = await prisma.announcementGroup.findMany({
    where,
    orderBy: { name: "asc" },
    select: { id: true, name: true, description: true, organizationId: true, createdByUserId: true, createdAt: true },
  });
  return res.json(groups);
});

announcementsRouter.post("/announcement-groups", async (req, res) => {
  const parsed = createGroupSchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  const orgId = getOrgId(req);
  if (!orgId && req.auth!.role !== "super_user")
    return res.status(400).json({ error: "Organization scope required" });
  if (req.auth!.role !== "super_user" && orgId !== req.auth!.organizationId)
    return res.status(403).json({ error: "Forbidden" });
  const group = await prisma.announcementGroup.create({
    data: {
      organizationId: orgId!,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      createdByUserId: req.auth!.userId,
    },
    select: { id: true, name: true, description: true, organizationId: true, createdByUserId: true, createdAt: true },
  });
  return res.status(201).json(group);
});

announcementsRouter.delete("/announcement-groups/:id", async (req, res) => {
  const group = await prisma.announcementGroup.findUnique({ where: { id: req.params.id } });
  if (!group) return res.status(404).json({ error: "Group not found" });
  if (req.auth!.organizationId && group.organizationId !== req.auth!.organizationId && req.auth!.role !== "super_user")
    return res.status(403).json({ error: "Forbidden" });
  await prisma.announcementGroup.delete({ where: { id: req.params.id } });
  return res.status(204).send();
});

announcementsRouter.get("/announcement-groups/:id/members", async (req, res) => {
  const group = await prisma.announcementGroup.findUnique({
    where: { id: req.params.id },
    include: { members: { include: { person: true } } },
  });
  if (!group) return res.status(404).json({ error: "Group not found" });
  if (req.auth!.organizationId && group.organizationId !== req.auth!.organizationId && req.auth!.role !== "super_user")
    return res.status(403).json({ error: "Forbidden" });
  const members = group.members.map((m) => ({
    id: m.id,
    personId: m.personId,
    person: m.person,
  }));
  return res.json(members);
});

announcementsRouter.post("/announcement-groups/:id/members", async (req, res) => {
  const parsed = addMembersSchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  const group = await prisma.announcementGroup.findUnique({ where: { id: req.params.id } });
  if (!group) return res.status(404).json({ error: "Group not found" });
  if (req.auth!.organizationId && group.organizationId !== req.auth!.organizationId && req.auth!.role !== "super_user")
    return res.status(403).json({ error: "Forbidden" });
  const persons = await prisma.person.findMany({
    where: { id: { in: parsed.data.personIds }, organizationId: group.organizationId },
    select: { id: true },
  });
  const validIds = new Set(persons.map((p) => p.id));
  const created = await prisma.announcementGroupMember.createMany({
    data: parsed.data.personIds.filter((id) => validIds.has(id)).map((personId) => ({ groupId: group.id, personId })),
    skipDuplicates: true,
  });
  const members = await prisma.announcementGroupMember.findMany({
    where: { groupId: group.id },
    include: { person: true },
  });
  return res.status(201).json(members);
});

announcementsRouter.delete("/announcement-groups/:id/members/:personId", async (req, res) => {
  const { id, personId } = req.params;
  const group = await prisma.announcementGroup.findUnique({ where: { id } });
  if (!group) return res.status(404).json({ error: "Group not found" });
  if (req.auth!.organizationId && group.organizationId !== req.auth!.organizationId && req.auth!.role !== "super_user")
    return res.status(403).json({ error: "Forbidden" });
  const deleted = await prisma.announcementGroupMember.deleteMany({ where: { groupId: id, personId } });
  if (deleted.count === 0) return res.status(404).json({ error: "Member not found" });
  return res.status(204).send();
});

announcementsRouter.get("/announcements", async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId && req.auth!.role !== "super_user")
    return res.status(400).json({ error: "Organization scope required" });
  const where: { organizationId?: string } = {};
  if (orgId) where.organizationId = orgId;
  const announcements = await prisma.announcement.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: { group: { select: { id: true, name: true } } },
  });
  return res.json(announcements);
});

announcementsRouter.post("/announcements", async (req, res) => {
  const parsed = sendAnnouncementSchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  const orgId = getOrgId(req);
  if (!orgId && req.auth!.role !== "super_user")
    return res.status(400).json({ error: "Organization scope required" });
  if (req.auth!.organizationId && orgId !== req.auth!.organizationId)
    return res.status(403).json({ error: "Forbidden" });

  let recipientPhones: string[] = [];

  if (parsed.data.sendToAll) {
    const memberships = await prisma.membership.findMany({
      where: { organizationId: orgId },
      select: { hod: { select: { whatsAppNumber: true } } },
    });
    recipientPhones = memberships
      .map((m) => m.hod.whatsAppNumber)
      .filter((n): n is string => !!n && n.trim().length > 0);
  } else if (parsed.data.groupId) {
    const members = await prisma.announcementGroupMember.findMany({
      where: { groupId: parsed.data.groupId, group: { organizationId: orgId } },
      include: { person: { select: { whatsAppNumber: true } } },
    });
    recipientPhones = members
      .map((m) => m.person.whatsAppNumber)
      .filter((n): n is string => !!n && n.trim().length > 0);
  } else {
    return res.status(400).json({ error: "Either groupId or sendToAll is required" });
  }

  recipientPhones = [...new Set(recipientPhones)];

  const orgIdVal = orgId!;
  const [announcement] = await prisma.$transaction([
    prisma.announcement.create({
      data: {
        groupId: parsed.data.groupId ?? null,
        organizationId: orgIdVal,
        message: parsed.data.message,
        sentAt: new Date(),
        sentByUserId: req.auth!.userId,
        status: "sent",
      },
    }),
    ...recipientPhones.map((phone) =>
      prisma.messageQueue.create({
        data: {
          organizationId: orgIdVal,
          recipientPhone: phone,
          eventType: MessageEventType.ANNOUNCEMENT,
          messageBody: parsed.data.message,
        },
      })
    ),
  ]);

  return res.status(201).json(announcement);
});
