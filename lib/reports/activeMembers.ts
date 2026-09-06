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

/**
 * Union of getActiveMemberIdsForWeek for weekNumber and weekNumber - 1 - "on the current
 * roster AND part of the last completed roster." This is the roster window every
 * multi-week report should filter to, so a departed member drops off within a week of
 * leaving instead of lingering in all-time/summary views forever. weekNumber is normally
 * the report's own "current/selected" week, not necessarily today's actual latest week -
 * so a report pinned to a past week gets that week's own roster, not today's.
 */
export async function getRosterMemberIdsForWeeks(weekNumber: number): Promise<Set<number>> {
  const [current, previous] = await Promise.all([
    getActiveMemberIdsForWeek(weekNumber),
    weekNumber > 1 ? getActiveMemberIdsForWeek(weekNumber - 1) : Promise.resolve(new Set<number>()),
  ]);
  return new Set([...current, ...previous]);
}
