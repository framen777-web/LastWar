"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type SquadIssue =
  | { type: "few_squads"; memberName: string; count: number }
  | { type: "below_min"; memberName: string; field: string; value: number; min: number }
  | { type: "large_drop"; memberName: string; field: string; value: number; priorValue: number }
  | { type: "missing_submission"; memberName: string };

type AckedIssue = { id: number; memberName: string; issueType: string };
type MergedRow = { memberName: string; fields: Record<string, number | undefined> };

const FIELDS = ["air", "tank", "missile", "fourth"] as const;
const FIELD_LABELS: Record<string, string> = { air: "Air", tank: "Tank", missile: "Missile", fourth: "Fourth" };

function describeIssue(issue: SquadIssue): string {
  switch (issue.type) {
    case "few_squads":
      return `Only ${issue.count} of 4 squads read`;
    case "below_min":
      return `${FIELD_LABELS[issue.field]} reads ${issue.value}, below this week's floor of ${issue.min}`;
    case "large_drop": {
      const pct = Math.round((1 - issue.value / issue.priorValue) * 100);
      return `${FIELD_LABELS[issue.field]} dropped from ${issue.priorValue} to ${issue.value} (${pct}% drop)`;
    }
    case "missing_submission":
      return "No submission this week";
  }
}

export function ReviewIssuesClient({ categoryKey, weekNumber }: { categoryKey: string; weekNumber: number }) {
  const router = useRouter();
  const [categoryName, setCategoryName] = useState("");
  const [issues, setIssues] = useState<SquadIssue[] | null>(null);
  const [acknowledged, setAcknowledged] = useState<AckedIssue[]>([]);
  const [rowsByName, setRowsByName] = useState<Map<string, Record<string, number | undefined>>>(new Map());
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingMember, setEditingMember] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({ air: "", tank: "", missile: "", fourth: "" });

  // Reused by the ack/edit/undo handlers below (called from event handlers, not an effect).
  const load = useCallback(async () => {
    const [reviewRes, batchRes] = await Promise.all([
      fetch(`/api/verify/${categoryKey}/${weekNumber}/review`),
      fetch(`/api/verify/${categoryKey}/${weekNumber}`),
    ]);
    if (!reviewRes.ok || !batchRes.ok) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    const reviewData = await reviewRes.json();
    const batchData = await batchRes.json();
    setIssues(reviewData.review.issues);
    setAcknowledged(reviewData.review.acknowledged);
    setCategoryName(batchData.batch.categoryName);
    const map = new Map<string, Record<string, number | undefined>>();
    for (const r of batchData.batch.rows as MergedRow[]) {
      map.set(r.memberName.trim().toLowerCase(), r.fields);
    }
    setRowsByName(map);
    setLoading(false);
  }, [categoryKey, weekNumber]);

  // Mirrors VerifyDetailClient.tsx's mount effect shape - the setState calls need to live
  // inside a callback passed to .then(), not in a synchronously-invoked async function, for
  // the effect to read as "subscribing to an external update" rather than "setting state
  // synchronously on mount".
  useEffect(() => {
    let cancelled = false;
    Promise.all([fetch(`/api/verify/${categoryKey}/${weekNumber}/review`), fetch(`/api/verify/${categoryKey}/${weekNumber}`)])
      .then(async ([reviewRes, batchRes]) => {
        if (!reviewRes.ok || !batchRes.ok) return null;
        const reviewData = await reviewRes.json();
        const batchData = await batchRes.json();
        return { reviewData, batchData };
      })
      .then((data) => {
        if (cancelled) return;
        if (!data) {
          setNotFound(true);
          setLoading(false);
          return;
        }
        setIssues(data.reviewData.review.issues);
        setAcknowledged(data.reviewData.review.acknowledged);
        setCategoryName(data.batchData.batch.categoryName);
        const map = new Map<string, Record<string, number | undefined>>();
        for (const r of data.batchData.batch.rows as MergedRow[]) {
          map.set(r.memberName.trim().toLowerCase(), r.fields);
        }
        setRowsByName(map);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [categoryKey, weekNumber]);

  function startEdit(memberName: string) {
    const fields = rowsByName.get(memberName.trim().toLowerCase()) ?? {};
    setDraft({
      air: fields.air !== undefined ? String(fields.air) : "",
      tank: fields.tank !== undefined ? String(fields.tank) : "",
      missile: fields.missile !== undefined ? String(fields.missile) : "",
      fourth: fields.fourth !== undefined ? String(fields.fourth) : "",
    });
    setEditingMember(memberName);
  }

  async function handleAck(memberName: string, issueType: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/verify/${categoryKey}/${weekNumber}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberName, issueType }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Couldn't dismiss that flag.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleUndoAck(ackId: number) {
    setBusy(true);
    await fetch(`/api/verify/review-acks/${ackId}`, { method: "DELETE" });
    await load();
    setBusy(false);
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingMember) return;
    setBusy(true);
    setError(null);
    try {
      const fields: Record<string, number> = {};
      for (const f of FIELDS) {
        if (draft[f].trim() !== "") fields[f] = Number(draft[f]);
      }
      const res = await fetch(`/api/verify/${categoryKey}/${weekNumber}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberName: editingMember, fields }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Couldn't save that edit.");
      setEditingMember(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
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

  function handleCommitAnyway() {
    if (!confirm(`${issues?.length ?? 0} data-quality flag(s) are still open. Commit anyway?`)) return;
    handleCommit(true);
  }

  if (loading) return <p className="text-neutral-500 text-sm">Loading…</p>;
  if (notFound || issues === null) return <p className="text-neutral-500 text-sm">Batch not found - it may already be committed.</p>;

  const byMember = new Map<string, SquadIssue[]>();
  for (const issue of issues) {
    if (!byMember.has(issue.memberName)) byMember.set(issue.memberName, []);
    byMember.get(issue.memberName)!.push(issue);
  }

  return (
    <div className="flex flex-col gap-4 max-w-xl">
      <div className="flex items-center gap-2">
        <Link href={`/verify/${categoryKey}/${weekNumber}`} className="text-neutral-500 hover:text-neutral-900 text-sm">
          ← Back
        </Link>
      </div>
      <h1 className="text-xl font-semibold">
        {categoryName || "Squads"} — Week {weekNumber} — Review
      </h1>

      {error && <p className="text-red-600 text-sm">{error}</p>}

      <div className="flex gap-2 flex-wrap">
        {issues.length === 0 ? (
          <button
            onClick={() => handleCommit(false)}
            disabled={busy}
            className="bg-accent text-accent-contrast rounded px-4 py-2 text-sm disabled:opacity-50"
          >
            {busy ? "Committing…" : "Commit"}
          </button>
        ) : (
          <button
            onClick={handleCommitAnyway}
            disabled={busy}
            className="border border-neutral-300 rounded px-4 py-2 text-sm disabled:opacity-50"
          >
            {busy ? "Committing…" : "Commit anyway"}
          </button>
        )}
      </div>

      {issues.length === 0 ? (
        <p className="text-green-700 text-sm font-medium">✓ No open data-quality flags.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {[...byMember.entries()].map(([memberName, memberIssues]) => (
            <li key={memberName} className="border border-amber-200 bg-amber-50 rounded p-3 flex flex-col gap-2">
              <div className="font-medium text-sm">{memberName}</div>
              <ul className="flex flex-col gap-1">
                {memberIssues.map((issue, i) => (
                  <li key={i} className="flex items-center justify-between gap-2 text-sm">
                    <span>{describeIssue(issue)}</span>
                    <button
                      onClick={() => handleAck(memberName, issue.type)}
                      disabled={busy}
                      className="text-green-700 text-xs hover:text-green-900 whitespace-nowrap"
                    >
                      ✓ Looks correct
                    </button>
                  </li>
                ))}
              </ul>

              {editingMember === memberName ? (
                <form onSubmit={handleSaveEdit} className="flex flex-col gap-2 pt-1">
                  <div className="grid grid-cols-2 gap-2">
                    {FIELDS.map((f) => (
                      <label key={f} className="flex flex-col gap-1 text-xs">
                        {FIELD_LABELS[f]}
                        <input
                          type="number"
                          step="any"
                          value={draft[f]}
                          onChange={(e) => setDraft((d) => ({ ...d, [f]: e.target.value }))}
                          className="border border-neutral-300 rounded px-2 py-1 text-sm"
                        />
                      </label>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <button type="submit" disabled={busy} className="bg-accent text-accent-contrast rounded px-3 py-1.5 text-sm disabled:opacity-50">
                      Save
                    </button>
                    <button type="button" onClick={() => setEditingMember(null)} className="border border-neutral-300 rounded px-3 py-1.5 text-sm">
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <button onClick={() => startEdit(memberName)} className="text-accent text-xs hover:underline self-start">
                  Edit values
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {acknowledged.length > 0 && (
        <div className="flex flex-col gap-1">
          <h2 className="font-medium text-sm text-neutral-500">Dismissed flags</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {acknowledged.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2">
                <span className="text-neutral-500">
                  {a.memberName} — {a.issueType}
                </span>
                <button onClick={() => handleUndoAck(a.id)} disabled={busy} className="text-neutral-500 text-xs hover:text-neutral-800">
                  Undo
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
