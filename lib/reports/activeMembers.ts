import { prisma } from "@/lib/db";

const WEEKLY_STAT_CATEGORIES = ["power", "kills", "donations", "vs", "desert_storm", "ae", "members", "canyon_storm", "zombie_siege"];

/**
 * Members with at least one recorded value for the given week - the same "active for this
 * week" definition R1's report uses, generalized for reuse. Deliberately not Member.isActive,
 * which only reflects the most recently completed week, not whichever week is being asked
 * about here.
 */
export async function getActiveMemberIdsForWeek(weekNumber: number): Promise<Set<number>> {
  const [stats, squadsCategory] = await Promise.all([
    prisma.weeklyStat.findMany({
      where: { weekNumber, categoryKey: { in: WEEKLY_STAT_CATEGORIES } },
      select: { memberId: true },
      distinct: ["memberId"],
    }),
    prisma.category.findUnique({ where: { key: "squads" } }),
  ]);

  const ids = new Set(stats.map((s) => s.memberId));

  if (squadsCategory) {
    const squadRecords = await prisma.categoryRecord.findMany({
      where: { categoryId: squadsCategory.id, weekNumber, dedupKey: "" },
      select: { memberId: true },
      distinct: ["memberId"],
    });
    for (const r of squadRecords) ids.add(r.memberId);
  }

  return ids;
}
