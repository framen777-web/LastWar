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
