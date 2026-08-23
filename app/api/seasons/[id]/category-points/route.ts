import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/dal";
import { loadEditableSeason, validateRateFlat } from "@/lib/season/validate";

type CategoryPointsInput = {
  categoryKey: string;
  mode: string;
  pointsPerUnit?: number | null;
  unitSize?: number | null;
  flatValue?: number | null;
};

// Full-replace: the client always sends the complete set of categories currently checked
// "count toward season score", with their configs - so an unchecked category is simply
// absent from the array, not sent with some "off" flag.
export async function PUT(request: Request, ctx: RouteContext<"/api/seasons/[id]/category-points">) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const { id } = await ctx.params;
  const seasonId = Number(id);

  const guard = await loadEditableSeason(seasonId);
  if ("error" in guard) return guard.error;

  const body = (await request.json()) as { items?: CategoryPointsInput[] };
  const items = body.items ?? [];

  for (const item of items) {
    if (!item.categoryKey) return NextResponse.json({ error: "Each item needs a categoryKey." }, { status: 400 });
    const err = validateRateFlat(item);
    if (err) return NextResponse.json({ error: `${item.categoryKey}: ${err}` }, { status: 400 });
  }

  await prisma.$transaction([
    prisma.seasonCategoryPoints.deleteMany({ where: { seasonId } }),
    ...items.map((item) =>
      prisma.seasonCategoryPoints.create({
        data: {
          seasonId,
          categoryKey: item.categoryKey,
          mode: item.mode,
          pointsPerUnit: item.mode === "rate" ? (item.pointsPerUnit ?? null) : null,
          unitSize: item.mode === "rate" ? (item.unitSize ?? null) : null,
          flatValue: item.mode === "flat" ? (item.flatValue ?? null) : null,
        },
      })
    ),
  ]);

  const categoryPoints = await prisma.seasonCategoryPoints.findMany({ where: { seasonId } });
  return NextResponse.json({ categoryPoints });
}
