"use client";

import { useEffect, useState, type FormEvent } from "react";
import { CheckSquare, AlertTriangle, ShieldAlert, Award, Plus, X, Calendar } from "lucide-react";
import { API_URL } from "@/lib/api";
import { useToast } from "@/components/ui/toast-provider";
import { TableSkeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";

type CalibrationStatus = "PASSED" | "FAILED" | "CONDITIONAL";

type DueAsset = {
  assetId: number;
  assetTag: string;
  serialNumber: string | null;
  status: string;
  itemName: string;
  itemCode: string;
  locationName: string;
  lastCalibrated: string | null;
  nextDueDate: string | null;
  latestStatus: CalibrationStatus | null;
  isOverdue: boolean;
  isDueSoon: boolean;
  isUncalibrated: boolean;
};

type CalibrationRecord = {
  id: number;
  calibrationDate: string;
  nextDueDate: string;
  status: CalibrationStatus;
  certificateNumber: string | null;
  performedBy: string | null;
  provider: string | null;
  notes: string | null;
  asset: {
    id: number;
    assetTag: string;
    serialNumber: string | null;
    status: string;
    item: { name: string; itemCode: string };
    currentLocation: { name: string } | null;
  };
};

export function CalibrationsManager() {
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<"due" | "history">("due");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [dueAssets, setDueAssets] = useState<DueAsset[]>([]);
  const [records, setRecords] = useState<CalibrationRecord[]>([]);
  const [allAssets, setAllAssets] = useState<Array<{ id: number; assetTag: string; item: { name: string } }>>([]);

  const [showModal, setShowModal] = useState(false);
  const [selectedAssetId, setSelectedAssetId] = useState<string>("");
  const [form, setForm] = useState({
    status: "PASSED" as CalibrationStatus,
    calibrationDate: new Date().toISOString().split("T")[0],
    nextDueDate: "",
    certificateNumber: "",
    performedBy: "",
    provider: "",
    notes: "",
  });
  const [submitting, setSubmitting] = useState(false);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const [dueRes, historyRes, assetsRes] = await Promise.all([
        fetch(`${API_URL}/api/calibrations/due`, { credentials: "include" }),
        fetch(`${API_URL}/api/calibrations?pageSize=50`, { credentials: "include" }),
        fetch(`${API_URL}/api/assets?pageSize=100`, { credentials: "include" }),
      ]);

      if (dueRes.ok) setDueAssets(await dueRes.json());
      if (historyRes.ok) {
        const body = await historyRes.json();
        setRecords(body.data || []);
      }
      if (assetsRes.ok) {
        const body = await assetsRes.json();
        setAllAssets(body.data || []);
      }
    } catch {
      setError("Unable to load calibration schedule");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  function openCalibrateModal(assetId?: number) {
    if (assetId) {
      setSelectedAssetId(String(assetId));
    } else if (allAssets.length > 0) {
      setSelectedAssetId(String(allAssets[0].id));
    }

    // Default next due date to 1 year from now
    const nextYear = new Date();
    nextYear.setFullYear(nextYear.getFullYear() + 1);

    setForm({
      status: "PASSED",
      calibrationDate: new Date().toISOString().split("T")[0],
      nextDueDate: nextYear.toISOString().split("T")[0],
      certificateNumber: "",
      performedBy: "",
      provider: "",
      notes: "",
    });
    setShowModal(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!selectedAssetId) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${API_URL}/api/calibrations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          assetId: Number(selectedAssetId),
          status: form.status,
          calibrationDate: form.calibrationDate,
          nextDueDate: form.nextDueDate,
          certificateNumber: form.certificateNumber || undefined,
          performedBy: form.performedBy || undefined,
          provider: form.provider || undefined,
          notes: form.notes || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save calibration");

      if (form.status === "FAILED") {
        toast.error("Calibration FAILED: Asset has been automatically quarantined!");
      } else {
        toast.success("Calibration certificate recorded successfully");
      }
      setShowModal(false);
      await loadData();
    } catch (err: unknown) {
      toast.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const overdueCount = dueAssets.filter((a) => a.isOverdue).length;
  const dueSoonCount = dueAssets.filter((a) => a.isDueSoon).length;
  const uncalibratedCount = dueAssets.filter((a) => a.isUncalibrated).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#dfe7e1] pb-5">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Calibration & Compliance</h2>
          <p className="text-xs text-slate-500 mt-1">
            Maintain regulatory compliance, traceable calibration certificates, and automatic quarantine enforcement.
          </p>
        </div>
        <button
          type="button"
          onClick={() => openCalibrateModal()}
          className="flex items-center gap-1.5 rounded-lg border border-[#0f3d35] bg-[#0f3d35] px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-[#155449]"
        >
          <Plus className="h-4 w-4" />
          Record Calibration
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-rose-800">Overdue Equipment</span>
            <ShieldAlert className="h-4 w-4 text-rose-600" />
          </div>
          <p className="mt-2 text-2xl font-bold text-rose-700">{overdueCount}</p>
          <p className="text-[11px] text-rose-600 mt-0.5">High risk — service required</p>
        </div>

        <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-amber-800">Due Within 30 Days</span>
            <AlertTriangle className="h-4 w-4 text-amber-600" />
          </div>
          <p className="mt-2 text-2xl font-bold text-amber-700">{dueSoonCount}</p>
          <p className="text-[11px] text-amber-600 mt-0.5">Schedule lab or on-site calibration</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-600">Pending Baseline</span>
            <Calendar className="h-4 w-4 text-slate-500" />
          </div>
          <p className="mt-2 text-2xl font-bold text-slate-900">{uncalibratedCount}</p>
          <p className="text-[11px] text-slate-500 mt-0.5">Newly commissioned instruments</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-slate-200 pb-2">
        <button
          type="button"
          onClick={() => setActiveTab("due")}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
            activeTab === "due"
              ? "bg-[#0f3d35] text-white"
              : "text-slate-600 hover:bg-slate-100"
          }`}
        >
          Due & Overdue Schedule ({dueAssets.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("history")}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
            activeTab === "history"
              ? "bg-[#0f3d35] text-white"
              : "text-slate-600 hover:bg-slate-100"
          }`}
        >
          Certificate History Log ({records.length})
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-xs text-red-700">
          {error}
        </div>
      )}

      {/* Tab 1: Due Assets */}
      {activeTab === "due" && (
        <div>
          {loading ? (
            <TableSkeleton cols={6} rows={5} />
          ) : dueAssets.length === 0 ? (
            <EmptyState
              icon={CheckSquare}
              title="All equipment calibrated"
              description="No serialized instruments are currently overdue or due for calibration."
            />
          ) : (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-100 bg-slate-50 text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
                    <tr>
                      <th className="px-4 py-3">Asset Tag</th>
                      <th className="px-4 py-3">Instrument Model</th>
                      <th className="px-4 py-3">Location</th>
                      <th className="px-4 py-3">Last Calibrated</th>
                      <th className="px-4 py-3">Next Due Date</th>
                      <th className="px-4 py-3">Compliance Status</th>
                      <th className="px-4 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {dueAssets.map((asset) => (
                      <tr key={asset.assetId} className="hover:bg-slate-50/70 transition">
                        <td className="px-4 py-3 font-mono font-bold text-slate-900">{asset.assetTag}</td>
                        <td className="px-4 py-3">
                          <p className="font-semibold text-slate-900">{asset.itemName}</p>
                          <p className="text-[10px] text-slate-400 font-mono">{asset.itemCode}</p>
                        </td>
                        <td className="px-4 py-3 text-slate-600">{asset.locationName}</td>
                        <td className="px-4 py-3 text-slate-500">
                          {asset.lastCalibrated ? new Date(asset.lastCalibrated).toLocaleDateString() : "Never"}
                        </td>
                        <td className="px-4 py-3 font-semibold text-slate-900">
                          {asset.nextDueDate ? new Date(asset.nextDueDate).toLocaleDateString() : "Required"}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${
                              asset.isOverdue
                                ? "bg-rose-100 text-rose-800"
                                : asset.isDueSoon
                                  ? "bg-amber-100 text-amber-800"
                                  : "bg-slate-100 text-slate-700"
                            }`}
                          >
                            {asset.isOverdue ? "OVERDUE" : asset.isDueSoon ? "DUE SOON" : "PENDING BASELINE"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => openCalibrateModal(asset.assetId)}
                            className="rounded bg-[#0f3d35] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[#155449]"
                          >
                            Calibrate
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Certificate History */}
      {activeTab === "history" && (
        <div>
          {loading ? (
            <TableSkeleton cols={6} rows={6} />
          ) : records.length === 0 ? (
            <EmptyState icon={Award} title="No records found" description="No calibration records have been recorded yet." />
          ) : (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-100 bg-slate-50 text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
                    <tr>
                      <th className="px-4 py-3">Date</th>
                      <th className="px-4 py-3">Asset</th>
                      <th className="px-4 py-3">Certificate #</th>
                      <th className="px-4 py-3">Result</th>
                      <th className="px-4 py-3">Next Due</th>
                      <th className="px-4 py-3">Inspector / Provider</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {records.map((r) => (
                      <tr key={r.id} className="hover:bg-slate-50/70 transition">
                        <td className="px-4 py-3 text-slate-600">
                          {new Date(r.calibrationDate).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-900">
                          {r.asset.assetTag} ({r.asset.item.name})
                        </td>
                        <td className="px-4 py-3 font-mono text-slate-700">
                          {r.certificateNumber ?? "—"}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${
                              r.status === "PASSED"
                                ? "bg-emerald-100 text-emerald-800"
                                : r.status === "FAILED"
                                  ? "bg-rose-100 text-rose-800"
                                  : "bg-amber-100 text-amber-800"
                            }`}
                          >
                            {r.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-700">
                          {new Date(r.nextDueDate).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3 text-slate-500">
                          {r.performedBy || r.provider || "Internal"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Record Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">Record Equipment Calibration</h3>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700">Target Asset</label>
                <select
                  required
                  value={selectedAssetId}
                  onChange={(e) => setSelectedAssetId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-[#0f3d35] focus:outline-none"
                >
                  <option value="">Select Asset...</option>
                  {allAssets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.assetTag} — {a.item.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Calibration Outcome</label>
                  <select
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value as CalibrationStatus })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-[#0f3d35] focus:outline-none"
                  >
                    <option value="PASSED">PASSED</option>
                    <option value="FAILED">FAILED (Quarantine Asset)</option>
                    <option value="CONDITIONAL">CONDITIONAL</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700">Certificate / Traceability #</label>
                  <input
                    type="text"
                    placeholder="e.g. NIST-CAL-99214"
                    value={form.certificateNumber}
                    onChange={(e) => setForm({ ...form, certificateNumber: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-[#0f3d35] focus:outline-none"
                  />
                </div>
              </div>

              {form.status === "FAILED" && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
                  <p className="font-bold flex items-center gap-1">
                    <ShieldAlert className="h-3.5 w-3.5" />
                    Automatic Safety Quarantine Notice
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed">
                    Recording a FAILED calibration immediately sets this asset status to QUARANTINED in compliance with equipment safety policies.
                  </p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Calibration Date</label>
                  <input
                    type="date"
                    required
                    value={form.calibrationDate}
                    onChange={(e) => setForm({ ...form, calibrationDate: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-[#0f3d35] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700">Next Due Date</label>
                  <input
                    type="date"
                    required
                    value={form.nextDueDate}
                    onChange={(e) => setForm({ ...form, nextDueDate: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-[#0f3d35] focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Performed By (Technician)</label>
                  <input
                    type="text"
                    placeholder="e.g. John Doe, Lead Chemist"
                    value={form.performedBy}
                    onChange={(e) => setForm({ ...form, performedBy: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-[#0f3d35] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700">Accredited Lab / Provider</label>
                  <input
                    type="text"
                    placeholder="e.g. EnviroMetrics Labs LLC"
                    value={form.provider}
                    onChange={(e) => setForm({ ...form, provider: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-[#0f3d35] focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">Observations / Standards Used</label>
                <textarea
                  rows={2}
                  placeholder="Reference standard gases, span readings, zero offsets..."
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-[#0f3d35] focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg bg-[#0f3d35] px-4 py-2 text-xs font-semibold text-white hover:bg-[#155449] disabled:opacity-50"
                >
                  {submitting ? "Saving..." : "Record Certificate"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
