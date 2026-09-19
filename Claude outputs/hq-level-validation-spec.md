# HQ level validation — standalone spec

## What this adds

Two rules on the HQ (`Category.key = "members"`, shape `roster`) import,
both grounded in what Frans asked for directly:

1. A member's HQ level can **never read lower** than it did the previous
   week — always flagged, no tolerance.
2. An **increase** of more than a configurable cap in one week is flagged
   as a likely misread — default cap **3**, editable from Settings.

This reuses the exact same `ImportBatch`/per-member review mechanism
already built and confirmed deployed for Squads — but **as its own
parallel set of functions**, not a shared dispatcher. An earlier draft of
this spec assumed Squads would ship behind a generalized
`computeCategoryIssues()`/`getCategoryReview()` dispatcher that HQ could
just plug into. That's not what actually got built — Squads shipped fully
Squads-specific (`hasSquadReviewStep`, `getSquadReview`,
`lib/verify/squadIssues.ts`). This spec mirrors that real pattern with HQ's
own equivalents instead.

## Why this is simpler than Squads was

Two things that made the Squads spec bigger don't apply here, confirmed
against the live code:

- **No `CategoryForm`/API landmine.** The free_text-shape restriction that
  forced Squads's `verificationMode` to `"off"` on every save
  (`components/CategoryForm.tsx` lines 167-173, `app/api/categories/route.ts`
  lines 86-91, `app/api/categories/[id]/route.ts` lines 81-85) is a
  **free_text-only** restriction. For `roster` shape, all three already
  allow `"per_member"` and only force `"off"` for any *other* value
  (`form.shape === "roster" && form.verificationMode !== "per_member" ? "off" : ...`).
  HQ can already have per-member verification turned on today from Setup →
  Categories, no code change needed for that part.
- **No new merge function, no new manual-entry field, no schema change.**
  HQ's single `level` value already flows through the existing
  `loadMergedRows()` roster branch (`lib/verify/service.ts` lines 94-105) as
  a plain `MergedRow.value: number` — there's no multi-field merge problem
  the way Squads' four troop types had. And the review page's "edit this
  member's value" action can just POST `{ memberName, value }` to the
  *existing* `app/api/verify/[categoryKey]/[weekNumber]/route.ts` POST
  handler exactly as every other `ranking_list`/`roster` category's manual
  entry already does (it already forwards `value` correctly — the
  `fields`-passthrough gap I flagged for Squads doesn't affect this, since
  HQ's edit never needs `fields`).

## 1. New file: `lib/verify/hqIssues.ts`

Mirrors `lib/verify/squadIssues.ts`, but for one numeric field instead of
four, and reads the cap from a new `Setting`.

```ts
import { prisma } from "@/lib/db";
import { findMemberId, type MatchableMember } from "@/lib/pipeline/matchMemberCore";
import type { MergedRow } from "./validate";

export type HqIssue =
  | { type: "hq_decreased"; memberName: string; value: number; priorValue: number }
  | { type: "hq_jumped"; memberName: string; value: number; priorValue: number; cap: number };

const HQ_MAX_INCREASE_SETTING_KEY = "hqMaxWeeklyIncrease";
const DEFAULT_HQ_MAX_INCREASE = 3;

async function getHqMaxWeeklyIncrease(): Promise<number> {
  const setting = await prisma.setting.findUnique({ where: { key: HQ_MAX_INCREASE_SETTING_KEY } });
  const n = setting ? Number(setting.value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_HQ_MAX_INCREASE;
}

/**
 * Computes HQ-level data-quality flags for a pending HQ (roster) batch's merged rows -
 * mirrors computeSquadIssues() (squadIssues.ts) but for a single numeric field (level)
 * instead of four troop-type fields. Purely additive to the existing count-based balance
 * check (validateBatch) - never affects isBalanced/variance, only ever surfaces on the HQ
 * review page. Already-acknowledged (memberName, issueType) pairs are excluded by the
 * caller (see getHqReview in lib/verify/service.ts).
 */
export async function computeHqIssues(categoryId: number, weekNumber: number, rows: MergedRow[]): Promise<HqIssue[]> {
  const issues: HqIssue[] = [];
  const cap = await getHqMaxWeeklyIncrease();

  const priorRecords = await prisma.categoryRecord.findMany({
    where: { categoryId, weekNumber: weekNumber - 1 },
    include: { member: true },
  });
  const members = priorRecords.map((r) => r.member) as MatchableMember[];
  const priorValueByMemberName = new Map(priorRecords.map((r) => [r.member.name.trim().toLowerCase(), r.value]));

  for (const row of rows) {
    const value = row.value;
    if (!Number.isFinite(value)) continue; // level didn't extract cleanly - a separate, pre-existing gap, not this check's job

    // Resolve real member identity read-only (no auto-create) so history lookups are against
    // the right person even if this week's OCR'd name spelling drifted slightly.
    const matchedId = findMemberId(row.memberName, members);
    const matchedMember = members.find((m) => m.id === matchedId);
    const priorValue = matchedMember ? priorValueByMemberName.get(matchedMember.name.trim().toLowerCase()) : undefined;
    if (priorValue === undefined) continue; // no prior week to compare against - new member or first submission, nothing to flag

    if (value < priorValue) {
      issues.push({ type: "hq_decreased", memberName: row.memberName, value, priorValue });
    } else if (value > priorValue + cap) {
      issues.push({ type: "hq_jumped", memberName: row.memberName, value, priorValue, cap });
    }
  }

  return issues;
}
```

## 2. `lib/verify/service.ts` — add HQ's review-step functions

`Category` is already imported at the top of this file (line 4), and
`prisma`/`ImportBatch` access patterns are already in scope. Add this
import alongside the existing squad one (after line 6):

```ts
import { computeHqIssues, type HqIssue } from "./hqIssues";
```

Then, right after `unacknowledgeIssue()` at the end of the file (after
line 267), add:

```ts
// Whether committing this category+week should route through the HQ review step instead of
// committing directly - roster shape + per_member mode + the HQ category specifically (key
// check keeps this from silently applying to some future unrelated roster category that
// wouldn't have a "level" concept at all).
export function hasHqReviewStep(category: Pick<Category, "key" | "shape" | "verificationMode">): boolean {
  return category.key === "members" && category.shape === "roster" && category.verificationMode === "per_member";
}

export type HqReview = { issues: HqIssue[]; acknowledged: { id: number; memberName: string; issueType: string }[] };

export async function getHqReview(categoryKey: string, weekNumber: number): Promise<HqReview | null> {
  const category = await prisma.category.findUnique({ where: { key: categoryKey } });
  if (!category || !hasHqReviewStep(category)) return null;

  const batch = await prisma.importBatch.findUnique({
    where: { categoryKey_weekNumber: { categoryKey, weekNumber } },
    include: { manualEntries: true, issueAcks: true },
  });
  if (!batch || batch.status !== "pending") return null;

  const rows = await loadMergedRows(category, weekNumber, batch.manualEntries);
  const allIssues = await computeHqIssues(category.id, weekNumber, rows);

  const ackKey = (i: { memberName: string; issueType: string }) => `${i.memberName.toLowerCase()}:${i.issueType}`;
  const acked = new Set(batch.issueAcks.map((a) => ackKey({ memberName: a.memberName, issueType: a.issueType })));
  const issues = allIssues.filter((i) => !acked.has(ackKey({ memberName: i.memberName, issueType: i.type })));

  return { issues, acknowledged: batch.issueAcks.map((a) => ({ id: a.id, memberName: a.memberName, issueType: a.issueType })) };
}
```

`acknowledgeIssue()`/`unacknowledgeIssue()` (lines 256-267) are already
generic — keyed only by `categoryKey`/`weekNumber`/`memberName`/`issueType`
— so HQ acknowledgments work through them unchanged, no edit needed.

## 3. `app/verify/[categoryKey]/[weekNumber]/page.tsx` — recognize the HQ review step too

Currently:

```tsx
import { hasSquadReviewStep } from "@/lib/verify/service";
...
const hasReviewStep = category ? hasSquadReviewStep(category) : false;
```

Change to:

```tsx
import { hasSquadReviewStep, hasHqReviewStep } from "@/lib/verify/service";
...
const hasReviewStep = category ? hasSquadReviewStep(category) || hasHqReviewStep(category) : false;
```

Nothing else in this file changes — `VerifyDetailClient`'s commit flow
already checks `hasReviewStep` generically (it calls the review API,
routes to the review page if any issues come back, commits directly
otherwise) and needs no HQ-specific change at all.

## 4. `app/api/verify/[categoryKey]/[weekNumber]/review/route.ts` — dispatch GET to whichever review applies

Currently:

```ts
import { getSquadReview, acknowledgeIssue } from "@/lib/verify/service";

export async function GET(_request: Request, ctx: RouteContext<"/api/verify/[categoryKey]/[weekNumber]/review">) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const { categoryKey, weekNumber } = await ctx.params;
  const review = await getSquadReview(categoryKey, Number(weekNumber));
  if (!review) return NextResponse.json({ error: "Batch not found, or this category isn't set up for review." }, { status: 404 });
  return NextResponse.json({ review });
}
```

Change the import and the `GET` body to:

```ts
import { getSquadReview, getHqReview, acknowledgeIssue } from "@/lib/verify/service";

export async function GET(_request: Request, ctx: RouteContext<"/api/verify/[categoryKey]/[weekNumber]/review">) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const { categoryKey, weekNumber } = await ctx.params;
  const review = (await getSquadReview(categoryKey, Number(weekNumber))) ?? (await getHqReview(categoryKey, Number(weekNumber)));
  if (!review) return NextResponse.json({ error: "Batch not found, or this category isn't set up for review." }, { status: 404 });
  return NextResponse.json({ review });
}
```

`getSquadReview()` already returns `null` for any non-Squads category
(`hasSquadReviewStep` check fails first), and `getHqReview()` returns
`null` for any non-HQ category the same way, so the `??` fallback always
resolves to whichever one actually applies (or neither, if the category
has no review step configured). `POST` (acknowledge) is untouched — it's
already generic.

## 5. `app/verify/[categoryKey]/[weekNumber]/review/page.tsx` — render the right client

Currently this route unconditionally renders the Squads-specific client
(it happened to work because Squads was the only category that ever had a
review step):

```tsx
import { requireMenuAccess } from "@/lib/menuAccess";
import { ReviewIssuesClient } from "./ReviewIssuesClient";

export default async function SquadReviewPage({ params }: PageProps<"/verify/[categoryKey]/[weekNumber]/review">) {
  await requireMenuAccess("uploads-verify-imports");
  const { categoryKey, weekNumber } = await params;
  return <ReviewIssuesClient categoryKey={categoryKey} weekNumber={Number(weekNumber)} />;
}
```

`ReviewIssuesClient` is hardcoded to the 4-field air/tank/missile/fourth
shape and would render nonsense (or just "Batch not found," since
`getSquadReview` returns `null` for HQ) if HQ routed into it. Replace the
whole file with:

```tsx
import { prisma } from "@/lib/db";
import { requireMenuAccess } from "@/lib/menuAccess";
import { hasHqReviewStep } from "@/lib/verify/service";
import { ReviewIssuesClient } from "./ReviewIssuesClient";
import { HqReviewClient } from "./HqReviewClient";

export default async function CategoryReviewPage({ params }: PageProps<"/verify/[categoryKey]/[weekNumber]/review">) {
  await requireMenuAccess("uploads-verify-imports");
  const { categoryKey, weekNumber } = await params;
  const category = await prisma.category.findUnique({ where: { key: categoryKey } });

  if (category && hasHqReviewStep(category)) {
    return <HqReviewClient categoryKey={categoryKey} weekNumber={Number(weekNumber)} />;
  }
  return <ReviewIssuesClient categoryKey={categoryKey} weekNumber={Number(weekNumber)} />;
}
```

Squads (and anything else that isn't HQ) keeps going through
`ReviewIssuesClient` exactly as before - this only special-cases HQ.

## 6. New file: `app/verify/[categoryKey]/[weekNumber]/review/HqReviewClient.tsx`

Mirrors `ReviewIssuesClient.tsx`'s structure (load/ack/undo/commit, same
fetches, same page chrome) but with a single "HQ level" field instead of
the 4-field air/tank/missile/fourth form, and HQ's own issue copy:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type HqIssue =
  | { type: "hq_decreased"; memberName: string; value: number; priorValue: number }
  | { type: "hq_jumped"; memberName: string; value: number; priorValue: number; cap: number };

type AckedIssue = { id: number; memberName: string; issueType: string };
type MergedRow = { memberName: string; value: number };

function describeIssue(issue: HqIssue): string {
  switch (issue.type) {
    case "hq_decreased":
      return `HQ level dropped from ${issue.priorValue} to ${issue.value}`;
    case "hq_jumped":
      return `HQ level jumped from ${issue.priorValue} to ${issue.value} (cap is +${issue.cap}/week)`;
  }
}

export function HqReviewClient({ categoryKey, weekNumber }: { categoryKey: string; weekNumber: number }) {
  const router = useRouter();
  const [categoryName, setCategoryName] = useState("");
  const [issues, setIssues] = useState<HqIssue[] | null>(null);
  const [acknowledged, setAcknowledged] = useState<AckedIssue[]>([]);
  const [valueByName, setValueByName] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingMember, setEditingMember] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

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
    const map = new Map<string, number>();
    for (const r of batchData.batch.rows as MergedRow[]) {
      map.set(r.memberName.trim().toLowerCase(), r.value);
    }
    setValueByName(map);
    setLoading(false);
  }, [categoryKey, weekNumber]);

  // Mirrors ReviewIssuesClient.tsx's mount effect shape - see that file for why the setState
  // calls live inside a callback passed to .then() rather than a synchronously-invoked async
  // function.
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
        const map = new Map<string, number>();
        for (const r of data.batchData.batch.rows as MergedRow[]) {
          map.set(r.memberName.trim().toLowerCase(), r.value);
        }
        setValueByName(map);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [categoryKey, weekNumber]);

  function startEdit(memberName: string) {
    const current = valueByName.get(memberName.trim().toLowerCase());
    setDraft(current !== undefined ? String(current) : "");
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
      const res = await fetch(`/api/verify/${categoryKey}/${weekNumber}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberName: editingMember, value: Number(draft) }),
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

  const byMember = new Map<string, HqIssue[]>();
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
        {categoryName || "HQ"} — Week {weekNumber} — Review
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
                  <label className="flex flex-col gap-1 text-xs w-24">
                    HQ level
                    <input
                      type="number"
                      step="any"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      className="border border-neutral-300 rounded px-2 py-1 text-sm"
                    />
                  </label>
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
                  Edit level
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
```

`/api/verify/review-acks/[id]` (DELETE, used by `handleUndoAck`) is
already generic and needs no change — Squads already relies on it the
same way.

## 7. `app/settings/SettingsClient.tsx` — the cap setting

No API route change needed: `app/api/settings/route.ts`'s `PATCH` already
upserts *any* key present in the request body as a `Setting` row (lines
28-37), so adding a new field here is enough on its own.

Add state (near the other primitives, after line 9):

```tsx
const [hqMaxWeeklyIncrease, setHqMaxWeeklyIncrease] = useState("3");
```

In the `useEffect` that loads settings (inside the `.then((data) => {...})`
block, alongside the other `setX(data.settings?.x ?? ...)` calls, after
line 26):

```tsx
setHqMaxWeeklyIncrease(data.settings?.hqMaxWeeklyIncrease ?? "3");
```

In `handleSave`'s `body` object (alongside `r1BottomWeeksWindow`, after
line 51):

```tsx
hqMaxWeeklyIncrease: String(Math.max(1, Number(hqMaxWeeklyIncrease) || 3)),
```

And add a new field block. Insert it after the "R1 default bottom panel
weeks" block (after line 139, before the "MVP score summary mode" block —
or wherever reads naturally; it's a flat form, not tabbed sections, so
exact position doesn't matter functionally):

```tsx
<div className="flex flex-col gap-1">
  <label htmlFor="hqMaxWeeklyIncrease" className="text-sm font-medium">
    HQ level jump cap
  </label>
  <input
    id="hqMaxWeeklyIncrease"
    type="number"
    min={1}
    value={hqMaxWeeklyIncrease}
    onChange={(e) => {
      setHqMaxWeeklyIncrease(e.target.value);
      setSaved(false);
    }}
    disabled={loading}
    className="border border-neutral-300 rounded px-3 py-2 w-32"
  />
  <p className="text-neutral-500 text-xs">
    Used by HQ import verification: a member&apos;s HQ level is flagged for review if it
    increases by more than this many levels in one week. A level that drops at all from the
    previous week is always flagged, regardless of this cap.
  </p>
</div>
```

## 8. Turning it on

No seed/schema change enables this — same as Kills/VS/Donations already
work, HQ's per-member verification is an admin opt-in:

1. Setup → Categories → HQ → set Verification Mode to **Per Member** → Save.
2. Settings → set **HQ level jump cap** if the default of 3 isn't right → Save.

HQ gets no dedicated menu shortcut the way Squads has
(`/verify/squads/review`) — it's reached through the normal `/verify` list
and the normal Commit flow, same as every other `per_member` category.
Say if you want a one-click shortcut like Squads has; it's a small
addition (a static landing page + one `MenuItem` row) on top of this.

## 9. Version bump

Bump `lib/version.ts`'s `MINOR` by 1 from whatever it is at the time this
is implemented (confirmed `MINOR = 43` as of this write-up, but bump
from the live value, not a hardcoded number, in case something else
shipped first).

## Test plan

1. Setup → Categories → HQ → set Verification Mode to Per Member, save.
   Upload an HQ roster screenshot for week N. Confirm it holds as a
   pending batch at `/verify` instead of committing immediately (same as
   Kills/VS/Donations already do).
2. With no prior week's HQ data at all (or for a brand-new member), commit
   the batch. Confirm nothing is flagged — there's nothing to compare
   against yet.
3. Now that week N is committed, upload week N+1 with one member's level
   *lower* than week N. Confirm Commit routes to the HQ review page
   (not the Squads one) and shows "HQ level dropped from X to Y" for that
   member, regardless of how small the drop is.
4. In the same batch, give another member a level 4+ higher than week N
   (with the cap left at its default of 3). Confirm that member shows
   "HQ level jumped from X to Y (cap is +3/week)".
5. Use "Edit level" on one flagged member, save a corrected value that no
   longer violates either rule, and confirm that member's flag clears
   without reloading the page.
6. Use "✓ Looks correct" on the other flagged member (a real jump that's
   just true), confirm it moves to "Dismissed flags" with an Undo link,
   and that Commit now succeeds.
7. Change the HQ level jump cap in Settings to something tighter (e.g. 1)
   and repeat step 4 with a smaller jump than before - confirm it's now
   flagged where it wasn't before.
8. Confirm Squads' own review page and flow are completely unaffected by
   any of this (`/verify/squads/review` still renders the 4-field editor,
   not the HQ one).
