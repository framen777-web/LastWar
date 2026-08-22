"use client";

import { useState } from "react";
import { SHAPE_FIELDS } from "@/lib/ai/prompts";
import { FREE_TEXT_SUMMARIZABLE_KEYS } from "@/lib/reports/summaryMode";

export type Category = {
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
  cumulative: boolean;
  summaryMode: string;
  conductorMode: string;
  conductorPointsPerUnit: number | null;
  conductorUnitSize: number | null;
  conductorFlatValue: number | null;
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
  cumulative: boolean;
  summaryMode: "sum" | "average" | "max" | "min" | "selected_week";
  conductorMode: "off" | "rate" | "flat";
  conductorPointsPerUnit: string;
  conductorUnitSize: string;
  conductorFlatValue: string;
};

const SHAPES = Object.keys(SHAPE_FIELDS);
const SHAPE_LABELS: Record<string, string> = {
  ranking_list: "Ranking list",
  roster: "Roster",
  free_text: "Free text (chat/announcement)",
};

function emptyForm(shape: string, name = ""): FormState {
  const fields = SHAPE_FIELDS[shape] ?? [];
  const numeric = fields.find((f) => f.numeric);
  return {
    name,
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
    cumulative: false,
    summaryMode: "selected_week",
    conductorMode: "off",
    conductorPointsPerUnit: "",
    conductorUnitSize: "",
    conductorFlatValue: "",
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
    cumulative: cat.cumulative,
    summaryMode: (["sum", "average", "max", "min", "selected_week"].includes(cat.summaryMode)
      ? cat.summaryMode
      : "selected_week") as FormState["summaryMode"],
    conductorMode: cat.conductorMode === "rate" || cat.conductorMode === "flat" ? cat.conductorMode : "off",
    conductorPointsPerUnit: cat.conductorPointsPerUnit !== null ? String(cat.conductorPointsPerUnit) : "",
    conductorUnitSize: cat.conductorUnitSize !== null ? String(cat.conductorUnitSize) : "",
    conductorFlatValue: cat.conductorFlatValue !== null ? String(cat.conductorFlatValue) : "",
  };
}

/**
 * The category create/edit form - shared by Setup -> Categories and the CSV import
 * wizard's "+ New category" flow, so category creation stays in exactly one place.
 * Renders only the form itself; callers provide their own panel/modal chrome.
 */
export function CategoryForm({
  editing,
  initialName,
  onCancel,
  onSaved,
}: {
  editing: Category | null;
  initialName?: string;
  onCancel: () => void;
  onSaved: (category: Category) => void;
}) {
  const [form, setForm] = useState<FormState>(editing ? formFromCategory(editing) : emptyForm("ranking_list", initialName));
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

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
    const conductorMode = isFreeText && form.conductorMode === "rate" ? "off" : form.conductorMode;
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
      cumulative: isFreeText ? false : form.cumulative,
      summaryMode: isFreeText && !FREE_TEXT_SUMMARIZABLE_KEYS.has(editing?.key ?? "") ? "selected_week" : form.summaryMode,
      conductorMode,
      conductorPointsPerUnit: conductorMode === "rate" ? Number(form.conductorPointsPerUnit) || 0 : null,
      conductorUnitSize: conductorMode === "rate" ? Number(form.conductorUnitSize) || 1 : null,
      conductorFlatValue: conductorMode === "flat" ? Number(form.conductorFlatValue) || 0 : null,
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
    onSaved(data.category);
  }

  return (
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
          Free-text categories don't roll up into a single dashboard value — every field is stored directly, and
          every import is always held for manual review before it's written (never auto-committed).
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
              <p className="text-neutral-500 text-xs pl-6">Dashboard will show the sum of all imports in the week.</p>
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
                  Which field identifies "the same import" (e.g. an in-image event date). Re-processing the same
                  value updates in place instead of double-counting.
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
                storedFields: f.storedFields.includes(e.target.value) ? f.storedFields : [...f.storedFields, e.target.value],
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

      {form.shape !== "free_text" && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.cumulative}
            onChange={(e) => setForm((f) => ({ ...f, cumulative: e.target.checked }))}
          />
          Cumulative (a lifetime running total, like Kills - Conductor points and Passenger ranking use the
          week-over-week gain instead of the raw value)
        </label>
      )}

      {(form.shape !== "free_text" || FREE_TEXT_SUMMARIZABLE_KEYS.has(editing?.key ?? "")) && (
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">Summarised as</label>
          <select
            value={form.summaryMode}
            onChange={(e) => setForm((f) => ({ ...f, summaryMode: e.target.value as FormState["summaryMode"] }))}
            className="border border-neutral-300 rounded px-3 py-2"
          >
            <option value="selected_week">Selected week</option>
            <option value="sum">Sum</option>
            <option value="average">Average</option>
            <option value="max">Max</option>
            <option value="min">Min</option>
          </select>
          <p className="text-neutral-400 text-xs">
            How this category collapses into one number when a report covers a range of weeks
            (e.g. the Alliance Detail Report's Summary view). "Selected week" shows the value
            from the last week of the requested range, not a range total.
            {form.shape === "free_text" && " For Squads, this also controls how each of Air/Tank/Missile/Fourth is consolidated."}
          </p>
        </div>
      )}

      <div className="flex flex-col gap-2 border-t border-neutral-200 pt-4">
        <label className="text-sm font-medium">Conductor points</label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            checked={form.conductorMode === "off"}
            onChange={() => setForm((f) => ({ ...f, conductorMode: "off" }))}
          />
          Not used for Conductor points
        </label>
        {form.shape !== "free_text" && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              checked={form.conductorMode === "rate"}
              onChange={() => setForm((f) => ({ ...f, conductorMode: "rate" }))}
            />
            Rate - points per unit of value
          </label>
        )}
        {form.conductorMode === "rate" && form.shape !== "free_text" && (
          <div className="pl-6 flex items-center gap-2 text-sm">
            <input
              type="number"
              min={0}
              step="any"
              value={form.conductorPointsPerUnit}
              onChange={(e) => setForm((f) => ({ ...f, conductorPointsPerUnit: e.target.value }))}
              className="border border-neutral-300 rounded px-3 py-2 w-24"
              placeholder="e.g. 1"
            />
            <span className="text-neutral-500">points per</span>
            <input
              type="number"
              min={0}
              step="any"
              value={form.conductorUnitSize}
              onChange={(e) => setForm((f) => ({ ...f, conductorUnitSize: e.target.value }))}
              className="border border-neutral-300 rounded px-3 py-2 w-28"
              placeholder="e.g. 1000"
            />
          </div>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            checked={form.conductorMode === "flat"}
            onChange={() => setForm((f) => ({ ...f, conductorMode: "flat" }))}
          />
          Flat - fixed points for submitting any value that week
        </label>
        {form.conductorMode === "flat" && (
          <div className="pl-6 flex items-center gap-2 text-sm">
            <input
              type="number"
              min={0}
              step="any"
              value={form.conductorFlatValue}
              onChange={(e) => setForm((f) => ({ ...f, conductorFlatValue: e.target.value }))}
              className="border border-neutral-300 rounded px-3 py-2 w-24"
              placeholder="e.g. 50"
            />
            <span className="text-neutral-500">points</span>
          </div>
        )}
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} />
        Active
      </label>

      <div className="flex gap-2 pt-2">
        <button
          type="submit"
          disabled={saving}
          className="bg-accent text-accent-contrast rounded px-4 py-2 text-sm disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={onCancel} className="border border-neutral-300 rounded px-4 py-2 text-sm">
          Cancel
        </button>
      </div>
    </form>
  );
}
