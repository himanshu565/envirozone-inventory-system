"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  BookOpen,
  MessageSquare,
  Search,
  Upload,
  CheckCircle,
  XCircle,
  Archive,
  Trash2,
  FileText,
  AlertCircle,
  ShieldCheck,
  Send,
  Loader2,
  ChevronRight,
} from "lucide-react";
import { API_URL } from "@/lib/api";
import { useToast } from "@/components/ui/toast-provider";
import { TableSkeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";

type DocumentStatus =
  | "UPLOADED"
  | "REVIEW_REQUIRED"
  | "APPROVED"
  | "REJECTED"
  | "RETIRED"
  | "FAILED";

type DocumentItem = {
  id: number;
  title: string;
  originalFileName: string;
  mimeType: string;
  status: DocumentStatus;
  itemId: number | null;
  item: { id: number; name: string; itemCode: string } | null;
  uploadedBy: { id: number; name: string; email: string };
  approvedBy: { id: number; name: string; email: string } | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  _count: { chunks: number };
};

type DocumentDetail = DocumentItem & {
  sourceText: string;
  chunks: Array<{
    id: number;
    chunkIndex: number;
    text: string;
    pageNumber: number | null;
    sectionTitle: string | null;
    headingPath: string | null;
    tokenCount: number;
  }>;
};

type Citation = {
  documentId: number;
  fileName: string;
  pageNumber: number | null;
  section: string | null;
  chunkId: number;
};

type QueryResponse = {
  status: "SUPPORTED" | "INSUFFICIENT_EVIDENCE" | "UNAVAILABLE";
  answer: string;
  provider?: string;
  citations: Citation[];
};

type EquipmentItem = {
  id: number;
  name: string;
  itemCode: string;
};

export function KnowledgeManager() {
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<"assistant" | "library">("assistant");

  // Assistant State
  const [question, setQuestion] = useState("");
  const [selectedItemId, setSelectedItemId] = useState<string>("");
  const [isQuerying, setIsQuerying] = useState(false);
  const [queryResult, setQueryResult] = useState<QueryResponse | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);

  // Library State
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [items, setItems] = useState<EquipmentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [searchFilter, setSearchFilter] = useState("");

  // Upload Modal State
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadForm, setUploadForm] = useState({
    title: "",
    originalFileName: "",
    mimeType: "text/markdown",
    itemId: "",
    sourceText: "",
  });

  // Document Detail Drawer/Modal
  const [viewingDocId, setViewingDocId] = useState<number | null>(null);
  const [docDetail, setDocDetail] = useState<DocumentDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [docsRes, itemsRes] = await Promise.all([
        fetch(`${API_URL}/api/knowledge/documents`, { credentials: "include" }),
        fetch(`${API_URL}/api/items`, { credentials: "include" }),
      ]);

      if (docsRes.ok) {
        const docsData = await docsRes.json();
        setDocuments(docsData);
      }
      if (itemsRes.ok) {
        const itemsData = await itemsRes.json();
        setItems(itemsData.data || itemsData || []);
      }
    } catch {
      toast.error("Failed to load knowledge documents and equipment");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleQuery(e?: FormEvent) {
    if (e) e.preventDefault();
    const trimmed = question.trim();
    if (!trimmed) return;

    setIsQuerying(true);
    setQueryResult(null);
    setQueryError(null);

    try {
      const res = await fetch(`${API_URL}/api/knowledge/assistant/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          question: trimmed,
          itemId: selectedItemId ? Number(selectedItemId) : undefined,
        }),
      });

      if (!res.ok) {
        if (res.status === 503) {
          setQueryError("Knowledge assistant is currently disabled or unreachable. You can consult the manual library directly below.");
          return;
        }
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Request failed with code ${res.status}`);
      }

      const data: QueryResponse = await res.json();
      setQueryResult(data);
    } catch (err: unknown) {
      setQueryError((err as Error).message || "Failed to query the knowledge assistant");
    } finally {
      setIsQuerying(false);
    }
  }

  async function handleUpload(e: FormEvent) {
    e.preventDefault();
    if (!uploadForm.title || !uploadForm.originalFileName || !uploadForm.sourceText) {
      toast.error("Please fill in title, file name, and document text");
      return;
    }

    setIsUploading(true);
    try {
      const res = await fetch(`${API_URL}/api/knowledge/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          title: uploadForm.title.trim(),
          originalFileName: uploadForm.originalFileName.trim(),
          mimeType: uploadForm.mimeType,
          itemId: uploadForm.itemId ? Number(uploadForm.itemId) : null,
          sourceText: uploadForm.sourceText,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to upload document");
      }

      toast.success("Document uploaded for review");
      setShowUploadModal(false);
      setUploadForm({
        title: "",
        originalFileName: "",
        mimeType: "text/markdown",
        itemId: "",
        sourceText: "",
      });
      loadData();
    } catch (err: unknown) {
      toast.error((err as Error).message);
    } finally {
      setIsUploading(false);
    }
  }

  async function handleStatusAction(docId: number, action: "approve" | "reject" | "retire") {
    try {
      const res = await fetch(`${API_URL}/api/knowledge/documents/${docId}/${action}`, {
        method: "POST",
        credentials: "include",
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed to ${action} document`);
      }

      toast.success(`Document ${action}d successfully`);
      loadData();
      if (viewingDocId === docId) {
        loadDocDetail(docId);
      }
    } catch (err: unknown) {
      toast.error((err as Error).message);
    }
  }

  async function handleDelete(docId: number) {
    if (!confirm("Are you sure you want to permanently delete this document and all its chunks?")) {
      return;
    }

    try {
      const res = await fetch(`${API_URL}/api/knowledge/documents/${docId}`, {
        method: "DELETE",
        credentials: "include",
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to delete document");
      }

      toast.success("Document deleted");
      loadData();
      if (viewingDocId === docId) {
        setViewingDocId(null);
        setDocDetail(null);
      }
    } catch (err: unknown) {
      toast.error((err as Error).message);
    }
  }

  async function loadDocDetail(docId: number) {
    setViewingDocId(docId);
    setLoadingDetail(true);
    try {
      const res = await fetch(`${API_URL}/api/knowledge/documents/${docId}`, {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setDocDetail(data);
      } else {
        toast.error("Failed to load document details");
      }
    } catch {
      toast.error("Failed to load document details");
    } finally {
      setLoadingDetail(false);
    }
  }

  const filteredDocs = documents.filter((doc) => {
    if (statusFilter !== "ALL" && doc.status !== statusFilter) return false;
    if (searchFilter) {
      const q = searchFilter.toLowerCase();
      const matchTitle = doc.title.toLowerCase().includes(q);
      const matchFile = doc.originalFileName.toLowerCase().includes(q);
      const matchItem = doc.item?.name.toLowerCase().includes(q) || doc.item?.itemCode.toLowerCase().includes(q);
      return matchTitle || matchFile || matchItem;
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header and Tab Selector */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Equipment Manuals & Technical Assistant
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Query approved calibration guides, standard operating procedures, and equipment manuals with verifiable citations.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg bg-slate-100 p-1">
            <button
              onClick={() => setActiveTab("assistant")}
              className={`flex items-center gap-2 rounded-md px-3.5 py-1.5 text-xs font-medium transition-all ${
                activeTab === "assistant"
                  ? "bg-white text-[#0f3d35] shadow-sm font-semibold"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <MessageSquare className="h-4 w-4" />
              AI Assistant
            </button>
            <button
              onClick={() => setActiveTab("library")}
              className={`flex items-center gap-2 rounded-md px-3.5 py-1.5 text-xs font-medium transition-all ${
                activeTab === "library"
                  ? "bg-white text-[#0f3d35] shadow-sm font-semibold"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <BookOpen className="h-4 w-4" />
              Manuals Library ({documents.length})
            </button>
          </div>

          <button
            onClick={() => setShowUploadModal(true)}
            className="flex items-center gap-2 rounded-lg bg-[#0f3d35] px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#165046] transition-all"
          >
            <Upload className="h-3.5 w-3.5" />
            Upload Manual
          </button>
        </div>
      </div>

      {/* TAB 1: AI ASSISTANT VIEW */}
      {activeTab === "assistant" && (
        <div className="space-y-6">
          {/* Query Input Card */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <form onSubmit={handleQuery} className="space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="w-full sm:w-72">
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Equipment Model Filter
                  </label>
                  <select
                    value={selectedItemId}
                    onChange={(e) => setSelectedItemId(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-800 focus:border-[#0f3d35] focus:outline-none focus:ring-1 focus:ring-[#0f3d35]"
                  >
                    <option value="">All Equipment Models</option>
                    {items.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} ({item.itemCode})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex-1">
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Question / Procedure Inquiry
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={question}
                      onChange={(e) => setQuestion(e.target.value)}
                      placeholder="e.g., What is the span gas concentration and flow rate for the MultiGas Pro?"
                      className="w-full rounded-lg border border-slate-300 px-4 py-2.5 pr-24 text-xs text-slate-900 placeholder:text-slate-400 focus:border-[#0f3d35] focus:outline-none focus:ring-1 focus:ring-[#0f3d35]"
                    />
                    <button
                      type="submit"
                      disabled={isQuerying || !question.trim()}
                      className="absolute right-1.5 top-1.5 flex items-center gap-1.5 rounded-md bg-[#0f3d35] px-3.5 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-[#165046] disabled:opacity-50 transition-all"
                    >
                      {isQuerying ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Searching...
                        </>
                      ) : (
                        <>
                          <Send className="h-3 w-3" />
                          Ask
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {/* Sample Queries */}
              <div className="flex flex-wrap items-center gap-2 pt-1 text-xs text-slate-500">
                <span className="font-medium text-slate-600">Sample Inquiries:</span>
                {[
                  "MultiGas span gas calibration steps",
                  "What regulator flow rate is required for bump testing?",
                  "Sensor zero point calibration drift tolerance",
                  "What is error code ERR-042 on ambient monitors?",
                ].map((sample) => (
                  <button
                    key={sample}
                    type="button"
                    onClick={() => {
                      setQuestion(sample);
                    }}
                    className="rounded-full bg-slate-100 px-2.5 py-0.5 text-slate-600 hover:bg-slate-200 transition-colors"
                  >
                    {sample}
                  </button>
                ))}
              </div>
            </form>
          </div>

          {/* Results Area */}
          {queryError && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-amber-900 shadow-sm flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <h4 className="text-sm font-semibold">Assistant Notification</h4>
                <p className="mt-1 text-xs leading-relaxed text-amber-800">{queryError}</p>
              </div>
            </div>
          )}

          {isQuerying && (
            <div className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm text-center">
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-[#0f3d35]" />
              <p className="mt-3 text-sm font-medium text-slate-700">
                Retrieving approved documentation & verifying citations...
              </p>
              <p className="mt-1 text-xs text-slate-400">
                Evaluating candidate manual chunks and checking tenant boundaries
              </p>
            </div>
          )}

          {queryResult && (
            <div className="space-y-4">
              <div className="rounded-xl border border-emerald-200 bg-white p-6 shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-5 w-5 text-emerald-600" />
                    <span className="text-sm font-semibold text-slate-900">
                      Grounded Response
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        queryResult.status === "SUPPORTED"
                          ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                          : "bg-amber-50 text-amber-700 border border-amber-200"
                      }`}
                    >
                      {queryResult.status}
                    </span>
                  </div>

                  {queryResult.provider && (
                    <span className="text-xs text-slate-400">
                      Provider: <code className="font-mono">{queryResult.provider}</code>
                    </span>
                  )}
                </div>

                {/* Answer Content */}
                <div className="mt-4 text-xs sm:text-sm text-slate-800 leading-relaxed whitespace-pre-wrap font-sans">
                  {queryResult.answer}
                </div>

                {/* Citations List */}
                {queryResult.citations && queryResult.citations.length > 0 && (
                  <div className="mt-6 border-t border-slate-100 pt-4">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
                      Referenced Approved Documents & Pages ({queryResult.citations.length})
                    </h4>
                    <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                      {queryResult.citations.map((c, i) => (
                        <div
                          key={i}
                          onClick={() => loadDocDetail(c.documentId)}
                          className="cursor-pointer group flex flex-col justify-between rounded-lg border border-slate-200 bg-slate-50 p-3 hover:border-[#0f3d35] hover:bg-emerald-50/30 transition-all"
                        >
                          <div>
                            <div className="flex items-center gap-1.5 text-xs font-semibold text-[#0f3d35] group-hover:underline">
                              <FileText className="h-3.5 w-3.5" />
                              <span className="truncate">{c.fileName}</span>
                            </div>
                            {c.section && (
                              <p className="mt-1 text-[11px] text-slate-600 truncate">
                                Section: {c.section}
                              </p>
                            )}
                          </div>
                          <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
                            <span>{c.pageNumber ? `Page ${c.pageNumber}` : "General Reference"}</span>
                            <span className="text-[10px] text-emerald-700 font-medium group-hover:translate-x-0.5 transition-transform">
                              View Chunk →
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: MANUALS LIBRARY VIEW */}
      {activeTab === "library" && (
        <div className="space-y-4">
          {/* Controls Bar */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-1.5">
              {["ALL", "APPROVED", "REVIEW_REQUIRED", "REJECTED", "RETIRED"].map((status) => (
                <button
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    statusFilter === status
                      ? "bg-[#0f3d35] text-white"
                      : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  {status === "ALL" ? "All Documents" : status.replace("_", " ")}
                </button>
              ))}
            </div>

            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                placeholder="Search manuals..."
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                className="w-full rounded-lg border border-slate-300 py-1.5 pl-9 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-[#0f3d35] focus:outline-none focus:ring-1 focus:ring-[#0f3d35]"
              />
            </div>
          </div>

          {/* Documents Table */}
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            {loading ? (
              <TableSkeleton cols={6} rows={5} />
            ) : filteredDocs.length === 0 ? (
              <EmptyState
                icon={BookOpen}
                title="No knowledge documents found"
                description={
                  searchFilter || statusFilter !== "ALL"
                    ? "Try adjusting your search query or status filter."
                    : "No manuals have been uploaded yet. Upload calibration procedures and manuals to empower the technical assistant."
                }
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-100 bg-slate-50 font-semibold text-slate-700">
                    <tr>
                      <th className="px-4 py-3">Document Title & File</th>
                      <th className="px-4 py-3">Equipment Model</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Chunks</th>
                      <th className="px-4 py-3">Uploaded By</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-600">
                    {filteredDocs.map((doc) => (
                      <tr key={doc.id} className="hover:bg-slate-50/60 transition-colors">
                        <td className="px-4 py-3">
                          <button
                            onClick={() => loadDocDetail(doc.id)}
                            className="font-semibold text-slate-900 hover:text-[#0f3d35] hover:underline text-left"
                          >
                            {doc.title}
                          </button>
                          <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-slate-500 font-mono">
                            <span>{doc.originalFileName}</span>
                            <span>•</span>
                            <span>{doc.mimeType}</span>
                          </div>
                        </td>

                        <td className="px-4 py-3">
                          {doc.item ? (
                            <span className="inline-flex items-center rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700 border border-blue-200">
                              {doc.item.name} ({doc.item.itemCode})
                            </span>
                          ) : (
                            <span className="text-slate-400 text-[11px]">All Equipment</span>
                          )}
                        </td>

                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                              doc.status === "APPROVED"
                                ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                : doc.status === "REVIEW_REQUIRED"
                                ? "bg-amber-50 text-amber-700 border border-amber-200"
                                : doc.status === "REJECTED"
                                ? "bg-red-50 text-red-700 border border-red-200"
                                : "bg-slate-100 text-slate-600 border border-slate-200"
                            }`}
                          >
                            {doc.status}
                          </span>
                        </td>

                        <td className="px-4 py-3 font-mono text-[11px]">
                          {doc._count.chunks} chunks
                        </td>

                        <td className="px-4 py-3">
                          <div className="text-slate-800 font-medium">{doc.uploadedBy.name}</div>
                          <div className="text-[11px] text-slate-400">
                            {new Date(doc.createdAt).toLocaleDateString()}
                          </div>
                        </td>

                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {doc.status === "REVIEW_REQUIRED" && (
                              <>
                                <button
                                  onClick={() => handleStatusAction(doc.id, "approve")}
                                  title="Approve Document for Assistant Index"
                                  className="rounded p-1 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 transition-colors"
                                >
                                  <CheckCircle className="h-4 w-4" />
                                </button>
                                <button
                                  onClick={() => handleStatusAction(doc.id, "reject")}
                                  title="Reject Document"
                                  className="rounded p-1 text-red-700 hover:bg-red-50 hover:text-red-800 transition-colors"
                                >
                                  <XCircle className="h-4 w-4" />
                                </button>
                              </>
                            )}

                            {doc.status === "APPROVED" && (
                              <button
                                onClick={() => handleStatusAction(doc.id, "retire")}
                                title="Retire/Deprecate Document"
                                className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors"
                              >
                                <Archive className="h-4 w-4" />
                              </button>
                            )}

                            <button
                              onClick={() => loadDocDetail(doc.id)}
                              title="Inspect Extracted Chunks"
                              className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors"
                            >
                              <ChevronRight className="h-4 w-4" />
                            </button>

                            <button
                              onClick={() => handleDelete(doc.id)}
                              title="Delete Document"
                              className="rounded p-1 text-red-500 hover:bg-red-50 hover:text-red-700 transition-colors"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* UPLOAD MANUAL MODAL */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">
                Upload Manual or Calibration Document
              </h3>
              <button
                onClick={() => setShowUploadModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleUpload} className="mt-4 space-y-4 text-xs">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Document Title *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g., MultiGas Pro Calibration SOP"
                    value={uploadForm.title}
                    onChange={(e) => setUploadForm({ ...uploadForm, title: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-[#0f3d35] focus:outline-none focus:ring-1 focus:ring-[#0f3d35]"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    File Name *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g., MultiGas_Pro_SOP_v2.md"
                    value={uploadForm.originalFileName}
                    onChange={(e) => setUploadForm({ ...uploadForm, originalFileName: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-[#0f3d35] focus:outline-none focus:ring-1 focus:ring-[#0f3d35]"
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Associated Equipment Model
                  </label>
                  <select
                    value={uploadForm.itemId}
                    onChange={(e) => setUploadForm({ ...uploadForm, itemId: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-[#0f3d35] focus:outline-none focus:ring-1 focus:ring-[#0f3d35]"
                  >
                    <option value="">All Equipment Models</option>
                    {items.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} ({item.itemCode})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Document Format
                  </label>
                  <select
                    value={uploadForm.mimeType}
                    onChange={(e) => setUploadForm({ ...uploadForm, mimeType: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-[#0f3d35] focus:outline-none focus:ring-1 focus:ring-[#0f3d35]"
                  >
                    <option value="text/markdown">Markdown (text/markdown)</option>
                    <option value="text/plain">Plain Text (text/plain)</option>
                    <option value="application/pdf">Extracted PDF Text (application/pdf)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Extracted Document Text *
                </label>
                <p className="text-[11px] text-slate-500 mb-1.5">
                  Paste structured manual text or markdown. Use <code># Headings</code> for sections and <code>[page:1]</code> for page number references.
                </p>
                <textarea
                  required
                  rows={10}
                  placeholder={`# Calibration Procedure\n[page:1]\nEnsure the calibration gas regulator is set to 0.5 L/min...\n\n## Span Gas Setup\n[page:2]\nAttach the calibration cup and supply 20.9% O2...`}
                  value={uploadForm.sourceText}
                  onChange={(e) => setUploadForm({ ...uploadForm, sourceText: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 p-3 font-mono text-[11px] text-slate-900 focus:border-[#0f3d35] focus:outline-none focus:ring-1 focus:ring-[#0f3d35]"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowUploadModal(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isUploading}
                  className="flex items-center gap-1.5 rounded-lg bg-[#0f3d35] px-4 py-2 font-semibold text-white hover:bg-[#165046] disabled:opacity-50"
                >
                  {isUploading ? "Uploading..." : "Save & Generate Chunks"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DOCUMENT DETAIL DRAWER */}
      {viewingDocId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  {docDetail?.title || "Document Details"}
                </h3>
                <p className="text-xs text-slate-500 font-mono">
                  {docDetail?.originalFileName} • Status: {docDetail?.status}
                </p>
              </div>
              <button
                onClick={() => {
                  setViewingDocId(null);
                  setDocDetail(null);
                }}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                ✕
              </button>
            </div>

            {loadingDetail ? (
              <div className="py-12 text-center text-xs text-slate-500">
                <Loader2 className="mx-auto h-6 w-6 animate-spin text-[#0f3d35]" />
                <p className="mt-2">Loading document chunks and metadata...</p>
              </div>
            ) : docDetail ? (
              <div className="mt-4 space-y-4 text-xs">
                {/* Meta summary */}
                <div className="grid gap-3 rounded-lg bg-slate-50 p-3 sm:grid-cols-3">
                  <div>
                    <span className="text-slate-400 text-[11px]">Associated Item:</span>
                    <p className="font-semibold text-slate-800">
                      {docDetail.item ? `${docDetail.item.name} (${docDetail.item.itemCode})` : "All Equipment"}
                    </p>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[11px]">Total Chunks:</span>
                    <p className="font-semibold text-slate-800 font-mono">
                      {docDetail.chunks?.length || 0} chunks
                    </p>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[11px]">Uploaded By:</span>
                    <p className="font-semibold text-slate-800">
                      {docDetail.uploadedBy.name} ({new Date(docDetail.createdAt).toLocaleDateString()})
                    </p>
                  </div>
                </div>

                {/* Chunks breakdown */}
                <div>
                  <h4 className="font-bold text-slate-800 mb-2">
                    Extracted Semantic Chunks ({docDetail.chunks?.length || 0})
                  </h4>
                  <div className="space-y-2.5 max-h-96 overflow-y-auto pr-1">
                    {docDetail.chunks?.map((chunk) => (
                      <div
                        key={chunk.id}
                        className="rounded-lg border border-slate-200 bg-white p-3 shadow-xs space-y-1.5"
                      >
                        <div className="flex items-center justify-between text-[11px] text-slate-500 border-b border-slate-100 pb-1">
                          <span className="font-mono font-semibold text-[#0f3d35]">
                            Chunk #{chunk.chunkIndex + 1}
                          </span>
                          <div className="flex items-center gap-2">
                            {chunk.pageNumber && (
                              <span className="rounded bg-slate-100 px-1.5 py-0.5">
                                Page {chunk.pageNumber}
                              </span>
                            )}
                            {chunk.sectionTitle && (
                              <span className="font-medium text-slate-700">
                                {chunk.sectionTitle}
                              </span>
                            )}
                            <span className="text-slate-400">
                              ~{chunk.tokenCount} tokens
                            </span>
                          </div>
                        </div>
                        <p className="text-[11px] font-mono text-slate-800 whitespace-pre-wrap leading-relaxed">
                          {chunk.text}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
