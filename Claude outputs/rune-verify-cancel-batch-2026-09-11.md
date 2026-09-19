# RUNE — Feature: Cancel a pending verification batch

Confirmed live version is `v02.0036` (the batch-reopen fix has landed). This spec targets
`v02.0037`.

## What this adds

Read the live `VerifyDetailClient.tsx` to confirm — right now a batch detail page only ever
offers **Commit** (when balanced) or **Edit missing** / **Commit as-is** (when there's a
variance), plus **View details**. There's no way to walk away from a batch without either
committing it or leaving it sitting there forever. This adds a **Cancel batch** button that
discards the whole thing — every screenshot held for that category+week gets marked
`"rejected"` (the same terminal status the Review screen's own Reject button already uses)
instead of ever being written, and the batch itself is deleted. A later screenshot for that
same category+week just starts a brand new batch from scratch, exactly as if this one never
happened.

This doesn't touch the actual uploaded image in Vercel Blob storage — same as the existing
`rejectRawExtraction()` on the Review screen, only the tracking record changes. Nothing here
needs a schema change.

## Change 1 — `lib/verify/service.ts`: new `cancelBatch()`

Add alongside `commitBatch()`:

```ts
/**
 * Cancels a pending batch outright - discards every screenshot held for this category+week
 * (marked "rejected", never written) and deletes the batch itself, rather than committing
 * anything. A later screenshot for the same category+week starts a brand new batch from
 * scratch. Doesn't touch the underlying image in Blob storage - same as
 * rejectRawExtraction() elsewhere, only the tracking record is marked rejected.
 */
export async function cancelBatch(categoryKey: string, weekNumber: number): Promise<void> {
  const batch = await prisma.importBatch.findUnique({ where: { categoryKey_weekNumber: { categoryKey, weekNumber } } });
  if (!batch || batch.status !== "pending") throw new Error("No pending batch found for this category/week.");

  await prisma.$transaction([
    prisma.rawExtraction.updateMany({ where: { categoryKey, weekNumber, status: "pending_verification" }, data: { status: "rejected" } }),
    prisma.importBatchManualEntry.deleteMany({ where: { importBatchId: batch.id } }),
    prisma.importBatch.delete({ where: { id: batch.id } }),
  ]);
}
```

Manual entries are deleted explicitly before the batch itself because
`ImportBatchManualEntry.importBatch` has no `onDelete: Cascade` in the schema — deleting the
batch first would fail on the foreign key. Same ordering concern this project already tracks
for `Member`-relation tables in the merge helper; this is the same class of thing for
`ImportBatch`.

## Change 2 — `app/api/verify/[categoryKey]/[weekNumber]/route.ts`: `DELETE`

Add alongside the existing `GET`/`POST` in this file:

```ts
import { getBatchDetail, addManualEntry, cancelBatch } from "@/lib/verify/service";

// ...existing GET, POST...

export async function DELETE(_request: Request, ctx: RouteContext<"/api/verify/[categoryKey]/[weekNumber]">) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const { categoryKey, weekNumber } = await ctx.params;
  try {
    await cancelBatch(categoryKey, Number(weekNumber));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
```

(Just adds the `DELETE` export and adds `cancelBatch` to the existing import line — `GET`
and `POST` are untouched.)

## Change 3 — `VerifyDetailClient.tsx`: the Cancel button

Add a `handleCancel` function alongside the existing `handleCommit`:

```ts
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
```

This matches the existing `confirm()` pattern already used for destructive actions in
`CategoriesClient.tsx` — no new UI convention introduced.

Add the button itself in the button row, right after "View details" so it reads as the
least-emphasized, most-destructive option, available regardless of whether the batch is
currently balanced or not (someone may want to cancel a balanced batch too, e.g. the wrong
screenshots got uploaded entirely):

```tsx
      <div className="flex gap-2 flex-wrap">
        {v.isBalanced ? (
          <button
            onClick={() => handleCommit(false)}
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
```

(Only the last `<button>` — "Cancel batch" — is new; the rest of this block is shown for
context/anchoring, unchanged.)

## Bump the version

`lib/version.ts`:

```ts
const MINOR = 37;
```

## Test

1. Deploy, confirm the header version reads `02.0037`.
2. Turn on verification for a test category (or use one already on), upload a screenshot for
   a test week so a batch exists in `/verify`.
3. Open the batch detail — confirm "Cancel batch" now shows alongside whatever
   Commit/Edit-missing buttons are already there, whether the batch is balanced or not.
4. Click it, confirm the browser's confirm dialog appears with the warning text, and
   clicking Cancel on *that* dialog leaves the batch untouched (still on the detail page,
   nothing changed).
5. Click "Cancel batch" again and accept the dialog this time — confirm you land back on
   `/verify`, and the batch is gone from the list.
6. Confirm nothing was written to reports/dashboards for that category/week from the
   cancelled screenshot(s) (there shouldn't be, since it was never committed).
7. Upload a new screenshot for that same category+week — confirm it starts a fresh batch
   (not somehow tangled up with the cancelled one), same as testing a brand-new week would.
