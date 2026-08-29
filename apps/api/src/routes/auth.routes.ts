import { Router } from "express";
import { prisma } from "../lib/db";
import { verifyPassword } from "../lib/password";
import {
  SESSION_COOKIE_NAME,
  SESSION_DURATION_SECONDS,
  createSessionToken,
} from "../lib/session";
import { requireAuth } from "../middleware/auth.middleware";

const router = Router();

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};

router.post("/login", async (req, res) => {
  const email =
    typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";

  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required" });
    return;
  }

  const user = await prisma.user.findUnique({ where: { email } });

  // Same error for "no such user" and "wrong password" so a login attempt
  // can't be used to discover which emails have accounts.
  if (!user || !(await verifyPassword(password, user.password))) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const token = await createSessionToken({
    userId: user.id,
    email: user.email,
    role: user.role,
  });

  res.cookie(SESSION_COOKIE_NAME, token, {
    ...cookieOptions,
    maxAge: SESSION_DURATION_SECONDS * 1000,
  });

  res.json({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  });
});

router.post("/logout", (_req, res) => {
  res.clearCookie(SESSION_COOKIE_NAME, cookieOptions);
  res.json({ ok: true });
});

router.get("/me", requireAuth, (req, res) => {
  res.json(req.session);
});

export default router;
