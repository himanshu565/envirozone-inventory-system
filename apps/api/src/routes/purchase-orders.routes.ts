import { Router } from "express";
import { Prisma, type PurchaseOrderStatus } from "@prisma/client";
import { prisma } from "../lib/db";
import { requireAuth, requireAction } from "../middleware/auth.middleware";
import { recordAudit } from "../services/audit.service";
import {
  parseListQuery,
  toPrismaPagination,
  toPrismaOrderBy,
  toPaginationMeta,
} from "../lib/list-query";

const router = Router();

const PO_STATUSES: PurchaseOrderStatus[] = [
  "DRAFT",
  "SENT",
  "PARTIALLY_RECEIVED",
  "RECEIVED",
  "CANCELLED",
];
const ALLOWED_SORT_FIELDS = ["poNumber", "orderDate", "status", "createdAt"];

const LIST_INCLUDE = {
  supplier: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  _count: { select: { items: true } },
} satisfies Prisma.PurchaseOrderInclude;

const DETAIL_INCLUDE = {
  supplier: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  items: {
    include: { item: { select: { id: true, itemCode: true, name: true, unit: true } } },
  },
} satisfies Prisma.PurchaseOrderInclude;

function parseOptionalId(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  return Number(value);
}

async function generatePoNumber(): Promise<string> {
  const count = await prisma.purchaseOrder.count();
  return `PO-${String(count + 1).padStart(4, "0")}`;
}

router.use(requireAuth);

router.get("/", async (req, res) => {
  const query = parseListQuery(
    new URLSearchParams(req.query as Record<string, string>)
  );

  const where: Prisma.PurchaseOrderWhereInput = query.search
    ? { poNumber: { contains: query.search, mode: "insensitive" } }
    : {};

  const [orders, total] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where,
      include: LIST_INCLUDE,
      ...toPrismaPagination(query),
      orderBy: toPrismaOrderBy(query, ALLOWED_SORT_FIELDS, "orderDate"),
    }),
    prisma.purchaseOrder.count({ where }),
  ]);

  res.json({ data: orders, pagination: toPaginationMeta(query, total) });
});

router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid purchase order id" });
    return;
  }

  const order = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: DETAIL_INCLUDE,
  });
  if (!order) {
    res.status(404).json({ error: "Purchase order not found" });
    return;
  }

  res.json(order);
});

router.post("/", requireAction("managePurchaseOrders"), async (req, res) => {
  const supplierId = Number(req.body?.supplierId);
  if (!Number.isInteger(supplierId)) {
    res.status(400).json({ error: "A valid supplier is required" });
    return;
  }

  const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } });
  if (!supplier) {
    res.status(400).json({ error: "Supplier not found" });
    return;
  }

  const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
  if (rawItems.length === 0) {
    res.status(400).json({ error: "At least one line item is required" });
    return;
  }

  const items: { itemId: number; quantityOrdered: number; unitPrice: number | null }[] = [];
  for (const raw of rawItems) {
    const itemId = Number(raw?.itemId);
    const quantityOrdered = Number(raw?.quantityOrdered);
    if (!Number.isInteger(itemId)) {
      res.status(400).json({ error: "Each line item needs a valid item" });
      return;
    }
    if (!Number.isInteger(quantityOrdered) || quantityOrdered <= 0) {
      res.status(400).json({ error: "Each line item needs a positive quantity" });
      return;
    }
    const unitPriceRaw = raw?.unitPrice;
    const unitPrice =
      unitPriceRaw === undefined || unitPriceRaw === null || unitPriceRaw === ""
        ? null
        : Number(unitPriceRaw);
    if (unitPrice !== null && (!Number.isFinite(unitPrice) || unitPrice < 0)) {
      res.status(400).json({ error: "Unit price must be a non-negative number" });
      return;
    }
    items.push({ itemId, quantityOrdered, unitPrice });
  }

  const itemIds = items.map((i) => i.itemId);
  const foundItems = await prisma.item.findMany({ where: { id: { in: itemIds } } });
  if (foundItems.length !== new Set(itemIds).size) {
    res.status(400).json({ error: "One or more items were not found" });
    return;
  }

  const expectedDateRaw = req.body?.expectedDate;
  const expectedDate =
    typeof expectedDateRaw === "string" && expectedDateRaw ? new Date(expectedDateRaw) : null;
  if (expectedDate && Number.isNaN(expectedDate.getTime())) {
    res.status(400).json({ error: "Invalid expected date" });
    return;
  }

  const notes = typeof req.body?.notes === "string" ? req.body.notes.trim() || null : null;

  let order;
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const poNumber = await generatePoNumber();
    try {
      order = await prisma.purchaseOrder.create({
        data: {
          poNumber,
          supplierId,
          expectedDate,
          notes,
          createdById: req.session!.userId,
          items: { create: items },
        },
        include: DETAIL_INCLUDE,
      });
      break;
    } catch (err) {
      lastError = err;
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        continue;
      }
      throw err;
    }
  }

  if (!order) {
    throw lastError;
  }

  await recordAudit({
    actorId: req.session!.userId,
    action: "purchaseOrder.create",
    entityType: "PurchaseOrder",
    entityId: order.id,
    after: {
      id: order.id,
      poNumber: order.poNumber,
      supplierId: order.supplierId,
      itemCount: items.length,
    },
  });

  res.status(201).json(order);
});

router.patch("/:id", requireAction("managePurchaseOrders"), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid purchase order id" });
    return;
  }

  const before = await prisma.purchaseOrder.findUnique({ where: { id } });
  if (!before) {
    res.status(404).json({ error: "Purchase order not found" });
    return;
  }

  const data: Prisma.PurchaseOrderUpdateInput = {};

  if (req.body?.status !== undefined) {
    if (!PO_STATUSES.includes(req.body.status as PurchaseOrderStatus)) {
      res.status(400).json({ error: `Status must be one of: ${PO_STATUSES.join(", ")}` });
      return;
    }
    data.status = req.body.status as PurchaseOrderStatus;
  }
  if (req.body?.notes !== undefined) {
    data.notes = typeof req.body.notes === "string" ? req.body.notes.trim() || null : null;
  }
  if (req.body?.expectedDate !== undefined) {
    const expectedDate =
      typeof req.body.expectedDate === "string" && req.body.expectedDate
        ? new Date(req.body.expectedDate)
        : null;
    if (expectedDate && Number.isNaN(expectedDate.getTime())) {
      res.status(400).json({ error: "Invalid expected date" });
      return;
    }
    data.expectedDate = expectedDate;
  }

  const order = await prisma.purchaseOrder.update({
    where: { id },
    data,
    include: DETAIL_INCLUDE,
  });

  await recordAudit({
    actorId: req.session!.userId,
    action: "purchaseOrder.update",
    entityType: "PurchaseOrder",
    entityId: order.id,
    before: { status: before.status, notes: before.notes, expectedDate: before.expectedDate },
    after: { status: order.status, notes: order.notes, expectedDate: order.expectedDate },
  });

  res.json(order);
});

router.post("/:id/receive", requireAction("manageStock"), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid purchase order id" });
    return;
  }

  const order = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: { items: true },
  });
  if (!order) {
    res.status(404).json({ error: "Purchase order not found" });
    return;
  }

  const rawReceipts = Array.isArray(req.body?.receipts) ? req.body.receipts : [];
  if (rawReceipts.length === 0) {
    res.status(400).json({ error: "At least one receipt line is required" });
    return;
  }

  const toLocationId = parseOptionalId(req.body?.toLocationId);
  if (toLocationId !== null) {
    if (
      !Number.isInteger(toLocationId) ||
      !(await prisma.location.findUnique({ where: { id: toLocationId } }))
    ) {
      res.status(400).json({ error: "Location not found" });
      return;
    }
  }

  const poItemsByItemId = new Map(order.items.map((i) => [i.itemId, i]));
  const receipts: { poItemId: number; itemId: number; quantity: number }[] = [];

  for (const raw of rawReceipts) {
    const itemId = Number(raw?.itemId);
    const quantity = Number(raw?.quantity);
    const poItem = poItemsByItemId.get(itemId);

    if (!Number.isInteger(itemId) || !poItem) {
      res.status(400).json({ error: "A receipt line references an item not on this order" });
      return;
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      res.status(400).json({ error: "Receipt quantity must be a positive whole number" });
      return;
    }
    if (poItem.quantityReceived + quantity > poItem.quantityOrdered) {
      res.status(400).json({
        error: `Cannot receive more than ordered for item ${poItem.itemId}`,
      });
      return;
    }

    receipts.push({ poItemId: poItem.id, itemId, quantity });
  }

  const updated = await prisma.$transaction(async (tx) => {
    for (const receipt of receipts) {
      await tx.purchaseOrderItem.update({
        where: { id: receipt.poItemId },
        data: { quantityReceived: { increment: receipt.quantity } },
      });
      await tx.stockTransaction.create({
        data: {
          type: "INWARD",
          quantity: receipt.quantity,
          itemId: receipt.itemId,
          supplierId: order.supplierId,
          toLocationId,
          purchaseOrderId: order.id,
          referenceNumber: order.poNumber,
          createdById: req.session!.userId,
        },
      });
    }

    const items = await tx.purchaseOrderItem.findMany({
      where: { purchaseOrderId: order.id },
    });
    const fullyReceived = items.every((i) => i.quantityReceived >= i.quantityOrdered);
    const anyReceived = items.some((i) => i.quantityReceived > 0);
    const status: PurchaseOrderStatus = fullyReceived
      ? "RECEIVED"
      : anyReceived
        ? "PARTIALLY_RECEIVED"
        : order.status;

    return tx.purchaseOrder.update({
      where: { id: order.id },
      data: { status },
      include: DETAIL_INCLUDE,
    });
  });

  await recordAudit({
    actorId: req.session!.userId,
    action: "purchaseOrder.receive",
    entityType: "PurchaseOrder",
    entityId: order.id,
    after: { receipts, status: updated.status },
  });

  res.json(updated);
});

export default router;
