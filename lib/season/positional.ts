import { prisma } from "@/lib/db";
import { getConductorCategoryWeekValues } from "@/lib/conductor/stats";
import { computeRanks } from "@/lib/mvp/mvp";

/** Best commander in a category (highest ascending rank, N) scores 100; worst (rank 1) scores 0;
 *  linear in between. A field with only one ranked member (n<=1) can't produce a meaningful
 *  relative comparison, so it scores everyone 100 rather than dividing by zero. */
function positionalScore(rank: number, n: number): number {
  if (n <= 1) return 100;
  return (100 * (rank - 1)) / (n - 1);
}

export type CategoryPositionalDetail = { rank: number; n: number; positionalScore: number; weight: number; contribution: number };

export type MemberPositionalScore = {
  memberId: number;
  memberName: string;
  categoryDetail: Record<string, CategoryPositionalDetail>;
  extraDetail: Record<string, CategoryPositionalDetail>;
  seasonScore: number;
};

/** Sums a category's per-week values (same cumulative-aware source as points mode) over the
 *  season's range into one season total per member - null if the member has no data at all for
 *  this category in this range, so computeRanks scores them as "missing" (worst, per its own
 *  documented convention) rather than as a real zero. */
function seasonTotalsForCategory(
  categoryKey: string,
  members: { id: number }[],
  weekValues: Map<string, { value: number; present: boolean }>,
  weekStart: number,
  weekEnd: number
): (number | null)[] {
  return members.map((m) => {
    let sum = 0;
    let present = false;
    for (let week = weekStart; week <= weekEnd; week++) {
      const v = weekValues.get(`${m.id}:${week}:${categoryKey}`);
      if (v?.present) {
        sum += v.value;
        present = true;
      }
    }
    return present ? sum : null;
  });
}

/** Live computation of every active member's season score from current data and current season
 *  config, under positional mode. A member who reported in only some of the season's weeks is
 *  ranked on the sum of what they actually reported, same as everyone else - "works like MVP"
 *  here means reusing its rank-to-score mechanism, not literally re-running it per week. */
export async function computeSeasonPositional(seasonId: number): Promise<MemberPositionalScore[]> {
  const season = await prisma.season.findUniqueOrThrow({
    where: { id: seasonId },
    include: { categoryWeights: true, extraItems: { include: { values: true } } },
  });

  const [members, weekValues] = await Promise.all([
    prisma.member.findMany({ where: { isActive: true } }),
    getConductorCategoryWeekValues(),
  ]);
  const n = members.length;

  // One rank array per included category/item, computed once (not per member) for efficiency.
  const categoryRanks = new Map<string, number[]>();
  for (const cw of season.categoryWeights) {
    const totals = seasonTotalsForCategory(cw.categoryKey, members, weekValues, season.weekStart, season.weekEnd);
    categoryRanks.set(cw.categoryKey, computeRanks(totals));
  }
  const extraRanks = new Map<string, number[]>();
  const weightedExtraItems = season.extraItems.filter((i) => i.weight != null);
  for (const item of weightedExtraItems) {
    const totals = members.map((m) => item.values.find((v) => v.memberId === m.id)?.rawValue ?? null);
    extraRanks.set(item.key, computeRanks(totals));
  }

  return members
    .map((member, i) => {
      const categoryDetail: Record<string, CategoryPositionalDetail> = {};
      let seasonScore = 0;
      for (const cw of season.categoryWeights) {
        const rank = categoryRanks.get(cw.categoryKey)![i];
        const score = positionalScore(rank, n);
        const contribution = score * cw.weight;
        categoryDetail[cw.categoryKey] = { rank, n, positionalScore: score, weight: cw.weight, contribution };
        seasonScore += contribution;
      }

      const extraDetail: Record<string, CategoryPositionalDetail> = {};
      for (const item of weightedExtraItems) {
        const rank = extraRanks.get(item.key)![i];
        const score = positionalScore(rank, n);
        const contribution = score * (item.weight ?? 0);
        extraDetail[item.key] = { rank, n, positionalScore: score, weight: item.weight ?? 0, contribution };
        seasonScore += contribution;
      }

      return { memberId: member.id, memberName: member.name, categoryDetail, extraDetail, seasonScore };
    })
    .sort((a, b) => b.seasonScore - a.seasonScore || a.memberName.localeCompare(b.memberName));
}
