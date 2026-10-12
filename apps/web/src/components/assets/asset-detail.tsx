"use client";

import { useEffect, useState } from "react";
import { API_URL } from "@/lib/api";

type Asset = {
  id: number;
  assetTag: string;
  serialNumber: string | null;
  status: string;
  purchaseDate: string | null;
  warrantyExpires: string | null;
  notes: string | null;
  item: { itemCode: string; name: string };
  currentLocation: { name: string; type: string } | null;
  assignedUser: { name: string; email: string } | null;
};

export function AssetDetail({ id }: { id: string }) {
  const [asset, setAsset] = useState<Asset | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_URL}/api/assets/${id}`, { credentials: "include" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Unable to load asset");
        setAsset(body);
      })
      .catch((reason: Error) => setError(reason.message));
  }, [id]);

  if (error) return <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>;
  if (!asset) return <p className="text-sm text-slate-500">Loading asset...</p>;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm font-medium text-[#2d6a5b]">Serialized asset</p>
        <h1 className="text-2xl font-semibold text-slate-900">{asset.assetTag}</h1>
        <p className="mt-1 text-sm text-slate-500">{asset.item.itemCode} — {asset.item.name}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Status", asset.status],
          ["Serial number", asset.serialNumber ?? "Not recorded"],
          ["Current location", asset.currentLocation?.name ?? "Unassigned"],
          ["Assigned technician", asset.assignedUser?.name ?? "Unassigned"],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-slate-200 bg-white p-5">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
            <p className="mt-2 text-sm font-semibold text-slate-900">{value}</p>
          </div>
        ))}
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="text-sm font-semibold text-slate-900">Registration details</h2>
        <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
          <div><dt className="text-slate-500">Purchase date</dt><dd className="font-medium text-slate-900">{asset.purchaseDate ? new Date(asset.purchaseDate).toLocaleDateString() : "Not recorded"}</dd></div>
          <div><dt className="text-slate-500">Warranty expiry</dt><dd className="font-medium text-slate-900">{asset.warrantyExpires ? new Date(asset.warrantyExpires).toLocaleDateString() : "Not recorded"}</dd></div>
          <div className="sm:col-span-2"><dt className="text-slate-500">Notes</dt><dd className="mt-1 whitespace-pre-wrap text-slate-900">{asset.notes || "No notes recorded."}</dd></div>
        </dl>
      </div>
    </div>
  );
}
