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
  InvalidIdempotencyKeyError,
  parseIdempotencyKey,
} from "../src/services/stock-idempotency.service";
import {
  assertReceiptState,
  getReceiptStatus,
  InvalidReceiptStateError,
  isAllowedPurchaseOrderTransition,
} from "../src/services/purchase-order-receiving.service";
import { getLocationChanges } from "../src/services/location-stock.service";

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
