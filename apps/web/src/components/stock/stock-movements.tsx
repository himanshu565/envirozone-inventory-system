"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeftRight } from "lucide-react";
import { API_URL } from "@/lib/api";
import { useToast } from "@/components/ui/toast-provider";
import { SortableHeader } from "@/components/ui/sortable-header";
import { TableSkeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";

type TransactionType = "INWARD" | "OUTWARD" | "ADJUSTMENT";

type Item = { id: number; itemCode: string; name: string };
type Supplier = { id: number; name: string; isActive: boolean };
type Location = { id: number; name: string; isActive: boolean };

type Transaction = {
  id: number;
  type: TransactionType;
  quantity: number;
  referenceNumber: string | null;
  remarks: string | null;
  transactionDate: string;
  item: { id: number; itemCode: string; name: string };
  supplier: { id: number; name: string } | null;
  fromLocation: { id: number; name: string } | null;
  toLocation: { id: number; name: string } | null;
  createdBy: { id: number; name: string };
};

type TransactionsResponse = {
  data: Transaction[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

const TRANSACTION_TYPES: TransactionType[] = ["INWARD", "OUTWARD", "ADJUSTMENT"];

const emptyForm = {
  type: "INWARD" as TransactionType,
  itemId: "",
  quantity: "",
  supplierId: "",
  fromLocationId: "",
  toLocationId: "",
  referenceNumber: "",
  remarks: "",
};

export function StockMovements({
  canManage,
  onRecorded,
  optionsVersion,
}: {
  canManage: boolean;
  onRecorded: () => void;
  optionsVersion: number;
}) {
  const toast = useToast();

  const [items, setItems] = useState<Item[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: 10,
    total: 0,
    totalPages: 1,
  });
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [isLoadingLedger, setIsLoadingLedger] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function loadOptions() {
    try {
      const [itemsRes, suppliersRes, locationsRes] = await Promise.all([
        fetch(`${API_URL}/api/items?pageSize=100&sortBy=name`, {
          credentials: "include",
        }),
        fetch(`${API_URL}/api/suppliers`, { credentials: "include" }),
        fetch(`${API_URL}/api/locations`, { credentials: "include" }),
      ]);
      if (itemsRes.ok) {
        const body: { data: Item[] } = await itemsRes.json();
        setItems(body.data);
        setForm((prev) =>
          prev.itemId || !body.data.length
            ? prev
            : { ...prev, itemId: String(body.data[0].id) }
        );
      }
      if (suppliersRes.ok) setSuppliers(await suppliersRes.json());
      if (locationsRes.ok) setLocations(await locationsRes.json());
    } catch {
      setFormError("Unable to load form options");
    }
  }

  async function loadLedger(page = pagination.page, sortDirection = sortDir) {
    setIsLoadingLedger(true);
    setListError(null);
    try {
      const response = await fetch(
        `${API_URL}/api/stock/transactions?page=${page}&pageSize=${pagination.pageSize}&sortBy=transactionDate&sortDir=${sortDirection}`,
        { credentials: "include" }
      );
      if (!response.ok) throw new Error("Failed to load ledger");
      const body: TransactionsResponse = await response.json();
      setTransactions(body.data);
      setPagination(body.pagination);
    } catch {
      setListError("Unable to load stock movements");
    } finally {
      setIsLoadingLedger(false);
    }
  }

  useEffect(() => {
    loadLedger(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadOptions();
  }, [optionsVersion]);

  function handleSort() {
    const nextDir = sortDir === "asc" ? "desc" : "asc";
    setSortDir(nextDir);
    loadLedger(1, nextDir);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setIsSubmitting(true);

    const payload = {
      type: form.type,
      itemId: Number(form.itemId),
      quantity: Number(form.quantity),
      supplierId: form.supplierId || undefined,
      fromLocationId: form.fromLocationId || undefined,
      toLocationId: form.toLocationId || undefined,
      referenceNumber: form.referenceNumber,
      remarks: form.remarks,
    };

    try {
      const response = await fetch(`${API_URL}/api/stock/transactions`, {
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

      setForm((prev) => ({
        ...emptyForm,
        itemId: prev.itemId,
        type: prev.type,
      }));
      await loadLedger(1);
      onRecorded();
      toast.success("Stock movement recorded");
    } catch {
      setFormError("Unable to reach the server");
    } finally {
      setIsSubmitting(false);
    }
  }

  const activeSuppliers = suppliers.filter((s) => s.isActive);
  const activeLocations = locations.filter((l) => l.isActive);

  return (
    <div className="flex flex-col gap-6">
      {canManage && (
        <form
          onSubmit={handleSubmit}
          className="rounded-lg border border-slate-200 bg-white"
        >
          <div className="border-b border-slate-200 px-6 py-4">
            <h2 className="text-sm font-semibold text-slate-900">
              Record stock movement
            </h2>
          </div>

          <div className="grid gap-4 p-6 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">
                Type
              </span>
              <select
                value={form.type}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    type: e.target.value as TransactionType,
                  }))
                }
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              >
                {TRANSACTION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">
                Item
              </span>
              <select
                required
                value={form.itemId}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, itemId: e.target.value }))
                }
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
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
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">
                Quantity{" "}
                {form.type === "ADJUSTMENT" && (
                  <span className="text-slate-400">(negative to reduce stock)</span>
                )}
              </span>
              <input
                type="number"
                required
                min={form.type === "ADJUSTMENT" ? undefined : 1}
                value={form.quantity}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, quantity: e.target.value }))
                }
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">
                Supplier (optional)
              </span>
              <select
                value={form.supplierId}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, supplierId: e.target.value }))
                }
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              >
                <option value="">None</option>
                {activeSuppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">
                From location (optional)
              </span>
              <select
                value={form.fromLocationId}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, fromLocationId: e.target.value }))
                }
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              >
                <option value="">None</option>
                {activeLocations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">
                To location (optional)
              </span>
              <select
                value={form.toLocationId}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, toLocationId: e.target.value }))
                }
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              >
                <option value="">None</option>
                {activeLocations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">
                Reference number
              </span>
              <input
                type="text"
                value={form.referenceNumber}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, referenceNumber: e.target.value }))
                }
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">
                Remarks
              </span>
              <input
                type="text"
                value={form.remarks}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, remarks: e.target.value }))
                }
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </label>
          </div>

          {formError && (
            <p className="border-t border-slate-100 px-6 py-3 text-sm text-red-600">
              {formError}
            </p>
          )}

          <div className="border-t border-slate-100 px-6 py-4">
            <button
              type="submit"
              disabled={isSubmitting || items.length === 0}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-50"
            >
              {isSubmitting ? "Recording..." : "Record movement"}
            </button>
          </div>
        </form>
      )}

      <div className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-sm font-semibold text-slate-900">Recent movements</h2>
        </div>

        <div className="px-6 py-4">
          {isLoadingLedger && <TableSkeleton rows={5} cols={6} />}
          {listError && <p className="text-sm text-red-600">{listError}</p>}

          {!isLoadingLedger && !listError && transactions.length === 0 && (
            <EmptyState
              icon={ArrowLeftRight}
              title="No stock movements recorded yet"
              description={
                canManage
                  ? "Record your first inward, outward, or adjustment above."
                  : undefined
              }
            />
          )}

          {!isLoadingLedger && !listError && transactions.length > 0 && (
            <>
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wide text-slate-400">
                    <SortableHeader
                      label="Date"
                      field="transactionDate"
                      sortBy="transactionDate"
                      sortDir={sortDir}
                      onSort={handleSort}
                    />
                    <th className="pb-3 font-medium">Type</th>
                    <th className="pb-3 font-medium">Item</th>
                    <th className="pb-3 font-medium">Qty</th>
                    <th className="pb-3 font-medium">Detail</th>
                    <th className="pb-3 font-medium">By</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((tx) => (
                    <tr key={tx.id} className="border-t border-slate-100">
                      <td className="py-3 text-slate-500">
                        {new Date(tx.transactionDate).toLocaleDateString()}
                      </td>
                      <td className="py-3">
                        <TypeBadge type={tx.type} />
                      </td>
                      <td className="py-3 text-slate-900">
                        {tx.item.itemCode} — {tx.item.name}
                      </td>
                      <td
                        className={`py-3 font-semibold tabular-nums ${
                          tx.type === "OUTWARD" || tx.quantity < 0
                            ? "text-red-600"
                            : "text-emerald-700"
                        }`}
                      >
                        {tx.type === "OUTWARD" ? "-" : tx.quantity > 0 ? "+" : ""}
                        {Math.abs(tx.quantity)}
                      </td>
                      <td className="py-3 text-slate-500">
                        {[
                          tx.supplier?.name,
                          tx.fromLocation?.name && `from ${tx.fromLocation.name}`,
                          tx.toLocation?.name && `to ${tx.toLocation.name}`,
                          tx.referenceNumber,
                          tx.remarks,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </td>
                      <td className="py-3 text-slate-500">{tx.createdBy.name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {pagination.totalPages > 1 && (
                <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
                  <span>
                    Page {pagination.page} of {pagination.totalPages} (
                    {pagination.total} movements)
                  </span>
                  <div className="flex gap-2">
                    <button
                      disabled={pagination.page <= 1}
                      onClick={() => loadLedger(pagination.page - 1)}
                      className="rounded-md border border-slate-300 px-3 py-1 disabled:opacity-40"
                    >
                      Previous
                    </button>
                    <button
                      disabled={pagination.page >= pagination.totalPages}
                      onClick={() => loadLedger(pagination.page + 1)}
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

function TypeBadge({ type }: { type: TransactionType }) {
  const styles: Record<TransactionType, string> = {
    INWARD: "bg-emerald-50 text-emerald-700",
    OUTWARD: "bg-red-50 text-red-700",
    ADJUSTMENT: "bg-sky-50 text-sky-700",
  };
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[type]}`}>
      {type}
    </span>
  );
}
