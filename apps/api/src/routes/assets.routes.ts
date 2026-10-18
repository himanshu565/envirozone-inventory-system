import { Router } from "express";
import { Prisma, type AssetStatus } from "@prisma/client";
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

const ALLOWED_SORT_FIELDS = ["assetTag", "serialNumber", "status", "createdAt"];
const ASSET_INCLUDE = {
  item: { select: { id: true, itemCode: true, name: true, trackingMode: true } },
  currentLocation: { select: { id: true, name: true, type: true } },
  assignedUser: { select: { id: true, name: true, email: true, role: true } },
} satisfies Prisma.SerializedAssetInclude;

function optionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function optionalDate(value: unknown): Date | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function assetSnapshot(asset: {
  id: number;
  assetTag: string;
  serialNumber: string | null;
  status: AssetStatus;
  purchaseDate: Date | null;
  warrantyExpires: Date | null;
  notes: string | null;
  itemId: number;
  currentLocationId: number | null;
  assignedUserId: number | null;
}) {
  return {
    id: asset.id,
    assetTag: asset.assetTag,
    serialNumber: asset.serialNumber,
    status: asset.status,
    purchaseDate: asset.purchaseDate,
    warrantyExpires: asset.warrantyExpires,
    notes: asset.notes,
    itemId: asset.itemId,
    currentLocationId: asset.currentLocationId,
    assignedUserId: asset.assignedUserId,
  };
}

router.use(requireAuth);

router.get("/", async (req, res) => {
  const query = parseListQuery(
    new URLSearchParams(req.query as Record<string, string>)
  );
  const search = query.search;
  const status =
    typeof req.query.status === "string" &&
    ["IN_STOCK", "DEPLOYED", "UNDER_MAINTENANCE", "IN_CALIBRATION", "QUARANTINED", "RETIRED", "LOST"].includes(
      req.query.status
    )
      ? (req.query.status as AssetStatus)
      : undefined;

  const where: Prisma.SerializedAssetWhereInput = {
    ...(status ? { status } : {}),
    ...(search
      ? {
          OR: [
            { assetTag: { contains: search, mode: "insensitive" } },
            { serialNumber: { contains: search, mode: "insensitive" } },
            { item: { name: { contains: search, mode: "insensitive" } } },
            { item: { itemCode: { contains: search, mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  const [assets, total] = await Promise.all([
    prisma.serializedAsset.findMany({
      where,
      include: ASSET_INCLUDE,
      ...toPrismaPagination(query),
      orderBy: toPrismaOrderBy(query, ALLOWED_SORT_FIELDS, "assetTag"),
    }),
    prisma.serializedAsset.count({ where }),
  ]);

  res.json({ data: assets, pagination: toPaginationMeta(query, total) });
});

router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid asset id" });
    return;
  }

  const asset = await prisma.serializedAsset.findUnique({
    where: { id },
    include: ASSET_INCLUDE,
  });
  if (!asset) {
    res.status(404).json({ error: "Asset not found" });
    return;
  }

  res.json(asset);
});

router.post("/", requireAction("manageMasterData"), async (req, res) => {
  const assetTag = optionalString(req.body?.assetTag);
  const serialNumber = optionalString(req.body?.serialNumber);
  const itemId = Number(req.body?.itemId);
  const currentLocationId =
    req.body?.currentLocationId === undefined ||
    req.body?.currentLocationId === ""
      ? null
      : Number(req.body.currentLocationId);
  const assignedUserId =
    req.body?.assignedUserId === undefined || req.body?.assignedUserId === ""
      ? null
      : Number(req.body.assignedUserId);

  if (!assetTag) {
    res.status(400).json({ error: "Asset tag is required" });
    return;
  }
  if (!Number.isInteger(itemId)) {
    res.status(400).json({ error: "A valid item is required" });
    return;
  }
  if (
    (currentLocationId !== null && !Number.isInteger(currentLocationId)) ||
    (assignedUserId !== null && !Number.isInteger(assignedUserId))
  ) {
    res.status(400).json({ error: "Related IDs must be valid integers" });
    return;
  }

  const purchaseDate = optionalDate(req.body?.purchaseDate);
  const warrantyExpires = optionalDate(req.body?.warrantyExpires);
  if (purchaseDate === undefined || warrantyExpires === undefined) {
    res.status(400).json({ error: "Dates must be valid ISO dates" });
    return;
  }

  const [item, location, assignedUser] = await Promise.all([
    prisma.item.findUnique({ where: { id: itemId } }),
    currentLocationId === null
      ? Promise.resolve(null)
      : prisma.location.findUnique({ where: { id: currentLocationId } }),
    assignedUserId === null
      ? Promise.resolve(null)
      : prisma.user.findUnique({ where: { id: assignedUserId } }),
  ]);

  if (!item) {
    res.status(400).json({ error: "Item not found" });
    return;
  }
  if (item.trackingMode !== "SERIALIZED") {
    res.status(400).json({ error: "The selected item is not serialized" });
    return;
  }
  if (currentLocationId !== null && !location) {
    res.status(400).json({ error: "Location not found" });
    return;
  }
  if (assignedUserId !== null && !assignedUser) {
    res.status(400).json({ error: "Assigned user not found" });
    return;
  }

  try {
    const asset = await prisma.$transaction(async (tx) => {
      const created = await tx.serializedAsset.create({
        data: {
          assetTag,
          serialNumber,
          itemId,
          currentLocationId,
          assignedUserId,
          purchaseDate,
          warrantyExpires,
          notes: optionalString(req.body?.notes),
        },
        include: ASSET_INCLUDE,
      });

      await recordAudit(
        {
          actorId: req.session!.userId,
          action: "asset.create",
          entityType: "SerializedAsset",
          entityId: created.id,
          after: assetSnapshot(created),
        },
        tx
      );
      return created;
    });

    res.status(201).json(asset);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      res.status(409).json({ error: "Asset tag or serial number already exists" });
      return;
    }
    throw error;
  }
});

// PATCH /api/assets/:id/status - Update asset lifecycle status
router.patch("/:id/status", requireAction("manageMasterData"), async (req, res) => {
  const id = Number(req.params.id);
  const status = req.body?.status as AssetStatus;
  const currentLocationId =
    req.body?.currentLocationId === undefined
      ? undefined
      : req.body.currentLocationId === null || req.body.currentLocationId === ""
        ? null
        : Number(req.body.currentLocationId);
  const assignedUserId =
    req.body?.assignedUserId === undefined
      ? undefined
      : req.body.assignedUserId === null || req.body.assignedUserId === ""
        ? null
        : Number(req.body.assignedUserId);
  const notes = req.body?.notes !== undefined ? optionalString(req.body.notes) : undefined;

  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid asset id" });
    return;
  }
  if (!["IN_STOCK", "DEPLOYED", "UNDER_MAINTENANCE", "IN_CALIBRATION", "QUARANTINED", "RETIRED", "LOST"].includes(status)) {
    res.status(400).json({ error: "Invalid asset status" });
    return;
  }

  const existing = await prisma.serializedAsset.findUnique({ where: { id } });
  if (!existing) {
    res.status(404).json({ error: "Asset not found" });
    return;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const asset = await tx.serializedAsset.update({
      where: { id },
      data: {
        status,
        ...(currentLocationId !== undefined ? { currentLocationId } : {}),
        ...(assignedUserId !== undefined ? { assignedUserId } : {}),
        ...(notes !== undefined ? { notes } : {}),
      },
      include: ASSET_INCLUDE,
    });

    await recordAudit(
      {
        actorId: req.session!.userId,
        action: "asset.status_change",
        entityType: "SerializedAsset",
        entityId: id,
        before: assetSnapshot(existing),
        after: assetSnapshot(asset),
      },
      tx
    );

    return asset;
  });

  res.json(updated);
});

// GET /api/assets/:id/history - Full asset audit and lifecycle timeline
router.get("/:id/history", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid asset id" });
    return;
  }

  const [asset, workOrders, calibrations, auditLogs] = await Promise.all([
    prisma.serializedAsset.findUnique({ where: { id }, include: ASSET_INCLUDE }),
    prisma.workOrder.findMany({
      where: { assetId: id },
      orderBy: { createdAt: "desc" },
      include: { assignee: { select: { name: true, email: true } } },
    }),
    prisma.calibrationRecord.findMany({
      where: { assetId: id },
      orderBy: { calibrationDate: "desc" },
    }),
    prisma.auditLog.findMany({
      where: { entityType: "SerializedAsset", entityId: id },
      orderBy: { createdAt: "desc" },
      include: { actor: { select: { name: true, email: true } } },
    }),
  ]);

  if (!asset) {
    res.status(404).json({ error: "Asset not found" });
    return;
  }

  res.json({
    asset,
    workOrders,
    calibrations,
    auditLogs,
  });
});

export default router;
