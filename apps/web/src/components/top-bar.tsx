"use client";

import { useRouter, usePathname } from "next/navigation";
import { useState } from "react";
import { LogOut } from "lucide-react";
import { API_URL } from "@/lib/api";
import type { Role } from "@envirozone/auth";

const TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/inventory": "Inventory",
  "/stock": "Stock",
  "/purchase-orders": "Purchase Orders",
  "/users": "Users",
  "/audit-log": "Audit Log",
  "/settings": "Settings",
};

export function TopBar({ email, role }: { email: string; role: Role }) {
  const router = useRouter();
  const pathname = usePathname();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const title =
    TITLES[pathname] ??
    Object.entries(TITLES).find(([path]) => path !== "/" && pathname.startsWith(path))
      ?.[1] ??
    "Envirostore";

  async function handleLogout() {
    setIsLoggingOut(true);
    await fetch(`${API_URL}/api/auth/logout`, {
      method: "POST",
      credentials: "include",
    });
    router.push("/login");
    router.refresh();
  }

  const initials = email.slice(0, 2).toUpperCase();

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-8">
      <h1 className="text-lg font-semibold text-slate-900">
        {title}
      </h1>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 rounded-full border border-slate-200 py-1 pl-1 pr-3">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-linear-to-br from-emerald-400 to-blue-500 text-xs font-semibold text-white">
            {initials}
          </span>
          <div className="leading-tight">
            <p className="text-xs font-medium text-slate-900">
              {email}
            </p>
            <p className="text-[11px] text-slate-500">{role}</p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleLogout}
          disabled={isLoggingOut}
          title="Sign out"
          aria-label="Sign out"
          className="rounded-md border border-slate-300 p-2 text-slate-600 transition hover:bg-slate-100 disabled:opacity-50"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
