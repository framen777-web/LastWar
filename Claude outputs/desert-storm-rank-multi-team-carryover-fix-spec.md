# Desert Storm / Canyon Storm carry-over fix — rank_multi_team categories must not reopen a committed batch

## Bug (as reported)

Desert Storm is imported as two separate uploads: Team 1's screenshots first
(uploaded, reviewed, committed on its own), then Team 2's screenshots
afterward as a second, separate import. After importing Team 2, the Verify
page showed more names than were actually in Team 2's screenshots — "like it
added both together."

Confirmed with Frans that this is **not** the already-fixed
merge-dedup-by-raw-text bug (`verify-merge-name-dedup-fix-spec.md`, confirmed
deployed), and **not** the by-design combined-total-across-teams display that
`validateBatch()`'s `rank_multi_team` mode already shows when multiple teams'
screenshots are uploaded together *before* committing. His own description of
the correct behavior: "one import must always be viewed on its own, once it's
committed there must be no carry over. If I import both as one, then add, if
I import separate, then keep it separate."

## Root cause (confirmed against the live code)

`runPipelineForImage()` (`lib/pipeline/run.ts`, lines 50-89) has a "reopen a
committed batch" branch, added for a completely different, legitimate case: a
late or missed screenshot arriving for a category+week that's *already been
committed*, where the right behavior is "add this to what I already
committed" — so it puts the previously-committed `RawExtraction` rows back
into `pending_verification` too, so the reopened batch's balance check
reflects the whole week again:

```ts
// lib/pipeline/run.ts, lines 54-67
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
```

`ImportBatch` is keyed only on `(categoryKey, weekNumber)` — there's no
per-team dimension. So for a `rank_multi_team` category like Desert Storm,
this single condition can't distinguish "a missed screenshot for the *same*
team I already committed" from "a brand-new upload for a *different* team
that happens to share the category+week." It always does the latter's
opposite: it unconditionally un-commits **every** `RawExtraction` row already
committed for that categoryKey+weekNumber — including Team 1's, which have
nothing to do with Team 2's new upload.

Once Team 1's rows are flipped back to `pending_verification`, they land back
in the review pool alongside Team 2's brand-new rows. `mergeRows()`
(`lib/verify/validate.ts`) keys its dedup map on resolved *member identity*
only — not on team — so Team 1's members and Team 2's members (different
people) don't collide as duplicates; they just both show up, and
`validateBatch()`'s `rank_multi_team` branch (lines 143-158) sums every
team's rows into one `extractedTotal`. The Verify page for "Team 2's import"
ends up displaying Team 1 + Team 2 combined — exactly "added together,"
exactly matching the report.

This is a correctness bug specifically for `rank_multi_team`, not for the
other two verification modes (`rank_single`, `per_member`) the reopen logic
was written for, where "a new screenshot after commit" genuinely does always
mean "add to what's already there" (e.g. a late Alliance Exercise screenshot,
a missed row in a Kills ranking).

## Fix

Scope the reopen branch away from `rank_multi_team`. For that mode, a new
screenshot arriving after a commit must never resurrect the previously
committed rows — it starts a fresh, independent batch containing only the
new screenshot(s), exactly matching "if I import separate, keep it separate."
The existing "upload both teams before committing" flow is untouched (that
case never touches this branch at all, since the batch isn't committed yet).

### `lib/pipeline/run.ts`

Replace lines 54-67:

```ts
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
```

with:

```ts
      // A new screenshot for a category+week that was already committed means "add this to
      // what I already committed" - reopen the batch by putting its earlier screenshots
      // back in the verification pool too, not just this new one, so the reopened batch's
      // balance-check reflects the whole week again. writeExtraction()'s per-member upserts
      // make re-writing already-committed rows a safe no-op at the next commit.
      //
      // NOT for rank_multi_team (e.g. Desert Storm/Canyon Storm): there, "committed" means one
      // team's results were confirmed as final, and a later screenshot for the same
      // category+week is a genuinely separate team's import, not more of the same team's data.
      // ImportBatch has no per-team dimension, so without this guard the reopen above would
      // resurrect the already-committed team's rows into the new team's review batch and the
      // Verify page would show both teams' totals added together under what looks like a
      // single fresh import - reported as "imported more names than it actually did." A
      // rank_multi_team category always starts a clean batch for a new screenshot after
      // commit; correcting an already-committed team's own data is a separate, explicit action,
      // not something a new upload should trigger automatically.
      const existingBatch = await prisma.importBatch.findUnique({
        where: { categoryKey_weekNumber: { categoryKey, weekNumber: params.weekNumber } },
      });
      if (existingBatch?.status === "committed" && category.verificationMode !== "rank_multi_team") {
        await prisma.rawExtraction.updateMany({
          where: { categoryKey, weekNumber: params.weekNumber, status: "committed" },
          data: { status: "pending_verification" },
        });
      }
```

That's the entire code change — one added condition. Everything below it
(creating the new `RawExtraction` as `pending_verification`, upserting
`ImportBatch` back to `status: "pending"`) stays exactly as-is and still
runs unconditionally, which is correct: the new screenshot still needs to
show up for review regardless of mode.

### Why this is safe for Desert Storm's actual data

Checked the live `prisma/seed.ts`: `desert_storm`'s entry has `importMode:
"single"` and `dedupField: null` (`verificationMode` is intentionally
omitted from the seed so it stays whatever's set via Setup → Categories,
same as every other category besides `squads`). That means
`writeCategoryRow()`'s `dedupKey` (`lib/pipeline/run.ts` line 228-231) is
always `""` for Desert Storm, so each commit's `CategoryRecord` upsert is
keyed on `(categoryId, memberId, weekNumber, dedupKey="")`. Since a player
fights on exactly one team per Desert Storm event, Team 1's and Team 2's
committed rows are for entirely different `memberId`s — committing Team 2
after this fix just inserts new rows for Team 2's members, with zero
collision against Team 1's already-written rows. If the same category+week
+member combination is later re-imported as a genuine correction, it still
overwrites in place exactly as before (that's the existing, unrelated
single-mode upsert behavior, unaffected by this fix).

### What this doesn't change

- `rank_single` and `per_member` categories keep reopening a committed batch
  on a new screenshot exactly as today — this was never broken for them.
- The "upload multiple teams before ever committing" flow — where
  `mergeRows()`/`validateBatch()`'s combined-total-across-teams display is
  correct and by-design — is completely untouched, since it never reaches
  the reopen branch (the batch isn't `"committed"` yet in that case).
- Nothing about `mergeRows()`, `validateBatch()`, or the Verify UI changes —
  this is purely about which `RawExtraction` rows get pulled back into
  review after a commit.

### Version bump

Bump `lib/version.ts`'s `MINOR` by 1 from whatever it is at deploy time
(`MINOR = 46` as of this write-up).

## Test plan

1. Upload Team 1's Desert Storm screenshots for a given week, review, and
   commit.
2. Upload Team 2's Desert Storm screenshots for the *same* week as a
   separate, later upload.
3. On the Verify page, confirm the batch now pending review shows only Team
   2's members/rows — not Team 1's + Team 2's combined.
4. Commit Team 2's batch. Confirm both teams' data are present and correct
   afterward (check a dashboard/report for a member from each team) — i.e.
   confirm this fix didn't cause Team 1's already-committed data to be lost.
5. Re-upload a corrected screenshot for a member already committed under
   Team 1 (same category+week). Confirm the Verify page shows only that new
   screenshot's rows for review, and committing it correctly overwrites just
   that member's existing `CategoryRecord` (in place), leaving everyone else
   untouched.
6. Regression: repeat the existing "late screenshot after commit" scenario
   for a `rank_single` category (e.g. Alliance Exercise) and confirm it still
   reopens and merges with the previously-committed data as before — this
   fix must not touch that path.
