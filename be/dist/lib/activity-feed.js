"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listActivityFeedItems = listActivityFeedItems;
exports.createRemarkActivityFeedItem = createRemarkActivityFeedItem;
const client_1 = require("@prisma/client");
const prisma_js_1 = require("./prisma.js");
function buildTargetWhere(target) {
    if (target.personId) {
        return { organizationId: target.organizationId, personId: target.personId };
    }
    if (target.membershipId) {
        return { organizationId: target.organizationId, membershipId: target.membershipId };
    }
    throw new Error("Exactly one target id is required");
}
async function listActivityFeedItems(target, page, limit) {
    const where = buildTargetWhere(target);
    const [items, total] = await Promise.all([
        prisma_js_1.prisma.activityFeedItem.findMany({
            where,
            skip: (page - 1) * limit,
            take: limit,
            orderBy: { createdAt: "desc" },
            include: {
                createdBy: {
                    select: {
                        id: true,
                        email: true,
                    },
                },
            },
        }),
        prisma_js_1.prisma.activityFeedItem.count({ where }),
    ]);
    return { items, total, page, limit };
}
async function createRemarkActivityFeedItem(target, createdByUserId, body, metadata) {
    buildTargetWhere(target);
    return prisma_js_1.prisma.activityFeedItem.create({
        data: {
            organizationId: target.organizationId,
            personId: target.personId ?? null,
            membershipId: target.membershipId ?? null,
            entryType: client_1.ActivityFeedEntryType.remark,
            actorType: createdByUserId ? client_1.ActivityFeedActorType.user : client_1.ActivityFeedActorType.system,
            body,
            metadata: metadata ?? undefined,
            createdByUserId: createdByUserId ?? undefined,
        },
        include: {
            createdBy: {
                select: {
                    id: true,
                    email: true,
                },
            },
        },
    });
}
