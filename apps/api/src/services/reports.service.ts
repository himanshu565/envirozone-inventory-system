import type { AssetStatus, Prisma, TransactionType } from "@prisma/client";
import { prisma } from "../lib/db";
import { getSignedStockDelta } from "./stock-ledger";

export type StockReportRow = {
  itemId: number;
  itemCode: string;
  itemName: string;
  category: { id: number; name: string };
  trackingMode: string;
  currentStock: number;
  minimumStock: number;
  variance: number;
  status: "OUT_OF_STOCK" | "LOW_STOCK" | "HEALTHY";
};

export function classifyStock(
  currentStock: number,
  minimumStock: number
): StockReportRow["status"] {
  if (currentStock <= 0) return "OUT_OF_STOCK";
  if (currentStock < minimumStock) return "LOW_STOCK";
  return "HEALTHY";
}

export function calculateReceiptProgress(
  lines: Array<{ quantityOrdered: number; quantityReceived: number }>
) {
  const orderedQuantity = lines.reduce((sum, line) => sum + line.quantityOrdered, 0);
  const receivedQuantity = lines.reduce((sum, line) => sum + line.quantityReceived, 0);
  const remainingQuantity = Math.max(0, orderedQuantity - receivedQuantity);
  return {
    orderedQuantity,
    receivedQuantity,
    remainingQuantity,
    receiptProgressPercent:
      orderedQuantity === 0 ? 0 : Math.round((receivedQuantity / orderedQuantity) * 100),
  };
}

export async function getStockReportRows(
  where: Prisma.ItemWhereInput = {}
): Promise<StockReportRow[]> {
  const items = await prisma.item.findMany({
    where,
    select: {
      id: true,
      itemCode: true,
      name: true,
      minimumStock: true,
      trackingMode: true,
      category: { select: { id: true, name: true } },
    },
  });

  const stock = new Map<number, number>(items.map((item) => [item.id, 0]));
  if (items.length > 0) {
    const grouped = await prisma.stockTransaction.groupBy({
      by: ["itemId", "type"],
      where: { itemId: { in: items.map((item) => item.id) } },
      _sum: { quantity: true },
    });
    for (const row of grouped) {
      const quantity = row._sum.quantity ?? 0;
      stock.set(
        row.itemId,
        (stock.get(row.itemId) ?? 0) +
          getSignedStockDelta(row.type, quantity)
      );
    }
  }

  return items.map((item) => {
    const currentStock = stock.get(item.id) ?? 0;
    return {
      itemId: item.id,
      itemCode: item.itemCode,
      itemName: item.name,
      category: item.category,
      trackingMode: item.trackingMode,
      currentStock,
      minimumStock: item.minimumStock,
      variance: currentStock - item.minimumStock,
      status: classifyStock(currentStock, item.minimumStock),
    };
  });
}

export function movementTotals(
  rows: Array<{ type: TransactionType; quantity: number }>
) {
  const totals = { inward: 0, outward: 0, adjustment: 0, transfer: 0, netChange: 0 };
  for (const row of rows) {
    if (row.type === "INWARD") totals.inward += row.quantity;
    if (row.type === "OUTWARD") totals.outward += row.quantity;
    if (row.type === "ADJUSTMENT") totals.adjustment += row.quantity;
    if (row.type === "TRANSFER") totals.transfer += row.quantity;
    totals.netChange += getSignedStockDelta(row.type, row.quantity);
  }
  return totals;
}

export type AssetStatusCount = { status: AssetStatus; count: number };
