"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAuth = requireAuth;
exports.requireRole = requireRole;
exports.requireSuperUser = requireSuperUser;
exports.requireAdmin = requireAdmin;
exports.withOrgScope = withOrgScope;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const client_1 = require("@prisma/client");
function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    try {
        const secret = process.env.JWT_SECRET || "dev-secret";
        const decoded = jsonwebtoken_1.default.verify(token, secret);
        req.auth = decoded;
        next();
    }
    catch {
        return res.status(401).json({ error: "Invalid or expired token" });
    }
}
function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.auth)
            return res.status(401).json({ error: "Unauthorized" });
        if (!roles.includes(req.auth.role)) {
            return res.status(403).json({ error: "Forbidden" });
        }
        next();
    };
}
function requireSuperUser(req, res, next) {
    return requireRole(client_1.UserRole.super_user)(req, res, next);
}
function requireAdmin(req, res, next) {
    return requireRole(client_1.UserRole.super_user, client_1.UserRole.admin)(req, res, next);
}
function withOrgScope(req, _res, next) {
    if (req.auth?.role === client_1.UserRole.super_user) {
        req.organizationId = undefined;
    }
    else if (req.auth?.organizationId) {
        req.organizationId = req.auth.organizationId;
    }
    next();
}
