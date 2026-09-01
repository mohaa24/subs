"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formConfigRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const client_1 = require("@prisma/client");
const prisma_js_1 = require("../lib/prisma.js");
const auth_js_1 = require("../middleware/auth.js");
const route_permissions_js_1 = require("../middleware/route-permissions.js");
exports.formConfigRouter = (0, express_1.Router)();
exports.formConfigRouter.use(auth_js_1.requireAuth);
exports.formConfigRouter.use(auth_js_1.withOrgScope);
exports.formConfigRouter.use((0, route_permissions_js_1.enforceRoutePermissions)((req) => req.method === "GET" ? "VIEW_ORGANIZATION_SETTINGS" : "MANAGE_FORM_SETTINGS"));
function getOrgId(req) {
    return req.organizationId ?? req.body?.organizationId ?? req.query?.organizationId;
}
const formTypes = Object.values(client_1.FormType);
const visibilityValues = Object.values(client_1.FieldVisibility);
const putFormConfigSchema = zod_1.z.object({
    formType: zod_1.z.enum(formTypes),
    fields: zod_1.z.array(zod_1.z.object({
        fieldName: zod_1.z.string().min(1),
        visibility: zod_1.z.enum(visibilityValues),
        displayOrder: zod_1.z.number().int(),
    })),
});
exports.formConfigRouter.get("/", async (req, res) => {
    const orgId = getOrgId(req);
    if (!orgId && req.auth.role !== "super_user")
        return res.status(400).json({ error: "Organization scope required" });
    const formType = req.query.formType;
    const where = {};
    if (orgId)
        where.organizationId = orgId;
    if (formType && formTypes.includes(formType))
        where.formType = formType;
    const configs = await prisma_js_1.prisma.formFieldConfig.findMany({
        where,
        orderBy: [{ formType: "asc" }, { displayOrder: "asc" }],
    });
    return res.json(configs);
});
exports.formConfigRouter.put("/", async (req, res) => {
    const parsed = putFormConfigSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    const orgId = getOrgId(req);
    if (!orgId && req.auth.role !== "super_user")
        return res.status(400).json({ error: "Organization scope required" });
    if (req.auth.role !== "super_user" && orgId !== req.auth.organizationId)
        return res.status(403).json({ error: "Forbidden" });
    await prisma_js_1.prisma.$transaction([
        prisma_js_1.prisma.formFieldConfig.deleteMany({
            where: { organizationId: orgId, formType: parsed.data.formType },
        }),
        ...parsed.data.fields.map((f) => prisma_js_1.prisma.formFieldConfig.create({
            data: {
                organizationId: orgId,
                formType: parsed.data.formType,
                fieldName: f.fieldName,
                visibility: f.visibility,
                displayOrder: f.displayOrder,
            },
        })),
    ]);
    const configs = await prisma_js_1.prisma.formFieldConfig.findMany({
        where: { organizationId: orgId, formType: parsed.data.formType },
        orderBy: { displayOrder: "asc" },
    });
    return res.json(configs);
});
