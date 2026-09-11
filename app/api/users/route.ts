import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/dal";
import { effectiveRole } from "@/lib/auth/roles";
import { getGeneralPassword } from "@/lib/settings";
import { syncMemberActiveStatus } from "@/lib/members/activeSync";
import { getActiveMemberIdsForWeek, getMemberIdsWithHistoryThroughWeek } from "@/lib/members/weekActivity";
import { bestMatchExcluding } from "@/lib/pipeline/matchMemberCore";

const RECENT_WEEKS = 3;
const SUGGESTION_SIMILARITY_FLOOR = 0.6; // below this, not worth surfacing - too likely noise

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

  // "Ever had a completed week of data" (not just the last-3-weeks window above) - lets the
  // Users page tell "too new to judge" (auto-created this week, no completed week yet) apart
  // from "actually gone quiet" (had completed weeks before, just not recently), which the
  // isActive flag alone can't distinguish. Same helper activeSync.ts uses to decide who's too
  // new to evaluate for deactivation - one shared definition of "has any history yet."
  const everHadCompletedWeekIds =
    lastCompletedWeek !== null ? await getMemberIdsWithHistoryThroughWeek(lastCompletedWeek) : new Set<number>();

  const generalPasswordSet = !!(await getGeneralPassword());
  const members = await prisma.member.findMany({ orderBy: { name: "asc" } });

  return NextResponse.json({
    lastCompletedWeek,
    generalPasswordSet,
    users: members.map((m) => {
      const role = effectiveRole(m);
      const hasPassword = !!m.passwordHash;
      const suggestedMerge = !m.nameConfirmed ? suggestClosestMatch(m, members) : null;
      return {
        id: m.id,
        name: m.name,
        allianceRank: m.allianceRank,
        roleOverride: m.role,
        effectiveRole: role,
        hasPassword,
        canLogIn: hasPassword || (role !== "ADMIN" && generalPasswordSet),
        isActive: m.isActive,
        nameConfirmed: m.nameConfirmed,
        loginAlias: m.loginAlias,
        recentlyActive: recentlyActiveIds.has(m.id),
        everHadCompletedWeek: everHadCompletedWeekIds.has(m.id),
        suggestedMerge,
        aliases: m.aliases
          ? m.aliases.split(",").map((a) => a.trim()).filter(Boolean)
          : [],
      };
    }),
  });
}

function suggestClosestMatch(
  member: { id: number; name: string },
  members: { id: number; name: string; aliases: string }[]
): { id: number; name: string; similarity: number } | null {
  const match = bestMatchExcluding(member.name, member.id, members);
  if (!match || match.similarity < SUGGESTION_SIMILARITY_FLOOR) return null;
  return { id: match.id, name: match.name, similarity: Math.round(match.similarity * 100) };
}
