"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = require("dotenv");
const path_1 = require("path");
const fs_1 = require("fs");
(0, dotenv_1.config)({ path: (0, path_1.resolve)(process.cwd(), ".env") });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const auth_js_1 = require("./routes/auth.js");
const auth_reset_js_1 = require("./routes/auth-reset.js");
const organizations_js_1 = require("./routes/organizations.js");
const org_billing_js_1 = require("./routes/org-billing.js");
const users_js_1 = require("./routes/users.js");
const permissions_js_1 = require("./routes/permissions.js");
const persons_js_1 = require("./routes/persons.js");
const memberships_js_1 = require("./routes/memberships.js");
const payments_js_1 = require("./routes/payments.js");
const dashboard_js_1 = require("./routes/dashboard.js");
const bookmarks_js_1 = require("./routes/bookmarks.js");
const announcements_js_1 = require("./routes/announcements.js");
const form_config_js_1 = require("./routes/form-config.js");
const distributions_js_1 = require("./routes/distributions.js");
const reports_js_1 = require("./routes/reports.js");
const messages_js_1 = require("./routes/messages.js");
const zones_js_1 = require("./routes/zones.js");
const due_types_js_1 = require("./routes/due-types.js");
const activity_feed_js_1 = require("./routes/activity-feed.js");
const accounting_js_1 = require("./routes/accounting.js");
const audit_logs_js_1 = require("./routes/audit-logs.js");
const public_membership_export_js_1 = require("./routes/public-membership-export.js");
const qz_js_1 = require("./routes/qz.js");
const cron_js_1 = require("./lib/cron.js");
const app = (0, express_1.default)();
const PORT = process.env.PORT || 4000;
const uploadsDir = process.env.UPLOADS_DIR || (0, path_1.resolve)(process.cwd(), "uploads");
const allowedOrigins = process.env.FE_ORIGIN
    ? process.env.FE_ORIGIN.split(",").map((o) => o.trim())
    : ["http://localhost:3000", "http://localhost:3001"];
app.use((0, cors_1.default)({
    origin: allowedOrigins,
    credentials: true
}));
(0, fs_1.mkdirSync)(uploadsDir, { recursive: true });
app.use("/uploads", express_1.default.static(uploadsDir));
app.use(express_1.default.json());
app.get("/health", (_req, res) => res.json({ ok: true }));
app.use("/auth", auth_js_1.authRouter);
app.use("/auth", auth_reset_js_1.authResetRouter);
app.use("/organizations", organizations_js_1.organizationsRouter);
app.use("/organizations", org_billing_js_1.orgBillingRouter);
app.use("/users", users_js_1.usersRouter);
app.use("/users", permissions_js_1.permissionsRouter);
app.use("/persons", persons_js_1.personsRouter);
app.use("/memberships", memberships_js_1.membershipsRouter);
app.use("/payments", payments_js_1.paymentsRouter);
app.use("/dashboard", dashboard_js_1.dashboardRouter);
app.use("/bookmarks", bookmarks_js_1.bookmarksRouter);
app.use("/", public_membership_export_js_1.publicMembershipExportRouter);
app.use("/", announcements_js_1.announcementsRouter);
app.use("/form-config", form_config_js_1.formConfigRouter);
app.use("/distributions", distributions_js_1.distributionsRouter);
app.use("/reports", reports_js_1.reportsRouter);
app.use("/messages", messages_js_1.messagesRouter);
app.use("/zones", zones_js_1.zonesRouter);
app.use("/due-types", due_types_js_1.dueTypesRouter);
app.use("/accounting", accounting_js_1.accountingRouter);
app.use("/audit-logs", audit_logs_js_1.auditLogsRouter);
app.use("/integrations/qz", qz_js_1.qzRouter);
app.use("/", activity_feed_js_1.activityFeedRouter);
app.listen(PORT, () => {
    console.log(`BE running on http://localhost:${PORT}`);
    (0, cron_js_1.startCronJobs)();
});
