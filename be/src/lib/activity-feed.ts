import { ActivityFeedActorType, ActivityFeedEntryType, Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";

type FeedTarget = {
  organizationId: string;
  personId?: string;
  membershipId?: string;
};

function buildTargetWhere(target: FeedTarget): Prisma.ActivityFeedItemWhereInput {
  if (target.personId) {
    return { organizationId: target.organizationId, personId: target.personId };
  }
  if (target.membershipId) {
    return { organizationId: target.organizationId, membershipId: target.membershipId };
  }
  throw new Error("Exactly one target id is required");
}

export async function listActivityFeedItems(
  target: FeedTarget,
  page: number,
  limit: number
) {
  const where = buildTargetWhere(target);
  const [items, total] = await Promise.all([
    prisma.activityFeedItem.findMany({
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
    prisma.activityFeedItem.count({ where }),
  ]);
  return { items, total, page, limit };
}

export async function createRemarkActivityFeedItem(
  target: FeedTarget,
  createdByUserId: string | null,
  body: string,
  metadata?: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | null
) {
  buildTargetWhere(target);
  return prisma.activityFeedItem.create({
    data: {
      organizationId: target.organizationId,
      personId: target.personId ?? null,
      membershipId: target.membershipId ?? null,
      entryType: ActivityFeedEntryType.remark,
      actorType: createdByUserId ? ActivityFeedActorType.user : ActivityFeedActorType.system,
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
