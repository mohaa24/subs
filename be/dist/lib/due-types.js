"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_DUE_TYPE_DEFINITIONS = void 0;
exports.ensureDefaultDueTypes = ensureDefaultDueTypes;
exports.getDueTypeBySystemKey = getDueTypeBySystemKey;
exports.DEFAULT_DUE_TYPE_DEFINITIONS = [
    { name: "Subscription", systemKey: "subscription", autoAllocate: true, sortOrder: 0 },
    { name: "Shramadana", systemKey: "shramadana", autoAllocate: false, sortOrder: 1 },
    { name: "Mahasabha", systemKey: "mahasabha", autoAllocate: false, sortOrder: 2 },
    { name: "Taraweeh", systemKey: "taraweeh", autoAllocate: true, sortOrder: 3 },
    { name: "Other", systemKey: "other", autoAllocate: false, sortOrder: 4 },
];
async function ensureDefaultDueTypes(tx, organizationId) {
    await tx.dueType.createMany({
        data: exports.DEFAULT_DUE_TYPE_DEFINITIONS.map((dueType) => ({
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
async function getDueTypeBySystemKey(tx, organizationId, systemKey) {
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
