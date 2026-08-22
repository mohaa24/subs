import { MessageEventType, MessageStatus, Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";

type MessageWriter = Pick<
  Prisma.TransactionClient,
  "messageQueue" | "messageTemplate" | "organization"
>;

export type MessageTemplateDefinition = {
  eventType: MessageEventType;
  label: string;
  description: string;
  available: boolean;
  defaultEnabled: boolean;
  defaultBody: string;
  allowedVariables: string[];
};

export const MESSAGE_TEMPLATE_DEFINITIONS: MessageTemplateDefinition[] = [
  {
    eventType: MessageEventType.PAYMENT_RECEIVED,
    label: "Payment received",
    description: "Sent after a due or credit payment is successfully recorded.",
    available: true,
    defaultEnabled: true,
    defaultBody:
      "Dear {{member_name}}, we received Rs. {{amount}} for membership {{membership_no}}. Receipt: {{receipt_number}}. Thank you. - {{organization_name}}",
    allowedVariables: [
      "member_name",
      "amount",
      "membership_no",
      "receipt_number",
      "organization_name",
    ],
  },
  {
    eventType: MessageEventType.DUE_GENERATED,
    label: "Due generated",
    description: "Available for the automatic monthly due-generation job.",
    available: true,
    defaultEnabled: false,
    defaultBody:
      "Dear {{member_name}}, your {{due_type}} due of Rs. {{amount}} for {{period}} has been generated. Member No: {{membership_no}}. - {{organization_name}}",
    allowedVariables: [
      "member_name",
      "due_type",
      "amount",
      "period",
      "membership_no",
      "organization_name",
    ],
  },
  {
    eventType: MessageEventType.PAYMENT_OVERDUE,
    label: "Payment overdue",
    description: "Planned; delivery is disabled until the overdue workflow is reviewed.",
    available: false,
    defaultEnabled: false,
    defaultBody: "Payment for membership {{membership_no}} is overdue.",
    allowedVariables: ["membership_no", "period", "organization_name"],
  },
  {
    eventType: MessageEventType.LATE_FEE_APPLIED,
    label: "Late fee applied",
    description: "Planned; delivery is currently disabled.",
    available: false,
    defaultEnabled: false,
    defaultBody: "A late fee has been applied to membership {{membership_no}}.",
    allowedVariables: ["membership_no", "amount", "organization_name"],
  },
  {
    eventType: MessageEventType.ORG_BILLING_DUE,
    label: "Organization billing due",
    description: "Planned; delivery is currently disabled.",
    available: false,
    defaultEnabled: false,
    defaultBody: "Organization billing is due for {{period}}.",
    allowedVariables: ["period", "organization_name"],
  },
  {
    eventType: MessageEventType.ANNOUNCEMENT,
    label: "Announcements",
    description: "Planned; delivery is currently disabled.",
    available: false,
    defaultEnabled: false,
    defaultBody: "{{message}}",
    allowedVariables: ["message", "organization_name"],
  },
];

export function getTemplateDefinition(eventType: MessageEventType) {
  return MESSAGE_TEMPLATE_DEFINITIONS.find((item) => item.eventType === eventType);
}

export function validateTemplateBody(eventType: MessageEventType, body: string) {
  const definition = getTemplateDefinition(eventType);
  if (!definition) return "Unknown message event";
  if (!body.trim()) return "Template body is required";
  const variables = [...body.matchAll(/{{\s*([a-zA-Z0-9_]+)\s*}}/g)].map((match) => match[1]);
  const invalid = variables.filter((variable) => !definition.allowedVariables.includes(variable));
  return invalid.length ? `Unsupported placeholder: {{${invalid[0]}}}` : null;
}

export function renderMessageTemplate(body: string, variables: Record<string, string | number | null | undefined>) {
  return body.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_match, key: string) => {
    const value = variables[key];
    return value === null || value === undefined ? "" : String(value);
  });
}

function normalizeRecipientPhone(phone: string) {
  const compact = phone.trim().replace(/[\s()-]/g, "");
  if (/^0\d{9}$/.test(compact)) return `+94${compact.slice(1)}`;
  if (/^94\d{9}$/.test(compact)) return `+${compact}`;
  return compact;
}

export async function queueTemplatedMessage(
  tx: MessageWriter,
  input: {
    organizationId: string;
    recipientPhone: string;
    eventType: MessageEventType;
    variables: Record<string, string | number | null | undefined>;
  }
) {
  if (!input.recipientPhone.trim()) return null;
  const definition = getTemplateDefinition(input.eventType);
  if (!definition?.available) return null;

  const [template, organization] = await Promise.all([
    tx.messageTemplate.findUnique({
      where: {
        organizationId_eventType: {
          organizationId: input.organizationId,
          eventType: input.eventType,
        },
      },
    }),
    tx.organization.findUnique({
      where: { id: input.organizationId },
      select: { name: true },
    }),
  ]);
  const enabled = template?.enabled ?? definition.defaultEnabled;
  if (!enabled) return null;

  const body = renderMessageTemplate(template?.body ?? definition.defaultBody, {
    ...input.variables,
    organization_name: organization?.name ?? "",
  }).trim();
  if (!body) return null;

  return tx.messageQueue.create({
    data: {
      organizationId: input.organizationId,
      recipientPhone: normalizeRecipientPhone(input.recipientPhone),
      eventType: input.eventType,
      messageBody: body,
      deliveryEnabled: true,
    },
  });
}

export function currentQuotaPeriod(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start, end, label: start.toISOString().slice(0, 7) };
}

export async function getMessageUsage(organizationId: string, now = new Date()) {
  const period = currentQuotaPeriod(now);
  const [settings, accepted, queued] = await Promise.all([
    prisma.messageSettings.findUnique({ where: { organizationId } }),
    prisma.messageQueue.aggregate({
      where: {
        organizationId,
        createdAt: { gte: period.start, lt: period.end },
        providerMessageId: { not: null },
        status: {
          in: [MessageStatus.submitted, MessageStatus.sent, MessageStatus.delivered, MessageStatus.failed],
        },
      },
      _sum: { smsCount: true },
    }),
    prisma.messageQueue.count({
      where: {
        organizationId,
        createdAt: { gte: period.start, lt: period.end },
        status: MessageStatus.pending,
        deliveryEnabled: true,
      },
    }),
  ]);
  const monthlyQuota = settings?.monthlyQuota ?? 100;
  const used = accepted._sum.smsCount ?? 0;
  return {
    period: period.label,
    monthlyQuota,
    used,
    remaining: Math.max(0, monthlyQuota - used),
    queued,
  };
}
