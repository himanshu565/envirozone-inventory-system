import { Router } from "express";
import type { Role } from "@prisma/client";
import { prisma } from "../lib/db";
import { hashPassword } from "../lib/password";
import { requireAuth, requireRole } from "../middleware/auth.middleware";
import { recordAudit } from "../services/audit.service";

const router = Router();

const ROLES: Role[] = ["ADMIN", "STORE_MANAGER", "ACCOUNTS", "VIEWER"];
const ALLOWED_SORT_FIELDS = ["name", "email", "role", "createdAt"];

router.use(requireAuth, requireRole("ADMIN"));

router.get("/", async (req, res) => {
  const sortBy =
    typeof req.query.sortBy === "string" && ALLOWED_SORT_FIELDS.includes(req.query.sortBy)
      ? req.query.sortBy
      : "createdAt";
  const sortDir = req.query.sortDir === "desc" ? "desc" : "asc";

  const users = await prisma.user.findMany({
    select: { id: true, name: true, email: true, role: true, createdAt: true },
    orderBy: { [sortBy]: sortDir },
  });

  res.json(users);
});

router.post("/", async (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const email =
    typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const role = typeof req.body?.role === "string" ? req.body.role : "";

  if (!name || !email || !password) {
    res.status(400).json({ error: "Name, email and password are required" });
    return;
  }

  if (password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" });
    return;
  }

  if (!ROLES.includes(role as Role)) {
    res.status(400).json({ error: `Role must be one of: ${ROLES.join(", ")}` });
    return;
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    res.status(409).json({ error: "A user with this email already exists" });
    return;
  }

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: { name, email, password: passwordHash, role: role as Role },
  });

  await recordAudit({
    actorId: req.session!.userId,
    action: "user.create",
    entityType: "User",
    entityId: user.id,
    after: { id: user.id, name: user.name, email: user.email, role: user.role },
  });

  res.status(201).json({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  });
});

export default router;
