import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAdmin, requireAuth, withOrgScope } from "../middleware/auth.js";
import { expandPermissions, PERMISSION_CATALOG, PERMISSION_KEYS } from "../lib/permission-catalog.js";

export const rolesRouter = Router();
rolesRouter.use(requireAuth);
rolesRouter.use(withOrgScope);
rolesRouter.use(requireAdmin);

const roleSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(300).optional().nullable(),
  permissions: z.array(z.string()).default([]),
});

function getOrgId(req: any) {
  return req.organizationId ?? req.body?.organizationId ?? req.query?.organizationId;
}

function validatePermissions(permissions: string[]) {
  return permissions.filter((permission) => !PERMISSION_KEYS.has(permission));
}

rolesRouter.get("/catalog", (_req, res) => res.json(PERMISSION_CATALOG));

rolesRouter.get("/", async (req, res) => {
  const organizationId = getOrgId(req);
  if (!organizationId) return res.status(400).json({ error: "Organization scope required" });
  const roles = await prisma.organizationRole.findMany({
    where: { organizationId },
    include: {
      permissions: { select: { permission: true } },
      _count: { select: { users: true } },
    },
    orderBy: { name: "asc" },
  });
  return res.json(roles.map((role) => ({
    id: role.id,
    name: role.name,
    description: role.description,
    permissions: role.permissions.map((item) => item.permission),
    userCount: role._count.users,
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
  })));
});

rolesRouter.post("/", async (req, res) => {
  const parsed = roleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid role details", details: parsed.error.flatten() });
  const organizationId = getOrgId(req);
  if (!organizationId) return res.status(400).json({ error: "Organization scope required" });
  const invalid = validatePermissions(parsed.data.permissions);
  if (invalid.length) return res.status(400).json({ error: "Invalid permissions", invalid });
  const permissions = expandPermissions(parsed.data.permissions);
  try {
    const role = await prisma.organizationRole.create({
      data: {
        organizationId,
        name: parsed.data.name,
        description: parsed.data.description || null,
        permissions: { create: permissions.map((permission) => ({ permission })) },
      },
      include: { permissions: { select: { permission: true } } },
    });
    return res.status(201).json({ ...role, permissions: role.permissions.map((item) => item.permission), userCount: 0 });
  } catch (error: any) {
    if (error?.code === "P2002") return res.status(409).json({ error: "A role with this name already exists" });
    throw error;
  }
});

rolesRouter.put("/:id", async (req, res) => {
  const parsed = roleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid role details", details: parsed.error.flatten() });
  const organizationId = getOrgId(req);
  const current = await prisma.organizationRole.findFirst({ where: { id: req.params.id, organizationId } });
  if (!current) return res.status(404).json({ error: "Role not found" });
  const invalid = validatePermissions(parsed.data.permissions);
  if (invalid.length) return res.status(400).json({ error: "Invalid permissions", invalid });
  const permissions = expandPermissions(parsed.data.permissions);
  try {
    const role = await prisma.$transaction(async (tx) => {
      await tx.organizationRolePermission.deleteMany({ where: { roleId: current.id } });
      return tx.organizationRole.update({
        where: { id: current.id },
        data: {
          name: parsed.data.name,
          description: parsed.data.description || null,
          permissions: { create: permissions.map((permission) => ({ permission })) },
        },
        include: { permissions: { select: { permission: true } }, _count: { select: { users: true } } },
      });
    });
    return res.json({ ...role, permissions: role.permissions.map((item) => item.permission), userCount: role._count.users });
  } catch (error: any) {
    if (error?.code === "P2002") return res.status(409).json({ error: "A role with this name already exists" });
    throw error;
  }
});

rolesRouter.post("/:id/duplicate", async (req, res) => {
  const organizationId = getOrgId(req);
  const source = await prisma.organizationRole.findFirst({
    where: { id: req.params.id, organizationId },
    include: { permissions: true },
  });
  if (!source) return res.status(404).json({ error: "Role not found" });
  let name = `${source.name} Copy`;
  let suffix = 2;
  while (await prisma.organizationRole.findFirst({ where: { organizationId, name } })) name = `${source.name} Copy ${suffix++}`;
  const role = await prisma.organizationRole.create({
    data: {
      organizationId,
      name,
      description: source.description,
      permissions: { create: source.permissions.map(({ permission }) => ({ permission })) },
    },
    include: { permissions: true },
  });
  return res.status(201).json({ ...role, permissions: role.permissions.map((item) => item.permission), userCount: 0 });
});

rolesRouter.delete("/:id", async (req, res) => {
  const organizationId = getOrgId(req);
  const role = await prisma.organizationRole.findFirst({
    where: { id: req.params.id, organizationId },
    include: { _count: { select: { users: true } } },
  });
  if (!role) return res.status(404).json({ error: "Role not found" });
  if (role._count.users) return res.status(409).json({ error: "Reassign this role's users before deleting it" });
  await prisma.organizationRole.delete({ where: { id: role.id } });
  return res.status(204).send();
});
