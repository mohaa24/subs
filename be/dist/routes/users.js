"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.usersRouter = void 0;
const express_1 = require("express");
const bcrypt = __importStar(require("bcryptjs"));
const zod_1 = require("zod");
const prisma_js_1 = require("../lib/prisma.js");
const auth_js_1 = require("../middleware/auth.js");
exports.usersRouter = (0, express_1.Router)();
exports.usersRouter.use(auth_js_1.requireAuth);
exports.usersRouter.use(auth_js_1.withOrgScope);
const createSchema = zod_1.z.object({
    email: zod_1.z.string().trim().email("Enter a valid email address"),
    password: zod_1.z.string().min(6, "Temporary password must contain at least 6 characters"),
    role: zod_1.z.enum(["admin", "user"]).default("user"),
    organizationId: zod_1.z.string().optional(),
    phoneNumber: zod_1.z.string().optional(),
    organizationRoleId: zod_1.z.string().optional().nullable(),
});
const updateUserSchema = zod_1.z.object({
    organizationRoleId: zod_1.z.string().optional().nullable(),
    isActive: zod_1.z.boolean().optional(),
    phoneNumber: zod_1.z.string().optional().nullable(),
});
const updateMeSchema = zod_1.z.object({
    locale: zod_1.z.enum(["en", "ta", "si"]).optional(),
    phoneNumber: zod_1.z.string().optional().nullable(),
});
exports.usersRouter.get("/", auth_js_1.requireAdmin, async (req, res) => {
    const orgId = req.auth.role === "super_user" ? (req.organizationId ?? req.query.organizationId) : req.auth.organizationId;
    const list = await prisma_js_1.prisma.user.findMany({
        where: orgId ? { organizationId: orgId } : {},
        select: {
            id: true, email: true, role: true, organizationId: true, phoneNumber: true, locale: true, isActive: true, organizationRoleId: true,
            createdAt: true, organization: { select: { id: true, name: true, slug: true } },
            organizationRole: { select: { id: true, name: true, permissions: { select: { permission: true } } } },
        },
    });
    return res.json(list);
});
exports.usersRouter.patch("/me", async (req, res) => {
    const parsed = updateMeSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    }
    const data = {};
    if (parsed.data.locale !== undefined)
        data.locale = parsed.data.locale;
    if (parsed.data.phoneNumber !== undefined)
        data.phoneNumber = parsed.data.phoneNumber;
    const user = await prisma_js_1.prisma.user.update({
        where: { id: req.auth.userId },
        data,
        select: { id: true, email: true, role: true, locale: true, phoneNumber: true },
    });
    return res.json(user);
});
exports.usersRouter.post("/", auth_js_1.requireAdmin, async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Check the user details and try again", details: parsed.error.flatten() });
    }
    const isSuper = req.auth.role === "super_user";
    if (!isSuper && parsed.data.role !== "user")
        return res.status(403).json({ error: "Organisation administrators can only create role-based users" });
    const orgId = parsed.data.organizationId ?? (isSuper ? req.organizationId : req.auth.organizationId);
    if (!orgId)
        return res.status(400).json({ error: "organizationId required" });
    // Schema restricts role to admin|user; super_user cannot be created via this endpoint
    const normalizedEmail = parsed.data.email.toLowerCase();
    const existing = await prisma_js_1.prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing)
        return res.status(409).json({ error: "Email already in use" });
    const passwordHash = await bcrypt.hash(parsed.data.password, 10);
    if (parsed.data.role === "user" && !parsed.data.organizationRoleId)
        return res.status(400).json({ error: "Select a role for this user" });
    if (parsed.data.role === "user" && parsed.data.organizationRoleId) {
        const assignedRole = await prisma_js_1.prisma.organizationRole.findFirst({ where: { id: parsed.data.organizationRoleId, organizationId: orgId } });
        if (!assignedRole)
            return res.status(400).json({ error: "Selected role does not belong to this organisation" });
    }
    const user = await prisma_js_1.prisma.user.create({
        data: {
            email: normalizedEmail,
            passwordHash,
            role: parsed.data.role,
            organizationId: orgId || null,
            phoneNumber: parsed.data.phoneNumber ?? null,
            organizationRoleId: parsed.data.role === "user" ? parsed.data.organizationRoleId ?? null : null,
        },
        select: { id: true, email: true, role: true, organizationId: true, phoneNumber: true, locale: true, isActive: true, organizationRoleId: true, organizationRole: { select: { id: true, name: true } } },
    });
    return res.status(201).json(user);
});
exports.usersRouter.patch("/:id", auth_js_1.requireAdmin, async (req, res) => {
    const parsed = updateUserSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    const orgId = req.auth.role === "super_user" ? req.organizationId : req.auth.organizationId;
    const current = await prisma_js_1.prisma.user.findFirst({ where: { id: req.params.id, ...(orgId ? { organizationId: orgId } : {}) } });
    if (!current || current.role === "super_user")
        return res.status(404).json({ error: "User not found" });
    if (req.auth.role !== "super_user" && current.role !== "user")
        return res.status(403).json({ error: "Organisation administrators can only manage role-based users" });
    if (current.role === "user" && parsed.data.organizationRoleId === null)
        return res.status(400).json({ error: "A role is required for this user" });
    if (parsed.data.organizationRoleId) {
        const assignedRole = await prisma_js_1.prisma.organizationRole.findFirst({ where: { id: parsed.data.organizationRoleId, organizationId: current.organizationId } });
        if (!assignedRole)
            return res.status(400).json({ error: "Selected role does not belong to this organisation" });
    }
    const user = await prisma_js_1.prisma.user.update({
        where: { id: current.id },
        data: parsed.data,
        select: { id: true, email: true, role: true, organizationId: true, phoneNumber: true, locale: true, isActive: true, organizationRoleId: true, organizationRole: { select: { id: true, name: true } } },
    });
    return res.json(user);
});
