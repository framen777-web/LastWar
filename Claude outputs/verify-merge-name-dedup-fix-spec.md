# Verify batch over-counting fix — merge dedup by real identity, not raw OCR text

## Bug (as reported)

On the Verify page, a batch sometimes shows a much higher "extracted"
count than the real number of people in it — e.g. "20" extracted against
an expected/max-rank of 10. Confirmed this isn't about `cancelBatch()`
leaving anything behind: that function (`lib/verify/service.ts` lines
216-226) correctly marks every `pending_verification` `RawExtraction` row
for that category+week `"rejected"` and deletes the `ImportBatch` in one
transaction — nothing from a cancelled attempt can resurface later. The
`loadMergedRows()` query (line 76) filters to `status: "pending_verification"`
only, and grep confirms only two places in the whole codebase ever set
that status (the initial write in `lib/pipeline/run.ts`, and the
reopen-a-committed-batch branch) — so a stale row leaking back in isn't
possible either.

## Root cause (confirmed against the live code)

The inflation happens **within a single, otherwise-correct batch**, when
the same real person's name gets extracted with slightly different text
across more than one screenshot for that same category+week (a ranking
list split across two screenshots with overlapping rows, a roster
spanning multiple screenshots, an alliance-tag prefix that OCR picks up
in one crop but not another, stray whitespace, etc.). This is a very
normal thing for a phone-screenshot OCR pipeline to do occasionally — the
bug is that the *merge* step has no tolerance for it at all.

`mergeRows()` and `mergeFreeTextRows()` (`lib/verify/validate.ts`, lines
49-116) are what turn N screenshots' worth of rows into one per-member
list for the Verify screen. Both dedupe using a `Map` keyed on **the raw
extracted text**, trimmed and lowercased — nothing else:

```ts
// mergeRows(), line 58
const key = r.memberName.trim().toLowerCase();
```

```ts
// mergeFreeTextRows(), line 85
const key = r.memberName.trim().toLowerCase();
```

If screenshot A reads a member as `"[RUNE] PlayerOne"` and screenshot B
(of the same person, same week) reads them as `"PlayerOne"` — or with a
trailing space, a different-width space character, whatever OCR
inconsistency — these hash to two *different* map keys, so `mergeRows()`
keeps **both** as separate rows instead of merging them into one. The
real per-member identity resolution the rest of this app already has —
`findMemberId()` in `lib/pipeline/matchMemberCore.ts`, which strips the
alliance tag and fuzzy-matches against the roster's names *and*
`Member.aliases` — only ever runs **after** commit, inside
`writeExtraction()`'s call to `matchMember()`. During review, before
commit, there's no identity resolution at all — just string equality.
That's exactly backwards for a screen whose whole purpose is showing an
accurate count *before* you commit: a batch can display "extracted 20"
during review even though, if you committed it right now, those 20 rows
would already fuzzy-match down to 10 real `Member` rows via
`matchMember()`. `rank_single`'s balance check
(`maxRank === extractedTotal`, `validateBatch()` line 128) makes this
especially visible, since a genuinely correct `maxRank` of 10 next to an
inflated `extractedTotal` of 20 is a stark, confusing mismatch.

`findMemberId()` is already pure and read-only (no DB writes, no
auto-create) and is already reused this way elsewhere — `squadIssues.ts`
and `hqIssues.ts` both call it for exactly this "resolve real identity for
comparison purposes, without committing anything" need. This fix reuses
the same function for the same reason, one step earlier in the pipeline.

## Fix

Make `mergeRows()`/`mergeFreeTextRows()` dedupe by **resolved member
identity** (via `findMemberId()` against the real roster) when a match
exists, falling back to the current raw-text key only for a name that
doesn't match anyone yet (a genuinely brand-new, not-yet-a-`Member`
person) — that fallback case is unchanged from today's behavior, so a
first-time name still merges correctly across screenshots as long as it's
spelled the same way twice, exactly as now.

### 1. `lib/verify/validate.ts`

Add the import (top of file, after line 2):

```ts
import { findMemberId, type MatchableMember } from "@/lib/pipeline/matchMemberCore";
```

Replace `mergeRows()` (lines 49-68) with:

```ts
export function mergeRows(
  screenshots: ScreenshotGroup[],
  manualEntries: { team: string | null; memberName: string; rank: number | null; value: number | null }[],
  members: MatchableMember[]
): MergedRow[] {
  const byKey = new Map<string | number, MergedRow>();

  // Prefer the real, already-proven identity match (same fuzzy/alias-aware matcher
  // writeExtraction() uses at commit time) over raw OCR text equality - two screenshots
  // reading the same person as "[RUNE] PlayerOne" and "PlayerOne" must merge into one row,
  // not silently double the extracted count. Falls back to the raw normalized name only for
  // someone who doesn't match any known Member yet (a genuinely new person, same as today).
  const resolveKey = (rawName: string): string | number => findMemberId(rawName, members) ?? rawName.trim().toLowerCase();

  for (const shot of screenshots) {
    const team = shot.winner?.trim() || null;
    for (const r of shot.rows) {
      const key = resolveKey(r.memberName);
      byKey.set(key, { team, memberName: r.memberName, rank: r.rank, value: r.value, fields: r.fields });
    }
  }
  for (const m of manualEntries) {
    const key = resolveKey(m.memberName);
    byKey.set(key, { team: m.team, memberName: m.memberName, rank: m.rank ?? undefined, value: m.value ?? 0, fields: {} });
  }

  return [...byKey.values()];
}
```

Replace `mergeFreeTextRows()` (lines 77-116) with:

```ts
export function mergeFreeTextRows(
  screenshots: { rows: { memberName: string; fields: Record<string, number | undefined> }[] }[],
  manualEntries: { memberName: string; fields: Record<string, number | undefined> | null }[],
  members: MatchableMember[]
): MergedRow[] {
  const byKey = new Map<string | number, { memberName: string; fields: Record<string, number | undefined> }>();
  const resolveKey = (rawName: string): string | number => findMemberId(rawName, members) ?? rawName.trim().toLowerCase();

  for (const shot of screenshots) {
    for (const r of shot.rows) {
      const key = resolveKey(r.memberName);
      const existing = byKey.get(key)?.fields ?? {};
      const merged = { ...existing };
      for (const [k, v] of Object.entries(r.fields)) {
        if (v !== undefined) merged[k] = v; // only overwrite slots this read actually reported
      }
      byKey.set(key, { memberName: r.memberName, fields: merged });
    }
  }

  for (const m of manualEntries) {
    if (!m.fields) continue;
    const key = resolveKey(m.memberName);
    const existing = byKey.get(key)?.fields ?? {};
    const merged = { ...existing };
    for (const [k, v] of Object.entries(m.fields)) {
      if (v !== undefined) merged[k] = v;
    }
    byKey.set(key, { memberName: m.memberName, fields: merged });
  }

  return [...byKey.values()].map((r) => ({
    team: null,
    memberName: r.memberName,
    value: ["air", "tank", "missile", "fourth"].filter((k) => r.fields[k] !== undefined).length,
    fields: r.fields,
  }));
}
```

(Both functions keep whatever `memberName` text was processed *last* for
display, same as before — only the map key changes. `team`/`fields`/etc.
handling is otherwise untouched.)

### 2. `lib/verify/service.ts` — pass the roster in

`loadMergedRows()` (lines 70-122) needs the member list to resolve
identities against. Add one query at the top of the function and thread
it through both merge calls:

Change:

```ts
async function loadMergedRows(
  category: Category,
  weekNumber: number,
  manualEntries: ManualEntryInput[]
): Promise<MergedRow[]> {
  const extractions = await prisma.rawExtraction.findMany({
    where: { categoryKey: category.key, weekNumber, status: "pending_verification" },
  });
```

to:

```ts
async function loadMergedRows(
  category: Category,
  weekNumber: number,
  manualEntries: ManualEntryInput[]
): Promise<MergedRow[]> {
  const [extractions, members] = await Promise.all([
    prisma.rawExtraction.findMany({
      where: { categoryKey: category.key, weekNumber, status: "pending_verification" },
    }),
    prisma.member.findMany(),
  ]);
```

Then update the two call sites. The free_text branch (line 89-92):

```ts
    return mergeFreeTextRows(
      screenshots,
      manualEntries.map((e) => ({ memberName: e.memberName, fields: e.fields ? JSON.parse(e.fields) : null })),
      members
    );
```

And the ranking_list/roster branch (line 121):

```ts
  return mergeRows(screenshots, manualEntries, members);
```

`members` from `prisma.member.findMany()` already has `id`, `name`, and
`aliases` — matches `MatchableMember` structurally, no cast needed (same
as how `squadIssues.ts`/`hqIssues.ts` already consume it, just without
their `weekNumber - 1` filter since this needs the *whole* roster, not
one week's prior readers).

### 3. Version bump

Bump `lib/version.ts`'s `MINOR` by 1 from whatever it is at deploy time
(`MINOR = 45` as of this write-up).

## What this does and doesn't change

- The Verify screen's displayed member name for a merged row is still
  whichever screenshot (or manual entry) was processed last — unaffected.
- Commit-time behavior (`writeExtraction()` → `matchMember()`) is
  completely unchanged; this only fixes what the *review* screen counts
  and displays before commit.
- A genuinely new person (no `Member` row yet, appearing for the first
  time) still dedupes by raw text exactly as before — if their name is
  misread two different ways across two screenshots, that's a separate,
  much rarer edge case (a brand-new person with zero history to fuzzy-
  match against) and isn't something this fix claims to solve.
- This doesn't touch `cancelBatch()`, `commitBatch()`, or anything else —
  investigated and ruled out as part of diagnosing this.

## Test plan

1. Pick a `per_member` or `rank_single` category with at least one
   already-known `Member`. Upload two screenshots for the same
   category+week where that member's name appears with and without the
   alliance tag prefix (or with a trailing space / different casing) —
   easiest way to force this deliberately is two manual entries with
   slightly different name text for the same real member, via the "Add
   missing" form on the Verify page, if reproducing it with real OCR
   variance isn't convenient.
2. Confirm the Verify page's extracted count reflects one merged row for
   that member, not two.
3. Re-run the original repro: upload, don't commit, use "Cancel batch,"
   then upload a fresh full set of screenshots for the same category and
   week. Confirm the extracted count matches the real number of people,
   even when the fresh screenshots' OCR text varies slightly from however
   the AI happens to read alliance tags/whitespace this time.
4. Confirm a genuinely brand-new member (not yet in the roster) with a
   consistent name spelling across two screenshots for the same
   category+week still merges into one row, same as before this fix.
5. Commit a batch that went through this fix and confirm the written
   `CategoryRecord`/`Member` data is correct — this fix only changes
   review-time counting, so nothing here should differ from today's
   commit behavior.
