import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./lib/db";
import authRoutes from "./routes/auth.routes";
import usersRoutes from "./routes/users.routes";
import categoriesRoutes from "./routes/categories.routes";
import itemsRoutes from "./routes/items.routes";
import suppliersRoutes from "./routes/suppliers.routes";
import locationsRoutes from "./routes/locations.routes";
import stockRoutes from "./routes/stock.routes";
import purchaseOrdersRoutes from "./routes/purchase-orders.routes";
import organizationRoutes from "./routes/organization.routes";
import auditLogsRoutes from "./routes/audit-logs.routes";

export const app = express();

app.disable("x-powered-by");
app.use(helmet());
app.use((req, res, next) => {
  const requestId = req.header("x-request-id") || randomUUID();
  res.setHeader("x-request-id", requestId);
  res.locals.requestId = requestId;
  next();
});
app.use(
  cors({
    origin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
    credentials: true,
  })
);
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/health/ready", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, checks: { database: "ok" } });
  } catch {
    res.status(503).json({ ok: false, checks: { database: "unavailable" } });
  }
});

app.use("/api/auth", authRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/categories", categoriesRoutes);
app.use("/api/items", itemsRoutes);
app.use("/api/suppliers", suppliersRoutes);
app.use("/api/locations", locationsRoutes);
app.use("/api/stock", stockRoutes);
app.use("/api/purchase-orders", purchaseOrdersRoutes);
app.use("/api/organization", organizationRoutes);
app.use("/api/audit-logs", auditLogsRoutes);

app.use(
  (
    err: unknown,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    if (res.headersSent) {
      next(err);
      return;
    }

    if (err instanceof SyntaxError && "body" in err) {
      res.status(400).json({ error: "Invalid JSON body" });
      return;
    }

    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2002") {
        res.status(409).json({ error: "A record with these values already exists" });
        return;
      }

      if (err.code === "P2025") {
        res.status(404).json({ error: "The requested record was not found" });
        return;
      }
    }

    console.error(
      {
        err,
        method: req.method,
        path: req.originalUrl,
        requestId: res.locals.requestId,
      },
      "Unhandled API error"
    );
    res.status(500).json({ error: "Internal server error" });
  }
);
