"use client";

import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { LogOut, Bell, RefreshCw } from "lucide-react";
import { API_URL } from "@/lib/api";
import type { Role } from "@envirozone/auth";

const TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/inventory": "Inventory",
  "/stock": "Stock",
  "/assets": "Assets",
  "/work-orders": "Work Orders",
  "/calibrations": "Calibrations",
  "/reports": "Reports",
  "/knowledge": "Manuals & AI Assistant",
  "/purchase-orders": "Purchase Orders",
  "/users": "Users",
  "/audit-log": "Audit Log",
  "/settings": "Settings",
};

type NotificationItem = {
  id: number;
  type: string;
  title: string;
  message: string;
  link: string | null;
  read: boolean;
  createdAt: string;
};

export function TopBar({ email, role }: { email: string; role: Role }) {
  const router = useRouter();
  const pathname = usePathname();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showNotifications, setShowNotifications] = useState(false);
  const [isScanning, setIsScanning] = useState(false);

  async function loadNotifications() {
    try {
      const res = await fetch(`${API_URL}/api/notifications`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.notifications || []);
        setUnreadCount(data.unreadCount || 0);
      }
    } catch {
      // Ignore background notification load errors
    }
  }

  useEffect(() => {
    loadNotifications();
  }, []);

  async function markAsRead(id: number, link: string | null) {
    try {
      await fetch(`${API_URL}/api/notifications/${id}/read`, {
        method: "PATCH",
        credentials: "include",
      });
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
      if (link) {
        setShowNotifications(false);
        router.push(link);
      }
    } catch {
      // ignore
    }
  }

  async function scanAlerts() {
    setIsScanning(true);
    try {
      await fetch(`${API_URL}/api/notifications/scan`, {
        method: "POST",
        credentials: "include",
      });
      await loadNotifications();
    } finally {
      setIsScanning(false);
    }
  }

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
        {/* Notification Bell */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowNotifications(!showNotifications)}
            className="relative rounded-lg border border-[#dfe7e1] p-2 text-slate-600 transition hover:border-[#c6d4cb] hover:bg-[#f2f6f3]"
            title="Notifications"
            aria-label="Notifications"
          >
            <Bell className="h-4 w-4" />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-600 px-1 text-[10px] font-bold text-white shadow-sm">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </button>

          {showNotifications && (
            <div className="absolute right-0 mt-2 w-80 sm:w-96 rounded-xl border border-slate-200 bg-white p-3 shadow-xl z-50">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-700">
                  Alerts & Notifications
                </span>
                <button
                  type="button"
                  onClick={scanAlerts}
                  disabled={isScanning}
                  className="flex items-center gap-1 text-[11px] font-medium text-[#0f3d35] hover:underline disabled:opacity-50"
                  title="Check conditions now"
                >
                  <RefreshCw className={`h-3 w-3 ${isScanning ? "animate-spin" : ""}`} />
                  Scan
                </button>
              </div>

              <div className="mt-2 max-h-72 overflow-y-auto divide-y divide-slate-100">
                {notifications.length === 0 ? (
                  <p className="py-6 text-center text-xs text-slate-400">No notifications yet.</p>
                ) : (
                  notifications.map((n) => (
                    <div
                      key={n.id}
                      onClick={() => markAsRead(n.id, n.link)}
                      className={`cursor-pointer p-2.5 transition hover:bg-slate-50 rounded-lg text-left ${
                        !n.read ? "bg-amber-50/50" : ""
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className={`text-xs ${!n.read ? "font-semibold text-slate-900" : "font-medium text-slate-700"}`}>
                          {n.title}
                        </p>
                        {!n.read && (
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500 mt-1" />
                        )}
                      </div>
                      <p className="mt-1 text-[11px] text-slate-500 leading-snug">{n.message}</p>
                      <p className="mt-1 text-[9px] text-slate-400">
                        {new Date(n.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

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
