"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type EditableCategory = { key: string; name: string; value: number | null };
export type EditableSquads = { air: number | null; tank: number | null; missile: number | null; fourth: number | null };

export function MemberWeekActions({
  weekNumber,
  memberId,
  memberName,
  rank,
  categories,
  squads,
}: {
  weekNumber: number;
  memberId: number;
  memberName: string;
  rank: number | null;
  categories: EditableCategory[];
  squads: EditableSquads | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    const proceed = confirm(
      `Delete ${memberName}'s Weekly Info data for week ${weekNumber}? This removes every category's value for them that week (Weekly Info + Multitable). Raw uploaded images and their extraction history are not affected. This cannot be undone.`
    );
    if (!proceed) return;

    setDeleting(true);
    await fetch(`/api/weeks/${weekNumber}/members/${memberId}`, { method: "DELETE" });
    setDeleting(false);
    router.refresh();
  }

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => setEditing(true)}
        aria-label={`Edit ${memberName}'s data for week ${weekNumber}`}
        title={`Edit ${memberName}'s data for week ${weekNumber}`}
        className="text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 rounded p-1"
      >
        ✎
      </button>
      <button
        onClick={handleDelete}
        disabled={deleting}
        aria-label={`Delete ${memberName}'s data for week ${weekNumber}`}
        title={`Delete ${memberName}'s data for week ${weekNumber}`}
        className="text-red-600 hover:text-red-800 hover:bg-red-50 rounded p-1 disabled:opacity-50"
      >
        {deleting ? "…" : "✕"}
      </button>

      {editing && (
        <EditPanel
          weekNumber={weekNumber}
          memberId={memberId}
          memberName={memberName}
          rank={rank}
          categories={categories}
          squads={squads}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function EditPanel({
  weekNumber,
  memberId,
  memberName,
  rank,
  categories,
  squads,
  onClose,
  onSaved,
}: {
  weekNumber: number;
  memberId: number;
  memberName: string;
  rank: number | null;
  categories: EditableCategory[];
  squads: EditableSquads | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [rankValue, setRankValue] = useState(rank !== null ? String(rank) : "");
  const [categoryValues, setCategoryValues] = useState<Record<string, string>>(
    Object.fromEntries(categories.map((c) => [c.key, c.value !== null ? String(c.value) : ""]))
  );
  const [squadsValues, setSquadsValues] = useState({
    air: squads?.air !== null && squads?.air !== undefined ? String(squads.air) : "",
    tank: squads?.tank !== null && squads?.tank !== undefined ? String(squads.tank) : "",
    missile: squads?.missile !== null && squads?.missile !== undefined ? String(squads.missile) : "",
    fourth: squads?.fourth !== null && squads?.fourth !== undefined ? String(squads.fourth) : "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toNumberOrNull(s: string): number | null {
    if (s.trim() === "") return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  async function handleSave() {
    setSaving(true);
    setError(null);

    const body = {
      allianceRank: rankValue.trim() === "" ? null : Number(rankValue),
      categoryValues: Object.fromEntries(categories.map((c) => [c.key, toNumberOrNull(categoryValues[c.key] ?? "")])),
      squads: {
        air: toNumberOrNull(squadsValues.air),
        tank: toNumberOrNull(squadsValues.tank),
        missile: toNumberOrNull(squadsValues.missile),
        fourth: toNumberOrNull(squadsValues.fourth),
      },
    };

    const res = await fetch(`/api/weeks/${weekNumber}/members/${memberId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Couldn't save those changes.");
      return;
    }
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-20 flex justify-end bg-black/20">
      <div className="w-full max-w-sm bg-surface-raised h-full overflow-y-auto p-6 flex flex-col gap-4 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {memberName} — week {weekNumber}
          </h2>
          <button onClick={onClose} aria-label="Close" className="text-neutral-500 hover:text-neutral-900 p-1">
            ✕
          </button>
        </div>

        <p className="text-neutral-500 text-xs">Leave a field blank to clear that value for this week.</p>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">Alliance Rank (1-5)</label>
          <input
            type="number"
            min={1}
            max={5}
            value={rankValue}
            onChange={(e) => setRankValue(e.target.value)}
            className="border border-neutral-300 rounded px-3 py-2 w-24"
          />
        </div>

        {categories.length > 0 && (
          <div className="flex flex-col gap-3 border-t border-neutral-200 pt-3">
            {categories.map((c) => (
              <div key={c.key} className="flex flex-col gap-1">
                <label className="text-sm font-medium">{c.name}</label>
                <input
                  type="number"
                  step="any"
                  value={categoryValues[c.key] ?? ""}
                  onChange={(e) => setCategoryValues((prev) => ({ ...prev, [c.key]: e.target.value }))}
                  className="border border-neutral-300 rounded px-3 py-2"
                />
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-3 border-t border-neutral-200 pt-3">
          <p className="text-sm font-medium">Squads</p>
          {(["air", "tank", "missile", "fourth"] as const).map((field) => (
            <div key={field} className="flex flex-col gap-1">
              <label className="text-xs text-neutral-500 capitalize">{field}</label>
              <input
                type="number"
                step="any"
                value={squadsValues[field]}
                onChange={(e) => setSquadsValues((prev) => ({ ...prev, [field]: e.target.value }))}
                className="border border-neutral-300 rounded px-3 py-2"
              />
            </div>
          ))}
        </div>

        {error && <p className="text-red-600 text-sm">{error}</p>}

        <div className="flex gap-2 mt-auto pt-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-accent text-accent-contrast rounded px-4 py-2 text-sm disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button onClick={onClose} disabled={saving} className="border border-neutral-300 rounded px-4 py-2 text-sm">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
