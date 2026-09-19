"use client";

import { useEffect, useState } from "react";
import { ProgressBar } from "@/components/ProgressBar";

// Mirrors lib/conductor/settings.ts's types/defaults locally rather than importing them -
// that module also exports functions that touch `@/lib/db` (a server-only Prisma client
// holding real database credentials), which can't be bundled into a client component.
// Same pattern MvpWeightsClient.tsx already uses for lib/mvp/weights.ts.
const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
type Weekday = (typeof WEEKDAYS)[number];
type WeekdayRule = { categoryKey: string; rank: number } | { random: true };
type ConductorSettings = {
  fromWeek: number;
  weeksPerSelect: number;
  allowDuplicatePassengers: boolean;
  weekdayRules: Record<Weekday, WeekdayRule>;
};
const DEFAULT_CONDUCTOR_SETTINGS: ConductorSettings = {
  fromWeek: 1,
  weeksPerSelect: 1,
  allowDuplicatePassengers: false,
  weekdayRules: {
    monday: { random: true },
    tuesday: { random: true },
    wednesday: { random: true },
    thursday: { random: true },
    friday: { random: true },
    saturday: { random: true },
    sunday: { random: true },
  },
};
function isRandomRule(rule: WeekdayRule): rule is { random: true } {
  return "random" in rule && rule.random === true;
}

const WEEKDAY_LABELS: Record<Weekday, string> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
};

const RANDOM_VALUE = "__random__";

export function ConductorSettingsClient({ categories }: { categories: { key: string; name: string }[] }) {
  const [settings, setSettings] = useState<ConductorSettings>(DEFAULT_CONDUCTOR_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/conductor/settings")
      .then((res) => res.json())
      .then((data) => setSettings({ ...DEFAULT_CONDUCTOR_SETTINGS, ...data.settings }))
      .finally(() => setLoading(false));
  }, []);

  function updateRule(day: Weekday, rule: WeekdayRule) {
    setSaved(false);
    setSettings((s) => ({ ...s, weekdayRules: { ...s.weekdayRules, [day]: rule } }));
  }

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    const res = await fetch("/api/conductor/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
    const data = await res.json();
    if (res.ok) {
      setSettings(data.settings);
      setSaved(true);
    }
    setSaving(false);
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Conductor Settings</h1>

      <div className="border border-neutral-200 rounded max-w-md p-4 flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3 text-sm">
          <label htmlFor="fromWeek" className="text-neutral-700">
            From week
          </label>
          <input
            id="fromWeek"
            type="number"
            min={1}
            disabled={loading}
            value={settings.fromWeek}
            onChange={(e) => {
              setSaved(false);
              setSettings((s) => ({ ...s, fromWeek: Number(e.target.value) || 1 }));
            }}
            className="border border-neutral-300 rounded px-2 py-1 w-24 text-right"
          />
        </div>
        <p className="text-neutral-400 text-xs -mt-2">The week the Conductor pool started - points before this week don&apos;t count.</p>

        <div className="flex items-center justify-between gap-3 text-sm">
          <label htmlFor="weeksPerSelect" className="text-neutral-700">
            Weeks per select
          </label>
          <input
            id="weeksPerSelect"
            type="number"
            min={1}
            disabled={loading}
            value={settings.weeksPerSelect}
            onChange={(e) => {
              setSaved(false);
              setSettings((s) => ({ ...s, weeksPerSelect: Number(e.target.value) || 1 }));
            }}
            className="border border-neutral-300 rounded px-2 py-1 w-24 text-right"
          />
        </div>
        <p className="text-neutral-400 text-xs -mt-2">
          Cycle length in weeks - 1 selects 7 conductors and 7 passengers, 2 selects 14 of each.
        </p>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            disabled={loading}
            checked={settings.allowDuplicatePassengers}
            onChange={(e) => {
              setSaved(false);
              setSettings((s) => ({ ...s, allowDuplicatePassengers: e.target.checked }));
            }}
          />
          Allow the same member to be Passenger more than once per cycle
        </label>
      </div>

      <div className="border border-neutral-200 rounded max-w-md">
        <div className="px-4 py-2 border-b border-neutral-200 font-semibold">Passenger rules</div>
        <div className="p-4 flex flex-col gap-3">
          {WEEKDAYS.map((day) => {
            const rule = settings.weekdayRules[day];
            const random = isRandomRule(rule);
            return (
              <div key={day} className="flex items-center gap-2 text-sm">
                <span className="w-24 shrink-0 text-neutral-700">{WEEKDAY_LABELS[day]}</span>
                <select
                  disabled={loading}
                  value={random ? RANDOM_VALUE : rule.categoryKey}
                  onChange={(e) => {
                    const value = e.target.value;
                    updateRule(day, value === RANDOM_VALUE ? { random: true } : { categoryKey: value, rank: 1 });
                  }}
                  className="border border-neutral-300 rounded px-2 py-1 flex-1"
                >
                  <option value={RANDOM_VALUE}>Random</option>
                  {categories.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.name}
                    </option>
                  ))}
                </select>
                {!random && (
                  <input
                    type="number"
                    min={1}
                    disabled={loading}
                    value={rule.rank}
                    onChange={(e) => updateRule(day, { categoryKey: rule.categoryKey, rank: Number(e.target.value) || 1 })}
                    className="border border-neutral-300 rounded px-2 py-1 w-16 text-right"
                    title="Rank (1 = highest)"
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving || loading}
          className="bg-accent text-accent-contrast rounded px-4 py-2 text-sm disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {saved && <span className="text-green-700 text-sm">Saved</span>}
      </div>

      <ConductorCategoryPointsSection />

      <SaveWeeksSection />

      <div className="border border-neutral-200 rounded max-w-md p-4 flex flex-col gap-3">
        <div className="font-semibold">Recalculate selection points</div>
        <p className="text-neutral-500 text-xs">
          Recomputes every confirmed conductor selection&apos;s frozen points from real stats data, snapshotting each
          one at the week before its round started (a round covering weeks 64-65 snapshots at week 63) and chaining
          resets in order per member. Use this if standings show negative totals - overwrites stored historical
          values, so it&apos;s worth reviewing the summary afterward.
        </p>
        <RecalculateButton />
      </div>
    </div>
  );
}

type ConductorCategoryRow = {
  categoryKey: string;
  name: string;
  mode: "off" | "rate" | "flat";
  pointsPerUnit: string;
  unitSize: string;
  flatValue: string;
  saveWeekMode: "full" | "zero" | "capped";
};

type ConductorCategoryApiRow = {
  key: string;
  name: string;
  conductorMode: string;
  conductorPointsPerUnit: number | null;
  conductorUnitSize: number | null;
  conductorFlatValue: number | null;
  saveWeekMode: string;
};

function ConductorCategoryPointsSection() {
  const [rows, setRows] = useState<ConductorCategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/conductor/category-points")
      .then((res) => res.json())
      .then((data) =>
        setRows(
          (data.categories ?? []).map((c: ConductorCategoryApiRow) => ({
            categoryKey: c.key,
            name: c.name,
            mode: c.conductorMode === "rate" || c.conductorMode === "flat" ? c.conductorMode : "off",
            pointsPerUnit: c.conductorPointsPerUnit != null ? String(c.conductorPointsPerUnit) : "",
            unitSize: c.conductorUnitSize != null ? String(c.conductorUnitSize) : "",
            flatValue: c.conductorFlatValue != null ? String(c.conductorFlatValue) : "",
            saveWeekMode: c.saveWeekMode === "zero" || c.saveWeekMode === "capped" ? c.saveWeekMode : "full",
          }))
        )
      )
      .finally(() => setLoading(false));
  }, []);

  function patch(categoryKey: string, patch: Partial<ConductorCategoryRow>) {
    setSaved(false);
    setRows((prev) => prev.map((r) => (r.categoryKey === categoryKey ? { ...r, ...patch } : r)));
  }

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    const items = rows.map((r) => ({
      categoryKey: r.categoryKey,
      mode: r.mode,
      pointsPerUnit: r.mode === "rate" ? Number(r.pointsPerUnit) || 0 : null,
      unitSize: r.mode === "rate" ? Number(r.unitSize) || 1 : null,
      flatValue: r.mode === "flat" ? Number(r.flatValue) || 0 : null,
      saveWeekMode: r.saveWeekMode,
    }));
    await fetch("/api/conductor/category-points", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });
    setSaving(false);
    setSaved(true);
  }

  return (
    <div className="border border-neutral-200 rounded p-4 flex flex-col gap-3">
      <div className="font-semibold">Conductor points by category</div>
      <p className="text-neutral-500 text-xs">
        Rate scores (weekly value / unit size) × points per unit; Flat scores a fixed value for any week the
        member has a value at all; Off doesn&apos;t contribute to Conductor points. Save Week controls what
        happens to this category during a week marked as a Save Week below - Full ignores it, Zero always
        scores 0 that week, Capped scores as if the value were capped at that week&apos;s configured maximum.
      </p>
      <div className="overflow-x-auto">
        <table className="text-sm border-collapse">
          <thead>
            <tr className="text-left text-xs font-medium text-neutral-500">
              <th className="py-1 pr-4">Category</th>
              <th className="py-1 pr-4">Mode</th>
              <th className="py-1 pr-4">Save Week</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.categoryKey} className="border-t border-neutral-100">
                <td className="py-2 pr-4 font-medium whitespace-nowrap">{row.name}</td>
                <td className="py-2 pr-4">
                  <div className="flex items-center gap-2">
                    <select
                      value={row.mode}
                      onChange={(e) => patch(row.categoryKey, { mode: e.target.value as ConductorCategoryRow["mode"] })}
                      className="border border-neutral-300 rounded px-2 py-1"
                    >
                      <option value="off">Off</option>
                      <option value="rate">Rate</option>
                      <option value="flat">Flat</option>
                    </select>
                    {row.mode === "rate" && (
                      <>
                        <input
                          type="number"
                          step="any"
                          placeholder="points"
                          value={row.pointsPerUnit}
                          onChange={(e) => patch(row.categoryKey, { pointsPerUnit: e.target.value })}
                          className="border border-neutral-300 rounded px-2 py-1 w-20"
                        />
                        <span className="text-neutral-500">per</span>
                        <input
                          type="number"
                          step="any"
                          placeholder="unit size"
                          value={row.unitSize}
                          onChange={(e) => patch(row.categoryKey, { unitSize: e.target.value })}
                          className="border border-neutral-300 rounded px-2 py-1 w-24"
                        />
                      </>
                    )}
                    {row.mode === "flat" && (
                      <input
                        type="number"
                        step="any"
                        placeholder="points"
                        value={row.flatValue}
                        onChange={(e) => patch(row.categoryKey, { flatValue: e.target.value })}
                        className="border border-neutral-300 rounded px-2 py-1 w-20"
                      />
                    )}
                  </div>
                </td>
                <td className="py-2 pr-4">
                  <select
                    value={row.saveWeekMode}
                    onChange={(e) => patch(row.categoryKey, { saveWeekMode: e.target.value as ConductorCategoryRow["saveWeekMode"] })}
                    className="border border-neutral-300 rounded px-2 py-1"
                  >
                    <option value="full">Full points</option>
                    <option value="zero">Zero points</option>
                    <option value="capped">Capped</option>
                  </select>
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={3} className="py-2 text-neutral-400">
                  No active categories.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving || loading}
          className="bg-accent text-accent-contrast rounded px-4 py-2 text-sm disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {saved && <span className="text-green-700 text-sm">Saved</span>}
      </div>
    </div>
  );
}

type SaveWeekApiRow = { id: number; weekNumber: number; endDate: string; active: boolean; capValues: Record<string, number> };
type SaveWeekDraft = { id: number | null; weekNumber: string; endDate: string; active: boolean; capValues: Record<string, string> };

function emptyDraft(): SaveWeekDraft {
  return { id: null, weekNumber: "", endDate: "", active: true, capValues: {} };
}

function SaveWeeksSection() {
  const [saveWeeks, setSaveWeeks] = useState<SaveWeekApiRow[]>([]);
  const [cappedCategories, setCappedCategories] = useState<{ key: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<SaveWeekDraft>(emptyDraft());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    Promise.all([
      fetch("/api/conductor/save-weeks").then((res) => res.json()),
      fetch("/api/conductor/category-points").then((res) => res.json()),
    ])
      .then(([sw, cp]) => {
        setSaveWeeks(sw.saveWeeks ?? []);
        setCappedCategories(
          (cp.categories ?? []).filter((c: ConductorCategoryApiRow) => c.saveWeekMode === "capped").map((c: ConductorCategoryApiRow) => ({ key: c.key, name: c.name }))
        );
      })
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  function editRow(row: SaveWeekApiRow) {
    setError(null);
    setDraft({
      id: row.id,
      weekNumber: String(row.weekNumber),
      endDate: row.endDate,
      active: row.active,
      capValues: Object.fromEntries(Object.entries(row.capValues).map(([k, v]) => [k, String(v)])),
    });
  }

  async function handleSave() {
    setError(null);
    const weekNumber = Number(draft.weekNumber);
    if (!Number.isInteger(weekNumber) || weekNumber < 1) {
      setError("Week number must be a whole number >= 1.");
      return;
    }
    if (!draft.endDate) {
      setError("End date is required.");
      return;
    }
    const capValues: Record<string, number> = {};
    for (const c of cappedCategories) {
      const raw = draft.capValues[c.key];
      if (raw !== undefined && raw !== "") capValues[c.key] = Number(raw) || 0;
    }
    const body = JSON.stringify({ weekNumber, endDate: draft.endDate, active: draft.active, capValues });
    setSaving(true);
    const res = await fetch(draft.id ? `/api/conductor/save-weeks/${draft.id}` : "/api/conductor/save-weeks", {
      method: draft.id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) {
      setError(data.error ?? "Save failed.");
      return;
    }
    setDraft(emptyDraft());
    load();
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this Save Week entry? This recalculates every confirmed conductor selection afterward.")) return;
    setSaving(true);
    await fetch(`/api/conductor/save-weeks/${id}`, { method: "DELETE" });
    setSaving(false);
    if (draft.id === id) setDraft(emptyDraft());
    load();
  }

  return (
    <div className="border border-neutral-200 rounded p-4 flex flex-col gap-3 max-w-2xl">
      <div className="font-semibold">Save Weeks</div>
      <p className="text-neutral-500 text-xs">
        Mark a week as a Save Week to apply each category&apos;s Save Week mode (set above) for that week. Saving,
        editing, or deleting an entry here recalculates every confirmed conductor selection&apos;s points afterward.
      </p>

      <table className="text-sm border-collapse">
        <thead>
          <tr className="text-left text-xs font-medium text-neutral-500">
            <th className="py-1 pr-4">Week</th>
            <th className="py-1 pr-4">End date</th>
            <th className="py-1 pr-4">Active</th>
            <th className="py-1 pr-4"></th>
          </tr>
        </thead>
        <tbody>
          {saveWeeks.map((row) => (
            <tr key={row.id} className="border-t border-neutral-100">
              <td className="py-2 pr-4">{row.weekNumber}</td>
              <td className="py-2 pr-4">{row.endDate}</td>
              <td className="py-2 pr-4">{row.active ? "Yes" : "No"}</td>
              <td className="py-2 pr-4 flex gap-2">
                <button onClick={() => editRow(row)} className="text-accent underline text-xs">
                  Edit
                </button>
                <button onClick={() => handleDelete(row.id)} className="text-red-600 underline text-xs">
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {!loading && saveWeeks.length === 0 && (
            <tr>
              <td colSpan={4} className="py-2 text-neutral-400">
                No Save Weeks configured.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="border-t border-neutral-200 pt-3 flex flex-col gap-2">
        <div className="text-xs font-medium text-neutral-600">{draft.id ? `Editing week ${draft.weekNumber}` : "Add a Save Week"}</div>
        <div className="flex items-end gap-3 flex-wrap">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-neutral-500">Week number</label>
            <input
              type="number"
              min={1}
              value={draft.weekNumber}
              onChange={(e) => setDraft((d) => ({ ...d, weekNumber: e.target.value }))}
              className="border border-neutral-300 rounded px-2 py-1 w-24"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-neutral-500">End date (Sunday)</label>
            <input
              type="date"
              value={draft.endDate}
              onChange={(e) => setDraft((d) => ({ ...d, endDate: e.target.value }))}
              className="border border-neutral-300 rounded px-2 py-1"
            />
          </div>
          <label className="flex items-center gap-2 text-sm pb-1">
            <input type="checkbox" checked={draft.active} onChange={(e) => setDraft((d) => ({ ...d, active: e.target.checked }))} />
            Save Week active
          </label>
        </div>

        {cappedCategories.length > 0 && (
          <div className="flex flex-col gap-2 mt-1">
            <div className="text-xs text-neutral-500">Caps for categories set to &quot;Capped&quot; above:</div>
            <div className="flex gap-4 flex-wrap">
              {cappedCategories.map((c) => (
                <div key={c.key} className="flex flex-col gap-1">
                  <label className="text-xs text-neutral-500">{c.name}</label>
                  <input
                    type="number"
                    step="any"
                    placeholder="uncapped"
                    value={draft.capValues[c.key] ?? ""}
                    onChange={(e) => setDraft((d) => ({ ...d, capValues: { ...d.capValues, [c.key]: e.target.value } }))}
                    className="border border-neutral-300 rounded px-2 py-1 w-32"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {error && <p className="text-red-600 text-sm">{error}</p>}

        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-accent text-accent-contrast rounded px-4 py-2 text-sm disabled:opacity-50 self-start"
          >
            {saving ? "Saving…" : draft.id ? "Save changes" : "Add Save Week"}
          </button>
          {draft.id && (
            <button onClick={() => setDraft(emptyDraft())} className="text-neutral-500 text-sm underline">
              Cancel edit
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

type RecalculateResult = {
  updated: number;
  unchanged: number;
  flaggedNegative: {
    memberId: number;
    memberName: string;
    roundId: number;
    startWeek: number;
    oldValue: number | null;
    newValue: number;
    rawValue: number;
  }[];
};

function RecalculateButton() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RecalculateResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleRecalculate() {
    if (!confirm("This overwrites every confirmed conductor selection's stored points based on current stats data. Continue?")) return;
    setRunning(true);
    setError(null);
    setResult(null);
    const res = await fetch("/api/conductor/recalculate", { method: "POST" });
    const data = await res.json();
    setRunning(false);
    if (!res.ok) {
      setError(data.error ?? "Recalculation failed.");
      return;
    }
    setResult(data);
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={handleRecalculate}
        disabled={running}
        className="border border-neutral-300 rounded px-4 py-2 text-sm disabled:opacity-50 self-start"
      >
        {running ? "Recalculating…" : "Recalculate selection points"}
      </button>
      {running && <ProgressBar className="max-w-xs" />}
      {error && <p className="text-red-600 text-sm">{error}</p>}
      {result && (
        <div className="text-sm flex flex-col gap-1">
          <p className="text-green-700">
            {result.updated} value(s) changed, {result.unchanged} unchanged.
          </p>
          {result.flaggedNegative.length > 0 && (
            <div className="border border-neutral-200 bg-neutral-50 rounded p-2 text-xs">
              <p className="font-medium text-neutral-700 mb-1">
                {result.flaggedNegative.length} selection(s) were floored to 0 - the raw calculation went negative
                (e.g. a Save Week change, a divisor correction, or a round&apos;s start week), but a member can
                never carry negative points past a week they were selected in, so these were reset to 0 instead:
              </p>
              {result.flaggedNegative.map((f, i) => (
                <p key={i} className="text-neutral-600">
                  {f.memberName} - round starting week {f.startWeek}: {f.rawValue.toFixed(2)} → 0
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
