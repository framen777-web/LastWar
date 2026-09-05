import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/dal";
import { effectiveRole } from "@/lib/auth/roles";
import { syncMemberActiveStatus } from "@/lib/members/activeSync";
import { getActiveMemberIdsForWeek } from "@/lib/members/weekActivity";

const RECENT_WEEKS = 3;

export async function GET() {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const { lastCompletedWeek } = await syncMemberActiveStatus();

  // "Recently active" = had a WeeklyStat/CategoryRecord row in any of the last 3 completed
  // weeks (same completed-week anchor as isActive, just a wider window) - used to split the
  // Merge page's member pickers so a genuine same-person duplicate (someone active right
  // now under two spellings) sorts to the top instead of getting lost among everyone who's
  // ever passed through the alliance.
  let recentlyActiveIds = new Set<number>();
  if (lastCompletedWeek !== null) {
    const weekSets = await Promise.all(
      Array.from({ length: RECENT_WEEKS }, (_, i) => lastCompletedWeek - i)
        .filter((w) => w >= 1)
        .map((w) => getActiveMemberIdsForWeek(w))
    );
    recentlyActiveIds = new Set(weekSets.flatMap((s) => [...s]));
  }

  const members = await prisma.member.findMany({ orderBy: { name: "asc" } });

  return NextResponse.json({
    lastCompletedWeek,
    users: members.map((m) => ({
      id: m.id,
      name: m.name,
      allianceRank: m.allianceRank,
      roleOverride: m.role,
      effectiveRole: effectiveRole(m),
      hasPassword: !!m.passwordHash,
      isActive: m.isActive,
      nameConfirmed: m.nameConfirmed,
      loginAlias: m.loginAlias,
      recentlyActive: recentlyActiveIds.has(m.id),
    })),
  });
}
