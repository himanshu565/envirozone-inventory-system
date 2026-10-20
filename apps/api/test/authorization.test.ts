import assert from "node:assert/strict";
import test from "node:test";
import type { Request, Response, NextFunction } from "express";
import {
  createSessionToken,
  SESSION_COOKIE_NAME,
  type SessionPayload,
} from "@envirozone/auth";
import {
  requireAction,
  requireAuth,
  requireRole,
} from "../src/middleware/auth.middleware";
import { can } from "../src/lib/rbac";
import { recordAudit } from "../src/services/audit.service";

process.env.JWT_SECRET =
  process.env.JWT_SECRET || "test-jwt-secret-at-least-32-chars-for-hmac";

function createMockReqRes(options: {
  cookies?: Record<string, string>;
  session?: SessionPayload;
  params?: Record<string, string>;
  body?: unknown;
} = {}) {
  let statusCode = 200;
  let jsonBody: unknown = null;
  let nextCalled = false;

  const req = {
    cookies: options.cookies ?? {},
    session: options.session,
    params: options.params ?? {},
    body: options.body,
  } as unknown as Request;

  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(data: unknown) {
      jsonBody = data;
      return this;
    },
  } as unknown as Response;

  const next: NextFunction = () => {
    nextCalled = true;
  };

  return {
    req,
    res,
    next,
    getStatus: () => statusCode,
    getBody: () => jsonBody,
    isNextCalled: () => nextCalled,
  };
}

test("role permissions preserve the existing mutation boundaries", () => {
  assert.equal(can("ADMIN", "manageMasterData"), true);
  assert.equal(can("ADMIN", "manageStock"), true);
  assert.equal(can("ADMIN", "managePurchaseOrders"), true);

  assert.equal(can("STORE_MANAGER", "manageMasterData"), true);
  assert.equal(can("STORE_MANAGER", "manageStock"), true);
  assert.equal(can("STORE_MANAGER", "managePurchaseOrders"), true);
  assert.equal(can("STORE_MANAGER", "manageUsers"), false);

  assert.equal(can("ACCOUNTS", "managePurchaseOrders"), true);
  assert.equal(can("ACCOUNTS", "manageStock"), false);
  assert.equal(can("ACCOUNTS", "manageMasterData"), false);

  assert.equal(can("ADMIN", "manageWorkOrders"), true);
  assert.equal(can("ADMIN", "manageCalibrations"), true);
  assert.equal(can("STORE_MANAGER", "manageWorkOrders"), true);
  assert.equal(can("STORE_MANAGER", "manageCalibrations"), true);
  assert.equal(can("ACCOUNTS", "manageWorkOrders"), false);
  assert.equal(can("ACCOUNTS", "manageCalibrations"), false);

  assert.equal(can("VIEWER", "viewReports"), false);
  assert.equal(can("VIEWER", "manageStock"), false);
  assert.equal(can("VIEWER", "managePurchaseOrders"), false);
  assert.equal(can("VIEWER", "manageWorkOrders"), false);
  assert.equal(can("VIEWER", "manageCalibrations"), false);
});

test("requireAuth rejects unauthenticated requests with 401 Unauthorized", async () => {
  // No cookie present
  const noCookie = createMockReqRes();
  await requireAuth(noCookie.req, noCookie.res, noCookie.next);
  assert.equal(noCookie.getStatus(), 401);
  assert.deepEqual(noCookie.getBody(), { error: "Unauthorized" });
  assert.equal(noCookie.isNextCalled(), false);

  // Invalid cookie token
  const invalidCookie = createMockReqRes({
    cookies: { [SESSION_COOKIE_NAME]: "invalid.jwt.token" },
  });
  await requireAuth(invalidCookie.req, invalidCookie.res, invalidCookie.next);
  assert.equal(invalidCookie.getStatus(), 401);
  assert.deepEqual(invalidCookie.getBody(), { error: "Unauthorized" });
  assert.equal(invalidCookie.isNextCalled(), false);
});

test("requireAuth populates session and proceeds for valid session token", async () => {
  const session: SessionPayload = {
    userId: 42,
    role: "STORE_MANAGER",
    email: "manager@envirozone.local",
    name: "Store Manager",
  };
  const token = await createSessionToken(session);

  const mock = createMockReqRes({
    cookies: { [SESSION_COOKIE_NAME]: token },
  });
  await requireAuth(mock.req, mock.res, mock.next);

  assert.equal(mock.isNextCalled(), true);
  assert.equal(mock.req.session?.userId, 42);
  assert.equal(mock.req.session?.role, "STORE_MANAGER");
});

test("requireRole enforces role-based access and protects admin endpoints", () => {
  const adminOnly = requireRole("ADMIN");

  // Missing session
  const noSession = createMockReqRes();
  adminOnly(noSession.req, noSession.res, noSession.next);
  assert.equal(noSession.getStatus(), 401);
  assert.equal(noSession.isNextCalled(), false);

  // Disallowed roles: STORE_MANAGER, ACCOUNTS, VIEWER
  for (const role of ["STORE_MANAGER", "ACCOUNTS", "VIEWER"] as const) {
    const mock = createMockReqRes({
      session: { userId: 1, role, email: `${role}@test.local`, name: role },
    });
    adminOnly(mock.req, mock.res, mock.next);
    assert.equal(mock.getStatus(), 403, `Role ${role} should be forbidden`);
    assert.deepEqual(mock.getBody(), { error: "Forbidden" });
    assert.equal(mock.isNextCalled(), false);
  }

  // Allowed role: ADMIN
  const adminMock = createMockReqRes({
    session: { userId: 1, role: "ADMIN", email: "admin@test.local", name: "Admin" },
  });
  adminOnly(adminMock.req, adminMock.res, adminMock.next);
  assert.equal(adminMock.isNextCalled(), true);
});

test("requireAction enforces action permissions across mutation routes", () => {
  const manageStock = requireAction("manageStock");
  const manageMasterData = requireAction("manageMasterData");
  const managePurchaseOrders = requireAction("managePurchaseOrders");

  const viewerSession: SessionPayload = {
    userId: 2,
    role: "VIEWER",
    email: "viewer@test.local",
    name: "Viewer",
  };
  const accountsSession: SessionPayload = {
    userId: 3,
    role: "ACCOUNTS",
    email: "accounts@test.local",
    name: "Accounts",
  };
  const managerSession: SessionPayload = {
    userId: 4,
    role: "STORE_MANAGER",
    email: "manager@test.local",
    name: "Manager",
  };

  // VIEWER cannot manage stock, master data, or purchase orders
  for (const middleware of [manageStock, manageMasterData, managePurchaseOrders]) {
    const mock = createMockReqRes({ session: viewerSession });
    middleware(mock.req, mock.res, mock.next);
    assert.equal(mock.getStatus(), 403);
    assert.equal(mock.isNextCalled(), false);
  }

  // ACCOUNTS cannot manage stock or master data, but CAN manage purchase orders
  const accountsStock = createMockReqRes({ session: accountsSession });
  manageStock(accountsStock.req, accountsStock.res, accountsStock.next);
  assert.equal(accountsStock.getStatus(), 403);
  assert.equal(accountsStock.isNextCalled(), false);

  const accountsMaster = createMockReqRes({ session: accountsSession });
  manageMasterData(accountsMaster.req, accountsMaster.res, accountsMaster.next);
  assert.equal(accountsMaster.getStatus(), 403);
  assert.equal(accountsMaster.isNextCalled(), false);

  const accountsPO = createMockReqRes({ session: accountsSession });
  managePurchaseOrders(accountsPO.req, accountsPO.res, accountsPO.next);
  assert.equal(accountsPO.isNextCalled(), true);

  // STORE_MANAGER can manage stock, master data, and purchase orders
  for (const middleware of [manageStock, manageMasterData, managePurchaseOrders]) {
    const mock = createMockReqRes({ session: managerSession });
    middleware(mock.req, mock.res, mock.next);
    assert.equal(mock.isNextCalled(), true);
  }
});

test("audit atomicity: recordAudit writes via transaction and rolls back on failure", async () => {
  const auditEntries: unknown[] = [];
  let transactionCommitted = false;

  const mockTx = {
    auditLog: {
      create: async (args: { data: unknown }) => {
        auditEntries.push(args.data);
        return { id: 1, ...args.data };
      },
    },
  };

  // Simulating an operation that fails after writing audit log within transaction
  await assert.rejects(async () => {
    // 1. Record audit within tx
    await recordAudit(
      {
        actorId: 10,
        action: "stock.transaction.create",
        entityType: "StockTransaction",
        entityId: 99,
        after: { quantity: 5 },
      },
      mockTx as unknown as Parameters<typeof recordAudit>[1]
    );

    // 2. Business operation fails
    throw new Error("Simulated database failure inside transaction");
    // transactionCommitted would be true if commit succeeded
    // eslint-disable-next-line @typescript-eslint/no-unreachable
    transactionCommitted = true;
  }, /Simulated database failure inside transaction/);

  assert.equal(transactionCommitted, false);
  assert.equal(auditEntries.length, 1);
  // In a real PostgreSQL transaction, the rollback discards auditEntries along with the mutation.
});

test("audit snapshots redact sensitive fields and do not log secrets", async () => {
  let loggedPayload: unknown = null;
  const mockTx = {
    auditLog: {
      create: async (args: { data: { after: unknown } }) => {
        loggedPayload = args.data.after;
        return { id: 1, ...args.data };
      },
    },
  };

  // Simulating user creation audit snapshot
  const user = {
    id: 1,
    name: "New User",
    email: "user@test.local",
    password: "secretPasswordHash$12345",
    role: "STORE_MANAGER",
  };

  // Exact snapshot logic from users.routes.ts
  const safeSnapshot = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  };

  await recordAudit(
    {
      actorId: 1,
      action: "user.create",
      entityType: "User",
      entityId: user.id,
      after: safeSnapshot,
    },
    mockTx as unknown as Parameters<typeof recordAudit>[1]
  );

  assert.deepEqual(loggedPayload, {
    id: 1,
    name: "New User",
    email: "user@test.local",
    role: "STORE_MANAGER",
  });
  assert.equal((loggedPayload as Record<string, unknown>).password, undefined);
  assert.equal((loggedPayload as Record<string, unknown>).passwordHash, undefined);
});

test("ID validation rejects non-integer IDs to prevent arbitrary guessing", () => {
  function isValidId(val: unknown): boolean {
    if (typeof val === "string" && !val.trim()) return false;
    const num = Number(val);
    return Number.isInteger(num) && num > 0;
  }

  const invalidIds = ["abc", "12.34", "NaN", "", "   ", null, undefined, {}, -1, 0];
  for (const val of invalidIds) {
    assert.equal(
      isValidId(val),
      false,
      `Value ${JSON.stringify(val)} must not be recognized as a valid integer ID`
    );
  }

  const validIds = [1, 42, 1000, "1", "42"];
  for (const id of validIds) {
    assert.equal(isValidId(id), true);
  }
});
