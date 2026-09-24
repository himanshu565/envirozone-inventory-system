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
      <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#a56b35]">
            Inventory pulse
          </p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight text-[#26352d]">
            Good morning, keep things moving.
          </h2>
        </div>
        <p className="text-sm text-[#778177]">A quick view of today&apos;s operations</p>
      </div>

      {error && (
        <p className="rounded-lg border border-[#edc7bd] bg-[#fff5f1] px-4 py-3 text-sm text-[#a9442f]">{error}</p>
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

      <div className="rounded-xl border border-[#eadfce] bg-[#fffdf8] shadow-[0_5px_18px_rgba(82,67,45,0.04)]">
        <div className="flex items-center justify-between border-b border-[#eee5d8] px-6 py-4">
          <h2 className="text-sm font-semibold text-[#26352d]">Low stock alerts</h2>
          <Link
            href="/inventory"
            className="flex items-center gap-1 text-sm font-medium text-[#a56b35] hover:text-[#7e4e25]"
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
                    <td className="py-3 font-medium text-[#26352d]">
                      {item.itemCode} — {item.name}
                    </td>
                    <td className="py-3">
                      <span className="rounded-full bg-[#e7eee9] px-2.5 py-0.5 text-xs font-medium text-[#316b58]">
                        {item.category.name}
                      </span>
                    </td>
                    <td className="py-3 font-semibold tabular-nums text-[#b94b32]">
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

      <div className="rounded-xl border border-[#eadfce] bg-[#fffdf8] shadow-[0_5px_18px_rgba(82,67,45,0.04)]">
        <div className="flex items-center justify-between border-b border-[#eee5d8] px-6 py-4">
          <h2 className="text-sm font-semibold text-[#26352d]">
            Recently added items
          </h2>
          <Link
            href="/inventory"
            className="flex items-center gap-1 text-sm font-medium text-[#a56b35] hover:text-[#7e4e25]"
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
                    <td className="py-3 font-medium text-[#26352d]">
                      {item.name}
                    </td>
                    <td className="py-3">
                      <span className="rounded-full bg-[#e7eee9] px-2.5 py-0.5 text-xs font-medium text-[#316b58]">
                        {item.category.name}
                      </span>
                    </td>
                    <td
                      className={`py-3 font-semibold tabular-nums ${
                        item.currentStock < item.minimumStock
                          ? "text-[#b94b32]"
                          : "text-[#26352d]"
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
  blue: "bg-[#e7eee9] text-[#316b58]",
  emerald: "bg-[#f6e7c8] text-[#a56b35]",
  sky: "bg-[#f1ddd5] text-[#b0523d]",
  amber: "bg-[#f4e4a9] text-[#8b6b18]",
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
    <div className="group relative flex min-h-32 items-start justify-between overflow-hidden rounded-xl border border-[#eadfce] bg-[#fffdf8] p-5 shadow-[0_5px_18px_rgba(82,67,45,0.04)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_10px_24px_rgba(82,67,45,0.09)]">
      <span className="absolute -right-5 -top-6 h-20 w-20 rounded-full border-10 border-current opacity-10" />
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#7b8177]">
          {label}
        </p>
        <p
          className={`mt-3 text-3xl font-semibold tabular-nums tracking-tight ${
            emphasize ? "text-[#b94b32]" : "text-[#26352d]"
          }`}
        >
          {isLoading || value === null ? "—" : value}
        </p>
      </div>
      <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${ACCENTS[accent]}`}>
        <Icon className="h-5 w-5" />
      </span>
    </div>
  );
}

const ACTION_TILE_HOVER = {
  blue: "hover:border-[#9bbbab]",
  emerald: "hover:border-[#dcb477]",
} as const;

const ACTION_TILE_ARROW = {
  blue: "group-hover:text-[#316b58]",
  emerald: "group-hover:text-[#a56b35]",
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
      className={`group flex items-center gap-4 rounded-xl border border-[#eadfce] bg-[#fffdf8] p-5 shadow-[0_5px_18px_rgba(82,67,45,0.035)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_10px_24px_rgba(82,67,45,0.08)] ${ACTION_TILE_HOVER[accent]}`}
    >
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${ACCENTS[accent]}`}>
        <Icon className="h-5 w-5" />
      </span>
      <div className="flex-1">
        <p className="text-sm font-semibold text-[#26352d]">
          {title}
        </p>
        <p className="text-sm text-[#778177]">{description}</p>
      </div>
      <ArrowUpRight className={`h-4 w-4 shrink-0 text-slate-400 transition ${ACTION_TILE_ARROW[accent]}`} />
    </Link>
  );
}
