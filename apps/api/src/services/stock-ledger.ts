export type StockMovementType =
  | "INWARD"
  | "OUTWARD"
  | "ADJUSTMENT"
  | "TRANSFER";

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
  if (type === "TRANSFER") return 0;
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

export class InvalidStockQuantityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidStockQuantityError";
  }
}

/** Enforce the quantity rules shared by every stock writer. */
export function validateStockQuantity(
  type: StockMovementType,
  quantity: number
): void {
  if (!Number.isInteger(quantity) || quantity === 0) {
    throw new InvalidStockQuantityError(
      "Quantity must be a non-zero whole number"
    );
  }
  if (type !== "ADJUSTMENT" && quantity < 0) {
    throw new InvalidStockQuantityError(
      "Quantity must be positive for inward/outward movements"
    );
  }
}

/** Reject a subtractive operation that would make an item's stock negative. */
export function assertNonNegativeStock(currentStock: number, change: number): void {
  if (change < 0 && currentStock + change < 0) {
    throw new InsufficientStockError(currentStock, change);
  }
}

/** Validate a ledger movement using the shared transaction sign convention. */
export function assertStockChangeAllowed(
  currentStock: number,
  type: StockMovementType,
  quantity: number
): void {
  assertNonNegativeStock(currentStock, getSignedStockDelta(type, quantity));
}
