import { Router, Request } from "express";
import { z } from "zod";
import { MaritalStatus, ResidentType, LivingStatus, PersonTitle, IdentityType, BloodGroup, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requireAuth, withOrgScope } from "../middleware/auth.js";

export const personsRouter = Router();

personsRouter.use(requireAuth);
personsRouter.use(withOrgScope);

const maritalStatuses: MaritalStatus[] = ["single", "married", "widower", "widow"];
const residentTypes: ResidentType[] = [
  "ResidentSinceBirth",
  "ResidentByMarriage",
  "BusinessResidency",
  "EmploymentResidency",
  "EducationalResidency",
  "FamilyMemberOfResident",
  "NonResidentPerson",
];
const livingStatuses: LivingStatus[] = ["Active", "Deceased", "PermanentlyRelocated"];
const titles: PersonTitle[] = ["Mr", "Master", "Miss", "Mrs", "Ms", "Dr"];
const identityTypes: IdentityType[] = ["NIC", "Passport", "DrivingLicense"];
const bloodGroups: BloodGroup[] = ["A_pos", "A_neg", "B_pos", "B_neg", "AB_pos", "AB_neg", "O_pos", "O_neg"];
const highestQualTypes = ["O/L", "A/L", "Degree", "Masters", "Phd", "Diploma", "None", "In School"] as const;
const permanentDisabilityOptions = [
  "No disability",
  "Physical disability, problem walking or moving",
  "Vision problem, difficulty seeing",
  "Hearing problem, difficulty hearing",
  "Mental health problem",
  "Long-term illness",
  "More than one disability",
  "Other",
] as const;
const maxZoneCode = 9;

const createSchema = z.object({
  organizationId: z.string().optional(),
  title: z.enum(titles as unknown as [string, ...string[]]).optional(),
  nameWithInitials: z.string().optional(),
  fullName: z.string().optional(),
  preferredName: z.string().optional(),
  residentType: z.enum(residentTypes as unknown as [string, ...string[]]).optional(),
  gender: z.string().optional(),
  identityType: z.enum(identityTypes as unknown as [string, ...string[]]).optional(),
  nicNumber: z.string().optional().nullable(),
  idNumber: z.string().optional().nullable(),
  dateOfBirth: z.string().optional(),
  bloodGroup: z.enum(bloodGroups as unknown as [string, ...string[]]).optional(),
  maritalStatus: z.enum(maritalStatuses as unknown as [string, ...string[]]).optional(),
  address: z.string().optional(),
  areaCode: z.number().int().min(1).max(maxZoneCode).optional().nullable(),
  mobileNumber: z.string().optional(),
  whatsAppNumber: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  occupation: z.string().optional(),
  placeOfWork: z.string().optional(),
  highestQualificationType: z.enum(highestQualTypes).optional(),
  highestQualificationTitle: z.string().optional(),
  schoolName: z.string().optional(),
  permanentDisability: z.enum(permanentDisabilityOptions).optional(),
  livingStatus: z.enum(livingStatuses as unknown as [string, ...string[]]).optional(),
  isMadarasaStudent: z.boolean().optional(),
});

const updateSchema = createSchema.partial();

function getOrgId(req: Request & { organizationId?: string }) {
  const orgId = (req as Request & { organizationId?: string }).organizationId ?? req.body?.organizationId ?? req.query?.organizationId;
  return orgId as string | undefined;
}

personsRouter.get("/", async (req, res) => {
  const orgId = getOrgId(req as Request & { organizationId?: string });
  if (!orgId && req.auth!.role !== "super_user") return res.status(400).json({ error: "Organization scope required" });
  const q = (req.query.q as string)?.trim() || "";
  const page = Math.max(1, parseInt(String(req.query.page), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit), 10) || 10));
  const includeArchived = req.query.includeArchived === "true";
  const residentType = (req.query.residentType as string)?.trim() || "";
  const livingStatus = (req.query.livingStatus as string)?.trim() || "";
  const areaCode = Number.parseInt(String(req.query.areaCode ?? ""), 10);
  const isMadarasaStudent = (req.query.isMadarasaStudent as string)?.trim() || "";
  const hasMembership = (req.query.hasMembership as string)?.trim() || "";
  const sort = (req.query.sort as string)?.trim() || "recent";
  const where: Prisma.PersonWhereInput = {};
  if (orgId) where.organizationId = orgId;
  if (!includeArchived) where.isArchived = false;
  if (residentType && residentTypes.includes(residentType as ResidentType)) {
    where.residentType = residentType as ResidentType;
  }
  if (livingStatus && livingStatuses.includes(livingStatus as LivingStatus)) {
    where.livingStatus = livingStatus as LivingStatus;
  }
  if (Number.isInteger(areaCode) && areaCode > 0 && areaCode <= maxZoneCode) where.areaCode = areaCode;
  if (isMadarasaStudent === "true") where.isMadarasaStudent = true;
  if (isMadarasaStudent === "false") where.isMadarasaStudent = false;
  if (hasMembership === "true") where.membershipId = { not: null };
  if (hasMembership === "false") where.membershipId = null;
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
  const orderBy: Prisma.PersonOrderByWithRelationInput =
    sort === "name_asc"
      ? { nameWithInitials: "asc" }
      : sort === "name_desc"
        ? { nameWithInitials: "desc" }
        : sort === "oldest"
          ? { createdAt: "asc" }
          : { createdAt: "desc" };
  const [items, total] = await Promise.all([
    prisma.person.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy,
    }),
    prisma.person.count({ where }),
  ]);
  return res.json({ items, total, page, limit });
});

personsRouter.get("/:id", async (req, res) => {
  const person = await prisma.person.findFirst({
    where: { id: req.params.id },
  });
  if (!person) return res.status(404).json({ error: "Person not found" });
  const orgId = getOrgId(req as Request & { organizationId?: string });
  if (orgId && person.organizationId !== orgId && req.auth!.role !== "super_user") {
    return res.status(403).json({ error: "Forbidden" });
  }
  return res.json(person);
});

personsRouter.post("/", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  }
  const orgId = parsed.data.organizationId ?? (req as Request & { organizationId?: string }).organizationId ?? (req as any).auth?.organizationId;
  if (!orgId) return res.status(400).json({ error: "organizationId required" });
  if (req.auth!.role !== "super_user" && orgId !== req.auth!.organizationId) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const configuredFields = await prisma.formFieldConfig.findMany({
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
  const inactiveConditionalFields = new Set<string>([
    ...(!parsed.data.identityType || (age !== null && age < 16)
      ? ["nicNumber", "idNumber"]
      : parsed.data.identityType === "NIC" ? ["idNumber"] : ["nicNumber"]),
    ...((age !== null && age < 16) ? ["occupation", "placeOfWork"] : []),
  ]);
  const missing = requiredFields.filter((field) => {
    if (configuredMap.get(field) === "Hidden" || inactiveConditionalFields.has(field)) return false;
    const value = (parsed.data as Record<string, unknown>)[field];
    return value === undefined || value === null || (typeof value === "string" && !value.trim());
  });
  if (missing.length) return res.status(400).json({ error: `Required fields missing: ${missing.join(", ")}` });
  const { organizationId: _oid, dateOfBirth: dob, email, ...rest } = parsed.data;
  const fallbackName = parsed.data.fullName?.trim() || parsed.data.nameWithInitials?.trim() || "Unnamed Person";
  const person = await prisma.person.create({
    data: {
      ...rest,
      nameWithInitials: parsed.data.nameWithInitials?.trim() || fallbackName,
      fullName: parsed.data.fullName?.trim() || fallbackName,
      organizationId: orgId,
      email: email === "" ? undefined : email,
      dateOfBirth: dob ? new Date(dob) : undefined,
    } as any,
  });
  return res.status(201).json(person);
});

personsRouter.patch("/:id", async (req, res) => {
  const existing = await prisma.person.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Person not found" });
  if (req.auth!.organizationId && existing.organizationId !== req.auth!.organizationId && req.auth!.role !== "super_user") {
    return res.status(403).json({ error: "Forbidden" });
  }
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  }
  const data: any = { ...parsed.data };
  if (data.dateOfBirth !== undefined) data.dateOfBirth = data.dateOfBirth ? new Date(data.dateOfBirth) : null;
  if (data.email === "") data.email = null;
  delete data.organizationId;
  const person = await prisma.person.update({
    where: { id: req.params.id },
    data,
  });
  return res.json(person);
});

personsRouter.patch("/:id/archive", async (req, res) => {
  const person = await prisma.person.findFirst({ where: { id: req.params.id } });
  if (!person) return res.status(404).json({ error: "Person not found" });
  const orgId = getOrgId(req as Request & { organizationId?: string });
  if (orgId && person.organizationId !== orgId && req.auth!.role !== "super_user") {
    return res.status(403).json({ error: "Forbidden" });
  }
  const isArchived = req.body.isArchived === true;
  const updated = await prisma.person.update({
    where: { id: req.params.id },
    data: { isArchived },
  });
  return res.json(updated);
});
