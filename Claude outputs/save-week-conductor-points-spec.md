# Save Week — per-category Conductor points behavior during a "no push" week

## What this is for

Some weeks the alliance deliberately doesn't push for a Desert Storm/VS win
(wins are decided by VS points). If a member ignores that agreement and wins
anyway, they'd currently still earn full Conductor points for behavior the
alliance didn't want rewarded. This adds a per-category setting so an admin
can neutralize specific categories' Conductor points during a marked "Save
Week," plus the Save Week list itself.

## Design, as confirmed with Frans

- Per category (on the same Conductor Settings page/section where Conductor
  points-per-category are already set — `ConductorCategoryPointsSection`),
  a 3-way mode for how that category's points behave during an active Save
  Week: **Full** (unaffected, same as a normal week), **Zero** (0 points for
  that category that week, regardless of value), **Capped** (points are
  calculated as if the member's raw stat value were capped at a per-week
  maximum, even if their real reading is much higher — his example: VS
  capped at 70m means a 300m score still only scores as if it were 70m).
- A new **Save Week** list, separate from the existing "From week" setting:
  each entry has a **week number**, an **end date** ("the Sunday of that
  week" — informational/reference only, nothing computes from it), and an
  **active toggle**.
- The cap value for "Capped" categories is **not** a fixed per-category
  number — it varies per Save Week, so it lives on the Save Week entry
  itself, one cap per capped-mode category, per week.
- **Firm rule, confirmed to apply to every recalculation for any reason, not
  just this feature**: a recalculation can never leave a member with points
  left over past a week they were selected as Conductor in — at the moment
  of selection their balance resets to zero, permanently, and no later
  recalculation (whatever triggered it) can produce a negative "chain" value
  that effectively un-does that. Today's `recalculateSelectionPoints()`
  deliberately does the opposite — it reports negative results as a bug
  signal instead of flooring them. Confirmed this should be reversed: always
  clamp to zero, and chain the *clamped* value forward, not the raw one.
- **Any change to Save Week config (create/edit/delete an entry, or change a
  category's Save Week mode) must trigger a recalculation of every confirmed
  Conductor selection's frozen points.**

### Assumption flagged for review (not explicitly asked, but needed to ship)

If a category is set to "Capped" but a given Save Week entry has no cap
value filled in for it, that category is treated as **Full** (uncapped) for
that week — same as if the cap simply weren't set. This is a fail-safe so an
admin who adds a new capped category without immediately backfilling every
past Save Week's cap value doesn't accidentally zero out points nobody
intended to touch. If you'd rather it default to **Zero** in that case
instead, that's a one-line change — flag it and I'll adjust before this goes
to the implementer.

---

## 1. Schema changes (`prisma/schema.prisma`)

### 1a. `Category` model — add `saveWeekMode`

In the `Category` model (currently lines 70-121), add a new field. Insert
after `conductorFlatValue` (line 118), before `records` (line 120):

```prisma
  // How this category's Conductor points behave during an active Save Week (see the
  // SaveWeek model) - "full" (default, unaffected, same as any normal week) | "zero" (0
  // points for this category that week, regardless of the member's value) | "capped" (the
  // raw stat value is clamped to that week's SaveWeek.capValues[key] BEFORE the rate/flat
  // points math runs, so a member can't out-earn the capped-equivalent points even with a
  // much higher real reading). Meaningless (never read) for a category with
  // conductorMode "off".
  saveWeekMode String @default("full")
```

### 1b. New `SaveWeek` model

Add after the `Category` model (after line 121, before the `Setting` model):

```prisma
// A week the alliance deliberately didn't push for a win (Desert Storm/VS wins are decided
// by VS points, not effort) - if a member wins it anyway against that agreement, categories
// set to "zero" or "capped" (Category.saveWeekMode) must not reward that for this week.
// `endDate` is informational only (the Sunday of that week, for the admin's own reference) -
// no points calculation reads it; `weekNumber` is what every calculation actually keys on.
// `capValues` is a JSON object mapping a "capped"-mode category's key to that category's
// raw-stat ceiling for THIS week only (e.g. {"vs": 70000000}) - deliberately per-week, not a
// fixed per-category number, since the cap itself is set fresh each Save Week. An inactive
// (toggled-off) row is kept, not deleted, so its cap values survive being re-enabled later,
// but behaves as if it doesn't exist for every points calculation while inactive.
model SaveWeek {
  id         Int      @id @default(autoincrement())
  weekNumber Int      @unique
  endDate    DateTime
  active     Boolean  @default(true)
  capValues  String   @default("{}")
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
}
```

### 1c. Apply the schema change

No migrations folder in this repo — per project convention:

```
npx prisma db push
npx prisma generate
```

---

## 2. New `lib/conductor/saveWeeks.ts` — CRUD + the lookup points.ts needs

New file:

```ts
import { prisma } from "@/lib/db";

export type SaveWeekConfig = { capValues: Record<string, number> };

export type SaveWeekRow = {
  id: number;
  weekNumber: number;
  endDate: string; // ISO date, e.g. "2026-09-21"
  active: boolean;
  capValues: Record<string, number>;
};

function toRow(row: { id: number; weekNumber: number; endDate: Date; active: boolean; capValues: string }): SaveWeekRow {
  return {
    id: row.id,
    weekNumber: row.weekNumber,
    endDate: row.endDate.toISOString().slice(0, 10),
    active: row.active,
    capValues: JSON.parse(row.capValues),
  };
}

export async function listSaveWeeks(): Promise<SaveWeekRow[]> {
  const rows = await prisma.saveWeek.findMany({ orderBy: { weekNumber: "asc" } });
  return rows.map(toRow);
}

// Only ACTIVE Save Weeks affect points - an inactive one is kept around (not deleted) so its
// cap values aren't lost if it's ever re-toggled on, but is invisible to every points
// calculation until then. Callers that need per-week config (lib/conductor/points.ts) fetch
// this once per calculation run rather than querying per member/week.
export async function getActiveSaveWeeksMap(): Promise<Map<number, SaveWeekConfig>> {
  const rows = await prisma.saveWeek.findMany({ where: { active: true } });
  const map = new Map<number, SaveWeekConfig>();
  for (const row of rows) {
    map.set(row.weekNumber, { capValues: JSON.parse(row.capValues) });
  }
  return map;
}

type SaveWeekInput = { weekNumber: number; endDate: string; active: boolean; capValues: Record<string, number> };

export async function createSaveWeek(data: SaveWeekInput): Promise<SaveWeekRow> {
  const row = await prisma.saveWeek.create({
    data: { weekNumber: data.weekNumber, endDate: new Date(data.endDate), active: data.active, capValues: JSON.stringify(data.capValues) },
  });
  return toRow(row);
}

export async function updateSaveWeek(id: number, data: SaveWeekInput): Promise<SaveWeekRow> {
  const row = await prisma.saveWeek.update({
    where: { id },
    data: { weekNumber: data.weekNumber, endDate: new Date(data.endDate), active: data.active, capValues: JSON.stringify(data.capValues) },
  });
  return toRow(row);
}

export async function deleteSaveWeek(id: number): Promise<void> {
  await prisma.saveWeek.delete({ where: { id } });
}
```

---

## 3. `lib/conductor/points.ts` — apply Save Week rules + fix the clamp-to-zero bug

Full current file is 212 lines (already re-read live this session). Replace
the whole file with:

```ts
import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import { getConductorCategoryWeekValues, type CategoryWeekValue } from "./stats";
import { getConductorSettings } from "./settings";
import { getActiveSaveWeeksMap, type SaveWeekConfig } from "./saveWeeks";

export type ConductorCategoryConfig = {
  key: string;
  conductorMode: string; // "off" | "rate" | "flat"
  conductorPointsPerUnit: number | null;
  conductorUnitSize: number | null;
  conductorFlatValue: number | null;
  saveWeekMode: string; // "full" | "zero" | "capped"
};

export type MemberStanding = {
  memberId: number;
  memberName: string;
  accumulated: number;
  lessSelected: number;
  total: number;
};

/**
 * Points earned for one member/category/week under that category's conductor config, after
 * applying that week's Save Week rule (if any) for this specific category. `saveWeek` is
 * this week's config or undefined if this week isn't an active Save Week at all - in which
 * case every category behaves exactly as before this feature existed.
 */
export function pointsForCategoryWeek(
  category: ConductorCategoryConfig,
  cw: CategoryWeekValue | undefined,
  saveWeek?: SaveWeekConfig
): number {
  if (!cw || !cw.present) return 0;

  if (saveWeek && category.saveWeekMode === "zero") return 0;

  let value = cw.value;
  if (saveWeek && category.saveWeekMode === "capped") {
    const cap = saveWeek.capValues[category.key];
    // No cap entered for this category on this Save Week - fail open (uncapped) rather than
    // silently zeroing someone's points because an admin hasn't backfilled every category yet.
    if (cap !== undefined) value = Math.min(value, cap);
  }

  if (category.conductorMode === "rate") {
    const unitSize = category.conductorUnitSize || 1;
    const perUnit = category.conductorPointsPerUnit ?? 0;
    return (value / unitSize) * perUnit;
  }
  if (category.conductorMode === "flat") {
    return category.conductorFlatValue ?? 0;
  }
  return 0;
}

/** Sum of a member's earned points for one week, across every category configured for conductor points. */
export function earnedPointsForWeek(
  categories: ConductorCategoryConfig[],
  values: Map<string, CategoryWeekValue>,
  memberId: number,
  weekNumber: number,
  saveWeeks?: Map<number, SaveWeekConfig>
): number {
  let total = 0;
  const saveWeek = saveWeeks?.get(weekNumber);
  for (const category of categories) {
    total += pointsForCategoryWeek(category, values.get(`${memberId}:${weekNumber}:${category.key}`), saveWeek);
  }
  return total;
}

/** Sum of a member's earned points over an inclusive week range - the building block for both live standings (unbounded upper end) and point recalculation (bounded to a specific snapshot week). */
export function sumEarnedPoints(
  categories: ConductorCategoryConfig[],
  values: Map<string, CategoryWeekValue>,
  memberId: number,
  fromWeek: number,
  throughWeek: number,
  saveWeeks?: Map<number, SaveWeekConfig>
): number {
  let total = 0;
  for (let week = fromWeek; week <= throughWeek; week++) {
    total += earnedPointsForWeek(categories, values, memberId, week, saveWeeks);
  }
  return total;
}

/**
 * Standings for every active member: accumulated (all earned points from the
 * configured "from week" onward, computed live from WeeklyStat/CategoryRecord - no
 * separate ledger table), less selected (sum of frozen balances at each of that
 * member's past confirmed conductor selections - each one a full reset at the time),
 * and total = accumulated - lessSelected. This telescopes correctly across repeated
 * selections because each `pointsAtSelection` is itself already net of every earlier
 * reset, not just points earned since the last one.
 */
export async function computeStandings(): Promise<MemberStanding[]> {
  const settings = await getConductorSettings();
  const [members, categories, values, saveWeeks] = await Promise.all([
    prisma.member.findMany({ where: { isActive: true } }),
    prisma.category.findMany({ where: { active: true, conductorMode: { not: "off" } } }),
    getConductorCategoryWeekValues(),
    getActiveSaveWeeksMap(),
  ]);

  let maxWeek = settings.fromWeek;
  for (const key of values.keys()) {
    const weekNumber = Number(key.split(":")[1]);
    if (weekNumber > maxWeek) maxWeek = weekNumber;
  }

  const earnedByMember = new Map<number, number>();
  for (const member of members) {
    earnedByMember.set(member.id, sumEarnedPoints(categories, values, member.id, settings.fromWeek, maxWeek, saveWeeks));
  }

  const resets = await prisma.conductorSelection.groupBy({
    by: ["memberId"],
    where: { role: "conductor", round: { status: "confirmed" } },
    _sum: { pointsAtSelection: true },
  });
  const lessSelectedByMember = new Map(resets.map((r) => [r.memberId, r._sum.pointsAtSelection ?? 0]));

  return members
    .map((m) => {
      const accumulated = earnedByMember.get(m.id) ?? 0;
      const lessSelected = lessSelectedByMember.get(m.id) ?? 0;
      return { memberId: m.id, memberName: m.name, accumulated, lessSelected, total: accumulated - lessSelected };
    })
    .sort((a, b) => b.total - a.total);
}

export type RecalculateResult = {
  updated: number;
  unchanged: number;
  // Selections where the recalculated balance would have gone negative before the zero-floor
  // rule was applied - e.g. a Save Week newly zeroing/capping a category, a corrected
  // divisor, or a fixed round startWeek can all cause this now that any of those can change a
  // member's earned points after the fact. NOT a bug signal by itself anymore: the firm rule
  // is that a member can never have points left over past a week they were selected in, so
  // recalculation always floors the stored value at 0 regardless of why the raw math went
  // negative. Reported for visibility only. `rawValue` is what the math produced before
  // flooring; `newValue` (always >= 0) is what was actually stored.
  flaggedNegative: { memberId: number; memberName: string; roundId: number; startWeek: number; oldValue: number | null; newValue: number; rawValue: number }[];
};

/**
 * Recomputes every confirmed conductor selection's `pointsAtSelection` from real stats
 * data rather than trusting whatever was imported/typed in. A conductor round is decided
 * in advance - e.g. a week 64-65 round is picked at the end of week 63 - so the frozen
 * reset amount must be the member's balance as of `round.startWeek - 1`, chained in
 * round-start order per member (each selection's reset must already be net of every
 * earlier one, or the flat subtraction in computeStandings can go negative - the bug
 * this fixes).
 *
 * Firm rule: a member can never end a week they were selected as Conductor in with points
 * left over - their balance resets to exactly 0 at that moment, always, no matter what
 * triggered this recalculation. So `newValue` is always floored at 0, and the running
 * `priorResets` chain for a member's later selections uses that FLOORED value, never the
 * raw one - a later selection is never asked to "give back" points a floor already absorbed.
 */
export async function recalculateSelectionPoints(): Promise<RecalculateResult> {
  const settings = await getConductorSettings();
  const [categories, values, selections, saveWeeks] = await Promise.all([
    prisma.category.findMany({ where: { active: true, conductorMode: { not: "off" } } }),
    getConductorCategoryWeekValues(),
    prisma.conductorSelection.findMany({
      where: { role: "conductor", memberId: { not: null }, round: { status: "confirmed" } },
      include: { round: true, member: true },
    }),
    getActiveSaveWeeksMap(),
  ]);

  const byMember = new Map<number, typeof selections>();
  for (const s of selections) {
    if (s.memberId === null) continue;
    if (!byMember.has(s.memberId)) byMember.set(s.memberId, []);
    byMember.get(s.memberId)!.push(s);
  }

  const updates: {
    id: number;
    oldValue: number | null;
    newValue: number;
    rawValue: number;
    memberId: number;
    memberName: string;
    roundId: number;
    startWeek: number;
  }[] = [];

  for (const [memberId, memberSelections] of byMember) {
    const sorted = [...memberSelections].sort((a, b) => a.round.startWeek - b.round.startWeek);
    let priorResets = 0;
    for (const sel of sorted) {
      const snapshotWeek = sel.round.startWeek - 1;
      const earned = sumEarnedPoints(categories, values, memberId, settings.fromWeek, snapshotWeek, saveWeeks);
      const rawValue = earned - priorResets;
      const newValue = Math.max(0, rawValue);
      updates.push({
        id: sel.id,
        oldValue: sel.pointsAtSelection,
        newValue,
        rawValue,
        memberId,
        memberName: sel.member?.name ?? "",
        roundId: sel.roundId,
        startWeek: sel.round.startWeek,
      });
      priorResets += newValue; // chain the FLOORED value - see the firm rule in the doc comment above
    }
  }

  // A ConductorSelection row exists per day, not per week, so this can be several hundred
  // rows - Prisma's array-form $transaction() would run each update() as its own
  // sequential round trip (updateMany() can't help here since every row gets a different
  // value). One UPDATE ... FROM (VALUES ...) statement does the whole batch in one round
  // trip instead; Prisma.sql/Prisma.join still fully parameterize every value.
  if (updates.length > 0) {
    const rows = Prisma.join(
      updates.map((u) => Prisma.sql`(${u.id}::integer, ${u.newValue}::double precision)`),
      ","
    );
    await prisma.$executeRaw`
      UPDATE "ConductorSelection" AS cs
      SET "pointsAtSelection" = v.points
      FROM (VALUES ${rows}) AS v(id, points)
      WHERE cs.id = v.id
    `;
  }

  let updated = 0;
  let unchanged = 0;
  const flaggedNegative: RecalculateResult["flaggedNegative"] = [];
  for (const u of updates) {
    if (u.oldValue === null || Math.abs(u.oldValue - u.newValue) > 0.0001) updated++;
    else unchanged++;
    if (u.rawValue < 0) {
      flaggedNegative.push({
        memberId: u.memberId,
        memberName: u.memberName,
        roundId: u.roundId,
        startWeek: u.startWeek,
        oldValue: u.oldValue,
        newValue: u.newValue,
        rawValue: u.rawValue,
      });
    }
  }

  return { updated, unchanged, flaggedNegative };
}
```

Changes from today's file, summarized: `ConductorCategoryConfig` gained
`saveWeekMode`; `pointsForCategoryWeek`/`earnedPointsForWeek`/
`sumEarnedPoints` all gained an optional `saveWeek(s)` parameter that's
looked up once per calculation run (not per member/week - no N+1 queries);
`computeStandings()` and `recalculateSelectionPoints()` both fetch
`getActiveSaveWeeksMap()` alongside their existing parallel queries and pass
it through; `recalculateSelectionPoints()` now always floors `newValue` at
0 and chains the floored value, and `flaggedNegative` is reframed as
informational with an added `rawValue` field.

`prisma.category.findMany(...)` calls need no changes themselves - Prisma
returns every scalar column by default when there's no `select`, so
`saveWeekMode` comes through automatically once the schema is pushed, and
the full `Category[]` result already structurally satisfies
`ConductorCategoryConfig[]`.

---

## 4. `app/api/conductor/category-points/route.ts` — persist `saveWeekMode` + trigger recalc

Current file is 74 lines (already re-read live this session). Replace with:

```ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/dal";
import { recalculateSelectionPoints } from "@/lib/conductor/points";

export async function GET() {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const categories = await prisma.category.findMany({
    where: { active: true, shape: { not: "free_text" } },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      key: true,
      name: true,
      conductorMode: true,
      conductorPointsPerUnit: true,
      conductorUnitSize: true,
      conductorFlatValue: true,
      saveWeekMode: true,
    },
  });
  return NextResponse.json({ categories });
}

type CategoryPointsInput = {
  categoryKey: string;
  mode: string;
  pointsPerUnit?: number | null;
  unitSize?: number | null;
  flatValue?: number | null;
  saveWeekMode: string;
};

// Bulk edit of every rankable category's Conductor points (and Save Week mode) in one save -
// same rate/flat/off normalization app/api/categories/[id]/route.ts already applies to a
// single category, just looped over the whole set instead of threaded through the Category
// edit panel one at a time. Always recalculates afterward - a saveWeekMode change here can
// change how much a past week is now worth, and the firm rule is that ANY change to Save
// Week configuration recalculates (see lib/conductor/points.ts's recalculateSelectionPoints).
export async function PUT(request: Request) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const body = (await request.json()) as { items?: CategoryPointsInput[] };
  const items = body.items ?? [];

  for (const item of items) {
    if (!item.categoryKey) return NextResponse.json({ error: "Each item needs a categoryKey." }, { status: 400 });
    if (!["off", "rate", "flat"].includes(item.mode)) {
      return NextResponse.json({ error: `${item.categoryKey}: mode must be 'off', 'rate', or 'flat'.` }, { status: 400 });
    }
    if (item.mode === "rate") {
      if (typeof item.pointsPerUnit !== "number" || !Number.isFinite(item.pointsPerUnit)) {
        return NextResponse.json({ error: `${item.categoryKey}: points per unit is required for rate mode.` }, { status: 400 });
      }
      if (item.unitSize != null && (!Number.isFinite(item.unitSize) || item.unitSize <= 0)) {
        return NextResponse.json({ error: `${item.categoryKey}: unit size must be greater than 0 for rate mode.` }, { status: 400 });
      }
    }
    if (item.mode === "flat" && (typeof item.flatValue !== "number" || !Number.isFinite(item.flatValue))) {
      return NextResponse.json({ error: `${item.categoryKey}: flat value is required for flat mode.` }, { status: 400 });
    }
    if (!["full", "zero", "capped"].includes(item.saveWeekMode)) {
      return NextResponse.json({ error: `${item.categoryKey}: Save Week mode must be 'full', 'zero', or 'capped'.` }, { status: 400 });
    }
  }

  await prisma.$transaction(
    items.map((item) =>
      prisma.category.update({
        where: { key: item.categoryKey },
        data: {
          conductorMode: item.mode,
          conductorPointsPerUnit: item.mode === "rate" ? (item.pointsPerUnit ?? null) : null,
          conductorUnitSize: item.mode === "rate" ? (item.unitSize ?? 1) : null,
          conductorFlatValue: item.mode === "flat" ? (item.flatValue ?? null) : null,
          saveWeekMode: item.saveWeekMode,
        },
      })
    )
  );

  await recalculateSelectionPoints();

  const categories = await prisma.category.findMany({
    where: { active: true, shape: { not: "free_text" } },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      key: true,
      name: true,
      conductorMode: true,
      conductorPointsPerUnit: true,
      conductorUnitSize: true,
      conductorFlatValue: true,
      saveWeekMode: true,
    },
  });
  return NextResponse.json({ categories });
}
```

---

## 5. New Save Week API routes

### `app/api/conductor/save-weeks/route.ts` (new file)

```ts
import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth/dal";
import { listSaveWeeks, createSaveWeek } from "@/lib/conductor/saveWeeks";
import { recalculateSelectionPoints } from "@/lib/conductor/points";

export async function GET() {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const saveWeeks = await listSaveWeeks();
  return NextResponse.json({ saveWeeks });
}

function validate(body: { weekNumber?: number; endDate?: string; active?: boolean; capValues?: Record<string, number> }) {
  if (!Number.isInteger(body.weekNumber) || (body.weekNumber as number) < 1) {
    return "Week number must be a whole number >= 1.";
  }
  if (!body.endDate || Number.isNaN(new Date(body.endDate).getTime())) {
    return "End date is required.";
  }
  return null;
}

// Firm rule: any change to Save Week config recalculates every confirmed conductor
// selection's frozen points (see lib/conductor/points.ts's recalculateSelectionPoints) - a
// new or edited Save Week can change how many points a past week is now worth.
export async function POST(request: Request) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const body = (await request.json()) as { weekNumber?: number; endDate?: string; active?: boolean; capValues?: Record<string, number> };
  const error = validate(body);
  if (error) return NextResponse.json({ error }, { status: 400 });

  const saveWeek = await createSaveWeek({
    weekNumber: body.weekNumber as number,
    endDate: body.endDate as string,
    active: body.active ?? true,
    capValues: body.capValues ?? {},
  });

  await recalculateSelectionPoints();

  return NextResponse.json({ saveWeek });
}
```

### `app/api/conductor/save-weeks/[id]/route.ts` (new file)

Matches the typed `RouteContext<...>` param convention already used by
`app/api/conductor/rounds/[id]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth/dal";
import { updateSaveWeek, deleteSaveWeek } from "@/lib/conductor/saveWeeks";
import { recalculateSelectionPoints } from "@/lib/conductor/points";

function validate(body: { weekNumber?: number; endDate?: string; active?: boolean; capValues?: Record<string, number> }) {
  if (!Number.isInteger(body.weekNumber) || (body.weekNumber as number) < 1) {
    return "Week number must be a whole number >= 1.";
  }
  if (!body.endDate || Number.isNaN(new Date(body.endDate).getTime())) {
    return "End date is required.";
  }
  return null;
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/conductor/save-weeks/[id]">) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const { id } = await ctx.params;
  const body = (await request.json()) as { weekNumber?: number; endDate?: string; active?: boolean; capValues?: Record<string, number> };
  const error = validate(body);
  if (error) return NextResponse.json({ error }, { status: 400 });

  const saveWeek = await updateSaveWeek(Number(id), {
    weekNumber: body.weekNumber as number,
    endDate: body.endDate as string,
    active: body.active ?? true,
    capValues: body.capValues ?? {},
  });

  await recalculateSelectionPoints();

  return NextResponse.json({ saveWeek });
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/conductor/save-weeks/[id]">) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const { id } = await ctx.params;
  await deleteSaveWeek(Number(id));
  await recalculateSelectionPoints();

  return NextResponse.json({ ok: true });
}
```

---

## 6. `app/setup/conductor/ConductorSettingsClient.tsx` — UI

Current file is 425 lines (already re-read live this session). Three
changes: extend the two category-points types, add a "Save Week Mode"
column to `ConductorCategoryPointsSection`'s table, add a new
`SaveWeeksSection` component, and update `RecalculateButton`'s messaging.

### 6a. Extend the category-points types (replace lines 211-227)

```ts
type ConductorCategoryRow = {
  categoryKey: string;
  name: string;
  mode: "off" | "rate" | "flat";
  pointsPerUnit: string;
  unitSize: string;
  flatValue: string;
  saveWeekMode: "full" | "zero" | "capped";
};

type ConductorCategoryApiRow = {
  key: string;
  name: string;
  conductorMode: string;
  conductorPointsPerUnit: number | null;
  conductorUnitSize: number | null;
  conductorFlatValue: number | null;
  saveWeekMode: string;
};
```

### 6b. Map the new field in the fetch (replace lines 236-251, inside `ConductorCategoryPointsSection`)

```ts
  useEffect(() => {
    fetch("/api/conductor/category-points")
      .then((res) => res.json())
      .then((data) =>
        setRows(
          (data.categories ?? []).map((c: ConductorCategoryApiRow) => ({
            categoryKey: c.key,
            name: c.name,
            mode: c.conductorMode === "rate" || c.conductorMode === "flat" ? c.conductorMode : "off",
            pointsPerUnit: c.conductorPointsPerUnit != null ? String(c.conductorPointsPerUnit) : "",
            unitSize: c.conductorUnitSize != null ? String(c.conductorUnitSize) : "",
            flatValue: c.conductorFlatValue != null ? String(c.conductorFlatValue) : "",
            saveWeekMode: c.saveWeekMode === "zero" || c.saveWeekMode === "capped" ? c.saveWeekMode : "full",
          }))
        )
      )
      .finally(() => setLoading(false));
  }, []);
```

### 6c. Send `saveWeekMode` on save (replace lines 258-275)

```ts
  async function handleSave() {
    setSaving(true);
    setSaved(false);
    const items = rows.map((r) => ({
      categoryKey: r.categoryKey,
      mode: r.mode,
      pointsPerUnit: r.mode === "rate" ? Number(r.pointsPerUnit) || 0 : null,
      unitSize: r.mode === "rate" ? Number(r.unitSize) || 1 : null,
      flatValue: r.mode === "flat" ? Number(r.flatValue) || 0 : null,
      saveWeekMode: r.saveWeekMode,
    }));
    await fetch("/api/conductor/category-points", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });
    setSaving(false);
    setSaved(true);
  }
```

### 6d. Add the "Save Week Mode" column

Replace the table header (lines 285-291):

```tsx
        <table className="text-sm border-collapse">
          <thead>
            <tr className="text-left text-xs font-medium text-neutral-500">
              <th className="py-1 pr-4">Category</th>
              <th className="py-1 pr-4">Mode</th>
              <th className="py-1 pr-4">Save Week</th>
            </tr>
          </thead>
```

Add a new `<td>` right after the existing Mode `<td>` closes (i.e. right
after line 339's `</td>`, before line 340's `</tr>`):

```tsx
                <td className="py-2 pr-4">
                  <select
                    value={row.saveWeekMode}
                    onChange={(e) => patch(row.categoryKey, { saveWeekMode: e.target.value as ConductorCategoryRow["saveWeekMode"] })}
                    className="border border-neutral-300 rounded px-2 py-1"
                  >
                    <option value="full">Full points</option>
                    <option value="zero">Zero points</option>
                    <option value="capped">Capped</option>
                  </select>
                </td>
```

And update the empty-state `colSpan` on the now-3-column table (line 344):
`colSpan={2}` → `colSpan={3}`.

Also update the section's description paragraph (lines 280-283) to mention
the new column:

```tsx
      <p className="text-neutral-500 text-xs">
        Rate scores (weekly value / unit size) × points per unit; Flat scores a fixed value for any week the
        member has a value at all; Off doesn&apos;t contribute to Conductor points. Save Week controls what
        happens to this category during a week marked as a Save Week below - Full ignores it, Zero always
        scores 0 that week, Capped scores as if the value were capped at that week&apos;s configured maximum.
      </p>
```

### 6e. New `SaveWeeksSection` component

Add this new component after `ConductorCategoryPointsSection` closes (after
line 364), and render it in the page between
`<ConductorCategoryPointsSection />` (line 195) and the Recalculate section
(lines 197-206):

```tsx
      <ConductorCategoryPointsSection />

      <SaveWeeksSection />

      <div className="border border-neutral-200 rounded max-w-md p-4 flex flex-col gap-3">
        {/* existing Recalculate section, unchanged */}
```

Component:

```tsx
type SaveWeekApiRow = { id: number; weekNumber: number; endDate: string; active: boolean; capValues: Record<string, number> };
type SaveWeekDraft = { id: number | null; weekNumber: string; endDate: string; active: boolean; capValues: Record<string, string> };

function emptyDraft(): SaveWeekDraft {
  return { id: null, weekNumber: "", endDate: "", active: true, capValues: {} };
}

function SaveWeeksSection() {
  const [saveWeeks, setSaveWeeks] = useState<SaveWeekApiRow[]>([]);
  const [cappedCategories, setCappedCategories] = useState<{ key: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<SaveWeekDraft>(emptyDraft());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    Promise.all([
      fetch("/api/conductor/save-weeks").then((res) => res.json()),
      fetch("/api/conductor/category-points").then((res) => res.json()),
    ])
      .then(([sw, cp]) => {
        setSaveWeeks(sw.saveWeeks ?? []);
        setCappedCategories(
          (cp.categories ?? []).filter((c: ConductorCategoryApiRow) => c.saveWeekMode === "capped").map((c: ConductorCategoryApiRow) => ({ key: c.key, name: c.name }))
        );
      })
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  function editRow(row: SaveWeekApiRow) {
    setError(null);
    setDraft({
      id: row.id,
      weekNumber: String(row.weekNumber),
      endDate: row.endDate,
      active: row.active,
      capValues: Object.fromEntries(Object.entries(row.capValues).map(([k, v]) => [k, String(v)])),
    });
  }

  async function handleSave() {
    setError(null);
    const weekNumber = Number(draft.weekNumber);
    if (!Number.isInteger(weekNumber) || weekNumber < 1) {
      setError("Week number must be a whole number >= 1.");
      return;
    }
    if (!draft.endDate) {
      setError("End date is required.");
      return;
    }
    const capValues: Record<string, number> = {};
    for (const c of cappedCategories) {
      const raw = draft.capValues[c.key];
      if (raw !== undefined && raw !== "") capValues[c.key] = Number(raw) || 0;
    }
    const body = JSON.stringify({ weekNumber, endDate: draft.endDate, active: draft.active, capValues });
    setSaving(true);
    const res = await fetch(draft.id ? `/api/conductor/save-weeks/${draft.id}` : "/api/conductor/save-weeks", {
      method: draft.id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) {
      setError(data.error ?? "Save failed.");
      return;
    }
    setDraft(emptyDraft());
    load();
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this Save Week entry? This recalculates every confirmed conductor selection afterward.")) return;
    setSaving(true);
    await fetch(`/api/conductor/save-weeks/${id}`, { method: "DELETE" });
    setSaving(false);
    if (draft.id === id) setDraft(emptyDraft());
    load();
  }

  return (
    <div className="border border-neutral-200 rounded p-4 flex flex-col gap-3 max-w-2xl">
      <div className="font-semibold">Save Weeks</div>
      <p className="text-neutral-500 text-xs">
        Mark a week as a Save Week to apply each category&apos;s Save Week mode (set above) for that week. Saving,
        editing, or deleting an entry here recalculates every confirmed conductor selection&apos;s points afterward.
      </p>

      <table className="text-sm border-collapse">
        <thead>
          <tr className="text-left text-xs font-medium text-neutral-500">
            <th className="py-1 pr-4">Week</th>
            <th className="py-1 pr-4">End date</th>
            <th className="py-1 pr-4">Active</th>
            <th className="py-1 pr-4"></th>
          </tr>
        </thead>
        <tbody>
          {saveWeeks.map((row) => (
            <tr key={row.id} className="border-t border-neutral-100">
              <td className="py-2 pr-4">{row.weekNumber}</td>
              <td className="py-2 pr-4">{row.endDate}</td>
              <td className="py-2 pr-4">{row.active ? "Yes" : "No"}</td>
              <td className="py-2 pr-4 flex gap-2">
                <button onClick={() => editRow(row)} className="text-accent underline text-xs">
                  Edit
                </button>
                <button onClick={() => handleDelete(row.id)} className="text-red-600 underline text-xs">
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {!loading && saveWeeks.length === 0 && (
            <tr>
              <td colSpan={4} className="py-2 text-neutral-400">
                No Save Weeks configured.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="border-t border-neutral-200 pt-3 flex flex-col gap-2">
        <div className="text-xs font-medium text-neutral-600">{draft.id ? `Editing week ${draft.weekNumber}` : "Add a Save Week"}</div>
        <div className="flex items-end gap-3 flex-wrap">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-neutral-500">Week number</label>
            <input
              type="number"
              min={1}
              value={draft.weekNumber}
              onChange={(e) => setDraft((d) => ({ ...d, weekNumber: e.target.value }))}
              className="border border-neutral-300 rounded px-2 py-1 w-24"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-neutral-500">End date (Sunday)</label>
            <input
              type="date"
              value={draft.endDate}
              onChange={(e) => setDraft((d) => ({ ...d, endDate: e.target.value }))}
              className="border border-neutral-300 rounded px-2 py-1"
            />
          </div>
          <label className="flex items-center gap-2 text-sm pb-1">
            <input type="checkbox" checked={draft.active} onChange={(e) => setDraft((d) => ({ ...d, active: e.target.checked }))} />
            Save Week active
          </label>
        </div>

        {cappedCategories.length > 0 && (
          <div className="flex flex-col gap-2 mt-1">
            <div className="text-xs text-neutral-500">Caps for categories set to &quot;Capped&quot; above:</div>
            <div className="flex gap-4 flex-wrap">
              {cappedCategories.map((c) => (
                <div key={c.key} className="flex flex-col gap-1">
                  <label className="text-xs text-neutral-500">{c.name}</label>
                  <input
                    type="number"
                    step="any"
                    placeholder="uncapped"
                    value={draft.capValues[c.key] ?? ""}
                    onChange={(e) => setDraft((d) => ({ ...d, capValues: { ...d.capValues, [c.key]: e.target.value } }))}
                    className="border border-neutral-300 rounded px-2 py-1 w-32"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {error && <p className="text-red-600 text-sm">{error}</p>}

        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-accent text-accent-contrast rounded px-4 py-2 text-sm disabled:opacity-50 self-start"
          >
            {saving ? "Saving…" : draft.id ? "Save changes" : "Add Save Week"}
          </button>
          {draft.id && (
            <button onClick={() => setDraft(emptyDraft())} className="text-neutral-500 text-sm underline">
              Cancel edit
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
```

### 6f. Update `RecalculateButton`'s negative-results messaging

Replace the `RecalculateResult` type (lines 366-370) and the amber box
(lines 407-419) to match the new informational framing and the added
`rawValue` field:

```ts
type RecalculateResult = {
  updated: number;
  unchanged: number;
  flaggedNegative: {
    memberId: number;
    memberName: string;
    roundId: number;
    startWeek: number;
    oldValue: number | null;
    newValue: number;
    rawValue: number;
  }[];
};
```

```tsx
          {result.flaggedNegative.length > 0 && (
            <div className="border border-neutral-200 bg-neutral-50 rounded p-2 text-xs">
              <p className="font-medium text-neutral-700 mb-1">
                {result.flaggedNegative.length} selection(s) were floored to 0 - the raw calculation went negative
                (e.g. a Save Week change, a divisor correction, or a round&apos;s start week), but a member can
                never carry negative points past a week they were selected in, so these were reset to 0 instead:
              </p>
              {result.flaggedNegative.map((f, i) => (
                <p key={i} className="text-neutral-600">
                  {f.memberName} - round starting week {f.startWeek}: {f.rawValue.toFixed(2)} → 0
                </p>
              ))}
            </div>
          )}
```

(Changed from amber/warning styling to neutral, since this is no longer a
bug signal.)

---

## 7. Version bump

Bump `lib/version.ts`'s `MINOR` by 1 from whatever it is at deploy time
(`MINOR = 46` as of this write-up; if this ships in the same deploy as the
Desert Storm carry-over fix, bump once for both, not twice).

---

## Test plan

1. **Schema**: run `npx prisma db push` then `npx prisma generate`. Confirm
   the app still builds and existing Conductor Settings/Standings pages
   still load (every existing category defaults `saveWeekMode` to `"full"`,
   so nothing changes for anyone until an admin touches the new controls).
2. **Zero mode**: set VS to Save Week mode "Zero". Add a Save Week entry for
   a week where a member has a VS value and is active as Conductor.
   Recalculate (or just check Standings, which reads live). Confirm that
   member's VS points for that week don't count, while every other
   category's points for that week are unaffected.
3. **Capped mode**: set VS to "Capped", set a cap of e.g. 70,000,000 (raw)
   for that Save Week. Confirm a member with a raw VS value of 300,000,000
   scores as if their value were 70,000,000, and a member with a raw value
   below the cap (e.g. 40,000,000) is unaffected.
4. **No cap entered**: set a different category to "Capped" but leave that
   category's cap blank for a Save Week. Confirm it scores as "Full" for
   that category that week (the documented fail-open default).
5. **Toggle off**: set the Save Week's Active toggle off. Confirm every
   category reverts to normal (uncapped/unzeroed) scoring for that week
   without deleting the entry or its cap values.
6. **Auto-recalc**: create, edit, and delete a Save Week entry; separately,
   change a category's Save Week mode via
   `ConductorCategoryPointsSection` and save. Confirm each of these three
   actions alone (not clicking the manual Recalculate button) updates
   Standings/Conductor Statement correctly.
7. **Zero-floor firm rule**: pick a member who is currently a confirmed
   Conductor selection with a comfortably positive balance. Make a change
   that would drop their recalculated balance below the amount already
   reset at their selection (e.g. mark one of their heavily-weighted
   categories as "Zero" for a Save Week before their selection's snapshot
   week). Run Recalculate. Confirm: (a) their stored `pointsAtSelection`
   floors at 0, never negative; (b) if they have a LATER selection after
   this one, that later selection's chain correctly starts from the floored
   (0) prior-resets value, not a negative one; (c) the Recalculate button's
   summary lists them under the (now neutral-styled, informational)
   floored-to-zero section with the correct `rawValue` shown.
8. **Regression**: with no Save Weeks configured at all, confirm Standings
   and Recalculate produce byte-identical results to before this change for
   every existing member/category/week.
