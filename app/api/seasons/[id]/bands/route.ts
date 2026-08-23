import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/dal";
import { loadEditableSeason } from "@/lib/season/validate";

type BandInput = { commanderCount: number; pctOfBoxes: number };

// Full-replace, order taken from array position (1-based) - removing a row in the middle
// and saving renumbers everything after it automatically, no explicit reordering UI needed.
export async function PUT(request: Request, ctx: RouteContext<"/api/seasons/[id]/bands">) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const { id } = await ctx.params;
  const seasonId = Number(id);

  const guard = await loadEditableSeason(seasonId);
  if ("error" in guard) return guard.error;

  const body = (await request.json()) as { bands?: BandInput[] };
  const bands = body.bands ?? [];

  for (const b of bands) {
    if (!Number.isInteger(b.commanderCount) || b.commanderCount < 1) {
      return NextResponse.json({ error: "Each band's commander count must be a positive integer." }, { status: 400 });
    }
    if (typeof b.pctOfBoxes !== "number" || !Number.isFinite(b.pctOfBoxes) || b.pctOfBoxes < 0) {
      return NextResponse.json({ error: "Each band's % of boxes must be a non-negative number." }, { status: 400 });
    }
  }

  await prisma.$transaction([
    prisma.seasonBand.deleteMany({ where: { seasonId } }),
    ...bands.map((b, i) =>
      prisma.seasonBand.create({ data: { seasonId, order: i + 1, commanderCount: b.commanderCount, pctOfBoxes: b.pctOfBoxes } })
    ),
  ]);

  const saved = await prisma.seasonBand.findMany({ where: { seasonId }, orderBy: { order: "asc" } });
  return NextResponse.json({ bands: saved });
}
