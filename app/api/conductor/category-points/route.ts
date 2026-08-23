import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/dal";

export async function GET() {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const categories = await prisma.category.findMany({
    where: { active: true, shape: { not: "free_text" } },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { key: true, name: true, conductorMode: true, conductorPointsPerUnit: true, conductorUnitSize: true, conductorFlatValue: true },
  });
  return NextResponse.json({ categories });
}

type CategoryPointsInput = {
  categoryKey: string;
  mode: string;
  pointsPerUnit?: number | null;
  unitSize?: number | null;
  flatValue?: number | null;
};

// Bulk edit of every rankable category's Conductor points in one save - same rate/flat/off
// normalization app/api/categories/[id]/route.ts already applies to a single category, just
// looped over the whole set instead of threaded through the Category edit panel one at a time.
export async function PUT(request: Request) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const body = (await request.json()) as { items?: CategoryPointsInput[] };
  const items = body.items ?? [];

  for (const item of items) {
    if (!item.categoryKey) return NextResponse.json({ error: "Each item needs a categoryKey." }, { status: 400 });
    if (!["off", "rate", "flat"].includes(item.mode)) {
      return NextResponse.json({ error: `${item.categoryKey}: mode must be 'off', 'rate', or 'flat'.` }, { status: 400 });
    }
    if (item.mode === "rate") {
      if (typeof item.pointsPerUnit !== "number" || !Number.isFinite(item.pointsPerUnit)) {
        return NextResponse.json({ error: `${item.categoryKey}: points per unit is required for rate mode.` }, { status: 400 });
      }
      if (item.unitSize != null && (!Number.isFinite(item.unitSize) || item.unitSize <= 0)) {
        return NextResponse.json({ error: `${item.categoryKey}: unit size must be greater than 0 for rate mode.` }, { status: 400 });
      }
    }
    if (item.mode === "flat" && (typeof item.flatValue !== "number" || !Number.isFinite(item.flatValue))) {
      return NextResponse.json({ error: `${item.categoryKey}: flat value is required for flat mode.` }, { status: 400 });
    }
  }

  await prisma.$transaction(
    items.map((item) =>
      prisma.category.update({
        where: { key: item.categoryKey },
        data: {
          conductorMode: item.mode,
          conductorPointsPerUnit: item.mode === "rate" ? (item.pointsPerUnit ?? null) : null,
          conductorUnitSize: item.mode === "rate" ? (item.unitSize ?? 1) : null,
          conductorFlatValue: item.mode === "flat" ? (item.flatValue ?? null) : null,
        },
      })
    )
  );

  const categories = await prisma.category.findMany({
    where: { active: true, shape: { not: "free_text" } },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { key: true, name: true, conductorMode: true, conductorPointsPerUnit: true, conductorUnitSize: true, conductorFlatValue: true },
  });
  return NextResponse.json({ categories });
}
