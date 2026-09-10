import { getSession } from "@/lib/auth";
import { StockManager } from "@/components/stock/stock-manager";

export default async function StockPage() {
  const session = await getSession();
  const canManageStock =
    session?.role === "ADMIN" || session?.role === "STORE_MANAGER";
  const canManageMasterData =
    session?.role === "ADMIN" || session?.role === "STORE_MANAGER";

  return (
    <StockManager
      canManageStock={canManageStock}
      canManageMasterData={canManageMasterData}
    />
  );
}
