import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/dal";
import { loadEditableSeason, validateWeight } from "@/lib/season/validate";

type CategoryWeightInput = { categoryKey: string; weight: number };

// Full-replace, same pattern as category-points - the client always sends the complete set of
// categories currently checked "count toward positional score", with their weights.
export async function PUT(request: Request, ctx: RouteContext<"/api/seasons/[id]/category-weights">) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const { id } = await ctx.params;
  const seasonId = Number(id);

  const guard = await loadEditableSeason(seasonId);
  if ("error" in guard) return guard.error;

  const body = (await request.json()) as { items?: CategoryWeightInput[] };
  const items = body.items ?? [];

  for (const item of items) {
    if (!item.categoryKey) return NextResponse.json({ error: "Each item needs a categoryKey." }, { status: 400 });
    const err = validateWeight(item.weight);
    if (err) return NextResponse.json({ error: `${item.categoryKey}: ${err}` }, { status: 400 });
  }

  await prisma.$transaction([
    prisma.seasonCategoryWeight.deleteMany({ where: { seasonId } }),
    ...items.map((item) => prisma.seasonCategoryWeight.create({ data: { seasonId, categoryKey: item.categoryKey, weight: item.weight } })),
  ]);

  const categoryWeights = await prisma.seasonCategoryWeight.findMany({ where: { seasonId } });
  return NextResponse.json({ categoryWeights });
}
