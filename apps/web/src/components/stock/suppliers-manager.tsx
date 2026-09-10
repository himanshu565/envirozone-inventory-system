"use client";

import { useEffect, useState, type FormEvent } from "react";
import { API_URL } from "@/lib/api";

type Supplier = {
  id: number;
  name: string;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  isActive: boolean;
};

const emptyForm = { name: "", contactPerson: "", phone: "", email: "" };

export function SuppliersManager({
  canManage,
  onChange,
}: {
  canManage: boolean;
  onChange: () => void;
}) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

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
    } catch {
      setListError("Unable to update supplier");
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
        {isLoading && <p className="text-sm text-slate-500">Loading...</p>}

        {!isLoading && suppliers.length === 0 && (
          <p className="text-sm text-slate-500">No suppliers yet.</p>
        )}

        {!isLoading && suppliers.length > 0 && (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-slate-400">
                <th className="pb-3 font-medium">Name</th>
                <th className="pb-3 font-medium">Contact</th>
                <th className="pb-3 font-medium">Status</th>
                {canManage && <th className="pb-3 font-medium">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {suppliers.map((supplier) => (
                <tr key={supplier.id} className="border-t border-slate-100">
                  <td className="py-3 font-medium text-slate-900">{supplier.name}</td>
                  <td className="py-3 text-slate-500">
                    {[supplier.contactPerson, supplier.phone, supplier.email]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </td>
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
