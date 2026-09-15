"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { API_URL } from "@/lib/api";
import { StatusBadge } from "./purchase-orders-manager";
import { useToast } from "@/components/ui/toast-provider";
import { TableSkeleton } from "@/components/ui/skeleton";

type PurchaseOrderStatus =
  | "DRAFT"
  | "SENT"
  | "PARTIALLY_RECEIVED"
  | "RECEIVED"
  | "CANCELLED";

const PO_STATUSES: PurchaseOrderStatus[] = [
  "DRAFT",
  "SENT",
  "PARTIALLY_RECEIVED",
  "RECEIVED",
  "CANCELLED",
];

type PoItem = {
  id: number;
  quantityOrdered: number;
  quantityReceived: number;
  unitPrice: string | null;
  item: { id: number; itemCode: string; name: string; unit: string };
};

type PurchaseOrder = {
  id: number;
  poNumber: string;
  status: PurchaseOrderStatus;
  orderDate: string;
  expectedDate: string | null;
  notes: string | null;
  supplier: { id: number; name: string };
  createdBy: { id: number; name: string };
  items: PoItem[];
};

type Location = { id: number; name: string; isActive: boolean };

export function PurchaseOrderDetail({
  id,
  canManage,
  canReceiveStock,
}: {
  id: number;
  canManage: boolean;
  canReceiveStock: boolean;
}) {
  const toast = useToast();

  const [order, setOrder] = useState<PurchaseOrder | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [receiveQuantities, setReceiveQuantities] = useState<Record<number, string>>({});
  const [toLocationId, setToLocationId] = useState("");
  const [receiveError, setReceiveError] = useState<string | null>(null);
  const [isReceiving, setIsReceiving] = useState(false);

  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  async function loadOrder() {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_URL}/api/purchase-orders/${id}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to load purchase order");
      setOrder(await response.json());
    } catch {
      setError("Unable to load purchase order");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadOrder();
    fetch(`${API_URL}/api/locations`, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : []))
      .then((data: Location[]) => setLocations(data))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function handleReceive() {
    if (!order) return;
    setReceiveError(null);

    const receipts = order.items
      .map((poItem) => ({
        itemId: poItem.item.id,
        quantity: Number(receiveQuantities[poItem.id] || 0),
      }))
      .filter((r) => r.quantity > 0);

    if (receipts.length === 0) {
      setReceiveError("Enter a quantity to receive for at least one item");
      return;
    }

    setIsReceiving(true);
    try {
      const response = await fetch(`${API_URL}/api/purchase-orders/${id}/receive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          receipts,
          toLocationId: toLocationId || undefined,
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        setReceiveError(data.error ?? "Something went wrong");
        return;
      }

      setReceiveQuantities({});
      await loadOrder();
      toast.success("Receipt recorded");
    } catch {
      setReceiveError("Unable to reach the server");
    } finally {
      setIsReceiving(false);
    }
  }

  async function handleStatusChange(status: PurchaseOrderStatus) {
    setStatusError(null);
    setIsUpdatingStatus(true);
    try {
      const response = await fetch(`${API_URL}/api/purchase-orders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setStatusError(data.error ?? "Unable to update status");
        return;
      }
      await loadOrder();
      toast.success(`Status updated to ${status.replace("_", " ")}`);
    } catch {
      setStatusError("Unable to reach the server");
    } finally {
      setIsUpdatingStatus(false);
    }
  }

  if (isLoading) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <TableSkeleton rows={4} cols={4} />
      </div>
    );
  }

  if (error || !order) {
    return <p className="text-sm text-red-600">{error ?? "Purchase order not found"}</p>;
  }

  const activeLocations = locations.filter((l) => l.isActive);
  const canReceiveNow =
    canReceiveStock && order.status !== "RECEIVED" && order.status !== "CANCELLED";
  const total = order.items.reduce(
    (sum, poItem) => sum + poItem.quantityOrdered * Number(poItem.unitPrice ?? 0),
    0
  );

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/purchase-orders"
        className="flex w-fit items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-500"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to purchase orders
      </Link>

      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-lg font-semibold text-slate-900">{order.poNumber}</h1>
              <StatusBadge status={order.status} />
            </div>
            <p className="mt-1 text-sm text-slate-500">
              Supplier: <span className="text-slate-900">{order.supplier.name}</span>
            </p>
          </div>

          {canManage && (
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">Status</span>
              <select
                value={order.status}
                disabled={isUpdatingStatus}
                onChange={(e) => handleStatusChange(e.target.value as PurchaseOrderStatus)}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              >
                {PO_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s.replace("_", " ")}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {statusError && <p className="mt-2 text-sm text-red-600">{statusError}</p>}

        <div className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <div>
            <p className="text-slate-500">Order date</p>
            <p className="text-slate-900">{new Date(order.orderDate).toLocaleDateString()}</p>
          </div>
          <div>
            <p className="text-slate-500">Expected date</p>
            <p className="text-slate-900">
              {order.expectedDate ? new Date(order.expectedDate).toLocaleDateString() : "—"}
            </p>
          </div>
          <div>
            <p className="text-slate-500">Created by</p>
            <p className="text-slate-900">{order.createdBy.name}</p>
          </div>
          <div>
            <p className="text-slate-500">Order total</p>
            <p className="text-slate-900">₹{total.toFixed(2)}</p>
          </div>
        </div>

        {order.notes && (
          <p className="mt-4 text-sm text-slate-600">
            <span className="font-medium text-slate-700">Notes: </span>
            {order.notes}
          </p>
        )}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-sm font-semibold text-slate-900">Line items</h2>
        </div>

        <div className="px-6 py-4">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-slate-400">
                <th className="pb-3 font-medium">Item</th>
                <th className="pb-3 font-medium">Ordered</th>
                <th className="pb-3 font-medium">Received</th>
                <th className="pb-3 font-medium">Unit price</th>
                <th className="pb-3 font-medium">Line total</th>
                {canReceiveNow && <th className="pb-3 font-medium">Receive now</th>}
              </tr>
            </thead>
            <tbody>
              {order.items.map((poItem) => {
                const remaining = poItem.quantityOrdered - poItem.quantityReceived;
                const lineTotal =
                  poItem.quantityOrdered * Number(poItem.unitPrice ?? 0);

                return (
                  <tr key={poItem.id} className="border-t border-slate-100">
                    <td className="py-3 font-medium text-slate-900">
                      {poItem.item.itemCode} — {poItem.item.name}
                    </td>
                    <td className="py-3 text-slate-500">
                      {poItem.quantityOrdered} {poItem.item.unit}
                    </td>
                    <td
                      className={`py-3 font-semibold tabular-nums ${
                        remaining > 0 ? "text-amber-600" : "text-emerald-700"
                      }`}
                    >
                      {poItem.quantityReceived} {poItem.item.unit}
                    </td>
                    <td className="py-3 text-slate-500">
                      {poItem.unitPrice ? `₹${Number(poItem.unitPrice).toFixed(2)}` : "—"}
                    </td>
                    <td className="py-3 text-slate-500">₹{lineTotal.toFixed(2)}</td>
                    {canReceiveNow && (
                      <td className="py-3">
                        {remaining > 0 ? (
                          <input
                            type="number"
                            min={0}
                            max={remaining}
                            placeholder="0"
                            value={receiveQuantities[poItem.id] ?? ""}
                            onChange={(e) =>
                              setReceiveQuantities((prev) => ({
                                ...prev,
                                [poItem.id]: e.target.value,
                              }))
                            }
                            className="w-24 rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
                          />
                        ) : (
                          <span className="text-xs text-slate-400">Complete</span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>

          {canReceiveNow && (
            <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-4">
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-slate-700">
                  Receive into location (optional)
                </span>
                <select
                  value={toLocationId}
                  onChange={(e) => setToLocationId(e.target.value)}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                >
                  <option value="">None</option>
                  {activeLocations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={handleReceive}
                disabled={isReceiving}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-50"
              >
                {isReceiving ? "Recording..." : "Record receipt"}
              </button>
              {receiveError && <p className="text-sm text-red-600">{receiveError}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
