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
    <aside className="flex w-[4.5rem] shrink-0 flex-col bg-[#0f3d35] sm:w-60">
      <div className="flex h-16 items-center justify-center gap-2.5 border-b border-white/10 px-3 sm:justify-start sm:px-6">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#d89b37] text-sm font-bold text-[#0f3d35] shadow-sm">
          E<span className="sr-only">Envirostore</span>
        </span>
        <span className="hidden text-sm font-semibold tracking-wide text-white sm:block">
          Envirostore
        </span>
      </div>

      <nav className="flex-1 space-y-1 px-2 py-5 sm:px-3">
        {items.map((item) => {
          const Icon = item.icon;
          const active =
            item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`group flex items-center justify-center gap-3 rounded-lg border-l-2 px-3 py-2.5 text-sm font-medium transition sm:justify-start ${
                active
                  ? "border-[#d89b37] bg-white/10 text-white"
                  : "border-transparent text-[#b5c9c0] hover:bg-white/6 hover:text-white"
              }`}
              title={item.label}
            >
              <Icon className={`h-4 w-4 shrink-0 ${active ? "text-[#e6b85c]" : "text-[#8faea1] group-hover:text-white"}`} />
              <span className="hidden sm:block">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-white/10 px-2 py-4 text-center text-[10px] uppercase tracking-[0.18em] text-[#77998d] sm:px-6 sm:text-left">
        <span className="hidden sm:inline">Inventory workspace</span>
        <span className="sm:hidden">EZ</span>
      </div>
    </aside>
  );
}
