import { prisma } from "@/lib/db";
import { computeSeasonScores } from "./points";
import { distributeBands } from "./bands";

export type SeasonReportRow = {
  memberId: number;
  memberName: string;
  rank: number;
  categoryPoints: Record<string, number>;
  extraPoints: Record<string, number>;
  seasonPoints: number;
  bandOrder: number | null;
  boxesAwarded: number;
};

export type SeasonReportData = {
  season: { id: number; name: string; weekStart: number; weekEnd: number; totalBoxes: number; status: string; finalizedAt: Date | null };
  categories: { key: string; name: string }[];
  extraItems: { key: string; name: string }[];
  rows: SeasonReportRow[];
  unallocatedBoxes: number;
};

/**
 * One computation shared by the on-screen report and its Excel export, so both are always
 * built from the same underlying numbers (same convention as getAllianceDetailData). A
 * "final" season reads the frozen SeasonResult rows; "draft" computes live from current
 * data/config, same as picking Finalize would produce right now.
 */
export async function getSeasonReportData(seasonId: number): Promise<SeasonReportData | null> {
  const season = await prisma.season.findUnique({
    where: { id: seasonId },
    include: { categoryPoints: true, extraItems: true, bands: { orderBy: { order: "asc" } } },
  });
  if (!season) return null;

  const categoryKeys = season.categoryPoints.map((c) => c.categoryKey);
  const categoryRows = categoryKeys.length > 0 ? await prisma.category.findMany({ where: { key: { in: categoryKeys } } }) : [];
  const categoryNameByKey = new Map(categoryRows.map((c) => [c.key, c.name]));
  const categories = categoryKeys.map((key) => ({ key, name: categoryNameByKey.get(key) ?? key }));
  const extraItems = season.extraItems.map((i) => ({ key: i.key, name: i.name }));

  if (season.status === "final") {
    const results = await prisma.seasonResult.findMany({ where: { seasonId }, include: { member: true }, orderBy: { rank: "asc" } });
    const rows: SeasonReportRow[] = results.map((r) => {
      const breakdown = JSON.parse(r.breakdown) as { categories?: Record<string, number>; extras?: Record<string, number> };
      return {
        memberId: r.memberId,
        memberName: r.member.name,
        rank: r.rank,
        categoryPoints: breakdown.categories ?? {},
        extraPoints: breakdown.extras ?? {},
        seasonPoints: r.seasonPoints,
        bandOrder: r.bandOrder,
        boxesAwarded: r.boxesAwarded,
      };
    });
    const unallocatedBoxes = season.totalBoxes - rows.reduce((sum, r) => sum + r.boxesAwarded, 0);
    return {
      season: {
        id: season.id,
        name: season.name,
        weekStart: season.weekStart,
        weekEnd: season.weekEnd,
        totalBoxes: season.totalBoxes,
        status: season.status,
        finalizedAt: season.finalizedAt,
      },
      categories,
      extraItems,
      rows,
      unallocatedBoxes,
    };
  }

  const scores = await computeSeasonScores(seasonId);
  const { assignments } = distributeBands(scores, season.bands, season.totalBoxes);
  const assignmentByMemberId = new Map(assignments.map((a) => [a.memberId, a]));

  const rows: SeasonReportRow[] = scores.map((score) => {
    const assignment = assignmentByMemberId.get(score.memberId)!;
    return {
      memberId: score.memberId,
      memberName: score.memberName,
      rank: assignment.rank,
      categoryPoints: score.categoryPoints,
      extraPoints: score.extraPoints,
      seasonPoints: score.seasonPoints,
      bandOrder: assignment.bandOrder,
      boxesAwarded: assignment.boxesAwarded,
    };
  });
  const unallocatedBoxes = season.totalBoxes - rows.reduce((sum, r) => sum + r.boxesAwarded, 0);

  return {
    season: {
      id: season.id,
      name: season.name,
      weekStart: season.weekStart,
      weekEnd: season.weekEnd,
      totalBoxes: season.totalBoxes,
      status: season.status,
      finalizedAt: season.finalizedAt,
    },
    categories,
    extraItems,
    rows,
    unallocatedBoxes,
  };
}
