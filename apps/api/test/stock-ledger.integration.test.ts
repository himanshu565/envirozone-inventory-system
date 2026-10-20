import assert from "node:assert/strict";
import test from "node:test";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  assertStockChangeAllowed,
  calculateCurrentStock,
  InsufficientStockError,
  validateStockQuantity,
} from "../src/services/stock-ledger";
import {
  hashStockTransactionRequest,
  STOCK_TRANSACTION_OPERATION,
} from "../src/services/stock-idempotency.service";
import {
  applyLocationStockChanges,
} from "../src/services/location-stock.service";

const testUrl = process.env.STOCK_TEST_DATABASE_URL;
const configuredDatabaseUrl = process.env.DATABASE_URL;

function getSkipReason(): string | null {
  if (!testUrl) return "STOCK_TEST_DATABASE_URL is not configured";
  if (testUrl === configuredDatabaseUrl) {
    return "STOCK_TEST_DATABASE_URL must not equal DATABASE_URL";
  }

  let parsed: URL;
  try {
    parsed = new URL(testUrl);
  } catch {
    return "STOCK_TEST_DATABASE_URL is not a valid PostgreSQL URL";
  }

  if (!["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) {
    return "STOCK_TEST_DATABASE_URL must point to a local disposable PostgreSQL instance";
  }

  const databaseName = parsed.pathname.replace(/^\/+/, "").toLowerCase();
  if (!/(test|ci|tmp|temp)/.test(databaseName)) {
    return "STOCK_TEST_DATABASE_URL database name must contain test, ci, tmp, or temp";
  }
  if (/(prod|production|dev|development)/.test(databaseName)) {
    return "STOCK_TEST_DATABASE_URL database name looks like a production/development database";
  }
  return null;
}

const skipReason = getSkipReason();
const integrationTest = skipReason ? test.skip : test;
const client = testUrl
  ? new PrismaClient({
      adapter: new PrismaPg({ connectionString: testUrl }),
    })
  : null;

type Fixture = {
  categoryId: number;
  itemId: number;
  userId: number;
  sourceLocationId: number;
  destinationLocationId: number;
};

function requireClient(): PrismaClient {
  if (!client) throw new Error("Integration database is not configured");
  return client;
}

async function createFixture(): Promise<Fixture> {
  const db = requireClient();
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const category = await db.category.create({
    data: { name: `stock-test-${suffix}` },
  });
  const user = await db.user.create({
    data: {
      name: `Stock Test ${suffix}`,
      email: `stock-test-${suffix}@example.invalid`,
      password: "not-used",
      role: "ADMIN",
    },
  });
  const item = await db.item.create({
    data: {
      itemCode: `stock-test-${suffix}`,
      name: `Stock Test ${suffix}`,
      categoryId: category.id,
    },
  });
  const source = await db.location.create({
    data: { name: `stock-test-source-${suffix}`, type: "WAREHOUSE" },
  });
  const destination = await db.location.create({
    data: { name: `stock-test-destination-${suffix}`, type: "SITE" },
  });
  return {
    categoryId: category.id,
    itemId: item.id,
    userId: user.id,
    sourceLocationId: source.id,
    destinationLocationId: destination.id,
  };
}

async function cleanupFixture(fixture: Fixture): Promise<void> {
  const db = requireClient();
  await db.auditLog.deleteMany({ where: { actorId: fixture.userId } });
  await db.locationStockBalance.deleteMany({ where: { itemId: fixture.itemId } });
  await db.stockTransaction.deleteMany({ where: { itemId: fixture.itemId } });
  await db.item.delete({ where: { id: fixture.itemId } });
  await db.location.deleteMany({
    where: { id: { in: [fixture.sourceLocationId, fixture.destinationLocationId] } },
  });
  await db.user.delete({ where: { id: fixture.userId } });
  await db.category.delete({ where: { id: fixture.categoryId } });
}

async function getStock(itemId: number): Promise<number> {
  const db = requireClient();
  const totals = await db.stockTransaction.groupBy({
    by: ["type"],
    where: { itemId },
    _sum: { quantity: true },
  });
  return calculateCurrentStock(totals);
}

async function writeStock(
  fixture: Fixture,
  type: "INWARD" | "OUTWARD" | "ADJUSTMENT",
  quantity: number
): Promise<void> {
  const db = requireClient();
  await db.$transaction(
    async (tx) => {
      validateStockQuantity(type, quantity);
      const totals = await tx.stockTransaction.groupBy({
        by: ["type"],
        where: { itemId: fixture.itemId },
        _sum: { quantity: true },
      });
      assertStockChangeAllowed(calculateCurrentStock(totals), type, quantity);
      const created = await tx.stockTransaction.create({
        data: {
          type,
          quantity,
          itemId: fixture.itemId,
          createdById: fixture.userId,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: fixture.userId,
          action: "stock.transaction.create",
          entityType: "StockTransaction",
          entityId: created.id,
        },
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
}

async function writeIdempotentStock(
  fixture: Fixture,
  key: string,
  quantity: number
): Promise<{ id: number; replayed: boolean }> {
  const db = requireClient();
  const requestHash = hashStockTransactionRequest({
    type: "INWARD",
    itemId: fixture.itemId,
    quantity,
    supplierId: null,
    fromLocationId: null,
    toLocationId: null,
    referenceNumber: null,
    remarks: null,
  });

  try {
    const transaction = await db.$transaction(
      async (tx) => {
        const created = await tx.stockTransaction.create({
          data: {
            type: "INWARD",
            quantity,
            itemId: fixture.itemId,
            createdById: fixture.userId,
          },
        });
        await tx.auditLog.create({
          data: {
            actorId: fixture.userId,
            action: "stock.transaction.create",
            entityType: "StockTransaction",
            entityId: created.id,
          },
        });
        await tx.stockTransactionIdempotencyKey.create({
          data: {
            key,
            operation: STOCK_TRANSACTION_OPERATION,
            requestHash,
            actorId: fixture.userId,
            stockTransactionId: created.id,
          },
        });
        return created;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
    return { id: transaction.id, replayed: false };
  } catch (error) {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== "P2002"
    ) {
      throw error;
    }
    const existing = await db.stockTransactionIdempotencyKey.findUniqueOrThrow({
      where: {
        actorId_operation_key: {
          actorId: fixture.userId,
          operation: STOCK_TRANSACTION_OPERATION,
          key,
        },
      },
    });
    assert.equal(existing.requestHash, requestHash);
    return { id: existing.stockTransactionId, replayed: true };
  }
}

function isSerializationConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2034"
  );
}

async function withSerializableRetry<T>(
  operation: () => Promise<T>,
  maxAttempts = 3
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isSerializationConflict(error) || attempt === maxAttempts) {
        throw error;
      }
    }
  }
  throw new Error("Serializable operation exhausted its retry attempts");
}

integrationTest(
  "stock movements compute inward, outward, and signed adjustments",
  async () => {
    const fixture = await createFixture();
    try {
      await writeStock(fixture, "INWARD", 10);
      await writeStock(fixture, "OUTWARD", 3);
      await writeStock(fixture, "ADJUSTMENT", 2);
      await writeStock(fixture, "ADJUSTMENT", -1);
      assert.equal(await getStock(fixture.itemId), 8);
    } finally {
      await cleanupFixture(fixture);
    }
  }
);

integrationTest(
  "transaction failure rolls back stock and its audit record",
  async () => {
    const db = requireClient();
    const fixture = await createFixture();
    try {
      await assert.rejects(
        db.$transaction(async (tx) => {
          const created = await tx.stockTransaction.create({
            data: {
              type: "INWARD",
              quantity: 4,
              itemId: fixture.itemId,
              createdById: fixture.userId,
            },
          });
          await tx.auditLog.create({
            data: {
              actorId: fixture.userId,
              action: "stock.transaction.create",
              entityType: "StockTransaction",
              entityId: created.id,
            },
          });
          throw new Error("forced test rollback");
        })
      );

      assert.equal(await getStock(fixture.itemId), 0);
      assert.equal(
        await db.auditLog.count({
          where: {
            actorId: fixture.userId,
            entityType: "StockTransaction",
          },
        }),
        0
      );
    } finally {
      await cleanupFixture(fixture);
    }
  }
);

integrationTest(
  "location transfer moves stock without changing item total",
  async () => {
    const db = requireClient();
    const fixture = await createFixture();
    try {
      await db.locationStockBalance.create({
        data: {
          itemId: fixture.itemId,
          locationId: fixture.sourceLocationId,
          quantity: 5,
        },
      });
      await db.$transaction(
        async (tx) => {
          await applyLocationStockChanges(tx, fixture.itemId, [
            { locationId: fixture.sourceLocationId, delta: -3 },
            { locationId: fixture.destinationLocationId, delta: 3 },
          ]);
          await tx.stockTransaction.create({
            data: {
              type: "TRANSFER",
              quantity: 3,
              itemId: fixture.itemId,
              fromLocationId: fixture.sourceLocationId,
              toLocationId: fixture.destinationLocationId,
              createdById: fixture.userId,
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );

      const balances = await db.locationStockBalance.findMany({
        where: { itemId: fixture.itemId },
        orderBy: { locationId: "asc" },
      });
      assert.deepEqual(
        balances.map((balance) => [balance.locationId, balance.quantity]),
        [
          [fixture.sourceLocationId, 2],
          [fixture.destinationLocationId, 3],
        ].sort((a, b) => a[0] - b[0])
      );
      assert.equal(await getStock(fixture.itemId), 0);
    } finally {
      await cleanupFixture(fixture);
    }
  }
);

integrationTest(
  "concurrent location issues cannot oversell a source balance",
  async () => {
    const db = requireClient();
    const fixture = await createFixture();
    try {
      await db.locationStockBalance.create({
        data: {
          itemId: fixture.itemId,
          locationId: fixture.sourceLocationId,
          quantity: 3,
        },
      });

      const issue = () =>
        withSerializableRetry(() =>
          db.$transaction(
            (tx) =>
              applyLocationStockChanges(tx, fixture.itemId, [
                { locationId: fixture.sourceLocationId, delta: -2 },
              ]),
            { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
          )
        );
      const results = await Promise.allSettled([issue(), issue()]);
      assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
      assert.equal(results.filter((result) => result.status === "rejected").length, 1);

      const balance = await db.locationStockBalance.findUniqueOrThrow({
        where: {
          itemId_locationId: {
            itemId: fixture.itemId,
            locationId: fixture.sourceLocationId,
          },
        },
      });
      assert.equal(balance.quantity, 1);
    } finally {
      await cleanupFixture(fixture);
    }
  }
);

integrationTest("repeating a key replays one transaction and rejects a conflict", async () => {
  const db = requireClient();
  const fixture = await createFixture();
  try {
    const first = await writeIdempotentStock(fixture, "repeat-key", 4);
    const replay = await writeIdempotentStock(fixture, "repeat-key", 4);
    assert.equal(replay.id, first.id);
    assert.equal(replay.replayed, true);
    assert.equal(
      await db.stockTransaction.count({ where: { itemId: fixture.itemId } }),
      1
    );
    assert.equal(
      await db.auditLog.count({
        where: { actorId: fixture.userId, entityType: "StockTransaction" },
      }),
      1
    );

    const conflictingHash = hashStockTransactionRequest({
      type: "INWARD",
      itemId: fixture.itemId,
      quantity: 5,
      supplierId: null,
      fromLocationId: null,
      toLocationId: null,
      referenceNumber: null,
      remarks: null,
    });
    const existing = await db.stockTransactionIdempotencyKey.findUniqueOrThrow({
      where: {
        actorId_operation_key: {
          actorId: fixture.userId,
          operation: STOCK_TRANSACTION_OPERATION,
          key: "repeat-key",
        },
      },
    });
    assert.notEqual(existing.requestHash, conflictingHash);
  } finally {
    await cleanupFixture(fixture);
  }
});

integrationTest("simultaneous duplicate keys resolve to one persisted movement", async () => {
  const fixture = await createFixture();
  try {
    const results = await Promise.all([
      withSerializableRetry(() =>
        writeIdempotentStock(fixture, "simultaneous-key", 3)
      ),
      withSerializableRetry(() =>
        writeIdempotentStock(fixture, "simultaneous-key", 3)
      ),
    ]);
    assert.equal(results[0].id, results[1].id);
    assert.equal(
      await requireClient().stockTransaction.count({
        where: { itemId: fixture.itemId },
      }),
      1
    );
  } finally {
    await cleanupFixture(fixture);
  }
});

integrationTest("a failed keyed transaction rolls back its idempotency result", async () => {
  const db = requireClient();
  const fixture = await createFixture();
  try {
    await assert.rejects(
      db.$transaction(async (tx) => {
        const created = await tx.stockTransaction.create({
          data: {
            type: "INWARD",
            quantity: 4,
            itemId: fixture.itemId,
            createdById: fixture.userId,
          },
        });
        await tx.stockTransactionIdempotencyKey.create({
          data: {
            key: "rollback-key",
            operation: STOCK_TRANSACTION_OPERATION,
            requestHash: "a".repeat(64),
            actorId: fixture.userId,
            stockTransactionId: created.id,
          },
        });
        throw new Error("forced keyed rollback");
      })
    );
    assert.equal(await getStock(fixture.itemId), 0);
    assert.equal(
      await db.stockTransactionIdempotencyKey.count({
        where: { actorId: fixture.userId },
      }),
      0
    );
  } finally {
    await cleanupFixture(fixture);
  }
});

integrationTest("requests without a key retain independent creation behavior", async () => {
  const db = requireClient();
  const fixture = await createFixture();
  try {
    await writeStock(fixture, "INWARD", 2);
    await writeStock(fixture, "INWARD", 2);
    assert.equal(
      await db.stockTransaction.count({ where: { itemId: fixture.itemId } }),
      2
    );
    assert.equal(
      await db.stockTransactionIdempotencyKey.count({
        where: { actorId: fixture.userId },
      }),
      0
    );
  } finally {
    await cleanupFixture(fixture);
  }
});

integrationTest(
  "concurrent outward requests cannot oversell final units and retry safely",
  async () => {
    const db = requireClient();
    const fixture = await createFixture();
    try {
      await writeStock(fixture, "INWARD", 5);

      let readers = 0;
      let releaseReaders!: () => void;
      const readersReady = new Promise<void>((resolve) => {
        releaseReaders = resolve;
      });

      const outward = () =>
        withSerializableRetry(() =>
          db.$transaction(
            async (tx) => {
              const totals = await tx.stockTransaction.groupBy({
                by: ["type"],
                where: { itemId: fixture.itemId },
                _sum: { quantity: true },
              });
              const currentStock = calculateCurrentStock(totals);
              readers += 1;
              if (readers === 2) releaseReaders();
              await readersReady;
              assertStockChangeAllowed(currentStock, "OUTWARD", 5);
              await tx.stockTransaction.create({
                data: {
                  type: "OUTWARD",
                  quantity: 5,
                  itemId: fixture.itemId,
                  createdById: fixture.userId,
                },
              });
            },
            { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
          )
        );

      const results = await Promise.allSettled([outward(), outward()]);
      const succeeded = results.filter((result) => result.status === "fulfilled");
      const failed = results.filter((result) => result.status === "rejected");

      assert.equal(succeeded.length, 1);
      assert.equal(failed.length, 1);
      assert.ok(
        failed[0].status === "rejected" &&
          (isSerializationConflict(failed[0].reason) ||
            failed[0].reason instanceof InsufficientStockError)
      );
      assert.equal(await getStock(fixture.itemId), 0);
    } finally {
      await cleanupFixture(fixture);
    }
  }
);

integrationTest("retryable serialization conflicts retry and exhaust gracefully", async () => {
  let attempts = 0;
  const failingOp = async () => {
    attempts += 1;
    const error = new Prisma.PrismaClientKnownRequestError("Serialization failure", {
      code: "P2034",
      clientVersion: "7.0.0",
    });
    throw error;
  };

  await assert.rejects(
    withSerializableRetry(failingOp, 3),
    /exhausted its retry attempts/
  );
  assert.equal(attempts, 3);
});

test.after(async () => {
  await client?.$disconnect();
});

if (skipReason) {
  console.warn(`Stock PostgreSQL integration tests skipped: ${skipReason}`);
}
