"use client";

import { useEffect, useState } from "react";
import { ProgressBar } from "@/components/ProgressBar";

type User = { id: number; name: string; recentlyActive: boolean };

type MergeResult = {
  weeklyStatsMoved: number;
  weeklyStatsDropped: number;
  categoryRecordsMoved: number;
  categoryRecordsDropped: number;
  suggestionsMoved: number;
  suggestionsDropped: number;
  conductorSelectionsMoved: number;
  seasonExtraValuesMoved: number;
  seasonExtraValuesDropped: number;
  seasonResultsMoved: number;
  seasonResultsDropped: number;
  pivotViewsMoved: number;
  pivotViewsDropped: number;
  feedbackItemsMoved: number;
  mergedOwnName?: boolean;
  newMemberId?: number;
};

export function MergeClient() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [keepId, setKeepId] = useState<number | "">("");
  const [mergeId, setMergeId] = useState<number | "">("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<MergeResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/users");
    const data = await res.json();
    setUsers(data.users ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const sorted = [...users].sort((a, b) => a.name.localeCompare(b.name));
  const recent = sorted.filter((u) => u.recentlyActive);
  const rest = sorted.filter((u) => !u.recentlyActive);

  async function handleMerge() {
    if (keepId === "" || mergeId === "" || keepId === mergeId) return;
    const keepName = sorted.find((u) => u.id === keepId)?.name;
    const mergeName = sorted.find((u) => u.id === mergeId)?.name;
    if (
      !confirm(
        `Merge "${mergeName}" into "${keepName}"? All of "${mergeName}"'s records move onto "${keepName}", and "${mergeName}" is deleted. This can't be undone.`
      )
    ) {
      return;
    }
    setRunning(true);
    setError(null);
    setResult(null);
    const res = await fetch("/api/users/merge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keepId, mergeId }),
    });
    const data = await res.json();
    setRunning(false);
    if (!res.ok) {
      setError(data.error ?? "Merge failed.");
      return;
    }
    setResult(data);
    setKeepId("");
    setMergeId("");

    if (data.mergedOwnName) {
      // The server already re-pointed our session cookie at the surviving member (see
      // /api/users/merge) - a reload is all that's needed to pick it up everywhere (NavHeader,
      // this page's own admin-only access check, etc.). Brief delay so the result message above
      // is actually visible before the page reloads out from under it.
      setTimeout(() => window.location.reload(), 500);
      return;
    }
    await load();
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Merge Members</h1>
      <p className="text-neutral-500 text-sm">
        For two separate member rows that turned out to be the same person (missed during import). Records move
        onto the kept member; on conflict, the kept member&apos;s existing record wins. The merged-away member is
        deleted.
      </p>

      {loading ? (
        <p className="text-neutral-500 text-sm">Loading…</p>
      ) : (
        <div className="border border-neutral-200 rounded max-w-lg p-4 flex flex-col gap-3">
          <div className="flex flex-col gap-3 text-sm">
            <div className="flex flex-col gap-1">
              <label className="font-medium">Keep</label>
              <select
                value={keepId}
                onChange={(e) => setKeepId(e.target.value ? Number(e.target.value) : "")}
                className="border border-neutral-300 rounded px-2 py-1.5 w-full"
              >
                <option value="">Select…</option>
                {recent.length > 0 && (
                  <optgroup label="Active in the last 3 weeks">
                    {recent.map((u) => (
                      <option key={u.id} value={u.id} disabled={u.id === mergeId}>
                        {u.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                {rest.length > 0 && (
                  <optgroup label="Everyone else">
                    {rest.map((u) => (
                      <option key={u.id} value={u.id} disabled={u.id === mergeId}>
                        {u.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="font-medium">Merge away</label>
              <select
                value={mergeId}
                onChange={(e) => setMergeId(e.target.value ? Number(e.target.value) : "")}
                className="border border-neutral-300 rounded px-2 py-1.5 w-full"
              >
                <option value="">Select…</option>
                {recent.length > 0 && (
                  <optgroup label="Active in the last 3 weeks">
                    {recent.map((u) => (
                      <option key={u.id} value={u.id} disabled={u.id === keepId}>
                        {u.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                {rest.length > 0 && (
                  <optgroup label="Everyone else">
                    {rest.map((u) => (
                      <option key={u.id} value={u.id} disabled={u.id === keepId}>
                        {u.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>
            <button
              onClick={handleMerge}
              disabled={running || keepId === "" || mergeId === ""}
              className="border border-neutral-300 rounded px-3 py-1.5 text-sm disabled:opacity-50 self-start"
            >
              {running ? "Merging…" : "Merge"}
            </button>
            {running && <ProgressBar className="max-w-xs" />}
          </div>
          {error && <p className="text-red-600 text-sm">{error}</p>}
          {result && (
            <p className="text-green-700 text-sm">
              Merged: {result.weeklyStatsMoved} stat(s) moved ({result.weeklyStatsDropped} dropped on conflict),{" "}
              {result.categoryRecordsMoved} record(s) moved ({result.categoryRecordsDropped} dropped),{" "}
              {result.suggestionsMoved} suggestion(s) moved ({result.suggestionsDropped} dropped),{" "}
              {result.conductorSelectionsMoved} conductor selection(s) moved,{" "}
              {result.seasonExtraValuesMoved} season item value(s) moved ({result.seasonExtraValuesDropped} dropped),{" "}
              {result.seasonResultsMoved} season result(s) moved ({result.seasonResultsDropped} dropped),{" "}
              {result.pivotViewsMoved} saved pivot view(s) moved ({result.pivotViewsDropped} dropped),{" "}
              {result.feedbackItemsMoved} feedback item(s) moved.
              {result.mergedOwnName && " That was your own account - reloading to switch your session over…"}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
