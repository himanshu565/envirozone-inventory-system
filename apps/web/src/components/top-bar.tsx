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
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-[#dfe7e1] bg-white/90 px-4 backdrop-blur sm:px-6 lg:px-8">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#9a6d22]">
          Operations
        </p>
        <h1 className="text-base font-semibold text-[#17221d] sm:text-lg">{title}</h1>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex max-w-52 items-center gap-2 rounded-full border border-[#dfe7e1] bg-[#f8faf8] py-1 pl-1 pr-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#0f3d35] text-xs font-semibold text-[#f4d895]">
            {initials}
          </span>
          <div className="min-w-0 leading-tight">
            <p className="truncate text-xs font-medium text-slate-900">
              {email}
            </p>
            <p className="text-[10px] uppercase tracking-wide text-slate-500">{role.replace("_", " ")}</p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleLogout}
          disabled={isLoggingOut}
          title="Sign out"
          aria-label="Sign out"
          className="rounded-lg border border-[#dfe7e1] p-2 text-slate-600 transition hover:border-[#c6d4cb] hover:bg-[#f2f6f3] disabled:opacity-50"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
