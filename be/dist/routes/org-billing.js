"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.orgBillingRouter = void 0;
const express_1 = require("express");
const prisma_js_1 = require("../lib/prisma.js");
const auth_js_1 = require("../middleware/auth.js");
exports.orgBillingRouter = (0, express_1.Router)();
exports.orgBillingRouter.use(auth_js_1.requireAuth);
exports.orgBillingRouter.get("/:id/billing", auth_js_1.requireSuperUser, async (req, res) => {
    const orgId = req.params.id;
    const billing = await prisma_js_1.prisma.organizationBilling.findMany({
        where: { organizationId: orgId },
        orderBy: { year: "desc" },
        include: { markedBy: { select: { id: true, email: true } } },
    });
    return res.json(billing);
});
exports.orgBillingRouter.patch("/:id/billing/:billingId", auth_js_1.requireSuperUser, async (req, res) => {
    const { billingId } = req.params;
    const existing = await prisma_js_1.prisma.organizationBilling.findUnique({ where: { id: billingId } });
    if (!existing)
        return res.status(404).json({ error: "Billing record not found" });
    const updated = await prisma_js_1.prisma.organizationBilling.update({
        where: { id: billingId },
        data: {
            isPaid: !existing.isPaid,
            paidAt: !existing.isPaid ? new Date() : null,
            markedByUserId: !existing.isPaid ? req.auth.userId : null,
        },
        include: { markedBy: { select: { id: true, email: true } } },
    });
    return res.json(updated);
});
