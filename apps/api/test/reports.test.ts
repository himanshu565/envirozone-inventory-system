import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateReceiptProgress,
  classifyStock,
  movementTotals,
} from "../src/services/reports.service";

test("stock report classification follows minimum stock semantics", () => {
  assert.equal(classifyStock(0, 3), "OUT_OF_STOCK");
  assert.equal(classifyStock(2, 3), "LOW_STOCK");
  assert.equal(classifyStock(3, 3), "HEALTHY");
});

test("movement report totals reconcile with the trusted ledger signs", () => {
  assert.deepEqual(
    movementTotals([
      { type: "INWARD", quantity: 10 },
      { type: "OUTWARD", quantity: 4 },
      { type: "ADJUSTMENT", quantity: -1 },
      { type: "TRANSFER", quantity: 6 },
    ]),
    {
      inward: 10,
      outward: 4,
      adjustment: -1,
      transfer: 6,
      netChange: 5,
    }
  );
});

test("purchase-order report progress derives from ordered and received counters", () => {
  assert.deepEqual(
    calculateReceiptProgress([
      { quantityOrdered: 10, quantityReceived: 4 },
      { quantityOrdered: 5, quantityReceived: 5 },
    ]),
    {
      orderedQuantity: 15,
      receivedQuantity: 9,
      remainingQuantity: 6,
      receiptProgressPercent: 60,
    }
  );
});
