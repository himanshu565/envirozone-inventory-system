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

  // Edge cases: empty lines and over-received clamping
  assert.deepEqual(calculateReceiptProgress([]), {
    orderedQuantity: 0,
    receivedQuantity: 0,
    remainingQuantity: 0,
    receiptProgressPercent: 0,
  });

  assert.deepEqual(
    calculateReceiptProgress([{ quantityOrdered: 5, quantityReceived: 5 }]),
    {
      orderedQuantity: 5,
      receivedQuantity: 5,
      remainingQuantity: 0,
      receiptProgressPercent: 100,
    }
  );
});

test("movementTotals accurately calculates net stock change matching the trusted ledger formula", () => {
  const transactions = [
    { type: "INWARD" as const, quantity: 50 },
    { type: "OUTWARD" as const, quantity: 20 },
    { type: "ADJUSTMENT" as const, quantity: -5 },
    { type: "ADJUSTMENT" as const, quantity: 15 },
    { type: "TRANSFER" as const, quantity: 30 },
  ];

  const totals = movementTotals(transactions);
  assert.equal(totals.inward, 50);
  assert.equal(totals.outward, 20);
  assert.equal(totals.adjustment, 10); // -5 + 15
  assert.equal(totals.transfer, 30);
  // Net change formula: inward (50) - outward (20) + signed adjustments (+10) + transfers (0) = 40
  assert.equal(totals.netChange, 40);
  assert.equal(totals.netChange, totals.inward - totals.outward + totals.adjustment);
});

test("calibration due urgency correctly differentiates overdue, due soon, and uncalibrated", () => {
  const now = new Date();
  const pastDate = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 1 day ago
  const nearFuture = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000); // 10 days ahead
  const distantFuture = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000); // 60 days ahead
  const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  function evaluateUrgency(nextDueDate: Date | null) {
    if (!nextDueDate) {
      return { isOverdue: false, isDueSoon: false, isUncalibrated: true };
    }
    const isOverdue = nextDueDate < now;
    const isDueSoon = nextDueDate <= thirtyDaysFromNow && !isOverdue;
    return { isOverdue, isDueSoon, isUncalibrated: false };
  }

  // Uncalibrated
  assert.deepEqual(evaluateUrgency(null), {
    isOverdue: false,
    isDueSoon: false,
    isUncalibrated: true,
  });

  // Overdue
  assert.deepEqual(evaluateUrgency(pastDate), {
    isOverdue: true,
    isDueSoon: false,
    isUncalibrated: false,
  });

  // Due soon (within 30 days)
  assert.deepEqual(evaluateUrgency(nearFuture), {
    isOverdue: false,
    isDueSoon: true,
    isUncalibrated: false,
  });

  // Distant future (> 30 days)
  assert.deepEqual(evaluateUrgency(distantFuture), {
    isOverdue: false,
    isDueSoon: false,
    isUncalibrated: false,
  });
});
