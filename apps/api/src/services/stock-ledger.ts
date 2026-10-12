export type StockMovementType = "INWARD" | "OUTWARD" | "ADJUSTMENT";

export type StockAggregate = {
  type: StockMovementType;
  _sum: { quantity: number | null };
};

/** Applies the sign convention used by the existing stock ledger. */
export function getSignedStockDelta(
  type: StockMovementType,
  quantity: number
): number {
  if (type === "INWARD") return quantity;
  if (type === "OUTWARD") return -quantity;
  return quantity;
}

/** Calculates a balance from aggregates scoped to one item. */
export function calculateCurrentStock(
  aggregates: readonly StockAggregate[]
): number {
  return aggregates.reduce(
    (balance, row) =>
      balance + getSignedStockDelta(row.type, row._sum.quantity ?? 0),
    0
  );
}

export class InsufficientStockError extends Error {
  constructor(currentStock: number, change: number) {
    super(
      `Stock change would make inventory negative (current stock: ${currentStock}, change: ${change}).`
    );
    this.name = "InsufficientStockError";
  }
}

/** Reject a subtractive operation that would make an item's stock negative. */
export function assertNonNegativeStock(currentStock: number, change: number): void {
  if (change < 0 && currentStock + change < 0) {
    throw new InsufficientStockError(currentStock, change);
  }
}
