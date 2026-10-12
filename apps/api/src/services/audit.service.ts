import { prisma } from "../lib/db";
import type { Prisma } from "@prisma/client";

export type RecordAuditInput = {
  actorId: number | null;
  action: string;
  entityType: string;
  entityId?: number | null;
  before?: Prisma.InputJsonValue | null;
  after?: Prisma.InputJsonValue | null;
};

type AuditDatabase = Pick<typeof prisma, "auditLog">;

export async function recordAudit(
  input: RecordAuditInput,
  database: AuditDatabase = prisma
) {
  return database.auditLog.create({
    data: {
      actorId: input.actorId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      before: input.before ?? undefined,
      after: input.after ?? undefined,
    },
  });
}
