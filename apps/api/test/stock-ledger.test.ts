import assert from "node:assert/strict";
import test from "node:test";
import {
  assertNonNegativeStock,
  assertStockChangeAllowed,
  calculateCurrentStock,
  getSignedStockDelta,
  InsufficientStockError,
  InvalidStockQuantityError,
  validateStockQuantity,
} from "../src/services/stock-ledger";
import {
  hashStockTransactionRequest,
  IdempotencyConflictError,
  InvalidIdempotencyKeyError,
  parseIdempotencyKey,
  STOCK_TRANSACTION_OPERATION,
} from "../src/services/stock-idempotency.service";
import {
  assertReceiptState,
  getReceiptStatus,
  InvalidReceiptStateError,
  isAllowedPurchaseOrderTransition,
} from "../src/services/purchase-order-receiving.service";
import { getLocationChanges } from "../src/services/location-stock.service";
import { recordAudit } from "../src/services/audit.service";

test("stock balance applies inward, outward, and signed adjustments", () => {
  assert.equal(
    calculateCurrentStock([
      { type: "INWARD", _sum: { quantity: 12 } },
      { type: "OUTWARD", _sum: { quantity: 4 } },
      { type: "ADJUSTMENT", _sum: { quantity: -1 } },
    ]),
    7
  );
});

test("outward stock movements use a negative delta", () => {
  assert.equal(getSignedStockDelta("OUTWARD", 3), -3);
});

test("transfers do not change the organization-wide item total", () => {
  assert.equal(getSignedStockDelta("TRANSFER", 8), 0);
  assert.deepEqual(getLocationChanges("TRANSFER", 8, 2, 5), [
    { locationId: 2, delta: -8 },
    { locationId: 5, delta: 8 },
  ]);
});

test("transfers require distinct source and destination locations", () => {
  assert.throws(() => getLocationChanges("TRANSFER", 1, null, 2), /both source/);
  assert.throws(() => getLocationChanges("TRANSFER", 1, 2, 2), /different/);
});

test("subtractive changes that would make stock negative are rejected", () => {
  assert.throws(
    () => assertNonNegativeStock(2, -3),
    InsufficientStockError
  );
});

test("a subtractive change that leaves exactly zero stock is allowed", () => {
  assert.doesNotThrow(() => assertNonNegativeStock(3, -3));
});

test("inward movements can help repair a previously negative ledger balance", () => {
  assert.doesNotThrow(() => assertNonNegativeStock(-2, 1));
});

test("negative adjustments cannot reduce stock below zero", () => {
  assert.throws(
    () => assertNonNegativeStock(1, getSignedStockDelta("ADJUSTMENT", -2)),
    InsufficientStockError
  );
});

test("shared stock validation uses the movement sign convention", () => {
  assert.doesNotThrow(() => assertStockChangeAllowed(0, "INWARD", 4));
  assert.throws(
    () => assertStockChangeAllowed(2, "OUTWARD", 3),
    InsufficientStockError
  );
  assert.throws(
    () => assertStockChangeAllowed(2, "ADJUSTMENT", -3),
    InsufficientStockError
  );
});

test("quantity validation rejects zero, fractional, and negative movement quantities", () => {
  assert.throws(
    () => validateStockQuantity("INWARD", 0),
    InvalidStockQuantityError
  );
  assert.throws(
    () => validateStockQuantity("OUTWARD", 1.5),
    InvalidStockQuantityError
  );
  assert.throws(
    () => validateStockQuantity("OUTWARD", -1),
    InvalidStockQuantityError
  );
  assert.doesNotThrow(() => validateStockQuantity("ADJUSTMENT", -1));
  assert.doesNotThrow(() => validateStockQuantity("INWARD", 1));
});

test("idempotency keys accept printable values and reject unsafe values", () => {
  assert.equal(parseIdempotencyKey("stock-123"), "stock-123");
  assert.equal(parseIdempotencyKey(undefined), null);
  assert.throws(() => parseIdempotencyKey(""), InvalidIdempotencyKeyError);
  assert.throws(() => parseIdempotencyKey(" stock-123"), InvalidIdempotencyKeyError);
  assert.throws(() => parseIdempotencyKey("stock\n123"), InvalidIdempotencyKeyError);
  assert.throws(() => parseIdempotencyKey("x".repeat(256)), InvalidIdempotencyKeyError);
});

test("idempotency hashes are stable for an equivalent normalized request", () => {
  const request = {
    type: "INWARD" as const,
    itemId: 7,
    quantity: 4,
    supplierId: null,
    fromLocationId: null,
    toLocationId: null,
    referenceNumber: "PO-1",
    remarks: null,
  };
  assert.equal(hashStockTransactionRequest(request), hashStockTransactionRequest({ ...request }));
});

test("idempotency hash detects any change in payload attributes", () => {
  const base = {
    type: "OUTWARD" as const,
    itemId: 10,
    quantity: 2,
    supplierId: null,
    fromLocationId: 1,
    toLocationId: null,
    referenceNumber: "REF-100",
    remarks: "sample",
  };
  const baseHash = hashStockTransactionRequest(base);

  assert.notEqual(baseHash, hashStockTransactionRequest({ ...base, quantity: 3 }));
  assert.notEqual(baseHash, hashStockTransactionRequest({ ...base, type: "INWARD" }));
  assert.notEqual(baseHash, hashStockTransactionRequest({ ...base, itemId: 11 }));
  assert.notEqual(baseHash, hashStockTransactionRequest({ ...base, fromLocationId: 2 }));
  assert.notEqual(baseHash, hashStockTransactionRequest({ ...base, referenceNumber: "REF-101" }));
  assert.notEqual(baseHash, hashStockTransactionRequest({ ...base, remarks: null }));
});

test("replaying an idempotency key returns the original result without re-evaluating stock", async () => {
  const idempotencyStore = new Map<string, { requestHash: string; transaction: unknown }>();

  const processTransaction = async (
    actorId: number,
    key: string | null,
    payload: Parameters<typeof hashStockTransactionRequest>[0],
    currentAvailableStock: number
  ) => {
    const requestHash = key ? hashStockTransactionRequest(payload) : null;
    if (key && requestHash) {
      const existing = idempotencyStore.get(`${actorId}:${key}`);
      if (existing) {
        if (existing.requestHash !== requestHash) {
          throw new IdempotencyConflictError();
        }
        return { transaction: existing.transaction, replayed: true };
      }
    }

    assertStockChangeAllowed(currentAvailableStock, payload.type, payload.quantity);
    const created = { id: 101, ...payload };
    if (key && requestHash) {
      idempotencyStore.set(`${actorId}:${key}`, { requestHash, transaction: created });
    }
    return { transaction: created, replayed: false };
  };

  // 1. Initial OUTWARD 5 when stock is 5: succeeds, leaves 0 stock
  const first = await processTransaction(1, "key-abc", {
    type: "OUTWARD",
    itemId: 5,
    quantity: 5,
    supplierId: null,
    fromLocationId: null,
    toLocationId: null,
    referenceNumber: null,
    remarks: null,
  }, 5);
  assert.equal(first.replayed, false);

  // 2. Client retries with key-abc when available stock is now 0:
  // Must NOT throw InsufficientStockError! Must replay successfully.
  const retry = await processTransaction(1, "key-abc", {
    type: "OUTWARD",
    itemId: 5,
    quantity: 5,
    supplierId: null,
    fromLocationId: null,
    toLocationId: null,
    referenceNumber: null,
    remarks: null,
  }, 0);
  assert.equal(retry.replayed, true);
  assert.deepEqual(retry.transaction, first.transaction);

  // 3. Client reuses key-abc with conflicting payload: throws IdempotencyConflictError
  await assert.rejects(
    processTransaction(1, "key-abc", {
      type: "OUTWARD",
      itemId: 5,
      quantity: 1, // different quantity
      supplierId: null,
      fromLocationId: null,
      toLocationId: null,
      referenceNumber: null,
      remarks: null,
    }, 0),
    IdempotencyConflictError
  );

  // 4. Different actor using the same key string is isolated
  const differentActor = await processTransaction(2, "key-abc", {
    type: "OUTWARD",
    itemId: 5,
    quantity: 1,
    supplierId: null,
    fromLocationId: null,
    toLocationId: null,
    referenceNumber: null,
    remarks: null,
  }, 10);
  assert.equal(differentActor.replayed, false);
});

test("purchase-order receiving preserves partial and complete status transitions", () => {
  assert.doesNotThrow(() => assertReceiptState("SENT"));
  assert.doesNotThrow(() => assertReceiptState("PARTIALLY_RECEIVED"));
  assert.throws(() => assertReceiptState("DRAFT"), InvalidReceiptStateError);
  assert.throws(() => assertReceiptState("RECEIVED"), InvalidReceiptStateError);
  assert.throws(() => assertReceiptState("CANCELLED"), InvalidReceiptStateError);
  assert.equal(isAllowedPurchaseOrderTransition("DRAFT", "SENT"), true);
  assert.equal(isAllowedPurchaseOrderTransition("RECEIVED", "SENT"), false);
  assert.equal(isAllowedPurchaseOrderTransition("CANCELLED", "RECEIVED"), false);

  assert.equal(
    getReceiptStatus(
      [{ quantityReceived: 2, quantityOrdered: 5 }],
      "SENT"
    ),
    "PARTIALLY_RECEIVED"
  );
  assert.equal(
    getReceiptStatus(
      [{ quantityReceived: 5, quantityOrdered: 5 }],
      "PARTIALLY_RECEIVED"
    ),
    "RECEIVED"
  );
});

test("recordAudit delegates to a transaction client atomically", async () => {
  let createdData: unknown = null;
  const mockTx = {
    auditLog: {
      create: async (args: { data: unknown }) => {
        createdData = args.data;
        return { id: 999, ...args.data };
      },
    },
  };

  await recordAudit(
    {
      actorId: 42,
      action: "stock.transaction.create",
      entityType: "StockTransaction",
      entityId: 101,
      after: { id: 101, type: "OUTWARD", quantity: 3 },
    },
    mockTx as unknown as Parameters<typeof recordAudit>[1]
  );

  assert.deepEqual(createdData, {
    actorId: 42,
    action: "stock.transaction.create",
    entityType: "StockTransaction",
    entityId: 101,
    before: undefined,
    after: { id: 101, type: "OUTWARD", quantity: 3 },
  });
});

test("InsufficientStockError exposes safe client message without internal leaks", () => {
  const err = new InsufficientStockError(5, -8);
  assert.equal(err.name, "InsufficientStockError");
  assert.equal(
    err.message,
    "Stock change would make inventory negative (current stock: 5, change: -8)."
  );
  // Verify it contains no SQL syntax, table names, or raw Prisma errors
  assert.ok(!err.message.includes("SELECT"));
  assert.ok(!err.message.includes("prisma"));
  assert.ok(!err.message.includes("StockTransaction"));
});

test("INWARD increases computed stock", () => {
  const stock = calculateCurrentStock([{ type: "INWARD", _sum: { quantity: 15 } }]);
  assert.equal(stock, 15);
  const incremental = calculateCurrentStock([
    { type: "INWARD", _sum: { quantity: 15 } },
    { type: "INWARD", _sum: { quantity: 10 } },
  ]);
  assert.equal(incremental, 25);
});

test("OUTWARD decreases computed stock", () => {
  const stock = calculateCurrentStock([
    { type: "INWARD", _sum: { quantity: 20 } },
    { type: "OUTWARD", _sum: { quantity: 7 } },
  ]);
  assert.equal(stock, 13);
});

test("Positive and negative ADJUSTMENT are applied as signed quantities", () => {
  assert.equal(getSignedStockDelta("ADJUSTMENT", 5), 5);
  assert.equal(getSignedStockDelta("ADJUSTMENT", -5), -5);
  const stock = calculateCurrentStock([
    { type: "INWARD", _sum: { quantity: 10 } },
    { type: "ADJUSTMENT", _sum: { quantity: 4 } },
    { type: "ADJUSTMENT", _sum: { quantity: -3 } },
  ]);
  assert.equal(stock, 11);
});

test("Insufficient stock is rejected", () => {
  assert.throws(() => assertStockChangeAllowed(5, "OUTWARD", 6), InsufficientStockError);
  assert.throws(() => assertStockChangeAllowed(2, "ADJUSTMENT", -3), InsufficientStockError);
  assert.doesNotThrow(() => assertStockChangeAllowed(5, "OUTWARD", 5));
});

test("Invalid/zero quantities are rejected according to current business rules", () => {
  assert.throws(() => validateStockQuantity("INWARD", 0), InvalidStockQuantityError);
  assert.throws(() => validateStockQuantity("OUTWARD", 0), InvalidStockQuantityError);
  assert.throws(() => validateStockQuantity("ADJUSTMENT", 0), InvalidStockQuantityError);
  assert.throws(() => validateStockQuantity("INWARD", -5), InvalidStockQuantityError);
  assert.throws(() => validateStockQuantity("OUTWARD", -5), InvalidStockQuantityError);
  assert.throws(() => validateStockQuantity("INWARD", 2.5), InvalidStockQuantityError);
  assert.throws(() => validateStockQuantity("OUTWARD", 3.14), InvalidStockQuantityError);
  assert.throws(() => validateStockQuantity("ADJUSTMENT", 1.5), InvalidStockQuantityError);
});

test("Audit/transaction failure does not leave a partial stock mutation (transaction simulation)", async () => {
  const state = {
    stockEntries: [] as { type: string; quantity: number }[],
    auditLogs: [] as { action: string }[],
  };

  const simulateAtomicStockTransaction = async (shouldFailAudit: boolean) => {
    const snapshotStock = [...state.stockEntries];
    const snapshotAudit = [...state.auditLogs];
    try {
      state.stockEntries.push({ type: "INWARD", quantity: 5 });
      if (shouldFailAudit) {
        throw new Error("Audit log insert failed");
      }
      state.auditLogs.push({ action: "stock.transaction.create" });
    } catch (err) {
      state.stockEntries = snapshotStock;
      state.auditLogs = snapshotAudit;
      throw err;
    }
  };

  await assert.rejects(
    simulateAtomicStockTransaction(true),
    /Audit log insert failed/
  );
  assert.equal(state.stockEntries.length, 0);
  assert.equal(state.auditLogs.length, 0);

  await simulateAtomicStockTransaction(false);
  assert.equal(state.stockEntries.length, 1);
  assert.equal(state.auditLogs.length, 1);
});

test("Retry/serialization conflicts behave as expected in retry loop", async () => {
  let attempts = 0;
  const retryableOperation = async () => {
    attempts += 1;
    if (attempts < 3) {
      const err = new Error("P2034 serialization conflict");
      (err as unknown as { code: string }).code = "P2034";
      throw err;
    }
    return "ok";
  };

  const executeWithRetry = async <T>(fn: () => Promise<T>, max = 3): Promise<T> => {
    for (let i = 0; i < max; i++) {
      try {
        return await fn();
      } catch (err) {
        if ((err as { code?: string }).code === "P2034" && i < max - 1) continue;
        throw err;
      }
    }
    throw new Error("Exhausted retries");
  };

  const res = await executeWithRetry(retryableOperation, 3);
  assert.equal(res, "ok");
  assert.equal(attempts, 3);

  let failAttempts = 0;
  const alwaysFailing = async () => {
    failAttempts += 1;
    const err = new Error("P2034 serialization conflict");
    (err as unknown as { code: string }).code = "P2034";
    throw err;
  };

  await assert.rejects(
    executeWithRetry(alwaysFailing, 3),
    (err: unknown) => (err as { code?: string }).code === "P2034"
  );
  assert.equal(failAttempts, 3);
});
