import { createHash } from "node:crypto";
import type { TransactionType } from "@prisma/client";

export const STOCK_TRANSACTION_OPERATION = "stock.transaction.create";

export class InvalidIdempotencyKeyError extends Error {
  constructor() {
    super(
      "Idempotency-Key must be 1-255 printable ASCII characters without surrounding whitespace"
    );
    this.name = "InvalidIdempotencyKeyError";
  }
}

export type StockTransactionRequest = {
  type: TransactionType;
  itemId: number;
  quantity: number;
  supplierId: number | null;
  fromLocationId: number | null;
  toLocationId: number | null;
  referenceNumber: string | null;
  remarks: string | null;
};

export function parseIdempotencyKey(value: string | undefined): string | null {
  if (value === undefined) return null;
  if (
    value.length === 0 ||
    value.length > 255 ||
    value.trim() !== value ||
    !/^[\x21-\x7e]+$/.test(value)
  ) {
    throw new InvalidIdempotencyKeyError();
  }
  return value;
}

export function hashStockTransactionRequest(
  request: StockTransactionRequest
): string {
  return createHash("sha256")
    .update(JSON.stringify(request))
    .digest("hex");
}
