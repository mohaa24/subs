"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bookmarksRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const prisma_js_1 = require("../lib/prisma.js");
const auth_js_1 = require("../middleware/auth.js");
exports.bookmarksRouter = (0, express_1.Router)();
exports.bookmarksRouter.use(auth_js_1.requireAuth);
const postBookmarkSchema = zod_1.z.object({
    actionKey: zod_1.z.string().min(1),
    displayOrder: zod_1.z.number().int().optional(),
});
exports.bookmarksRouter.get("/", async (req, res) => {
    const userId = req.auth.userId;
    const bookmarks = await prisma_js_1.prisma.userBookmark.findMany({
        where: { userId },
        orderBy: { displayOrder: "asc" },
        select: { id: true, actionKey: true, displayOrder: true, createdAt: true },
    });
    return res.json(bookmarks);
});
exports.bookmarksRouter.post("/", async (req, res) => {
    const parsed = postBookmarkSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    }
    const userId = req.auth.userId;
    const existing = await prisma_js_1.prisma.userBookmark.findUnique({
        where: { userId_actionKey: { userId, actionKey: parsed.data.actionKey } },
    });
    if (existing) {
        return res.status(409).json({ error: "Bookmark already exists" });
    }
    const bookmark = await prisma_js_1.prisma.userBookmark.create({
        data: {
            userId,
            actionKey: parsed.data.actionKey,
            displayOrder: parsed.data.displayOrder ?? 0,
        },
        select: { id: true, actionKey: true, displayOrder: true, createdAt: true },
    });
    return res.status(201).json(bookmark);
});
exports.bookmarksRouter.delete("/:actionKey", async (req, res) => {
    const userId = req.auth.userId;
    const { actionKey } = req.params;
    const deleted = await prisma_js_1.prisma.userBookmark.deleteMany({
        where: { userId, actionKey },
    });
    if (deleted.count === 0) {
        return res.status(404).json({ error: "Bookmark not found" });
    }
    return res.status(204).send();
});
