import { config } from "dotenv";
import { resolve } from "path";
import { mkdirSync } from "fs";
config({ path: resolve(process.cwd(), ".env") });

import express from "express";
import cors from "cors";
import { authRouter } from "./routes/auth.js";
import { authResetRouter } from "./routes/auth-reset.js";
import { organizationsRouter } from "./routes/organizations.js";
import { orgBillingRouter } from "./routes/org-billing.js";
import { usersRouter } from "./routes/users.js";
import { permissionsRouter } from "./routes/permissions.js";
import { personsRouter } from "./routes/persons.js";
import { membershipsRouter } from "./routes/memberships.js";
import { paymentsRouter } from "./routes/payments.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { bookmarksRouter } from "./routes/bookmarks.js";
import { announcementsRouter } from "./routes/announcements.js";
import { formConfigRouter } from "./routes/form-config.js";
import { distributionsRouter } from "./routes/distributions.js";
import { reportsRouter } from "./routes/reports.js";
import { messagesRouter } from "./routes/messages.js";
import { zonesRouter } from "./routes/zones.js";
import { dueTypesRouter } from "./routes/due-types.js";
import { activityFeedRouter } from "./routes/activity-feed.js";
import { publicMembershipExportRouter } from "./routes/public-membership-export.js";
import { qzRouter } from "./routes/qz.js";
import { startCronJobs } from "./lib/cron.js";

const app = express();
const PORT = process.env.PORT || 4000;
const uploadsDir = process.env.UPLOADS_DIR || resolve(process.cwd(), "uploads");

const allowedOrigins = process.env.FE_ORIGIN
  ? process.env.FE_ORIGIN.split(",").map((o) => o.trim())
  : ["http://localhost:3000", "http://localhost:3001"];

app.use(cors({ 
  origin: allowedOrigins,
  credentials: true 
}));
mkdirSync(uploadsDir, { recursive: true });
app.use("/uploads", express.static(uploadsDir));
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/auth", authRouter);
app.use("/auth", authResetRouter);
app.use("/organizations", organizationsRouter);
app.use("/organizations", orgBillingRouter);
app.use("/users", usersRouter);
app.use("/users", permissionsRouter);
app.use("/persons", personsRouter);
app.use("/memberships", membershipsRouter);
app.use("/payments", paymentsRouter);
app.use("/dashboard", dashboardRouter);
app.use("/bookmarks", bookmarksRouter);
app.use("/", publicMembershipExportRouter);
app.use("/", announcementsRouter);
app.use("/form-config", formConfigRouter);
app.use("/distributions", distributionsRouter);
app.use("/reports", reportsRouter);
app.use("/messages", messagesRouter);
app.use("/zones", zonesRouter);
app.use("/due-types", dueTypesRouter);
app.use("/integrations/qz", qzRouter);
app.use("/", activityFeedRouter);

app.listen(PORT, () => {
  console.log(`BE running on http://localhost:${PORT}`);
  startCronJobs();
});
