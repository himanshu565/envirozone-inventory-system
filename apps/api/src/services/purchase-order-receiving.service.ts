import { createHash } from "node:crypto";
import type { PurchaseOrderStatus } from "@prisma/client";

export const PURCHASE_ORDER_RECEIVE_OPERATION = "purchase-order.receive";

export class InvalidReceiptStateError extends Error {
  constructor(status: PurchaseOrderStatus) {
    super(`Purchase order cannot receive stock while in ${status} state`);
    this.name = "InvalidReceiptStateError";
  }
}

export class ReceiptIdempotencyConflictError extends Error {
  constructor() {
    super("Idempotency-Key was already used with a different receipt request");
    this.name = "ReceiptIdempotencyConflictError";
  }
}

export function assertReceiptState(status: PurchaseOrderStatus): void {
  if (status !== "SENT" && status !== "PARTIALLY_RECEIVED") {
    throw new InvalidReceiptStateError(status);
  }
}

export function isAllowedPurchaseOrderTransition(
  from: PurchaseOrderStatus,
  to: PurchaseOrderStatus
): boolean {
  if (from === to) return true;
  const transitions: Record<PurchaseOrderStatus, readonly PurchaseOrderStatus[]> = {
    DRAFT: ["SENT", "CANCELLED"],
    SENT: ["PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"],
    PARTIALLY_RECEIVED: ["RECEIVED", "CANCELLED"],
    RECEIVED: [],
    CANCELLED: [],
  };
  return transitions[from].includes(to);
}

export function getReceiptStatus(
  quantities: readonly { quantityReceived: number; quantityOrdered: number }[],
  currentStatus: PurchaseOrderStatus
): PurchaseOrderStatus {
  const fullyReceived = quantities.every(
    (item) => item.quantityReceived >= item.quantityOrdered
  );
  if (fullyReceived) return "RECEIVED";
  if (quantities.some((item) => item.quantityReceived > 0)) {
    return "PARTIALLY_RECEIVED";
  }
  return currentStatus;
}

export function hashReceiptRequest(input: {
  purchaseOrderId: number;
  receipts: readonly { itemId: number; quantity: number }[];
  toLocationId: number | null;
}): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}
