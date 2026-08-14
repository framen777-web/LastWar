"use client";

import { useEffect, useState } from "react";

type ParsedMember = {
  member_name: string;
  air?: number;
  tank?: number;
  missile?: number;
  fourth?: number;
  needsReview?: boolean;
};

type PendingExtraction = {
  id: number;
  imageFilename: string;
  categoryKey: string;
  weekNumber: number;
  confidence: number;
  createdAt: string;
  parsed: { members?: ParsedMember[] } | null;
};

export function ReviewClient() {
  const [items, setItems] = useState<PendingExtraction[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/raw?status=pending_confirmation");
    const data = await res.json();
    setItems(data.extractions ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  // Confirming/rejecting writes Member rows (matchMember() can create new ones) - running
  // two of these at once from this screen is exactly what let concurrent confirms race
  // each other into creating the same brand-new member twice. `busyId` doubles as a global
  // lock (all buttons disabled while it's set, not just the clicked item's) so actions here
  // are always strictly one-at-a-time.
  async function act(id: number, action: "confirm" | "reject") {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/raw/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? `Couldn't ${action} that item - try again.`);
        return;
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Review</h1>
      <p className="text-neutral-500 text-sm">
        Free-text imports (like Squads) are never written automatically — confirm each one below before it
        counts, or reject it if the reading looks wrong.
      </p>

      {error && <p className="text-red-600 text-sm">{error}</p>}

      {loading ? (
        <p className="text-neutral-500 text-sm">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-neutral-500 text-sm">Nothing waiting for review.</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {items.map((item) => (
            <li key={item.id} className="border border-neutral-200 rounded p-4 flex flex-col gap-3">
              <div className="flex items-center gap-2 flex-wrap text-sm">
                <span className="font-medium">{item.categoryKey}</span>
                <span className="text-neutral-500">week {item.weekNumber}</span>
                <span className="text-neutral-500">{Math.round(item.confidence * 100)}% confidence</span>
              </div>

              {item.parsed?.members && item.parsed.members.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="text-sm border-collapse">
                    <thead>
                      <tr className="border-b border-neutral-200 text-left">
                        <th className="py-1 pr-4">Member</th>
                        <th className="py-1 pr-4">Air</th>
                        <th className="py-1 pr-4">Tank</th>
                        <th className="py-1 pr-4">Missile</th>
                        <th className="py-1 pr-4">Fourth</th>
                        <th className="py-1 pr-4"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {item.parsed.members.map((m, i) => (
                        <tr key={i} className={`border-b border-neutral-100 ${m.needsReview ? "bg-amber-50" : ""}`}>
                          <td className="py-1 pr-4 font-medium whitespace-nowrap">{m.member_name}</td>
                          <td className="py-1 pr-4">{m.air ?? "—"}</td>
                          <td className="py-1 pr-4">{m.tank ?? "—"}</td>
                          <td className="py-1 pr-4">{m.missile ?? "—"}</td>
                          <td className="py-1 pr-4">{m.fourth ?? "—"}</td>
                          <td className="py-1 pr-4">
                            {m.needsReview && (
                              <span className="bg-amber-100 text-amber-800 border border-amber-300 rounded px-1.5 py-0.5 text-xs whitespace-nowrap">
                                Recheck — fewer than 3 values read
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-neutral-400 text-xs">No members parsed from this image.</p>
              )}

              <div className="flex gap-2">
                <button
                  onClick={() => act(item.id, "confirm")}
                  disabled={busyId !== null}
                  className="bg-accent text-accent-contrast rounded px-3 py-1.5 text-sm disabled:opacity-50"
                >
                  {busyId === item.id ? "Confirming…" : "Confirm"}
                </button>
                <button
                  onClick={() => act(item.id, "reject")}
                  disabled={busyId !== null}
                  className="border border-neutral-300 rounded px-3 py-1.5 text-sm disabled:opacity-50"
                >
                  {busyId === item.id ? "Rejecting…" : "Reject"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
