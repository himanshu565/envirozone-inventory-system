"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Package,
  Warehouse,
  ClipboardList,
  Users as UsersIcon,
  Settings,
  History,
} from "lucide-react";
import type { Role } from "@envirozone/auth";

const NAV_ITEMS: {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  adminOnly?: boolean;
}[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/inventory", label: "Inventory", icon: Package },
  { href: "/stock", label: "Stock", icon: Warehouse },
  { href: "/purchase-orders", label: "Purchase Orders", icon: ClipboardList },
  { href: "/users", label: "Users", icon: UsersIcon, adminOnly: true },
  { href: "/audit-log", label: "Audit Log", icon: History, adminOnly: true },
  { href: "/settings", label: "Settings", icon: Settings, adminOnly: true },
];

export function Sidebar({ role }: { role: Role }) {
  const pathname = usePathname();
  const items = NAV_ITEMS.filter((item) => !item.adminOnly || role === "ADMIN");

  return (
    <aside className="flex w-60 shrink-0 flex-col bg-teal-900">
      <div className="flex h-16 items-center gap-2.5 border-b border-teal-800 px-6">
        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-linear-to-br from-emerald-400 to-blue-500 text-sm font-bold text-white">
          E
        </span>
        <span className="text-sm font-semibold tracking-wide text-white">
          Envirostore
        </span>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-4">
        {items.map((item) => {
          const Icon = item.icon;
          const active =
            item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition ${
                active
                  ? "bg-blue-600 text-white"
                  : "text-teal-200 hover:bg-teal-800 hover:text-white"
              }`}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-teal-800 px-6 py-4 text-xs text-teal-400">
        Envirostore Inventory
      </div>
    </aside>
  );
}
