import { Router } from "express";
import { z } from "zod";
import { FormType, FieldVisibility } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requireAuth, withOrgScope } from "../middleware/auth.js";
import { enforceRoutePermissions } from "../middleware/route-permissions.js";

export const formConfigRouter = Router();

formConfigRouter.use(requireAuth);
formConfigRouter.use(withOrgScope);
formConfigRouter.use(enforceRoutePermissions((req) => req.method === "GET" ? "VIEW_ORGANIZATION_SETTINGS" : "MANAGE_FORM_SETTINGS"));

function getOrgId(req: any): string | undefined {
  return req.organizationId ?? req.body?.organizationId ?? req.query?.organizationId;
}

const formTypes = Object.values(FormType) as string[];
const visibilityValues = Object.values(FieldVisibility) as string[];

const putFormConfigSchema = z.object({
  formType: z.enum(formTypes as [string, ...string[]]),
  fields: z.array(
    z.object({
      fieldName: z.string().min(1),
      visibility: z.enum(visibilityValues as [string, ...string[]]),
      displayOrder: z.number().int(),
    })
  ),
});

formConfigRouter.get("/", async (req, res) => {
  const orgId = getOrgId(req);
  if (!orgId && req.auth!.role !== "super_user")
    return res.status(400).json({ error: "Organization scope required" });
  const formType = req.query.formType as string | undefined;
  const where: { organizationId?: string; formType?: FormType } = {};
  if (orgId) where.organizationId = orgId;
  if (formType && formTypes.includes(formType)) where.formType = formType as FormType;
  const configs = await prisma.formFieldConfig.findMany({
    where,
    orderBy: [{ formType: "asc" }, { displayOrder: "asc" }],
  });
  return res.json(configs);
});

formConfigRouter.put("/", async (req, res) => {
  const parsed = putFormConfigSchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  const orgId = getOrgId(req);
  if (!orgId && req.auth!.role !== "super_user")
    return res.status(400).json({ error: "Organization scope required" });
  if (req.auth!.role !== "super_user" && orgId !== req.auth!.organizationId)
    return res.status(403).json({ error: "Forbidden" });

  await prisma.$transaction([
    prisma.formFieldConfig.deleteMany({
      where: { organizationId: orgId!, formType: parsed.data.formType as FormType },
    }),
    ...parsed.data.fields.map((f) =>
      prisma.formFieldConfig.create({
        data: {
          organizationId: orgId!,
          formType: parsed.data.formType as FormType,
          fieldName: f.fieldName,
          visibility: f.visibility as FieldVisibility,
          displayOrder: f.displayOrder,
        },
      })
    ),
  ]);

  const configs = await prisma.formFieldConfig.findMany({
    where: { organizationId: orgId!, formType: parsed.data.formType as FormType },
    orderBy: { displayOrder: "asc" },
  });
  return res.json(configs);
});
