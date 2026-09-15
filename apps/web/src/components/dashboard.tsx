"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Package,
  Tags,
  Users as UsersIcon,
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
} from "lucide-react";
import { API_URL } from "@/lib/api";
import type { Role } from "@envirozone/auth";
import { TableSkeleton } from "@/components/ui/skeleton";

type Category = { id: number; name: string };

type DashboardItem = {
  id: number;
  itemCode: string;
  name: string;
  createdAt: string;
  minimumStock: number;
  currentStock: number;
  category: { id: number; name: string };
};

type Stats = {
  totalItems: number | null;
  totalCategories: number | null;
  totalUsers: number | null;
  lowStockCount: number | null;
};

export function Dashboard({ role }: { role: Role }) {
  const [stats, setStats] = useState<Stats>({
    totalItems: null,
    totalCategories: null,
    totalUsers: null,
    lowStockCount: null,
  });
  const [recentItems, setRecentItems] = useState<DashboardItem[]>([]);
  const [lowStockItems, setLowStockItems] = useState<DashboardItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const requests: [Promise<Response>, Promise<Response>, Promise<Response> | null] = [
          fetch(`${API_URL}/api/items?pageSize=100&sortBy=createdAt&sortDir=desc`, {
            credentials: "include",
          }),
          fetch(`${API_URL}/api/categories`, { credentials: "include" }),
          role === "ADMIN"
            ? fetch(`${API_URL}/api/users`, { credentials: "include" })
            : null,
        ];

        const [itemsRes, categoriesRes, usersRes] = await Promise.all(requests);

        if (!itemsRes.ok || !categoriesRes.ok || (usersRes && !usersRes.ok)) {
          throw new Error("Failed to load dashboard data");
        }

        const itemsBody: { data: DashboardItem[]; pagination: { total: number } } =
          await itemsRes.json();
        const categories: Category[] = await categoriesRes.json();
        const users: unknown[] | null = usersRes ? await usersRes.json() : null;

        if (cancelled) return;

        const belowMinimum = itemsBody.data
          .filter((item) => item.currentStock < item.minimumStock)
          .sort(
            (a, b) =>
              a.currentStock - a.minimumStock - (b.currentStock - b.minimumStock)
          );

        setRecentItems(itemsBody.data.slice(0, 5));
        setLowStockItems(belowMinimum.slice(0, 5));
        setStats({
          totalItems: itemsBody.pagination.total,
          totalCategories: categories.length,
          totalUsers: users ? users.length : null,
          lowStockCount: belowMinimum.length,
        });
      } catch {
        if (!cancelled) setError("Unable to load dashboard data");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [role]);

  const canManage = role === "ADMIN" || role === "STORE_MANAGER";

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <p className="text-sm text-red-600">{error}</p>
      )}

      <div
        className={`grid gap-4 ${
          role === "ADMIN" ? "sm:grid-cols-4" : "sm:grid-cols-3"
        }`}
      >
        <StatCard
          label="Total items"
          value={stats.totalItems}
          isLoading={isLoading}
          icon={Package}
          accent="blue"
        />
        <StatCard
          label="Categories"
          value={stats.totalCategories}
          isLoading={isLoading}
          icon={Tags}
          accent="emerald"
        />
        <StatCard
          label="Low stock"
          value={stats.lowStockCount}
          isLoading={isLoading}
          icon={AlertTriangle}
          accent="amber"
          emphasizeWhenPositive
        />
        {role === "ADMIN" && (
          <StatCard
            label="Team members"
            value={stats.totalUsers}
            isLoading={isLoading}
            icon={UsersIcon}
            accent="sky"
          />
        )}
      </div>

      <div
        className={`grid gap-4 ${
          role === "ADMIN" ? "sm:grid-cols-2" : "sm:grid-cols-1"
        }`}
      >
        <ActionTile
          href="/inventory"
          icon={Package}
          title={canManage ? "Manage inventory" : "View inventory"}
          description={
            canManage
              ? "Add items, edit stock details, manage categories"
              : "Browse items, categories, and stock levels"
          }
          accent="blue"
        />
        {role === "ADMIN" && (
          <ActionTile
            href="/users"
            icon={UsersIcon}
            title="Manage users"
            description="Create accounts and assign roles"
            accent="emerald"
          />
        )}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 className="text-sm font-semibold text-slate-900">Low stock alerts</h2>
          <Link
            href="/inventory"
            className="flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-500"
          >
            View inventory
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        <div className="px-6 py-4">
          {isLoading && <TableSkeleton rows={3} cols={4} />}

          {!isLoading && !error && lowStockItems.length === 0 && (
            <p className="text-sm text-slate-500">
              Every item is at or above its minimum stock level.
            </p>
          )}

          {!isLoading && lowStockItems.length > 0 && (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-slate-400">
                  <th className="pb-3 font-medium">Item</th>
                  <th className="pb-3 font-medium">Category</th>
                  <th className="pb-3 font-medium">Current stock</th>
                  <th className="pb-3 font-medium">Minimum</th>
                </tr>
              </thead>
              <tbody>
                {lowStockItems.map((item) => (
                  <tr key={item.id} className="border-t border-slate-100">
                    <td className="py-3 font-medium text-slate-900">
                      {item.itemCode} — {item.name}
                    </td>
                    <td className="py-3">
                      <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                        {item.category.name}
                      </span>
                    </td>
                    <td className="py-3 font-semibold tabular-nums text-red-600">
                      {item.currentStock}
                    </td>
                    <td className="py-3 text-slate-500">{item.minimumStock}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 className="text-sm font-semibold text-slate-900">
            Recently added items
          </h2>
          <Link
            href="/inventory"
            className="flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-500"
          >
            View all
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        <div className="px-6 py-4">
          {isLoading && <TableSkeleton rows={3} cols={5} />}

          {!isLoading && recentItems.length === 0 && !error && (
            <p className="text-sm text-slate-500">
              No items yet.{" "}
              {canManage ? (
                <Link href="/inventory" className="text-blue-600 underline">
                  Add your first item
                </Link>
              ) : (
                "Check back once inventory has been added."
              )}
            </p>
          )}

          {!isLoading && recentItems.length > 0 && (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-slate-400">
                  <th className="pb-3 font-medium">Code</th>
                  <th className="pb-3 font-medium">Name</th>
                  <th className="pb-3 font-medium">Category</th>
                  <th className="pb-3 font-medium">Stock</th>
                  <th className="pb-3 font-medium">Added</th>
                </tr>
              </thead>
              <tbody>
                {recentItems.map((item) => (
                  <tr
                    key={item.id}
                    className="border-t border-slate-100"
                  >
                    <td className="py-3 font-mono text-xs text-slate-500">
                      {item.itemCode}
                    </td>
                    <td className="py-3 font-medium text-slate-900">
                      {item.name}
                    </td>
                    <td className="py-3">
                      <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                        {item.category.name}
                      </span>
                    </td>
                    <td
                      className={`py-3 font-semibold tabular-nums ${
                        item.currentStock < item.minimumStock
                          ? "text-red-600"
                          : "text-slate-900"
                      }`}
                    >
                      {item.currentStock}
                    </td>
                    <td className="py-3 text-slate-500">
                      {new Date(item.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

const ACCENTS = {
  blue: "bg-blue-50 text-blue-600",
  emerald: "bg-emerald-50 text-emerald-600",
  sky: "bg-sky-50 text-sky-600",
  amber: "bg-amber-50 text-amber-600",
} as const;

function StatCard({
  label,
  value,
  isLoading,
  icon: Icon,
  accent,
  emphasizeWhenPositive,
}: {
  label: string;
  value: number | null;
  isLoading: boolean;
  icon: typeof Package;
  accent: keyof typeof ACCENTS;
  emphasizeWhenPositive?: boolean;
}) {
  const emphasize = emphasizeWhenPositive && !isLoading && (value ?? 0) > 0;

  return (
    <div className="flex items-start justify-between rounded-lg border border-slate-200 bg-white p-5">
      <div>
        <p className="text-sm font-medium text-slate-500">
          {label}
        </p>
        <p
          className={`mt-2 text-3xl font-semibold tabular-nums ${
            emphasize ? "text-red-600" : "text-slate-900"
          }`}
        >
          {isLoading || value === null ? "—" : value}
        </p>
      </div>
      <span className={`flex h-10 w-10 items-center justify-center rounded-lg ${ACCENTS[accent]}`}>
        <Icon className="h-5 w-5" />
      </span>
    </div>
  );
}

const ACTION_TILE_HOVER = {
  blue: "hover:border-blue-300",
  emerald: "hover:border-emerald-300",
} as const;

const ACTION_TILE_ARROW = {
  blue: "group-hover:text-blue-500",
  emerald: "group-hover:text-emerald-500",
} as const;

function ActionTile({
  href,
  icon: Icon,
  title,
  description,
  accent,
}: {
  href: string;
  icon: typeof Package;
  title: string;
  description: string;
  accent: "blue" | "emerald";
}) {
  return (
    <Link
      href={href}
      className={`group flex items-center gap-4 rounded-lg border border-slate-200 bg-white p-5 transition hover:shadow-sm ${ACTION_TILE_HOVER[accent]}`}
    >
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${ACCENTS[accent]}`}>
        <Icon className="h-5 w-5" />
      </span>
      <div className="flex-1">
        <p className="text-sm font-semibold text-slate-900">
          {title}
        </p>
        <p className="text-sm text-slate-500">{description}</p>
      </div>
      <ArrowUpRight className={`h-4 w-4 shrink-0 text-slate-400 transition ${ACTION_TILE_ARROW[accent]}`} />
    </Link>
  );
}
