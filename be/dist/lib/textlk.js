"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TextLkApiError = void 0;
exports.parseMessageStatus = parseMessageStatus;
exports.getTextLkBalance = getTextLkBalance;
exports.getTextLkProfile = getTextLkProfile;
exports.sendTextLkSms = sendTextLkSms;
exports.getTextLkMessage = getTextLkMessage;
const DEFAULT_TEXTLK_API_URL = "https://app.text.lk/api/v3";
class TextLkApiError extends Error {
    statusCode;
    constructor(message, statusCode) {
        super(message);
        this.statusCode = statusCode;
        this.name = "TextLkApiError";
    }
}
exports.TextLkApiError = TextLkApiError;
function apiBaseUrl() {
    return (process.env.TEXTLK_API_URL || DEFAULT_TEXTLK_API_URL).replace(/\/+$/, "");
}
function apiToken() {
    const token = process.env.TEXTLK_API_TOKEN?.trim();
    if (!token)
        throw new TextLkApiError("TEXTLK_API_TOKEN is not configured");
    return token;
}
function asRecord(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}
function nestedData(value) {
    const root = asRecord(value);
    return asRecord(root?.data) ?? root;
}
function firstString(record, keys) {
    for (const key of keys) {
        const value = record?.[key];
        if (typeof value === "string" && value.trim())
            return value;
        if (typeof value === "number")
            return String(value);
    }
    return null;
}
function firstNumber(record, keys) {
    const value = firstString(record, keys);
    if (value === null)
        return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}
async function request(path, init) {
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
    const body = await response.json().catch(() => null);
    const root = asRecord(body);
    const success = response.ok && root?.status !== "error";
    if (!success) {
        const message = firstString(root, ["message", "error"]) || `Text.lk request failed (${response.status})`;
        throw new TextLkApiError(message, response.status);
    }
    return body;
}
function parseMessageStatus(body) {
    const data = nestedData(body);
    return {
        uid: firstString(data, ["uid", "id", "message_id", "messageId"]),
        status: firstString(data, ["status", "delivery_status", "deliveryStatus"]),
        smsCount: firstNumber(data, ["sms_count", "smsCount", "segments"]),
        cost: firstNumber(data, ["cost", "price"]),
        raw: body,
    };
}
async function getTextLkBalance() {
    return request("/balance", { method: "GET" });
}
async function getTextLkProfile() {
    return request("/me", { method: "GET" });
}
async function sendTextLkSms(input) {
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
async function getTextLkMessage(uid) {
    const body = await request(`/sms/${encodeURIComponent(uid)}`, { method: "GET" });
    return parseMessageStatus(body);
}
