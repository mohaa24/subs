const DEFAULT_TEXTLK_API_URL = "https://app.text.lk/api/v3";

type JsonRecord = Record<string, unknown>;

export type TextLkSendInput = {
  recipient: string;
  senderId: string;
  message: string;
  type?: "plain" | "unicode";
};

export type TextLkMessageStatus = {
  uid: string | null;
  status: string | null;
  smsCount: number | null;
  cost: number | null;
  raw: unknown;
};

export class TextLkApiError extends Error {
  constructor(message: string, public readonly statusCode?: number) {
    super(message);
    this.name = "TextLkApiError";
  }
}

function apiBaseUrl() {
  return (process.env.TEXTLK_API_URL || DEFAULT_TEXTLK_API_URL).replace(/\/+$/, "");
}

function apiToken() {
  const token = process.env.TEXTLK_API_TOKEN?.trim();
  if (!token) throw new TextLkApiError("TEXTLK_API_TOKEN is not configured");
  return token;
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function nestedData(value: unknown) {
  const root = asRecord(value);
  return asRecord(root?.data) ?? root;
}

function firstString(record: JsonRecord | null, keys: string[]) {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number") return String(value);
  }
  return null;
}

function firstNumber(record: JsonRecord | null, keys: string[]) {
  const value = firstString(record, keys);
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function request(path: string, init?: RequestInit) {
  const response = await fetch(`${apiBaseUrl()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiToken()}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...init?.headers,
    },
    signal: AbortSignal.timeout(15_000),
  });

  const body: unknown = await response.json().catch(() => null);
  const root = asRecord(body);
  const success = response.ok && root?.status !== "error";
  if (!success) {
    const message = firstString(root, ["message", "error"]) || `Text.lk request failed (${response.status})`;
    throw new TextLkApiError(message, response.status);
  }
  return body;
}

export function parseMessageStatus(body: unknown): TextLkMessageStatus {
  const data = nestedData(body);
  return {
    uid: firstString(data, ["uid", "id", "message_id", "messageId"]),
    status: firstString(data, ["status", "delivery_status", "deliveryStatus"]),
    smsCount: firstNumber(data, ["sms_count", "smsCount", "segments"]),
    cost: firstNumber(data, ["cost", "price"]),
    raw: body,
  };
}

export async function getTextLkBalance() {
  return request("/balance", { method: "GET" });
}

export async function getTextLkProfile() {
  return request("/me", { method: "GET" });
}

export async function sendTextLkSms(input: TextLkSendInput) {
  const body = await request("/sms/send", {
    method: "POST",
    body: JSON.stringify({
      recipient: input.recipient,
      sender_id: input.senderId,
      type: input.type ?? "plain",
      message: input.message,
    }),
  });
  return parseMessageStatus(body);
}

export async function getTextLkMessage(uid: string) {
  const body = await request(`/sms/${encodeURIComponent(uid)}`, { method: "GET" });
  return parseMessageStatus(body);
}

