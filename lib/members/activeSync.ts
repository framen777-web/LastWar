import { prisma } from "@/lib/db";
import { effectiveRole } from "@/lib/auth/roles";

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

  // WeeklyStat alone would miss a member who only reported Squads that week - that's
  // free_text (see dashboard/page.tsx), so it only ever produces a CategoryRecord row, no
  // WeeklyStat row. Union both sources so a squads-only reporter still counts as active.
  const [statMembers, recordMembers] = await Promise.all([
    prisma.weeklyStat.findMany({ where: { weekNumber: lastCompletedWeek }, select: { memberId: true }, distinct: ["memberId"] }),
    prisma.categoryRecord.findMany({ where: { weekNumber: lastCompletedWeek }, select: { memberId: true }, distinct: ["memberId"] }),
  ]);
  const activeIds = new Set([...statMembers.map((s) => s.memberId), ...recordMembers.map((r) => r.memberId)]);

  const members = await prisma.member.findMany({
    select: { id: true, role: true, allianceRank: true, isActive: true },
  });

  for (const m of members) {
    if (effectiveRole(m) !== "MEMBER") continue;
    const shouldBeActive = activeIds.has(m.id);
    if (m.isActive !== shouldBeActive) {
      await prisma.member.update({ where: { id: m.id }, data: { isActive: shouldBeActive } });
    }
  }

  return { lastCompletedWeek };
}
