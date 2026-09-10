import { getSession } from "@/lib/auth";
import { InventoryManager } from "@/components/inventory-manager";

export default async function InventoryPage() {
  const session = await getSession();
  const canManage =
    session?.role === "ADMIN" || session?.role === "STORE_MANAGER";

  return <InventoryManager canManage={canManage} />;
}
