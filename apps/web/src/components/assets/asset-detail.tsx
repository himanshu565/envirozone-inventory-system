"use client";

import { useCallback, useEffect, useState } from "react";
import { API_URL } from "@/lib/api";
import { useToast } from "@/components/ui/toast-provider";

type Asset = {
  id: number;
  assetTag: string;
  serialNumber: string | null;
  status: string;
  purchaseDate: string | null;
  warrantyExpires: string | null;
  notes: string | null;
  item: { itemCode: string; name: string };
  currentLocation: { id: number; name: string; type: string } | null;
  assignedUser: { id: number; name: string; email: string } | null;
};

type HistoryData = {
  workOrders: Array<{
    id: number;
    woNumber: string;
    title: string;
    status: string;
    priority: string;
    createdAt: string;
    assignee: { name: string } | null;
  }>;
  calibrations: Array<{
    id: number;
    calibrationDate: string;
    nextDueDate: string;
    status: string;
    certificateNumber: string | null;
    performedBy: string | null;
  }>;
  auditLogs: Array<{
    id: number;
    action: string;
    createdAt: string;
    actor: { name: string } | null;
  }>;
};

export function AssetDetail({ id }: { id: string }) {
  const toast = useToast();
  const [asset, setAsset] = useState<Asset | null>(null);
  const [history, setHistory] = useState<HistoryData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [transitioning, setTransitioning] = useState(false);
  const [activeTab, setActiveTab] = useState<"details" | "workOrders" | "calibrations" | "audit">("details");

  const loadAsset = useCallback(async () => {
    try {
      const [resAsset, resHistory] = await Promise.all([
        fetch(`${API_URL}/api/assets/${id}`, { credentials: "include" }),
        fetch(`${API_URL}/api/assets/${id}/history`, { credentials: "include" }),
      ]);
      if (!resAsset.ok) {
        const body = await resAsset.json();
        throw new Error(body.error ?? "Unable to load asset");
      }
      setAsset(await resAsset.json());
      if (resHistory.ok) {
        setHistory(await resHistory.json());
      }
    } catch (err: unknown) {
      setError((err as Error).message);
    }
  }, [id]);

  useEffect(() => {
    loadAsset();
  }, [loadAsset]);

  async function updateStatus(nextStatus: string) {
    setTransitioning(true);
    try {
      const res = await fetch(`${API_URL}/api/assets/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status: nextStatus }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to update asset status");

      toast.success(`Asset status moved to ${nextStatus.replace("_", " ")}`);
      await loadAsset();
    } catch (err: unknown) {
      toast.error((err as Error).message);
    } finally {
      setTransitioning(false);
    }
  }

  if (error) return <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>;
  if (!asset) return <p className="text-sm text-slate-500">Loading asset...</p>;

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-[#0f3d35]">Serialized Equipment</p>
          <h1 className="text-2xl font-bold text-slate-900 mt-1">{asset.assetTag}</h1>
          <p className="text-sm text-slate-500">{asset.item.itemCode} — {asset.item.name}</p>
        </div>

        {/* Lifecycle Status Transition Actions */}
        <div className="flex flex-wrap items-center gap-2">
          {asset.status !== "IN_STOCK" && (
            <button
              type="button"
              disabled={transitioning}
              onClick={() => updateStatus("IN_STOCK")}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Return to Stock
            </button>
          )}

          {asset.status !== "DEPLOYED" && (
            <button
              type="button"
              disabled={transitioning}
              onClick={() => updateStatus("DEPLOYED")}
              className="rounded-lg bg-[#0f3d35] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#155449] disabled:opacity-50"
            >
              Deploy to Site
            </button>
          )}

          {asset.status !== "UNDER_MAINTENANCE" && (
            <button
              type="button"
              disabled={transitioning}
              onClick={() => updateStatus("UNDER_MAINTENANCE")}
              className="rounded-lg border border-blue-300 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-800 hover:bg-blue-100 disabled:opacity-50"
            >
              Send to Maintenance
            </button>
          )}

          {asset.status !== "QUARANTINED" && (
            <button
              type="button"
              disabled={transitioning}
              onClick={() => updateStatus("QUARANTINED")}
              className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-800 hover:bg-rose-100 disabled:opacity-50"
            >
              Quarantine
            </button>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Lifecycle Status</p>
          <span
            className={`mt-2 inline-flex items-center rounded-md px-2.5 py-1 text-xs font-bold ${
              asset.status === "IN_STOCK"
                ? "bg-emerald-100 text-emerald-800"
                : asset.status === "DEPLOYED"
                  ? "bg-blue-100 text-blue-800"
                  : asset.status === "QUARANTINED"
                    ? "bg-rose-100 text-rose-800"
                    : "bg-amber-100 text-amber-800"
            }`}
          >
            {asset.status.replace("_", " ")}
          </span>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Serial Number</p>
          <p className="mt-2 text-sm font-semibold font-mono text-slate-900">{asset.serialNumber ?? "Not recorded"}</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Current Location</p>
          <p className="mt-2 text-sm font-semibold text-[#0f3d35]">{asset.currentLocation?.name ?? "Unassigned"}</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Assigned Technician</p>
          <p className="mt-2 text-sm font-semibold text-slate-900">{asset.assignedUser?.name ?? "Unassigned"}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-slate-200 pb-2">
        <button
          type="button"
          onClick={() => setActiveTab("details")}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
            activeTab === "details" ? "bg-[#0f3d35] text-white" : "text-slate-600 hover:bg-slate-100"
          }`}
        >
          Registration Details
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("workOrders")}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
            activeTab === "workOrders" ? "bg-[#0f3d35] text-white" : "text-slate-600 hover:bg-slate-100"
          }`}
        >
          Service & Work Orders ({history?.workOrders?.length ?? 0})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("calibrations")}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
            activeTab === "calibrations" ? "bg-[#0f3d35] text-white" : "text-slate-600 hover:bg-slate-100"
          }`}
        >
          Calibrations ({history?.calibrations?.length ?? 0})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("audit")}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
            activeTab === "audit" ? "bg-[#0f3d35] text-white" : "text-slate-600 hover:bg-slate-100"
          }`}
        >
          Audit Timeline ({history?.auditLogs?.length ?? 0})
        </button>
      </div>

      {/* Tab 1: Details */}
      {activeTab === "details" && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-bold text-slate-900">Warranty & Procurement</h2>
          <dl className="mt-4 grid gap-4 text-xs sm:grid-cols-2">
            <div>
              <dt className="text-slate-500 font-medium">Purchase Date</dt>
              <dd className="mt-1 text-sm font-semibold text-slate-900">
                {asset.purchaseDate ? new Date(asset.purchaseDate).toLocaleDateString() : "Not recorded"}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500 font-medium">Warranty Expiry</dt>
              <dd className="mt-1 text-sm font-semibold text-slate-900">
                {asset.warrantyExpires ? new Date(asset.warrantyExpires).toLocaleDateString() : "Not recorded"}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-slate-500 font-medium">Technical Notes</dt>
              <dd className="mt-1 whitespace-pre-wrap text-xs text-slate-700 bg-slate-50 p-3 rounded-lg border border-slate-100">
                {asset.notes || "No technical notes recorded for this asset."}
              </dd>
            </div>
          </dl>
        </div>
      )}

      {/* Tab 2: Work Orders */}
      {activeTab === "workOrders" && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-3">
          <h2 className="text-sm font-bold text-slate-900">Associated Work Orders</h2>
          {(!history?.workOrders || history.workOrders.length === 0) ? (
            <p className="text-xs text-slate-400 py-4">No work orders recorded for this asset.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {history.workOrders.map((wo) => (
                <div key={wo.id} className="py-2.5 flex items-center justify-between text-xs">
                  <div>
                    <span className="font-mono font-bold text-[#0f3d35]">{wo.woNumber}</span>
                    <span className="ml-2 font-medium text-slate-800">{wo.title}</span>
                  </div>
                  <div className="flex items-center gap-3 text-slate-500">
                    <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-semibold">{wo.status}</span>
                    <span>{new Date(wo.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Calibrations */}
      {activeTab === "calibrations" && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-3">
          <h2 className="text-sm font-bold text-slate-900">Calibration Certificate Log</h2>
          {(!history?.calibrations || history.calibrations.length === 0) ? (
            <p className="text-xs text-slate-400 py-4">No calibration records logged yet.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {history.calibrations.map((c) => (
                <div key={c.id} className="py-2.5 flex items-center justify-between text-xs">
                  <div>
                    <span className={`inline-flex rounded px-2 py-0.5 text-[10px] font-bold ${
                      c.status === "PASSED" ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"
                    }`}>
                      {c.status}
                    </span>
                    <span className="ml-2 font-mono font-medium text-slate-700">Cert: {c.certificateNumber ?? "N/A"}</span>
                  </div>
                  <div className="text-slate-500">
                    <span>Calibrated: {new Date(c.calibrationDate).toLocaleDateString()}</span>
                    <span className="ml-3 font-semibold text-slate-700">Due: {new Date(c.nextDueDate).toLocaleDateString()}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab 4: Audit */}
      {activeTab === "audit" && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-3">
          <h2 className="text-sm font-bold text-slate-900">Asset Audit Trail</h2>
          {(!history?.auditLogs || history.auditLogs.length === 0) ? (
            <p className="text-xs text-slate-400 py-4">No audit events recorded.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {history.auditLogs.map((log) => (
                <div key={log.id} className="py-2 flex items-center justify-between text-xs">
                  <div>
                    <span className="font-semibold text-slate-800">{log.action}</span>
                    <span className="ml-2 text-slate-500">by {log.actor?.name ?? "System"}</span>
                  </div>
                  <span className="text-slate-400">{new Date(log.createdAt).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
