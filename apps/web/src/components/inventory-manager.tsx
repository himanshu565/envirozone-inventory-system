"use client";

import { useEffect, useState, type FormEvent } from "react";
import { API_URL } from "@/lib/api";

type Category = {
  id: number;
  name: string;
};

type Item = {
  id: number;
  itemCode: string;
  name: string;
  description: string | null;
  unit: string;
  minimumStock: number;
  categoryId: number;
  category: Category;
  currentStock: number;
};

type ItemsResponse = {
  data: Item[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

const emptyItemForm = {
  itemCode: "",
  name: "",
  description: "",
  unit: "pcs",
  minimumStock: "0",
  categoryId: "",
};

export function InventoryManager({ canManage }: { canManage: boolean }) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [isSubmittingCategory, setIsSubmittingCategory] = useState(false);

  const [items, setItems] = useState<Item[]>([]);
  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 1,
  });
  const [search, setSearch] = useState("");
  const [isLoadingItems, setIsLoadingItems] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [itemForm, setItemForm] = useState(emptyItemForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmittingItem, setIsSubmittingItem] = useState(false);

  async function loadCategories() {
    try {
      const response = await fetch(`${API_URL}/api/categories`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to load categories");
      const data: Category[] = await response.json();
      setCategories(data);
      setItemForm((prev) =>
        prev.categoryId || !data.length
          ? prev
          : { ...prev, categoryId: String(data[0].id) }
      );
    } catch {
      setCategoryError("Unable to load categories");
    }
  }

  async function loadItems(page = pagination.page, searchTerm = search) {
    setIsLoadingItems(true);
    setListError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pagination.pageSize),
      });
      if (searchTerm) params.set("search", searchTerm);

      const response = await fetch(`${API_URL}/api/items?${params}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to load items");
      const body: ItemsResponse = await response.json();
      setItems(body.data);
      setPagination(body.pagination);
    } catch {
      setListError("Unable to load items");
    } finally {
      setIsLoadingItems(false);
    }
  }

  useEffect(() => {
    loadCategories();
    loadItems(1, "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreateCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCategoryError(null);
    setIsSubmittingCategory(true);

    try {
      const response = await fetch(`${API_URL}/api/categories`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: newCategoryName }),
      });
      const data = await response.json();

      if (!response.ok) {
        setCategoryError(data.error ?? "Something went wrong");
        return;
      }

      setNewCategoryName("");
      await loadCategories();
    } catch {
      setCategoryError("Unable to reach the server");
    } finally {
      setIsSubmittingCategory(false);
    }
  }

  function startEdit(item: Item) {
    setEditingId(item.id);
    setFormError(null);
    setItemForm({
      itemCode: item.itemCode,
      name: item.name,
      description: item.description ?? "",
      unit: item.unit,
      minimumStock: String(item.minimumStock),
      categoryId: String(item.categoryId),
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setFormError(null);
    setItemForm({
      ...emptyItemForm,
      categoryId: categories[0] ? String(categories[0].id) : "",
    });
  }

  async function handleSubmitItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setIsSubmittingItem(true);

    const payload = {
      itemCode: itemForm.itemCode,
      name: itemForm.name,
      description: itemForm.description,
      unit: itemForm.unit,
      minimumStock: Number(itemForm.minimumStock),
      categoryId: Number(itemForm.categoryId),
    };

    try {
      const response = await fetch(
        editingId ? `${API_URL}/api/items/${editingId}` : `${API_URL}/api/items`,
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(payload),
        }
      );
      const data = await response.json();

      if (!response.ok) {
        setFormError(data.error ?? "Something went wrong");
        return;
      }

      cancelEdit();
      await loadItems();
    } catch {
      setFormError("Unable to reach the server");
    } finally {
      setIsSubmittingItem(false);
    }
  }

  async function handleDelete(item: Item) {
    if (!confirm(`Delete "${item.name}"? This cannot be undone.`)) return;

    try {
      const response = await fetch(`${API_URL}/api/items/${item.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setListError(data.error ?? "Unable to delete item");
        return;
      }
      await loadItems();
    } catch {
      setListError("Unable to reach the server");
    }
  }

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    loadItems(1, search);
  }

  return (
    <div className="flex flex-col gap-6">
      {canManage && (
        <div className="rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-6 py-4">
            <h2 className="text-sm font-semibold text-slate-900">
              Categories
            </h2>
          </div>

          <div className="p-6">
            <form onSubmit={handleCreateCategory} className="mb-4 flex gap-2">
              <input
                type="text"
                required
                placeholder="New category name"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
              />
              <button
                type="submit"
                disabled={isSubmittingCategory}
                className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:opacity-50"
              >
                Add
              </button>
            </form>

            {categoryError && (
              <p className="mb-2 text-sm text-red-600">
                {categoryError}
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              {categories.map((c) => (
                <span
                  key={c.id}
                  className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700"
                >
                  {c.name}
                </span>
              ))}
              {categories.length === 0 && (
                <p className="text-sm text-slate-500">
                  No categories yet — add one above before creating items.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {canManage && (
        <form
          onSubmit={handleSubmitItem}
          className="rounded-lg border border-slate-200 bg-white"
        >
          <div className="border-b border-slate-200 px-6 py-4">
            <h2 className="text-sm font-semibold text-slate-900">
              {editingId ? "Edit item" : "Add item"}
            </h2>
          </div>

          <div className="grid grid-cols-2 gap-4 p-6">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">
                Item code
              </span>
              <input
                type="text"
                required
                disabled={!!editingId}
                value={itemForm.itemCode}
                onChange={(e) =>
                  setItemForm((prev) => ({ ...prev, itemCode: e.target.value }))
                }
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none disabled:opacity-50"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">
                Name
              </span>
              <input
                type="text"
                required
                value={itemForm.name}
                onChange={(e) =>
                  setItemForm((prev) => ({ ...prev, name: e.target.value }))
                }
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">
                Category
              </span>
              <select
                required
                value={itemForm.categoryId}
                onChange={(e) =>
                  setItemForm((prev) => ({ ...prev, categoryId: e.target.value }))
                }
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              >
                <option value="" disabled>
                  Select a category
                </option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">
                Unit
              </span>
              <input
                type="text"
                value={itemForm.unit}
                onChange={(e) =>
                  setItemForm((prev) => ({ ...prev, unit: e.target.value }))
                }
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">
                Minimum stock
              </span>
              <input
                type="number"
                min={0}
                value={itemForm.minimumStock}
                onChange={(e) =>
                  setItemForm((prev) => ({
                    ...prev,
                    minimumStock: e.target.value,
                  }))
                }
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </label>

            <label className="col-span-2 block">
              <span className="mb-1 block text-sm font-medium text-slate-700">
                Description
              </span>
              <input
                type="text"
                value={itemForm.description}
                onChange={(e) =>
                  setItemForm((prev) => ({
                    ...prev,
                    description: e.target.value,
                  }))
                }
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </label>
          </div>

          <div className="flex items-center gap-2 border-t border-slate-100 px-6 py-4">
            {formError && (
              <p className="flex-1 text-sm text-red-600">
                {formError}
              </p>
            )}
            <button
              type="submit"
              disabled={isSubmittingItem || categories.length === 0}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-50"
            >
              {isSubmittingItem
                ? "Saving..."
                : editingId
                ? "Save changes"
                : "Add item"}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={cancelEdit}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      )}

      <div className="rounded-lg border border-slate-200 bg-white">
        <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-6 py-4">
          <h2 className="text-sm font-semibold text-slate-900">
            Items
          </h2>
          <form onSubmit={handleSearchSubmit} className="flex gap-2">
            <input
              type="text"
              placeholder="Search by name or code"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
            />
            <button
              type="submit"
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
            >
              Search
            </button>
          </form>
        </div>

        <div className="px-6 py-4">
          {isLoadingItems && (
            <p className="text-sm text-slate-500">Loading...</p>
          )}
          {listError && (
            <p className="text-sm text-red-600">{listError}</p>
          )}

          {!isLoadingItems && !listError && (
            <>
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wide text-slate-400">
                    <th className="pb-3 font-medium">Code</th>
                    <th className="pb-3 font-medium">Name</th>
                    <th className="pb-3 font-medium">Category</th>
                    <th className="pb-3 font-medium">Unit</th>
                    <th className="pb-3 font-medium">Current stock</th>
                    <th className="pb-3 font-medium">Min. stock</th>
                    {canManage && <th className="pb-3 font-medium">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr
                      key={item.id}
                      className="border-t border-slate-100"
                    >
                      <td className="py-3 font-mono text-xs text-slate-500">
                        {item.itemCode}
                      </td>
                      <td className="py-3">
                        <p className="font-medium text-slate-900">{item.name}</p>
                        {item.description && (
                          <p
                            className="max-w-xs truncate text-xs text-slate-500"
                            title={item.description}
                          >
                            {item.description}
                          </p>
                        )}
                      </td>
                      <td className="py-3">
                        <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                          {item.category.name}
                        </span>
                      </td>
                      <td className="py-3 text-slate-500">
                        {item.unit}
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
                        {item.minimumStock}
                      </td>
                      {canManage && (
                        <td className="py-3">
                          <div className="flex gap-3">
                            <button
                              onClick={() => startEdit(item)}
                              className="text-sm font-medium text-blue-600 hover:text-blue-500"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleDelete(item)}
                              className="text-sm font-medium text-red-600 hover:text-red-500"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                  {items.length === 0 && (
                    <tr>
                      <td
                        colSpan={canManage ? 7 : 6}
                        className="py-6 text-center text-slate-500"
                      >
                        No items found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>

              {pagination.totalPages > 1 && (
                <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
                  <span>
                    Page {pagination.page} of {pagination.totalPages} (
                    {pagination.total} items)
                  </span>
                  <div className="flex gap-2">
                    <button
                      disabled={pagination.page <= 1}
                      onClick={() => loadItems(pagination.page - 1)}
                      className="rounded-md border border-slate-300 px-3 py-1 disabled:opacity-40"
                    >
                      Previous
                    </button>
                    <button
                      disabled={pagination.page >= pagination.totalPages}
                      onClick={() => loadItems(pagination.page + 1)}
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
