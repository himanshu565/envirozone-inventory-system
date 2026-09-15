"use client";

import { useEffect, useState } from "react";
import { Tags } from "lucide-react";
import { API_URL } from "@/lib/api";
import { TableSkeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";

type CategorySummary = {
  categoryId: number;
  categoryName: string;
  itemCount: number;
  totalStock: number;
};

export function CategoryStockSummary() {
  const [summary, setSummary] = useState<CategorySummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const response = await fetch(`${API_URL}/api/stock/summary`, {
          credentials: "include",
        });
        if (!response.ok) throw new Error("Failed to load stock summary");
        const data: CategorySummary[] = await response.json();
        if (!cancelled) setSummary(data);
      } catch {
        if (!cancelled) setError("Unable to load stock summary");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const totalStock = summary.reduce((sum, row) => sum + row.totalStock, 0);

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
        <h2 className="text-sm font-semibold text-slate-900">Stock by category</h2>
        {!isLoading && !error && (
          <span className="text-sm text-slate-500">
            {totalStock} units total
          </span>
        )}
      </div>

      <div className="px-6 py-4">
        {isLoading && <TableSkeleton rows={3} cols={3} />}
        {error && <p className="text-sm text-red-600">{error}</p>}

        {!isLoading && !error && summary.length === 0 && (
          <EmptyState
            icon={Tags}
            title="No categories yet"
            description="Add items in Inventory first."
          />
        )}

        {!isLoading && !error && summary.length > 0 && (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-slate-400">
                <th className="pb-3 font-medium">Category</th>
                <th className="pb-3 font-medium">Items</th>
                <th className="pb-3 font-medium">Total stock</th>
              </tr>
            </thead>
            <tbody>
              {summary.map((row) => (
                <tr key={row.categoryId} className="border-t border-slate-100">
                  <td className="py-3">
                    <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                      {row.categoryName}
                    </span>
                  </td>
                  <td className="py-3 text-slate-500">{row.itemCount}</td>
                  <td
                    className={`py-3 font-semibold tabular-nums ${
                      row.totalStock < 0 ? "text-red-600" : "text-slate-900"
                    }`}
                  >
                    {row.totalStock}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
