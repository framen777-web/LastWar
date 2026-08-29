"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function SaveViewControls({
  currentQuery,
  savedViews,
}: {
  currentQuery: { members: number[]; categories: string[]; weeks: number };
  savedViews: { id: number; name: string; config: string }[];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    const config = `members=${currentQuery.members.join(",")}&categories=${currentQuery.categories.join(",")}&weeks=${currentQuery.weeks}`;
    const res = await fetch("/api/pivot/views", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), config }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Could not save this view.");
      return;
    }
    setName("");
    router.refresh();
  }

  async function handleDelete(id: number) {
    await fetch(`/api/pivot/views/${id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Save this view as..."
        className="border border-neutral-300 rounded px-2 py-1"
      />
      <button onClick={handleSave} disabled={busy || !name.trim()} className="bg-accent text-accent-contrast rounded px-3 py-1 disabled:opacity-50">
        {busy ? "Saving…" : "Save view"}
      </button>
      {error && <span className="text-red-600">{error}</span>}

      {savedViews.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 ml-4">
          <span className="text-neutral-500">My views:</span>
          {savedViews.map((v) => (
            <span key={v.id} className="flex items-center gap-1 border border-neutral-200 rounded px-2 py-1">
              <a href={`/dashboards/pivot?${v.config}`} className="text-accent">
                {v.name}
              </a>
              <button onClick={() => handleDelete(v.id)} className="text-neutral-400 hover:text-red-600" aria-label={`Delete ${v.name}`}>
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
