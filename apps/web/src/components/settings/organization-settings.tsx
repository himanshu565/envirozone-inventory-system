"use client";

import { useEffect, useState, type FormEvent } from "react";
import { API_URL } from "@/lib/api";
import { useToast } from "@/components/ui/toast-provider";
import { TableSkeleton } from "@/components/ui/skeleton";

type Organization = {
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  logoUrl: string | null;
  currency: string;
};

const emptyForm = {
  name: "",
  address: "",
  phone: "",
  email: "",
  logoUrl: "",
  currency: "INR",
};

export function OrganizationSettings() {
  const toast = useToast();

  const [form, setForm] = useState(emptyForm);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [logoBroken, setLogoBroken] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setLoadError(null);
      try {
        const response = await fetch(`${API_URL}/api/organization`, {
          credentials: "include",
        });
        if (!response.ok) throw new Error("Failed to load organization");
        const org: Organization = await response.json();
        if (cancelled) return;
        setForm({
          name: org.name,
          address: org.address ?? "",
          phone: org.phone ?? "",
          email: org.email ?? "",
          logoUrl: org.logoUrl ?? "",
          currency: org.currency,
        });
      } catch {
        if (!cancelled) setLoadError("Unable to load organization settings");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch(`${API_URL}/api/organization`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(form),
      });
      const data = await response.json();

      if (!response.ok) {
        setFormError(data.error ?? "Something went wrong");
        return;
      }

      setLogoBroken(false);
      toast.success("Organization settings saved");
    } catch {
      setFormError("Unable to reach the server");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isLoading) {
    return (
      <div className="max-w-2xl rounded-lg border border-slate-200 bg-white p-6">
        <TableSkeleton rows={4} cols={2} />
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <form
        onSubmit={handleSubmit}
        className="rounded-lg border border-slate-200 bg-white"
      >
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-sm font-semibold text-slate-900">
            Organization settings
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Your company profile — used across documents and reports.
          </p>
        </div>

        <div className="flex flex-col gap-4 p-6">
          {loadError && <p className="text-sm text-red-600">{loadError}</p>}

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">
                Company name
              </span>
              <input
                type="text"
                required
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">
                Currency
              </span>
              <input
                type="text"
                required
                maxLength={3}
                placeholder="INR"
                value={form.currency}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, currency: e.target.value.toUpperCase() }))
                }
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm uppercase focus:border-blue-500 focus:outline-none"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">
                Phone
              </span>
              <input
                type="text"
                value={form.phone}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, phone: e.target.value }))
                }
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">
                Email
              </span>
              <input
                type="email"
                value={form.email}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, email: e.target.value }))
                }
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </label>

            <label className="block sm:col-span-2">
              <span className="mb-1 block text-sm font-medium text-slate-700">
                Address
              </span>
              <input
                type="text"
                value={form.address}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, address: e.target.value }))
                }
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </label>

            <label className="block sm:col-span-2">
              <span className="mb-1 block text-sm font-medium text-slate-700">
                Logo URL
              </span>
              <input
                type="text"
                value={form.logoUrl}
                onChange={(e) => {
                  setLogoBroken(false);
                  setForm((prev) => ({ ...prev, logoUrl: e.target.value }));
                }}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </label>
          </div>

          {form.logoUrl && !logoBroken && (
            <div className="flex items-center gap-3">
              <span className="text-sm text-slate-500">Preview:</span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={form.logoUrl}
                alt="Organization logo"
                className="h-10 w-10 rounded object-contain"
                onError={() => setLogoBroken(true)}
              />
            </div>
          )}
          {form.logoUrl && logoBroken && (
            <p className="text-sm text-amber-600">Couldn&apos;t load an image from that URL.</p>
          )}
        </div>

        {formError && (
          <p className="border-t border-slate-100 px-6 py-3 text-sm text-red-600">
            {formError}
          </p>
        )}

        <div className="flex items-center gap-3 border-t border-slate-100 px-6 py-4">
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-50"
          >
            {isSubmitting ? "Saving..." : "Save changes"}
          </button>
        </div>
      </form>
    </div>
  );
}
