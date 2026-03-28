"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.publicMembershipExportRouter = void 0;
const express_1 = require("express");
const prisma_js_1 = require("../lib/prisma.js");
exports.publicMembershipExportRouter = (0, express_1.Router)();
exports.publicMembershipExportRouter.get("/public/memberships/:id/export", async (req, res) => {
    const membership = await prisma_js_1.prisma.membership.findFirst({
        where: { id: req.params.id },
        include: {
            hod: true,
            spouse: true,
            dependents: { orderBy: { order: "asc" }, include: { person: true } },
            organization: { select: { id: true, name: true, slug: true, address: true } },
            createdBy: { select: { id: true, email: true } },
        },
    });
    if (!membership) {
        return res.status(404).json({ error: "Membership not found" });
    }
    const zones = await prisma_js_1.prisma.zone.findMany({
        where: { organizationId: membership.organizationId },
        orderBy: { code: "asc" },
    });
    return res.json({ membership, zones });
});
