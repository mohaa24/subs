import { createSign } from "crypto";
import { readFileSync } from "fs";
import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";

export const qzRouter = Router();

qzRouter.use(requireAuth);

const qzSignSchema = z.object({
  request: z.string().min(1),
});

function normalizePemValue(value: string): string {
  return value.includes("\\n") ? value.replace(/\\n/g, "\n") : value;
}

function readPemFromEnv(inlineEnvKey: string, pathEnvKey: string): string | null {
  const inlineValue = process.env[inlineEnvKey]?.trim();
  if (inlineValue) {
    return normalizePemValue(inlineValue);
  }

  const filePath = process.env[pathEnvKey]?.trim();
  if (filePath) {
    return readFileSync(filePath, "utf8");
  }

  return null;
}

function getQzCertificate(): string | null {
  return readPemFromEnv("QZ_TRAY_CERTIFICATE", "QZ_TRAY_CERTIFICATE_PATH");
}

function getQzPrivateKey(): string | null {
  return readPemFromEnv("QZ_TRAY_PRIVATE_KEY", "QZ_TRAY_PRIVATE_KEY_PATH");
}

qzRouter.get("/certificate", (_req, res) => {
  const certificate = getQzCertificate();
  if (!certificate) {
    return res.status(404).json({ error: "QZ Tray certificate is not configured." });
  }

  return res.type("text/plain").send(certificate);
});

qzRouter.post("/sign", (req, res) => {
  const parsed = qzSignSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  }

  const privateKey = getQzPrivateKey();
  if (!privateKey) {
    return res.status(404).json({ error: "QZ Tray private key is not configured." });
  }

  try {
    const signer = createSign("RSA-SHA512");
    signer.update(parsed.data.request, "utf8");
    signer.end();

    const signature = signer.sign(privateKey, "base64");
    return res.type("text/plain").send(signature);
  } catch {
    return res.status(500).json({ error: "Failed to sign QZ Tray request." });
  }
});
