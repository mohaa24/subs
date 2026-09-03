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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authRouter = void 0;
const express_1 = require("express");
const bcrypt = __importStar(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const zod_1 = require("zod");
const prisma_js_1 = require("../lib/prisma.js");
const auth_js_1 = require("../middleware/auth.js");
const permissions_js_1 = require("./permissions.js");
exports.authRouter = (0, express_1.Router)();
const loginSchema = zod_1.z.object({ email: zod_1.z.string().email(), password: zod_1.z.string().min(1) });
exports.authRouter.post("/login", async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    }
    const { email, password } = parsed.data;
    const user = await prisma_js_1.prisma.user.findUnique({
        where: { email: email.toLowerCase() },
        include: { organization: true, organizationRole: { select: { id: true, name: true } } },
    });
    if (!user || !user.isActive || !(await bcrypt.compare(password, user.passwordHash))) {
        return res.status(401).json({ error: "Invalid email or password" });
    }
    if (user.role !== "super_user" && (!user.organization || !user.organization.isActive)) {
        return res.status(403).json({ error: "Organization is inactive" });
    }
    const payload = {
        userId: user.id,
        email: user.email,
        role: user.role,
        organizationId: user.organizationId,
    };
    const secret = process.env.JWT_SECRET || "dev-secret";
    const token = jsonwebtoken_1.default.sign(payload, secret, { expiresIn: "7d" });
    const permissions = await (0, permissions_js_1.getUserPermissions)(user.id);
    return res.json({
        token,
        user: {
            id: user.id,
            email: user.email,
            role: user.role,
            organizationId: user.organizationId,
            isActive: user.isActive,
            permissions,
            organizationRoleId: user.organizationRoleId,
            organizationRole: user.organizationRole,
            organization: user.organization
                ? {
                    id: user.organization.id,
                    name: user.organization.name,
                    slug: user.organization.slug,
                    defaultMembershipFee: Number(user.organization.defaultMembershipFee),
                    isActive: user.organization.isActive,
                }
                : null,
        },
    });
});
exports.authRouter.get("/me", auth_js_1.requireAuth, async (req, res) => {
    const user = await prisma_js_1.prisma.user.findUnique({
        where: { id: req.auth.userId },
        include: { organization: true, organizationRole: { select: { id: true, name: true } } },
    });
    if (!user)
        return res.status(404).json({ error: "User not found" });
    if (!user.isActive)
        return res.status(403).json({ error: "Your user account is inactive" });
    const permissions = await (0, permissions_js_1.getUserPermissions)(user.id);
    return res.json({
        id: user.id,
        email: user.email,
        role: user.role,
        locale: user.locale,
        phoneNumber: user.phoneNumber,
        organizationId: user.organizationId,
        permissions,
        isActive: user.isActive,
        organizationRoleId: user.organizationRoleId,
        organizationRole: user.organizationRole,
        organization: user.organization
            ? {
                id: user.organization.id,
                name: user.organization.name,
                slug: user.organization.slug,
                defaultMembershipFee: Number(user.organization.defaultMembershipFee),
                isActive: user.organization.isActive,
            }
            : null,
    });
});
