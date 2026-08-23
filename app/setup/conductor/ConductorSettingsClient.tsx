"use client";

import { useEffect, useState } from "react";

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

      <div className="border border-neutral-200 rounded max-w-md p-4 flex flex-col gap-3">
        <div className="font-semibold">Recalculate selection points</div>
        <p className="text-neutral-500 text-xs">
          Recomputes every confirmed conductor selection&apos;s frozen points from real stats data, snapshotting each
          one at the week before its round started (a round covering weeks 64-65 snapshots at week 63) and chaining
          resets in order per member. Use this if standings show negative totals - overwrites stored historical
          values, so it's worth reviewing the summary afterward.
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
};

type ConductorCategoryApiRow = {
  key: string;
  name: string;
  conductorMode: string;
  conductorPointsPerUnit: number | null;
  conductorUnitSize: number | null;
  conductorFlatValue: number | null;
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
        member has a value at all; Off doesn&apos;t contribute to Conductor points.
      </p>
      <div className="overflow-x-auto">
        <table className="text-sm border-collapse">
          <thead>
            <tr className="text-left text-xs font-medium text-neutral-500">
              <th className="py-1 pr-4">Category</th>
              <th className="py-1 pr-4">Mode</th>
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
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={2} className="py-2 text-neutral-400">
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

type RecalculateResult = {
  updated: number;
  unchanged: number;
  flaggedNegative: { memberId: number; memberName: string; roundId: number; startWeek: number; oldValue: number | null; newValue: number }[];
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
      {error && <p className="text-red-600 text-sm">{error}</p>}
      {result && (
        <div className="text-sm flex flex-col gap-1">
          <p className="text-green-700">
            {result.updated} value(s) changed, {result.unchanged} unchanged.
          </p>
          {result.flaggedNegative.length > 0 && (
            <div className="border border-amber-200 bg-amber-50 rounded p-2 text-xs">
              <p className="font-medium text-amber-800 mb-1">
                {result.flaggedNegative.length} selection(s) are still negative after recalculating - worth investigating (e.g. a round&apos;s start week or the &quot;From week&quot; setting):
              </p>
              {result.flaggedNegative.map((f, i) => (
                <p key={i} className="text-amber-700">
                  {f.memberName} - round starting week {f.startWeek}: {f.newValue.toFixed(2)}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
