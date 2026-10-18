"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Wrench, Plus, X } from "lucide-react";
import { API_URL } from "@/lib/api";
import { useToast } from "@/components/ui/toast-provider";
import { TableSkeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";

type WorkOrderPriority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
type WorkOrderStatus = "OPEN" | "ASSIGNED" | "IN_PROGRESS" | "WAITING_FOR_PARTS" | "COMPLETED" | "CANCELLED";
type WorkOrderType = "PREVENTIVE" | "CORRECTIVE" | "CALIBRATION" | "INSPECTION" | "INSTALLATION";

type WorkOrder = {
  id: number;
  woNumber: string;
  title: string;
  description: string | null;
  priority: WorkOrderPriority;
  type: WorkOrderType;
  status: WorkOrderStatus;
  dueDate: string | null;
  startedAt: string | null;
  completedAt: string | null;
  resolution: string | null;
  asset: { id: number; assetTag: string; item: { name: string } } | null;
  location: { id: number; name: string } | null;
  assignee: { id: number; name: string } | null;
  parts: Array<{
    id: number;
    quantity: number;
    item: { id: number; itemCode: string; name: string; unit: string };
    location: { name: string } | null;
  }>;
};

type OptionItem = { id: number; name: string; itemCode?: string };

export function WorkOrdersManager() {
  const toast = useToast();
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter state
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [priorityFilter, setPriorityFilter] = useState<string>("");

  // Options state
  const [assets, setAssets] = useState<Array<{ id: number; assetTag: string; item: { name: string } }>>([]);
  const [locations, setLocations] = useState<OptionItem[]>([]);
  const [items, setItems] = useState<OptionItem[]>([]);
  const [users, setUsers] = useState<OptionItem[]>([]);

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showPartsModal, setShowPartsModal] = useState<WorkOrder | null>(null);
  const [showCompleteModal, setShowCompleteModal] = useState<WorkOrder | null>(null);

  // Form states
  const [createForm, setCreateForm] = useState({
    title: "",
    description: "",
    priority: "MEDIUM" as WorkOrderPriority,
    type: "CORRECTIVE" as WorkOrderType,
    dueDate: "",
    assetId: "",
    locationId: "",
    assigneeId: "",
  });
  const [partsForm, setPartsForm] = useState({ itemId: "", locationId: "", quantity: "1" });
  const [resolutionText, setResolutionText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ pageSize: "100" });
      if (statusFilter) params.set("status", statusFilter);
      if (priorityFilter) params.set("priority", priorityFilter);

      const [ordersRes, assetsRes, locsRes, itemsRes, usersRes] = await Promise.all([
        fetch(`${API_URL}/api/work-orders?${params.toString()}`, { credentials: "include" }),
        fetch(`${API_URL}/api/assets?pageSize=100`, { credentials: "include" }),
        fetch(`${API_URL}/api/locations`, { credentials: "include" }),
        fetch(`${API_URL}/api/items?pageSize=100&sortBy=name`, { credentials: "include" }),
        fetch(`${API_URL}/api/users`, { credentials: "include" }),
      ]);

      if (ordersRes.ok) {
        const data = await ordersRes.json();
        setOrders(data.data || []);
      }
      if (assetsRes.ok) {
        const data = await assetsRes.json();
        setAssets(data.data || []);
      }
      if (locsRes.ok) setLocations(await locsRes.json());
      if (itemsRes.ok) {
        const data = await itemsRes.json();
        setItems(data.data || []);
      }
      if (usersRes.ok) setUsers(await usersRes.json());
    } catch {
      setError("Unable to load work orders");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, priorityFilter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch(`${API_URL}/api/work-orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          ...createForm,
          assetId: createForm.assetId || undefined,
          locationId: createForm.locationId || undefined,
          assigneeId: createForm.assigneeId || undefined,
          dueDate: createForm.dueDate || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create work order");

      toast.success(`Work Order ${data.woNumber} created`);
      setShowCreateModal(false);
      setCreateForm({
        title: "",
        description: "",
        priority: "MEDIUM",
        type: "CORRECTIVE",
        dueDate: "",
        assetId: "",
        locationId: "",
        assigneeId: "",
      });
      await loadData();
    } catch (err: unknown) {
      toast.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleStatusChange(order: WorkOrder, nextStatus: WorkOrderStatus) {
    if (nextStatus === "COMPLETED") {
      setShowCompleteModal(order);
      return;
    }

    try {
      const res = await fetch(`${API_URL}/api/work-orders/${order.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "Status transition failed");
      }
      toast.success(`Order status updated to ${nextStatus.replace("_", " ")}`);
      await loadData();
    } catch (err: unknown) {
      toast.error((err as Error).message);
    }
  }

  async function handleCompleteSubmit(e: FormEvent) {
    e.preventDefault();
    if (!showCompleteModal) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${API_URL}/api/work-orders/${showCompleteModal.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status: "COMPLETED", resolution: resolutionText }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "Failed to complete work order");
      }
      toast.success("Work Order completed successfully");
      setShowCompleteModal(null);
      setResolutionText("");
      await loadData();
    } catch (err: unknown) {
      toast.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAddParts(e: FormEvent) {
    e.preventDefault();
    if (!showPartsModal) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${API_URL}/api/work-orders/${showPartsModal.id}/parts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          itemId: Number(partsForm.itemId),
          locationId: partsForm.locationId ? Number(partsForm.locationId) : undefined,
          quantity: Number(partsForm.quantity),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Unable to consume parts");

      toast.success("Spare parts consumed and deducted from inventory");
      setShowPartsModal(null);
      setPartsForm({ itemId: "", locationId: "", quantity: "1" });
      await loadData();
    } catch (err: unknown) {
      toast.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Top Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#dfe7e1] pb-5">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Work Orders & Maintenance</h2>
          <p className="text-xs text-slate-500 mt-1">
            Dispatch repairs, track service lifecycles, and atomically issue spare parts to equipment.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-1.5 rounded-lg border border-[#0f3d35] bg-[#0f3d35] px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-[#155449]"
        >
          <Plus className="h-4 w-4" />
          Create Work Order
        </button>
      </div>

      {/* Filter Row */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 shadow-sm focus:border-[#0f3d35] focus:outline-none"
        >
          <option value="">All Statuses</option>
          <option value="OPEN">Open</option>
          <option value="ASSIGNED">Assigned</option>
          <option value="IN_PROGRESS">In Progress</option>
          <option value="WAITING_FOR_PARTS">Waiting for Parts</option>
          <option value="COMPLETED">Completed</option>
          <option value="CANCELLED">Cancelled</option>
        </select>

        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 shadow-sm focus:border-[#0f3d35] focus:outline-none"
        >
          <option value="">All Priorities</option>
          <option value="LOW">Low</option>
          <option value="MEDIUM">Medium</option>
          <option value="HIGH">High</option>
          <option value="CRITICAL">Critical</option>
        </select>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-xs text-red-700">
          {error}
        </div>
      )}

      {/* List */}
      {loading ? (
        <TableSkeleton cols={7} rows={6} />
      ) : orders.length === 0 ? (
        <EmptyState
          icon={Wrench}
          title="No work orders found"
          description="Create a work order to track preventive maintenance or emergency repairs."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-100 bg-slate-50 text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3">WO #</th>
                  <th className="px-4 py-3">Title & Equipment</th>
                  <th className="px-4 py-3">Priority</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Assignee</th>
                  <th className="px-4 py-3">Due Date</th>
                  <th className="px-4 py-3">Parts Used</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {orders.map((wo) => (
                  <tr key={wo.id} className="hover:bg-slate-50/70 transition">
                    <td className="px-4 py-3 font-mono font-bold text-[#0f3d35]">{wo.woNumber}</td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-slate-900">{wo.title}</p>
                      {wo.asset && (
                        <p className="text-[11px] text-slate-500 font-mono">
                          {wo.asset.assetTag} — {wo.asset.item.name}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-bold ${
                          wo.priority === "CRITICAL"
                            ? "bg-rose-100 text-rose-800"
                            : wo.priority === "HIGH"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-slate-100 text-slate-700"
                        }`}
                      >
                        {wo.priority}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${
                          wo.status === "COMPLETED"
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            : wo.status === "IN_PROGRESS"
                              ? "bg-blue-50 text-blue-700 border border-blue-200"
                              : wo.status === "CANCELLED"
                                ? "bg-slate-100 text-slate-500"
                                : "bg-amber-50 text-amber-700 border border-amber-200"
                        }`}
                      >
                        {wo.status.replace("_", " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{wo.assignee?.name ?? "Unassigned"}</td>
                    <td className="px-4 py-3 text-slate-500">
                      {wo.dueDate ? new Date(wo.dueDate).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {wo.parts.length === 0 ? (
                        <span className="text-slate-400">None</span>
                      ) : (
                        <span className="font-semibold text-slate-800">
                          {wo.parts.reduce((sum, p) => sum + p.quantity, 0)} units
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {wo.status !== "COMPLETED" && wo.status !== "CANCELLED" && (
                          <>
                            <button
                              type="button"
                              onClick={() => setShowPartsModal(wo)}
                              className="rounded border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                              title="Consume spare parts"
                            >
                              Add Parts
                            </button>

                            {wo.status === "OPEN" && (
                              <button
                                type="button"
                                onClick={() => handleStatusChange(wo, "IN_PROGRESS")}
                                className="rounded bg-blue-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-blue-700"
                              >
                                Start
                              </button>
                            )}

                            {wo.status === "IN_PROGRESS" && (
                              <button
                                type="button"
                                onClick={() => handleStatusChange(wo, "COMPLETED")}
                                className="rounded bg-emerald-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-emerald-700"
                              >
                                Complete
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">Create Work Order</h3>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreate} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700">Title</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Replace sample line filter & pump rebuild"
                  value={createForm.title}
                  onChange={(e) => setCreateForm({ ...createForm, title: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-[#0f3d35] focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Priority</label>
                  <select
                    value={createForm.priority}
                    onChange={(e) =>
                      setCreateForm({ ...createForm, priority: e.target.value as WorkOrderPriority })
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-[#0f3d35] focus:outline-none"
                  >
                    <option value="LOW">Low</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="HIGH">High</option>
                    <option value="CRITICAL">Critical</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700">Type</label>
                  <select
                    value={createForm.type}
                    onChange={(e) =>
                      setCreateForm({ ...createForm, type: e.target.value as WorkOrderType })
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-[#0f3d35] focus:outline-none"
                  >
                    <option value="CORRECTIVE">Corrective</option>
                    <option value="PREVENTIVE">Preventive</option>
                    <option value="CALIBRATION">Calibration</option>
                    <option value="INSPECTION">Inspection</option>
                    <option value="INSTALLATION">Installation</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Target Asset</label>
                  <select
                    value={createForm.assetId}
                    onChange={(e) => setCreateForm({ ...createForm, assetId: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-[#0f3d35] focus:outline-none"
                  >
                    <option value="">None / Facility General</option>
                    {assets.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.assetTag} — {a.item.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700">Location</label>
                  <select
                    value={createForm.locationId}
                    onChange={(e) => setCreateForm({ ...createForm, locationId: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-[#0f3d35] focus:outline-none"
                  >
                    <option value="">Unspecified</option>
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Assignee</label>
                  <select
                    value={createForm.assigneeId}
                    onChange={(e) => setCreateForm({ ...createForm, assigneeId: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-[#0f3d35] focus:outline-none"
                  >
                    <option value="">Unassigned</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700">Due Date</label>
                  <input
                    type="date"
                    value={createForm.dueDate}
                    onChange={(e) => setCreateForm({ ...createForm, dueDate: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-[#0f3d35] focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">Description / Instructions</label>
                <textarea
                  rows={3}
                  value={createForm.description}
                  onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                  placeholder="Service procedures, symptom notes, checklist items..."
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-[#0f3d35] focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg bg-[#0f3d35] px-4 py-2 text-xs font-semibold text-white hover:bg-[#155449] disabled:opacity-50"
                >
                  {submitting ? "Saving..." : "Create Work Order"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Parts Modal */}
      {showPartsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Issue Parts to {showPartsModal.woNumber}</h3>
                <p className="text-xs text-slate-500 mt-0.5">{showPartsModal.title}</p>
              </div>
              <button
                type="button"
                onClick={() => setShowPartsModal(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleAddParts} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700">Spare Part / Consumable</label>
                <select
                  required
                  value={partsForm.itemId}
                  onChange={(e) => setPartsForm({ ...partsForm, itemId: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-[#0f3d35] focus:outline-none"
                >
                  <option value="">Select Part...</option>
                  {items.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name} ({i.itemCode})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">Issue From Location (Optional)</label>
                <select
                  value={partsForm.locationId}
                  onChange={(e) => setPartsForm({ ...partsForm, locationId: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-[#0f3d35] focus:outline-none"
                >
                  <option value="">Default / General Storage</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">Quantity Consumed</label>
                <input
                  type="number"
                  min="1"
                  required
                  value={partsForm.quantity}
                  onChange={(e) => setPartsForm({ ...partsForm, quantity: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-[#0f3d35] focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
                <button
                  type="button"
                  onClick={() => setShowPartsModal(null)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg bg-[#0f3d35] px-4 py-2 text-xs font-semibold text-white hover:bg-[#155449] disabled:opacity-50"
                >
                  {submitting ? "Deducting..." : "Record & Deduct Stock"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Complete Modal */}
      {showCompleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Complete {showCompleteModal.woNumber}</h3>
                <p className="text-xs text-slate-500 mt-0.5">{showCompleteModal.title}</p>
              </div>
              <button
                type="button"
                onClick={() => setShowCompleteModal(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCompleteSubmit} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700">Resolution Summary</label>
                <textarea
                  rows={3}
                  required
                  placeholder="Detail the work carried out, tests verified, and sign-off confirmation..."
                  value={resolutionText}
                  onChange={(e) => setResolutionText(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-[#0f3d35] focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
                <button
                  type="button"
                  onClick={() => setShowCompleteModal(null)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {submitting ? "Completing..." : "Confirm Completion"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
