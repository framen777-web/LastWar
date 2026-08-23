import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/dal";

// Deletes the frozen results and unlocks config editing again - the report falls back to
// computing live until Finalize is run again, which writes fresh SeasonResult rows.
export async function POST(_request: Request, ctx: RouteContext<"/api/seasons/[id]/reopen">) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const { id } = await ctx.params;
  const seasonId = Number(id);

  const season = await prisma.season.findUnique({ where: { id: seasonId } });
  if (!season) return NextResponse.json({ error: "Season not found." }, { status: 404 });
  if (season.status !== "final") return NextResponse.json({ error: "Season is not finalized." }, { status: 409 });

  await prisma.$transaction([
    prisma.seasonResult.deleteMany({ where: { seasonId } }),
    prisma.season.update({ where: { id: seasonId }, data: { status: "draft", finalizedAt: null } }),
  ]);

  return NextResponse.json({ reopened: true });
}
