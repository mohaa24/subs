import type { Prisma } from "@prisma/client";

export const DEFAULT_DUE_TYPE_DEFINITIONS = [
  { name: "Subscription", systemKey: "subscription", autoAllocate: true, sortOrder: 0 },
  { name: "Shramadana", systemKey: "shramadana", autoAllocate: false, sortOrder: 1 },
  { name: "Mahasabha", systemKey: "mahasabha", autoAllocate: false, sortOrder: 2 },
  { name: "Taraweeh", systemKey: "taraweeh", autoAllocate: true, sortOrder: 3 },
  { name: "Other", systemKey: "other", autoAllocate: false, sortOrder: 4 },
] as const;

export type DueTypeSystemKey = (typeof DEFAULT_DUE_TYPE_DEFINITIONS)[number]["systemKey"];
export type DueTypeTx = Prisma.TransactionClient;

export async function ensureDefaultDueTypes(tx: DueTypeTx, organizationId: string) {
  await tx.dueType.createMany({
    data: DEFAULT_DUE_TYPE_DEFINITIONS.map((dueType) => ({
      organizationId,
      name: dueType.name,
      systemKey: dueType.systemKey,
      autoAllocate: dueType.autoAllocate,
      isActive: true,
      sortOrder: dueType.sortOrder,
    })),
    skipDuplicates: true,
  });
}

export async function getDueTypeBySystemKey(
  tx: DueTypeTx,
  organizationId: string,
  systemKey: DueTypeSystemKey
) {
  await ensureDefaultDueTypes(tx, organizationId);
  const dueType = await tx.dueType.findUnique({
    where: {
      organizationId_systemKey: {
        organizationId,
        systemKey,
      },
    },
  });
  if (!dueType) {
    throw new Error(`Missing due type "${systemKey}" for organization ${organizationId}`);
  }
  return dueType;
}
