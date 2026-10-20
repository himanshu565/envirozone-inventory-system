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
import {
  assertStockChangeAllowed,
  InsufficientStockError,
  calculateCurrentStock,
  InvalidStockQuantityError,
  validateStockQuantity,
} from "../services/stock-ledger";
import {
  hashReceiptRequest,
  assertReceiptState,
  getReceiptStatus,
  InvalidReceiptStateError,
  isAllowedPurchaseOrderTransition,
  ReceiptIdempotencyConflictError,
  PURCHASE_ORDER_RECEIVE_OPERATION,
} from "../services/purchase-order-receiving.service";
import {
  InvalidIdempotencyKeyError,
  parseIdempotencyKey,
} from "../services/stock-idempotency.service";
import { applyLocationStockChanges } from "../services/location-stock.service";

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

class InvalidReceiptError extends Error {}

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
      order = await prisma.$transaction(async (tx) => {
        const created = await tx.purchaseOrder.create({
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
        await recordAudit(
          {
            actorId: req.session!.userId,
            action: "purchaseOrder.create",
            entityType: "PurchaseOrder",
            entityId: created.id,
            after: {
              id: created.id,
              poNumber: created.poNumber,
              supplierId: created.supplierId,
              itemCount: items.length,
            },
          },
          tx
        );
        return created;
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
    if (
      !isAllowedPurchaseOrderTransition(
        before.status,
        req.body.status as PurchaseOrderStatus
      )
    ) {
      res.status(409).json({
        error: `Purchase order cannot transition from ${before.status} to ${req.body.status}`,
      });
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

  const order = await prisma.$transaction(async (tx) => {
    const updated = await tx.purchaseOrder.update({
      where: { id },
      data,
      include: DETAIL_INCLUDE,
    });
    await recordAudit(
      {
        actorId: req.session!.userId,
        action: "purchaseOrder.update",
        entityType: "PurchaseOrder",
        entityId: updated.id,
        before: {
          status: before.status,
          notes: before.notes,
          expectedDate: before.expectedDate,
        },
        after: {
          status: updated.status,
          notes: updated.notes,
          expectedDate: updated.expectedDate,
        },
      },
      tx
    );
    return updated;
  });

  res.json(order);
});

router.post("/:id/receive", requireAction("manageStock"), async (req, res) => {
  let idempotencyKey: string | null;
  try {
    idempotencyKey = parseIdempotencyKey(req.header("Idempotency-Key"));
  } catch (error) {
    if (error instanceof InvalidIdempotencyKeyError) {
      res.status(400).json({ error: error.message });
      return;
    }
    throw error;
  }

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

  try {
    assertReceiptState(order.status);
  } catch (error) {
    if (error instanceof InvalidReceiptStateError) {
      res.status(409).json({ error: error.message });
      return;
    }
    throw error;
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
  const receipts: { itemId: number; quantity: number }[] = [];
  const requestedByItemId = new Map<number, number>();

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
    try {
      validateStockQuantity("INWARD", quantity);
    } catch (error) {
      if (error instanceof InvalidStockQuantityError) {
        res.status(400).json({ error: error.message });
        return;
      }
      throw error;
    }
    const requestedQuantity = (requestedByItemId.get(itemId) ?? 0) + quantity;
    if (poItem.quantityReceived + requestedQuantity > poItem.quantityOrdered) {
      res.status(400).json({
        error: `Cannot receive more than ordered for item ${poItem.itemId}`,
      });
      return;
    }

    requestedByItemId.set(itemId, requestedQuantity);
    receipts.push({ itemId, quantity });
  }
  const requestHash = idempotencyKey
    ? hashReceiptRequest({ purchaseOrderId: id, receipts, toLocationId })
    : null;

  let updated;
  let replayed = false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      updated = await prisma.$transaction(
        async (tx) => {
          const currentOrder = await tx.purchaseOrder.findUnique({
            where: { id: order.id },
            include: DETAIL_INCLUDE,
          });
          if (!currentOrder) {
            throw new InvalidReceiptError("Purchase order not found");
          }

          if (idempotencyKey && requestHash) {
            const existingKey =
              await tx.purchaseOrderReceiptIdempotencyKey.findUnique({
                where: {
                  actorId_operation_key: {
                    actorId: req.session!.userId,
                    operation: PURCHASE_ORDER_RECEIVE_OPERATION,
                    key: idempotencyKey,
                  },
                },
              });
            if (existingKey) {
              if (existingKey.requestHash !== requestHash) {
                throw new ReceiptIdempotencyConflictError();
              }
              replayed = true;
              return currentOrder;
            }
          }

          try {
            assertReceiptState(currentOrder.status);
          } catch (error) {
            if (error instanceof InvalidReceiptStateError) {
              throw error;
            }
            throw error;
          }

          const currentItemsByItemId = new Map(
            currentOrder.items.map((item) => [item.itemId, item])
          );
          const currentRequestedByItemId = new Map<number, number>();
          for (const receipt of receipts) {
            const poItem = currentItemsByItemId.get(receipt.itemId);
            if (!poItem) {
              throw new InvalidReceiptError(
                "A receipt line references an item not on this order"
              );
            }

            const requestedQuantity =
              (currentRequestedByItemId.get(receipt.itemId) ?? 0) + receipt.quantity;
            if (
              poItem.quantityReceived + requestedQuantity >
              poItem.quantityOrdered
            ) {
              throw new InvalidReceiptError(
                `Cannot receive more than ordered for item ${poItem.itemId}`
              );
            }
            currentRequestedByItemId.set(receipt.itemId, requestedQuantity);
          }

          for (const [itemId, quantity] of currentRequestedByItemId) {
            const stockTotals = await tx.stockTransaction.groupBy({
              by: ["type"],
              where: { itemId },
              _sum: { quantity: true },
            });
            assertStockChangeAllowed(
              calculateCurrentStock(stockTotals),
              "INWARD",
              quantity
            );
          }

          if (toLocationId !== null) {
            for (const itemId of [...currentRequestedByItemId.keys()].sort((a, b) => a - b)) {
              await applyLocationStockChanges(tx, itemId, [
                { locationId: toLocationId, delta: currentRequestedByItemId.get(itemId)! },
              ]);
            }
          }

          for (const receipt of receipts) {
            const poItem = currentItemsByItemId.get(receipt.itemId)!;
            await tx.purchaseOrderItem.update({
              where: { id: poItem.id },
              data: { quantityReceived: { increment: receipt.quantity } },
            });
            await tx.stockTransaction.create({
              data: {
                type: "INWARD",
                quantity: receipt.quantity,
                itemId: receipt.itemId,
                supplierId: currentOrder.supplierId,
                toLocationId,
                purchaseOrderId: currentOrder.id,
                referenceNumber: currentOrder.poNumber,
                createdById: req.session!.userId,
              },
            });
          }

          const items = await tx.purchaseOrderItem.findMany({
            where: { purchaseOrderId: currentOrder.id },
          });
          const status = getReceiptStatus(items, currentOrder.status);

          const result = await tx.purchaseOrder.update({
            where: { id: currentOrder.id },
            data: { status },
            include: DETAIL_INCLUDE,
          });

          await recordAudit(
            {
              actorId: req.session!.userId,
              action: "purchaseOrder.receive",
              entityType: "PurchaseOrder",
              entityId: currentOrder.id,
              after: { receipts, status: result.status },
            },
            tx
          );

          if (idempotencyKey && requestHash) {
            await tx.purchaseOrderReceiptIdempotencyKey.create({
              data: {
                key: idempotencyKey,
                operation: PURCHASE_ORDER_RECEIVE_OPERATION,
                requestHash,
                actorId: req.session!.userId,
                purchaseOrderId: currentOrder.id,
              },
            });
          }

          return result;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );
      break;
    } catch (error) {
      if (error instanceof InvalidReceiptError) {
        res.status(error.message === "Purchase order not found" ? 404 : 400).json({
          error: error.message,
        });
        return;
      }

      if (error instanceof InvalidReceiptStateError) {
        res.status(409).json({ error: error.message });
        return;
      }

      if (error instanceof ReceiptIdempotencyConflictError) {
        res.status(409).json({ error: error.message });
        return;
      }

      if (error instanceof InsufficientStockError) {
        res.status(409).json({ error: error.message });
        return;
      }

      const isSerializationConflict =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034";
      if (isSerializationConflict && attempt < 2) continue;
      if (isSerializationConflict) {
        res.status(409).json({
          error: "Stock changed concurrently. Please retry the receipt.",
        });
        return;
      }

      if (
        idempotencyKey &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const existing =
          await prisma.purchaseOrderReceiptIdempotencyKey.findUnique({
            where: {
              actorId_operation_key: {
                actorId: req.session!.userId,
                operation: PURCHASE_ORDER_RECEIVE_OPERATION,
                key: idempotencyKey,
              },
            },
          });
        if (!existing) throw error;
        if (existing.requestHash !== requestHash) {
          res.status(409).json({
            error: "Idempotency-Key was already used with a different receipt request",
          });
          return;
        }
        updated = await prisma.purchaseOrder.findUnique({
          where: { id: existing.purchaseOrderId },
          include: DETAIL_INCLUDE,
        });
        if (!updated) {
          throw new Error("Purchase order receipt result was not found");
        }
        replayed = true;
        break;
      }
      throw error;
    }
  }

  if (!updated) {
    throw new Error("Purchase order receipt completed without a result");
  }

  res.json(updated);
});

export default router;
