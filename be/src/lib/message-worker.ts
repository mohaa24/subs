import { MessageStatus } from "@prisma/client";
import { prisma } from "./prisma.js";
import { getTextLkMessage, sendTextLkSms } from "./textlk.js";
import { currentQuotaPeriod, getMessageUsage } from "./message-templates.js";

const FINAL_DELIVERED = new Set(["delivered"]);
const FINAL_FAILED = new Set(["failed", "rejected", "expired", "undelivered", "cancelled"]);

function normalizedStatus(value: string | null) {
  return value?.trim().toLowerCase() ?? "";
}

function nextPollDate() {
  return new Date(Date.now() + 5 * 60 * 1000);
}

function smsEncoding(message: string): "plain" | "unicode" {
  return /^[\x00-\x7F]*$/.test(message) ? "plain" : "unicode";
}

function estimateSmsSegments(message: string) {
  const unicode = smsEncoding(message) === "unicode";
  const singleLimit = unicode ? 70 : 160;
  const multipartLimit = unicode ? 67 : 153;
  return message.length <= singleLimit ? 1 : Math.ceil(message.length / multipartLimit);
}

export async function processMessageQueueBatch(limit = 25) {
  const senderId = process.env.TEXTLK_SENDER_ID?.trim();
  if (!senderId) throw new Error("TEXTLK_SENDER_ID is not configured");

  const now = new Date();
  const messages = await prisma.messageQueue.findMany({
    where: {
      deliveryEnabled: true,
      OR: [
        { status: MessageStatus.pending, nextAttemptAt: { lte: now } },
        { status: MessageStatus.submitted, nextAttemptAt: { lte: now } },
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
        const usage = await getMessageUsage(message.organizationId, now);
        const estimatedSegments = estimateSmsSegments(message.messageBody);
        if (usage.remaining < estimatedSegments) {
          await prisma.messageQueue.update({
            where: { id: message.id },
            data: {
              nextAttemptAt: currentQuotaPeriod(now).end,
              lastAttemptAt: now,
              lastError: `Monthly SMS quota reached (${usage.used}/${usage.monthlyQuota})`,
            },
          });
          continue;
        }
      }
      const provider = message.providerMessageId
        ? await getTextLkMessage(message.providerMessageId)
        : await sendTextLkSms({
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
        await prisma.messageQueue.update({
          where: { id: message.id },
          data: { ...common, status: MessageStatus.delivered, deliveredAt: now, sentAt: message.sentAt ?? now, nextAttemptAt: null },
        });
        result.delivered++;
      } else if (FINAL_FAILED.has(status)) {
        await prisma.messageQueue.update({
          where: { id: message.id },
          data: { ...common, status: MessageStatus.failed, nextAttemptAt: null },
        });
        result.failed++;
      } else {
        // An accepted request must never be retried as a fresh send merely
        // because an unexpected provider response omitted the UID; doing so
        // could deliver the same SMS twice.
        if (!message.providerMessageId && !provider.uid) {
          await prisma.messageQueue.update({
            where: { id: message.id },
            data: {
              ...common,
              status: MessageStatus.submitted,
              sentAt: message.sentAt ?? now,
              nextAttemptAt: null,
              lastError: "Text.lk accepted the SMS but returned no message UID; manual reconciliation required",
            },
          });
          result.submitted++;
          continue;
        }
        await prisma.messageQueue.update({
          where: { id: message.id },
          data: {
            ...common,
            status: MessageStatus.submitted,
            providerMessageId: message.providerMessageId ?? provider.uid,
            sentAt: message.sentAt ?? now,
            nextAttemptAt: nextPollDate(),
          },
        });
        result.submitted++;
      }
    } catch (error) {
      const attempts = message.attemptCount + 1;
      const permanentFailure = attempts >= 5;
      await prisma.messageQueue.update({
        where: { id: message.id },
        data: {
          status: permanentFailure ? MessageStatus.failed : message.status,
          attemptCount: attempts,
          lastAttemptAt: now,
          nextAttemptAt: permanentFailure ? null : new Date(Date.now() + Math.min(60, attempts * 5) * 60 * 1000),
          lastError: error instanceof Error ? error.message.slice(0, 1000) : "Unknown Text.lk error",
        },
      });
      if (permanentFailure) result.failed++;
    }
  }
  return result;
}

export function startMessageWorker() {
  if (process.env.TEXTLK_MESSAGE_WORKER_ENABLED !== "true") {
    console.log("[Messages] Text.lk worker disabled");
    return;
  }

  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const result = await processMessageQueueBatch();
      if (result.processed) console.log("[Messages] Queue batch processed", result);
    } catch (error) {
      console.error("[Messages] Queue worker failed", error instanceof Error ? error.message : error);
    } finally {
      running = false;
    }
  };

  void run();
  setInterval(run, 60_000);
  console.log("[Messages] Text.lk worker started");
}
