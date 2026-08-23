import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/dal";
import { loadEditableSeason } from "@/lib/season/validate";
import { computeSeasonScores } from "@/lib/season/points";
import { distributeBands } from "@/lib/season/bands";

// Freezes the current live computation as the official reward list - mirrors
// ConductorSelection.pointsAtSelection, a snapshot rather than something later data
// corrections should move. loadEditableSeason already rejects an already-final season, so
// this can only ever run once per draft period.
export async function POST(_request: Request, ctx: RouteContext<"/api/seasons/[id]/finalize">) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const { id } = await ctx.params;
  const seasonId = Number(id);

  const guard = await loadEditableSeason(seasonId);
  if ("error" in guard) return guard.error;

  const [scores, bands] = await Promise.all([
    computeSeasonScores(seasonId),
    prisma.seasonBand.findMany({ where: { seasonId }, orderBy: { order: "asc" } }),
  ]);

  const { assignments } = distributeBands(scores, bands, guard.season.totalBoxes);
  const assignmentByMemberId = new Map(assignments.map((a) => [a.memberId, a]));

  const resultRows = scores.map((score) => {
    const assignment = assignmentByMemberId.get(score.memberId)!;
    return {
      seasonId,
      memberId: score.memberId,
      rank: assignment.rank,
      seasonPoints: score.seasonPoints,
      bandOrder: assignment.bandOrder,
      boxesAwarded: assignment.boxesAwarded,
      breakdown: JSON.stringify({ categories: score.categoryPoints, extras: score.extraPoints }),
    };
  });

  await prisma.$transaction([
    prisma.seasonResult.deleteMany({ where: { seasonId } }),
    prisma.seasonResult.createMany({ data: resultRows }),
    prisma.season.update({ where: { id: seasonId }, data: { status: "final", finalizedAt: new Date() } }),
  ]);

  return NextResponse.json({ finalized: true, resultCount: resultRows.length });
}
