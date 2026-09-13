"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type MergedRow = { team: string | null; memberName: string; rank?: number; value: number };
type ManualEntry = { id: number; team: string | null; memberName: string; rank: number | null; value: number | null };
type BatchValidation =
  | { mode: "rank_single"; maxRank: number; extractedTotal: number; isBalanced: boolean; variance: number }
  | { mode: "rank_multi_team"; teams: { team: string; maxRank: number; memberCount: number }[]; extractedTotal: number; isBalanced: boolean; variance: number }
  | { mode: "per_member"; expectedTotal: number; extractedTotal: number; isBalanced: boolean; variance: number };
type BatchDetail = { categoryKey: string; categoryName: string; weekNumber: number; validation: BatchValidation; rows: MergedRow[]; manualEntries: ManualEntry[] };

export function VerifyDetailClient({
  categoryKey,
  weekNumber,
  hasReviewStep,
}: {
  categoryKey: string;
  weekNumber: number;
  hasReviewStep: boolean;
}) {
  const router = useRouter();
  const [batch, setBatch] = useState<BatchDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [showDetails, setShowDetails] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftTeam, setDraftTeam] = useState("");
  const [draftName, setDraftName] = useState("");
  const [draftRank, setDraftRank] = useState("");
  const [draftValue, setDraftValue] = useState("");

  // Reused by the add/delete handlers below (called from event handlers, not an effect, so
  // setState inside an async function is unremarkable there). Doesn't set loading=true -
  // the initial useState(true) already covers the first fetch, and reloads after add/delete
  // are already covered by the `busy` state (buttons disabled) rather than a full-page
  // "Loading…" swap.
  const load = useCallback(async () => {
    const res = await fetch(`/api/verify/${categoryKey}/${weekNumber}`);
    if (res.ok) setBatch((await res.json()).batch);
    setLoading(false);
  }, [categoryKey, weekNumber]);

  // Mirrors the .then()-chain shape VerifyClient.tsx's mount effect already uses, rather
  // than calling load() directly - the setState calls need to live inside a callback passed
  // to .then(), not in a synchronously-invoked async function, for the effect to read as
  // "subscribing to an external update" rather than "setting state synchronously on mount".
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/verify/${categoryKey}/${weekNumber}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data) setBatch(data.batch);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [categoryKey, weekNumber]);

  async function handleAddEntry(e: React.FormEvent) {
    e.preventDefault();
    if (!draftName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/verify/${categoryKey}/${weekNumber}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          team: draftTeam || null,
          memberName: draftName,
          rank: draftRank ? Number(draftRank) : null,
          value: draftValue ? Number(draftValue) : null,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Couldn't add that entry.");
      setDraftTeam("");
      setDraftName("");
      setDraftRank("");
      setDraftValue("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteEntry(id: number) {
    setBusy(true);
    await fetch(`/api/verify/entries/${id}`, { method: "DELETE" });
    await load();
    setBusy(false);
  }

  async function handleCommitClick() {
    if (!hasReviewStep) {
      await handleCommit(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/verify/${categoryKey}/${weekNumber}/review`);
      const data = res.ok ? await res.json() : null;
      if (data?.review?.issues?.length > 0) {
        router.push(`/verify/${categoryKey}/${weekNumber}/review`);
        return;
      }
      await handleCommit(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  async function handleCommit(acknowledgeVariance: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/verify/${categoryKey}/${weekNumber}/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acknowledgeVariance }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Couldn't commit this batch.");
      router.push("/verify");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  async function handleCancel() {
    if (
      !confirm(
        "Cancel this batch? Every screenshot uploaded so far for this category/week will be discarded, not committed - you'd need to re-upload if you want it back."
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/verify/${categoryKey}/${weekNumber}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Couldn't cancel this batch.");
      router.push("/verify");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  if (loading) return <p className="text-neutral-500 text-sm">Loading…</p>;
  if (!batch) return <p className="text-neutral-500 text-sm">Batch not found - it may already be committed.</p>;

  const v = batch.validation;

  return (
    <div className="flex flex-col gap-4 max-w-xl">
      <div className="flex items-center gap-2">
        <Link href="/verify" className="text-neutral-500 hover:text-neutral-900 text-sm">
          ← Back
        </Link>
      </div>
      <h1 className="text-xl font-semibold">
        {batch.categoryName} — Week {batch.weekNumber}
      </h1>

      {error && <p className="text-red-600 text-sm">{error}</p>}

      <div className="border border-neutral-200 rounded p-4 flex flex-col gap-2">
        {v.mode === "rank_multi_team" &&
          v.teams.map((t) => (
            <div key={t.team} className="flex justify-between text-sm">
              <span className="font-medium">{t.team}</span>
              <span>
                Max rank {t.maxRank}, {t.memberCount} members
              </span>
            </div>
          ))}
        {v.mode === "rank_single" && (
          <div className="flex justify-between text-sm">
            <span>Max rank</span>
            <span>{v.maxRank}</span>
          </div>
        )}
        {v.mode === "per_member" && (
          <div className="flex justify-between text-sm">
            <span>Expected members</span>
            <span>{v.expectedTotal}</span>
          </div>
        )}
        <div className="border-t border-neutral-200 pt-2 flex justify-between font-semibold">
          <span>Total {v.mode === "per_member" ? "found" : "extracted"}</span>
          <span>{v.extractedTotal}</span>
        </div>
        <div className={`text-sm font-medium ${v.isBalanced ? "text-green-700" : "text-amber-700"}`}>
          {v.isBalanced ? "✓ Balanced" : `⚠ Variance (${v.variance} missing)`}
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        {v.isBalanced ? (
          <button
            onClick={handleCommitClick}
            disabled={busy}
            className="bg-accent text-accent-contrast rounded px-4 py-2 text-sm disabled:opacity-50"
          >
            {busy ? "Committing…" : "Commit"}
          </button>
        ) : (
          <>
            <button
              onClick={() => setShowEdit((s) => !s)}
              disabled={busy}
              className="bg-accent text-accent-contrast rounded px-4 py-2 text-sm disabled:opacity-50"
            >
              Edit missing
            </button>
            <button
              onClick={() => handleCommit(true)}
              disabled={busy}
              className="border border-neutral-300 rounded px-4 py-2 text-sm disabled:opacity-50"
            >
              {busy ? "Committing…" : "Commit as-is"}
            </button>
          </>
        )}
        <button onClick={() => setShowDetails((s) => !s)} className="border border-neutral-300 rounded px-4 py-2 text-sm">
          {showDetails ? "Hide details" : "View details"}
        </button>
        <button
          onClick={handleCancel}
          disabled={busy}
          className="border border-red-300 text-red-700 rounded px-4 py-2 text-sm disabled:opacity-50 hover:bg-red-50"
        >
          Cancel batch
        </button>
      </div>

      {showEdit && (
        <div className="border border-neutral-200 rounded p-4 flex flex-col gap-3">
          <h2 className="font-medium text-sm">Add missing members</h2>

          {batch.manualEntries.length > 0 && (
            <ul className="flex flex-col gap-1 text-sm">
              {batch.manualEntries.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-2">
                  <span>
                    {e.team && <span className="text-neutral-400">{e.team} — </span>}
                    {e.memberName}
                    {e.rank !== null && <span className="text-neutral-400"> (rank {e.rank})</span>}
                    {e.value !== null && <span className="text-neutral-400"> ({e.value})</span>}
                  </span>
                  <button onClick={() => handleDeleteEntry(e.id)} disabled={busy} className="text-red-600 text-xs hover:text-red-800">
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}

          <form onSubmit={handleAddEntry} className="flex flex-col gap-2">
            {v.mode === "rank_multi_team" && (
              <input
                value={draftTeam}
                onChange={(e) => setDraftTeam(e.target.value)}
                placeholder="Team"
                className="border border-neutral-300 rounded px-3 py-2 text-sm"
              />
            )}
            <input
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              placeholder="Member name"
              className="border border-neutral-300 rounded px-3 py-2 text-sm"
            />
            {v.mode !== "per_member" ? (
              <input
                type="number"
                value={draftRank}
                onChange={(e) => setDraftRank(e.target.value)}
                placeholder="Rank"
                className="border border-neutral-300 rounded px-3 py-2 text-sm"
              />
            ) : (
              <input
                type="number"
                value={draftValue}
                onChange={(e) => setDraftValue(e.target.value)}
                placeholder="Score"
                className="border border-neutral-300 rounded px-3 py-2 text-sm"
              />
            )}
            <button type="submit" disabled={busy || !draftName.trim()} className="bg-accent text-accent-contrast rounded px-3 py-1.5 text-sm self-start disabled:opacity-50">
              + Add
            </button>
          </form>
        </div>
      )}

      {showDetails && (
        <div className="overflow-x-auto border border-neutral-200 rounded">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-neutral-300 text-left">
                {v.mode === "rank_multi_team" && <th className="py-2 px-3">Team</th>}
                <th className="py-2 px-3">Name</th>
                {v.mode !== "per_member" && <th className="py-2 px-3">Rank</th>}
                <th className="py-2 px-3">Value</th>
              </tr>
            </thead>
            <tbody>
              {[...batch.rows]
                .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
                .map((r, i) => (
                  <tr key={i} className="border-b border-neutral-100">
                    {v.mode === "rank_multi_team" && <td className="py-1.5 px-3">{r.team ?? "Unlabeled"}</td>}
                    <td className="py-1.5 px-3 font-medium">{r.memberName}</td>
                    {v.mode !== "per_member" && <td className="py-1.5 px-3">{r.rank ?? "—"}</td>}
                    <td className="py-1.5 px-3">{r.value}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
