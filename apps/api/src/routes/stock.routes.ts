import { Router } from "express";
import { Prisma, type TransactionType } from "@prisma/client";
import { prisma } from "../lib/db";
import { requireAuth, requireAction } from "../middleware/auth.middleware";
import { recordAudit } from "../services/audit.service";
import { getCategoryStockSummary } from "../services/stock.service";
import {
  parseListQuery,
  toPrismaPagination,
  toPrismaOrderBy,
  toPaginationMeta,
} from "../lib/list-query";

const router = Router();

const TRANSACTION_TYPES: TransactionType[] = ["INWARD", "OUTWARD", "ADJUSTMENT"];
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
  if (!Number.isInteger(quantity) || quantity === 0) {
    res.status(400).json({ error: "Quantity must be a non-zero whole number" });
    return;
  }
  if (type !== "ADJUSTMENT" && quantity < 0) {
    res
      .status(400)
      .json({ error: "Quantity must be positive for inward/outward movements" });
    return;
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

  const transaction = await prisma.stockTransaction.create({
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

  await recordAudit({
    actorId: req.session!.userId,
    action: "stock.transaction.create",
    entityType: "StockTransaction",
    entityId: transaction.id,
    after: {
      id: transaction.id,
      type: transaction.type,
      quantity: transaction.quantity,
      itemId: transaction.itemId,
      supplierId: transaction.supplierId,
      fromLocationId: transaction.fromLocationId,
      toLocationId: transaction.toLocationId,
    },
  });

  res.status(201).json(transaction);
});

export default router;
