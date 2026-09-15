"use client";

import { Fragment, useEffect, useState } from "react";
import { History, ChevronDown, ChevronRight } from "lucide-react";
import { API_URL } from "@/lib/api";
import { SortableHeader } from "@/components/ui/sortable-header";
import { TableSkeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";

type AuditLog = {
  id: number;
  action: string;
  entityType: string;
  entityId: number | null;
  before: unknown;
  after: unknown;
  createdAt: string;
  actor: { id: number; name: string; email: string } | null;
};

type LogsResponse = {
  data: AuditLog[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  entityTypes: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function AuditDiff({ before, after }: { before: unknown; after: unknown }) {
  const beforeObj = isRecord(before) ? before : null;
  const afterObj = isRecord(after) ? after : null;

  if (!beforeObj && !afterObj) {
    return <p className="text-xs text-slate-400">No field snapshot recorded.</p>;
  }

  if (beforeObj && afterObj) {
    const keys = Array.from(new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)]));
    const changed = keys.filter(
      (k) => JSON.stringify(beforeObj[k]) !== JSON.stringify(afterObj[k])
    );

    if (changed.length === 0) {
      return <p className="text-xs text-slate-400">No field changes recorded.</p>;
    }

    return (
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="text-slate-400">
            <th className="pb-1 pr-4 font-medium">Field</th>
            <th className="pb-1 pr-4 font-medium">Before</th>
            <th className="pb-1 font-medium">After</th>
          </tr>
        </thead>
        <tbody>
          {changed.map((key) => (
            <tr key={key} className="align-top">
              <td className="py-0.5 pr-4 font-mono text-slate-500">{key}</td>
              <td className="py-0.5 pr-4 text-red-600">{formatValue(beforeObj[key])}</td>
              <td className="py-0.5 text-emerald-700">{formatValue(afterObj[key])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  const only = afterObj ?? beforeObj!;
  const label = afterObj ? "Created with" : "Values at deletion";

  return (
    <div className="text-xs">
      <p className="mb-1 text-slate-400">{label}</p>
      <ul className="space-y-0.5">
        {Object.entries(only).map(([key, value]) => (
          <li key={key}>
            <span className="font-mono text-slate-500">{key}:</span>{" "}
            <span className="text-slate-700">{formatValue(value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ActionBadge({ action }: { action: string }) {
  const style = action.endsWith(".delete")
    ? "bg-red-50 text-red-700"
    : action.endsWith(".create")
      ? "bg-emerald-50 text-emerald-700"
      : "bg-blue-50 text-blue-700";

  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${style}`}>{action}</span>
  );
}

export function AuditLogViewer() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [entityTypes, setEntityTypes] = useState<string[]>([]);
  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 1,
  });
  const [entityFilter, setEntityFilter] = useState("");
  const [sortBy, setSortBy] = useState("createdAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load(page = pagination.page) {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pagination.pageSize),
        sortBy,
        sortDir,
      });
      if (entityFilter) params.set("entityType", entityFilter);

      const response = await fetch(`${API_URL}/api/audit-logs?${params}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to load audit log");
      const body: LogsResponse = await response.json();
      setLogs(body.data);
      setPagination(body.pagination);
      setEntityTypes(body.entityTypes);
    } catch {
      setError("Unable to load audit log");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityFilter, sortBy, sortDir]);

  function handleSort(field: string) {
    if (field === sortBy) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(field);
      setSortDir("desc");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-lg border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 px-6 py-4">
          <h2 className="text-sm font-semibold text-slate-900">Audit log</h2>
          <select
            value={entityFilter}
            onChange={(e) => setEntityFilter(e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
          >
            <option value="">All entities</option>
            {entityTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </div>

        <div className="px-6 py-4">
          {isLoading && <TableSkeleton rows={8} cols={5} />}
          {!isLoading && error && <p className="text-sm text-red-600">{error}</p>}

          {!isLoading && !error && logs.length === 0 && (
            <EmptyState
              icon={History}
              title="No audit entries found"
              description={
                entityFilter
                  ? "No recorded changes match this filter."
                  : "Changes across the app will show up here as they happen."
              }
            />
          )}

          {!isLoading && !error && logs.length > 0 && (
            <>
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wide text-slate-400">
                    <th className="w-8 pb-3" />
                    <SortableHeader
                      label="Date"
                      field="createdAt"
                      sortBy={sortBy}
                      sortDir={sortDir}
                      onSort={handleSort}
                    />
                    <SortableHeader
                      label="Action"
                      field="action"
                      sortBy={sortBy}
                      sortDir={sortDir}
                      onSort={handleSort}
                    />
                    <SortableHeader
                      label="Entity"
                      field="entityType"
                      sortBy={sortBy}
                      sortDir={sortDir}
                      onSort={handleSort}
                    />
                    <th className="pb-3 font-medium">Actor</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => {
                    const expanded = expandedId === log.id;
                    return (
                      <Fragment key={log.id}>
                        <tr
                          className="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
                          onClick={() => setExpandedId(expanded ? null : log.id)}
                        >
                          <td className="py-3 text-slate-400">
                            {expanded ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </td>
                          <td className="py-3 text-slate-500">
                            {new Date(log.createdAt).toLocaleString()}
                          </td>
                          <td className="py-3">
                            <ActionBadge action={log.action} />
                          </td>
                          <td className="py-3 text-slate-700">
                            {log.entityType}
                            {log.entityId !== null && (
                              <span className="text-slate-400"> #{log.entityId}</span>
                            )}
                          </td>
                          <td className="py-3 text-slate-500">
                            {log.actor ? log.actor.name : "System"}
                          </td>
                        </tr>
                        {expanded && (
                          <tr className="border-t border-slate-50 bg-slate-50">
                            <td />
                            <td colSpan={4} className="py-3 pr-4">
                              <AuditDiff before={log.before} after={log.after} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>

              {pagination.totalPages > 1 && (
                <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
                  <span>
                    Page {pagination.page} of {pagination.totalPages} ({pagination.total}{" "}
                    entries)
                  </span>
                  <div className="flex gap-2">
                    <button
                      disabled={pagination.page <= 1}
                      onClick={() => load(pagination.page - 1)}
                      className="rounded-md border border-slate-300 px-3 py-1 disabled:opacity-40"
                    >
                      Previous
                    </button>
                    <button
                      disabled={pagination.page >= pagination.totalPages}
                      onClick={() => load(pagination.page + 1)}
                      className="rounded-md border border-slate-300 px-3 py-1 disabled:opacity-40"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
