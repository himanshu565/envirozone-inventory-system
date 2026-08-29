import type { Request, Response, NextFunction } from "express";
import type { Role } from "@prisma/client";
import { SESSION_COOKIE_NAME, verifySessionToken } from "../lib/session";
import type { SessionPayload } from "../types/auth";

declare global {
  namespace Express {
    interface Request {
      session?: SessionPayload;
    }
  }
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const token = req.cookies?.[SESSION_COOKIE_NAME];
  const session = token ? await verifySessionToken(token) : null;

  if (!session) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  req.session = session;
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.session) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    if (!roles.includes(req.session.role)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    next();
  };
}
