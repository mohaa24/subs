import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env") });

import express from "express";
import cors from "cors";
import { authRouter } from "./routes/auth.js";
import { organizationsRouter } from "./routes/organizations.js";
import { usersRouter } from "./routes/users.js";
import { personsRouter } from "./routes/persons.js";
import { membershipsRouter } from "./routes/memberships.js";
import { paymentsRouter } from "./routes/payments.js";
import { dashboardRouter } from "./routes/dashboard.js";

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors({ 
  origin: process.env.FE_ORIGIN || ["http://localhost:3000", "http://localhost:3001"], 
  credentials: true 
}));
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/auth", authRouter);
app.use("/organizations", organizationsRouter);
app.use("/users", usersRouter);
app.use("/persons", personsRouter);
app.use("/memberships", membershipsRouter);
app.use("/payments", paymentsRouter);
app.use("/dashboard", dashboardRouter);

app.listen(PORT, () => console.log(`BE running on http://localhost:${PORT}`));
