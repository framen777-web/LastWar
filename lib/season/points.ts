import { prisma } from "@/lib/db";
import { getConductorCategoryWeekValues } from "@/lib/conductor/stats";

export type PointsConfig = {
  mode: string; // "rate" | "flat"
  pointsPerUnit: number | null;
  unitSize: number | null;
  flatValue: number | null;
};

/** Points earned from one numeric value under a rate/flat points config. Shared by both the
 *  per-week category path and the one-time extra-item path below. */
function pointsForValue(config: PointsConfig, value: number): number {
  if (config.mode === "rate") {
    const unitSize = config.unitSize || 1;
    return (value / unitSize) * (config.pointsPerUnit ?? 0);
  }
  if (config.mode === "flat") {
    return value > 0 ? (config.flatValue ?? 0) : 0;
  }
  return 0;
}

export type MemberSeasonScore = {
  memberId: number;
  memberName: string;
  categoryPoints: Record<string, number>; // categoryKey -> points earned
  extraPoints: Record<string, number>; // extraItem key -> points earned
  seasonPoints: number;
};

/** Live computation of every active member's season score from current data and current season
 *  config. Used for the draft report and for finalizing. Never reads SeasonResult. */
export async function computeSeasonScores(seasonId: number): Promise<MemberSeasonScore[]> {
  const season = await prisma.season.findUniqueOrThrow({
    where: { id: seasonId },
    include: { categoryPoints: true, extraItems: { include: { values: true } } },
  });

  const [members, weekValues] = await Promise.all([
    prisma.member.findMany({ where: { isActive: true } }), // departed members excluded from ranking/rewards, same convention as VS Clubs
    getConductorCategoryWeekValues(),
  ]);

  return members
    .map((member) => {
      const categoryPoints: Record<string, number> = {};
      for (const cp of season.categoryPoints) {
        let total = 0;
        for (let week = season.weekStart; week <= season.weekEnd; week++) {
          const cw = weekValues.get(`${member.id}:${week}:${cp.categoryKey}`);
          if (cw?.present) total += pointsForValue(cp, cw.value);
        }
        categoryPoints[cp.categoryKey] = total;
      }

      const extraPoints: Record<string, number> = {};
      for (const item of season.extraItems) {
        const raw = item.values.find((v) => v.memberId === member.id)?.rawValue ?? 0;
        extraPoints[item.key] = pointsForValue(item, raw);
      }

      const seasonPoints =
        Object.values(categoryPoints).reduce((a, b) => a + b, 0) + Object.values(extraPoints).reduce((a, b) => a + b, 0);

      return { memberId: member.id, memberName: member.name, categoryPoints, extraPoints, seasonPoints };
    })
    .sort((a, b) => b.seasonPoints - a.seasonPoints || a.memberName.localeCompare(b.memberName)); // ties broken by name, deterministic
}
