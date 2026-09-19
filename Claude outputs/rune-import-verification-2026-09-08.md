# RUNE — Feature: Import Verification (balance-check before commit)

Confirmed live version is `v02.0032`. This spec targets `v02.0033`. **Note:** the
video-upload spec delivered earlier also targets `33` but was filed for later review, not
handed off for implementation — if that one gets built first, bump this one to `34`
instead. Whichever gets implemented first claims `33`.

This is the biggest single spec in this project's history — a new pre-commit review stage
for the whole ranking-screenshot import pipeline, three new UI screens, two new tables, and
a new per-category admin setting. Read "Before you build this" fully before starting; it
records the specific interpretations I made where your design doc left something open, so
you can correct me before the implementer builds the wrong thing.

## What this replaces

Today, a `ranking_list` category (Power, Kills, Donations, VS, Desert Storm, Alliance
Exercise) commits straight to the database the moment a screenshot is classified and
extracted with high enough confidence — see `commitCategoryResult()` in
`lib/pipeline/run.ts`. Only low-confidence/misclassified screenshots (→ `needs_review`) or
`free_text` categories like Squads (→ always `pending_confirmation`) ever wait for a human.

This adds a third path: **for any category you explicitly turn verification on for**, every
extraction is held — nothing writes to the database — until the whole batch of screenshots
uploaded for that category+week has been checked for a balanced member count and either
committed as-is or corrected. This is opt-in per category (a new `Category.verificationMode`
setting, default `"off"`), not a blanket change to every category — Power/Kills/etc. keep
committing instantly exactly as today unless you turn this on for them in Setup →
Categories.

## Before you build this — interpretations I made, please correct anything wrong

**1. Which categories does "DS, CS, AE, Canyon, VS, Donations, Power, Kills" actually map
to?** Correction taken: Canyon Storm exists as a live category — you added it yourself via
Setup → Categories, so it doesn't show up in `prisma/seed.ts` (that file only ever seeds
the original built-in set; anything you add through the admin UI lives only in the database,
by design — see the "categories are admin-manageable" note in the project memory file).
This spec never hardcoded a category list — it works off the new `verificationMode` field on
whichever `Category` rows actually exist, seeded or admin-added, so Canyon Storm is covered
automatically once you set its mode. You'll still need to go into Setup → Categories after
this deploys and turn verification on for whichever categories you want it on (see Change 2
and point 3 below for exactly which ones and which mode) — nothing is turned on
automatically by this deploy.

**2. "Team A / Team B" grouping — corrected.** I'd originally guessed this meant two
different alliances' tags inside one ranking list. That was wrong: per your correction, a
category like Desert Storm can have **two teams from the same alliance** competing against
each other, and the only way to tell which team a given screenshot's rows belong to is a
**"winner" label printed at the top of that screenshot** (not anything about the individual
member rows). Since a team's full result can itself span several screenshots (scrolling
through ranks 1-15, 16-30, etc.), every screenshot belonging to the same team repeats that
same label, and that's the actual grouping key.

Rebuilt around that: the AI extraction now reads a new screenshot-level `winner` field (the
same pattern as the existing `event_date` field — read once per screenshot, not per row),
and `rank_multi_team` mode groups screenshots (not individual rows) by that field before
merging each group's rows together. Per your note that "the winner needed be stored, it's
just for grouping" — it's not a special one-off field: it's added as a normal selectable
field in Desert Storm's (and any multi-team category's) "Fields to store" list in Setup →
Categories, exactly like `event_date`/`alliance_rank` already are, so ticking it there is
what actually persists it onto each committed `CategoryRecord`. See Change 2 and 3 below for
the concrete diff — this touches the extraction prompt/schema, not just the merge logic.

**3. Which categories get verification, and in what mode — corrected.** Per your note:
**Kills, VS, Donations, and HQ** (category key `members`, named "HQ" in the UI — I'd
mistakenly called this "HD" in my notes, correcting that here) should all use `per_member`
mode, since every roster member should always have exactly one value there. Desert Storm
(and Canyon Storm, now that I know it exists) are the `rank_multi_team` case. Alliance
Exercise is the `rank_single` case, if you want it verified at all — you didn't confirm
either way, so it's included as available but not required.

The one structural gap this created: **HQ is a `roster`-shape category, not
`ranking_list`** — my first draft of this spec explicitly forced `verificationMode` to
`"off"` for `roster` shape, assuming (wrongly) that only ranking-style screenshots would
ever need this. That restriction is removed below (Change 2), and `per_member` mode is
generalized to work against either shape (Change 3/5) — `rank_single`/`rank_multi_team`
still only make sense for `ranking_list` (HQ has no ranks to check), so the Setup form now
hides those two options when editing a `roster`-shape category.

**4. Expected member count (3.3), per your earlier answer** — "if the current week has 10%
less members than the prior week, use prior week, else use current week," and now also
confirmed correct as roster-based: "on the roster its correct but its the full current
roster (current week + last completed week), not filtered to that category" — exactly what
`getRosterMemberIdsForWeeks()` already returns, so no change needed to the roster half.
Implemented as: `currentRosterCount` = size of that roster. `priorWeekCount` = how many
distinct members actually had a value for this exact category in `weekNumber - 1`. If
`currentRosterCount` is more than 10% below `priorWeekCount`, use `priorWeekCount` as
"expected"; otherwise use `currentRosterCount`. Flagging again since it's still my own
reading of a somewhat open-ended instruction: if this isn't the rule you meant, it's the one
piece most worth double-checking before the implementer builds it.

**5. Multi-screenshot batches "just work" already, for a different reason than you might
expect.** Your existing schema already keys each extracted row by which *member* it belongs
to (not which screenshot) — so Screenshot 1 (ranks 1-15) and Screenshot 2 (ranks 16-30)
naturally combine into one member list with zero new merging logic needed for that part.
The only genuinely new piece is holding the write and checking the total before committing
— which is the actual feature you asked for.

**6. Naming exactly who's missing, for per-member categories (Kills/VS/Donations/HQ)** —
your doc's own mockup for this case (3.3) only ever shows a *count* ("2 missing"), unlike
the rank-based cases where missing *ranks* are directly computable from gaps in the
sequence. Naming specific missing members would require fuzzy-matching every pending
(unconfirmed) name against your roster before commit — a meaningfully separate piece of
logic from anything else in this spec. Left out of v1 as a stated follow-up, not built.

**7. This is a big feature — I'd suggest a rollout order.** Turn verification on for exactly
one category first (Desert Storm is probably the best test case — it's multi-team, and you
clearly care about the DS 45/28 = 73 case from your own example), run a real week through
it, then turn on the rest once you trust the summary numbers.

**8. This hooks into `runPipelineForImage`, not `commitCategoryResult`.** The video-upload
spec (delivered earlier, filed for later review, not yet built) proposed refactoring the
single-image commit logic out of `runPipelineForImage` into a shared `commitCategoryResult`
helper. As of this spec, that refactor hasn't happened — the live code still has one
monolithic `runPipelineForImage` in `lib/pipeline/run.ts`. So Change 4 below hooks directly
into `runPipelineForImage` as it exists today. **If you build the video-upload spec first**,
apply this same hold-branch to `commitCategoryResult` instead (and to its video counterpart,
`runPipelineForVideoSegment`, so a video-sourced screenshot-equivalent segment also respects
verification) — the branch's logic doesn't change, only which function it's pasted into.

**9. One small, deliberate loss of fidelity: `event_date` isn't preserved through a
multi-screenshot verified commit.** Today, a single screenshot's `event_date` (if printed)
rides along to every row from that screenshot. Once multiple screenshots for the same
category+week are held and merged before commit, there's no single "the" event date for the
merged set (each screenshot could in principle print a different one), so Change 5's
`commitBatch()` doesn't try to pick one — it commits without `event_date` for any
verification-mode category. `event_date` is a minor descriptive field, not used in any
report/dashboard calculation today, so this seemed like the right corner to cut rather than
add another merge rule for a field nothing currently reads. Flagging it in case that's wrong.

## Change 1 — schema: `prisma/schema.prisma`

Add `verificationMode` to `Category` (after `valueField`, before `active`):

```prisma
  valueField   String   @default("value")

  // "off" (default - commits immediately on extraction, exactly as before) | "rank_single"
  // (one continuous ranking, e.g. Alliance Exercise - validates max rank found against
  // total members extracted; ranking_list shape only) | "rank_multi_team" (multiple teams
  // in one ranking, screenshots grouped by the "winner" label printed at the top of each
  // one, e.g. Desert Storm/Canyon Storm - validates the sum of each team's max rank against
  // total members extracted; ranking_list shape only) | "per_member" (every roster member
  // should have exactly one value, e.g. Kills/VS/Donations/HQ - validates the count of
  // members found against an expected count; works for ranking_list OR roster shape). Any
  // mode other than "off" holds every extraction for this category+week in an ImportBatch
  // instead of writing immediately - see lib/verify/.
  verificationMode String @default("off")

  active       Boolean  @default(true)
```

Add an index to `RawExtraction` (a verification batch is looked up by exactly this
combination, repeatedly, from both the list and detail screens):

```prisma
model RawExtraction {
  id            Int      @id @default(autoincrement())
  imageFilename String
  categoryKey   String
  weekNumber    Int
  rawJson       String
  confidence    Float
  status        String   @default("pending")
  createdAt     DateTime @default(now())

  @@index([categoryKey, weekNumber, status])
}
```

Add two new models (place them near `RawExtraction`):

```prisma
// Tracks the "hold for balance review" state for one category+week's ranking_list import,
// for a category whose verificationMode isn't "off" (see Category.verificationMode above).
// One row per (categoryKey, weekNumber) that's currently pending or has been committed
// through this flow - never created at all for a verificationMode "off" category, which
// keeps committing immediately exactly as before this feature existed.
model ImportBatch {
  id                   Int       @id @default(autoincrement())
  categoryKey          String
  weekNumber           Int
  status               String    @default("pending") // "pending" | "committed"
  varianceAcknowledged Boolean   @default(false)
  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @updatedAt
  committedAt          DateTime?

  manualEntries ImportBatchManualEntry[]

  @@unique([categoryKey, weekNumber])
}

// A member added by hand from the Verify screen's "Add missing" step, rather than
// extracted from a screenshot - kept separate from RawExtraction (which is always "what
// the AI actually read off an image") so a manual entry's origin stays visible, and one
// can be individually deleted/undone without touching any real screenshot's data.
model ImportBatchManualEntry {
  id            Int         @id @default(autoincrement())
  importBatchId Int
  importBatch   ImportBatch @relation(fields: [importBatchId], references: [id])
  team          String?     // the screenshot's "winner" label - rank_multi_team mode only
  memberName    String
  rank          Int?        // rank_single / rank_multi_team modes
  value         Float?      // per_member mode - the score itself
  createdAt     DateTime    @default(now())
}
```

Run `npx prisma db push && npx prisma generate` (no migrations folder in this project).

## Change 2 — teach the AI to read the "winner" label, and add the admin setting

### `lib/ai/prompts.ts` — extract a screenshot-level "winner" field

Add `winner` as a selectable/storable field for `ranking_list` categories, right next to the
existing `event_date` entry in `SHAPE_FIELDS`:

```ts
  ranking_list: [
    { key: "rank", label: "Rank", numeric: false },
    { key: "member_name", label: "Member name", numeric: false },
    { key: "value", label: "Value", numeric: true },
    { key: "alliance_rank", label: "Alliance rank (R1-R5)", numeric: false },
    { key: "event_date", label: "Event date (if printed on the screenshot)", numeric: false },
    {
      key: "winner",
      label: "Team/winner label (if printed at the top of the screenshot - used to group multi-screenshot team results, e.g. Desert Storm)",
      numeric: false,
    },
  ],
```

Add `winner` to `RANKING_LIST_SCHEMA`, alongside the existing `event_date` property:

```ts
const RANKING_LIST_SCHEMA = {
  type: "object",
  properties: {
    event_date: {
      type: "string",
      description:
        "Event date/timestamp printed on the screenshot, if there is one (e.g. near the bottom of a battle report). Omit if there is none.",
    },
    winner: {
      type: "string",
      description:
        "A team or winner name/label printed at the TOP of this screenshot, if there is one (e.g. an event result screen showing which of two teams the ranking below belongs to). This is NOT the same as alliance_tag - it's a label for the whole screenshot, not something attached to any individual row. Omit entirely if no such label is visible.",
    },
    rows: {
      // ...unchanged...
```

Add one sentence to `buildExtractionPrompt()`'s non-`free_text` branch, right after the
existing sentence about `alliance_tag` (in the paragraph starting "Member names are
sometimes prefixed..."):

```
If a team or winner name is printed at the top of the screenshot itself (separate from any individual row), report it in "winner" - this is used to group several screenshots of the same team's results together, not treated as a per-row value.
```

### `lib/ai/extract.ts` — add `winner`, relax `RankingRow.rank` to optional

```ts
export type RankingRow = {
  rank?: number;
  member_name: string;
  value: number;
  alliance_rank?: string;
  alliance_tag?: string;
  winner?: string;
};

export type RankingListResult = { event_date?: string; winner?: string; rows: RankingRow[] };
```

`rank` is optional because `per_member` mode has no rank at all (just a score), and the
merge-and-commit step (Change 5) reuses the exact same `writeExtraction()` write path for
every mode. This only loosens the TypeScript type used internally for merging/writing —
Gemini's own extraction schema above still always reports a rank when it reads one, this
doesn't relax what the AI is asked to find.

The per-row `winner` is new and is *only* ever set by `commitBatch()` (Change 5) when it
reconstructs a merged multi-team batch for writing — a real screenshot never reports it
per-row, only once at the screenshot level (the `winner` on `RankingListResult` above). The
reason a row-level override is needed at all: one verified batch can contain screenshots
from *both* teams (that's the whole point of `rank_multi_team` grouping), so a single commit
call has rows that belong to different teams. `writeExtraction()`'s `ranking_list` branch
(below) checks `row.winner ?? winner` per row, so the ordinary single-screenshot pipeline
path (which only ever sets the top-level `winner`) is unaffected, while the batch-commit
path can give each row its own team.

### `lib/pipeline/run.ts` — persist `winner` the same way `event_date` already is

In `writeExtraction()`'s existing `ranking_list` branch, the per-row `fields` object passed
to `writeCategoryRow()` already includes `event_date` (a screenshot-level value repeated
onto every row from that screenshot). Add `winner` the same way:

```ts
  if (category.shape === "ranking_list") {
    const { rows, event_date, winner } = extracted as RankingListResult;
    for (const row of rows) {
      const memberId = await matchMember(row.member_name);
      if (row.alliance_rank) await recordAllianceRank(memberId, weekNumber, row.alliance_rank);
      const rowWinner = row.winner ?? winner; // per-row override - see the extract.ts note above
      await writeCategoryRow(
        category,
        memberId,
        weekNumber,
        { rank: row.rank, member_name: row.member_name, value: row.value, alliance_rank: row.alliance_rank, event_date, winner: rowWinner },
        row.rank
      );
    }
    return;
  }
```

This is what makes "winner needs to be stored" actually happen: `writeCategoryRow()`
already only persists whichever field keys are in `category.storedFields` (see
`storedSubset` in that function) — so ticking "Team/winner label" in Desert Storm's "Fields
to store" list in Setup → Categories is what makes it show up on committed records. Nothing
new needed in `writeCategoryRow()` itself, it already generalizes over whatever's in
`storedFields`.

### `lib/categories/validate.ts`

Add to `CategoryInput`:

```ts
export type CategoryInput = {
  // ...existing fields...
  verificationMode?: string;
};
```

Add validation (after the `conductorMode`/`conductorFlatValue` checks, before the closing
`return errors;`):

```ts
  const VERIFICATION_MODES = ["off", "rank_single", "rank_multi_team", "per_member"];
  if (input.verificationMode !== undefined && !VERIFICATION_MODES.includes(input.verificationMode)) {
    errors.push({ field: "verificationMode", message: `Verification mode must be one of: ${VERIFICATION_MODES.join(", ")}.` });
  }
  if (isFreeText && input.verificationMode && input.verificationMode !== "off") {
    errors.push({ field: "verificationMode", message: "Free-text categories already always hold for review - verification mode doesn't apply." });
  }
  // Roster shape (e.g. HQ) has no ranks to check, so only the shapeless per_member mode
  // makes sense for it - rank_single/rank_multi_team stay ranking_list-only.
  if (input.shape === "roster" && input.verificationMode && !["off", "per_member"].includes(input.verificationMode)) {
    errors.push({ field: "verificationMode", message: "Roster categories only support 'per_member' verification (no ranks to check)." });
  }
```

### `app/api/categories/[id]/route.ts`

Add `verificationMode` to the `merged` object (alongside the other passthrough fields):

```ts
  const merged: CategoryInput = {
    // ...existing fields...
    verificationMode: patch.verificationMode ?? existing.verificationMode,
  };
```

Add it to the `prisma.category.update({ data: { ... } })` call:

```ts
      conductorFlatValue: conductorMode === "flat" ? (merged.conductorFlatValue ?? null) : null,
      verificationMode: isFreeText
        ? "off"
        : merged.shape === "roster" && merged.verificationMode !== "per_member"
          ? "off"
          : (merged.verificationMode ?? "off"),
```

(`free_text` never gets verification — it already always holds for review a different way.
`roster` only ever gets `"off"` or `"per_member"` — `validateCategoryInput` above already
rejects the other two modes for it, this is just the same rule applied defensively at write
time too.)

### `app/api/categories/route.ts` (the POST/create handler)

Add the same field to `prisma.category.create({ data: { ... } })`:

```ts
      verificationMode:
        body.shape === "free_text"
          ? "off"
          : body.shape === "roster" && body.verificationMode !== "per_member"
            ? "off"
            : (body.verificationMode ?? "off"),
```

(`GET`'s `serialize()` already spreads every column through, so the field reaches the
client automatically — no change needed there.)

### `components/CategoryForm.tsx`

Add to the `Category` type:

```ts
export type Category = {
  // ...existing fields...
  verificationMode: string;
};
```

Add to `FormState`:

```ts
type FormState = {
  // ...existing fields...
  verificationMode: "off" | "rank_single" | "rank_multi_team" | "per_member";
};
```

Add the default in `emptyForm()` and `formFromCategory()`:

```ts
    verificationMode: "off",
```
```ts
    verificationMode: (["off", "rank_single", "rank_multi_team", "per_member"].includes(cat.verificationMode)
      ? cat.verificationMode
      : "off") as FormState["verificationMode"],
```

Add it to the save payload in `handleSave()`:

```ts
      verificationMode: isFreeText ? "off" : form.verificationMode,
```

Add the UI control. `rank_single`/`rank_multi_team` only make sense for `ranking_list`
(HQ/roster has no ranks) — this block is shared across both shapes, so place it just
*outside* the `form.shape !== "free_text"` branch entirely (right after that branch's
closing `</>`/`)` and before the "Fields to store" block), so it's visible for both
`ranking_list` and `roster`, hidden only for `free_text`:

```tsx
      {form.shape !== "free_text" && (
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium">Verification before commit</label>
          <select
            value={form.verificationMode}
            onChange={(e) => setForm((f) => ({ ...f, verificationMode: e.target.value as FormState["verificationMode"] }))}
            className="border border-neutral-300 rounded px-3 py-2"
          >
            <option value="off">Off - commit immediately, as today</option>
            {form.shape === "ranking_list" && (
              <>
                <option value="rank_single">One continuous ranking (e.g. Alliance Exercise)</option>
                <option value="rank_multi_team">Multiple teams in one ranking (e.g. Desert Storm)</option>
              </>
            )}
            <option value="per_member">Every roster member should have a value (e.g. Kills, VS, Donations, HQ)</option>
          </select>
          {form.verificationMode !== "off" && (
            <p className="text-neutral-500 text-xs bg-blue-50 border border-blue-200 rounded px-3 py-2">
              Every import for this category is held at Verify until the member count
              balances (or you commit it as-is) - nothing writes to the database
              automatically anymore.
            </p>
          )}
        </div>
      )}
```

One more piece for `handleSave()`'s save payload — switching shape away from `ranking_list`
(e.g. someone changes a category from Ranking to Roster) needs to drop an now-invalid
`rank_single`/`rank_multi_team` selection rather than send it and get a validation error:

```ts
      verificationMode: isFreeText
        ? "off"
        : form.shape === "roster" && form.verificationMode !== "per_member"
          ? "off"
          : form.verificationMode,
```

(Replaces the single line `verificationMode: isFreeText ? "off" : form.verificationMode,`
from the payload shown earlier in this change.)

## Change 3 — validation logic: new `lib/verify/validate.ts`

```ts
import { prisma } from "@/lib/db";
import { getRosterMemberIdsForWeeks } from "@/lib/reports/activeMembers";

// The full per-member field bag straight from the screenshot's raw JSON (whatever keys
// that shape happens to have - alliance_rank/alliance_tag for ranking_list, level/status/
// last_active/alliance_rank for roster). Carried through unchanged so commitBatch() (Change
// 5) can reconstruct a full-fidelity write instead of only ever having a bare number - a
// manually-added entry has none of these (a human only ever supplies a name + a value, and
// team for multi-team mode), which is fine: those fields simply don't get set for that one
// member, exactly as if the row had come from a screenshot that didn't show them either.
export type MergedRow = {
  team: string | null;
  memberName: string;
  rank?: number;
  value: number;
  fields: Record<string, string | number | undefined>;
};

// One screenshot's extraction, already normalized to a common shape by loadMergedRows()
// (Change 5) regardless of whether it came from a ranking_list or roster category - that's
// where the shape-specific JSON parsing happens, not here.
export type ScreenshotGroup = {
  winner?: string; // the screenshot-level "winner"/team label - rank_multi_team mode only, see "Before you build this" #2
  rows: { rank?: number; memberName: string; value: number; fields: Record<string, string | number | undefined> }[];
};

export type TeamBreakdown = { team: string; maxRank: number; memberCount: number };

export type BatchValidation =
  | { mode: "rank_single"; maxRank: number; extractedTotal: number; isBalanced: boolean; variance: number }
  | { mode: "rank_multi_team"; teams: TeamBreakdown[]; extractedTotal: number; isBalanced: boolean; variance: number }
  | { mode: "per_member"; expectedTotal: number; extractedTotal: number; isBalanced: boolean; variance: number };

/**
 * Merges every pending screenshot's rows plus any manually-added entries into one
 * per-member list for this batch. Dedup key is the trimmed, lowercased name - this runs
 * BEFORE commit, so nothing has been fuzzy-matched to a real Member yet (that only happens
 * inside writeExtraction() at commit time). A name appearing more than once (a re-uploaded
 * or corrected screenshot, or a manual entry for a name a screenshot also found) resolves
 * to whichever source was processed last - manual entries are always applied last, so they
 * always win over a screenshot's own reading.
 *
 * Grouping is by SCREENSHOT, not by row: a screenshot's "winner" label (if any) applies to
 * every row it contains, because the winner label is printed once at the top of the image,
 * not per member - see "Before you build this" #2. rank_single/per_member categories never
 * set `winner` on their screenshots, so `team` stays null for every row in those modes,
 * which validateBatch()/the UI already ignore outside rank_multi_team.
 */
export function mergeRows(
  screenshots: ScreenshotGroup[],
  manualEntries: { team: string | null; memberName: string; rank: number | null; value: number | null }[]
): MergedRow[] {
  const byName = new Map<string, MergedRow>();

  for (const shot of screenshots) {
    const team = shot.winner?.trim() || null;
    for (const r of shot.rows) {
      const key = r.memberName.trim().toLowerCase();
      byName.set(key, { team, memberName: r.memberName, rank: r.rank, value: r.value, fields: r.fields });
    }
  }
  for (const m of manualEntries) {
    const key = m.memberName.trim().toLowerCase();
    byName.set(key, { team: m.team, memberName: m.memberName, rank: m.rank ?? undefined, value: m.value ?? 0, fields: {} });
  }

  return [...byName.values()];
}

export async function validateBatch(
  mode: "rank_single" | "rank_multi_team" | "per_member",
  categoryKey: string,
  weekNumber: number,
  rows: MergedRow[]
): Promise<BatchValidation> {
  if (mode === "rank_single") {
    const ranks = rows.map((r) => r.rank ?? 0);
    const maxRank = ranks.length > 0 ? Math.max(...ranks) : 0;
    const extractedTotal = rows.length;
    return { mode, maxRank, extractedTotal, isBalanced: maxRank === extractedTotal, variance: Math.abs(maxRank - extractedTotal) };
  }

  if (mode === "rank_multi_team") {
    const byTeam = new Map<string, MergedRow[]>();
    for (const r of rows) {
      const team = r.team ?? "Unlabeled";
      if (!byTeam.has(team)) byTeam.set(team, []);
      byTeam.get(team)!.push(r);
    }
    const teams: TeamBreakdown[] = [...byTeam.entries()].map(([team, teamRows]) => ({
      team,
      maxRank: Math.max(...teamRows.map((r) => r.rank ?? 0)),
      memberCount: teamRows.length,
    }));
    const expectedTotal = teams.reduce((sum, t) => sum + t.maxRank, 0);
    const extractedTotal = rows.length;
    return { mode, teams, extractedTotal, isBalanced: expectedTotal === extractedTotal, variance: Math.abs(expectedTotal - extractedTotal) };
  }

  // per_member: expected = current roster size, unless it's more than 10% below what
  // actually had a value last week for this category - in which case last week's actual
  // count is used instead, on the theory that a sudden apparent roster shrink is more
  // likely stale/incomplete roster data than 10%+ of the alliance genuinely vanishing in
  // one week. See "Before you build this" #3 for the exact rule this implements.
  const [rosterIds, priorWeekStats] = await Promise.all([
    getRosterMemberIdsForWeeks(weekNumber),
    prisma.weeklyStat.findMany({ where: { categoryKey, weekNumber: weekNumber - 1 }, select: { memberId: true }, distinct: ["memberId"] }),
  ]);
  const currentRosterCount = rosterIds.size;
  const priorWeekCount = priorWeekStats.length;
  const expectedTotal = priorWeekCount > 0 && currentRosterCount < priorWeekCount * 0.9 ? priorWeekCount : currentRosterCount;

  const extractedTotal = rows.filter((r) => r.value !== undefined && r.value !== null).length;
  return {
    mode,
    expectedTotal,
    extractedTotal,
    isBalanced: extractedTotal >= expectedTotal,
    variance: Math.max(0, expectedTotal - extractedTotal),
  };
}
```

## Change 4 — pipeline: hold instead of commit, in `lib/pipeline/run.ts`

This hooks into `runPipelineForImage` as it exists in the live codebase today — see "Before
you build this" #8 if the video-upload spec has been built in the meantime, in which case
this logic moves to `commitCategoryResult`/`runPipelineForVideoSegment` instead, unchanged.

Export `writeExtraction` (drop the leading nothing → add `export`, it's currently a private
function referenced only from within this file — the new commit step in Change 5 needs to
call it):

```ts
export async function writeExtraction(
```

In `runPipelineForImage`, add a branch right after the category-lookup check (the
`if (!category || !category.active) { ... }` block) and before the existing
`try { const extracted = await extract(...); ... }` block starts writing. Both `ranking_list`
and `roster` shapes can carry `per_member` verification (HQ is `roster`-shaped — see "Before
you build this" #3), so the condition checks `verificationMode` alone, not the shape:

```ts
  const category = await prisma.category.findUnique({ where: { key: categoryKey } });
  if (!category || !category.active) {
    await createNeedsReview(params.filename, categoryKey, params.weekNumber, confidence);
    return { filename: params.filename, categoryKey, confidence, status: "needs_review" };
  }

  if (category.verificationMode !== "off") {
    try {
      const extracted = await extract(category, imageBase64, params.mimeType);
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
        update: {},
        create: { categoryKey, weekNumber: params.weekNumber },
      });
      return { filename: params.filename, categoryKey, confidence, status: "pending_verification" };
    } catch (err) {
      await createNeedsReview(params.filename, categoryKey, params.weekNumber, confidence);
      return { filename: params.filename, categoryKey, confidence, status: "error", message: describeError(err) };
    }
  }

  try {
    const extracted = await extract(category, imageBase64, params.mimeType);
    // ...unchanged from here down (free_text branch, then the existing commit path)...
```

`free_text` categories can't have `verificationMode` set to anything but `"off"`
(`validateCategoryInput` in Change 2 rejects that), so this new branch never fires for
Squads — it stays on its existing `pending_confirmation` path untouched.

Add `"pending_verification"` to `PipelineStatus` near the top of the file:

```ts
export type PipelineStatus = "committed" | "needs_review" | "pending_confirmation" | "pending_verification" | "error";
```

## Change 5 — new `lib/verify/service.ts`: list, detail, add/remove, commit

The one shape-specific piece in this whole feature lives entirely in this file: `loadMergedRows()`
(parsing a raw screenshot's JSON into the common `ScreenshotGroup` shape `validate.ts` expects)
and the write-payload half of `commitBatch()` (going the other direction — a common `MergedRow[]`
back into whatever `writeExtraction()` needs for this category's actual shape). Everything
between those two edges (`mergeRows`, `validateBatch`, the API routes, the UI) never has to know
whether it's looking at Kills or HQ.

```ts
import { prisma } from "@/lib/db";
import { writeExtraction } from "@/lib/pipeline/run";
import type { RankingListResult, RosterResult } from "@/lib/ai/extract";
import type { Category } from "@/lib/generated/prisma/client";
import { mergeRows, validateBatch, type MergedRow, type ScreenshotGroup, type BatchValidation } from "./validate";

export type BatchSummary = {
  categoryKey: string;
  categoryName: string;
  weekNumber: number;
  validation: BatchValidation;
};

export async function listPendingBatches(): Promise<BatchSummary[]> {
  const batches = await prisma.importBatch.findMany({ where: { status: "pending" }, include: { manualEntries: true } });
  const categories = await prisma.category.findMany({ where: { key: { in: batches.map((b) => b.categoryKey) } } });
  const categoryByKey = new Map(categories.map((c) => [c.key, c]));

  const summaries: BatchSummary[] = [];
  for (const batch of batches) {
    const category = categoryByKey.get(batch.categoryKey);
    if (!category || category.verificationMode === "off") continue; // config changed after this batch was created

    const rows = await loadMergedRows(category, batch.weekNumber, batch.manualEntries);
    const validation = await validateBatch(
      category.verificationMode as "rank_single" | "rank_multi_team" | "per_member",
      batch.categoryKey,
      batch.weekNumber,
      rows
    );
    summaries.push({ categoryKey: batch.categoryKey, categoryName: category.name, weekNumber: batch.weekNumber, validation });
  }
  return summaries;
}

export type BatchDetail = BatchSummary & { rows: MergedRow[]; manualEntries: { id: number; team: string | null; memberName: string; rank: number | null; value: number | null }[] };

export async function getBatchDetail(categoryKey: string, weekNumber: number): Promise<BatchDetail | null> {
  const category = await prisma.category.findUnique({ where: { key: categoryKey } });
  if (!category || category.verificationMode === "off") return null;

  const batch = await prisma.importBatch.findUnique({ where: { categoryKey_weekNumber: { categoryKey, weekNumber } }, include: { manualEntries: true } });
  if (!batch) return null;

  const rows = await loadMergedRows(category, weekNumber, batch.manualEntries);
  const validation = await validateBatch(category.verificationMode as "rank_single" | "rank_multi_team" | "per_member", categoryKey, weekNumber, rows);

  return {
    categoryKey,
    categoryName: category.name,
    weekNumber,
    validation,
    rows,
    manualEntries: batch.manualEntries.map((e) => ({ id: e.id, team: e.team, memberName: e.memberName, rank: e.rank, value: e.value })),
  };
}

// Turns this category's pending RawExtraction rows into the shape-agnostic ScreenshotGroup[]
// that mergeRows() (validate.ts) expects. This is the only place that has to know a
// ranking_list screenshot's JSON looks like { event_date?, winner?, rows: [...] } while a
// roster (HQ) screenshot's looks like { members: [...] } with no ranks and no winner label at
// all - everything downstream of mergeRows() only ever sees the common shape.
async function loadMergedRows(
  category: Category,
  weekNumber: number,
  manualEntries: { team: string | null; memberName: string; rank: number | null; value: number | null }[]
): Promise<MergedRow[]> {
  const extractions = await prisma.rawExtraction.findMany({
    where: { categoryKey: category.key, weekNumber, status: "pending_verification" },
  });

  const screenshots: ScreenshotGroup[] = extractions.map((ex) => {
    if (category.shape === "roster") {
      const parsed = JSON.parse(ex.rawJson) as RosterResult;
      return {
        // roster screenshots never carry a "winner" label - per_member is the only mode
        // roster supports (see "Before you build this" #3), and per_member ignores team.
        rows: (parsed.members ?? []).map((m) => {
          const fields = m as unknown as Record<string, string | number | undefined>;
          return { memberName: m.name, value: Number(fields[category.valueField]), fields };
        }),
      };
    }

    // ranking_list (Kills/VS/Donations/Desert Storm/Canyon Storm/Alliance Exercise/Power)
    const parsed = JSON.parse(ex.rawJson) as RankingListResult;
    return {
      winner: parsed.winner,
      rows: (parsed.rows ?? []).map((r) => ({
        rank: r.rank,
        memberName: r.member_name,
        value: r.value,
        fields: r as unknown as Record<string, string | number | undefined>,
      })),
    };
  });

  return mergeRows(screenshots, manualEntries);
}

export async function addManualEntry(
  categoryKey: string,
  weekNumber: number,
  entry: { team: string | null; memberName: string; rank: number | null; value: number | null }
): Promise<void> {
  const batch = await prisma.importBatch.upsert({
    where: { categoryKey_weekNumber: { categoryKey, weekNumber } },
    update: {},
    create: { categoryKey, weekNumber },
  });
  await prisma.importBatchManualEntry.create({ data: { importBatchId: batch.id, ...entry } });
}

export async function deleteManualEntry(entryId: number): Promise<void> {
  await prisma.importBatchManualEntry.delete({ where: { id: entryId } });
}

/**
 * Commits a whole batch: merges every pending screenshot + manual entry (same merge the
 * summary/detail screens already showed), reconstructs a full extraction payload in
 * whichever shape this category actually is, writes it through the exact same
 * writeExtraction() every other category shape already uses, then marks the batch and its
 * screenshots committed. Refuses a variance commit unless acknowledgeVariance is explicitly
 * true - this is the server-side backstop for the UI's "Commit As-Is" button, not just a
 * client check.
 */
export async function commitBatch(categoryKey: string, weekNumber: number, acknowledgeVariance: boolean): Promise<void> {
  const category = await prisma.category.findUniqueOrThrow({ where: { key: categoryKey } });
  const batch = await prisma.importBatch.findUnique({ where: { categoryKey_weekNumber: { categoryKey, weekNumber } }, include: { manualEntries: true } });
  if (!batch || batch.status !== "pending") throw new Error("No pending batch found for this category/week.");

  const rows = await loadMergedRows(category, weekNumber, batch.manualEntries);
  const validation = await validateBatch(category.verificationMode as "rank_single" | "rank_multi_team" | "per_member", categoryKey, weekNumber, rows);

  if (!validation.isBalanced && !acknowledgeVariance) {
    throw new Error(`This batch has a variance of ${validation.variance} - pass acknowledgeVariance to commit anyway.`);
  }

  const extracted: RankingListResult | RosterResult =
    category.shape === "roster"
      ? {
          members: rows.map((r) => ({
            name: r.memberName,
            level: (r.fields.level as number | undefined) ?? (category.valueField === "level" ? r.value : undefined),
            status: r.fields.status as string | undefined,
            last_active: r.fields.last_active as string | undefined,
            alliance_rank: r.fields.alliance_rank as string | undefined,
          })),
        }
      : {
          // no event_date - see "Before you build this" #9. winner goes per-row, not at the
          // top level, because one multi-team batch's rows can belong to either team.
          rows: rows.map((r) => ({
            rank: r.rank,
            member_name: r.memberName,
            value: r.value,
            alliance_rank: r.fields.alliance_rank as string | undefined,
            alliance_tag: r.fields.alliance_tag as string | undefined,
            winner: r.team ?? undefined,
          })),
        };

  await writeExtraction(category, extracted, weekNumber);

  await prisma.$transaction([
    prisma.rawExtraction.updateMany({ where: { categoryKey, weekNumber, status: "pending_verification" }, data: { status: "committed" } }),
    prisma.importBatch.update({
      where: { id: batch.id },
      data: { status: "committed", committedAt: new Date(), varianceAcknowledged: !validation.isBalanced && acknowledgeVariance },
    }),
  ]);
}
```

## Change 6 — API routes

### `app/api/verify/route.ts`

```ts
import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth/dal";
import { listPendingBatches } from "@/lib/verify/service";

export async function GET() {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const batches = await listPendingBatches();
  return NextResponse.json({ batches });
}
```

### `app/api/verify/[categoryKey]/[weekNumber]/route.ts`

```ts
import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth/dal";
import { getBatchDetail, addManualEntry } from "@/lib/verify/service";

export async function GET(_request: Request, ctx: RouteContext<"/api/verify/[categoryKey]/[weekNumber]">) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const { categoryKey, weekNumber } = await ctx.params;
  const detail = await getBatchDetail(categoryKey, Number(weekNumber));
  if (!detail) return NextResponse.json({ error: "Batch not found." }, { status: 404 });
  return NextResponse.json({ batch: detail });
}

export async function POST(request: Request, ctx: RouteContext<"/api/verify/[categoryKey]/[weekNumber]">) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const { categoryKey, weekNumber } = await ctx.params;
  const body = (await request.json()) as { team?: string | null; memberName?: string; rank?: number | null; value?: number | null };
  if (!body.memberName) return NextResponse.json({ error: "memberName is required." }, { status: 400 });

  await addManualEntry(categoryKey, Number(weekNumber), {
    team: body.team ?? null,
    memberName: body.memberName,
    rank: body.rank ?? null,
    value: body.value ?? null,
  });
  return NextResponse.json({ ok: true });
}
```

### `app/api/verify/[categoryKey]/[weekNumber]/commit/route.ts`

```ts
import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth/dal";
import { commitBatch } from "@/lib/verify/service";

export async function POST(request: Request, ctx: RouteContext<"/api/verify/[categoryKey]/[weekNumber]/commit">) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const { categoryKey, weekNumber } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as { acknowledgeVariance?: boolean };

  try {
    await commitBatch(categoryKey, Number(weekNumber), body.acknowledgeVariance ?? false);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
```

### `app/api/verify/entries/[entryId]/route.ts`

```ts
import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth/dal";
import { deleteManualEntry } from "@/lib/verify/service";

export async function DELETE(_request: Request, ctx: RouteContext<"/api/verify/entries/[entryId]">) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const { entryId } = await ctx.params;
  await deleteManualEntry(Number(entryId));
  return NextResponse.json({ ok: true });
}
```

## Change 7 — UI: `/verify` list page

### `app/verify/page.tsx`

```tsx
import { VerifyClient } from "./VerifyClient";

export default function VerifyPage() {
  return <VerifyClient />;
}
```

### `app/verify/VerifyClient.tsx`

```tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type BatchValidation =
  | { mode: "rank_single"; maxRank: number; extractedTotal: number; isBalanced: boolean; variance: number }
  | { mode: "rank_multi_team"; teams: { team: string; maxRank: number; memberCount: number }[]; extractedTotal: number; isBalanced: boolean; variance: number }
  | { mode: "per_member"; expectedTotal: number; extractedTotal: number; isBalanced: boolean; variance: number };

type BatchSummary = { categoryKey: string; categoryName: string; weekNumber: number; validation: BatchValidation };

export function VerifyClient() {
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/verify")
      .then((res) => res.json())
      .then((data) => setBatches(data.batches ?? []))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex flex-col gap-4 max-w-xl">
      <h1 className="text-xl font-semibold">Verify Imports</h1>

      {loading ? (
        <p className="text-neutral-500 text-sm">Loading…</p>
      ) : batches.length === 0 ? (
        <p className="text-neutral-500 text-sm">Nothing waiting for verification.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {batches.map((b) => (
            <li key={`${b.categoryKey}:${b.weekNumber}`}>
              <Link
                href={`/verify/${b.categoryKey}/${b.weekNumber}`}
                className="border border-neutral-200 rounded p-4 flex items-center justify-between gap-3 hover:bg-neutral-50"
              >
                <div>
                  <div className="font-medium">
                    {b.categoryName} — Week {b.weekNumber}
                  </div>
                  <div className="text-neutral-500 text-sm">{b.validation.extractedTotal} members extracted</div>
                </div>
                <span
                  className={`px-2 py-1 rounded text-xs font-medium whitespace-nowrap ${
                    b.validation.isBalanced ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"
                  }`}
                >
                  {b.validation.isBalanced ? "✓ Balanced" : `⚠ Variance (${b.validation.variance})`}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

## Change 8 — UI: batch detail page (summary → details → edit)

### `app/verify/[categoryKey]/[weekNumber]/page.tsx`

```tsx
import { VerifyDetailClient } from "./VerifyDetailClient";

export default async function VerifyDetailPage({ params }: PageProps<"/verify/[categoryKey]/[weekNumber]">) {
  const { categoryKey, weekNumber } = await params;
  return <VerifyDetailClient categoryKey={categoryKey} weekNumber={Number(weekNumber)} />;
}
```

### `app/verify/[categoryKey]/[weekNumber]/VerifyDetailClient.tsx`

Mobile-first per your spec: the summary is the default view, "View details" expands the
full table, editing happens in an inline panel (a full modal overlay is unnecessary added
complexity on top of what the balance-check logic already needs — a collapsible section
does the same job on a small screen without a second navigation layer).

No structural change needed here for roster/HQ support — this component was already written
generically over `validation.mode`, not category shape, and `per_member` is the only mode
`roster` ever uses (see "Before you build this" #3), so the existing `v.mode !== "per_member"`
checks already hide the Rank column and the "Team" column already only shows for
`rank_multi_team` (which is `ranking_list`-only — HQ can never reach that mode). The local
`MergedRow` type below is a client-side copy of the one in `lib/verify/validate.ts`
(unavoidable — this is a client component and can't import server code) and deliberately
leaves out the new `fields` bag from Change 3, since this UI never needs to render it.

```tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type MergedRow = { team: string | null; memberName: string; rank?: number; value: number };
type ManualEntry = { id: number; team: string | null; memberName: string; rank: number | null; value: number | null };
type BatchValidation =
  | { mode: "rank_single"; maxRank: number; extractedTotal: number; isBalanced: boolean; variance: number }
  | { mode: "rank_multi_team"; teams: { team: string; maxRank: number; memberCount: number }[]; extractedTotal: number; isBalanced: boolean; variance: number }
  | { mode: "per_member"; expectedTotal: number; extractedTotal: number; isBalanced: boolean; variance: number };
type BatchDetail = { categoryKey: string; categoryName: string; weekNumber: number; validation: BatchValidation; rows: MergedRow[]; manualEntries: ManualEntry[] };

export function VerifyDetailClient({ categoryKey, weekNumber }: { categoryKey: string; weekNumber: number }) {
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

  async function load() {
    setLoading(true);
    const res = await fetch(`/api/verify/${categoryKey}/${weekNumber}`);
    if (res.ok) setBatch((await res.json()).batch);
    setLoading(false);
  }

  useEffect(() => {
    load();
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
      window.location.href = "/verify";
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
```

## Change 9 — Import page tie-in: `app/upload/UploadClient.tsx`

Add the new outcome to the existing status union/maps (already extended once this session
for the video-upload work — `"expanded"` is already there if that spec landed first; if
not, just add `"pending_verification"` the same way):

```ts
type ResultStatus = "committed" | "needs_review" | "pending_confirmation" | "error" | "pending_verification";
```

```ts
const STATUS_STYLES: Record<ResultStatus, string> = {
  committed: "bg-green-100 text-green-800",
  needs_review: "bg-amber-100 text-amber-800",
  pending_confirmation: "bg-blue-100 text-blue-800",
  error: "bg-red-100 text-red-800",
  pending_verification: "bg-blue-100 text-blue-800",
};

const STATUS_LABELS: Record<ResultStatus, string> = {
  committed: "committed",
  needs_review: "needs review — see Review",
  pending_confirmation: "needs your confirmation — see Review",
  error: "error — see Review",
  pending_verification: "held for verification — see Verify",
};
```

The results list already links `needs_review`/`pending_confirmation`/`error` items to
`/review` — add `pending_verification` to that same link condition, but point it at the
specific batch instead of a generic list page:

```tsx
                {r.resultStatus &&
                  (r.resultStatus === "pending_confirmation" || r.resultStatus === "needs_review" || r.resultStatus === "error" ? (
                    <Link
                      href="/review"
                      className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLES[r.resultStatus]} hover:underline`}
                    >
                      {STATUS_LABELS[r.resultStatus]}
                    </Link>
                  ) : r.resultStatus === "pending_verification" ? (
                    <Link
                      href={`/verify/${r.categoryKey}/${weekNumber}`}
                      className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLES[r.resultStatus]} hover:underline`}
                    >
                      {STATUS_LABELS[r.resultStatus]}
                    </Link>
                  ) : (
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLES[r.resultStatus]}`}>
                      {STATUS_LABELS[r.resultStatus]}
                    </span>
                  ))}
```

(`weekNumber` is already in scope in this component — it's the same state variable the
submit form uses.)

## Change 10 — menu item: `prisma/seed.ts`

Add alongside the existing `uploads-flagged-errors` entry:

```ts
  { key: "uploads-verify-imports", label: "Verify Imports", href: "/verify", roles: ["ADMIN"], parentKey: "home-uploads" },
```

## Bump the version

`lib/version.ts`:

```ts
const MINOR = 33; // or 34 - see the note at the top of this spec
```

## Test

1. `npx prisma db push && npx prisma generate`, then deploy. Confirm the header version.
2. Setup → Categories → edit Desert Storm → set "Verification before commit" to "Multiple
   teams in one ranking" → Save.
3. Import a Desert Storm screenshot for a test week. Confirm the Import page shows "held
   for verification — see Verify" instead of "committed" — and confirm nothing shows up yet
   in any report/dashboard for that member/week (this is the core behavior change: nothing
   writes until you commit).
4. Open Verify — confirm the batch shows up with the right extracted-vs-expected numbers.
5. Import a second Desert Storm screenshot for the same week that shows the SAME winner
   label as the first one (a different rank range, e.g. ranks 16-30 of the same team) —
   reload the batch, confirm both screenshots' members merge into that one team's rows, not
   two separate teams.
6. Import a third Desert Storm screenshot for the same week with a DIFFERENT winner label
   (the other team) — confirm the batch now shows two teams in the breakdown, each with
   their own max-rank/member-count, and that the "Team" column in "View details" correctly
   shows which team each member belongs to.
7. Deliberately leave out a rank to create a variance — confirm "Commit" is replaced by
   "Edit missing" + "Commit as-is", and that the missing-count matches what you'd expect.
8. Use "Edit missing" to add the missing member by hand (type the right team into the Team
   field so they land on the correct side) — confirm the summary re-balances, confirm
   "Commit" (not "Commit as-is") is now available.
9. Commit it — confirm the data now shows up correctly in reports/dashboards, that each
   member's row carries the right team in whichever field you ticked "Team/winner label" for
   in Desert Storm's "Fields to store" (Setup → Categories), and that the batch disappears
   from the Verify list.
10. Repeat once more and use "Commit as-is" instead — confirm it still writes the data
    despite the variance.
11. Setup → Categories → edit HQ → confirm the shape is "Roster" and the verification
    dropdown only offers "Off" and "Every roster member should have a value" (no ranking
    options) → set it to the per_member option → Save.
12. Import an HQ screenshot for a test week. Confirm it's held for verification the same way
    as Desert Storm was, and that the expected-count shown matches the current+prior-week
    roster size (not filtered to HQ specifically — see "Before you build this" #4).
13. Commit the HQ batch — confirm member HQ levels show up correctly, and spot-check that a
    member whose screenshot row had an alliance-rank badge still got their `Member.allianceRank`
    updated (this is the fidelity check for the `fields` bag added in Change 3 — it's easy to
    accidentally lose this when reconstructing the write payload).
14. Turn on `per_member` verification for Kills (a `ranking_list` category) and repeat a
    basic import/commit cycle for it too, confirming a plain per-member category (no teams,
    no ranks) behaves correctly alongside the roster and multi-team cases above.
15. Confirm a category still on "Off" (e.g. Power, or any category you haven't turned this
    on for) still commits immediately exactly like before this spec.
