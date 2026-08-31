"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MESSAGE_TEMPLATE_DEFINITIONS = void 0;
exports.getTemplateDefinition = getTemplateDefinition;
exports.validateTemplateBody = validateTemplateBody;
exports.renderMessageTemplate = renderMessageTemplate;
exports.normalizeRecipientPhone = normalizeRecipientPhone;
exports.estimateSmsSegments = estimateSmsSegments;
exports.queueTemplatedMessage = queueTemplatedMessage;
exports.currentQuotaPeriod = currentQuotaPeriod;
exports.getMessageUsage = getMessageUsage;
const client_1 = require("@prisma/client");
const prisma_js_1 = require("./prisma.js");
exports.MESSAGE_TEMPLATE_DEFINITIONS = [
    {
        eventType: client_1.MessageEventType.PAYMENT_RECEIVED,
        label: "Payment received",
        description: "Sent after a due or credit payment is successfully recorded.",
        available: true,
        defaultEnabled: true,
        defaultBody: "Dear {{member_name}}, we received Rs. {{amount}} for membership {{membership_no}}. Receipt: {{receipt_number}}. Thank you. - {{organization_name}}",
        allowedVariables: [
            "member_name",
            "amount",
            "membership_no",
            "receipt_number",
            "total_outstanding_due",
            "organization_name",
        ],
    },
    {
        eventType: client_1.MessageEventType.PAYMENT_REMINDER,
        label: "Payment Reminder",
        description: "Sent manually from a member's payment record.",
        available: true,
        defaultEnabled: true,
        defaultBody: "Dear {{member_name}}, your total outstanding due is Rs. {{outstanding_amount}}. Member ID: {{membership_no}}. Please make payment. - {{organization_name}}",
        allowedVariables: [
            "member_name",
            "outstanding_amount",
            "membership_no",
            "organization_name",
        ],
    },
    {
        eventType: client_1.MessageEventType.DUE_GENERATED,
        label: "Due generated",
        description: "Available for the automatic monthly due-generation job.",
        available: true,
        defaultEnabled: false,
        defaultBody: "Dear {{member_name}}, your {{due_type}} due of Rs. {{amount}} for {{period}} has been generated. Total outstanding: Rs. {{total_outstanding_due}}. Member No: {{membership_no}}. - {{organization_name}}",
        allowedVariables: [
            "member_name",
            "due_type",
            "amount",
            "period",
            "total_outstanding_due",
            "membership_no",
            "organization_name",
        ],
    },
    {
        eventType: client_1.MessageEventType.PAYMENT_OVERDUE,
        label: "Payment overdue",
        description: "",
        available: false,
        defaultEnabled: false,
        defaultBody: "Payment for membership {{membership_no}} is overdue.",
        allowedVariables: ["membership_no", "period", "organization_name"],
    },
    {
        eventType: client_1.MessageEventType.LATE_FEE_APPLIED,
        label: "Late fee applied",
        description: "",
        available: false,
        defaultEnabled: false,
        defaultBody: "A late fee has been applied to membership {{membership_no}}.",
        allowedVariables: ["membership_no", "amount", "organization_name"],
    },
    {
        eventType: client_1.MessageEventType.ORG_BILLING_DUE,
        label: "Organization billing due",
        description: "",
        available: false,
        defaultEnabled: false,
        defaultBody: "Organization billing is due for {{period}}.",
        allowedVariables: ["period", "organization_name"],
    },
    {
        eventType: client_1.MessageEventType.ANNOUNCEMENT,
        label: "Announcements",
        description: "",
        available: false,
        defaultEnabled: false,
        defaultBody: "{{message}}",
        allowedVariables: ["message", "organization_name"],
    },
];
function getTemplateDefinition(eventType) {
    return exports.MESSAGE_TEMPLATE_DEFINITIONS.find((item) => item.eventType === eventType);
}
function validateTemplateBody(eventType, body) {
    const definition = getTemplateDefinition(eventType);
    if (!definition)
        return "Unknown message event";
    if (!body.trim())
        return "Template body is required";
    const variables = [...body.matchAll(/{{\s*([a-zA-Z0-9_]+)\s*}}/g)].map((match) => match[1]);
    const invalid = variables.filter((variable) => !definition.allowedVariables.includes(variable));
    return invalid.length ? `Unsupported placeholder: {{${invalid[0]}}}` : null;
}
function renderMessageTemplate(body, variables) {
    return body.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_match, key) => {
        const value = variables[key];
        return value === null || value === undefined ? "" : String(value);
    });
}
function normalizeRecipientPhone(phone) {
    const compact = phone.trim().replace(/[\s()-]/g, "");
    if (/^0\d{9}$/.test(compact))
        return `+94${compact.slice(1)}`;
    if (/^94\d{9}$/.test(compact))
        return `+${compact}`;
    return compact;
}
function estimateSmsSegments(message) {
    const unicode = !/^[\x00-\x7F]*$/.test(message);
    const singleLimit = unicode ? 70 : 160;
    const multipartLimit = unicode ? 67 : 153;
    return message.length <= singleLimit ? 1 : Math.ceil(message.length / multipartLimit);
}
async function queueTemplatedMessage(tx, input) {
    if (!input.recipientPhone.trim())
        return null;
    const definition = getTemplateDefinition(input.eventType);
    if (!definition?.available)
        return null;
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
    if (!enabled)
        return null;
    const body = renderMessageTemplate(template?.body ?? definition.defaultBody, {
        ...input.variables,
        organization_name: organization?.name ?? "",
    }).trim();
    if (!body)
        return null;
    return tx.messageQueue.create({
        data: {
            organizationId: input.organizationId,
            recipientPhone: normalizeRecipientPhone(input.recipientPhone),
            eventType: input.eventType,
            messageBody: body,
            estimatedSmsCount: estimateSmsSegments(body),
            deliveryEnabled: true,
        },
    });
}
function currentQuotaPeriod(now = new Date()) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    return { start, end, label: start.toISOString().slice(0, 7) };
}
async function getMessageUsage(organizationId, now = new Date()) {
    const period = currentQuotaPeriod(now);
    const [settings, accepted, queued, queuedSegments] = await Promise.all([
        prisma_js_1.prisma.messageSettings.findUnique({ where: { organizationId } }),
        prisma_js_1.prisma.messageQueue.aggregate({
            where: {
                organizationId,
                createdAt: { gte: period.start, lt: period.end },
                providerMessageId: { not: null },
                status: {
                    in: [client_1.MessageStatus.submitted, client_1.MessageStatus.sent, client_1.MessageStatus.delivered, client_1.MessageStatus.failed],
                },
            },
            _sum: { smsCount: true },
        }),
        prisma_js_1.prisma.messageQueue.count({
            where: {
                organizationId,
                createdAt: { gte: period.start, lt: period.end },
                status: client_1.MessageStatus.pending,
                deliveryEnabled: true,
            },
        }),
        prisma_js_1.prisma.messageQueue.aggregate({
            where: {
                organizationId,
                createdAt: { gte: period.start, lt: period.end },
                status: client_1.MessageStatus.pending,
                deliveryEnabled: true,
            },
            _sum: { estimatedSmsCount: true },
        }),
    ]);
    const monthlyQuota = settings?.monthlyQuota ?? 100;
    const used = accepted._sum.smsCount ?? 0;
    const reserved = queuedSegments._sum.estimatedSmsCount ?? 0;
    return {
        period: period.label,
        monthlyQuota,
        used,
        reserved,
        remaining: Math.max(0, monthlyQuota - used - reserved),
        queued,
    };
}
