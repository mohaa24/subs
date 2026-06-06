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
exports.authResetRouter = void 0;
const express_1 = require("express");
const bcrypt = __importStar(require("bcryptjs"));
const zod_1 = require("zod");
const prisma_js_1 = require("../lib/prisma.js");
const message_queue_js_1 = require("../lib/message-queue.js");
const client_1 = require("@prisma/client");
exports.authResetRouter = (0, express_1.Router)();
const forgotPasswordSchema = zod_1.z.object({ phoneNumber: zod_1.z.string().min(1) });
const resetPasswordSchema = zod_1.z.object({
    phoneNumber: zod_1.z.string().min(1),
    code: zod_1.z.string().min(4),
    newPassword: zod_1.z.string().min(6),
});
// In-memory code store (in production, use Redis or a DB table)
const resetCodes = new Map();
exports.authResetRouter.post("/forgot-password", async (req, res) => {
    const parsed = forgotPasswordSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: "Invalid input" });
    const user = await prisma_js_1.prisma.user.findFirst({
        where: { phoneNumber: parsed.data.phoneNumber },
        include: { organization: true },
    });
    if (!user)
        return res.json({ message: "If an account exists with this phone number, a reset code has been sent." });
    const code = String(Math.floor(1000 + Math.random() * 9000));
    resetCodes.set(parsed.data.phoneNumber, { code, expires: new Date(Date.now() + 15 * 60 * 1000) });
    // Queue WhatsApp message with the reset code
    if (user.organizationId) {
        await (0, message_queue_js_1.queueMessage)(user.organizationId, parsed.data.phoneNumber, client_1.MessageEventType.ANNOUNCEMENT, // reusing ANNOUNCEMENT type for now
        `Your password reset code is: ${code}. It expires in 15 minutes.`);
    }
    return res.json({ message: "If an account exists with this phone number, a reset code has been sent." });
});
exports.authResetRouter.post("/reset-password", async (req, res) => {
    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: "Invalid input" });
    const stored = resetCodes.get(parsed.data.phoneNumber);
    if (!stored || stored.code !== parsed.data.code || stored.expires < new Date()) {
        return res.status(400).json({ error: "Invalid or expired reset code" });
    }
    const user = await prisma_js_1.prisma.user.findFirst({ where: { phoneNumber: parsed.data.phoneNumber } });
    if (!user)
        return res.status(400).json({ error: "Invalid or expired reset code" });
    const passwordHash = await bcrypt.hash(parsed.data.newPassword, 10);
    await prisma_js_1.prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
    resetCodes.delete(parsed.data.phoneNumber);
    return res.json({ message: "Password reset successfully" });
});
