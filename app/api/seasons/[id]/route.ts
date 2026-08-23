import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/dal";
import { getRankableCategories } from "@/lib/conductor/stats";
import { loadEditableSeason } from "@/lib/season/validate";

export async function GET(_request: Request, ctx: RouteContext<"/api/seasons/[id]">) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const { id } = await ctx.params;
  const seasonId = Number(id);

  const season = await prisma.season.findUnique({
    where: { id: seasonId },
    include: {
      categoryPoints: true,
      categoryWeights: true,
      bands: { orderBy: { order: "asc" } },
      extraItems: { include: { _count: { select: { values: true } } }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!season) return NextResponse.json({ error: "Season not found." }, { status: 404 });

  const categories = await getRankableCategories();

  return NextResponse.json({
    season: {
      id: season.id,
      name: season.name,
      weekStart: season.weekStart,
      weekEnd: season.weekEnd,
      totalBoxes: season.totalBoxes,
      scoringMode: season.scoringMode,
      status: season.status,
      finalizedAt: season.finalizedAt,
    },
    categories,
    categoryPoints: season.categoryPoints,
    categoryWeights: season.categoryWeights,
    extraItems: season.extraItems.map((i) => ({
      id: i.id,
      key: i.key,
      name: i.name,
      mode: i.mode,
      pointsPerUnit: i.pointsPerUnit,
      unitSize: i.unitSize,
      flatValue: i.flatValue,
      weight: i.weight,
      valueCount: i._count.values,
    })),
    bands: season.bands,
  });
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/seasons/[id]">) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const { id } = await ctx.params;
  const seasonId = Number(id);

  const guard = await loadEditableSeason(seasonId);
  if ("error" in guard) return guard.error;

  const body = (await request.json()) as {
    name?: string;
    weekStart?: number;
    weekEnd?: number;
    totalBoxes?: number;
    scoringMode?: string;
  };
  const name = body.name !== undefined ? body.name.trim() : guard.season.name;
  const weekStart = body.weekStart !== undefined ? Number(body.weekStart) : guard.season.weekStart;
  const weekEnd = body.weekEnd !== undefined ? Number(body.weekEnd) : guard.season.weekEnd;
  const totalBoxes = body.totalBoxes !== undefined ? Number(body.totalBoxes) : guard.season.totalBoxes;
  const scoringMode = body.scoringMode !== undefined ? body.scoringMode : guard.season.scoringMode;

  const errors: { field: string; message: string }[] = [];
  if (!name) errors.push({ field: "name", message: "Name is required." });
  if (!Number.isInteger(weekStart) || weekStart < 1) errors.push({ field: "weekStart", message: "Week start must be a positive integer." });
  if (!Number.isInteger(weekEnd) || weekEnd < weekStart) {
    errors.push({ field: "weekEnd", message: "Week end must be a positive integer, not before week start." });
  }
  if (!Number.isInteger(totalBoxes) || totalBoxes < 0) errors.push({ field: "totalBoxes", message: "Total boxes must be a non-negative integer." });
  if (scoringMode !== "points" && scoringMode !== "positional") {
    errors.push({ field: "scoringMode", message: "Scoring mode must be 'points' or 'positional'." });
  }

  if (name && name !== guard.season.name) {
    const existing = await prisma.season.findUnique({ where: { name } });
    if (existing) errors.push({ field: "name", message: "A season with this name already exists." });
  }

  if (errors.length > 0) return NextResponse.json({ errors }, { status: 400 });

  const season = await prisma.season.update({ where: { id: seasonId }, data: { name, weekStart, weekEnd, totalBoxes, scoringMode } });
  return NextResponse.json({ season });
}
