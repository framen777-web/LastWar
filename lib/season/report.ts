import { prisma } from "@/lib/db";
import { computeSeasonPoints } from "./points";
import { computeSeasonPositional, type CategoryPositionalDetail } from "./positional";
import { distributeBands } from "./bands";

export type SeasonReportRow = {
  memberId: number;
  memberName: string;
  rank: number;
  // categoryKey/extraKey -> the number shown in that column: raw points in points mode, the
  // weighted contribution (positionalScore * weight) in positional mode - either way, "how much
  // of seasonScore this item contributed."
  categoryValues: Record<string, number>;
  extraValues: Record<string, number>;
  seasonScore: number;
  bandOrder: number | null;
  boxesAwarded: number;
};

export type SeasonReportData = {
  season: {
    id: number;
    name: string;
    weekStart: number;
    weekEnd: number;
    totalBoxes: number;
    status: string;
    finalizedAt: Date | null;
    scoringMode: string;
  };
  categories: { key: string; name: string }[];
  extraItems: { key: string; name: string }[];
  rows: SeasonReportRow[];
  unallocatedBoxes: number;
};

type StoredBreakdown = {
  mode?: string;
  categories?: Record<string, number | CategoryPositionalDetail>;
  extras?: Record<string, number | CategoryPositionalDetail>;
};

function breakdownValue(v: number | CategoryPositionalDetail | undefined): number {
  if (v === undefined) return 0;
  return typeof v === "number" ? v : v.contribution;
}

/**
 * One computation shared by the on-screen report and its Excel export, so both are always
 * built from the same underlying numbers (same convention as getAllianceDetailData). A
 * "final" season reads the frozen SeasonResult rows; "draft" computes live from current
 * data/config under whichever scoringMode is currently active - same as picking Finalize
 * would produce right now. scoringMode itself is part of the locked config, so it can't have
 * changed between finalize time and now for a "final" season.
 */
export async function getSeasonReportData(seasonId: number): Promise<SeasonReportData | null> {
  const season = await prisma.season.findUnique({
    where: { id: seasonId },
    include: { categoryPoints: true, categoryWeights: true, extraItems: true, bands: { orderBy: { order: "asc" } } },
  });
  if (!season) return null;

  const isPositional = season.scoringMode === "positional";
  const categoryKeys = isPositional ? season.categoryWeights.map((c) => c.categoryKey) : season.categoryPoints.map((c) => c.categoryKey);
  const categoryRows = categoryKeys.length > 0 ? await prisma.category.findMany({ where: { key: { in: categoryKeys } } }) : [];
  const categoryNameByKey = new Map(categoryRows.map((c) => [c.key, c.name]));
  const categories = categoryKeys.map((key) => ({ key, name: categoryNameByKey.get(key) ?? key }));

  const includedExtraItems = season.extraItems.filter((i) => (isPositional ? i.weight != null : i.mode != null));
  const extraItems = includedExtraItems.map((i) => ({ key: i.key, name: i.name }));

  const seasonMeta = {
    id: season.id,
    name: season.name,
    weekStart: season.weekStart,
    weekEnd: season.weekEnd,
    totalBoxes: season.totalBoxes,
    status: season.status,
    finalizedAt: season.finalizedAt,
    scoringMode: season.scoringMode,
  };

  if (season.status === "final") {
    const results = await prisma.seasonResult.findMany({ where: { seasonId }, include: { member: true }, orderBy: { rank: "asc" } });
    const rows: SeasonReportRow[] = results.map((r) => {
      const breakdown = JSON.parse(r.breakdown) as StoredBreakdown;
      const categoryValues: Record<string, number> = {};
      for (const c of categories) categoryValues[c.key] = breakdownValue(breakdown.categories?.[c.key]);
      const extraValues: Record<string, number> = {};
      for (const i of extraItems) extraValues[i.key] = breakdownValue(breakdown.extras?.[i.key]);
      return {
        memberId: r.memberId,
        memberName: r.member.name,
        rank: r.rank,
        categoryValues,
        extraValues,
        seasonScore: r.seasonScore,
        bandOrder: r.bandOrder,
        boxesAwarded: r.boxesAwarded,
      };
    });
    const unallocatedBoxes = season.totalBoxes - rows.reduce((sum, r) => sum + r.boxesAwarded, 0);
    return { season: seasonMeta, categories, extraItems, rows, unallocatedBoxes };
  }

  if (isPositional) {
    const scores = await computeSeasonPositional(seasonId);
    const { assignments } = distributeBands(scores, season.bands, season.totalBoxes);
    const assignmentByMemberId = new Map(assignments.map((a) => [a.memberId, a]));

    const rows: SeasonReportRow[] = scores.map((score) => {
      const assignment = assignmentByMemberId.get(score.memberId)!;
      const categoryValues: Record<string, number> = {};
      for (const c of categories) categoryValues[c.key] = score.categoryDetail[c.key]?.contribution ?? 0;
      const extraValues: Record<string, number> = {};
      for (const i of extraItems) extraValues[i.key] = score.extraDetail[i.key]?.contribution ?? 0;
      return {
        memberId: score.memberId,
        memberName: score.memberName,
        rank: assignment.rank,
        categoryValues,
        extraValues,
        seasonScore: score.seasonScore,
        bandOrder: assignment.bandOrder,
        boxesAwarded: assignment.boxesAwarded,
      };
    });
    const unallocatedBoxes = season.totalBoxes - rows.reduce((sum, r) => sum + r.boxesAwarded, 0);
    return { season: seasonMeta, categories, extraItems, rows, unallocatedBoxes };
  }

  const scores = await computeSeasonPoints(seasonId);
  const { assignments } = distributeBands(scores, season.bands, season.totalBoxes);
  const assignmentByMemberId = new Map(assignments.map((a) => [a.memberId, a]));

  const rows: SeasonReportRow[] = scores.map((score) => {
    const assignment = assignmentByMemberId.get(score.memberId)!;
    return {
      memberId: score.memberId,
      memberName: score.memberName,
      rank: assignment.rank,
      categoryValues: score.categoryPoints,
      extraValues: score.extraPoints,
      seasonScore: score.seasonScore,
      bandOrder: assignment.bandOrder,
      boxesAwarded: assignment.boxesAwarded,
    };
  });
  const unallocatedBoxes = season.totalBoxes - rows.reduce((sum, r) => sum + r.boxesAwarded, 0);
  return { season: seasonMeta, categories, extraItems, rows, unallocatedBoxes };
}
