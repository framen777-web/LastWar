"use client";

import { useState } from "react";

const COLORS: Record<string, string> = {
  Promote: "bg-green-100 text-green-800 border-green-300",
  Watch: "bg-amber-100 text-amber-800 border-amber-300",
  "": "bg-neutral-50 text-neutral-500 border-neutral-200",
};

export function SuggestionSelect({
  memberId,
  weekNumber,
  initialValue,
}: {
  memberId: number;
  weekNumber: number;
  initialValue: string | null;
}) {
  const [value, setValue] = useState(initialValue ?? "");
  const [saving, setSaving] = useState(false);

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
      <option value="Promote">Promote</option>
      <option value="Watch">Watch</option>
    </select>
  );
}
