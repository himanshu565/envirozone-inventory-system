import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import authRoutes from "./routes/auth.routes";
import usersRoutes from "./routes/users.routes";
import categoriesRoutes from "./routes/categories.routes";
import itemsRoutes from "./routes/items.routes";
import suppliersRoutes from "./routes/suppliers.routes";
import locationsRoutes from "./routes/locations.routes";
import stockRoutes from "./routes/stock.routes";
import purchaseOrdersRoutes from "./routes/purchase-orders.routes";
import organizationRoutes from "./routes/organization.routes";

export const app = express();

app.use(
  cors({
    origin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
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

app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _next: express.NextFunction
  ) => {
    if (err instanceof SyntaxError && "body" in err) {
      res.status(400).json({ error: "Invalid JSON body" });
      return;
    }

    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
);
