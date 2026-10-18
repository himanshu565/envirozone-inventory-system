import type { Role } from "@prisma/client";

export type Action =
  | "manageMasterData"
  | "manageStock"
  | "managePurchaseOrders"
  | "manageUsers"
  | "viewReports"
  | "manageWorkOrders"
  | "manageCalibrations"
  | "manageKnowledgeDocuments"
  | "approveKnowledgeDocuments"
  | "useKnowledgeAssistant";

const PERMISSIONS: Record<Role, Action[]> = {
  ADMIN: [
    "manageMasterData",
    "manageStock",
    "managePurchaseOrders",
    "manageUsers",
    "viewReports",
    "manageWorkOrders",
    "manageCalibrations",
    "manageKnowledgeDocuments",
    "approveKnowledgeDocuments",
    "useKnowledgeAssistant",
  ],
  STORE_MANAGER: [
    "manageMasterData",
    "manageStock",
    "managePurchaseOrders",
    "viewReports",
    "manageWorkOrders",
    "manageCalibrations",
    "manageKnowledgeDocuments",
    "approveKnowledgeDocuments",
    "useKnowledgeAssistant",
  ],
  ACCOUNTS: ["managePurchaseOrders", "viewReports", "useKnowledgeAssistant"],
  VIEWER: ["useKnowledgeAssistant"],
};

export function can(role: Role, action: Action): boolean {
  return PERMISSIONS[role].includes(action);
}
