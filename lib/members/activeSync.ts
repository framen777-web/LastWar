import { prisma } from "@/lib/db";
import { effectiveRole } from "@/lib/auth/roles";
import { getActiveMemberIdsForWeek, getMemberIdsWithHistoryThroughWeek } from "./weekActivity";

// A member only flips to Inactive after missing data in ALL of the last INACTIVE_GRACE_WEEKS
// completed weeks - one missed screenshot shouldn't read the same as "this person left."
const INACTIVE_GRACE_WEEKS = 2;

// "Active" for a plain Member means "had data in at least one of the last INACTIVE_GRACE_WEEKS
// completed weeks" - the weeks before whatever the most recent week with any data is (that
// latest week is still being imported/in progress, not yet a fair completeness signal). Admin/
// Leader accounts are never touched here - an officer who didn't personally submit a
// screenshot one week shouldn't lose login access over it, so their isActive stays under
// manual control (Setup -> Users). A member who has never had a single completed week of data
// yet is also never touched here - see everHadHistory below - so a fresh Member row's default
// isActive: true survives untouched until they've had a fair chance to show up.
export async function syncMemberActiveStatus(): Promise<{ lastCompletedWeek: number | null }> {
  const latest = await prisma.weeklyStat.findFirst({ orderBy: { weekNumber: "desc" }, select: { weekNumber: true } });
  if (!latest) return { lastCompletedWeek: null };

  const lastCompletedWeek = latest.weekNumber - 1;
  if (lastCompletedWeek < 1) return { lastCompletedWeek };

  const weeksToCheck = Array.from({ length: INACTIVE_GRACE_WEEKS }, (_, i) => lastCompletedWeek - i).filter((w) => w >= 1);
  const weekSets = await Promise.all(weeksToCheck.map((w) => getActiveMemberIdsForWeek(w)));
  const activeIds = new Set(weekSets.flatMap((s) => [...s]));

  // Anyone who has never had a single completed week of data yet is too new to judge - leave
  // them exactly as they are. A fresh Member row defaults to isActive: true, so this is what
  // actually grants a brand-new member working login access from day one (general password
  // included) instead of getting silently locked out the next time this page loads.
  const everHadHistory = await getMemberIdsWithHistoryThroughWeek(lastCompletedWeek);

  const members = await prisma.member.findMany({
    select: { id: true, role: true, allianceRank: true, isActive: true },
  });

  // Batched into at most two updateMany calls instead of one awaited update() per drifted
  // member - this ran on every /api/users load (including before/after every member merge),
  // so a sequential per-row loop turned into real, user-visible latency once there was any
  // drift to correct.
  const toActivate: number[] = [];
  const toDeactivate: number[] = [];
  for (const m of members) {
    if (effectiveRole(m) !== "MEMBER") continue;
    if (!everHadHistory.has(m.id)) continue;
    const shouldBeActive = activeIds.has(m.id);
    if (m.isActive === shouldBeActive) continue;
    (shouldBeActive ? toActivate : toDeactivate).push(m.id);
  }

  await Promise.all([
    toActivate.length > 0 ? prisma.member.updateMany({ where: { id: { in: toActivate } }, data: { isActive: true } }) : null,
    toDeactivate.length > 0 ? prisma.member.updateMany({ where: { id: { in: toDeactivate } }, data: { isActive: false } }) : null,
  ]);

  return { lastCompletedWeek };
}
