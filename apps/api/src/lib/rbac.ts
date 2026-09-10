import type { Role } from "@prisma/client";

export type Action =
  | "manageMasterData"
  | "manageStock"
  | "managePurchaseOrders"
  | "manageUsers"
  | "viewReports";

const PERMISSIONS: Record<Role, Action[]> = {
  ADMIN: [
    "manageMasterData",
    "manageStock",
    "managePurchaseOrders",
    "manageUsers",
    "viewReports",
  ],
  STORE_MANAGER: [
    "manageMasterData",
    "manageStock",
    "managePurchaseOrders",
    "viewReports",
  ],
  ACCOUNTS: ["managePurchaseOrders", "viewReports"],
  VIEWER: [],
};

export function can(role: Role, action: Action): boolean {
  return PERMISSIONS[role].includes(action);
}
