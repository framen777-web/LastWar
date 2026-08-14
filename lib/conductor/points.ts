import { prisma } from "@/lib/db";
import { getConductorCategoryWeekValues, type CategoryWeekValue } from "./stats";
import { getConductorSettings } from "./settings";

export type ConductorCategoryConfig = {
  key: string;
  conductorMode: string; // "off" | "rate" | "flat"
  conductorPointsPerUnit: number | null;
  conductorUnitSize: number | null;
  conductorFlatValue: number | null;
};

export type MemberStanding = {
  memberId: number;
  memberName: string;
  accumulated: number;
  lessSelected: number;
  total: number;
};

/** Points earned for one member/category/week under that category's conductor config. */
export function pointsForCategoryWeek(category: ConductorCategoryConfig, cw: CategoryWeekValue | undefined): number {
  if (!cw || !cw.present) return 0;
  if (category.conductorMode === "rate") {
    const unitSize = category.conductorUnitSize || 1;
    const perUnit = category.conductorPointsPerUnit ?? 0;
    return (cw.value / unitSize) * perUnit;
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
  weekNumber: number
): number {
  let total = 0;
  for (const category of categories) {
    total += pointsForCategoryWeek(category, values.get(`${memberId}:${weekNumber}:${category.key}`));
  }
  return total;
}

/** Sum of a member's earned points over an inclusive week range - the building block for both live standings (unbounded upper end) and point recalculation (bounded to a specific snapshot week). */
export function sumEarnedPoints(
  categories: ConductorCategoryConfig[],
  values: Map<string, CategoryWeekValue>,
  memberId: number,
  fromWeek: number,
  throughWeek: number
): number {
  let total = 0;
  for (let week = fromWeek; week <= throughWeek; week++) {
    total += earnedPointsForWeek(categories, values, memberId, week);
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
  const [members, categories, values] = await Promise.all([
    prisma.member.findMany({ where: { isActive: true } }),
    prisma.category.findMany({ where: { active: true, conductorMode: { not: "off" } } }),
    getConductorCategoryWeekValues(),
  ]);

  let maxWeek = settings.fromWeek;
  for (const key of values.keys()) {
    const weekNumber = Number(key.split(":")[1]);
    if (weekNumber > maxWeek) maxWeek = weekNumber;
  }

  const earnedByMember = new Map<number, number>();
  for (const member of members) {
    earnedByMember.set(member.id, sumEarnedPoints(categories, values, member.id, settings.fromWeek, maxWeek));
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
  flaggedNegative: { memberId: number; memberName: string; roundId: number; startWeek: number; oldValue: number | null; newValue: number }[];
};

/**
 * Recomputes every confirmed conductor selection's `pointsAtSelection` from real stats
 * data rather than trusting whatever was imported/typed in. A conductor round is decided
 * in advance - e.g. a week 64-65 round is picked at the end of week 63 - so the frozen
 * reset amount must be the member's balance as of `round.startWeek - 1`, chained in
 * round-start order per member (each selection's reset must already be net of every
 * earlier one, or the flat subtraction in computeStandings can go negative - the bug
 * this fixes). Negative results after recalculation are NOT clamped to 0 - they're
 * reported back so a deeper issue (e.g. a wrong startWeek) can be investigated instead
 * of silently hidden.
 */
export async function recalculateSelectionPoints(): Promise<RecalculateResult> {
  const settings = await getConductorSettings();
  const [categories, values, selections] = await Promise.all([
    prisma.category.findMany({ where: { active: true, conductorMode: { not: "off" } } }),
    getConductorCategoryWeekValues(),
    prisma.conductorSelection.findMany({
      where: { role: "conductor", memberId: { not: null }, round: { status: "confirmed" } },
      include: { round: true, member: true },
    }),
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
      const earned = sumEarnedPoints(categories, values, memberId, settings.fromWeek, snapshotWeek);
      const newValue = earned - priorResets;
      updates.push({
        id: sel.id,
        oldValue: sel.pointsAtSelection,
        newValue,
        memberId,
        memberName: sel.member?.name ?? "",
        roundId: sel.roundId,
        startWeek: sel.round.startWeek,
      });
      priorResets += newValue;
    }
  }

  await prisma.$transaction(updates.map((u) => prisma.conductorSelection.update({ where: { id: u.id }, data: { pointsAtSelection: u.newValue } })));

  let updated = 0;
  let unchanged = 0;
  const flaggedNegative: RecalculateResult["flaggedNegative"] = [];
  for (const u of updates) {
    if (u.oldValue === null || Math.abs(u.oldValue - u.newValue) > 0.0001) updated++;
    else unchanged++;
    if (u.newValue < 0) {
      flaggedNegative.push({
        memberId: u.memberId,
        memberName: u.memberName,
        roundId: u.roundId,
        startWeek: u.startWeek,
        oldValue: u.oldValue,
        newValue: u.newValue,
      });
    }
  }

  return { updated, unchanged, flaggedNegative };
}
