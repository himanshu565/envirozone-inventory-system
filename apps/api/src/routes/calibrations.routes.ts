import { Router } from "express";
import { Prisma, type CalibrationStatus } from "@prisma/client";
import { prisma } from "../lib/db";
import { requireAuth, requireAction } from "../middleware/auth.middleware";
import {
  parseListQuery,
  toPaginationMeta,
  toPrismaOrderBy,
  toPrismaPagination,
} from "../lib/list-query";
import { recordAudit } from "../services/audit.service";

const router = Router();
router.use(requireAuth);

const ALLOWED_SORT_FIELDS = ["calibrationDate", "nextDueDate", "status", "createdAt"];

const CALIBRATION_INCLUDE = {
  asset: {
    select: {
      id: true,
      assetTag: true,
      serialNumber: true,
      status: true,
      item: { select: { id: true, name: true, itemCode: true } },
      currentLocation: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.CalibrationRecordInclude;

function optionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function parseDate(value: unknown): Date | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

// GET /api/calibrations - List calibration records
router.get("/", async (req, res) => {
  const query = parseListQuery(
    new URLSearchParams(req.query as Record<string, string>)
  );
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const assetId = req.query.assetId ? Number(req.query.assetId) : undefined;

  const where: Prisma.CalibrationRecordWhereInput = {
    ...(status ? { status: status as CalibrationStatus } : {}),
    ...(assetId && Number.isInteger(assetId) ? { assetId } : {}),
    ...(query.search
      ? {
          OR: [
            { certificateNumber: { contains: query.search, mode: "insensitive" } },
            { performedBy: { contains: query.search, mode: "insensitive" } },
            { provider: { contains: query.search, mode: "insensitive" } },
            { asset: { assetTag: { contains: query.search, mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  const [records, total] = await Promise.all([
    prisma.calibrationRecord.findMany({
      where,
      include: CALIBRATION_INCLUDE,
      ...toPrismaPagination(query),
      orderBy: toPrismaOrderBy(query, ALLOWED_SORT_FIELDS, "calibrationDate"),
    }),
    prisma.calibrationRecord.count({ where }),
  ]);

  res.json({ data: records, pagination: toPaginationMeta(query, total) });
});

// GET /api/calibrations/due - List assets due or overdue for calibration
router.get("/due", async (_req, res) => {
  const thirtyDaysFromNow = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  // Find latest calibration per asset
  const assets = await prisma.serializedAsset.findMany({
    where: {
      status: { notIn: ["RETIRED", "LOST"] },
    },
    include: {
      item: { select: { id: true, name: true, itemCode: true } },
      currentLocation: { select: { id: true, name: true } },
      calibrationRecords: {
        orderBy: { calibrationDate: "desc" },
        take: 1,
      },
    },
  });

  const dueAssets = assets
    .map((asset) => {
      const latest = asset.calibrationRecords[0];
      const nextDue = latest?.nextDueDate ?? null;
      const isOverdue = nextDue ? new Date(nextDue) < new Date() : false;
      const isDueSoon = nextDue ? new Date(nextDue) <= thirtyDaysFromNow && !isOverdue : false;
      const isUncalibrated = !latest;

      return {
        assetId: asset.id,
        assetTag: asset.assetTag,
        serialNumber: asset.serialNumber,
        status: asset.status,
        itemName: asset.item.name,
        itemCode: asset.item.itemCode,
        locationName: asset.currentLocation?.name ?? "Unassigned",
        lastCalibrated: latest?.calibrationDate ?? null,
        nextDueDate: nextDue,
        latestStatus: latest?.status ?? null,
        isOverdue,
        isDueSoon,
        isUncalibrated,
      };
    })
    .filter((a) => a.isOverdue || a.isDueSoon || a.isUncalibrated);

  res.json(dueAssets);
});

// POST /api/calibrations - Record calibration result
router.post("/", requireAction("manageCalibrations"), async (req, res) => {
  const assetId = Number(req.body?.assetId);
  const status = (req.body?.status ?? "PASSED") as CalibrationStatus;
  const calibrationDate = parseDate(req.body?.calibrationDate) ?? new Date();
  const nextDueDate = parseDate(req.body?.nextDueDate);
  const certificateNumber = optionalString(req.body?.certificateNumber);
  const performedBy = optionalString(req.body?.performedBy);
  const provider = optionalString(req.body?.provider);
  const notes = optionalString(req.body?.notes);

  if (!Number.isInteger(assetId)) {
    res.status(400).json({ error: "Valid asset id is required" });
    return;
  }
  if (!nextDueDate) {
    res.status(400).json({ error: "Next due date is required and must be a valid date" });
    return;
  }
  if (!["PASSED", "FAILED", "CONDITIONAL"].includes(status)) {
    res.status(400).json({ error: "Invalid calibration status" });
    return;
  }

  const asset = await prisma.serializedAsset.findUnique({ where: { id: assetId } });
  if (!asset) {
    res.status(404).json({ error: "Asset not found" });
    return;
  }

  const result = await prisma.$transaction(async (tx) => {
    const record = await tx.calibrationRecord.create({
      data: {
        assetId,
        status,
        calibrationDate,
        nextDueDate,
        certificateNumber,
        performedBy,
        provider,
        notes,
      },
      include: CALIBRATION_INCLUDE,
    });

    // If calibration FAILED, automatically set asset status to QUARANTINED for industrial safety!
    if (status === "FAILED") {
      await tx.serializedAsset.update({
        where: { id: assetId },
        data: { status: "QUARANTINED" },
      });
    } else if (asset.status === "QUARANTINED" && status === "PASSED") {
      // Return back to IN_STOCK if it passed quarantine calibration
      await tx.serializedAsset.update({
        where: { id: assetId },
        data: { status: "IN_STOCK" },
      });
    }

    await recordAudit(
      {
        actorId: req.session!.userId,
        action: "calibration.record",
        entityType: "CalibrationRecord",
        entityId: record.id,
        after: {
          assetId,
          status,
          nextDueDate,
          certificateNumber,
          quarantined: status === "FAILED",
        },
      },
      tx
    );

    return record;
  });

  res.status(201).json(result);
});

export default router;

