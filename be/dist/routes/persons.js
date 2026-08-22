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
const maxZoneCode = 9;
const createSchema = zod_1.z.object({
    organizationId: zod_1.z.string().optional(),
    title: zod_1.z.enum(titles).optional(),
    nameWithInitials: zod_1.z.string().optional(),
    fullName: zod_1.z.string().optional(),
    preferredName: zod_1.z.string().optional(),
    residentType: zod_1.z.enum(residentTypes).optional(),
    gender: zod_1.z.string().optional(),
    identityType: zod_1.z.enum(identityTypes).optional(),
    nicNumber: zod_1.z.string().optional().nullable(),
    idNumber: zod_1.z.string().optional().nullable(),
    dateOfBirth: zod_1.z.string().optional(),
    bloodGroup: zod_1.z.enum(bloodGroups).optional(),
    maritalStatus: zod_1.z.enum(maritalStatuses).optional(),
    address: zod_1.z.string().optional(),
    areaCode: zod_1.z.number().int().min(1).max(maxZoneCode).optional().nullable(),
    mobileNumber: zod_1.z.string().optional(),
    whatsAppNumber: zod_1.z.string().optional(),
    email: zod_1.z.string().email().optional().or(zod_1.z.literal("")),
    occupation: zod_1.z.string().optional(),
    placeOfWork: zod_1.z.string().optional(),
    highestQualificationType: zod_1.z.enum(highestQualTypes).optional(),
    highestQualificationTitle: zod_1.z.string().optional(),
    schoolName: zod_1.z.string().optional(),
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
    const residentType = req.query.residentType?.trim() || "";
    const livingStatus = req.query.livingStatus?.trim() || "";
    const areaCode = Number.parseInt(String(req.query.areaCode ?? ""), 10);
    const isMadarasaStudent = req.query.isMadarasaStudent?.trim() || "";
    const hasMembership = req.query.hasMembership?.trim() || "";
    const sort = req.query.sort?.trim() || "recent";
    const where = {};
    if (orgId)
        where.organizationId = orgId;
    if (!includeArchived)
        where.isArchived = false;
    if (residentType && residentTypes.includes(residentType)) {
        where.residentType = residentType;
    }
    if (livingStatus && livingStatuses.includes(livingStatus)) {
        where.livingStatus = livingStatus;
    }
    if (Number.isInteger(areaCode) && areaCode > 0 && areaCode <= maxZoneCode)
        where.areaCode = areaCode;
    if (isMadarasaStudent === "true")
        where.isMadarasaStudent = true;
    if (isMadarasaStudent === "false")
        where.isMadarasaStudent = false;
    if (hasMembership === "true")
        where.membershipId = { not: null };
    if (hasMembership === "false")
        where.membershipId = null;
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
    const orderBy = sort === "name_asc"
        ? { nameWithInitials: "asc" }
        : sort === "name_desc"
            ? { nameWithInitials: "desc" }
            : sort === "oldest"
                ? { createdAt: "asc" }
                : { createdAt: "desc" };
    const [items, total] = await Promise.all([
        prisma_js_1.prisma.person.findMany({
            where,
            skip: (page - 1) * limit,
            take: limit,
            orderBy,
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
    const configuredFields = await prisma_js_1.prisma.formFieldConfig.findMany({
        where: { organizationId: orgId, formType: "Person" },
        select: { fieldName: true, visibility: true },
    });
    const configuredMap = new Map(configuredFields.map((field) => [field.fieldName, field.visibility]));
    const defaultRequired = ["title", "nameWithInitials", "fullName", "gender", "dateOfBirth", "maritalStatus", "residentType", "address"];
    const requiredFields = configuredFields.length
        ? configuredFields.filter((field) => field.visibility === "Required").map((field) => field.fieldName)
        : defaultRequired;
    const birthDate = parsed.data.dateOfBirth ? new Date(parsed.data.dateOfBirth) : null;
    const age = birthDate && !Number.isNaN(birthDate.getTime())
        ? Math.floor((Date.now() - birthDate.getTime()) / (365.2425 * 24 * 60 * 60 * 1000))
        : null;
    const inactiveConditionalFields = new Set([
        ...(!parsed.data.identityType || (age !== null && age < 16)
            ? ["nicNumber", "idNumber"]
            : parsed.data.identityType === "NIC" ? ["idNumber"] : ["nicNumber"]),
        ...((age !== null && age < 16) ? ["occupation", "placeOfWork"] : []),
    ]);
    const missing = requiredFields.filter((field) => {
        if (configuredMap.get(field) === "Hidden" || inactiveConditionalFields.has(field))
            return false;
        const value = parsed.data[field];
        return value === undefined || value === null || (typeof value === "string" && !value.trim());
    });
    if (missing.length)
        return res.status(400).json({ error: `Required fields missing: ${missing.join(", ")}` });
    const { organizationId: _oid, dateOfBirth: dob, email, ...rest } = parsed.data;
    const fallbackName = parsed.data.fullName?.trim() || parsed.data.nameWithInitials?.trim() || "Unnamed Person";
    const person = await prisma_js_1.prisma.person.create({
        data: {
            ...rest,
            nameWithInitials: parsed.data.nameWithInitials?.trim() || fallbackName,
            fullName: parsed.data.fullName?.trim() || fallbackName,
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
