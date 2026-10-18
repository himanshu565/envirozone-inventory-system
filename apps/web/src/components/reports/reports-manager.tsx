"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, AlertTriangle, CheckCircle, Package, ArrowUpRight } from "lucide-react";
import { API_URL } from "@/lib/api";
import { EmptyState } from "@/components/ui/empty-state";
import { TableSkeleton } from "@/components/ui/skeleton";

type StockReportItem = {
  itemId: number;
  itemCode: string;
  itemName: string;
  categoryName: string;
  currentStock: number;
  minimumStock: number;
  status: "HEALTHY" | "LOW_STOCK" | "OUT_OF_STOCK";
  variance: number;
};

type MovementReportItem = {
  id: number;
  type: string;
  quantity: number;
  transactionDate: string;
  item: { itemCode: string; name: string };
  fromLocation: { name: string } | null;
  toLocation: { name: string } | null;
  createdBy: { name: string };
};

type LocationBalanceItem = {
  itemId: number;
  itemCode: string;
  itemName: string;
  locationId: number;
  locationName: string;
  quantity: number;
  minimumStock: number;
};

export function ReportsManager() {
  const [activeTab, setActiveTab] = useState<"stock" | "movements" | "locations">("stock");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Stock items report state
  const [stockItems, setStockItems] = useState<StockReportItem[]>([]);
  const [filterLowStock, setFilterLowStock] = useState(false);
  const [filterOutOfStock, setFilterOutOfStock] = useState(false);

  // Movements state
  const [movements, setMovements] = useState<MovementReportItem[]>([]);
  const [movementTotals, setMovementTotals] = useState({ inward: 0, outward: 0, adjustment: 0, transfer: 0 });

  // Location balances state
  const [locationBalances, setLocationBalances] = useState<LocationBalanceItem[]>([]);

  const loadStockReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ pageSize: "100" });
      if (filterLowStock) params.set("lowStock", "true");
      if (filterOutOfStock) params.set("outOfStock", "true");

      const res = await fetch(`${API_URL}/api/reports/stock/items?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load stock report");
      const data = await res.json();
      setStockItems(data.data);
    } catch {
      setError("Unable to load stock report");
    } finally {
      setLoading(false);
    }
  }, [filterLowStock, filterOutOfStock]);

  const loadMovementsReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/reports/stock/movements?pageSize=50`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load movements report");
      const data = await res.json();
      setMovements(data.data);
      if (data.totals) setMovementTotals(data.totals);
    } catch {
      setError("Unable to load movements report");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadLocationsReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/reports/stock/locations?pageSize=100`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load locations report");
      const data = await res.json();
      setLocationBalances(data.data);
    } catch {
      setError("Unable to load locations report");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === "stock") loadStockReport();
    else if (activeTab === "movements") loadMovementsReport();
    else if (activeTab === "locations") loadLocationsReport();
  }, [activeTab, loadStockReport, loadMovementsReport, loadLocationsReport]);

  const healthyCount = stockItems.filter((i) => i.status === "HEALTHY").length;
  const lowStockCount = stockItems.filter((i) => i.status === "LOW_STOCK").length;
  const outOfStockCount = stockItems.filter((i) => i.status === "OUT_OF_STOCK").length;

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#dfe7e1] pb-5">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Operational Analytics & Reports</h2>
          <p className="text-xs text-slate-500 mt-1">
            Real-time inventory levels, ledger audit reconciliations, and location stock balances.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={`${API_URL}/api/reports/stock/movements.csv`}
            download="stock-movements.csv"
            className="flex items-center gap-1.5 rounded-lg border border-[#0f3d35] bg-[#0f3d35] px-3 py-2 text-xs font-semibold text-white transition hover:bg-[#155449]"
          >
            <Download className="h-3.5 w-3.5" />
            Export Movements CSV
          </a>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-slate-200 pb-2">
        <button
          type="button"
          onClick={() => setActiveTab("stock")}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
            activeTab === "stock"
              ? "bg-[#0f3d35] text-white"
              : "text-slate-600 hover:bg-slate-100"
          }`}
        >
          Stock Health & Inventory Status
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("movements")}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
            activeTab === "movements"
              ? "bg-[#0f3d35] text-white"
              : "text-slate-600 hover:bg-slate-100"
          }`}
        >
          Movement Activity & Reconciliations
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("locations")}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
            activeTab === "locations"
              ? "bg-[#0f3d35] text-white"
              : "text-slate-600 hover:bg-slate-100"
          }`}
        >
          Location Stock Balances
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-xs text-red-700">
          {error}
        </div>
      )}

      {/* Tab 1: Stock Health */}
      {activeTab === "stock" && (
        <div className="space-y-4">
          {/* KPI Stat Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-500">Healthy Stock Items</span>
                <CheckCircle className="h-4 w-4 text-emerald-600" />
              </div>
              <p className="mt-2 text-2xl font-bold text-slate-900">{healthyCount}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-500">Low Stock Warnings</span>
                <AlertTriangle className="h-4 w-4 text-amber-600" />
              </div>
              <p className="mt-2 text-2xl font-bold text-amber-700">{lowStockCount}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-500">Out of Stock Breaches</span>
                <Package className="h-4 w-4 text-rose-600" />
              </div>
              <p className="mt-2 text-2xl font-bold text-rose-700">{outOfStockCount}</p>
            </div>
          </div>

          {/* Filters */}
          <div className="flex items-center gap-3 py-1">
            <label className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={filterLowStock}
                onChange={(e) => {
                  setFilterLowStock(e.target.checked);
                  if (e.target.checked) setFilterOutOfStock(false);
                }}
                className="rounded border-slate-300 text-[#0f3d35] focus:ring-[#0f3d35]"
              />
              Show Only Low Stock
            </label>
            <label className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={filterOutOfStock}
                onChange={(e) => {
                  setFilterOutOfStock(e.target.checked);
                  if (e.target.checked) setFilterLowStock(false);
                }}
                className="rounded border-slate-300 text-[#0f3d35] focus:ring-[#0f3d35]"
              />
              Show Only Out of Stock
            </label>
          </div>

          {/* Table */}
          {loading ? (
            <TableSkeleton cols={6} rows={6} />
          ) : stockItems.length === 0 ? (
            <EmptyState icon={Package} title="No items match filter" description="No inventory items match the current stock filter." />
          ) : (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-100 bg-slate-50 text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
                    <tr>
                      <th className="px-4 py-3">Item Code</th>
                      <th className="px-4 py-3">Item Name</th>
                      <th className="px-4 py-3">Category</th>
                      <th className="px-4 py-3 text-right">Current Stock</th>
                      <th className="px-4 py-3 text-right">Min Stock</th>
                      <th className="px-4 py-3 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {stockItems.map((item) => (
                      <tr key={item.itemId} className="hover:bg-slate-50/70 transition">
                        <td className="px-4 py-3 font-mono font-medium text-slate-700">{item.itemCode}</td>
                        <td className="px-4 py-3 font-semibold text-slate-900">{item.itemName}</td>
                        <td className="px-4 py-3 text-slate-500">{item.categoryName}</td>
                        <td className="px-4 py-3 text-right font-bold text-slate-900">{item.currentStock}</td>
                        <td className="px-4 py-3 text-right text-slate-500">{item.minimumStock}</td>
                        <td className="px-4 py-3 text-center">
                          <span
                            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${
                              item.status === "HEALTHY"
                                ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                : item.status === "LOW_STOCK"
                                  ? "bg-amber-50 text-amber-700 border border-amber-200"
                                  : "bg-rose-50 text-rose-700 border border-rose-200"
                            }`}
                          >
                            {item.status.replace("_", " ")}
                          </span>
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

      {/* Tab 2: Movements & Reconciliations */}
      {activeTab === "movements" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
              <span className="text-[11px] font-medium text-slate-500">Total Inward Units</span>
              <p className="mt-1 text-xl font-bold text-emerald-700">+{movementTotals.inward}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
              <span className="text-[11px] font-medium text-slate-500">Total Outward Units</span>
              <p className="mt-1 text-xl font-bold text-rose-700">-{movementTotals.outward}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
              <span className="text-[11px] font-medium text-slate-500">Net Adjustments</span>
              <p className="mt-1 text-xl font-bold text-slate-800">{movementTotals.adjustment >= 0 ? `+${movementTotals.adjustment}` : movementTotals.adjustment}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
              <span className="text-[11px] font-medium text-slate-500">Transfers Processed</span>
              <p className="mt-1 text-xl font-bold text-blue-700">{movementTotals.transfer}</p>
            </div>
          </div>

          {loading ? (
            <TableSkeleton cols={6} rows={6} />
          ) : movements.length === 0 ? (
            <EmptyState icon={ArrowUpRight} title="No movements found" description="No movements recorded." />
          ) : (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-100 bg-slate-50 text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
                    <tr>
                      <th className="px-4 py-3">Date</th>
                      <th className="px-4 py-3">Type</th>
                      <th className="px-4 py-3">Item</th>
                      <th className="px-4 py-3 text-right">Quantity</th>
                      <th className="px-4 py-3">From Location</th>
                      <th className="px-4 py-3">To Location</th>
                      <th className="px-4 py-3">Recorded By</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {movements.map((m) => (
                      <tr key={m.id} className="hover:bg-slate-50/70 transition">
                        <td className="px-4 py-3 text-slate-500">{new Date(m.transactionDate).toLocaleDateString()}</td>
                        <td className="px-4 py-3 font-semibold">
                          <span
                            className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-bold ${
                              m.type === "INWARD"
                                ? "bg-emerald-100 text-emerald-800"
                                : m.type === "OUTWARD"
                                  ? "bg-rose-100 text-rose-800"
                                  : m.type === "TRANSFER"
                                    ? "bg-blue-100 text-blue-800"
                                    : "bg-purple-100 text-purple-800"
                            }`}
                          >
                            {m.type}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-800">
                          {m.item.name} <span className="text-slate-400 font-mono">({m.item.itemCode})</span>
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-slate-900">{m.quantity}</td>
                        <td className="px-4 py-3 text-slate-500">{m.fromLocation?.name ?? "—"}</td>
                        <td className="px-4 py-3 text-slate-500">{m.toLocation?.name ?? "—"}</td>
                        <td className="px-4 py-3 text-slate-500">{m.createdBy.name}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Locations */}
      {activeTab === "locations" && (
        <div className="space-y-4">
          {loading ? (
            <TableSkeleton cols={5} rows={6} />
          ) : locationBalances.length === 0 ? (
            <EmptyState icon={Package} title="No location balances" description="No balances recorded per location." />
          ) : (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-100 bg-slate-50 text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
                    <tr>
                      <th className="px-4 py-3">Location</th>
                      <th className="px-4 py-3">Item Code</th>
                      <th className="px-4 py-3">Item Name</th>
                      <th className="px-4 py-3 text-right">Location Stock</th>
                      <th className="px-4 py-3 text-right">Global Min Stock</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {locationBalances.map((loc, idx) => (
                      <tr key={`${loc.locationId}-${loc.itemId}-${idx}`} className="hover:bg-slate-50/70 transition">
                        <td className="px-4 py-3 font-semibold text-[#0f3d35]">{loc.locationName}</td>
                        <td className="px-4 py-3 font-mono font-medium text-slate-700">{loc.itemCode}</td>
                        <td className="px-4 py-3 font-medium text-slate-900">{loc.itemName}</td>
                        <td className="px-4 py-3 text-right font-bold text-slate-900">{loc.quantity}</td>
                        <td className="px-4 py-3 text-right text-slate-500">{loc.minimumStock}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
