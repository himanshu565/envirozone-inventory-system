import { Router } from "express";
import { Prisma, type TransactionType } from "@prisma/client";
import { prisma } from "../lib/db";
import { requireAuth, requireAction } from "../middleware/auth.middleware";
import { getCategoryStockSummary } from "../services/stock.service";
import {
  assertStockChangeAllowed,
  calculateCurrentStock,
  InsufficientStockError,
  InvalidStockQuantityError,
  validateStockQuantity,
} from "../services/stock-ledger";
import {
  parseListQuery,
  toPrismaPagination,
  toPrismaOrderBy,
  toPaginationMeta,
} from "../lib/list-query";
import {
  hashStockTransactionRequest,
  InvalidIdempotencyKeyError,
  parseIdempotencyKey,
  STOCK_TRANSACTION_OPERATION,
} from "../services/stock-idempotency.service";
import {
  applyLocationStockChanges,
  getLocationChanges,
} from "../services/location-stock.service";

const router = Router();

const TRANSACTION_TYPES: TransactionType[] = [
  "INWARD",
  "OUTWARD",
  "ADJUSTMENT",
  "TRANSFER",
];
const ALLOWED_SORT_FIELDS = ["transactionDate", "createdAt"];

const TRANSACTION_INCLUDE = {
  item: { select: { id: true, itemCode: true, name: true } },
  supplier: { select: { id: true, name: true } },
  fromLocation: { select: { id: true, name: true } },
  toLocation: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
} satisfies Prisma.StockTransactionInclude;

function parseOptionalId(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  return Number(value);
}

router.use(requireAuth);

router.get("/summary", async (_req, res) => {
  const summary = await getCategoryStockSummary();
  res.json(summary);
});

router.get("/balances", async (req, res) => {
  const itemId = req.query.itemId === undefined ? undefined : Number(req.query.itemId);
  if (itemId !== undefined && !Number.isInteger(itemId)) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }

  const balances = await prisma.locationStockBalance.findMany({
    where: itemId === undefined ? undefined : { itemId },
    include: {
      item: { select: { id: true, itemCode: true, name: true } },
      location: { select: { id: true, name: true, isActive: true } },
    },
    orderBy: [{ itemId: "asc" }, { locationId: "asc" }],
  });
  res.json(balances);
});

router.get("/transactions", async (req, res) => {
  const query = parseListQuery(
    new URLSearchParams(req.query as Record<string, string>)
  );
  const itemId = Number(req.query.itemId);

  const where: Prisma.StockTransactionWhereInput = Number.isInteger(itemId)
    ? { itemId }
    : {};

  const [transactions, total] = await Promise.all([
    prisma.stockTransaction.findMany({
      where,
      include: TRANSACTION_INCLUDE,
      ...toPrismaPagination(query),
      orderBy: toPrismaOrderBy(query, ALLOWED_SORT_FIELDS, "transactionDate"),
    }),
    prisma.stockTransaction.count({ where }),
  ]);

  res.json({ data: transactions, pagination: toPaginationMeta(query, total) });
});

router.post("/transactions", requireAction("manageStock"), async (req, res) => {
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

  const type = typeof req.body?.type === "string" ? req.body.type : "";
  if (!TRANSACTION_TYPES.includes(type as TransactionType)) {
    res.status(400).json({ error: `Type must be one of: ${TRANSACTION_TYPES.join(", ")}` });
    return;
  }

  const itemId = Number(req.body?.itemId);
  if (!Number.isInteger(itemId)) {
    res.status(400).json({ error: "A valid item is required" });
    return;
  }

  const quantity = Number(req.body?.quantity);
  try {
    validateStockQuantity(type as TransactionType, quantity);
  } catch (error) {
    if (error instanceof InvalidStockQuantityError) {
      res.status(400).json({ error: error.message });
      return;
    }
    throw error;
  }

  const item = await prisma.item.findUnique({ where: { id: itemId } });
  if (!item) {
    res.status(400).json({ error: "Item not found" });
    return;
  }

  const supplierId = parseOptionalId(req.body?.supplierId);
  if (supplierId !== null) {
    if (
      !Number.isInteger(supplierId) ||
      !(await prisma.supplier.findUnique({ where: { id: supplierId } }))
    ) {
      res.status(400).json({ error: "Supplier not found" });
      return;
    }
  }

  const fromLocationId = parseOptionalId(req.body?.fromLocationId);
  const toLocationId = parseOptionalId(req.body?.toLocationId);
  for (const locationId of [fromLocationId, toLocationId]) {
    if (locationId !== null) {
      if (
        !Number.isInteger(locationId) ||
        !(await prisma.location.findUnique({ where: { id: locationId } }))
      ) {
        res.status(400).json({ error: "Location not found" });
        return;
      }
    }
  }

  const referenceNumber =
    typeof req.body?.referenceNumber === "string"
      ? req.body.referenceNumber.trim() || null
      : null;
  const remarks =
    typeof req.body?.remarks === "string" ? req.body.remarks.trim() || null : null;
  const requestHash = idempotencyKey
    ? hashStockTransactionRequest({
        type: type as TransactionType,
        itemId,
        quantity,
        supplierId,
        fromLocationId,
        toLocationId,
        referenceNumber,
        remarks,
      })
    : null;
  let locationChanges: ReturnType<typeof getLocationChanges>;
  try {
    locationChanges = getLocationChanges(
      type as TransactionType,
      quantity,
      fromLocationId,
      toLocationId
    );
  } catch (error) {
    if (error instanceof Error) {
      res.status(400).json({ error: error.message });
      return;
    }
    throw error;
  }

  let transaction:
    | Prisma.StockTransactionGetPayload<{ include: typeof TRANSACTION_INCLUDE }>
    | undefined;
  let replayed = false;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      transaction = await prisma.$transaction(
        async (tx) => {
          const stockTotals = await tx.stockTransaction.groupBy({
            by: ["type"],
            where: { itemId },
            _sum: { quantity: true },
          });
          const currentStock = calculateCurrentStock(stockTotals);
          assertStockChangeAllowed(currentStock, type as TransactionType, quantity);
          if (locationChanges.length > 0) {
            await applyLocationStockChanges(tx, itemId, locationChanges);
          }

          const created = await tx.stockTransaction.create({
            data: {
              type: type as TransactionType,
              quantity,
              itemId,
              supplierId,
              fromLocationId,
              toLocationId,
              referenceNumber,
              remarks,
              createdById: req.session!.userId,
            },
            include: TRANSACTION_INCLUDE,
          });

          // Keep the audit record atomic with the stock transaction.
          await tx.auditLog.create({
            data: {
              actorId: req.session!.userId,
              action: "stock.transaction.create",
              entityType: "StockTransaction",
              entityId: created.id,
              after: {
                id: created.id,
                type: created.type,
                quantity: created.quantity,
                itemId: created.itemId,
                supplierId: created.supplierId,
                fromLocationId: created.fromLocationId,
                toLocationId: created.toLocationId,
              },
            },
          });

          if (idempotencyKey && requestHash) {
            await tx.stockTransactionIdempotencyKey.create({
              data: {
                key: idempotencyKey,
                operation: STOCK_TRANSACTION_OPERATION,
                requestHash,
                actorId: req.session!.userId,
                stockTransactionId: created.id,
              },
            });
          }

          return created;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );
      break;
    } catch (error) {
      if (error instanceof InsufficientStockError) {
        res.status(409).json({ error: error.message });
        return;
      }

      const isSerializationConflict =
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
      if (isSerializationConflict && attempt < 2) continue;
      if (isSerializationConflict) {
        res.status(409).json({
          error: "Stock changed concurrently. Please retry the transaction.",
        });
        return;
      }

      if (
        idempotencyKey &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const existing = await prisma.stockTransactionIdempotencyKey.findUnique({
          where: {
            actorId_operation_key: {
              actorId: req.session!.userId,
              operation: STOCK_TRANSACTION_OPERATION,
              key: idempotencyKey,
            },
          },
          include: {
            stockTransaction: { include: TRANSACTION_INCLUDE },
          },
        });

        if (!existing) throw error;
        if (existing.requestHash !== requestHash) {
          res.status(409).json({
            error: "Idempotency-Key was already used with a different request",
          });
          return;
        }

        transaction = existing.stockTransaction;
        replayed = true;
        break;
      }
      throw error;
    }
  }

  if (!transaction) {
    throw new Error("Stock transaction completed without a result");
  }

  res.status(replayed ? 200 : 201).json(transaction);
});

export default router;
