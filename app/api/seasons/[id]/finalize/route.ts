import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/dal";
import { loadEditableSeason } from "@/lib/season/validate";
import { computeSeasonPoints } from "@/lib/season/points";
import { computeSeasonPositional } from "@/lib/season/positional";
import { distributeBands } from "@/lib/season/bands";

// Freezes the current live computation - under whichever scoringMode is currently active - as
// the official reward list. Mirrors ConductorSelection.pointsAtSelection, a snapshot rather than
// something later data corrections should move. loadEditableSeason already rejects an
// already-final season, so this can only ever run once per draft period.
export async function POST(_request: Request, ctx: RouteContext<"/api/seasons/[id]/finalize">) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const { id } = await ctx.params;
  const seasonId = Number(id);

  const guard = await loadEditableSeason(seasonId);
  if ("error" in guard) return guard.error;

  const bands = await prisma.seasonBand.findMany({ where: { seasonId }, orderBy: { order: "asc" } });

  let resultRows: {
    seasonId: number;
    memberId: number;
    rank: number;
    seasonScore: number;
    bandOrder: number | null;
    boxesAwarded: number;
    breakdown: string;
  }[];

  if (guard.season.scoringMode === "positional") {
    const scores = await computeSeasonPositional(seasonId);
    const { assignments } = distributeBands(scores, bands, guard.season.totalBoxes);
    const assignmentByMemberId = new Map(assignments.map((a) => [a.memberId, a]));
    resultRows = scores.map((score) => {
      const assignment = assignmentByMemberId.get(score.memberId)!;
      return {
        seasonId,
        memberId: score.memberId,
        rank: assignment.rank,
        seasonScore: score.seasonScore,
        bandOrder: assignment.bandOrder,
        boxesAwarded: assignment.boxesAwarded,
        breakdown: JSON.stringify({ mode: "positional", categories: score.categoryDetail, extras: score.extraDetail }),
      };
    });
  } else {
    const scores = await computeSeasonPoints(seasonId);
    const { assignments } = distributeBands(scores, bands, guard.season.totalBoxes);
    const assignmentByMemberId = new Map(assignments.map((a) => [a.memberId, a]));
    resultRows = scores.map((score) => {
      const assignment = assignmentByMemberId.get(score.memberId)!;
      return {
        seasonId,
        memberId: score.memberId,
        rank: assignment.rank,
        seasonScore: score.seasonScore,
        bandOrder: assignment.bandOrder,
        boxesAwarded: assignment.boxesAwarded,
        breakdown: JSON.stringify({ mode: "points", categories: score.categoryPoints, extras: score.extraPoints }),
      };
    });
  }

  await prisma.$transaction([
    prisma.seasonResult.deleteMany({ where: { seasonId } }),
    prisma.seasonResult.createMany({ data: resultRows }),
    prisma.season.update({ where: { id: seasonId }, data: { status: "final", finalizedAt: new Date() } }),
  ]);

  return NextResponse.json({ finalized: true, resultCount: resultRows.length });
}
