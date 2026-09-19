# Spec: Squads (free_text) import verification, per-member merge, and value validation

## Scope

Fixes all four problems with the Squads import (`Category.key = "squads"`, `shape: "free_text"`):

1. No validation of extracted numbers at all.
2. Values from more than one line/message for the same member overwrite each other instead of merging.
3. A member appearing in more than one screenshot for the same week: last-processed screenshot wins, earlier data is lost.
4. Implausible numbers (too low, or a big drop from the member's own history) get written with no flag.

The fix is to stop treating Squads screenshots as isolated one-off confirmations and instead route them through the same `ImportBatch`/`RawExtraction` verification pipeline every other `per_member`-verified category (Kills/VS/Donations/HQ) already uses — extended to understand `free_text`'s multi-field shape, plus a new post-commit review step specific to Squads that catches value-quality problems the existing count-based balance check can't see.

This is scoped to the `squads` category only for now. The old per-screenshot `pending_confirmation` flow (`ReviewClient.tsx`'s "Needs your confirmation" section, `confirmRawExtraction()`) is left in place and keeps working for any other `free_text` category that stays on `verificationMode: "off"`.

---

## Background: why each change is needed (grounded in current code)

- `runPipelineForImage()` (`lib/pipeline/run.ts` line 50) checks `category.verificationMode !== "off"` **before** the free_text-specific branch at line 97. So the moment `squads`'s `verificationMode` is anything other than `"off"`, every screenshot for it already starts landing in `ImportBatch`/`RawExtraction` (status `pending_verification`) instead of the old one-screenshot-at-a-time `pending_confirmation` row. No change needed to `run.ts` itself.
- `lib/verify/validate.ts`'s `mergeRows()` (line 49) merges multiple screenshots' rows by member name, but with `byName.set(key, {...})` — a full replace. Fine for Kills/VS/Donations (one screenshot = one complete number per member); wrong for Squads, where one member's 4 troop values can be split across screenshots read at different times. This is the direct cause of bugs #2 and #3. Needs a field-level merge specifically for `free_text`.
- `validateBatch()`'s `per_member` mode (`validate.ts` line 100) only does aggregate counting (extracted rows vs. expected roster size) — this is the "exact same message... balanced based on count" behavior that must stay unchanged for Squads' main Verify screen.
- Per-member value-quality checks (min floor, drift vs. own last submission, missing-this-week) need to know which *real* `Member` a raw OCR'd name is, before commit — something the existing verification system has never needed (it only matches identity at actual commit time, inside `writeExtraction()`). `lib/pipeline/matchMemberCore.ts` already exports `findMemberId()` — a pure, read-only fuzzy match with no DB writes — which is exactly the tool for this.
- `CategoryForm.tsx` (lines 167–171, and again inside `handleSave()`'s payload) and **both** `app/api/categories/route.ts` (lines 86–91) and `app/api/categories/[id]/route.ts` (lines 81–85) hard-code `verificationMode: "off"` whenever `shape === "free_text"`. This is a landmine: if `squads`'s `verificationMode` is set to `"per_member"` directly in the DB (e.g. via `prisma/seed.ts`), the *very next time* anyone edits that category from Setup → Categories and hits Save — even for an unrelated change like toggling Active — `CategoryForm`'s payload will silently send `verificationMode: "off"` and the PATCH route will honor it, reverting this whole feature. All three of these must be changed together, or the feature will randomly break the first time someone touches the category's settings.
- There's currently no way to correct one field of an already-extracted row anywhere in the Verify system. The only existing "add data by hand" mechanism is `ImportBatchManualEntry` (used today only for a fully-missing member's name + a single `value`), and `mergeRows()` already guarantees manual entries are applied last so they always win over a screenshot's own reading for the same name. This is reused (extended) for the new review page's "edit" action rather than building a new mutation path.

---

## 1. Schema changes (`prisma/schema.prisma`)

### 1a. `ImportBatchManualEntry` — add a `fields` column for free_text manual entries

```prisma
model ImportBatchManualEntry {
  id            Int         @id @default(autoincrement())
  importBatchId Int
  importBatch   ImportBatch @relation(fields: [importBatchId], references: [id])
  team          String?     // the screenshot's "winner" label - rank_multi_team mode only
  memberName    String
  rank          Int?        // rank_single / rank_multi_team modes
  value         Float?      // per_member mode (ranking_list/roster) - the score itself
  fields        String?     // per_member mode (free_text/Squads only) - JSON {air?,tank?,missile?,fourth?}
  createdAt     DateTime    @default(now())
}
```

### 1b. New model: `ImportBatchIssueAck`

Tracks which flagged per-member issues on a Squads review page Frans has explicitly cleared (ticked) without necessarily changing the underlying data (e.g. "confirmed this member really didn't submit"). Editing a value via a manual entry clears its issue implicitly (the issue won't recompute as flagged); this table is only for the "I looked, it's fine as-is" dismissals.

```prisma
// Tracks a manually-dismissed per-member data-quality flag on a pending ImportBatch (see
// lib/verify/squadIssues.ts) - e.g. "this member genuinely didn't submit this week, don't
// keep flagging it". Separate from ImportBatchManualEntry (which supplies/corrects actual
// data) since dismissing a flag and providing data are different actions - a dismissed
// "missing submission" flag has no value to attach. Deleted automatically when its batch is
// cancelled or committed (see cancelBatch()/commitBatch() below).
model ImportBatchIssueAck {
  id            Int         @id @default(autoincrement())
  importBatchId Int
  importBatch   ImportBatch @relation(fields: [importBatchId], references: [id])
  memberName    String
  issueType     String      // "few_squads" | "below_min" | "large_drop" | "missing_submission"
  createdAt     DateTime    @default(now())

  @@unique([importBatchId, memberName, issueType])
}
```

Add the back-relation to `ImportBatch`:

```prisma
model ImportBatch {
  ...
  manualEntries ImportBatchManualEntry[]
  issueAcks     ImportBatchIssueAck[]
  ...
}
```

### 1c. `prisma/seed.ts` — enable verification for `squads`

Change the `squads` entry in `CATEGORIES` (around line 107):

```ts
{
  key: "squads",
  name: "Squads",
  description: "...", // unchanged
  shape: "free_text",
  divisor: 1,
  divisorLabel: null,
  importMode: "single",
  dedupField: null,
  storedFields: FREE_TEXT_FIELDS,
  valueField: "",
  verificationMode: "per_member", // NEW
  sortOrder: 7,
},
```

Check whatever upsert logic seeds `CATEGORIES` (further down in `seed.ts`) actually writes `verificationMode` from this array on an *existing* row — if it currently only sets it on `create` and preserves whatever's in the DB on `update` (mirroring how `roles` is preserved for `MenuItem`), add `verificationMode` to the fields it updates for this one run, since `squads` already exists in every real deployment and defaults to `"off"`.

### 1d. Deploy step

`npx prisma db push` + `npx prisma generate` (no migrations folder in this project — see project memory). Run `npx prisma db seed` (or however `seed.ts` is invoked) afterward to pick up the `squads.verificationMode` change.

---

## 2. Unlock `verificationMode: "per_member"` for `free_text` shape

Three places currently force it to `"off"`; all three need the same change, from "always off for free_text" to "off or per_member for free_text" (mirroring the existing roster rule directly above it):

### 2a. `app/api/categories/route.ts` (POST, lines 86–91)

```ts
verificationMode:
  body.shape === "free_text"
    ? body.verificationMode === "per_member"
      ? "per_member"
      : "off"
    : body.shape === "roster" && body.verificationMode !== "per_member"
      ? "off"
      : (body.verificationMode ?? "off"),
```

### 2b. `app/api/categories/[id]/route.ts` (PATCH, lines 81–85)

Same change, using `merged.shape` / `merged.verificationMode`:

```ts
verificationMode: merged.shape === "free_text"
  ? merged.verificationMode === "per_member"
    ? "per_member"
    : "off"
  : merged.shape === "roster" && merged.verificationMode !== "per_member"
    ? "off"
    : (merged.verificationMode ?? "off"),
```

### 2c. `components/CategoryForm.tsx`

- Line 167–171 payload construction — same conditional as above, keyed off `form.shape`/`form.verificationMode`.
- Line 341 — change `{form.shape !== "free_text" && (...)}` to also render for free_text, but restrict the `<select>`'s options to just `off`/`per_member` when `form.shape === "free_text"` (no `rank_single`/`rank_multi_team` — those stay ranking_list-only, per the existing `{form.shape === "ranking_list" && (...)}` block at line 350).
- Line 246–250 — the informational blurb currently unconditionally says "every import is always held for manual review before it's written (never auto-committed)". Make this conditional: show the existing copy when `form.verificationMode === "off"`, and when `"per_member"`, show the same blue verification-mode blurb every other category gets (lines 358–364) instead.

---

## 3. Free-text-aware merge (`lib/verify/validate.ts`)

### 3a. Extend `ScreenshotGroup`/`MergedRow` fields typing

No structural change needed — both already carry a generic `fields: Record<string, string | number | undefined>` bag. For free_text rows this will hold `{ air?, tank?, missile?, fourth? }`.

### 3b. New merge function for free_text, alongside `mergeRows()`

```ts
// Field-level merge for free_text (Squads) categories - unlike mergeRows() (a full-row
// replace, correct for a category where one screenshot = one complete number per member),
// a Squads member's air/tank/missile/fourth can arrive across separate screenshots/messages
// read at different times. Each field independently keeps whichever source last reported
// THAT field - an older screenshot's fields aren't wiped just because a newer one only
// mentioned some of them. Manual entries (extended with `fields` - see schema change 1a)
// are applied last per field, same "manual always wins" rule as mergeRows().
export function mergeFreeTextRows(
  screenshots: { rows: { memberName: string; fields: Record<string, number | undefined> }[] }[],
  manualEntries: { memberName: string; fields: Record<string, number | undefined> | null }[]
): MergedRow[] {
  const byName = new Map<string, { memberName: string; fields: Record<string, number | undefined> }>();

  for (const shot of screenshots) {
    for (const r of shot.rows) {
      const key = r.memberName.trim().toLowerCase();
      const existing = byName.get(key)?.fields ?? {};
      const merged = { ...existing };
      for (const [k, v] of Object.entries(r.fields)) {
        if (v !== undefined) merged[k] = v; // only overwrite slots this read actually reported
      }
      byName.set(key, { memberName: r.memberName, fields: merged });
    }
  }

  for (const m of manualEntries) {
    if (!m.fields) continue;
    const key = m.memberName.trim().toLowerCase();
    const existing = byName.get(key)?.fields ?? {};
    const merged = { ...existing };
    for (const [k, v] of Object.entries(m.fields)) {
      if (v !== undefined) merged[k] = v;
    }
    byName.set(key, { memberName: m.memberName, fields: merged });
  }

  return [...byName.values()].map((r) => ({
    team: null,
    memberName: r.memberName,
    value: ["air", "tank", "missile", "fourth"].filter((k) => r.fields[k] !== undefined).length,
    fields: r.fields,
  }));
}
```

`value` here is deliberately the count of resolved slots (0–4), not a troop number — it exists only so the existing `validateBatch()` per_member counting (`rows.filter(r => r.value !== undefined && r.value !== null).length`) keeps working unchanged for the main Verify screen's "Balanced"/"Variance" count, exactly as it does for every other per_member category.

---

## 4. Wire the new merge into `loadMergedRows()` (`lib/verify/service.ts`)

`loadMergedRows()` (lines 63–99) currently branches on `category.shape === "roster"` vs. everything else (ranking_list). Add a `free_text` branch before the roster check:

```ts
async function loadMergedRows(
  category: Category,
  weekNumber: number,
  manualEntries: { team: string | null; memberName: string; rank: number | null; value: number | null; fields: string | null }[]
): Promise<MergedRow[]> {
  const extractions = await prisma.rawExtraction.findMany({
    where: { categoryKey: category.key, weekNumber, status: "pending_verification" },
  });

  if (category.shape === "free_text") {
    const screenshots = extractions.map((ex) => {
      const parsed = JSON.parse(ex.rawJson) as FreeTextResult;
      return {
        rows: (parsed.members ?? []).map((m) => ({
          memberName: m.member_name,
          fields: { air: m.air, tank: m.tank, missile: m.missile, fourth: m.fourth },
        })),
      };
    });
    return mergeFreeTextRows(
      screenshots,
      manualEntries.map((e) => ({ memberName: e.memberName, fields: e.fields ? JSON.parse(e.fields) : null }))
    );
  }

  if (category.shape === "roster") { ... } // unchanged
  ... // unchanged ranking_list branch
}
```

`manualEntries`'s type (used by `loadMergedRows`, `listPendingBatches`, `getBatchDetail`, `commitBatch`) needs `fields: string | null` added throughout `service.ts` wherever the manual-entry shape is passed around, matching schema change 1a. `addManualEntry()` (line 101) needs a `fields` parameter too, passed through to `prisma.importBatchManualEntry.create()`.

## 5. `commitBatch()` — reconstruct free_text payload (`lib/verify/service.ts` lines 127–172)

Add a free_text branch to the `extracted` reconstruction (currently only handles `roster`/else-ranking_list):

```ts
const extracted: RankingListResult | RosterResult | FreeTextResult =
  category.shape === "free_text"
    ? {
        members: rows.map((r) => ({
          member_name: r.memberName,
          air: r.fields.air as number | undefined,
          tank: r.fields.tank as number | undefined,
          missile: r.fields.missile as number | undefined,
          fourth: r.fields.fourth as number | undefined,
          needsReview: ["air", "tank", "missile", "fourth"].filter((k) => r.fields[k] !== undefined).length < 3,
        })),
      }
    : category.shape === "roster"
      ? { ... } // unchanged
      : { ... }; // unchanged ranking_list
```

`writeExtraction()` itself (`lib/pipeline/run.ts` lines 142–165) needs no change — it already handles `FreeTextResult` correctly for a single, already-merged payload; the bug was only ever upstream of it (screenshots never being merged before reaching it).

Also delete this batch's `ImportBatchIssueAck` rows in the same transaction that marks the batch committed (line 165–171), and in `cancelBatch()` (line 181–190) — both places already delete `manualEntries` for the batch, add the equivalent `prisma.importBatchIssueAck.deleteMany({ where: { importBatchId: batch.id } })`.

---

## 6. Per-member value-quality checks (`lib/verify/squadIssues.ts`, new file)

This is the layer that does NOT feed into `validateBatch()`'s count-based `isBalanced`/`variance` (that stays exactly as-is, per the "same message as every other category" requirement) — it's a separate computation used only by the new review page (section 7) and only for `free_text` categories in `per_member` mode.

```ts
import { prisma } from "@/lib/db";
import { findMemberId, type MatchableMember } from "@/lib/pipeline/matchMemberCore";
import type { MergedRow } from "./validate";

export type SquadIssue =
  | { type: "few_squads"; memberName: string; count: number }
  | { type: "below_min"; memberName: string; field: string; value: number; min: number }
  | { type: "large_drop"; memberName: string; field: string; value: number; priorValue: number }
  | { type: "missing_submission"; memberName: string };

const FIELDS = ["air", "tank", "missile", "fourth"] as const;
const DROP_TOLERANCE = 0.9; // flag if this week's value < 90% of the member's own last submission for that field

/**
 * Computes data-quality flags for a pending Squads batch's merged rows. Purely additive to
 * the existing count-based balance check (validateBatch) - never affects isBalanced/variance,
 * only ever surfaces on the dedicated review page. Already-acknowledged (memberName,
 * issueType) pairs are excluded by the caller (see getSquadReview in service additions below).
 */
export async function computeSquadIssues(categoryId: number, weekNumber: number, rows: MergedRow[]): Promise<SquadIssue[]> {
  const issues: SquadIssue[] = [];

  const priorRecords = await prisma.categoryRecord.findMany({
    where: { categoryId, weekNumber: weekNumber - 1 },
    include: { member: true },
  });

  // Single alliance-wide floor: the lowest individual squad value (any of the 4 fields, any
  // member) actually recorded last week. No floor at all if there's no prior week yet.
  let allianceMin: number | null = null;
  for (const rec of priorRecords) {
    const fields = JSON.parse(rec.fields) as Record<string, number | undefined>;
    for (const f of FIELDS) {
      const v = fields[f];
      if (typeof v === "number" && Number.isFinite(v)) {
        if (allianceMin === null || v < allianceMin) allianceMin = v;
      }
    }
  }

  const priorByMemberName = new Map<string, Record<string, number | undefined>>();
  const members = priorRecords.map((r) => r.member) as MatchableMember[];
  for (const rec of priorRecords) {
    priorByMemberName.set(rec.member.name.trim().toLowerCase(), JSON.parse(rec.fields));
  }

  for (const row of rows) {
    const resolvedCount = FIELDS.filter((f) => row.fields[f] !== undefined).length;
    if (resolvedCount < 3) {
      issues.push({ type: "few_squads", memberName: row.memberName, count: resolvedCount });
    }

    // Resolve real member identity read-only (no auto-create) so history lookups are
    // against the right person even if this week's OCR'd name spelling drifted slightly.
    const matchedId = findMemberId(row.memberName, members);
    const matchedMember = members.find((m) => m.id === matchedId);
    const priorFields = matchedMember ? priorByMemberName.get(matchedMember.name.trim().toLowerCase()) : undefined;

    for (const f of FIELDS) {
      const value = row.fields[f] as number | undefined;
      if (value === undefined) continue;

      if (!Number.isFinite(value) || value <= 0 || (allianceMin !== null && value < allianceMin)) {
        if (allianceMin !== null) {
          issues.push({ type: "below_min", memberName: row.memberName, field: f, value, min: allianceMin });
        }
        continue; // don't also fire large_drop for a value that's already flagged as below the floor
      }

      const priorValue = priorFields?.[f];
      if (typeof priorValue === "number" && priorValue > 0 && value < priorValue * DROP_TOLERANCE) {
        issues.push({ type: "large_drop", memberName: row.memberName, field: f, value, priorValue });
      }
    }
  }

  // Missing submission: had a Squads record last week, has no merged row at all this week.
  const rowNames = new Set(rows.map((r) => r.memberName.trim().toLowerCase()));
  for (const rec of priorRecords) {
    if (!rowNames.has(rec.member.name.trim().toLowerCase())) {
      issues.push({ type: "missing_submission", memberName: rec.member.name });
    }
  }

  return issues;
}
```

Notes on rules implemented here, matching what was confirmed:
- **Min floor**: one blanket number = the lowest single value across all 4 fields, all members, last week (`weekNumber - 1` only, not "last time they submitted"). No floor at all on the very first week Squads has any data (nothing to compare against) — `below_min` simply never fires until there's a prior week.
- **Drift check**: per-field (Air vs. their own last Air, Tank vs. their own last Tank, etc.), one-directional — only flags a drop of more than 10% from that member's own last submission for that specific field. Growth, of any size, never flags. A member with no prior-week record at all only gets the floor check (nothing to diff against), matching "if the member has never submitted use the min of the alliance."
- **few_squads**: recomputed on the final *merged* fields (not trusted from any one screenshot's `needsReview`), since merging two partial screenshots can push a member from 2 resolved slots to 3+.
- **missing_submission**: compares only to `weekNumber - 1`.

---

## 7. New review/clearance page

### 7a. Extend the GET detail endpoint (or add a sibling) to also return issues

Add to `lib/verify/service.ts`:

```ts
export type SquadReview = { issues: SquadIssue[]; acknowledged: { memberName: string; issueType: string }[] };

export async function getSquadReview(categoryKey: string, weekNumber: number): Promise<SquadReview | null> {
  const category = await prisma.category.findUnique({ where: { key: categoryKey } });
  if (!category || category.shape !== "free_text" || category.verificationMode !== "per_member") return null;

  const batch = await prisma.importBatch.findUnique({
    where: { categoryKey_weekNumber: { categoryKey, weekNumber } },
    include: { manualEntries: true, issueAcks: true },
  });
  if (!batch || batch.status !== "pending") return null;

  const rows = await loadMergedRows(category, weekNumber, batch.manualEntries);
  const allIssues = await computeSquadIssues(category.id, weekNumber, rows);

  const ackKey = (i: { memberName: string; issueType: string }) => `${i.memberName.toLowerCase()}:${i.issueType}`;
  const acked = new Set(batch.issueAcks.map((a) => ackKey({ memberName: a.memberName, issueType: a.issueType })));
  const issues = allIssues.filter((i) => !acked.has(ackKey({ memberName: i.memberName, issueType: i.type })));

  return { issues, acknowledged: batch.issueAcks.map((a) => ({ memberName: a.memberName, issueType: a.issueType })) };
}

export async function acknowledgeIssue(categoryKey: string, weekNumber: number, memberName: string, issueType: string): Promise<void> {
  const batch = await prisma.importBatch.findUniqueOrThrow({ where: { categoryKey_weekNumber: { categoryKey, weekNumber } } });
  await prisma.importBatchIssueAck.upsert({
    where: { importBatchId_memberName_issueType: { importBatchId: batch.id, memberName, issueType } },
    update: {},
    create: { importBatchId: batch.id, memberName, issueType },
  });
}

export async function unacknowledgeIssue(ackId: number): Promise<void> {
  await prisma.importBatchIssueAck.delete({ where: { id: ackId } });
}
```

### 7b. New route: `app/verify/[categoryKey]/[weekNumber]/review/page.tsx`

```tsx
import { requireMenuAccess } from "@/lib/menuAccess";
import { ReviewIssuesClient } from "./ReviewIssuesClient";

export default async function SquadReviewPage({ params }: PageProps<"/verify/[categoryKey]/[weekNumber]/review">) {
  await requireMenuAccess("uploads-verify-imports");
  const { categoryKey, weekNumber } = await params;
  return <ReviewIssuesClient categoryKey={categoryKey} weekNumber={Number(weekNumber)} />;
}
```

### 7c. New API routes

- `GET /api/verify/[categoryKey]/[weekNumber]/review` → `getSquadReview()`, 404 if null.
- `POST /api/verify/[categoryKey]/[weekNumber]/review` body `{ memberName, issueType }` → `acknowledgeIssue()`.
- `DELETE /api/verify/review-acks/[ackId]` → `unacknowledgeIssue()` (undo a tick, mirrors the existing `entries/[entryId]` DELETE pattern).
- Editing a value on this page reuses the **existing** `POST /api/verify/[categoryKey]/[weekNumber]` (`addManualEntry`), extended (per section 4) to accept `fields`. No new endpoint needed for edits — a manual entry with the corrected fields automatically wins the merge for that member and the recomputed issue list stops flagging it.

All new/changed routes gated with `requireAdminApi()`, matching every existing `/api/verify/*` route.

### 7d. `ReviewIssuesClient.tsx` — behavior

- Lists every open issue, one per line, grouped by member: e.g. "User X — no submission this week", "User Y — Air dropped from 3.2 to 2.1 (34% drop)", "User Z — only 2 of 4 squads read", "User W — Tank reads 18, below this week's floor of 20".
- Each line has: a "✓ Looks correct" button (calls the ack endpoint, removes it from the open list) and an inline edit form (prefilled with whatever fields are currently known for that member) that submits via the extended manual-entry endpoint — submitting corrected fields both fixes the data and clears the issue (since it's recomputed from the corrected merged rows on next load).
- A "Commit" button at the top: enabled once the open-issues list is empty; if issues remain, show "Commit anyway" requiring one more explicit confirm (`confirm()`, same pattern as the existing "Cancel batch" and count-variance "Commit as-is" buttons) — this does **not** hard-block, consistent with how the existing count-based variance already works (soft-warn + explicit override), and this list is informational for a human to judge, not a strict data-integrity constraint. Both buttons call the existing `POST /api/verify/[categoryKey]/[weekNumber]/commit`.

### 7e. `VerifyDetailClient.tsx` — route Commit through the review step for Squads only

Currently `handleCommit(false)` (line 93) is called directly from the "Commit" button (line 184) whenever `v.isBalanced`. Change: when `batch.categoryKey === "squads"` (or, more generally, when the category is `free_text` + `per_member` — pass a `hasReviewStep: boolean` flag down from the server component, computed from the category's shape/mode, rather than hardcoding the key client-side), clicking Commit should first `fetch` `GET /api/verify/[categoryKey]/[weekNumber]/review`:
- If `issues.length === 0` → call `handleCommit(false)` immediately, exactly as today ("if nothing flagged then just say so, and commit as normal" — no extra page visit for a clean batch).
- If `issues.length > 0` → `router.push` to `/verify/[categoryKey]/[weekNumber]/review` instead of committing.

For every other category, behavior is completely unchanged.

---

## 8. Menu item (`prisma/seed.ts`)

Add directly after the existing `uploads-verify-imports` entry (line 161):

```ts
{
  key: "uploads-squads-review",
  label: "Squads Review",
  href: "/verify/squads/review",
  roles: ["ADMIN"],
  parentKey: "home-uploads",
},
```

This gives it a real, always-visible nav entry (not just something reached by a link from within Verify), per the ask. Note its `href` is fixed to `squads` specifically since there's no "pick a week" UI on this static link — landing there with no pending Squads batch for the current week should show an empty/"nothing to review" state rather than erroring (mirror `VerifyDetailClient`'s existing "Batch not found - it may already be committed" handling).

---

## 9. Version bump

Bump `MINOR` in `lib/version.ts` as part of this change's commit, per the project's existing convention.

---

## 10. Manual test plan

1. Set `squads` category's Verification mode to "Every roster member should have a value" via Setup → Categories, save, then re-open the edit panel and confirm it stuck (this specifically catches the CategoryForm/API landmine from section 2 if it's missed).
2. Upload a screenshot with one member's message split so only Air+Tank are labeled; upload a second screenshot (or re-trigger processing) with a second message from the *same* member giving Missile+Fourth. Confirm at `/verify/squads/<week>` that the merged row shows all 4 values, not just the last screenshot's two.
3. Upload a screenshot where the same member appears with conflicting values for the same field across two screenshots — confirm the later screenshot's value wins for that field specifically (last-wins is still correct *within* a single field; only whole-row replacement was the bug).
4. Upload a screenshot with an implausibly low number (e.g. "2") for a member — confirm it surfaces on the review page as `below_min` once there's a prior week to compare against, and does nothing on a first-ever week (no floor yet).
5. Confirm a member whose Air drops >10% from last week's Air shows `large_drop` on the review page, and that a member whose Air *increases* by any amount never triggers it.
6. Remove a member from this week's screenshots who had data last week — confirm `missing_submission` appears.
7. Clear each issue type once via "Looks like real" and once by editing the value, confirming both remove it from the open list and that the edit path actually changes what gets written on commit.
8. Commit a batch with zero flagged issues — confirm it commits directly without visiting the review page.
9. Confirm every other `per_member`/`rank_*` category (Kills, HQ, Desert Storm) is completely unaffected — same UI, same commit behavior as before this change.
