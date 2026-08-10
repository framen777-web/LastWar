"use client";

import { useEffect, useState } from "react";
import { SHAPE_FIELDS } from "@/lib/ai/prompts";

type Category = {
  id: number;
  key: string;
  name: string;
  description: string | null;
  shape: string;
  divisor: number;
  divisorLabel: string | null;
  importMode: string;
  dedupField: string | null;
  storedFields: string[];
  valueField: string;
  active: boolean;
  sortOrder: number;
  recordCount: number;
};

type FormState = {
  name: string;
  description: string;
  shape: string;
  divisorMode: "asis" | "divide";
  divisor: string;
  divisorLabel: string;
  importMode: "single" | "multi";
  dedupField: string;
  storedFields: string[];
  valueField: string;
  active: boolean;
};

const SHAPES = Object.keys(SHAPE_FIELDS);
const SHAPE_LABELS: Record<string, string> = {
  ranking_list: "Ranking list",
  roster: "Roster",
  free_text: "Free text (chat/announcement)",
};

function emptyForm(shape: string): FormState {
  const fields = SHAPE_FIELDS[shape] ?? [];
  const numeric = fields.find((f) => f.numeric);
  return {
    name: "",
    description: "",
    shape,
    divisorMode: "asis",
    divisor: "1",
    divisorLabel: "",
    importMode: "single",
    dedupField: "",
    storedFields: fields.map((f) => f.key),
    valueField: numeric?.key ?? "",
    active: true,
  };
}

function formFromCategory(cat: Category): FormState {
  return {
    name: cat.name,
    description: cat.description ?? "",
    shape: cat.shape,
    divisorMode: cat.divisor === 1 ? "asis" : "divide",
    divisor: String(cat.divisor === 1 ? "" : cat.divisor),
    divisorLabel: cat.divisorLabel ?? "",
    importMode: cat.importMode === "multi" ? "multi" : "single",
    dedupField: cat.dedupField ?? "",
    storedFields: cat.storedFields,
    valueField: cat.valueField,
    active: cat.active,
  };
}

export default function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm("ranking_list"));
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

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
    setForm(emptyForm("ranking_list"));
    setFormErrors({});
    setPanelOpen(true);
  }

  function openEdit(cat: Category) {
    setEditing(cat);
    setForm(formFromCategory(cat));
    setFormErrors({});
    setPanelOpen(true);
  }

  function openDuplicate(cat: Category) {
    setEditing(null);
    setForm({ ...formFromCategory(cat), name: `${cat.name} copy` });
    setFormErrors({});
    setPanelOpen(true);
  }

  function changesRequireRecompute(): boolean {
    if (!editing) return false;
    const newDivisor = form.divisorMode === "asis" ? 1 : Number(form.divisor);
    return (
      newDivisor !== editing.divisor ||
      form.valueField !== editing.valueField ||
      form.importMode !== editing.importMode ||
      (form.importMode === "multi" ? form.dedupField : "") !== (editing.dedupField ?? "")
    );
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();

    if (editing && editing.recordCount > 0 && changesRequireRecompute()) {
      const proceed = confirm(
        `${editing.recordCount} existing record(s) will be recalculated using the new settings. Continue?`
      );
      if (!proceed) return;
    }

    setSaving(true);
    setFormErrors({});

    const isFreeText = form.shape === "free_text";
    const payload = {
      name: form.name,
      description: form.description || null,
      shape: form.shape,
      divisor: isFreeText ? 1 : form.divisorMode === "asis" ? 1 : Number(form.divisor),
      divisorLabel: isFreeText || form.divisorMode === "asis" ? null : form.divisorLabel || null,
      importMode: isFreeText ? "single" : form.importMode,
      dedupField: !isFreeText && form.importMode === "multi" ? form.dedupField : null,
      storedFields: form.storedFields,
      valueField: isFreeText ? "" : form.valueField,
      active: form.active,
    };

    const url = editing ? `/api/categories/${editing.id}` : "/api/categories";
    const method = editing ? "PATCH" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (!res.ok) {
      const errs: Record<string, string> = {};
      for (const err of data.errors ?? []) errs[err.field] = err.message;
      setFormErrors(errs);
      setSaving(false);
      return;
    }

    setSaving(false);
    setPanelOpen(false);
    await load();
  }

  async function handleDelete(cat: Category) {
    const message =
      cat.recordCount > 0
        ? `"${cat.name}" has ${cat.recordCount} existing record(s) - it will be deactivated instead of deleted. Continue?`
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

  const shapeFields = SHAPE_FIELDS[form.shape] ?? [];
  const numericFields = shapeFields.filter((f) => f.numeric);

  function toggleStoredField(key: string) {
    setForm((f) => {
      if (f.storedFields.includes(key)) {
        if (key === f.valueField) return f; // valueField can't be unchecked
        return { ...f, storedFields: f.storedFields.filter((k) => k !== key) };
      }
      return { ...f, storedFields: [...f.storedFields, key] };
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Categories</h1>
        <button onClick={openCreate} className="bg-neutral-900 text-white rounded px-4 py-2 text-sm">
          Add category
        </button>
      </div>

      {loading ? (
        <p className="text-neutral-500 text-sm">Loading…</p>
      ) : categories.length === 0 ? (
        <div className="border border-dashed border-neutral-300 rounded p-8 text-center flex flex-col gap-3 items-center">
          <p className="text-neutral-500 text-sm max-w-md">
            A category controls how a screenshot type gets classified, extracted, and turned into a dashboard
            number - what field is the value, what to divide it by, and whether it can be imported more than
            once a week.
          </p>
          <button onClick={openCreate} className="bg-neutral-900 text-white rounded px-4 py-2 text-sm">
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

      {panelOpen && (
        <div className="fixed inset-0 z-20 flex justify-end bg-black/20">
          <div className="w-full max-w-md bg-white h-full overflow-y-auto p-6 flex flex-col gap-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">{editing ? "Edit category" : "Add category"}</h2>
              <button onClick={() => setPanelOpen(false)} className="text-neutral-500 hover:text-neutral-900">
                Close
              </button>
            </div>

            <form onSubmit={handleSave} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium">Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="border border-neutral-300 rounded px-3 py-2"
                />
                {formErrors.name && <p className="text-red-600 text-xs">{formErrors.name}</p>}
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium">Screen description</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="What this screenshot looks like - helps the classifier recognize it."
                  className="border border-neutral-300 rounded px-3 py-2 text-sm"
                  rows={2}
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium">Shape</label>
                <select
                  value={form.shape}
                  onChange={(e) => {
                    const shape = e.target.value;
                    const fields = SHAPE_FIELDS[shape] ?? [];
                    const numeric = fields.find((f) => f.numeric);
                    setForm((f) => ({
                      ...f,
                      shape,
                      storedFields: fields.map((fl) => fl.key),
                      valueField: numeric?.key ?? "",
                    }));
                  }}
                  className="border border-neutral-300 rounded px-3 py-2"
                >
                  {SHAPES.map((s) => (
                    <option key={s} value={s}>
                      {SHAPE_LABELS[s] ?? s}
                    </option>
                  ))}
                </select>
                {formErrors.shape && <p className="text-red-600 text-xs">{formErrors.shape}</p>}
              </div>

              {form.shape === "free_text" ? (
                <p className="text-neutral-500 text-xs bg-amber-50 border border-amber-200 rounded px-3 py-2">
                  Free-text categories don't roll up into a single dashboard value — every field is stored
                  directly, and every import is always held for manual review before it's written (never
                  auto-committed).
                </p>
              ) : (
                <>
                  <div className="flex flex-col gap-2">
                    <label className="text-sm font-medium">Divisor</label>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        checked={form.divisorMode === "asis"}
                        onChange={() => setForm((f) => ({ ...f, divisorMode: "asis" }))}
                      />
                      Use number as is
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        checked={form.divisorMode === "divide"}
                        onChange={() => setForm((f) => ({ ...f, divisorMode: "divide" }))}
                      />
                      Divide by
                    </label>
                    {form.divisorMode === "divide" && (
                      <div className="pl-6 flex flex-col gap-2">
                        <input
                          type="number"
                          min={0}
                          step="any"
                          value={form.divisor}
                          onChange={(e) => setForm((f) => ({ ...f, divisor: e.target.value }))}
                          className="border border-neutral-300 rounded px-3 py-2 w-32"
                          placeholder="e.g. 1000"
                        />
                        <input
                          type="text"
                          value={form.divisorLabel}
                          onChange={(e) => setForm((f) => ({ ...f, divisorLabel: e.target.value }))}
                          placeholder="Optional note, e.g. 'raw power ÷ 1000'"
                          className="border border-neutral-300 rounded px-3 py-2 text-sm"
                        />
                      </div>
                    )}
                    {formErrors.divisor && <p className="text-red-600 text-xs">{formErrors.divisor}</p>}
                  </div>

                  <div className="flex flex-col gap-2">
                    <label className="text-sm font-medium">Import frequency</label>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        checked={form.importMode === "single"}
                        onChange={() => setForm((f) => ({ ...f, importMode: "single" }))}
                      />
                      Once per week
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        checked={form.importMode === "multi"}
                        onChange={() => setForm((f) => ({ ...f, importMode: "multi" }))}
                      />
                      Multiple times per week
                    </label>
                    {form.importMode === "multi" && (
                      <p className="text-neutral-500 text-xs pl-6">
                        Dashboard will show the sum of all imports in the week.
                      </p>
                    )}
                    {form.importMode === "multi" && (
                      <div className="pl-6 flex flex-col gap-1">
                        <label className="text-xs font-medium text-neutral-600">Dedup field</label>
                        <select
                          value={form.dedupField}
                          onChange={(e) => setForm((f) => ({ ...f, dedupField: e.target.value }))}
                          className="border border-neutral-300 rounded px-3 py-2 text-sm"
                        >
                          <option value="">Select a field…</option>
                          {form.storedFields.map((key) => (
                            <option key={key} value={key}>
                              {shapeFields.find((f) => f.key === key)?.label ?? key}
                            </option>
                          ))}
                        </select>
                        <p className="text-neutral-400 text-xs">
                          Which field identifies "the same import" (e.g. an in-image event date). Re-processing
                          the same value updates in place instead of double-counting.
                        </p>
                        {formErrors.dedupField && <p className="text-red-600 text-xs">{formErrors.dedupField}</p>}
                      </div>
                    )}
                  </div>
                </>
              )}

              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium">Fields to store</label>
                {shapeFields.map((field) => (
                  <label key={field.key} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.storedFields.includes(field.key)}
                      disabled={field.key === form.valueField}
                      onChange={() => toggleStoredField(field.key)}
                    />
                    {field.label}
                  </label>
                ))}
                {formErrors.storedFields && <p className="text-red-600 text-xs">{formErrors.storedFields}</p>}
              </div>

              {form.shape !== "free_text" && (
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium">Value field</label>
                  <select
                    value={form.valueField}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        valueField: e.target.value,
                        storedFields: f.storedFields.includes(e.target.value)
                          ? f.storedFields
                          : [...f.storedFields, e.target.value],
                      }))
                    }
                    className="border border-neutral-300 rounded px-3 py-2"
                  >
                    {numericFields.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                  {formErrors.valueField && <p className="text-red-600 text-xs">{formErrors.valueField}</p>}
                </div>
              )}

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
                />
                Active
              </label>

              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="bg-neutral-900 text-white rounded px-4 py-2 text-sm disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() => setPanelOpen(false)}
                  className="border border-neutral-300 rounded px-4 py-2 text-sm"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
