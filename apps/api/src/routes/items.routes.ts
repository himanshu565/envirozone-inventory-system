import { Router } from "express";
import { Prisma, type TrackingMode } from "@prisma/client";
import { prisma } from "../lib/db";
import { requireAuth, requireAction } from "../middleware/auth.middleware";
import { recordAudit } from "../services/audit.service";
import { getCurrentStockByItemIds } from "../services/stock.service";
import {
  parseListQuery,
  toPrismaPagination,
  toPrismaOrderBy,
  toPaginationMeta,
} from "../lib/list-query";

const router = Router();

const ALLOWED_SORT_FIELDS = ["name", "itemCode", "minimumStock", "createdAt"];
const TRACKING_MODES: TrackingMode[] = ["QUANTITY", "SERIALIZED"];

function itemAuditSnapshot(item: {
  id: number;
  itemCode: string;
  name: string;
  description: string | null;
  unit: string;
  minimumStock: number;
  trackingMode: TrackingMode;
  categoryId: number;
}) {
  return {
    id: item.id,
    itemCode: item.itemCode,
    name: item.name,
    description: item.description,
    unit: item.unit,
    minimumStock: item.minimumStock,
    trackingMode: item.trackingMode,
    categoryId: item.categoryId,
  };
}

router.use(requireAuth);

router.get("/", async (req, res) => {
  const query = parseListQuery(
    new URLSearchParams(req.query as Record<string, string>)
  );

  const where: Prisma.ItemWhereInput = query.search
    ? {
        OR: [
          { name: { contains: query.search, mode: "insensitive" } },
          { itemCode: { contains: query.search, mode: "insensitive" } },
        ],
      }
    : {};

  const [items, total] = await Promise.all([
    prisma.item.findMany({
      where,
      include: { category: { select: { id: true, name: true } } },
      ...toPrismaPagination(query),
      orderBy: toPrismaOrderBy(query, ALLOWED_SORT_FIELDS, "name"),
    }),
    prisma.item.count({ where }),
  ]);

  const stockByItem = await getCurrentStockByItemIds(items.map((item) => item.id));
  const data = items.map((item) => ({
    ...item,
    currentStock: stockByItem.get(item.id) ?? 0,
  }));

  res.json({ data, pagination: toPaginationMeta(query, total) });
});

router.post("/", requireAction("manageMasterData"), async (req, res) => {
  const itemCode =
    typeof req.body?.itemCode === "string" ? req.body.itemCode.trim() : "";
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const description =
    typeof req.body?.description === "string" ? req.body.description.trim() : "";
  const unit =
    typeof req.body?.unit === "string" && req.body.unit.trim()
      ? req.body.unit.trim()
      : "pcs";
  const minimumStock = Number.isFinite(Number(req.body?.minimumStock))
    ? Math.max(0, Math.trunc(Number(req.body.minimumStock)))
    : 0;
  const categoryId = Number(req.body?.categoryId);
  const trackingMode =
    typeof req.body?.trackingMode === "string" && req.body.trackingMode
      ? req.body.trackingMode
      : "QUANTITY";

  if (!itemCode || !name) {
    res.status(400).json({ error: "Item code and name are required" });
    return;
  }

  if (!Number.isInteger(categoryId)) {
    res.status(400).json({ error: "A valid category is required" });
    return;
  }

  if (!TRACKING_MODES.includes(trackingMode as TrackingMode)) {
    res.status(400).json({
      error: `Tracking mode must be one of: ${TRACKING_MODES.join(", ")}`,
    });
    return;
  }

  const category = await prisma.category.findUnique({ where: { id: categoryId } });
  if (!category) {
    res.status(400).json({ error: "Category not found" });
    return;
  }

  const existing = await prisma.item.findUnique({ where: { itemCode } });
  if (existing) {
    res.status(409).json({ error: "An item with this code already exists" });
    return;
  }

  const item = await prisma.$transaction(async (tx) => {
    const created = await tx.item.create({
      data: {
        itemCode,
        name,
        description: description || null,
        unit,
        minimumStock,
        trackingMode: trackingMode as TrackingMode,
        categoryId,
      },
      include: { category: { select: { id: true, name: true } } },
    });

    await recordAudit(
      {
        actorId: req.session!.userId,
        action: "item.create",
        entityType: "Item",
        entityId: created.id,
        after: itemAuditSnapshot(created),
      },
      tx
    );
    return created;
  });

  res.status(201).json(item);
});

router.patch("/:id", requireAction("manageMasterData"), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }

  const before = await prisma.item.findUnique({ where: { id } });
  if (!before) {
    res.status(404).json({ error: "Item not found" });
    return;
  }

  const data: Prisma.ItemUpdateInput = {};

  if (typeof req.body?.name === "string" && req.body.name.trim()) {
    data.name = req.body.name.trim();
  }
  if (typeof req.body?.description === "string") {
    data.description = req.body.description.trim() || null;
  }
  if (typeof req.body?.unit === "string" && req.body.unit.trim()) {
    data.unit = req.body.unit.trim();
  }
  if (req.body?.minimumStock !== undefined) {
    if (!Number.isFinite(Number(req.body.minimumStock))) {
      res.status(400).json({ error: "minimumStock must be a number" });
      return;
    }
    data.minimumStock = Math.max(0, Math.trunc(Number(req.body.minimumStock)));
  }
  if (req.body?.trackingMode !== undefined) {
    if (!TRACKING_MODES.includes(req.body.trackingMode as TrackingMode)) {
      res.status(400).json({
        error: `Tracking mode must be one of: ${TRACKING_MODES.join(", ")}`,
      });
      return;
    }
    data.trackingMode = req.body.trackingMode as TrackingMode;
  }
  if (req.body?.categoryId !== undefined) {
    const categoryId = Number(req.body.categoryId);
    if (!Number.isInteger(categoryId)) {
      res.status(400).json({ error: "A valid category is required" });
      return;
    }
    const category = await prisma.category.findUnique({ where: { id: categoryId } });
    if (!category) {
      res.status(400).json({ error: "Category not found" });
      return;
    }
    data.category = { connect: { id: categoryId } };
  }

  const item = await prisma.$transaction(async (tx) => {
    const updated = await tx.item.update({
      where: { id },
      data,
      include: { category: { select: { id: true, name: true } } },
    });

    await recordAudit(
      {
        actorId: req.session!.userId,
        action: "item.update",
        entityType: "Item",
        entityId: updated.id,
        before: itemAuditSnapshot(before),
        after: itemAuditSnapshot(updated),
      },
      tx
    );
    return updated;
  });

  res.json(item);
});

router.delete("/:id", requireAction("manageMasterData"), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }

  const before = await prisma.item.findUnique({ where: { id } });
  if (!before) {
    res.status(404).json({ error: "Item not found" });
    return;
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.item.delete({ where: { id } });
      await recordAudit(
        {
          actorId: req.session!.userId,
          action: "item.delete",
          entityType: "Item",
          entityId: id,
          before: itemAuditSnapshot(before),
        },
        tx
      );
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2003"
    ) {
      res.status(409).json({
        error: "This item has stock or purchase order history and cannot be deleted",
      });
      return;
    }
    throw err;
  }

  res.status(204).send();
});

export default router;
