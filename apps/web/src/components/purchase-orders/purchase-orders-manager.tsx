"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { API_URL } from "@/lib/api";

type PurchaseOrderStatus =
  | "DRAFT"
  | "SENT"
  | "PARTIALLY_RECEIVED"
  | "RECEIVED"
  | "CANCELLED";

type Supplier = { id: number; name: string; isActive: boolean };
type Item = { id: number; itemCode: string; name: string };

type PurchaseOrder = {
  id: number;
  poNumber: string;
  status: PurchaseOrderStatus;
  orderDate: string;
  expectedDate: string | null;
  supplier: { id: number; name: string };
  createdBy: { id: number; name: string };
  _count: { items: number };
};

type OrdersResponse = {
  data: PurchaseOrder[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

type LineForm = { itemId: string; quantityOrdered: string; unitPrice: string };

const emptyLine = (): LineForm => ({ itemId: "", quantityOrdered: "1", unitPrice: "" });

export function PurchaseOrdersManager({ canManage }: { canManage: boolean }) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [items, setItems] = useState<Item[]>([]);

  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 1,
  });
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [supplierId, setSupplierId] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineForm[]>([emptyLine()]);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function loadOptions() {
    try {
      const [suppliersRes, itemsRes] = await Promise.all([
        fetch(`${API_URL}/api/suppliers`, { credentials: "include" }),
        fetch(`${API_URL}/api/items?pageSize=100&sortBy=name`, {
          credentials: "include",
        }),
      ]);
      if (suppliersRes.ok) {
        const data: Supplier[] = await suppliersRes.json();
        setSuppliers(data);
        setSupplierId((prev) => {
          if (prev) return prev;
          const active = data.find((s) => s.isActive);
          return active ? String(active.id) : "";
        });
      }
      if (itemsRes.ok) {
        const body: { data: Item[] } = await itemsRes.json();
        setItems(body.data);
      }
    } catch {
      setFormError("Unable to load form options");
    }
  }

  async function loadOrders(page = pagination.page, searchTerm = search) {
    setIsLoading(true);
    setListError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pagination.pageSize),
        sortBy: "orderDate",
        sortDir: "desc",
      });
      if (searchTerm) params.set("search", searchTerm);

      const response = await fetch(`${API_URL}/api/purchase-orders?${params}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to load purchase orders");
      const body: OrdersResponse = await response.json();
      setOrders(body.data);
      setPagination(body.pagination);
    } catch {
      setListError("Unable to load purchase orders");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadOptions();
    loadOrders(1, "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateLine(index: number, patch: Partial<LineForm>) {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  function addLine() {
    setLines((prev) => [...prev, emptyLine()]);
  }

  function removeLine(index: number) {
    setLines((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setIsSubmitting(true);

    const payload = {
      supplierId: Number(supplierId),
      expectedDate: expectedDate || undefined,
      notes,
      items: lines.map((line) => ({
        itemId: Number(line.itemId),
        quantityOrdered: Number(line.quantityOrdered),
        unitPrice: line.unitPrice || undefined,
      })),
    };

    try {
      const response = await fetch(`${API_URL}/api/purchase-orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      const data = await response.json();

      if (!response.ok) {
        setFormError(data.error ?? "Something went wrong");
        return;
      }

      setExpectedDate("");
      setNotes("");
      setLines([emptyLine()]);
      await loadOrders(1);
    } catch {
      setFormError("Unable to reach the server");
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    loadOrders(1, search);
  }

  const activeSuppliers = suppliers.filter((s) => s.isActive);

  return (
    <div className="flex flex-col gap-6">
      {canManage && (
        <form
          onSubmit={handleSubmit}
          className="rounded-lg border border-slate-200 bg-white"
        >
          <div className="border-b border-slate-200 px-6 py-4">
            <h2 className="text-sm font-semibold text-slate-900">
              Create purchase order
            </h2>
          </div>

          <div className="grid gap-4 p-6 sm:grid-cols-3">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">
                Supplier
              </span>
              <select
                required
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              >
                <option value="" disabled>
                  Select a supplier
                </option>
                {activeSuppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">
                Expected date
              </span>
              <input
                type="date"
                value={expectedDate}
                onChange={(e) => setExpectedDate(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">
                Notes
              </span>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </label>
          </div>

          <div className="border-t border-slate-100 px-6 py-4">
            <p className="mb-2 text-sm font-medium text-slate-700">Line items</p>
            <div className="flex flex-col gap-2">
              {lines.map((line, index) => (
                <div key={index} className="grid grid-cols-12 gap-2">
                  <select
                    required
                    value={line.itemId}
                    onChange={(e) => updateLine(index, { itemId: e.target.value })}
                    className="col-span-6 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  >
                    <option value="" disabled>
                      Select an item
                    </option>
                    {items.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.itemCode} — {item.name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    required
                    min={1}
                    placeholder="Qty"
                    value={line.quantityOrdered}
                    onChange={(e) =>
                      updateLine(index, { quantityOrdered: e.target.value })
                    }
                    className="col-span-2 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  />
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="Unit price"
                    value={line.unitPrice}
                    onChange={(e) => updateLine(index, { unitPrice: e.target.value })}
                    className="col-span-3 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => removeLine(index)}
                    disabled={lines.length === 1}
                    className="col-span-1 rounded-md border border-slate-300 text-sm text-slate-500 transition hover:bg-slate-100 disabled:opacity-40"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addLine}
              className="mt-2 text-sm font-medium text-blue-600 hover:text-blue-500"
            >
              + Add line
            </button>
          </div>

          {formError && (
            <p className="border-t border-slate-100 px-6 py-3 text-sm text-red-600">
              {formError}
            </p>
          )}

          <div className="border-t border-slate-100 px-6 py-4">
            <button
              type="submit"
              disabled={isSubmitting || items.length === 0 || activeSuppliers.length === 0}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-50"
            >
              {isSubmitting ? "Creating..." : "Create purchase order"}
            </button>
          </div>
        </form>
      )}

      <div className="rounded-lg border border-slate-200 bg-white">
        <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-6 py-4">
          <h2 className="text-sm font-semibold text-slate-900">Purchase orders</h2>
          <form onSubmit={handleSearchSubmit} className="flex gap-2">
            <input
              type="text"
              placeholder="Search by PO number"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
            />
            <button
              type="submit"
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
            >
              Search
            </button>
          </form>
        </div>

        <div className="px-6 py-4">
          {isLoading && <p className="text-sm text-slate-500">Loading...</p>}
          {listError && <p className="text-sm text-red-600">{listError}</p>}

          {!isLoading && !listError && orders.length === 0 && (
            <p className="text-sm text-slate-500">No purchase orders yet.</p>
          )}

          {!isLoading && !listError && orders.length > 0 && (
            <>
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wide text-slate-400">
                    <th className="pb-3 font-medium">PO number</th>
                    <th className="pb-3 font-medium">Supplier</th>
                    <th className="pb-3 font-medium">Status</th>
                    <th className="pb-3 font-medium">Items</th>
                    <th className="pb-3 font-medium">Order date</th>
                    <th className="pb-3 font-medium">Expected</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => (
                    <tr key={order.id} className="border-t border-slate-100">
                      <td className="py-3 font-medium text-blue-600">
                        <Link href={`/purchase-orders/${order.id}`} className="hover:underline">
                          {order.poNumber}
                        </Link>
                      </td>
                      <td className="py-3 text-slate-900">{order.supplier.name}</td>
                      <td className="py-3">
                        <StatusBadge status={order.status} />
                      </td>
                      <td className="py-3 text-slate-500">{order._count.items}</td>
                      <td className="py-3 text-slate-500">
                        {new Date(order.orderDate).toLocaleDateString()}
                      </td>
                      <td className="py-3 text-slate-500">
                        {order.expectedDate
                          ? new Date(order.expectedDate).toLocaleDateString()
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {pagination.totalPages > 1 && (
                <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
                  <span>
                    Page {pagination.page} of {pagination.totalPages} (
                    {pagination.total} orders)
                  </span>
                  <div className="flex gap-2">
                    <button
                      disabled={pagination.page <= 1}
                      onClick={() => loadOrders(pagination.page - 1)}
                      className="rounded-md border border-slate-300 px-3 py-1 disabled:opacity-40"
                    >
                      Previous
                    </button>
                    <button
                      disabled={pagination.page >= pagination.totalPages}
                      onClick={() => loadOrders(pagination.page + 1)}
                      className="rounded-md border border-slate-300 px-3 py-1 disabled:opacity-40"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function StatusBadge({ status }: { status: PurchaseOrderStatus }) {
  const styles: Record<PurchaseOrderStatus, string> = {
    DRAFT: "bg-slate-100 text-slate-600",
    SENT: "bg-sky-50 text-sky-700",
    PARTIALLY_RECEIVED: "bg-amber-50 text-amber-700",
    RECEIVED: "bg-emerald-50 text-emerald-700",
    CANCELLED: "bg-red-50 text-red-700",
  };
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[status]}`}>
      {status.replace("_", " ")}
    </span>
  );
}
