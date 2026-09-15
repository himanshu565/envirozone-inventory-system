"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Truck } from "lucide-react";
import { API_URL } from "@/lib/api";
import { useToast } from "@/components/ui/toast-provider";
import { SortableHeader } from "@/components/ui/sortable-header";
import { TableSkeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";

type Supplier = {
  id: number;
  name: string;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  isActive: boolean;
};

const emptyForm = { name: "", contactPerson: "", phone: "", email: "", address: "" };

export function SuppliersManager({
  canManage,
  onChange,
}: {
  canManage: boolean;
  onChange: () => void;
}) {
  const toast = useToast();

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"name" | "isActive">("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function loadSuppliers() {
    setIsLoading(true);
    setListError(null);
    try {
      const response = await fetch(`${API_URL}/api/suppliers`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to load suppliers");
      setSuppliers(await response.json());
    } catch {
      setListError("Unable to load suppliers");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadSuppliers();
  }, []);

  function handleSort(field: string) {
    if (field !== "name" && field !== "isActive") return;
    setSortDir((prev) => (field === sortBy && prev === "asc" ? "desc" : "asc"));
    setSortBy(field);
  }

  const sortedSuppliers = [...suppliers].sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;
    if (sortBy === "isActive") return (Number(a.isActive) - Number(b.isActive)) * dir;
    return a.name.localeCompare(b.name) * dir;
  });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch(`${API_URL}/api/suppliers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(form),
      });
      const data = await response.json();

      if (!response.ok) {
        setFormError(data.error ?? "Something went wrong");
        return;
      }

      setForm(emptyForm);
      await loadSuppliers();
      onChange();
      toast.success(`Supplier "${data.name}" added`);
    } catch {
      setFormError("Unable to reach the server");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function toggleActive(supplier: Supplier) {
    try {
      const response = await fetch(`${API_URL}/api/suppliers/${supplier.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ isActive: !supplier.isActive }),
      });
      if (!response.ok) throw new Error("Failed to update supplier");
      await loadSuppliers();
      onChange();
      toast.success(
        `Supplier "${supplier.name}" ${supplier.isActive ? "deactivated" : "activated"}`
      );
    } catch {
      toast.error("Unable to update supplier");
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-6 py-4">
        <h2 className="text-sm font-semibold text-slate-900">Suppliers</h2>
      </div>

      <div className="p-6">
        {canManage && (
          <form onSubmit={handleSubmit} className="mb-4 grid gap-2 sm:grid-cols-2">
            <input
              type="text"
              required
              placeholder="Name"
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
            <input
              type="text"
              placeholder="Contact person"
              value={form.contactPerson}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, contactPerson: e.target.value }))
              }
              className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
            <input
              type="text"
              placeholder="Phone"
              value={form.phone}
              onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
            <input
              type="email"
              placeholder="Email"
              value={form.email}
              onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
            <input
              type="text"
              placeholder="Address"
              value={form.address}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, address: e.target.value }))
              }
              className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none sm:col-span-2"
            />
            <button
              type="submit"
              disabled={isSubmitting}
              className="justify-self-start rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-50 sm:col-span-2"
            >
              {isSubmitting ? "Adding..." : "Add supplier"}
            </button>
          </form>
        )}

        {formError && <p className="mb-2 text-sm text-red-600">{formError}</p>}
        {listError && <p className="mb-2 text-sm text-red-600">{listError}</p>}
        {isLoading && <TableSkeleton rows={3} cols={4} />}

        {!isLoading && !listError && suppliers.length === 0 && (
          <EmptyState icon={Truck} title="No suppliers yet" />
        )}

        {!isLoading && suppliers.length > 0 && (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-slate-400">
                <SortableHeader label="Name" field="name" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                <th className="pb-3 font-medium">Contact</th>
                <th className="pb-3 font-medium">Address</th>
                <SortableHeader label="Status" field="isActive" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                {canManage && <th className="pb-3 font-medium">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {sortedSuppliers.map((supplier) => (
                <tr key={supplier.id} className="border-t border-slate-100">
                  <td className="py-3 font-medium text-slate-900">{supplier.name}</td>
                  <td className="py-3 text-slate-500">
                    {[supplier.contactPerson, supplier.phone, supplier.email]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </td>
                  <td className="py-3 text-slate-500">{supplier.address || "—"}</td>
                  <td className="py-3">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        supplier.isActive
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {supplier.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                  {canManage && (
                    <td className="py-3">
                      <button
                        onClick={() => toggleActive(supplier)}
                        className="text-sm font-medium text-blue-600 hover:text-blue-500"
                      >
                        {supplier.isActive ? "Deactivate" : "Activate"}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
