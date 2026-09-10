"use client";

import { useEffect, useState, type FormEvent } from "react";
import { API_URL } from "@/lib/api";

type LocationType = "OFFICE" | "WAREHOUSE" | "SITE" | "OTHER";

type Location = {
  id: number;
  name: string;
  type: LocationType;
  address: string | null;
  isActive: boolean;
};

const LOCATION_TYPES: LocationType[] = ["OFFICE", "WAREHOUSE", "SITE", "OTHER"];

const emptyForm = { name: "", type: "WAREHOUSE" as LocationType, address: "" };

export function LocationsManager({
  canManage,
  onChange,
}: {
  canManage: boolean;
  onChange: () => void;
}) {
  const [locations, setLocations] = useState<Location[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function loadLocations() {
    setIsLoading(true);
    setListError(null);
    try {
      const response = await fetch(`${API_URL}/api/locations`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to load locations");
      setLocations(await response.json());
    } catch {
      setListError("Unable to load locations");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadLocations();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch(`${API_URL}/api/locations`, {
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
      await loadLocations();
      onChange();
    } catch {
      setFormError("Unable to reach the server");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function toggleActive(location: Location) {
    try {
      const response = await fetch(`${API_URL}/api/locations/${location.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ isActive: !location.isActive }),
      });
      if (!response.ok) throw new Error("Failed to update location");
      await loadLocations();
      onChange();
    } catch {
      setListError("Unable to update location");
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-6 py-4">
        <h2 className="text-sm font-semibold text-slate-900">Locations</h2>
      </div>

      <div className="p-6">
        {canManage && (
          <form onSubmit={handleSubmit} className="mb-4 grid gap-2 sm:grid-cols-3">
            <input
              type="text"
              required
              placeholder="Name"
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
            <select
              value={form.type}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, type: e.target.value as LocationType }))
              }
              className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            >
              {LOCATION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <input
              type="text"
              placeholder="Address"
              value={form.address}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, address: e.target.value }))
              }
              className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={isSubmitting}
              className="justify-self-start rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-50 sm:col-span-3"
            >
              {isSubmitting ? "Adding..." : "Add location"}
            </button>
          </form>
        )}

        {formError && <p className="mb-2 text-sm text-red-600">{formError}</p>}
        {listError && <p className="mb-2 text-sm text-red-600">{listError}</p>}
        {isLoading && <p className="text-sm text-slate-500">Loading...</p>}

        {!isLoading && locations.length === 0 && (
          <p className="text-sm text-slate-500">No locations yet.</p>
        )}

        {!isLoading && locations.length > 0 && (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-slate-400">
                <th className="pb-3 font-medium">Name</th>
                <th className="pb-3 font-medium">Type</th>
                <th className="pb-3 font-medium">Status</th>
                {canManage && <th className="pb-3 font-medium">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {locations.map((location) => (
                <tr key={location.id} className="border-t border-slate-100">
                  <td className="py-3 font-medium text-slate-900">{location.name}</td>
                  <td className="py-3 text-slate-500">{location.type}</td>
                  <td className="py-3">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        location.isActive
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {location.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                  {canManage && (
                    <td className="py-3">
                      <button
                        onClick={() => toggleActive(location)}
                        className="text-sm font-medium text-blue-600 hover:text-blue-500"
                      >
                        {location.isActive ? "Deactivate" : "Activate"}
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
