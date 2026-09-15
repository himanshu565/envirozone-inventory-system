import { Router } from "express";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/db";
import { requireAuth, requireRole } from "../middleware/auth.middleware";
import {
  parseListQuery,
  toPrismaPagination,
  toPrismaOrderBy,
  toPaginationMeta,
} from "../lib/list-query";

const router = Router();

const ALLOWED_SORT_FIELDS = ["createdAt", "action", "entityType"];

router.use(requireAuth, requireRole("ADMIN"));

router.get("/", async (req, res) => {
  const query = parseListQuery(
    new URLSearchParams(req.query as Record<string, string>)
  );

  const entityType =
    typeof req.query.entityType === "string" ? req.query.entityType : "";
  const actorId = Number(req.query.actorId);

  const where: Prisma.AuditLogWhereInput = {
    ...(entityType ? { entityType } : {}),
    ...(Number.isInteger(actorId) ? { actorId } : {}),
  };

  const [logs, total, entityTypes] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: { actor: { select: { id: true, name: true, email: true } } },
      ...toPrismaPagination(query),
      orderBy: toPrismaOrderBy(query, ALLOWED_SORT_FIELDS, "createdAt"),
    }),
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      distinct: ["entityType"],
      select: { entityType: true },
      orderBy: { entityType: "asc" },
    }),
  ]);

  res.json({
    data: logs,
    pagination: toPaginationMeta(query, total),
    entityTypes: entityTypes.map((row) => row.entityType),
  });
});

export default router;
