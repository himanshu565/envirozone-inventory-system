import { getSession } from "@/lib/auth";
import { PurchaseOrderDetail } from "@/components/purchase-orders/purchase-order-detail";

export default async function PurchaseOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession();
  const canManage =
    session?.role === "ADMIN" ||
    session?.role === "STORE_MANAGER" ||
    session?.role === "ACCOUNTS";
  const canReceiveStock =
    session?.role === "ADMIN" || session?.role === "STORE_MANAGER";

  return (
    <PurchaseOrderDetail
      id={Number(id)}
      canManage={canManage}
      canReceiveStock={canReceiveStock}
    />
  );
}
