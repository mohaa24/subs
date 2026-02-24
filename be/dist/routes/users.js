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
const createSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
    password: zod_1.z.string().min(6),
    role: zod_1.z.enum(["admin", "user"]),
    organizationId: zod_1.z.string().optional(),
});
exports.usersRouter.get("/", auth_js_1.requireAdmin, async (req, res) => {
    const orgId = req.auth.role === "super_user" ? req.query.organizationId : req.auth.organizationId;
    const list = await prisma_js_1.prisma.user.findMany({
        where: orgId ? { organizationId: orgId } : {},
        select: { id: true, email: true, role: true, organizationId: true, createdAt: true, organization: { select: { id: true, name: true, slug: true } } },
    });
    return res.json(list);
});
exports.usersRouter.post("/", auth_js_1.requireAdmin, async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    }
    const isSuper = req.auth.role === "super_user";
    const orgId = parsed.data.organizationId ?? (isSuper ? undefined : req.auth.organizationId);
    if (!orgId)
        return res.status(400).json({ error: "organizationId required" });
    // Schema restricts role to admin|user; super_user cannot be created via this endpoint
    const existing = await prisma_js_1.prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
    if (existing)
        return res.status(409).json({ error: "Email already in use" });
    const passwordHash = await bcrypt.hash(parsed.data.password, 10);
    const user = await prisma_js_1.prisma.user.create({
        data: {
            email: parsed.data.email.toLowerCase(),
            passwordHash,
            role: parsed.data.role,
            organizationId: orgId || null,
        },
        select: { id: true, email: true, role: true, organizationId: true },
    });
    return res.status(201).json(user);
});
