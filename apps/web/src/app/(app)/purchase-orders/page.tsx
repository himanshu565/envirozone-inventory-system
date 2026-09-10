import { getSession } from "@/lib/auth";
import { PurchaseOrdersManager } from "@/components/purchase-orders/purchase-orders-manager";

export default async function PurchaseOrdersPage() {
  const session = await getSession();
  const canManage =
    session?.role === "ADMIN" ||
    session?.role === "STORE_MANAGER" ||
    session?.role === "ACCOUNTS";

  return <PurchaseOrdersManager canManage={canManage} />;
}
