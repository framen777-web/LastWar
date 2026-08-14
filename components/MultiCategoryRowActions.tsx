"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type EditableImport = { dedupKey: string; label: string; value: number | null };

export function MultiCategoryRowActions({
  weekNumber,
  memberId,
  memberName,
  categoryKey,
  categoryName,
  imports,
}: {
  weekNumber: number;
  memberId: number;
  memberName: string;
  categoryKey: string;
  categoryName: string;
  imports: EditableImport[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    const proceed = confirm(
      `Delete ${memberName}'s ${categoryName} data for week ${weekNumber}? This removes every import's value for them that week in this category. This cannot be undone.`
    );
    if (!proceed) return;

    setDeleting(true);
    await fetch(`/api/weeks/${weekNumber}/members/${memberId}/categories/${categoryKey}`, { method: "DELETE" });
    setDeleting(false);
    router.refresh();
  }

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => setEditing(true)}
        aria-label={`Edit ${memberName}'s ${categoryName} data for week ${weekNumber}`}
        title={`Edit ${memberName}'s ${categoryName} data for week ${weekNumber}`}
        className="text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 rounded p-1"
      >
        ✎
      </button>
      <button
        onClick={handleDelete}
        disabled={deleting}
        aria-label={`Delete ${memberName}'s ${categoryName} data for week ${weekNumber}`}
        title={`Delete ${memberName}'s ${categoryName} data for week ${weekNumber}`}
        className="text-red-600 hover:text-red-800 hover:bg-red-50 rounded p-1 disabled:opacity-50"
      >
        {deleting ? "…" : "✕"}
      </button>

      {editing && (
        <EditPanel
          weekNumber={weekNumber}
          memberId={memberId}
          memberName={memberName}
          categoryKey={categoryKey}
          categoryName={categoryName}
          imports={imports}
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
  categoryKey,
  categoryName,
  imports,
  onClose,
  onSaved,
}: {
  weekNumber: number;
  memberId: number;
  memberName: string;
  categoryKey: string;
  categoryName: string;
  imports: EditableImport[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(imports.map((i) => [i.dedupKey, i.value !== null ? String(i.value) : ""]))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setError(null);

    const body = {
      values: Object.fromEntries(
        imports.map((i) => {
          const raw = (values[i.dedupKey] ?? "").trim();
          return [i.dedupKey, raw === "" ? null : Number(raw)];
        })
      ),
    };

    const res = await fetch(`/api/weeks/${weekNumber}/members/${memberId}/categories/${categoryKey}`, {
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
            {memberName} — {categoryName}, week {weekNumber}
          </h2>
          <button onClick={onClose} aria-label="Close" className="text-neutral-500 hover:text-neutral-900 p-1">
            ✕
          </button>
        </div>

        <p className="text-neutral-500 text-xs">Leave a field blank to remove that import's value for this member.</p>

        <div className="flex flex-col gap-3">
          {imports.map((i) => (
            <div key={i.dedupKey} className="flex flex-col gap-1">
              <label className="text-sm font-medium">{i.label}</label>
              <input
                type="number"
                step="any"
                value={values[i.dedupKey] ?? ""}
                onChange={(e) => setValues((prev) => ({ ...prev, [i.dedupKey]: e.target.value }))}
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
