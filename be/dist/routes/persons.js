"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.personsRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const prisma_js_1 = require("../lib/prisma.js");
const auth_js_1 = require("../middleware/auth.js");
exports.personsRouter = (0, express_1.Router)();
exports.personsRouter.use(auth_js_1.requireAuth);
exports.personsRouter.use(auth_js_1.withOrgScope);
const maritalStatuses = ["single", "married", "widower", "widow"];
const residentTypes = [
    "ResidentSinceBirth",
    "ResidentByMarriage",
    "BusinessResidency",
    "EmploymentResidency",
    "EducationalResidency",
    "FamilyMemberOfResident",
    "NonResidentPerson",
];
const livingStatuses = ["Active", "Deceased", "PermanentlyRelocated"];
const titles = ["Mr", "Master", "Miss", "Mrs", "Ms", "Dr"];
const identityTypes = ["NIC", "Passport", "DrivingLicense"];
const bloodGroups = ["A_pos", "A_neg", "B_pos", "B_neg", "AB_pos", "AB_neg", "O_pos", "O_neg"];
const highestQualTypes = ["O/L", "A/L", "Degree", "Masters", "Phd", "Diploma", "None", "In School"];
const permanentDisabilityOptions = [
    "No disability",
    "Physical disability, problem walking or moving",
    "Vision problem, difficulty seeing",
    "Hearing problem, difficulty hearing",
    "Mental health problem",
    "Long-term illness",
    "More than one disability",
    "Other",
];
const createSchema = zod_1.z.object({
    organizationId: zod_1.z.string().optional(),
    title: zod_1.z.enum(titles),
    nameWithInitials: zod_1.z.string().min(1),
    fullName: zod_1.z.string().min(1),
    preferredName: zod_1.z.string().optional(),
    residentType: zod_1.z.enum(residentTypes),
    gender: zod_1.z.string().min(1),
    identityType: zod_1.z.enum(identityTypes).optional(),
    nicNumber: zod_1.z.string().optional().nullable(),
    idNumber: zod_1.z.string().optional().nullable(),
    dateOfBirth: zod_1.z.string().min(1),
    bloodGroup: zod_1.z.enum(bloodGroups).optional(),
    maritalStatus: zod_1.z.enum(maritalStatuses),
    address: zod_1.z.string().min(1),
    mobileNumber: zod_1.z.string().optional(),
    whatsAppNumber: zod_1.z.string().optional(),
    email: zod_1.z.string().email().optional().or(zod_1.z.literal("")),
    occupation: zod_1.z.string().optional(),
    placeOfWork: zod_1.z.string().optional(),
    highestQualificationType: zod_1.z.enum(highestQualTypes).optional(),
    highestQualificationTitle: zod_1.z.string().optional(),
    permanentDisability: zod_1.z.enum(permanentDisabilityOptions).optional(),
    livingStatus: zod_1.z.enum(livingStatuses).optional(),
    isMadarasaStudent: zod_1.z.boolean().optional(),
});
const updateSchema = createSchema.partial();
function getOrgId(req) {
    const orgId = req.organizationId ?? req.body?.organizationId ?? req.query?.organizationId;
    return orgId;
}
exports.personsRouter.get("/", async (req, res) => {
    const orgId = getOrgId(req);
    if (!orgId && req.auth.role !== "super_user")
        return res.status(400).json({ error: "Organization scope required" });
    const q = req.query.q?.trim() || "";
    const page = Math.max(1, parseInt(String(req.query.page), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit), 10) || 10));
    const includeArchived = req.query.includeArchived === "true";
    const where = {};
    if (orgId)
        where.organizationId = orgId;
    if (!includeArchived)
        where.isArchived = false;
    if (q) {
        where.OR = [
            { fullName: { contains: q, mode: "insensitive" } },
            { preferredName: { contains: q, mode: "insensitive" } },
            { nicNumber: { contains: q, mode: "insensitive" } },
            { nameWithInitials: { contains: q, mode: "insensitive" } },
            { email: { contains: q, mode: "insensitive" } },
            { mobileNumber: { contains: q, mode: "insensitive" } },
        ];
    }
    const [items, total] = await Promise.all([
        prisma_js_1.prisma.person.findMany({
            where,
            skip: (page - 1) * limit,
            take: limit,
            orderBy: { fullName: "asc" },
        }),
        prisma_js_1.prisma.person.count({ where }),
    ]);
    return res.json({ items, total, page, limit });
});
exports.personsRouter.get("/:id", async (req, res) => {
    const person = await prisma_js_1.prisma.person.findFirst({
        where: { id: req.params.id },
    });
    if (!person)
        return res.status(404).json({ error: "Person not found" });
    const orgId = getOrgId(req);
    if (orgId && person.organizationId !== orgId && req.auth.role !== "super_user") {
        return res.status(403).json({ error: "Forbidden" });
    }
    return res.json(person);
});
exports.personsRouter.post("/", async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    }
    const orgId = parsed.data.organizationId ?? req.organizationId ?? req.auth?.organizationId;
    if (!orgId)
        return res.status(400).json({ error: "organizationId required" });
    if (req.auth.role !== "super_user" && orgId !== req.auth.organizationId) {
        return res.status(403).json({ error: "Forbidden" });
    }
    const { organizationId: _oid, dateOfBirth: dob, email, ...rest } = parsed.data;
    const person = await prisma_js_1.prisma.person.create({
        data: {
            ...rest,
            organizationId: orgId,
            email: email === "" ? undefined : email,
            dateOfBirth: dob ? new Date(dob) : undefined,
        },
    });
    return res.status(201).json(person);
});
exports.personsRouter.patch("/:id", async (req, res) => {
    const existing = await prisma_js_1.prisma.person.findUnique({ where: { id: req.params.id } });
    if (!existing)
        return res.status(404).json({ error: "Person not found" });
    if (req.auth.organizationId && existing.organizationId !== req.auth.organizationId && req.auth.role !== "super_user") {
        return res.status(403).json({ error: "Forbidden" });
    }
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    }
    const data = { ...parsed.data };
    if (data.dateOfBirth !== undefined)
        data.dateOfBirth = data.dateOfBirth ? new Date(data.dateOfBirth) : null;
    if (data.email === "")
        data.email = null;
    delete data.organizationId;
    const person = await prisma_js_1.prisma.person.update({
        where: { id: req.params.id },
        data,
    });
    return res.json(person);
});
exports.personsRouter.patch("/:id/archive", async (req, res) => {
    const person = await prisma_js_1.prisma.person.findFirst({ where: { id: req.params.id } });
    if (!person)
        return res.status(404).json({ error: "Person not found" });
    const orgId = getOrgId(req);
    if (orgId && person.organizationId !== orgId && req.auth.role !== "super_user") {
        return res.status(403).json({ error: "Forbidden" });
    }
    const isArchived = req.body.isArchived === true;
    const updated = await prisma_js_1.prisma.person.update({
        where: { id: req.params.id },
        data: { isArchived },
    });
    return res.json(updated);
});
