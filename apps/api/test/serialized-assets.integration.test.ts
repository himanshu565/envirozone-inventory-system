import assert from "node:assert/strict";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createSessionToken } from "@envirozone/auth";

const testUrl = process.env.STOCK_TEST_DATABASE_URL;
const configuredDatabaseUrl = process.env.DATABASE_URL;

function getSkipReason(): string | null {
  if (!testUrl) return "STOCK_TEST_DATABASE_URL is not configured";
  if (testUrl === configuredDatabaseUrl) return "STOCK_TEST_DATABASE_URL must not equal DATABASE_URL";
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
  userId: number;
  locationId: number;
};

function requireDb(): PrismaClient {
  if (!db) throw new Error("Integration database is not configured");
  return db;
}

async function createFixture(trackingMode: "QUANTITY" | "SERIALIZED" = "SERIALIZED") {
  const database = requireDb();
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const category = await database.category.create({ data: { name: `asset-test-${suffix}` } });
  const user = await database.user.create({
    data: {
      name: `Asset Test ${suffix}`,
      email: `asset-test-${suffix}@example.invalid`,
      password: "not-used",
      role: "ADMIN",
    },
  });
  const item = await database.item.create({
    data: {
      itemCode: `asset-test-${suffix}`,
      name: `Asset Test ${suffix}`,
      categoryId: category.id,
      trackingMode,
    },
  });
  const location = await database.location.create({
    data: { name: `Asset Location ${suffix}`, type: "SITE" },
  });
  return { categoryId: category.id, itemId: item.id, userId: user.id, locationId: location.id };
}

async function cleanupFixture(fixture: Fixture): Promise<void> {
  const database = requireDb();
  await database.auditLog.deleteMany({ where: { actorId: fixture.userId } });
  await database.serializedAsset.deleteMany({ where: { itemId: fixture.itemId } });
  await database.location.delete({ where: { id: fixture.locationId } });
  await database.item.delete({ where: { id: fixture.itemId } });
  await database.user.delete({ where: { id: fixture.userId } });
  await database.category.delete({ where: { id: fixture.categoryId } });
}

async function request(
  fixture: Fixture,
  method: string,
  path: string,
  body?: unknown,
  role: "ADMIN" | "VIEWER" = "ADMIN"
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      cookie: `session=${await createSessionToken({
        userId: fixture.userId,
        email: `asset-test-${fixture.userId}@example.invalid`,
        role,
      })}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

integrationTest("registers a serialized asset and writes one audit record", async () => {
  const fixture = await createFixture();
  try {
    const response = await request(fixture, "POST", "/api/assets", {
      assetTag: `TAG-${fixture.itemId}`,
      serialNumber: `SERIAL-${fixture.itemId}`,
      itemId: fixture.itemId,
      currentLocationId: fixture.locationId,
    });
    assert.equal(response.status, 201);
    const asset = await response.json();
    assert.equal(asset.status, "IN_STOCK");
    const database = requireDb();
    assert.equal(await database.serializedAsset.count({ where: { itemId: fixture.itemId } }), 1);
    assert.equal(
      await database.auditLog.count({
        where: { actorId: fixture.userId, action: "asset.create", entityId: asset.id },
      }),
      1
    );
  } finally {
    await cleanupFixture(fixture);
  }
});

integrationTest("rejects consumables, duplicate identifiers, and forbidden registration", async () => {
  const quantityFixture = await createFixture("QUANTITY");
  try {
    const response = await request(quantityFixture, "POST", "/api/assets", {
      assetTag: "CONSUMABLE-TAG",
      itemId: quantityFixture.itemId,
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "The selected item is not serialized" });
  } finally {
    await cleanupFixture(quantityFixture);
  }

  const fixture = await createFixture();
  try {
    const body = {
      assetTag: "DUPLICATE-TAG",
      serialNumber: "DUPLICATE-SERIAL",
      itemId: fixture.itemId,
    };
    const first = await request(fixture, "POST", "/api/assets", body);
    const second = await request(fixture, "POST", "/api/assets", body);
    assert.equal(first.status, 201);
    assert.equal(second.status, 409);
    const forbidden = await request(fixture, "POST", "/api/assets", {
      assetTag: "VIEWER-TAG",
      itemId: fixture.itemId,
    }, "VIEWER");
    assert.equal(forbidden.status, 403);
  } finally {
    await cleanupFixture(fixture);
  }
});

test.before(async () => {
  if (skipReason) {
    console.warn(`Serialized-asset integration tests skipped: ${skipReason}`);
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
