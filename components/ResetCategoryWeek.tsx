"use client";

import { useState } from "react";

export function ResetCategoryWeek({ categories }: { categories: { key: string; name: string }[] }) {
  const [categoryKey, setCategoryKey] = useState(categories[0]?.key ?? "");
  const [week, setWeek] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ weeklyStatsDeleted: number; categoryRecordsDeleted: number } | null>(null);

  async function handleReset() {
    const weekNumber = Number(week);
    if (!categoryKey || !Number.isInteger(weekNumber) || weekNumber < 1) {
      setError("Pick a category and enter a valid week number.");
      return;
    }
    const categoryName = categories.find((c) => c.key === categoryKey)?.name ?? categoryKey;
    if (
      !confirm(
        `Clear every member's "${categoryName}" value for week ${weekNumber}? Other categories, other weeks, uploaded screenshots, and Conductor rounds are not affected - only this category's data for this one week is removed, so it can be re-imported. This cannot be undone.`
      )
    ) {
      return;
    }

    setRunning(true);
    setError(null);
    setResult(null);
    const res = await fetch("/api/categories/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryKey, weekNumber }),
    });
    const data = await res.json();
    setRunning(false);
    if (!res.ok) {
      setError(data.error ?? "Failed to reset.");
      return;
    }
    setResult(data);
  }

  return (
    <div className="border border-neutral-200 rounded max-w-md p-4 flex flex-col gap-3">
      <div className="font-semibold">Re-zero a category for one week</div>
      <p className="text-neutral-500 text-xs">
        If a whole category&apos;s import for a week turns out wrong, clear just that field&apos;s data for that
        week and re-import it - other categories, other weeks, and Conductor selections are untouched.
      </p>

      <div className="flex items-center gap-2 text-sm">
        <label htmlFor="reset-category" className="w-16 shrink-0 text-neutral-700">
          Category
        </label>
        <select
          id="reset-category"
          value={categoryKey}
          onChange={(e) => setCategoryKey(e.target.value)}
          className="border border-neutral-300 rounded px-2 py-1 flex-1"
        >
          {categories.map((c) => (
            <option key={c.key} value={c.key}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-2 text-sm">
        <label htmlFor="reset-week" className="w-16 shrink-0 text-neutral-700">
          Week
        </label>
        <input
          id="reset-week"
          type="number"
          min={1}
          value={week}
          onChange={(e) => setWeek(e.target.value)}
          className="border border-neutral-300 rounded px-2 py-1 w-24"
        />
      </div>

      <button
        onClick={handleReset}
        disabled={running}
        className="border border-red-300 text-red-700 rounded px-4 py-2 text-sm disabled:opacity-50 self-start"
      >
        {running ? "Resetting…" : "Reset this category/week"}
      </button>

      {error && <p className="text-red-600 text-sm">{error}</p>}
      {result && (
        <p className="text-green-700 text-sm">
          Cleared {result.weeklyStatsDeleted} weekly value(s) and {result.categoryRecordsDeleted} record(s). Ready to re-import.
        </p>
      )}
    </div>
  );
}
