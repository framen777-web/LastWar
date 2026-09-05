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
  status: "pending_confirmation" | "needs_review";
  createdAt: string;
  parsed: { members?: ParsedMember[] } | null;
};

type CategoryOption = { key: string; name: string; active: boolean };

export function ReviewClient() {
  const [items, setItems] = useState<PendingExtraction[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [categoryDrafts, setCategoryDrafts] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const [rawRes, categoriesRes] = await Promise.all([
      fetch("/api/raw?status=pending_confirmation,needs_review"),
      fetch("/api/categories"),
    ]);
    const rawData = await rawRes.json();
    const categoriesData = await categoriesRes.json().catch(() => ({ categories: [] }));
    setItems(rawData.extractions ?? []);
    setCategories((categoriesData.categories ?? []).filter((c: CategoryOption) => c.active));
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  // Confirming/rejecting/reprocessing writes Member rows (matchMember() can create new ones) -
  // running two of these at once from this screen is exactly what let concurrent confirms race
  // each other into creating the same brand-new member twice. `busyId` doubles as a global
  // lock (all buttons disabled while it's set, not just the clicked item's) so actions here
  // are always strictly one-at-a-time.
  async function act(id: number, body: { action: "confirm" | "reject" | "reprocess"; categoryKey?: string }) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/raw/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? `Couldn't ${body.action} that item - try again.`);
        return;
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  const pendingConfirmation = items.filter((i) => i.status === "pending_confirmation");
  const needsReview = items.filter((i) => i.status === "needs_review");

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-xl font-semibold">Review</h1>
        {error && <p className="text-red-600 text-sm mt-2">{error}</p>}
        {loading && <p className="text-neutral-500 text-sm mt-2">Loading…</p>}
      </div>

      {!loading && needsReview.length > 0 && (
        <section className="flex flex-col gap-4">
          <div>
            <h2 className="font-medium">Needs review</h2>
            <p className="text-neutral-500 text-sm">
              These screenshots couldn&apos;t be classified or read automatically. Look at the image, pick the
              right category, and reprocess - or reject if it&apos;s not a usable screenshot at all.
            </p>
          </div>
          <ul className="flex flex-col gap-4">
            {needsReview.map((item) => {
              const hasImage = /^https?:\/\//.test(item.imageFilename);
              const draft = categoryDrafts[item.id] ?? (categories.some((c) => c.key === item.categoryKey) ? item.categoryKey : "");
              return (
                <li key={item.id} className="border border-neutral-200 rounded p-4 flex flex-col gap-3 sm:flex-row">
                  {hasImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.imageFilename}
                      alt="Screenshot needing review"
                      className="w-full sm:w-64 max-h-96 object-contain rounded border border-neutral-200 bg-neutral-50"
                    />
                  ) : (
                    <div className="w-full sm:w-64 h-32 flex items-center justify-center text-xs text-neutral-400 border border-dashed border-neutral-300 rounded">
                      Original image no longer available
                    </div>
                  )}

                  <div className="flex-1 flex flex-col gap-3">
                    <div className="flex items-center gap-2 flex-wrap text-sm">
                      <span className="text-neutral-500">week {item.weekNumber}</span>
                      <span className="text-neutral-500">
                        guessed: {item.categoryKey} ({Math.round(item.confidence * 100)}%)
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <select
                        value={draft}
                        onChange={(e) => setCategoryDrafts((d) => ({ ...d, [item.id]: e.target.value }))}
                        disabled={busyId !== null}
                        className="border border-neutral-300 rounded px-2 py-1.5 text-sm"
                      >
                        <option value="">Pick the actual category…</option>
                        {categories.map((c) => (
                          <option key={c.key} value={c.key}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex gap-2">
                      <button
                        onClick={() => act(item.id, { action: "reprocess", categoryKey: draft })}
                        disabled={busyId !== null || !draft || !hasImage}
                        className="bg-accent text-accent-contrast rounded px-3 py-1.5 text-sm disabled:opacity-50"
                      >
                        {busyId === item.id ? "Reprocessing…" : "Reprocess"}
                      </button>
                      <button
                        onClick={() => act(item.id, { action: "reject" })}
                        disabled={busyId !== null}
                        className="border border-neutral-300 rounded px-3 py-1.5 text-sm disabled:opacity-50"
                      >
                        {busyId === item.id ? "Rejecting…" : "Reject"}
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {!loading && (
        <section className="flex flex-col gap-4">
          <div>
            <h2 className="font-medium">Needs your confirmation</h2>
            <p className="text-neutral-500 text-sm">
              Free-text imports (like Squads) are never written automatically — confirm each one below before it
              counts, or reject it if the reading looks wrong.
            </p>
          </div>

          {pendingConfirmation.length === 0 ? (
            <p className="text-neutral-500 text-sm">Nothing waiting for confirmation.</p>
          ) : (
            <ul className="flex flex-col gap-4">
              {pendingConfirmation.map((item) => (
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
                      onClick={() => act(item.id, { action: "confirm" })}
                      disabled={busyId !== null}
                      className="bg-accent text-accent-contrast rounded px-3 py-1.5 text-sm disabled:opacity-50"
                    >
                      {busyId === item.id ? "Confirming…" : "Confirm"}
                    </button>
                    <button
                      onClick={() => act(item.id, { action: "reject" })}
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
        </section>
      )}
    </div>
  );
}
