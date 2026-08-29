"use client";

import { useEffect, useState } from "react";
import { CategoryForm, type Category } from "@/components/CategoryForm";
import { ResetCategoryWeek } from "@/components/ResetCategoryWeek";
import { ProgressBar } from "@/components/ProgressBar";

export function CategoriesClient() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [duplicateName, setDuplicateName] = useState<string | undefined>(undefined);
  const [recomputeResult, setRecomputeResult] = useState<{ name: string; recalculated: number } | null>(null);
  const [recomputing, setRecomputing] = useState<number | null>(null);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/categories");
    const data = await res.json();
    setCategories(data.categories ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  function openCreate() {
    setEditing(null);
    setDuplicateName(undefined);
    setPanelOpen(true);
  }

  function openEdit(cat: Category) {
    setEditing(cat);
    setDuplicateName(undefined);
    setPanelOpen(true);
  }

  function openDuplicate(cat: Category) {
    setEditing(null);
    setDuplicateName(`${cat.name} copy`);
    setPanelOpen(true);
  }

  async function handleDelete(cat: Category) {
    const reasons: string[] = [];
    if (cat.recordCount > 0) reasons.push(`${cat.recordCount} existing record(s)`);
    if (cat.usedInSeasons.length > 0) reasons.push(`used in season scoring (${cat.usedInSeasons.join(", ")})`);
    const message =
      reasons.length > 0
        ? `"${cat.name}" has ${reasons.join(" and ")} - it will be deactivated instead of deleted. Continue?`
        : `Delete "${cat.name}"? This cannot be undone.`;
    if (!confirm(message)) return;
    await fetch(`/api/categories/${cat.id}`, { method: "DELETE" });
    await load();
  }

  async function handleToggleActive(cat: Category) {
    await fetch(`/api/categories/${cat.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !cat.active }),
    });
    await load();
  }

  async function handleReorder(cat: Category, direction: -1 | 1) {
    const idx = categories.findIndex((c) => c.id === cat.id);
    const swapWith = categories[idx + direction];
    if (!swapWith) return;
    await Promise.all([
      fetch(`/api/categories/${cat.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sortOrder: swapWith.sortOrder }),
      }),
      fetch(`/api/categories/${swapWith.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sortOrder: cat.sortOrder }),
      }),
    ]);
    await load();
  }

  async function handleRecompute(cat: Category) {
    const proceed = confirm(
      `Recompute all ${cat.recordCount} record(s) for "${cat.name}" from their original raw values, using the current divisor? This can't lose data - it only re-derives the stored value.`
    );
    if (!proceed) return;
    setRecomputing(cat.id);
    const res = await fetch(`/api/categories/${cat.id}/recompute`, { method: "POST" });
    const data = await res.json();
    setRecomputing(null);
    setRecomputeResult({ name: cat.name, recalculated: data.recalculated });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Categories</h1>
        <button onClick={openCreate} className="bg-accent text-accent-contrast rounded px-4 py-2 text-sm">
          Add category
        </button>
      </div>

      {recomputeResult && (
        <p className="text-green-700 text-sm">
          Recomputed {recomputeResult.recalculated} record(s) for &quot;{recomputeResult.name}&quot;.
        </p>
      )}

      {loading ? (
        <p className="text-neutral-500 text-sm">Loading…</p>
      ) : categories.length === 0 ? (
        <div className="border border-dashed border-neutral-300 rounded p-8 text-center flex flex-col gap-3 items-center">
          <p className="text-neutral-500 text-sm max-w-md">
            A category controls how a screenshot type gets classified, extracted, and turned into a dashboard
            number - what field is the value, what to divide it by, and whether it can be imported more than
            once a week.
          </p>
          <button onClick={openCreate} className="bg-accent text-accent-contrast rounded px-4 py-2 text-sm">
            Add category
          </button>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-neutral-300 text-left">
                <th className="py-2 pr-3"></th>
                <th className="py-2 pr-3">Name</th>
                <th className="py-2 pr-3">Divisor</th>
                <th className="py-2 pr-3">Import mode</th>
                <th className="py-2 pr-3">Value field</th>
                <th className="py-2 pr-3">Stored fields</th>
                <th className="py-2 pr-3">Dashboard shows</th>
                <th className="py-2 pr-3">Active</th>
                <th className="py-2 pr-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((cat, idx) => (
                <tr key={cat.id} className={`border-b border-neutral-100 ${cat.active ? "" : "opacity-50"}`}>
                  <td className="py-2 pr-1 whitespace-nowrap">
                    <button
                      onClick={() => handleReorder(cat, -1)}
                      disabled={idx === 0}
                      className="text-neutral-400 hover:text-neutral-900 disabled:opacity-30 px-1"
                      aria-label="Move up"
                    >
                      ▲
                    </button>
                    <button
                      onClick={() => handleReorder(cat, 1)}
                      disabled={idx === categories.length - 1}
                      className="text-neutral-400 hover:text-neutral-900 disabled:opacity-30 px-1"
                      aria-label="Move down"
                    >
                      ▼
                    </button>
                  </td>
                  <td className="py-2 pr-3 font-medium whitespace-nowrap">{cat.name}</td>
                  <td className="py-2 pr-3">
                    {cat.shape === "free_text" ? (
                      <span className="text-neutral-400">n/a</span>
                    ) : cat.divisor === 1 ? (
                      "As is"
                    ) : (
                      <div>
                        <div>÷ {cat.divisor.toLocaleString()}</div>
                        {cat.divisorLabel && <div className="text-neutral-400 text-xs">{cat.divisorLabel}</div>}
                      </div>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    {cat.shape === "free_text" ? (
                      <span className="px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap bg-amber-100 text-amber-800">
                        Needs review
                      </span>
                    ) : (
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap ${
                          cat.importMode === "multi" ? "bg-blue-100 text-blue-800" : "bg-neutral-100 text-neutral-700"
                        }`}
                      >
                        {cat.importMode === "multi" ? "Multiple / week" : "Once / week"}
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap">{cat.valueField || <span className="text-neutral-400">n/a</span>}</td>
                  <td className="py-2 pr-3" title={cat.storedFields.join(", ")}>
                    {cat.storedFields.slice(0, 2).join(", ")}
                    {cat.storedFields.length > 2 && (
                      <span className="text-neutral-400"> +{cat.storedFields.length - 2}</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-neutral-500 whitespace-nowrap">
                    {cat.shape === "free_text"
                      ? "Not shown (review only)"
                      : cat.importMode === "multi"
                        ? "Sum of week"
                        : "Latest value"}
                  </td>
                  <td className="py-2 pr-3">
                    <button
                      onClick={() => handleToggleActive(cat)}
                      className={`w-9 h-5 rounded-full relative transition-colors ${cat.active ? "bg-green-500" : "bg-neutral-300"}`}
                      aria-label="Toggle active"
                    >
                      <span
                        className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${cat.active ? "translate-x-4" : "translate-x-0.5"}`}
                      />
                    </button>
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    <button onClick={() => openEdit(cat)} className="text-neutral-600 hover:text-neutral-900 mr-2">
                      Edit
                    </button>
                    <button
                      onClick={() => handleRecompute(cat)}
                      disabled={recomputing === cat.id}
                      className="text-neutral-600 hover:text-neutral-900 mr-2 disabled:opacity-50"
                    >
                      Recompute
                    </button>
                    {recomputing === cat.id && <ProgressBar className="max-w-[120px] mt-1" />}
                    <button onClick={() => openDuplicate(cat)} className="text-neutral-600 hover:text-neutral-900 mr-2">
                      Duplicate
                    </button>
                    <button onClick={() => handleDelete(cat)} className="text-red-600 hover:text-red-800">
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && categories.length > 0 && (
        <ResetCategoryWeek categories={categories.map((c) => ({ key: c.key, name: c.name }))} />
      )}

      {panelOpen && (
        <div className="fixed inset-0 z-20 flex justify-end bg-black/20">
          <div className="w-full max-w-md bg-surface-raised h-full overflow-y-auto p-6 flex flex-col gap-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">{editing ? "Edit category" : "Add category"}</h2>
              <button onClick={() => setPanelOpen(false)} className="text-neutral-500 hover:text-neutral-900">
                Close
              </button>
            </div>

            <CategoryForm
              editing={editing}
              initialName={duplicateName}
              onCancel={() => setPanelOpen(false)}
              onSaved={async () => {
                setPanelOpen(false);
                await load();
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
