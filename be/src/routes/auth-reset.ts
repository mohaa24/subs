import { Router } from "express";
import * as bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { queueMessage } from "../lib/message-queue.js";
import { MessageEventType } from "@prisma/client";

export const authResetRouter = Router();

const forgotPasswordSchema = z.object({ phoneNumber: z.string().min(1) });
const resetPasswordSchema = z.object({
  phoneNumber: z.string().min(1),
  code: z.string().min(4),
  newPassword: z.string().min(6),
});

// In-memory code store (in production, use Redis or a DB table)
const resetCodes = new Map<string, { code: string; expires: Date }>();

authResetRouter.post("/forgot-password", async (req, res) => {
  const parsed = forgotPasswordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input" });

  const user = await prisma.user.findFirst({
    where: { phoneNumber: parsed.data.phoneNumber },
    include: { organization: true },
  });
  if (!user) return res.json({ message: "If an account exists with this phone number, a reset code has been sent." });

  const code = String(Math.floor(1000 + Math.random() * 9000));
  resetCodes.set(parsed.data.phoneNumber, { code, expires: new Date(Date.now() + 15 * 60 * 1000) });

  // Queue WhatsApp message with the reset code
  if (user.organizationId) {
    await queueMessage(
      user.organizationId,
      parsed.data.phoneNumber,
      MessageEventType.ANNOUNCEMENT, // reusing ANNOUNCEMENT type for now
      `Your password reset code is: ${code}. It expires in 15 minutes.`
    );
  }

  return res.json({ message: "If an account exists with this phone number, a reset code has been sent." });
});

authResetRouter.post("/reset-password", async (req, res) => {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input" });

  const stored = resetCodes.get(parsed.data.phoneNumber);
  if (!stored || stored.code !== parsed.data.code || stored.expires < new Date()) {
    return res.status(400).json({ error: "Invalid or expired reset code" });
  }

  const user = await prisma.user.findFirst({ where: { phoneNumber: parsed.data.phoneNumber } });
  if (!user) return res.status(400).json({ error: "Invalid or expired reset code" });

  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 10);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });

  resetCodes.delete(parsed.data.phoneNumber);
  return res.json({ message: "Password reset successfully" });
});
