import assert from "node:assert/strict";
import test from "node:test";
import {
  assertNonNegativeStock,
  calculateCurrentStock,
  getSignedStockDelta,
  InsufficientStockError,
} from "../src/services/stock-ledger";

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
