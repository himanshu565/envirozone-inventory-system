import assert from "node:assert/strict";
import test from "node:test";
import { can } from "../src/lib/rbac";

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

  assert.equal(can("VIEWER", "viewReports"), false);
  assert.equal(can("VIEWER", "manageStock"), false);
  assert.equal(can("VIEWER", "managePurchaseOrders"), false);
});
