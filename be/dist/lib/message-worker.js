"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processMessageQueueBatch = processMessageQueueBatch;
exports.startMessageWorker = startMessageWorker;
const client_1 = require("@prisma/client");
const prisma_js_1 = require("./prisma.js");
const textlk_js_1 = require("./textlk.js");
const message_templates_js_1 = require("./message-templates.js");
const FINAL_DELIVERED = new Set(["delivered"]);
const FINAL_FAILED = new Set(["failed", "rejected", "expired", "undelivered", "cancelled"]);
function normalizedStatus(value) {
    return value?.trim().toLowerCase() ?? "";
}
function nextPollDate() {
    return new Date(Date.now() + 5 * 60 * 1000);
}
function smsEncoding(message) {
    return /^[\x00-\x7F]*$/.test(message) ? "plain" : "unicode";
}
async function processMessageQueueBatch(limit = 25) {
    const senderId = process.env.TEXTLK_SENDER_ID?.trim();
    if (!senderId)
        throw new Error("TEXTLK_SENDER_ID is not configured");
    const now = new Date();
    const messages = await prisma_js_1.prisma.messageQueue.findMany({
        where: {
            deliveryEnabled: true,
            OR: [
                { status: client_1.MessageStatus.pending, nextAttemptAt: { lte: now } },
                { status: client_1.MessageStatus.submitted, nextAttemptAt: { lte: now } },
            ],
        },
        orderBy: { createdAt: "asc" },
        take: Math.min(Math.max(limit, 1), 100),
    });
    const result = { processed: 0, submitted: 0, delivered: 0, failed: 0 };
    for (const message of messages) {
        result.processed++;
        try {
            if (!message.providerMessageId) {
                const usage = await (0, message_templates_js_1.getMessageUsage)(message.organizationId, now);
                const estimatedSegments = message.estimatedSmsCount || (0, message_templates_js_1.estimateSmsSegments)(message.messageBody);
                if (usage.monthlyQuota - usage.used < estimatedSegments) {
                    await prisma_js_1.prisma.messageQueue.update({
                        where: { id: message.id },
                        data: {
                            nextAttemptAt: (0, message_templates_js_1.currentQuotaPeriod)(now).end,
                            lastAttemptAt: now,
                            lastError: `Monthly SMS quota reached (${usage.used}/${usage.monthlyQuota})`,
                        },
                    });
                    continue;
                }
            }
            const provider = message.providerMessageId
                ? await (0, textlk_js_1.getTextLkMessage)(message.providerMessageId)
                : await (0, textlk_js_1.sendTextLkSms)({
                    recipient: message.recipientPhone,
                    senderId,
                    message: message.messageBody,
                    type: smsEncoding(message.messageBody),
                });
            const status = normalizedStatus(provider.status);
            const common = {
                providerStatus: provider.status,
                providerMessageId: message.providerMessageId ?? provider.uid,
                smsCount: provider.smsCount,
                cost: provider.cost,
                lastAttemptAt: now,
                attemptCount: { increment: 1 },
                lastError: null,
            };
            if (FINAL_DELIVERED.has(status)) {
                await prisma_js_1.prisma.messageQueue.update({
                    where: { id: message.id },
                    data: { ...common, status: client_1.MessageStatus.delivered, deliveredAt: now, sentAt: message.sentAt ?? now, nextAttemptAt: null },
                });
                result.delivered++;
            }
            else if (FINAL_FAILED.has(status)) {
                await prisma_js_1.prisma.messageQueue.update({
                    where: { id: message.id },
                    data: { ...common, status: client_1.MessageStatus.failed, nextAttemptAt: null },
                });
                result.failed++;
            }
            else {
                // An accepted request must never be retried as a fresh send merely
                // because an unexpected provider response omitted the UID; doing so
                // could deliver the same SMS twice.
                if (!message.providerMessageId && !provider.uid) {
                    await prisma_js_1.prisma.messageQueue.update({
                        where: { id: message.id },
                        data: {
                            ...common,
                            status: client_1.MessageStatus.submitted,
                            sentAt: message.sentAt ?? now,
                            nextAttemptAt: null,
                            lastError: "Text.lk accepted the SMS but returned no message UID; manual reconciliation required",
                        },
                    });
                    result.submitted++;
                    continue;
                }
                await prisma_js_1.prisma.messageQueue.update({
                    where: { id: message.id },
                    data: {
                        ...common,
                        status: client_1.MessageStatus.submitted,
                        providerMessageId: message.providerMessageId ?? provider.uid,
                        sentAt: message.sentAt ?? now,
                        nextAttemptAt: nextPollDate(),
                    },
                });
                result.submitted++;
            }
        }
        catch (error) {
            const attempts = message.attemptCount + 1;
            const permanentFailure = attempts >= 5;
            await prisma_js_1.prisma.messageQueue.update({
                where: { id: message.id },
                data: {
                    status: permanentFailure ? client_1.MessageStatus.failed : message.status,
                    attemptCount: attempts,
                    lastAttemptAt: now,
                    nextAttemptAt: permanentFailure ? null : new Date(Date.now() + Math.min(60, attempts * 5) * 60 * 1000),
                    lastError: error instanceof Error ? error.message.slice(0, 1000) : "Unknown Text.lk error",
                },
            });
            if (permanentFailure)
                result.failed++;
        }
    }
    return result;
}
function startMessageWorker() {
    if (process.env.TEXTLK_MESSAGE_WORKER_ENABLED !== "true") {
        console.log("[Messages] Text.lk worker disabled");
        return;
    }
    let running = false;
    const run = async () => {
        if (running)
            return;
        running = true;
        try {
            const result = await processMessageQueueBatch();
            if (result.processed)
                console.log("[Messages] Queue batch processed", result);
        }
        catch (error) {
            console.error("[Messages] Queue worker failed", error instanceof Error ? error.message : error);
        }
        finally {
            running = false;
        }
    };
    void run();
    setInterval(run, 60_000);
    console.log("[Messages] Text.lk worker started");
}
