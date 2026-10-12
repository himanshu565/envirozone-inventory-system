import assert from "node:assert/strict";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createSessionToken } from "@envirozone/auth";

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
  const name = parsed.pathname.replace(/^\/+/, "").toLowerCase();
  if (!["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) {
    return "STOCK_TEST_DATABASE_URL must point to local disposable PostgreSQL";
  }
  if (!/(test|ci|tmp|temp)/.test(name) || /(prod|production|dev|development)/.test(name)) {
    return "STOCK_TEST_DATABASE_URL database name is not a safe disposable test name";
  }
  return null;
}

const skipReason = getSkipReason();
const integrationTest = skipReason ? test.skip : test;
const db = testUrl
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString: testUrl }) })
  : null;
let baseUrl = "";
let closeServer: (() => Promise<void>) | undefined;

type Fixture = {
  categoryId: number;
  itemId: number;
  supplierId: number;
  userId: number;
  orderId: number;
};

function requireDb(): PrismaClient {
  if (!db) throw new Error("Integration database is not configured");
  return db;
}

async function createFixture(status: "SENT" | "DRAFT" = "SENT"): Promise<Fixture> {
  const database = requireDb();
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const category = await database.category.create({ data: { name: `po-test-${suffix}` } });
  const user = await database.user.create({
    data: {
      name: `PO Test ${suffix}`,
      email: `po-test-${suffix}@example.invalid`,
      password: "not-used",
      role: "ADMIN",
    },
  });
  const supplier = await database.supplier.create({ data: { name: `PO Supplier ${suffix}` } });
  const item = await database.item.create({
    data: {
      itemCode: `po-test-${suffix}`,
      name: `PO Test ${suffix}`,
      categoryId: category.id,
    },
  });
  const order = await database.purchaseOrder.create({
    data: {
      poNumber: `PO-TEST-${suffix}`,
      status,
      supplierId: supplier.id,
      createdById: user.id,
      items: { create: { itemId: item.id, quantityOrdered: 5 } },
    },
  });
  return {
    categoryId: category.id,
    itemId: item.id,
    supplierId: supplier.id,
    userId: user.id,
    orderId: order.id,
  };
}

async function cleanupFixture(fixture: Fixture): Promise<void> {
  const database = requireDb();
  await database.purchaseOrderReceiptIdempotencyKey.deleteMany({
    where: { purchaseOrderId: fixture.orderId },
  });
  await database.auditLog.deleteMany({ where: { actorId: fixture.userId } });
  await database.stockTransaction.deleteMany({ where: { purchaseOrderId: fixture.orderId } });
  await database.purchaseOrder.delete({ where: { id: fixture.orderId } });
  await database.item.delete({ where: { id: fixture.itemId } });
  await database.supplier.delete({ where: { id: fixture.supplierId } });
  await database.user.delete({ where: { id: fixture.userId } });
  await database.category.delete({ where: { id: fixture.categoryId } });
}

async function receive(
  fixture: Fixture,
  body: unknown,
  key?: string,
  role: "ADMIN" | "VIEWER" | "ACCOUNTS" = "ADMIN"
): Promise<Response> {
  return fetch(`${baseUrl}/api/purchase-orders/${fixture.orderId}/receive`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `session=${await createSessionToken({
        userId: fixture.userId,
        email: `po-test-${fixture.userId}@example.invalid`,
        role,
      })}`,
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function authenticatedGet(
  fixture: Fixture,
  path: string,
  role: "ADMIN" | "VIEWER" = "ADMIN"
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    headers: {
      cookie: `session=${await createSessionToken({
        userId: fixture.userId,
        email: `po-test-${fixture.userId}@example.invalid`,
        role,
      })}`,
    },
  });
}

integrationTest("partial and complete receipts update counters, stock, and status", async () => {
  const fixture = await createFixture();
  try {
    let response = await receive(fixture, { receipts: [{ itemId: fixture.itemId, quantity: 2 }] });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, "PARTIALLY_RECEIVED");

    response = await receive(fixture, { receipts: [{ itemId: fixture.itemId, quantity: 3 }] });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, "RECEIVED");

    const database = requireDb();
    const item = await database.purchaseOrderItem.findFirstOrThrow({
      where: { purchaseOrderId: fixture.orderId },
    });
    assert.equal(item.quantityReceived, 5);
    assert.equal(
      await database.stockTransaction.count({ where: { purchaseOrderId: fixture.orderId } }),
      2
    );
  } finally {
    await cleanupFixture(fixture);
  }
});

integrationTest("duplicate keyed receipt does not double receive stock or audit", async () => {
  const fixture = await createFixture();
  try {
    const body = { receipts: [{ itemId: fixture.itemId, quantity: 2 }] };
    const first = await receive(fixture, body, "receipt-duplicate");
    const second = await receive(fixture, body, "receipt-duplicate");
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    const database = requireDb();
    const item = await database.purchaseOrderItem.findFirstOrThrow({
      where: { purchaseOrderId: fixture.orderId },
    });
    assert.equal(item.quantityReceived, 2);
    assert.equal(
      await database.stockTransaction.count({ where: { purchaseOrderId: fixture.orderId } }),
      1
    );
    assert.equal(
      await database.auditLog.count({
        where: { actorId: fixture.userId, action: "purchaseOrder.receive" },
      }),
      1
    );
    const conflict = await receive(
      fixture,
      { receipts: [{ itemId: fixture.itemId, quantity: 3 }] },
      "receipt-duplicate"
    );
    assert.equal(conflict.status, 409);
  } finally {
    await cleanupFixture(fixture);
  }
});

integrationTest("over-receipt, invalid state, and failed receipt leave no partial writes", async () => {
  const fixture = await createFixture();
  try {
    const response = await receive(fixture, {
      receipts: [{ itemId: fixture.itemId, quantity: 6 }],
    });
    assert.equal(response.status, 400);
    const database = requireDb();
    const item = await database.purchaseOrderItem.findFirstOrThrow({
      where: { purchaseOrderId: fixture.orderId },
    });
    assert.equal(item.quantityReceived, 0);
    assert.equal(
      await database.stockTransaction.count({ where: { purchaseOrderId: fixture.orderId } }),
      0
    );
  } finally {
    await cleanupFixture(fixture);
  }

  const invalidFixture = await createFixture("DRAFT");
  try {
    const response = await receive(invalidFixture, {
      receipts: [{ itemId: invalidFixture.itemId, quantity: 1 }],
    });
    assert.equal(response.status, 409);
  } finally {
    await cleanupFixture(invalidFixture);
  }
});

integrationTest("receipt authorization rejects unauthenticated callers", async () => {
  const fixture = await createFixture();
  try {
    const response = await fetch(
      `${baseUrl}/api/purchase-orders/${fixture.orderId}/receive`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          receipts: [{ itemId: fixture.itemId, quantity: 1 }],
        }),
      }
    );
    assert.equal(response.status, 401);
  } finally {
    await cleanupFixture(fixture);
  }
});

integrationTest("receipt authorization rejects authenticated roles without manageStock", async () => {
  const fixture = await createFixture();
  try {
    const response = await receive(
      fixture,
      { receipts: [{ itemId: fixture.itemId, quantity: 1 }] },
      undefined,
      "VIEWER"
    );
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "Forbidden" });
  } finally {
    await cleanupFixture(fixture);
  }
});

integrationTest("receipt rejects invalid related IDs without writing stock or audit", async () => {
  const fixture = await createFixture();
  try {
    const response = await receive(fixture, {
      receipts: [{ itemId: fixture.itemId, quantity: 1 }],
      toLocationId: 999999999,
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "Location not found" });

    const database = requireDb();
    assert.equal(
      await database.stockTransaction.count({ where: { purchaseOrderId: fixture.orderId } }),
      0
    );
    assert.equal(
      await database.auditLog.count({
        where: { actorId: fixture.userId, action: "purchaseOrder.receive" },
      }),
      0
    );
  } finally {
    await cleanupFixture(fixture);
  }
});

integrationTest("audit-log access is restricted to administrators", async () => {
  const fixture = await createFixture();
  try {
    const viewerResponse = await authenticatedGet(fixture, "/api/audit-logs", "VIEWER");
    assert.equal(viewerResponse.status, 403);
    assert.deepEqual(await viewerResponse.json(), { error: "Forbidden" });

    const adminResponse = await authenticatedGet(fixture, "/api/audit-logs");
    assert.equal(adminResponse.status, 200);
  } finally {
    await cleanupFixture(fixture);
  }
});

test.before(async () => {
  if (skipReason) {
    console.warn(`Purchase-order receiving integration tests skipped: ${skipReason}`);
    return;
  }
  process.env.DATABASE_URL = testUrl;
  const { app } = await import("../src/app");
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not start");
  baseUrl = `http://127.0.0.1:${address.port}`;
  closeServer = () =>
    new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
});

test.after(async () => {
  await closeServer?.();
  await db?.$disconnect();
});
