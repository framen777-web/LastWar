import { prisma } from "@/lib/db";

/**
 * Members with a WeeklyStat or CategoryRecord row for this exact week - the shared
 * definition of "has data for week N" used by active-status syncing and the Member
 * Movement report (where "no data this week" is meant literally - it's what makes someone
 * count as having left).
 */
export async function getActiveMemberIdsForWeek(weekNumber: number): Promise<Set<number>> {
  const [statMembers, recordMembers] = await Promise.all([
    prisma.weeklyStat.findMany({ where: { weekNumber }, select: { memberId: true }, distinct: ["memberId"] }),
    prisma.categoryRecord.findMany({ where: { weekNumber }, select: { memberId: true }, distinct: ["memberId"] }),
  ]);
  return new Set([...statMembers.map((s) => s.memberId), ...recordMembers.map((r) => r.memberId)]);
}

/**
 * Same roster, but for Conductor/Passenger eligibility rather than the Movement report:
 * selections are made in advance (e.g. 2-3 weeks ahead of when they run), so a future
 * week that has no data from *anyone* yet just hasn't started being reported - that's not
 * the same thing as everyone having left. Falls back to the most recent earlier week that
 * has any data at all, the same way the field rankings themselves already do.
 */
export async function getActiveMemberIdsForWeekWithFallback(weekNumber: number): Promise<Set<number>> {
  for (let w = weekNumber; w >= 1; w--) {
    const ids = await getActiveMemberIdsForWeek(w);
    if (ids.size > 0) return ids;
  }
  return new Set();
}
