import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";

export const bookmarksRouter = Router();

bookmarksRouter.use(requireAuth);

const postBookmarkSchema = z.object({
  actionKey: z.string().min(1),
  displayOrder: z.number().int().optional(),
});

bookmarksRouter.get("/", async (req, res) => {
  const userId = req.auth!.userId;
  const bookmarks = await prisma.userBookmark.findMany({
    where: { userId },
    orderBy: { displayOrder: "asc" },
    select: { id: true, actionKey: true, displayOrder: true, createdAt: true },
  });
  return res.json(bookmarks);
});

bookmarksRouter.post("/", async (req, res) => {
  const parsed = postBookmarkSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
  }
  const userId = req.auth!.userId;
  const existing = await prisma.userBookmark.findUnique({
    where: { userId_actionKey: { userId, actionKey: parsed.data.actionKey } },
  });
  if (existing) {
    return res.status(409).json({ error: "Bookmark already exists" });
  }
  const bookmarkCount = await prisma.userBookmark.count({ where: { userId } });
  if (bookmarkCount >= 6) {
    return res.status(400).json({ error: "You can bookmark up to six quick actions" });
  }
  const bookmark = await prisma.userBookmark.create({
    data: {
      userId,
      actionKey: parsed.data.actionKey,
      displayOrder: parsed.data.displayOrder ?? 0,
    },
    select: { id: true, actionKey: true, displayOrder: true, createdAt: true },
  });
  return res.status(201).json(bookmark);
});

bookmarksRouter.delete("/:actionKey", async (req, res) => {
  const userId = req.auth!.userId;
  const { actionKey } = req.params;
  const deleted = await prisma.userBookmark.deleteMany({
    where: { userId, actionKey },
  });
  if (deleted.count === 0) {
    return res.status(404).json({ error: "Bookmark not found" });
  }
  return res.status(204).send();
});
