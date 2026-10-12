import { Router } from "express";
import {
  Prisma,
  type AssetStatus,
  type PurchaseOrderStatus,
  type TransactionType,
} from "@prisma/client";
import { prisma } from "../lib/db";
import { requireAuth } from "../middleware/auth.middleware";
import {
  calculateReceiptProgress,
  getStockReportRows,
  movementTotals,
  type StockReportRow,
} from "../services/reports.service";
import {
  parseListQuery,
  toPaginationMeta,
  toPrismaOrderBy,
} from "../lib/list-query";

const router = Router();
const REPORT_SORT_FIELDS = ["itemCode", "itemName", "currentStock", "minimumStock", "variance"];
const MOVEMENT_SORT_FIELDS = ["transactionDate", "createdAt", "quantity", "type"];
const TRANSACTION_TYPES: TransactionType[] = ["INWARD", "OUTWARD", "ADJUSTMENT", "TRANSFER"];
const ASSET_STATUSES: AssetStatus[] = [
  "IN_STOCK",
  "DEPLOYED",
  "UNDER_MAINTENANCE",
  "IN_CALIBRATION",
  "QUARANTINED",
  "RETIRED",
  "LOST",
];
const PO_STATUSES: PurchaseOrderStatus[] = [
  "DRAFT",
  "SENT",
  "PARTIALLY_RECEIVED",
  "RECEIVED",
  "CANCELLED",
];

function parseDate(value: unknown): Date | null | undefined {
  if (value === undefined || value === "") return null;
  if (typeof value !== "string") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

router.use(requireAuth);

router.get("/stock/items", async (req, res) => {
  const query = parseListQuery(
    new URLSearchParams(req.query as Record<string, string>)
  );
  const categoryId =
    req.query.categoryId === undefined ? undefined : Number(req.query.categoryId);
  if (categoryId !== undefined && !Number.isInteger(categoryId)) {
    res.status(400).json({ error: "Invalid category id" });
    return;
  }
  const lowStock = req.query.lowStock === "true";
  const outOfStock = req.query.outOfStock === "true";
  const rows = await getStockReportRows({
    ...(categoryId === undefined ? {} : { categoryId }),
    ...(query.search
      ? {
          OR: [
            { itemCode: { contains: query.search, mode: "insensitive" } },
            { name: { contains: query.search, mode: "insensitive" } },
          ],
        }
      : {}),
  });
  const filtered = rows.filter((row) =>
    outOfStock ? row.status === "OUT_OF_STOCK" : lowStock ? row.status !== "HEALTHY" : true
  );
  const sorted = [...filtered].sort((a, b) => {
    const field =
      query.sortBy && REPORT_SORT_FIELDS.includes(query.sortBy)
        ? query.sortBy
        : "itemName";
    const left = a[field as keyof StockReportRow];
    const right = b[field as keyof StockReportRow];
    const comparison = String(left).localeCompare(String(right), undefined, {
      numeric: true,
      sensitivity: "base",
    });
    return query.sortDir === "desc" ? -comparison : comparison;
  });
  const start = (query.page - 1) * query.pageSize;
  res.json({
    data: sorted.slice(start, start + query.pageSize),
    pagination: toPaginationMeta(query, sorted.length),
  });
});

router.get("/stock/movements", async (req, res) => {
  const query = parseListQuery(
    new URLSearchParams(req.query as Record<string, string>)
  );
  const type = typeof req.query.type === "string" ? req.query.type : undefined;
  if (type !== undefined && !TRANSACTION_TYPES.includes(type as TransactionType)) {
    res.status(400).json({ error: "Invalid transaction type" });
    return;
  }
  const from = parseDate(req.query.from);
  const to = parseDate(req.query.to);
  const itemId =
    req.query.itemId === undefined ? undefined : Number(req.query.itemId);
  if (itemId !== undefined && !Number.isInteger(itemId)) {
    res.status(400).json({ error: "Invalid item id" });
    return;
  }
  if (from === undefined || to === undefined) {
    res.status(400).json({ error: "Dates must be valid ISO dates" });
    return;
  }
  const where: Prisma.StockTransactionWhereInput = {
    ...(type ? { type: type as TransactionType } : {}),
    ...(itemId === undefined ? {} : { itemId }),
    ...(from || to
      ? {
          transactionDate: {
            ...(from ? { gte: from } : {}),
            ...(to ? { lt: to } : {}),
          },
        }
      : {}),
  };
  const [data, total, allRows] = await Promise.all([
    prisma.stockTransaction.findMany({
      where,
      include: {
        item: { select: { id: true, itemCode: true, name: true } },
        fromLocation: { select: { id: true, name: true } },
        toLocation: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
      },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      orderBy: toPrismaOrderBy(query, MOVEMENT_SORT_FIELDS, "transactionDate"),
    }),
    prisma.stockTransaction.count({ where }),
    prisma.stockTransaction.findMany({ where, select: { type: true, quantity: true } }),
  ]);
  res.json({
    data,
    pagination: toPaginationMeta(query, total),
    totals: movementTotals(allRows),
  });
});

router.get("/stock/locations", async (req, res) => {
  const query = parseListQuery(
    new URLSearchParams(req.query as Record<string, string>)
  );
  const locationId =
    req.query.locationId === undefined ? undefined : Number(req.query.locationId);
  if (locationId !== undefined && !Number.isInteger(locationId)) {
    res.status(400).json({ error: "Invalid location id" });
    return;
  }
  const rows = await prisma.locationStockBalance.findMany({
    where: locationId === undefined ? {} : { locationId },
    include: {
      item: { select: { id: true, itemCode: true, name: true, minimumStock: true } },
      location: { select: { id: true, name: true } },
    },
  });
  const total = await prisma.locationStockBalance.count({
    where: locationId === undefined ? {} : { locationId },
  });
  const data = rows
    .map((row) => ({
      itemId: row.item.id,
      itemCode: row.item.itemCode,
      itemName: row.item.name,
      locationId: row.location.id,
      locationName: row.location.name,
      quantity: row.quantity,
      minimumStock: row.item.minimumStock,
    }))
    .sort((left, right) => {
      const field =
        query.sortBy && ["itemCode", "itemName", "locationName", "quantity"].includes(query.sortBy)
          ? query.sortBy
          : "itemCode";
      const comparison = String(left[field as keyof typeof left]).localeCompare(
        String(right[field as keyof typeof right]),
        undefined,
        { numeric: true, sensitivity: "base" }
      );
      return query.sortDir === "desc" ? -comparison : comparison;
    });
  res.json({
    data: data.slice((query.page - 1) * query.pageSize, query.page * query.pageSize),
    pagination: toPaginationMeta(query, total),
  });
});

router.get("/purchase-orders/progress", async (req, res) => {
  const query = parseListQuery(
    new URLSearchParams(req.query as Record<string, string>)
  );
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  if (status !== undefined && !PO_STATUSES.includes(status as PurchaseOrderStatus)) {
    res.status(400).json({ error: "Invalid purchase-order status" });
    return;
  }
  const where: Prisma.PurchaseOrderWhereInput = status
    ? { status: status as PurchaseOrderStatus }
    : {};
  const [orders, total] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where,
      include: {
        supplier: { select: { id: true, name: true } },
        items: { select: { quantityOrdered: true, quantityReceived: true } },
      },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      orderBy: toPrismaOrderBy(query, ["poNumber", "orderDate", "status"], "orderDate"),
    }),
    prisma.purchaseOrder.count({ where }),
  ]);
  res.json({
    data: orders.map(({ items, ...order }) => ({ ...order, ...calculateReceiptProgress(items) })),
    pagination: toPaginationMeta(query, total),
  });
});

router.get("/assets/status", async (_req, res) => {
  const grouped = await prisma.serializedAsset.groupBy({
    by: ["status"],
    _count: { _all: true },
  });
  const counts = ASSET_STATUSES.map((status) => ({
    status,
    count: grouped.find((row) => row.status === status)?._count._all ?? 0,
  }));
  res.json(counts);
});

router.get("/stock/movements.csv", async (req, res) => {
  const type = typeof req.query.type === "string" ? req.query.type : undefined;
  if (type !== undefined && !TRANSACTION_TYPES.includes(type as TransactionType)) {
    res.status(400).json({ error: "Invalid transaction type" });
    return;
  }
  const rows = await prisma.stockTransaction.findMany({
    where: type ? { type: type as TransactionType } : {},
    orderBy: { transactionDate: "desc" },
    take: 10000,
    include: { item: { select: { itemCode: true, name: true } } },
  });
  const lines = [
    ["id", "transactionDate", "type", "itemCode", "itemName", "quantity"].map(csvCell).join(","),
    ...rows.map((row) =>
      [row.id, row.transactionDate.toISOString(), row.type, row.item.itemCode, row.item.name, row.quantity]
        .map(csvCell)
        .join(",")
    ),
  ];
  res.type("text/csv").send(lines.join("\r\n"));
});

export default router;
