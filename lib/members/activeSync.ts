import { prisma } from "@/lib/db";
import { effectiveRole } from "@/lib/auth/roles";
import { getActiveMemberIdsForWeek } from "./weekActivity";

// "Active" for a plain Member means "had data in the last COMPLETED week" - the week
// before whatever the most recent week with any data is (that latest week is still being
// imported/in progress, not yet a fair completeness signal). Admin/Leader accounts are
// never touched here - an officer who didn't personally submit a screenshot one week
// shouldn't lose login access over it, so their isActive stays under manual control
// (Setup -> Users).
export async function syncMemberActiveStatus(): Promise<{ lastCompletedWeek: number | null }> {
  const latest = await prisma.weeklyStat.findFirst({ orderBy: { weekNumber: "desc" }, select: { weekNumber: true } });
  if (!latest) return { lastCompletedWeek: null };

  const lastCompletedWeek = latest.weekNumber - 1;
  if (lastCompletedWeek < 1) return { lastCompletedWeek };

  const activeIds = await getActiveMemberIdsForWeek(lastCompletedWeek);

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
