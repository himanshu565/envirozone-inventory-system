"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { Cpu } from "lucide-react";
import { API_URL } from "@/lib/api";
import { useToast } from "@/components/ui/toast-provider";
import { EmptyState } from "@/components/ui/empty-state";
import { TableSkeleton } from "@/components/ui/skeleton";

type Item = {
  id: number;
  itemCode: string;
  name: string;
  trackingMode: "QUANTITY" | "SERIALIZED";
};
type Location = { id: number; name: string; isActive: boolean };
type Asset = {
  id: number;
  assetTag: string;
  serialNumber: string | null;
  status: string;
  item: Item;
  currentLocation: { id: number; name: string } | null;
};

const emptyForm = {
  assetTag: "",
  serialNumber: "",
  itemId: "",
  currentLocationId: "",
  purchaseDate: "",
  warrantyExpires: "",
  notes: "",
};

export function AssetsManager() {
  const toast = useToast();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [assetsResponse, itemsResponse, locationsResponse] = await Promise.all([
        fetch(`${API_URL}/api/assets?pageSize=100`, { credentials: "include" }),
        fetch(`${API_URL}/api/items?pageSize=100&sortBy=name`, { credentials: "include" }),
        fetch(`${API_URL}/api/locations`, { credentials: "include" }),
      ]);
      if (!assetsResponse.ok || !itemsResponse.ok || !locationsResponse.ok) {
        throw new Error("Unable to load asset data");
      }
      const assetBody: { data: Asset[] } = await assetsResponse.json();
      const itemBody: { data: Item[] } = await itemsResponse.json();
      setAssets(assetBody.data);
      setItems(itemBody.data.filter((item) => item.trackingMode === "SERIALIZED"));
      setLocations(await locationsResponse.json());
      setForm((previous) => ({
        ...previous,
        itemId: previous.itemId || String(itemBody.data.find((item) => item.trackingMode === "SERIALIZED")?.id ?? ""),
      }));
      setError(null);
    } catch {
      setError("Unable to load serialized assets");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      const response = await fetch(`${API_URL}/api/assets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          ...form,
          itemId: Number(form.itemId),
          currentLocationId: form.currentLocationId || undefined,
          purchaseDate: form.purchaseDate || undefined,
          warrantyExpires: form.warrantyExpires || undefined,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setFormError(body.error ?? "Unable to register asset");
        return;
      }
      setForm(emptyForm);
      await load();
      toast.success(`Asset "${body.assetTag}" registered`);
    } catch {
      setFormError("Unable to reach the server");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm font-medium text-[#2d6a5b]">EnviroTrack</p>
        <h1 className="text-2xl font-semibold text-slate-900">Serialized assets</h1>
        <p className="mt-1 text-sm text-slate-500">
          Register individually tracked instruments without changing consumable stock.
        </p>
      </div>

      <form onSubmit={submit} className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-sm font-semibold text-slate-900">Register equipment</h2>
        </div>
        <div className="grid gap-4 p-6 sm:grid-cols-2 lg:grid-cols-3">
          <input required placeholder="Asset tag" value={form.assetTag} onChange={(e) => setForm({ ...form, assetTag: e.target.value })} className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
          <input placeholder="Serial number (optional)" value={form.serialNumber} onChange={(e) => setForm({ ...form, serialNumber: e.target.value })} className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
          <select required value={form.itemId} onChange={(e) => setForm({ ...form, itemId: e.target.value })} className="rounded-md border border-slate-300 px-3 py-2 text-sm">
            <option value="" disabled>Select serialized model</option>
            {items.map((item) => <option key={item.id} value={item.id}>{item.itemCode} — {item.name}</option>)}
          </select>
          <select value={form.currentLocationId} onChange={(e) => setForm({ ...form, currentLocationId: e.target.value })} className="rounded-md border border-slate-300 px-3 py-2 text-sm">
            <option value="">No current location</option>
            {locations.filter((location) => location.isActive).map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
          </select>
          <input type="date" aria-label="Purchase date" value={form.purchaseDate} onChange={(e) => setForm({ ...form, purchaseDate: e.target.value })} className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
          <input type="date" aria-label="Warranty expiry" value={form.warrantyExpires} onChange={(e) => setForm({ ...form, warrantyExpires: e.target.value })} className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
          <textarea placeholder="Notes (optional)" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="min-h-20 rounded-md border border-slate-300 px-3 py-2 text-sm sm:col-span-2 lg:col-span-3" />
        </div>
        <div className="flex items-center gap-3 border-t border-slate-100 px-6 py-4">
          {formError && <p className="flex-1 text-sm text-red-600">{formError}</p>}
          <button type="submit" disabled={submitting || items.length === 0} className="ml-auto rounded-md bg-[#0f3d35] px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {submitting ? "Registering..." : "Register asset"}
          </button>
        </div>
      </form>

      {loading ? <TableSkeleton rows={4} cols={4} /> : error ? <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p> : assets.length === 0 ? <EmptyState icon={Cpu} title="No serialized assets yet" description="Mark an item as serialized, then register the first instrument here." /> : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-6 py-3">Asset</th><th className="px-6 py-3">Model</th><th className="px-6 py-3">Status</th><th className="px-6 py-3">Location</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {assets.map((asset) => <tr key={asset.id} className="hover:bg-slate-50"><td className="px-6 py-4"><Link href={`/assets/${asset.id}`} className="font-medium text-[#176b59] hover:underline">{asset.assetTag}</Link><div className="text-xs text-slate-500">{asset.serialNumber ?? "No serial number"}</div></td><td className="px-6 py-4">{asset.item.name}<div className="text-xs text-slate-500">{asset.item.itemCode}</div></td><td className="px-6 py-4">{asset.status}</td><td className="px-6 py-4">{asset.currentLocation?.name ?? "Unassigned"}</td></tr>)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
