"use client";

import { useEffect, useState } from "react";

type ParsedMember = {
  member_name: string;
  air?: number;
  tank?: number;
  missile?: number;
  fourth?: number;
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

export default function ReviewPage() {
  const [items, setItems] = useState<PendingExtraction[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);

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

  async function act(id: number, action: "confirm" | "reject") {
    setBusyId(id);
    await fetch(`/api/raw/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    setBusyId(null);
    await load();
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Review</h1>
      <p className="text-neutral-500 text-sm">
        Free-text imports (like Squads) are never written automatically — confirm each one below before it
        counts, or reject it if the reading looks wrong.
      </p>

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
                      </tr>
                    </thead>
                    <tbody>
                      {item.parsed.members.map((m, i) => (
                        <tr key={i} className="border-b border-neutral-100">
                          <td className="py-1 pr-4 font-medium whitespace-nowrap">{m.member_name}</td>
                          <td className="py-1 pr-4">{m.air ?? "—"}</td>
                          <td className="py-1 pr-4">{m.tank ?? "—"}</td>
                          <td className="py-1 pr-4">{m.missile ?? "—"}</td>
                          <td className="py-1 pr-4">{m.fourth ?? "—"}</td>
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
                  disabled={busyId === item.id}
                  className="bg-neutral-900 text-white rounded px-3 py-1.5 text-sm disabled:opacity-50"
                >
                  Confirm
                </button>
                <button
                  onClick={() => act(item.id, "reject")}
                  disabled={busyId === item.id}
                  className="border border-neutral-300 rounded px-3 py-1.5 text-sm disabled:opacity-50"
                >
                  Reject
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
