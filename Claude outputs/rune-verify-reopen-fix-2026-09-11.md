# RUNE — Bug fix: reopening an already-committed verification batch

Confirmed live version is `v02.0034`. This spec targets `v02.0035`.

## What's broken (confirmed against the live code, not guessed)

Reported symptom: Desert Storm's verification worked perfectly on its first trial, but a
later DS batch shows as "balancing" on the `/verify/desert_storm/<week>` detail page, and
pressing **Commit** fails with *"No pending batch found for this category/week."*

Root cause, confirmed by reading the live `lib/pipeline/run.ts` and `lib/verify/service.ts`:
once a category+week's `ImportBatch` has been committed once, uploading **another**
screenshot for that same category+week creates a new `pending_verification` `RawExtraction`
row, but the `ImportBatch` row itself is never reset back to `"pending"` — the pipeline's
`prisma.importBatch.upsert(...)` call uses `update: {}`, which is a no-op if the batch
already exists in any state, committed included.

That produces exactly the reported behavior:
1. The batch stays `status: "committed"`, so it no longer shows up in the `/verify` list
   (`listPendingBatches()` only queries `status: "pending"`) — but a direct link to
   `/verify/desert_storm/<week>` (e.g. from the Upload results page) still opens, because
   `getBatchDetail()` never checks the batch's own status.
2. `getBatchDetail()` only merges `RawExtraction` rows still `status: "pending_verification"`
   — which, after the first commit, is *only* the brand-new screenshot(s), since the earlier
   ones were flipped to `status: "committed"` by that first commit. So the page shows a
   validation computed from just the new screenshot(s) alone — which can easily come out
   "balanced" on its own (this is almost certainly why it read as "balancing").
3. Pressing Commit calls `commitBatch()`, which explicitly checks
   `if (!batch || batch.status !== "pending") throw new Error("No pending batch found for
   this category/week.")` — and since the batch is still `"committed"` from the first time,
   this throws every time, regardless of what the summary showed.

This is a real gap in the original design, not something you did wrong: the spec never
accounted for "I need to add one more screenshot to a week I already committed." Below is
the fix, plus a one-off SQL step to unstick the batch you're on *right now* without waiting
for a deploy.

## Unblock right now — direct SQL against Neon (no deploy needed)

Run this in the Neon SQL editor. First find the stuck week:

```sql
SELECT "weekNumber", status, "committedAt"
FROM "ImportBatch"
WHERE "categoryKey" = 'desert_storm'
ORDER BY "weekNumber" DESC;
```

Find the row that's `status = 'committed'` but that you know should still be open (the one
you're stuck on). Then, replacing `<WEEK>` with that week number, run:

```sql
UPDATE "RawExtraction"
SET status = 'pending_verification'
WHERE "categoryKey" = 'desert_storm' AND "weekNumber" = <WEEK> AND status = 'committed';

UPDATE "ImportBatch"
SET status = 'pending', "committedAt" = NULL, "varianceAcknowledged" = false
WHERE "categoryKey" = 'desert_storm' AND "weekNumber" = <WEEK>;
```

This puts *all* of that week's Desert Storm screenshots (the ones from the first, successful
commit, plus whatever you've uploaded since) back into one open batch — reload
`/verify/desert_storm/<WEEK>` afterward and you should see the full merged picture, not just
the newest screenshot. It doesn't touch anything already written to `CategoryRecord`/
`WeeklyStat` — those upsert per member, so re-committing this reopened batch just safely
re-writes the same correct values for anyone already recorded and adds whoever's new.

## The permanent fix — `lib/pipeline/run.ts`

In `runPipelineForImage`'s verification branch, reopen the batch (and pull its earlier
screenshots back into the pool) whenever a new screenshot arrives for a category+week whose
batch was already committed — not just silently upsert nothing:

```ts
  if (category.verificationMode !== "off") {
    try {
      const extracted = await extract(category, imageBase64, params.mimeType);

      // A new screenshot for a category+week that was already committed means "add this to
      // what I already committed" - reopen the batch by putting its earlier screenshots
      // back in the verification pool too, not just this new one, so the reopened batch's
      // balance-check reflects the whole week again. writeExtraction()'s per-member upserts
      // make re-writing already-committed rows a safe no-op at the next commit.
      const existingBatch = await prisma.importBatch.findUnique({
        where: { categoryKey_weekNumber: { categoryKey, weekNumber: params.weekNumber } },
      });
      if (existingBatch?.status === "committed") {
        await prisma.rawExtraction.updateMany({
          where: { categoryKey, weekNumber: params.weekNumber, status: "committed" },
          data: { status: "pending_verification" },
        });
      }

      await prisma.rawExtraction.create({
        data: {
          imageFilename: params.filename,
          categoryKey,
          weekNumber: params.weekNumber,
          rawJson: JSON.stringify(extracted),
          confidence,
          status: "pending_verification",
        },
      });
      await prisma.importBatch.upsert({
        where: { categoryKey_weekNumber: { categoryKey, weekNumber: params.weekNumber } },
        update: { status: "pending", committedAt: null, varianceAcknowledged: false },
        create: { categoryKey, weekNumber: params.weekNumber },
      });
      return { filename: params.filename, categoryKey, confidence, status: "pending_verification" };
    } catch (err) {
      await createNeedsReview(params.filename, categoryKey, params.weekNumber, confidence);
      return { filename: params.filename, categoryKey, confidence, status: "error", message: describeError(err) };
    }
  }
```

Two changes from what's live today: the new `existingBatch` lookup + conditional
`rawExtraction.updateMany` right before the create, and `update: {}` on the
`importBatch.upsert` becoming `update: { status: "pending", committedAt: null,
varianceAcknowledged: false }`. That second part matters even when the batch is already
`"pending"` (not committed) — it's a harmless no-op reset in that case, but it's what
actually fixes the bug for the committed case, since `update: {}` was the root cause.

**One known, deliberately-accepted edge case:** the `rawExtraction.updateMany` above reverts
*every* `"committed"` extraction for that exact category+week back into the pool, with no way
to distinguish "committed through this verification flow" from "committed the old way, before
this category ever had verification turned on." In practice this only matters if a category
had ordinary (non-verification) commits for a given week, then had verification turned on
*after*, and then got a late screenshot for that same already-passed week — a narrow enough
scenario that it's not worth the extra bookkeeping (a `batchId` link on `RawExtraction`) to
guard against right now. Flagging it in case it ever actually happens.

## Defensive fix — `lib/verify/service.ts`

`getBatchDetail()` currently doesn't check the batch's own status at all, which is how a
committed batch could render as if it were still open (point 2 above). Add the check — the
UI already has the right fallback message for this (`VerifyDetailClient.tsx`: *"Batch not
found - it may already be committed."*), it just never got triggered:

```ts
export async function getBatchDetail(categoryKey: string, weekNumber: number): Promise<BatchDetail | null> {
  const category = await prisma.category.findUnique({ where: { key: categoryKey } });
  if (!category || category.verificationMode === "off") return null;

  const batch = await prisma.importBatch.findUnique({ where: { categoryKey_weekNumber: { categoryKey, weekNumber } }, include: { manualEntries: true } });
  if (!batch || batch.status !== "pending") return null;
  // ...unchanged from here down...
```

(Just adds `|| batch.status !== "pending"` to the existing `if (!batch) return null;` line.)
With the permanent fix above in place this should rarely trigger in practice — a committed
batch gets reopened to `"pending"` automatically the moment a new screenshot arrives for it —
but it's a cheap guard against any stale link (a bookmark, a second browser tab) showing a
misleadingly "balanced" 0-or-partial view of a batch that's actually already done.

## Bump the version

`lib/version.ts`:

```ts
const MINOR = 35;
```

## Test

1. Deploy, confirm the header version reads `02.0035`.
2. Pick any category+week that's already been fully committed through verification (Desert
   Storm, now that you've run the SQL unblock above and re-committed it, works for this).
3. Upload one more screenshot for that same category+week. Confirm the Upload results list
   still shows "held for verification — see Verify" as before.
4. Open `/verify` (the list, not a direct link) — confirm the batch is back in the list as
   pending, not missing.
5. Open the batch detail — confirm it shows *all* the members from the original commit plus
   the new screenshot merged together, not just the new screenshot alone.
6. Commit it — confirm no error, confirm the data is still correct for members from the
   original commit (unchanged) and the new screenshot's members are now present too.
7. Separately: navigate directly to a `/verify/<categoryKey>/<weekNumber>` URL for a batch
   you know is already committed and nothing new has been uploaded for since. Confirm it now
   shows "Batch not found - it may already be committed" instead of a live-looking summary.
