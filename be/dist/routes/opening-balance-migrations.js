"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.openingBalanceMigrationsRouter = void 0;
const express_1 = require("express");
const library_1 = require("@prisma/client/runtime/library");
const zod_1 = require("zod");
const prisma_js_1 = require("../lib/prisma.js");
const accounting_js_1 = require("../lib/accounting.js");
const audit_log_js_1 = require("../lib/audit-log.js");
const auth_js_1 = require("../middleware/auth.js");
exports.openingBalanceMigrationsRouter = (0, express_1.Router)();
exports.openingBalanceMigrationsRouter.use(auth_js_1.requireAuth);
exports.openingBalanceMigrationsRouter.use(auth_js_1.requireSuperUser);
const ZERO = new library_1.Decimal(0);
const BASELINE_KINDS = ["original", "replacement"];
const MEMBER_CREDIT_KEY = accounting_js_1.ACCOUNTING_SYSTEM_KEYS.memberCredit;
const draftLineSchema = zod_1.z.object({
    accountId: zod_1.z.string().min(1),
    verifiedBalance: zod_1.z.union([zod_1.z.string(), zod_1.z.number()]).transform((value, ctx) => {
        try {
            const amount = new library_1.Decimal(value).toDecimalPlaces(2);
            if (!amount.isFinite() || amount.abs().gt(new library_1.Decimal("999999999999.99")))
                throw new Error();
            return amount;
        }
        catch {
            ctx.addIssue({ code: zod_1.z.ZodIssueCode.custom, message: "Invalid balance" });
            return zod_1.z.NEVER;
        }
    }),
});
const draftSchema = zod_1.z.object({
    organizationId: zod_1.z.string().min(1),
    cutoffDate: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    description: zod_1.z.string().trim().min(1).max(1000),
    kind: zod_1.z.enum(["original", "correction", "replacement"]).default("original"),
    parentMigrationId: zod_1.z.string().min(1).optional().nullable(),
    correctionReason: zod_1.z.string().trim().min(1).max(1000).optional().nullable(),
    lines: zod_1.z.array(draftLineSchema).max(1000),
});
const updateDraftSchema = draftSchema.omit({ organizationId: true, kind: true, parentMigrationId: true });
const correctionSchema = zod_1.z.object({ reason: zod_1.z.string().trim().min(1).max(1000) });
const reversalSchema = zod_1.z.object({
    reason: zod_1.z.string().trim().min(1).max(1000),
    createReplacement: zod_1.z.boolean().default(false),
});
function asyncRoute(handler) {
    return (req, res, next) => {
        Promise.resolve(handler(req, res, next)).catch((error) => {
            console.error("[OpeningBalanceMigration] Route error:", error);
            if (!res.headersSent) {
                const statusCode = typeof error?.statusCode === "number" ? error.statusCode : 500;
                res.status(statusCode).json({
                    error: statusCode === 500 ? "Opening balance migration request failed" : error?.message,
                });
                return;
            }
            next(error);
        });
    };
}
function httpError(statusCode, message) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}
function parseCutoffDate(value) {
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
        throw httpError(400, "Cut-off date is invalid");
    }
    const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Colombo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(new Date());
    if (value >= today)
        throw httpError(400, "Cut-off date must be before today");
    return date;
}
function cutoffEnd(date) {
    return new Date(`${date.toISOString().slice(0, 10)}T23:59:59.999Z`);
}
function firstLiveDate(date) {
    const next = new Date(date);
    next.setUTCDate(next.getUTCDate() + 1);
    return next.toISOString().slice(0, 10);
}
function journalDate(date) {
    // Noon UTC remains on the selected calendar date in Sri Lanka and on UTC
    // servers, avoiding a cut-off journal appearing on the following local day.
    return new Date(`${date.toISOString().slice(0, 10)}T12:00:00.000Z`);
}
function decimalNumber(value) {
    return Number((value ?? ZERO).toFixed(2));
}
function referenceType(kind) {
    if (kind === "correction")
        return "opening_balance_correction";
    if (kind === "replacement")
        return "opening_balance_replacement";
    return "opening_balance_migration";
}
function adjustmentFor(account, difference) {
    let adjustmentDebit = ZERO;
    let adjustmentCredit = ZERO;
    if (difference.equals(ZERO))
        return { adjustmentDebit, adjustmentCredit };
    const normalSide = (0, accounting_js_1.accountNormalBalance)(account.accountType);
    const side = difference.gt(ZERO)
        ? normalSide
        : normalSide === "debit"
            ? "credit"
            : "debit";
    const amount = difference.abs().toDecimalPlaces(2);
    if (side === "debit")
        adjustmentDebit = amount;
    else
        adjustmentCredit = amount;
    return { adjustmentDebit, adjustmentCredit };
}
async function assertOrganization(tx, organizationId) {
    const organization = await tx.organization.findUnique({
        where: { id: organizationId },
        select: { id: true, name: true, slug: true, isActive: true },
    });
    if (!organization)
        throw httpError(404, "Organization not found");
    return organization;
}
async function calculateLines(tx, organizationId, cutoffDate, requestedBalances) {
    await (0, accounting_js_1.ensureDefaultAccountingAccounts)(tx, organizationId);
    const balances = await (0, accounting_js_1.accountBalances)(tx, organizationId, cutoffEnd(cutoffDate));
    const eligible = balances.filter((account) => account.isActive && ["asset", "liability", "equity"].includes(account.accountType));
    const generalFund = eligible.find((account) => account.systemKey === accounting_js_1.ACCOUNTING_SYSTEM_KEYS.fundBalance)
        ?? await (0, accounting_js_1.getSystemAccount)(tx, organizationId, accounting_js_1.ACCOUNTING_SYSTEM_KEYS.fundBalance);
    const generalFundBalance = eligible.find((account) => account.id === generalFund.id)?.balance ?? ZERO;
    const lines = [];
    let debitTotal = ZERO;
    let creditTotal = ZERO;
    for (const account of eligible) {
        if (account.id === generalFund.id)
            continue;
        const currentBalance = account.balance.toDecimalPlaces(2);
        const memberCreditLocked = account.systemKey === MEMBER_CREDIT_KEY;
        const verifiedBalance = memberCreditLocked
            ? currentBalance
            : (requestedBalances.get(account.id) ?? currentBalance).toDecimalPlaces(2);
        const adjustment = adjustmentFor(account, verifiedBalance.sub(currentBalance));
        debitTotal = debitTotal.add(adjustment.adjustmentDebit);
        creditTotal = creditTotal.add(adjustment.adjustmentCredit);
        lines.push({
            account,
            currentBalance,
            verifiedBalance,
            ...adjustment,
            isSystemCalculated: false,
            inputLocked: memberCreditLocked,
            lockReason: memberCreditLocked
                ? "Member Credit Liability must be migrated member-by-member so individual credit balances remain correct."
                : null,
        });
    }
    const generalDebit = debitTotal.lt(creditTotal) ? creditTotal.sub(debitTotal) : ZERO;
    const generalCredit = debitTotal.gt(creditTotal) ? debitTotal.sub(creditTotal) : ZERO;
    const calculatedGeneralFundBalance = generalFundBalance.add(generalCredit).sub(generalDebit).toDecimalPlaces(2);
    lines.unshift({
        account: generalFund,
        currentBalance: generalFundBalance.toDecimalPlaces(2),
        verifiedBalance: calculatedGeneralFundBalance,
        adjustmentDebit: generalDebit.toDecimalPlaces(2),
        adjustmentCredit: generalCredit.toDecimalPlaces(2),
        isSystemCalculated: true,
        inputLocked: true,
        lockReason: "Automatically calculated as the balancing entry.",
    });
    return {
        lines,
        totals: {
            debit: debitTotal.add(generalDebit).toDecimalPlaces(2),
            credit: creditTotal.add(generalCredit).toDecimalPlaces(2),
        },
    };
}
function lineCreateData(organizationId, line) {
    return {
        organizationId,
        accountId: line.account.id,
        accountNameSnapshot: line.account.name,
        accountTypeSnapshot: line.account.accountType,
        accountSubtypeSnapshot: line.account.assetSubtype,
        systemKeySnapshot: line.account.systemKey,
        isSystemCalculated: line.isSystemCalculated,
        currentBalance: line.currentBalance,
        verifiedBalance: line.verifiedBalance,
        adjustmentDebit: line.adjustmentDebit,
        adjustmentCredit: line.adjustmentCredit,
    };
}
function serializeCalculatedLine(line) {
    return {
        accountId: line.account.id,
        accountName: line.account.name,
        accountType: line.account.accountType,
        accountSubtype: line.account.assetSubtype,
        systemKey: line.account.systemKey,
        currentBalance: decimalNumber(line.currentBalance),
        verifiedBalance: decimalNumber(line.verifiedBalance),
        adjustmentDebit: decimalNumber(line.adjustmentDebit),
        adjustmentCredit: decimalNumber(line.adjustmentCredit),
        isSystemCalculated: line.isSystemCalculated,
        inputLocked: line.inputLocked,
        lockReason: line.lockReason,
    };
}
function serializeMigration(migration) {
    const debit = migration.lines?.reduce((sum, line) => sum + Number(line.adjustmentDebit), 0) ?? 0;
    const credit = migration.lines?.reduce((sum, line) => sum + Number(line.adjustmentCredit), 0) ?? 0;
    return {
        ...migration,
        cutoffDate: migration.cutoffDate.toISOString().slice(0, 10),
        firstLiveDate: firstLiveDate(migration.cutoffDate),
        createdAt: migration.createdAt.toISOString(),
        updatedAt: migration.updatedAt.toISOString(),
        postedAt: migration.postedAt?.toISOString?.() ?? null,
        reversedAt: migration.reversedAt?.toISOString?.() ?? null,
        totals: { debit: Number(debit.toFixed(2)), credit: Number(credit.toFixed(2)) },
        lines: migration.lines?.map((line) => ({
            id: line.id,
            accountId: line.accountId,
            accountName: line.accountNameSnapshot,
            accountType: line.accountTypeSnapshot,
            accountSubtype: line.accountSubtypeSnapshot,
            systemKey: line.systemKeySnapshot,
            isSystemCalculated: line.isSystemCalculated,
            currentBalance: Number(line.currentBalance),
            verifiedBalance: Number(line.verifiedBalance),
            adjustmentDebit: Number(line.adjustmentDebit),
            adjustmentCredit: Number(line.adjustmentCredit),
            inputLocked: line.isSystemCalculated || line.systemKeySnapshot === MEMBER_CREDIT_KEY,
            lockReason: line.isSystemCalculated
                ? "Automatically calculated as the balancing entry."
                : line.systemKeySnapshot === MEMBER_CREDIT_KEY
                    ? "Member Credit Liability must be migrated member-by-member so individual credit balances remain correct."
                    : null,
        })),
    };
}
const migrationInclude = {
    organization: { select: { id: true, name: true, slug: true } },
    lines: { orderBy: [{ isSystemCalculated: "desc" }, { accountNameSnapshot: "asc" }] },
    createdBy: { select: { id: true, email: true } },
    updatedBy: { select: { id: true, email: true } },
    postedBy: { select: { id: true, email: true } },
    reversedBy: { select: { id: true, email: true } },
    journalEntry: { select: { id: true, entryDate: true } },
    reversalJournalEntry: { select: { id: true, entryDate: true } },
};
async function loadMigration(tx, id) {
    const migration = await tx.openingBalanceMigration.findUnique({ where: { id }, include: migrationInclude });
    if (!migration)
        throw httpError(404, "Opening balance migration not found");
    return migration;
}
async function replaceDraftLines(tx, migrationId, organizationId, lines) {
    await tx.openingBalanceMigrationLine.deleteMany({ where: { migrationId } });
    await tx.openingBalanceMigrationLine.createMany({
        data: lines.map((line) => ({ migrationId, ...lineCreateData(organizationId, line) })),
    });
}
exports.openingBalanceMigrationsRouter.get("/setup", asyncRoute(async (req, res) => {
    const organizationId = typeof req.query.organizationId === "string" ? req.query.organizationId : "";
    if (!organizationId)
        throw httpError(400, "organizationId is required");
    const cutoffText = typeof req.query.cutoffDate === "string"
        ? req.query.cutoffDate
        : new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const cutoffDate = parseCutoffDate(cutoffText);
    const result = await prisma_js_1.prisma.$transaction(async (tx) => {
        const organization = await assertOrganization(tx, organizationId);
        const calculated = await calculateLines(tx, organizationId, cutoffDate, new Map());
        const migrations = await tx.openingBalanceMigration.findMany({
            where: { organizationId },
            include: migrationInclude,
            orderBy: [{ createdAt: "desc" }],
        });
        return { organization, calculated, migrations };
    });
    return res.json({
        organization: result.organization,
        cutoffDate: cutoffText,
        firstLiveDate: firstLiveDate(cutoffDate),
        lines: result.calculated.lines.map(serializeCalculatedLine),
        totals: {
            debit: decimalNumber(result.calculated.totals.debit),
            credit: decimalNumber(result.calculated.totals.credit),
        },
        migrations: result.migrations.map(serializeMigration),
    });
}));
exports.openingBalanceMigrationsRouter.get("/", asyncRoute(async (req, res) => {
    const organizationId = typeof req.query.organizationId === "string" ? req.query.organizationId : "";
    if (!organizationId)
        throw httpError(400, "organizationId is required");
    await prisma_js_1.prisma.$transaction((tx) => assertOrganization(tx, organizationId));
    const migrations = await prisma_js_1.prisma.openingBalanceMigration.findMany({
        where: { organizationId },
        include: migrationInclude,
        orderBy: [{ createdAt: "desc" }],
    });
    return res.json(migrations.map(serializeMigration));
}));
exports.openingBalanceMigrationsRouter.get("/:id", asyncRoute(async (req, res) => {
    const migration = await prisma_js_1.prisma.$transaction((tx) => loadMigration(tx, req.params.id));
    return res.json(serializeMigration(migration));
}));
exports.openingBalanceMigrationsRouter.post("/", asyncRoute(async (req, res) => {
    const parsed = draftSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    const cutoffDate = parseCutoffDate(parsed.data.cutoffDate);
    const requested = new Map(parsed.data.lines.map((line) => [line.accountId, line.verifiedBalance]));
    const migration = await prisma_js_1.prisma.$transaction(async (tx) => {
        await assertOrganization(tx, parsed.data.organizationId);
        if (parsed.data.kind === "original") {
            const existing = await tx.openingBalanceMigration.findFirst({
                where: { organizationId: parsed.data.organizationId, kind: "original" },
                select: { id: true },
            });
            if (existing)
                throw httpError(409, "This organization already has an opening balance migration");
        }
        if (parsed.data.kind !== "original") {
            if (!parsed.data.parentMigrationId)
                throw httpError(400, "A parent migration is required");
            const parent = await tx.openingBalanceMigration.findFirst({
                where: { id: parsed.data.parentMigrationId, organizationId: parsed.data.organizationId },
            });
            if (!parent)
                throw httpError(404, "Parent migration not found");
        }
        const calculated = await calculateLines(tx, parsed.data.organizationId, cutoffDate, requested);
        const created = await tx.openingBalanceMigration.create({
            data: {
                organizationId: parsed.data.organizationId,
                cutoffDate,
                description: parsed.data.description,
                kind: parsed.data.kind,
                parentMigrationId: parsed.data.parentMigrationId ?? null,
                correctionReason: parsed.data.correctionReason ?? null,
                createdByUserId: req.auth.userId,
                updatedByUserId: req.auth.userId,
            },
        });
        await replaceDraftLines(tx, created.id, parsed.data.organizationId, calculated.lines);
        await (0, audit_log_js_1.writeAuditLog)(tx, {
            organizationId: parsed.data.organizationId,
            actorUserId: req.auth.userId,
            action: "finance.opening_balance_draft.created",
            entityType: "opening_balance_migration",
            entityId: created.id,
            summary: `Created ${parsed.data.kind} opening balance draft`,
            metadata: { cutoffDate: parsed.data.cutoffDate, kind: parsed.data.kind },
        });
        return loadMigration(tx, created.id);
    });
    return res.status(201).json(serializeMigration(migration));
}));
exports.openingBalanceMigrationsRouter.patch("/:id", asyncRoute(async (req, res) => {
    const parsed = updateDraftSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    const cutoffDate = parseCutoffDate(parsed.data.cutoffDate);
    const requested = new Map(parsed.data.lines.map((line) => [line.accountId, line.verifiedBalance]));
    const migration = await prisma_js_1.prisma.$transaction(async (tx) => {
        const existing = await loadMigration(tx, req.params.id);
        if (existing.status !== "draft")
            throw httpError(409, "Posted migrations cannot be edited");
        const calculated = await calculateLines(tx, existing.organizationId, cutoffDate, requested);
        await tx.openingBalanceMigration.update({
            where: { id: existing.id },
            data: {
                cutoffDate,
                description: parsed.data.description,
                correctionReason: parsed.data.correctionReason ?? existing.correctionReason,
                updatedByUserId: req.auth.userId,
            },
        });
        await replaceDraftLines(tx, existing.id, existing.organizationId, calculated.lines);
        await (0, audit_log_js_1.writeAuditLog)(tx, {
            organizationId: existing.organizationId,
            actorUserId: req.auth.userId,
            action: "finance.opening_balance_draft.updated",
            entityType: "opening_balance_migration",
            entityId: existing.id,
            summary: `Updated ${existing.kind} opening balance draft`,
            metadata: { cutoffDate: parsed.data.cutoffDate, kind: existing.kind },
        });
        return loadMigration(tx, existing.id);
    });
    return res.json(serializeMigration(migration));
}));
exports.openingBalanceMigrationsRouter.post("/:id/post", asyncRoute(async (req, res) => {
    const migration = await prisma_js_1.prisma.$transaction(async (tx) => {
        const existing = await loadMigration(tx, req.params.id);
        if (existing.status === "posted")
            return existing;
        if (existing.status !== "draft")
            throw httpError(409, "Only draft migrations can be posted");
        if (BASELINE_KINDS.includes(existing.kind)) {
            const activeBaseline = await tx.openingBalanceMigration.findFirst({
                where: {
                    organizationId: existing.organizationId,
                    id: { not: existing.id },
                    kind: { in: BASELINE_KINDS },
                    status: "posted",
                },
            });
            if (activeBaseline)
                throw httpError(409, "This organization already has a posted opening balance baseline");
        }
        else {
            const parent = existing.parentMigrationId
                ? await tx.openingBalanceMigration.findUnique({ where: { id: existing.parentMigrationId } })
                : null;
            if (!parent || parent.organizationId !== existing.organizationId || parent.status !== "posted") {
                throw httpError(409, "Corrections require an active posted migration");
            }
        }
        const requested = new Map(existing.lines.map((line) => [line.accountId, line.verifiedBalance]));
        const calculated = await calculateLines(tx, existing.organizationId, existing.cutoffDate, requested);
        const savedByAccount = new Map(existing.lines.map((line) => [line.accountId, line]));
        const stale = calculated.lines.find((line) => {
            const saved = savedByAccount.get(line.account.id);
            return !saved || !line.currentBalance.equals(saved.currentBalance);
        });
        if (stale) {
            throw httpError(409, `Balances changed after this draft was saved. Refresh the draft before posting (${stale.account.name}).`);
        }
        if (calculated.totals.debit.equals(ZERO))
            throw httpError(400, "There are no balance adjustments to post");
        const entry = await (0, accounting_js_1.createJournalEntry)(tx, {
            organizationId: existing.organizationId,
            entryDate: journalDate(existing.cutoffDate),
            entryType: "opening_balance",
            description: existing.description,
            referenceType: referenceType(existing.kind),
            referenceId: existing.id,
            isSystemEntry: true,
            createdByUserId: req.auth.userId,
            lines: calculated.lines.flatMap((line) => [
                ...(line.adjustmentDebit.gt(ZERO)
                    ? [{ accountId: line.account.id, side: "debit", amount: line.adjustmentDebit, memo: existing.description }]
                    : []),
                ...(line.adjustmentCredit.gt(ZERO)
                    ? [{ accountId: line.account.id, side: "credit", amount: line.adjustmentCredit, memo: existing.description }]
                    : []),
            ]),
        });
        const projectFundLines = calculated.lines.filter((line) => line.account.assetSubtype === "project_fund" &&
            (!line.adjustmentDebit.equals(ZERO) || !line.adjustmentCredit.equals(ZERO)));
        for (const line of projectFundLines) {
            const fund = await tx.fundPot.findFirst({
                where: { organizationId: existing.organizationId, fundAccountId: line.account.id },
                select: { id: true, name: true },
            });
            if (!fund)
                continue;
            await tx.fundTransaction.create({
                data: {
                    organizationId: existing.organizationId,
                    fundPotId: fund.id,
                    transactionType: "opening",
                    amount: line.adjustmentCredit.sub(line.adjustmentDebit),
                    transactionDate: journalDate(existing.cutoffDate),
                    description: `${existing.kind === "correction" ? "Opening balance correction" : "Opening balance migration"}: ${fund.name}`,
                    memo: existing.correctionReason ?? existing.description,
                    journalEntryId: entry.id,
                    createdByUserId: req.auth.userId,
                },
            });
        }
        await replaceDraftLines(tx, existing.id, existing.organizationId, calculated.lines);
        await tx.openingBalanceMigration.update({
            where: { id: existing.id },
            data: {
                status: "posted",
                journalEntryId: entry.id,
                postedAt: new Date(),
                postedByUserId: req.auth.userId,
                updatedByUserId: req.auth.userId,
            },
        });
        await (0, audit_log_js_1.writeAuditLog)(tx, {
            organizationId: existing.organizationId,
            actorUserId: req.auth.userId,
            action: "finance.opening_balance_migration.posted",
            entityType: "opening_balance_migration",
            entityId: existing.id,
            summary: `Posted ${existing.kind} opening balance migration for ${existing.organization.name}`,
            metadata: {
                kind: existing.kind,
                cutoffDate: existing.cutoffDate.toISOString().slice(0, 10),
                journalEntryId: entry.id,
                debitTotal: calculated.totals.debit.toFixed(2),
                creditTotal: calculated.totals.credit.toFixed(2),
            },
        });
        return loadMigration(tx, existing.id);
    }, { isolationLevel: "Serializable" });
    return res.json(serializeMigration(migration));
}));
exports.openingBalanceMigrationsRouter.post("/:id/corrections", asyncRoute(async (req, res) => {
    const parsed = correctionSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    const correction = await prisma_js_1.prisma.$transaction(async (tx) => {
        const parent = await loadMigration(tx, req.params.id);
        if (parent.status !== "posted")
            throw httpError(409, "Only an active posted migration can be corrected");
        const existingDraft = await tx.openingBalanceMigration.findFirst({
            where: { organizationId: parent.organizationId, kind: "correction", status: "draft" },
            include: migrationInclude,
        });
        if (existingDraft)
            return existingDraft;
        const calculated = await calculateLines(tx, parent.organizationId, parent.cutoffDate, new Map());
        const created = await tx.openingBalanceMigration.create({
            data: {
                organizationId: parent.organizationId,
                cutoffDate: parent.cutoffDate,
                description: `Correction: ${parent.description}`,
                kind: "correction",
                parentMigrationId: parent.id,
                correctionReason: parsed.data.reason,
                createdByUserId: req.auth.userId,
                updatedByUserId: req.auth.userId,
            },
        });
        await replaceDraftLines(tx, created.id, parent.organizationId, calculated.lines);
        await (0, audit_log_js_1.writeAuditLog)(tx, {
            organizationId: parent.organizationId,
            actorUserId: req.auth.userId,
            action: "finance.opening_balance_correction.created",
            entityType: "opening_balance_migration",
            entityId: created.id,
            summary: `Created opening balance correction for ${parent.organization.name}`,
            metadata: { parentMigrationId: parent.id, reason: parsed.data.reason },
        });
        return loadMigration(tx, created.id);
    });
    return res.status(201).json(serializeMigration(correction));
}));
exports.openingBalanceMigrationsRouter.post("/:id/reverse", asyncRoute(async (req, res) => {
    const parsed = reversalSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    const result = await prisma_js_1.prisma.$transaction(async (tx) => {
        const existing = await loadMigration(tx, req.params.id);
        if (existing.status === "reversed") {
            return { migration: existing, replacement: null };
        }
        if (existing.status !== "posted" || !existing.journalEntryId) {
            throw httpError(409, "Only a posted migration can be reversed");
        }
        const activeChild = await tx.openingBalanceMigration.findFirst({
            where: { parentMigrationId: existing.id, status: "posted" },
            select: { id: true },
        });
        if (activeChild)
            throw httpError(409, "Reverse later posted corrections before reversing this migration");
        const originalJournal = await tx.accountingJournalEntry.findUnique({
            where: { id: existing.journalEntryId },
            include: { lines: true },
        });
        if (!originalJournal)
            throw httpError(409, "The original migration journal could not be found");
        const reversal = await (0, accounting_js_1.createJournalEntry)(tx, {
            organizationId: existing.organizationId,
            entryDate: journalDate(existing.cutoffDate),
            entryType: "opening_balance",
            description: `Reversal of opening balance migration: ${parsed.data.reason}`,
            referenceType: "opening_balance_reversal",
            referenceId: existing.id,
            isSystemEntry: true,
            createdByUserId: req.auth.userId,
            lines: originalJournal.lines.map((line) => ({
                accountId: line.accountId,
                side: line.side === "debit" ? "credit" : "debit",
                amount: line.amount,
                memo: parsed.data.reason,
            })),
        });
        await tx.fundTransaction.updateMany({
            where: { journalEntryId: originalJournal.id, reversedAt: null },
            data: { reversedAt: new Date(), reversedByUserId: req.auth.userId, reversalReason: parsed.data.reason },
        });
        await tx.openingBalanceMigration.update({
            where: { id: existing.id },
            data: {
                status: "reversed",
                reversalJournalEntryId: reversal.id,
                reversalReason: parsed.data.reason,
                reversedAt: new Date(),
                reversedByUserId: req.auth.userId,
                updatedByUserId: req.auth.userId,
            },
        });
        let replacementId = null;
        if (parsed.data.createReplacement) {
            const calculated = await calculateLines(tx, existing.organizationId, existing.cutoffDate, new Map());
            const replacement = await tx.openingBalanceMigration.create({
                data: {
                    organizationId: existing.organizationId,
                    cutoffDate: existing.cutoffDate,
                    description: existing.description,
                    kind: "replacement",
                    parentMigrationId: existing.id,
                    correctionReason: parsed.data.reason,
                    createdByUserId: req.auth.userId,
                    updatedByUserId: req.auth.userId,
                },
            });
            await replaceDraftLines(tx, replacement.id, existing.organizationId, calculated.lines);
            replacementId = replacement.id;
        }
        await (0, audit_log_js_1.writeAuditLog)(tx, {
            organizationId: existing.organizationId,
            actorUserId: req.auth.userId,
            action: "finance.opening_balance_migration.reversed",
            entityType: "opening_balance_migration",
            entityId: existing.id,
            summary: `Reversed ${existing.kind} opening balance migration for ${existing.organization.name}`,
            metadata: {
                reason: parsed.data.reason,
                originalJournalEntryId: originalJournal.id,
                reversalJournalEntryId: reversal.id,
                replacementMigrationId: replacementId,
            },
        });
        return {
            migration: await loadMigration(tx, existing.id),
            replacement: replacementId ? await loadMigration(tx, replacementId) : null,
        };
    }, { isolationLevel: "Serializable" });
    return res.json({
        migration: serializeMigration(result.migration),
        replacement: result.replacement ? serializeMigration(result.replacement) : null,
    });
}));
