"use client";

import { useState } from "react";

const COLORS: Record<string, string> = {
  Promote: "bg-green-100 text-green-800 border-green-300",
  Watch: "bg-amber-100 text-amber-800 border-amber-300",
  Demote: "bg-red-100 text-red-800 border-red-300",
  "": "bg-neutral-50 text-neutral-500 border-neutral-200",
};

export function SuggestionSelect({
  memberId,
  weekNumber,
  initialValue,
  options = ["Promote", "Watch"],
}: {
  memberId: number;
  weekNumber: number;
  initialValue: string | null;
  options?: string[];
}) {
  const [value, setValue] = useState(initialValue ?? "");
  const [saving, setSaving] = useState(false);

  // Suggestion is one shared value per member/week, not scoped per panel - a member could
  // already have a value set from a context that offers different options than the one
  // showing them now. Keep it selectable rather than silently dropping it from the list.
  const selectableOptions = initialValue && !options.includes(initialValue) ? [...options, initialValue] : options;

  async function handleChange(next: string) {
    setValue(next);
    setSaving(true);
    await fetch("/api/mvp/suggestion", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memberId, weekNumber, value: next || null }),
    });
    setSaving(false);
  }

  return (
    <select
      value={value}
      disabled={saving}
      onChange={(e) => handleChange(e.target.value)}
      className={`border rounded px-2 py-1 text-xs ${COLORS[value] ?? COLORS[""]}`}
    >
      <option value="">—</option>
      {selectableOptions.map((opt) => (
        <option key={opt} value={opt}>
          {opt}
        </option>
      ))}
    </select>
  );
}
